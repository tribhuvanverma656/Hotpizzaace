import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import { initialBranches, initialOrders } from '../lib/data';
import type { Order } from '../types';

type Element = { type: unknown; key?: string; props: Record<string, unknown> };
type Slot = { value?: unknown; deps?: unknown[]; cleanup?: () => void };
type Frame = { key: string; slots: Slot[]; mounted: boolean };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function find(tree: unknown, match: (node: Element) => boolean): Element | undefined {
  if (Array.isArray(tree)) {
    for (const child of tree) {
      const node = find(child, match);
      if (node) return node;
    }
  } else if (tree && typeof tree === 'object' && 'props' in tree) {
    const node = tree as Element;
    return match(node) ? node : find(node.props.children, match);
  }
}
const bundle = build({
  stdin: {
    contents:
      'export {OrderDetail,OrderDetailPanel} from "./components/admin/orders"; export {statusLabels} from "./components/admin/shared"; export {CommerceError} from "@/lib/commerce/client";',
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
      name: 'order-detail-context',
      setup(plugin) {
        plugin.onResolve({ filter: /^react$/ }, ({ importer }) =>
          importer.endsWith('/components/admin/orders.tsx')
            ? { path: 'hooks', namespace: 'detail-fixture' }
            : undefined,
        );
        for (const [filter, path] of [
          [/use-admin-store$/, 'store'],
          [/^next\/navigation$/, 'navigation'],
          [/^next\/link$/, 'link'],
          [/order-bill$/, 'bill'],
          [/commerce\/client$/, 'client'],
          [/^sonner$/, 'toast'],
        ] as const)
          plugin.onResolve({ filter }, () => ({ path, namespace: 'detail-fixture' }));
        plugin.onLoad({ filter: /.*/, namespace: 'detail-fixture' }, ({ path }) => ({
          contents: {
            hooks:
              'export const useState=(v)=>fixture.hooks.useState(v);export const useRef=(v)=>fixture.hooks.useRef(v);export const useEffect=(f,d)=>fixture.hooks.useEffect(f,d);',
            store: 'export const useAdminStore=()=>fixture.store;',
            navigation: 'export const useParams=()=>({id:fixture.id});',
            link: 'export default "a";',
            bill: 'export const OrderBill="order-bill";',
            client:
              'export class CommerceError extends Error{constructor(message,status){super(message);this.status=status}}; export const commerceRequest=(p,o)=>fixture.request(p,o);',
            toast: 'export const toast=Object.assign(()=>{},{success:()=>{},error:()=>{}});',
          }[path]!,
        }));
      },
    },
  ],
});

/** Real loader/presentation, isolated hooks and deferred protected API responses. */
async function fixture(authorized = true) {
  const reads: { id: string; result: ReturnType<typeof deferred<Order>> }[] = [];
  const writes: { path: string; options: { body?: unknown } }[] = [];
  const timers = new Map<number, () => void>();
  const browser = Object.assign(new EventTarget(), {
    setInterval: (callback: () => void) => {
      timers.set(timers.size + 1, callback);
      return timers.size;
    },
    clearInterval: (id: number) => {
      timers.delete(id);
    },
  });
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  let current: Frame;
  let index = 0;
  let dirty = false;
  const effects: { frame: Frame; slot: Slot; callback: () => void | (() => void) }[] = [];
  function slot() {
    return (current.slots[index++] ??= {});
  }
  const state = {
    id: 'historical-order',
    store: {
      orders: [] as Order[],
      branches: initialBranches,
      adminBranchId: 'barra',
      updateOrderStatus: () => {},
      updatePaymentStatus: () => {},
      shared: {
        enabled: true,
        ready: true,
        admin: authorized,
        adminLoading: false,
        user: { id: 'owner-a' } as { id: string } | null,
        allowSimulatedPayments: true,
        getOrder: (id: string) => {
          const result = deferred<Order>();
          reads.push({ id, result });
          return result.promise;
        },
        refreshAdmin: async () => {},
      },
    },
    response: undefined as Order | undefined,
    request: async (path: string, options: { body?: unknown }) => {
      writes.push({ path, options });
      return { order: state.response };
    },
    hooks: {
      useState(initial: unknown) {
        const target = slot();
        const frame = current;
        if (!Object.hasOwn(target, 'value'))
          target.value = typeof initial === 'function' ? initial() : initial;
        return [
          target.value,
          (next: unknown) => {
            if (!frame.mounted) return;
            const value = typeof next === 'function' ? next(target.value) : next;
            if (!Object.is(value, target.value)) dirty = true;
            target.value = value;
          },
        ];
      },
      useRef(initial: unknown) {
        const target = slot();
        return (target.value ??= { current: initial });
      },
      useEffect(callback: () => void | (() => void), deps: unknown[]) {
        const target = slot();
        if (!target.deps || deps.some((value, i) => !Object.is(value, target.deps![i])))
          effects.push({ frame: current, slot: target, callback });
        target.deps = deps.slice();
      },
    },
  };
  const output = {
    exports: {} as {
      OrderDetail: () => Element;
      OrderDetailPanel: (props: Record<string, unknown>) => Element;
      statusLabels: Record<string, string>;
      CommerceError: new (message: string, status: number) => Error;
    },
  };
  new Function(
    'require',
    'module',
    'exports',
    'fixture',
    'window',
    'document',
    (await bundle).outputFiles![0].text,
  )(createRequire(import.meta.url), output, output.exports, state, browser, document);
  let frame: Frame | undefined;
  let panelFrame: Frame = { key: 'panel', slots: [], mounted: true };
  let tree: Element;
  function dispose() {
    if (!frame) return;
    frame.mounted = false;
    for (const value of frame.slots) value.cleanup?.();
    panelFrame.mounted = false;
    frame = undefined;
  }
  function flush() {
    for (let attempt = 0; attempt < 10; attempt++) {
      dirty = false;
      const root = output.exports.OrderDetail();
      if (root.props.shared) {
        if (!frame || frame.key !== root.key) {
          dispose();
          frame = { key: root.key!, slots: [], mounted: true };
          panelFrame = { key: 'panel', slots: [], mounted: true };
        }
        current = frame;
        index = 0;
        tree = (root.type as (props: Record<string, unknown>) => Element)(root.props);
      } else {
        dispose();
        tree = root;
      }
      for (const item of effects.splice(0))
        if (item.frame.mounted) {
          item.slot.cleanup?.();
          item.slot.cleanup = item.callback() ?? undefined;
        }
      if (!dirty) return;
    }
    throw new Error('Order detail effects did not settle.');
  }
  function panel() {
    return tree.type === output.exports.OrderDetailPanel ? tree : undefined;
  }
  function presentation() {
    const loaded = panel();
    assert.ok(loaded);
    current = panelFrame;
    index = 0;
    return output.exports.OrderDetailPanel(loaded.props);
  }
  async function settle() {
    await Promise.resolve();
    await Promise.resolve();
    flush();
  }
  const order = (version = 3): Order => ({
    ...structuredClone(initialOrders[0]),
    id: state.id,
    number: `QA-${state.id}`,
    version,
    status: 'pending',
    paymentStatus: 'simulated_paid',
    paymentMode: 'simulation',
    environment: 'development',
  });
  flush();
  return {
    state,
    reads,
    writes,
    order,
    flush,
    settle,
    panel,
    presentation,
    dispose,
    unavailable: () => !panel() && tree.props.role !== 'status',
    retry: () => {
      assert.equal(typeof tree.props.retry, 'function');
      (tree.props.retry as () => void)();
      flush();
    },
    tick: () => {
      for (const callback of [...timers.values()]) callback();
    },
    labels: output.exports.statusLabels,
    terminal: (status: number) => new output.exports.CommerceError('Order unavailable', status),
  };
}

test('historical owner bill loads directly without the recent snapshot', async () => {
  const page = await fixture();
  assert.equal(page.panel(), undefined);
  assert.equal(page.reads[0].id, 'historical-order');
  const order = page.order();
  page.reads[0].result.resolve(order);
  await page.settle();
  assert.equal(page.panel()?.props.order, order);
  assert.ok(
    find(page.presentation(), (node) => node.type === 'order-bill' && node.props.order === order),
  );
  page.dispose();
});

test('an unauthorized account never starts a private detail read', async () => {
  const page = await fixture(false);
  page.state.store.orders = [page.order()];
  page.flush();
  assert.equal(page.reads.length, 0);
  assert.equal(page.panel(), undefined);
  page.dispose();
});

test('owner/account, order and branch changes reject late reads and never expose cached data to a customer', async () => {
  for (const change of ['account', 'order', 'branch', 'customer'] as const) {
    const page = await fixture();
    const old = page.order();
    if (change === 'account') page.state.store.shared.user = { id: 'owner-b' };
    if (change === 'order') page.state.id = 'another-order';
    if (change === 'branch') page.state.store.adminBranchId = 'other-branch';
    if (change === 'customer') page.state.store.shared.admin = false;
    page.flush();
    page.reads[0].result.resolve(old);
    await page.settle();
    assert.equal(page.panel(), undefined);
    assert.equal(page.reads.length, change === 'customer' ? 1 : 2);
    page.dispose();
  }
});

test('unavailable reads do not resurrect a snapshot bill; Retry may load a newly authorized result', async () => {
  const page = await fixture();
  page.state.store.orders = [page.order(9)];
  page.reads[0].result.reject(page.terminal(404));
  await page.settle();
  assert.equal(page.unavailable(), true);
  page.retry();
  assert.equal(page.reads.length, 2);
  page.reads[1].result.resolve(page.order(10));
  await page.settle();
  assert.equal((page.panel()?.props.order as Order).version, 10);
  page.dispose();
});

test('single-flight revalidation detects removed historical bills and updated versions', async () => {
  const page = await fixture();
  page.tick();
  page.tick();
  assert.equal(page.reads.length, 1, 'slow reads must not be replaced by polling');
  page.reads[0].result.resolve(page.order());
  await page.settle();
  page.tick();
  page.reads[1].result.resolve(page.order(4));
  await page.settle();
  assert.equal((page.panel()?.props.order as Order).version, 4);
  page.state.store.orders = [];
  page.tick();
  page.reads[2].result.reject(page.terminal(410));
  await page.settle();
  assert.equal(page.unavailable(), true);
  page.dispose();
});

test('historical workflow uses the loaded version and ignores a read older than the mutation', async () => {
  const page = await fixture();
  page.reads[0].result.resolve(page.order(7));
  await page.settle();
  page.tick(); // old read remains in flight while the workflow updates the record
  const button = find(
    page.presentation(),
    (node) => node.type === 'button' && node.props.children === page.labels.confirmed,
  );
  assert.ok(button);
  (button.props.onClick as () => void)();
  const confirmation = find(
    page.presentation(),
    (node) => typeof node.props.title === 'string' && node.props.title.startsWith('Mark order'),
  );
  assert.ok(confirmation);
  page.state.response = { ...page.order(8), status: 'confirmed' };
  await (confirmation.props.onConfirm as () => Promise<void>)();
  await page.settle();
  assert.deepEqual(page.writes[0].options.body, { status: 'confirmed', expectedVersion: 7 });
  page.reads[1].result.resolve(page.order(7));
  await page.settle();
  assert.equal((page.panel()?.props.order as Order).version, 8);
  const oldMutate = page.panel()!.props.mutate as (p: string, o: unknown) => Promise<Order | null>;
  page.state.store.shared.admin = false;
  page.flush();
  assert.equal(await oldMutate('orders/historical-order', {}), null);
  assert.equal(page.writes.length, 1);
  page.dispose();
});

test('removal or revoked access prevents an older pending mutation from restoring a bill', async () => {
  for (const status of [401, 403, 404, 410])
    for (const pollFirst of [true, false]) {
      const page = await fixture();
      page.reads[0].result.resolve(page.order(7));
      await page.settle();
      const write = deferred<{ order: Order }>();
      page.state.request = async () => write.promise;
      const mutate = page.panel()!.props.mutate as (p: string, o: unknown) => Promise<Order | null>;
      if (pollFirst) page.tick();
      const pending = mutate('orders/historical-order', { method: 'PATCH' });
      if (!pollFirst) page.tick();
      page.reads[1].result.reject(page.terminal(status));
      await page.settle();
      assert.equal(page.unavailable(), true);
      write.resolve({ order: page.order(8) });
      assert.equal(await pending, null);
      await page.settle();
      assert.equal(page.unavailable(), true);
      page.dispose();
    }
});
