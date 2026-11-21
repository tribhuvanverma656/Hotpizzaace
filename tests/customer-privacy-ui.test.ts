import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';

type Element = { type: unknown; props: Record<string, unknown> };
type Slot = { value?: unknown; deps?: unknown[]; cleanup?: () => void };
type Auth = {
  user: { id: string; email: null; name: null } | null;
  contextId: string | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};
const compiled = build({
  stdin: {
    contents:
      'export {CustomerAuthProvider} from "./components/customer-auth-provider"; export {SharedOrderView} from "./components/shared-order-view";',
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  plugins: [
    {
      name: 'private-customer-fixture',
      setup(plugin) {
        plugin.onResolve({ filter: /^react$/ }, ({ importer }) =>
          /\/components\/(customer-auth-provider|shared-order-view)\.tsx$/.test(importer)
            ? { path: 'hooks', namespace: 'fixture' }
            : undefined,
        );
        plugin.onResolve({ filter: /customer-auth-provider$/ }, ({ importer }) =>
          importer.endsWith('/shared-order-view.tsx')
            ? { path: 'auth', namespace: 'fixture' }
            : undefined,
        );
        for (const [filter, path] of [
          [/^next\/navigation$/, 'navigation'],
          [/^next\/link$/, 'link'],
          [/lib\/store$/, 'store'],
          [/shared-commerce-provider$/, 'shared'],
          [/order-detail$/, 'detail'],
        ] as const)
          plugin.onResolve({ filter }, () => ({ path, namespace: 'fixture' }));
        plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents: {
            hooks:
              'export const createContext=()=>({Provider:"AuthProvider"}); export const useContext=()=>null; export const useState=(v)=>fixture.hooks.useState(v); export const useRef=(v)=>fixture.hooks.useRef(v); export const useEffect=(f,d)=>fixture.hooks.useEffect(f,d); export const useCallback=(f,d)=>fixture.hooks.useCallback(f,d);',
            auth: 'export const useCustomerAuth=()=>fixture.auth;',
            navigation: 'export const usePathname=()=>"/account/orders";',
            link: 'export default "a";',
            store: 'export const useDemoStore={getState:()=>({customerSession:null})};',
            shared: 'export const useSharedCommerce=()=>fixture.shared;',
            detail: 'export const OrderDetail="PrivateOrderDetail";',
          }[path]!,
        }));
      },
    },
  ],
});
function storage() {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    key: (i: number) => [...values.keys()][i] ?? null,
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => void values.set(k, v),
    removeItem: (k: string) => void values.delete(k),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function find(tree: unknown, type: string): Element | undefined {
  if (Array.isArray(tree)) return tree.map((child) => find(child, type)).find(Boolean);
  if (tree && typeof tree === 'object' && 'props' in tree) {
    const element = tree as Element;
    return element.type === type ? element : find(element.props.children, type);
  }
}
async function fixture() {
  const slots = new Map<string, Slot[]>();
  const effects: { slot: Slot; callback: () => void | (() => void) }[] = [];
  let owner = '';
  let index = 0;
  let dirty = false;
  let providerTree: Element;
  let viewTree: Element;
  const target = storage();
  const channels: EventTarget[] = [];
  const state = {
    auth: {
      user: null,
      contextId: 'a'.repeat(64),
      loading: false,
      error: null,
      refresh: async () => {},
      signOut: async () => {},
    } as Auth,
    shared: {
      customerOrders: [],
      adminOrders: [],
      getOrder: async () => ({
        id: 'order-a',
        version: 1,
        customer: { name: 'PRIVATE_A' },
      }),
    },
    broadcasts: [] as unknown[],
    requests: [] as string[],
    sessionResponse: async () =>
      Response.json({ configured: true, contextId: 'a'.repeat(64), user: null }),
    logoutResponse: async () => Response.json({ ok: true }),
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
      useEffect(callback: () => void | (() => void), deps: unknown[]) {
        const slot = nextSlot();
        if (!slot.deps || deps.some((v, i) => !Object.is(v, slot.deps![i])))
          effects.push({ slot, callback });
        slot.deps = deps.slice();
      },
      useCallback(callback: unknown, deps: unknown[]) {
        const slot = nextSlot();
        if (!slot.deps || deps.some((v, i) => !Object.is(v, slot.deps![i]))) slot.value = callback;
        slot.deps = deps.slice();
        return slot.value;
      },
    },
  };
  function nextSlot() {
    const current = slots.get(owner) ?? [];
    slots.set(owner, current);
    return (current[index++] ??= {});
  }
  class Channel extends EventTarget {
    constructor() {
      super();
      channels.push(this);
    }
    postMessage(value: unknown) {
      state.broadcasts.push(value);
    }
    close() {}
  }
  const browser = Object.assign(new EventTarget(), {
    sessionStorage: target,
    BroadcastChannel: Channel,
  });
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  let now = 0;
  let timerId = 0;
  const timers = new Map<number, { callback: () => void; interval: number; due: number }>();
  const advance = (milliseconds: number) => {
    const end = now + milliseconds;
    for (;;) {
      const due = Math.min(...[...timers.values()].map((timer) => timer.due));
      if (due > end) break;
      now = due;
      for (const timer of timers.values())
        if (timer.due === due) {
          timer.due += timer.interval;
          timer.callback();
        }
    }
    now = end;
  };
  const output = {
    exports: {} as {
      CustomerAuthProvider: (props: Record<string, unknown>) => Element;
      SharedOrderView: (props: Record<string, unknown>) => Element;
    },
  };
  const transport = async (path: string) => {
    state.requests.push(path);
    return path === '/auth/signout' ? state.logoutResponse() : state.sessionResponse();
  };
  new Function(
    'require',
    'module',
    'exports',
    'fixture',
    'window',
    'document',
    'fetch',
    'setInterval',
    'clearInterval',
    'Date',
    (await compiled).outputFiles[0].text,
  )(
    createRequire(import.meta.url),
    output,
    output.exports,
    state,
    browser,
    document,
    transport,
    (callback: () => void, interval: number) => {
      const id = ++timerId;
      timers.set(id, { callback, interval, due: now + interval });
      return id;
    },
    (id: number) => timers.delete(id),
    class extends Date {
      static now() {
        return now;
      }
    },
  );
  let mode: 'provider' | 'view' = 'provider';
  const render = () => {
    owner = mode;
    index = 0;
    if (mode === 'provider') providerTree = output.exports.CustomerAuthProvider({ children: null });
    else viewTree = output.exports.SharedOrderView({ id: 'order-a' });
  };
  const flush = () => {
    for (let pass = 0; pass < 12; pass++) {
      dirty = false;
      render();
      for (const { slot, callback } of effects.splice(0)) {
        slot.cleanup?.();
        slot.cleanup = callback() ?? undefined;
      }
      if (!dirty && effects.length === 0) return;
    }
    throw new Error('Private effects did not settle.');
  };
  const settle = async () => {
    for (let pass = 0; pass < 3; pass++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      flush();
    }
  };
  const close = () => {
    for (const group of slots.values()) for (const slot of group) slot.cleanup?.();
  };
  return {
    state,
    target,
    channels,
    browser,
    document,
    advance,
    flush,
    settle,
    close,
    value: () => providerTree.props.value as Auth,
    view: () => {
      mode = 'view';
      flush();
      return viewTree;
    },
    tree: () => viewTree,
  };
}

test('real auth provider clears boundary drafts before exposing new context and broadcasts no private information', async () => {
  const f = await fixture();
  try {
    f.flush();
    await f.settle();
    f.target.setItem('hot-pizza-ace-shared-checkout:v1:guest:barra:attempt', 'PRIVATE_GUEST');
    f.target.setItem('hpa-table-request:legacy:1', 'PRIVATE_QR');
    f.state.sessionResponse = async () =>
      Response.json({
        configured: true,
        contextId: 'b'.repeat(64),
        user: { id: 'customer-a', email: null, name: null },
      });
    await f.value().refresh();
    f.flush();
    assert.equal(f.value().contextId, 'b'.repeat(64));
    assert.equal(f.target.getItem('hot-pizza-ace-shared-checkout:v1:guest:barra:attempt'), null);
    assert.equal(f.target.getItem('hpa-table-request:legacy:1'), null);
    assert.deepEqual(f.state.broadcasts, [{ type: 'recheck' }]);
    await f.value().refresh();
    f.flush();
    assert.deepEqual(
      f.state.broadcasts,
      [{ type: 'recheck' }],
      'ordinary refresh must not broadcast a loop',
    );
    f.channels[0].dispatchEvent(new MessageEvent('message', { data: { type: 'recheck' } }));
    await f.settle();
    assert.deepEqual(f.state.broadcasts, [{ type: 'recheck' }]);
  } finally {
    f.close();
  }
});

test('failed remote signout clears local private display immediately and waits for verified guest context', async () => {
  const f = await fixture();
  try {
    f.state.sessionResponse = async () =>
      Response.json({
        configured: true,
        contextId: 'b'.repeat(64),
        user: { id: 'customer-a', email: null, name: null },
      });
    f.flush();
    await f.settle();
    f.target.setItem('hpa-table-request:private:1', 'PRIVATE_QR');
    const verification = deferred<Response>();
    f.state.sessionResponse = () => verification.promise;
    f.state.logoutResponse = async () =>
      Response.json({ error: 'Remote revocation unavailable' }, { status: 503 });
    const result = f
      .value()
      .signOut()
      .catch((error) => error);
    f.flush();
    assert.equal(f.value().user, null);
    assert.equal(f.value().contextId, null);
    assert.equal(f.value().loading, true);
    assert.equal(f.target.getItem('hpa-table-request:private:1'), null);
    await f.settle();
    assert.equal(f.value().loading, true);
    verification.resolve(
      Response.json({ configured: true, contextId: 'c'.repeat(64), user: null }),
    );
    assert.match((await result).message, /Sign-out could not complete/);
    f.flush();
    assert.equal(f.value().contextId, 'c'.repeat(64));
    assert.equal(f.value().user, null);
    assert.equal(f.value().loading, false);
    for (const payload of f.state.broadcasts) assert.deepEqual(payload, { type: 'recheck' });
  } finally {
    f.close();
  }
});

test('receipt cache is hidden during identity checking and cannot restore an earlier anonymous context', async () => {
  const f = await fixture();
  try {
    f.view();
    await f.settle();
    assert.equal(
      (find(f.tree(), 'PrivateOrderDetail')?.props.order as { customer: { name: string } })
        ?.customer.name,
      'PRIVATE_A',
    );
    f.state.auth.loading = true;
    f.view();
    assert.equal(find(f.tree(), 'PrivateOrderDetail'), undefined);
    f.state.auth.loading = false;
    f.state.auth.contextId = 'b'.repeat(64);
    const pending = deferred<{ id: string; version: number; customer: { name: string } }>();
    f.state.shared.getOrder = () => pending.promise;
    f.view();
    assert.equal(find(f.tree(), 'PrivateOrderDetail'), undefined);
    f.state.auth.contextId = 'c'.repeat(64);
    f.state.shared.getOrder = async () => {
      throw new Error('This order could not be found.');
    };
    f.view();
    pending.resolve({ id: 'order-a', version: 2, customer: { name: 'PRIVATE_B' } });
    await f.settle();
    assert.equal(find(f.tree(), 'PrivateOrderDetail'), undefined);
    assert.match(JSON.stringify(f.tree()), /This order could not be found/);
    assert.doesNotMatch(JSON.stringify(f.tree()), /PRIVATE_A|PRIVATE_B/);
  } finally {
    f.close();
  }
});

test('private receipt tracking pauses while hidden, refreshes once on return, and stops on cleanup', async () => {
  const f = await fixture();
  let reads = 0;
  f.state.shared.getOrder = async () => ({
    id: 'order-a',
    version: ++reads,
    status: 'closed',
    customer: { name: 'PRIVATE_A' },
  });
  try {
    f.document.visibilityState = 'hidden';
    f.view();
    f.advance(60000);
    await f.settle();
    assert.equal(reads, 0, 'A receipt opened in a hidden tab waits until visible.');
    f.document.visibilityState = 'visible';
    f.document.dispatchEvent(new Event('visibilitychange'));
    f.browser.dispatchEvent(new Event('focus'));
    await f.settle();
    assert.equal(reads, 1, 'Visibility and focus from the same return trigger one read.');
    assert.equal(
      (find(f.tree(), 'PrivateOrderDetail')?.props.order as { version: number })?.version,
      1,
    );
    f.advance(9999);
    await f.settle();
    assert.equal(reads, 1);
    f.advance(1);
    await f.settle();
    assert.equal(reads, 2, 'Completed receipts still receive payment or refund updates.');
    f.document.visibilityState = 'hidden';
    f.document.dispatchEvent(new Event('visibilitychange'));
    f.advance(60000);
    f.browser.dispatchEvent(new Event('focus'));
    await f.settle();
    assert.equal(reads, 2);
    f.document.visibilityState = 'visible';
    f.browser.dispatchEvent(new Event('focus'));
    f.document.dispatchEvent(new Event('visibilitychange'));
    await f.settle();
    assert.equal(reads, 3, 'Focus before visibilitychange also resumes exactly once.');
  } finally {
    f.close();
  }
  f.advance(10000);
  f.browser.dispatchEvent(new Event('focus'));
  await f.settle();
  assert.equal(reads, 3, 'A receipt unmounted during navigation cannot restart private reads.');
});

test('quiet focus verification preserves an active payment context, while explicit rechecks mask it', async () => {
  const f = await fixture();
  try {
    f.flush();
    await f.settle();
    const next = deferred<Response>();
    f.state.sessionResponse = () => next.promise;
    f.browser.dispatchEvent(new Event('focus'));
    f.flush();
    assert.equal(f.value().loading, false, 'ordinary focus must not unmount hosted payment');
    assert.equal(f.value().contextId, 'a'.repeat(64));
    next.resolve(Response.json({ configured: true, contextId: 'a'.repeat(64), user: null }));
    await f.settle();
    assert.deepEqual(f.state.broadcasts, []);
    const boundary = deferred<Response>();
    f.state.sessionResponse = () => boundary.promise;
    f.channels[0].dispatchEvent(new MessageEvent('message', { data: { type: 'recheck' } }));
    f.flush();
    assert.equal(
      f.value().loading,
      true,
      'explicit cross-tab identity boundary masks private views',
    );
    boundary.resolve(Response.json({ configured: true, contextId: 'b'.repeat(64), user: null }));
    await f.settle();
    assert.equal(f.value().contextId, 'b'.repeat(64));
    assert.equal(f.value().loading, false);
  } finally {
    f.close();
  }
});

test('failed quiet identity verification discards the display identity and context', async () => {
  const f = await fixture();
  try {
    f.flush();
    await f.settle();
    f.state.sessionResponse = async () =>
      Response.json({ error: 'Auth unavailable' }, { status: 503 });
    f.browser.dispatchEvent(new Event('focus'));
    await f.settle();
    assert.equal(f.value().contextId, null);
    assert.equal(f.value().user, null);
    assert.match(f.value().error ?? '', /check your sign-in/);
  } finally {
    f.close();
  }
});
