import assert from 'node:assert/strict';
import test from 'node:test';
import { initialBranches, initialCategories, initialProducts } from '../lib/data';
import { priceQrOnlineOrder, type QrOnlineInput } from '../lib/commerce/table-qr';
import { priceCounterOrder, parseCounterOrderRequest } from '../lib/counter';
import { changeOrderStatus, type CommerceCatalog, type SharedOrder } from '../lib/commerce/domain';
import { isRevenueEligible, isSimulatedRevenueEligible } from '../lib/pricing';
import { websiteOrderAlertIds } from '../lib/order-alerts';
import { kitchenOrders } from '../lib/kitchen';
const table = {
  id: '22222222-2222-4222-8222-222222222222',
  branch_id: 'barra',
  table_label: '',
  generation: 1,
};
const id = '33333333-3333-4333-8333-333333333333';
const now = '2026-11-14T10:00:00Z';
function fixture() {
  const branches = structuredClone(initialBranches);
  branches[0].settings = {
    ...branches[0].settings,
    counterAcceptingOrders: true,
    temporarilyClosed: false,
    billing: {
      businessName: 'HOT PIZZA ACE',
      address: 'Fictional QA address',
      gstin: '09ANCPV1491R1Z3',
      fssaiNumber: '12721045000614',
      stateName: 'Uttar Pradesh',
      stateCode: '09',
      sac: '996331',
      cgstRate: 2.5,
      sgstRate: 2.5,
    },
  };
  const catalog: CommerceCatalog = {
    products: structuredClone(initialProducts),
    categories: initialCategories,
    branches,
    revision: 1,
    mode: 'development',
    payments: { provider: 'razorpay', mode: 'test', enabled: true },
  };
  const product = catalog.products.find((p) => p.slug === 'french-fries')!;
  const input: QrOnlineInput = {
    items: [{ id: 'fries', productId: product.id, quantity: 1, toppingIds: [], notes: '' }],
    customerName: 'QA guest',
    customerPhone: '9876543210',
    expectedRevision: 1,
    expectedRoundOffPolicy: 'nearest_rupee',
    idempotencyKey: id,
    paymentMethod: 'upi',
  };
  const { paymentMethod: _method, ...counterInput } = input;
  void _method;
  const quote = priceCounterOrder(
    parseCounterOrderRequest({
      ...counterInput,
      branchId: 'barra',
      payment: null,
      payLaterReason: 'QA price',
      customerName: input.customerName,
      customerPhone: input.customerPhone,
    }),
    catalog,
    id,
    now,
    id,
  );
  input.expectedTotal = quote.total;
  return { catalog, input };
}
test('QR online pricing uses counter GST totals and authors no manual payment or accepted status', () => {
  const { catalog, input } = fixture();
  for (const provider of ['razorpay', 'phonepe'] as const) {
    catalog.payments!.provider = provider;
    const order = priceQrOnlineOrder(input, catalog, table, id, now);
    assert.equal(order.total, input.expectedTotal);
    assert.equal(order.deliveryFee, 0);
    assert.equal(order.fulfillment, 'dine_in');
    assert.equal(order.status, 'pending');
    assert.equal(order.paymentStatus, 'initiated');
    assert.equal(order.paymentMode, provider + '_test');
    assert.equal(order.counter, undefined);
    assert.equal(order.settlement, undefined);
    assert.deepEqual(websiteOrderAlertIds([order]), []);
    assert.deepEqual(kitchenOrders([order], table.branch_id), []);
    assert.throws(() => changeOrderStatus(order as SharedOrder, 'confirmed'));
    const paid = { ...order, paymentStatus: 'paid' as const };
    assert.deepEqual(websiteOrderAlertIds([paid]), [id]);
    const accepted = changeOrderStatus(paid as SharedOrder, 'confirmed');
    assert.deepEqual(websiteOrderAlertIds([accepted]), []);
    assert.equal(kitchenOrders([accepted], table.branch_id).length, 1);
    const preparing = changeOrderStatus(accepted, 'preparing');
    const ready = changeOrderStatus(preparing, 'ready');
    for (const cancellable of [accepted, preparing, ready]) {
      assert.equal(changeOrderStatus(cancellable, 'cancelled').status, 'cancelled');
    }
    const served = changeOrderStatus(ready, 'served');
    assert.equal(isSimulatedRevenueEligible(served), true);
    assert.equal(isRevenueEligible(served), false);
    assert.equal(changeOrderStatus(served, 'closed').status, 'closed');
  }
});
test('QR checkout rejects wrong payment mode, unavailable gateway, closed branch and changed quote', () => {
  const { catalog, input } = fixture();
  assert.throws(() => priceQrOnlineOrder({ ...input, expectedTotal: 1 }, catalog, table, id, now));
  assert.throws(() =>
    priceQrOnlineOrder(input, { ...catalog, payments: undefined }, table, id, now),
  );
  assert.throws(() =>
    priceQrOnlineOrder(input, { ...catalog, mode: 'production' }, table, id, now),
  );
  catalog.branches[0].settings.counterAcceptingOrders = false;
  assert.throws(() => priceQrOnlineOrder(input, catalog, table, id, now));
});
