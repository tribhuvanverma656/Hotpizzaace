import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import { initialBranches, initialCategories, initialProducts } from '../lib/data';
import type { Order } from '../types';
import type { SharedCatalog } from '../lib/commerce/client';

type User = { id: string; email: null; name: null } | null;
type Slot = { value?: unknown; deps?: unknown[]; cleanup?: () => void };
type Context = {
  ready: boolean;
  error: string | null;
  revision: number;
  user: User;
  admin: boolean;
  customerOrders: Order[];
  adminOrders: Order[];
  refresh(): Promise<void>;
  refreshAdmin(): Promise<void>;
  mutateCatalog(action: string, args: unknown): Promise<void>;
  getOrder(id: string): Promise<Order>;
};
type Request = { path: string; contextId: string | null; options?: { method?: string } };

const compiled = build({
  entryPoints: ['components/shared-commerce-provider.tsx'],
  absWorkingDir: process.cwd(),
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  plugins: [
    {
      name: 'commerce-refresh-fixture',
      setup(plugin) {
        plugin.onResolve({ filter: /^react$/ }, ({ importer }) =>
          importer.endsWith('/components/shared-commerce-provider.tsx')
            ? { path: 'hooks', namespace: 'fixture' }
            : undefined,
        );
        for (const [filter, path] of [
          [/^next\/navigation$/, 'navigation'],
          [/^@\/lib\/store$/, 'store'],
          [/^@\/lib\/commerce\/client$/, 'transport'],
          [/customer-auth-provider$/, 'auth'],
        ] as const)
          plugin.onResolve({ filter }, () => ({ path, namespace: 'fixture' }));
        plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents: {
            hooks:
              'export const createContext=()=>({Provider:"SharedProvider"}); export const useContext=()=>null; export const useState=(v)=>fixture.hooks.useState(v); export const useRef=(v)=>fixture.hooks.useRef(v); export const useEffect=(f,d)=>fixture.hooks.effect(f,d,false); export const useLayoutEffect=(f,d)=>fixture.hooks.effect(f,d,true); export const useCallback=(f,d)=>fixture.hooks.useCallback(f,d);',
            navigation: 'export const usePathname=()=>fixture.pathname;',
            store:
              'export const useDemoStore=(select)=>select(fixture.store); useDemoStore.getState=()=>fixture.store; useDemoStore.setState=(next)=>Object.assign(fixture.store,next);',
            transport:
              'export const commerceRequest=(path,options)=>fixture.transport(path,options);',
            auth: 'export const useCustomerAuth=()=>fixture.auth;',
          }[path]!,
        }));
      },
    },
  ],
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function catalog(revision = 1): SharedCatalog {
  return {
    products: structuredClone(initialProducts.slice(0, 1)),
    categories: structuredClone(initialCategories.slice(0, 1)),
    branches: structuredClone(initialBranches.slice(0, 1)),
    revision,
    mode: 'development',
    allowSimulatedPayments: false,
  };
}

function order(id: string, status: Order['status'] = 'closed'): Order {
  return {
    id,
    status,
    version: 1,
    customer: { name: `PRIVATE_${id}` },
  } as Order;
}

async function fixture(pathname = '/menu', owner = false) {
  const slots: Slot[] = [];
  const layouts: { slot: Slot; callback: () => void | (() => void) }[] = [];
  const effects: typeof layouts = [];
  let position = 0;
  let dirty = false;
  let mounted = true;
  let tree: { props: { value: Context } };
  const requests: Request[] = [];
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const browser = new EventTarget();
  let now = 0;
  let timerId = 0;
  const timers = new Map<number, { callback: () => void; repeat: number | null; due: number }>();
  const schedule = (callback: () => void, delay: number, repeat: number | null) => {
    const id = ++timerId;
    timers.set(id, { callback, repeat, due: now + delay });
    return id;
  };
  const advance = (milliseconds: number) => {
    const end = now + milliseconds;
    for (;;) {
      const due = Math.min(...[...timers.values()].map((timer) => timer.due));
      if (due > end) break;
      now = due;
      for (const [id, timer] of [...timers])
        if (timer.due === due && timers.has(id)) {
          if (timer.repeat === null) timers.delete(id);
          else timer.due += timer.repeat;
          timer.callback();
        }
    }
    now = end;
  };
  const state = {
    pathname,
    owner,
    auth: {
      user: owner ? { id: 'owner-a', email: null, name: null } : (null as User),
      contextId: 'a'.repeat(64) as string | null,
      loading: false,
      error: null as string | null,
      refresh: async () => {},
    },
    store: {
      selectedBranchId: initialBranches[0].id,
      adminBranchId: initialBranches[0].id,
      hydrated: true,
      ...catalog(),
    },
    source: catalog(),
    customerOrders: [] as Order[],
    adminOrders: [] as Order[],
    response: undefined as undefined | ((request: Request) => unknown | Promise<unknown>),
    transport: async (path: string, options?: Request['options']): Promise<unknown> => {
      const request = { path, options, contextId: state.auth.contextId };
      requests.push(request);
      if (state.response) return state.response(request);
      return defaultResponse(request);
    },
    hooks: {
      useState(initial: unknown) {
        const slot = nextSlot();
        if (!Object.hasOwn(slot, 'value'))
          slot.value = typeof initial === 'function' ? initial() : initial;
        return [
          slot.value,
          (next: unknown) => {
            const value = typeof next === 'function' ? next(slot.value) : next;
            dirty ||= !Object.is(value, slot.value);
            slot.value = value;
          },
        ];
      },
      useRef(initial: unknown) {
        return (nextSlot().value ??= { current: initial });
      },
      effect(callback: () => void | (() => void), deps: unknown[], layout: boolean) {
        const slot = nextSlot();
        if (!slot.deps || deps.some((value, index) => !Object.is(value, slot.deps![index])))
          (layout ? layouts : effects).push({ slot, callback });
        slot.deps = deps.slice();
      },
      useCallback(callback: unknown, deps: unknown[]) {
        const slot = nextSlot();
        if (!slot.deps || deps.some((value, index) => !Object.is(value, slot.deps![index])))
          slot.value = callback;
        slot.deps = deps.slice();
        return slot.value;
      },
    },
  };
  const defaultResponse = ({ path }: Request): unknown => {
    if (path === 'session') return { user: state.auth.user, admin: state.owner };
    if (path === 'catalog') return structuredClone(state.source);
    if (path === 'orders') return { orders: structuredClone(state.customerOrders) };
    if (path === 'admin/snapshot')
      return { ...structuredClone(state.source), orders: structuredClone(state.adminOrders) };
    if (path === 'admin/mutate') return { ok: true };
    throw new Error(`Unexpected commerce request: ${path}`);
  };
  function nextSlot() {
    return (slots[position++] ??= {});
  }
  const output = {
    exports: {} as {
      SharedCommerceProvider: (props: { enabled: boolean; children: null }) => typeof tree;
    },
  };
  new Function(
    'require',
    'module',
    'exports',
    'fixture',
    'window',
    'document',
    'setInterval',
    'clearInterval',
    'setTimeout',
    'clearTimeout',
    'Date',
    (await compiled).outputFiles[0].text,
  )(
    createRequire(import.meta.url),
    output,
    output.exports,
    state,
    browser,
    document,
    (callback: () => void, delay: number) => schedule(callback, delay, delay),
    (id: number) => timers.delete(id),
    (callback: () => void, delay: number) => schedule(callback, delay, null),
    (id: number) => timers.delete(id),
    class extends Date {
      static now() {
        return now;
      }
    },
  );
  const flush = () => {
    if (!mounted) return;
    for (let pass = 0; pass < 16; pass++) {
      position = 0;
      dirty = false;
      tree = output.exports.SharedCommerceProvider({ enabled: true, children: null });
      for (const queue of [layouts, effects])
        for (const { slot, callback } of queue.splice(0)) {
          slot.cleanup?.();
          slot.cleanup = callback() ?? undefined;
        }
      if (!dirty && !layouts.length && !effects.length) return;
    }
    throw new Error('Shared provider effects did not settle.');
  };
  const settle = async () => {
    for (let pass = 0; pass < 6; pass++) {
      flush();
      advance(0);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    flush();
  };
  const close = () => {
    mounted = false;
    for (const slot of slots) slot.cleanup?.();
  };
  return {
    state,
    requests,
    document,
    browser,
    advance,
    flush,
    settle,
    close,
    defaultResponse,
    paths: () => requests.map(({ path }) => path),
    value: () => tree.props.value,
  };
}

test('idle guest menu refreshes once per minute without owner snapshots', async () => {
  const f = await fixture();
  try {
    await f.settle();
    assert.equal(f.value().ready, true);
    assert.deepEqual(f.paths(), ['session', 'catalog', 'orders']);
    f.requests.length = 0;
    f.advance(59999);
    await f.settle();
    assert.deepEqual(f.paths(), []);
    f.advance(1);
    await f.settle();
    assert.deepEqual(f.paths(), ['session', 'catalog', 'orders']);
  } finally {
    f.close();
  }
});

test('owner counter refreshes global acceptance alerts without customer history reads', async () => {
  const f = await fixture('/admin/counter', true);
  try {
    await f.settle();
    assert.equal(f.value().admin, true);
    assert.deepEqual(f.paths(), ['session', 'admin/snapshot']);
    f.requests.length = 0;
    f.advance(9999);
    await f.settle();
    assert.deepEqual(f.paths(), []);
    f.advance(1);
    await f.settle();
    assert.deepEqual(f.paths(), ['session', 'admin/snapshot']);
  } finally {
    f.close();
  }
});

test('owner order snapshots supply catalog and orders together without duplicate requests', async () => {
  const f = await fixture('/admin/orders', true);
  f.state.source = catalog(7);
  f.state.source.products[0].name = 'Fresh snapshot menu';
  f.state.adminOrders = [order('owner-order')];
  try {
    await f.settle();
    assert.deepEqual(f.paths(), ['session', 'admin/snapshot']);
    assert.equal(f.value().revision, 7);
    assert.equal(f.state.store.products[0].name, 'Fresh snapshot menu');
    assert.deepEqual(f.value().adminOrders, f.state.adminOrders);
    assert.deepEqual(f.value().customerOrders, []);
  } finally {
    f.close();
  }
});

test('all owner pages refresh acceptance alerts every ten seconds', async () => {
  for (const [pathname, interval] of [
    ['/admin/dashboard', 10000],
    ['/admin/settings', 10000],
    ['/admin/dine-in-qr', 10000],
    ['/admin/kitchen', 10000],
    ['/admin/orders', 10000],
  ] as const) {
    const f = await fixture(pathname, true);
    try {
      await f.settle();
      f.requests.length = 0;
      f.advance(interval - 1);
      await f.settle();
      assert.deepEqual(f.paths(), [], pathname);
      f.advance(1);
      await f.settle();
      assert.deepEqual(f.paths(), ['session', 'admin/snapshot'], pathname);
    } finally {
      f.close();
    }
  }
});

test('hidden provider polling is quiet and each foreground return refreshes only once', async () => {
  const f = await fixture('/admin/orders', true);
  try {
    await f.settle();
    f.requests.length = 0;
    for (const focusFirst of [false, true]) {
      f.document.visibilityState = 'hidden';
      f.document.dispatchEvent(new Event('visibilitychange'));
      f.advance(60000);
      f.browser.dispatchEvent(new Event('focus'));
      await f.settle();
      assert.deepEqual(f.paths(), []);
      f.document.visibilityState = 'visible';
      if (focusFirst) f.browser.dispatchEvent(new Event('focus'));
      f.document.dispatchEvent(new Event('visibilitychange'));
      if (!focusFirst) f.browser.dispatchEvent(new Event('focus'));
      await f.settle();
      assert.deepEqual(f.paths(), ['session', 'admin/snapshot']);
      f.browser.dispatchEvent(new Event('focus'));
      await f.settle();
      assert.equal(f.requests.length, 2, 'Repeated focus cannot duplicate a foreground refresh.');
      f.requests.length = 0;
    }
  } finally {
    f.close();
  }
});

test('pending automatic refreshes coalesce interval, focus, and equivalent navigation reads', async () => {
  const f = await fixture();
  const pending = deferred<{ user: null; admin: boolean }>();
  try {
    await f.settle();
    f.requests.length = 0;
    f.state.response = (request) =>
      request.path === 'session' ? pending.promise : f.defaultResponse(request);
    f.advance(60000);
    await f.settle();
    assert.deepEqual(f.paths(), ['session']);
    f.browser.dispatchEvent(new Event('focus'));
    f.state.pathname = '/offers';
    await f.settle();
    f.advance(180000);
    await f.settle();
    assert.deepEqual(f.paths(), ['session'], 'One unresolved refresh owns equivalent reads.');
    pending.resolve({ user: null, admin: false });
    await f.settle();
    assert.deepEqual(f.paths(), ['session', 'catalog', 'orders']);
  } finally {
    pending.resolve({ user: null, admin: false });
    f.close();
  }
});

test('navigation to owner orders cannot coalesce into a pending lightweight QR catalog refresh', async () => {
  const f = await fixture('/dine-in/test', true);
  const pending = deferred<{ user: User; admin: boolean }>();
  let held = false;
  try {
    await f.settle();
    f.requests.length = 0;
    f.state.adminOrders = [order('new-owner-order')];
    f.state.response = (request) => {
      if (request.path === 'session' && !held) {
        held = true;
        return pending.promise;
      }
      return f.defaultResponse(request);
    };
    f.advance(60000);
    await f.settle();
    f.state.pathname = '/admin/orders';
    await f.settle();
    assert.deepEqual(f.paths(), ['session', 'session', 'admin/snapshot']);
    assert.deepEqual(f.value().adminOrders, f.state.adminOrders);
    pending.resolve({ user: f.state.auth.user, admin: true });
    await f.settle();
    assert.deepEqual(f.value().adminOrders, f.state.adminOrders);
  } finally {
    pending.resolve({ user: f.state.auth.user, admin: true });
    f.close();
  }
});

test('a late QR catalog failure cannot degrade a successful owner order snapshot', async () => {
  const f = await fixture('/dine-in/test', true);
  const pending = deferred<SharedCatalog>();
  try {
    await f.settle();
    f.requests.length = 0;
    f.state.response = (request) =>
      request.path === 'catalog' ? pending.promise : f.defaultResponse(request);
    f.advance(60000);
    await f.settle();
    assert.deepEqual(f.paths(), ['session', 'catalog']);
    f.state.source = catalog(3);
    f.state.source.products[0].name = 'Current owner snapshot menu';
    f.state.adminOrders = [order('current-owner-order')];
    f.state.pathname = '/admin/orders';
    await f.settle();
    assert.deepEqual(f.paths(), ['session', 'catalog', 'session', 'admin/snapshot']);
    assert.equal(f.value().ready, true);
    assert.equal(f.value().error, null);
    assert.equal(f.value().revision, 3);
    pending.reject(new Error('Obsolete counter catalog request failed.'));
    await f.settle();
    assert.equal(f.value().ready, true, 'An obsolete failure cannot hide a current menu.');
    assert.equal(f.value().error, null);
    assert.equal(f.value().revision, 3);
    assert.equal(f.state.store.products[0].name, 'Current owner snapshot menu');
    assert.deepEqual(f.value().adminOrders, f.state.adminOrders);
    assert.deepEqual(f.paths(), ['session', 'catalog', 'session', 'admin/snapshot']);
  } finally {
    pending.resolve(catalog());
    f.close();
  }
});

test('post-mutation refresh starts fresh while an older automatic snapshot is pending', async () => {
  const f = await fixture('/admin/dashboard', true);
  const pending = deferred<SharedCatalog & { orders: Order[] }>();
  let snapshotReads = 0;
  try {
    await f.settle();
    f.requests.length = 0;
    f.state.response = (request) => {
      if (request.path === 'admin/snapshot' && ++snapshotReads === 1) return pending.promise;
      if (request.path === 'admin/mutate') f.state.source = catalog(3);
      return f.defaultResponse(request);
    };
    f.advance(30000);
    await f.settle();
    assert.deepEqual(f.paths(), ['session', 'admin/snapshot']);
    await f.value().mutateCatalog('saveProduct', []);
    await f.settle();
    assert.deepEqual(f.paths(), [
      'session',
      'admin/snapshot',
      'admin/mutate',
      'session',
      'admin/snapshot',
    ]);
    assert.equal(f.value().revision, 3, 'The explicit refresh must observe the committed change.');
    pending.resolve({ ...catalog(2), orders: [order('obsolete-owner-order')] });
    await f.settle();
    assert.equal(f.value().revision, 3);
    assert.deepEqual(f.value().adminOrders, []);
  } finally {
    pending.resolve({ ...catalog(2), orders: [] });
    f.close();
  }
});

test('account changes hide old orders immediately and discard pending list and receipt responses', async () => {
  const f = await fixture('/account/orders');
  const pendingOrders = deferred<{ orders: Order[] }>();
  const pendingReceipt = deferred<{ order: Order }>();
  f.state.auth.user = { id: 'customer-a', email: null, name: null };
  f.state.customerOrders = [order('customer-a-order')];
  try {
    await f.settle();
    assert.deepEqual(f.value().customerOrders, f.state.customerOrders);
    f.state.response = (request) => {
      if (request.path === 'orders' && request.contextId === 'a'.repeat(64))
        return pendingOrders.promise;
      if (request.path === 'orders/private-a') return pendingReceipt.promise;
      return f.defaultResponse(request);
    };
    const receipt = f
      .value()
      .getOrder('private-a')
      .catch((cause: unknown) => cause);
    f.advance(10000);
    await f.settle();
    f.state.auth.contextId = 'b'.repeat(64);
    f.state.auth.user = { id: 'customer-b', email: null, name: null };
    f.state.customerOrders = [order('customer-b-order')];
    f.flush();
    assert.deepEqual(f.value().customerOrders, []);
    assert.equal(f.value().user, null);
    assert.equal(f.value().ready, false);
    await f.settle();
    assert.deepEqual(f.value().customerOrders, f.state.customerOrders);
    pendingOrders.resolve({ orders: [order('PRIVATE_LATE_ACCOUNT_A')] });
    pendingReceipt.resolve({ order: order('PRIVATE_LATE_RECEIPT_A') });
    assert.match(String(await receipt), /account changed/i);
    await f.settle();
    assert.deepEqual(f.value().customerOrders, f.state.customerOrders);
    assert.equal(f.value().user?.id, 'customer-b');
    assert.doesNotMatch(JSON.stringify(f.value()), /PRIVATE_LATE_ACCOUNT_A|PRIVATE_LATE_RECEIPT_A/);
    assert.doesNotMatch(JSON.stringify(f.state.store), /customer-a-order|customer-b-order/);
  } finally {
    pendingOrders.resolve({ orders: [] });
    pendingReceipt.resolve({ order: order('discarded') });
    f.close();
  }
});

test('an unverified boundary cannot rejoin an old refresh when the same account returns', async () => {
  const f = await fixture('/account/orders');
  const pending = deferred<{ user: User; admin: boolean }>();
  let held = false;
  f.state.auth.user = { id: 'customer-a', email: null, name: null };
  f.state.customerOrders = [order('earlier-account-a-order')];
  try {
    await f.settle();
    f.requests.length = 0;
    f.state.response = (request) => {
      if (request.path === 'session' && !held) {
        held = true;
        return pending.promise;
      }
      return f.defaultResponse(request);
    };
    f.advance(10000);
    await f.settle();
    assert.deepEqual(f.paths(), ['session']);
    f.state.auth.error = 'Sign-in could not be checked.';
    f.flush();
    assert.equal(f.value().ready, false);
    assert.deepEqual(f.value().customerOrders, []);
    await f.settle();
    f.state.auth.error = null;
    f.state.customerOrders = [order('freshly-verified-account-a-order')];
    await f.settle();
    assert.deepEqual(f.paths(), ['session', 'session', 'catalog', 'orders']);
    assert.equal(f.value().ready, true);
    assert.deepEqual(f.value().customerOrders, f.state.customerOrders);
    pending.resolve({ user: f.state.auth.user, admin: false });
    await f.settle();
    assert.deepEqual(
      f.paths(),
      ['session', 'session', 'catalog', 'orders'],
      'A response from before the unverified boundary cannot restart an obsolete pipeline.',
    );
    assert.deepEqual(f.value().customerOrders, f.state.customerOrders);
  } finally {
    pending.resolve({ user: f.state.auth.user, admin: false });
    f.close();
  }
});
