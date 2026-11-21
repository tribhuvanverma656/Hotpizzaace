import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import { initialOrders, initialBranches } from '../lib/data';
import type { Order } from '../types';

type Element = { type: unknown; props: Record<string, unknown> };
const compiled = build({
  entryPoints: ['components/order-detail.tsx'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  plugins: [
    {
      name: 'cancel-ui-fixture',
      setup(plugin) {
        const modules: Record<string, string> = {
          react: 'export const useState=(v)=>fixture.useState(v);',
          'next/link': 'export default "a";',
          sonner:
            'export const toast={success:(v)=>fixture.messages.push(v),error:(v)=>fixture.messages.push(v)};',
          '@/lib/store':
            'export const useDemoStore=Object.assign((select)=>select(fixture.store),{getState:()=>fixture.store});',
          './shared-commerce-provider': 'export const useSharedCommerce=()=>fixture.shared;',
          './payments/online-payment': 'export const OnlinePayment="OnlinePayment";',
          './order-bill': 'export const OrderBill="OrderBill";',
        };
        plugin.onResolve({ filter: /.*/ }, ({ path }) =>
          path in modules ? { path, namespace: 'fixture' } : undefined,
        );
        plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents: modules[path],
        }));
      },
    },
  ],
});
function elements(tree: unknown): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== 'object' || !('props' in tree)) return [];
  const element = tree as Element;
  return [element, ...elements(element.props.children)];
}
function text(tree: unknown): string {
  if (typeof tree === 'string') return tree;
  if (Array.isArray(tree)) return tree.map(text).join('');
  return tree && typeof tree === 'object' && 'props' in tree
    ? text((tree as Element).props.children)
    : '';
}
async function fixture(shared = true) {
  let order: Order = {
    ...structuredClone(initialOrders[0]),
    id: 'cancel-ui',
    version: 4,
    status: 'pending',
    paymentStatus: 'pending',
    paymentMethod: 'upi',
    paymentMode: 'razorpay_live',
  };
  const slots: unknown[] = [];
  let cursor = 0;
  const state = {
    messages: [] as string[],
    calls: [] as unknown[],
    fail: false,
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [
        slots[index],
        (next: unknown) => {
          slots[index] = next;
        },
      ];
    },
    store: {
      branches: initialBranches,
      orders: [order],
      updatePaymentStatus: () => {},
      updateOrderStatus: (_id: string, status: Order['status']) => {
        order = { ...order, status };
      },
    },
    shared: {
      enabled: shared,
      mode: 'production',
      cancelOrder: async (id: string, version: number) => {
        state.calls.push([id, version]);
        if (state.fail) throw new Error('Order changed. Refresh and retry.');
        order = { ...order, status: 'cancelled', version: version + 1 };
        return order;
      },
    },
  };
  const uiModule = { exports: {} as { OrderDetail: (props: unknown) => unknown } };
  new Function('require', 'module', 'exports', 'fixture', (await compiled).outputFiles[0].text)(
    createRequire(import.meta.url),
    uiModule,
    uiModule.exports,
    state,
  );
  return {
    state,
    render(canRetryPayment = true) {
      cursor = 0;
      return uiModule.exports.OrderDetail({ order, canRetryPayment });
    },
  };
}
function button(tree: unknown, label: string) {
  return elements(tree).find(
    (element) => element.type === 'button' && text(element.props.children).trim() === label,
  );
}
async function click(tree: unknown, label: string) {
  const found = button(tree, label);
  assert.ok(found, `Missing ${label}`);
  assert.ok(!found.props.disabled);
  await (found.props.onClick as () => unknown)();
}
test('unpaid receipt offers cancellation, Keep order is harmless, and confirmation updates receipt', async () => {
  for (const shared of [true, false]) {
    const view = await fixture(shared);
    await click(view.render(), 'Cancel order');
    await click(view.render(), 'Keep order');
    assert.equal(view.state.calls.length, 0);
    await click(view.render(), 'Cancel order');
    await click(view.render(), 'Yes, cancel order');
    const cancelled = view.render();
    assert.equal(button(cancelled, 'Cancel order'), undefined);
    assert.ok(text(cancelled).includes('This order will not be fulfilled.'));
    assert.ok(!elements(cancelled).some((element) => element.type === 'OnlinePayment'));
    if (shared) assert.deepEqual(view.state.calls, [['cancel-ui', 4]]);
  }
});
test('tracking-only receipt hides cancellation and failed cancellation remains retryable', async () => {
  const view = await fixture();
  assert.equal(button(view.render(false), 'Cancel order'), undefined);
  view.state.fail = true;
  await click(view.render(), 'Cancel order');
  await click(view.render(), 'Yes, cancel order');
  assert.ok(button(view.render(), 'Yes, cancel order'));
  assert.deepEqual(view.state.messages, ['Order changed. Refresh and retry.']);
});
