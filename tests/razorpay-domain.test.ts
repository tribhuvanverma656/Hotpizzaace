import assert from 'node:assert/strict';
import test from 'node:test';
import { initialBranches, initialCategories, initialProducts } from '../lib/data';
import {
  changeOrderStatus,
  changeSimulatedPayment,
  parseCreateOrderRequest,
  priceSharedOrder,
  type CommerceCatalog,
  type SharedOrder,
} from '../lib/commerce/domain';
import {
  isOnlinePaymentComplete,
  isRevenueEligible,
  isSimulatedRevenueEligible,
} from '../lib/pricing';
import { getPaymentMethodDetails } from '../lib/payments/method';

function catalog(mode: 'development' | 'production' = 'development'): CommerceCatalog {
  const branches = structuredClone(initialBranches);
  branches[0].settings = {
    ...branches[0].settings,
    acceptingOrders: true,
    temporarilyClosed: false,
    paymentMethods: ['cash', 'upi', 'card'],
  };
  return {
    products: structuredClone(initialProducts),
    categories: structuredClone(initialCategories),
    branches,
    revision: 1,
    mode,
    allowSimulatedPayments: mode === 'development',
    payments: {
      provider: 'razorpay',
      mode: mode === 'development' ? 'test' : 'live',
      enabled: true,
    },
  };
}

test('captured Razorpay orders preserve checkout selection without claiming an actual payment method', () => {
  for (const mode of ['development', 'production'] as const) {
    for (const selected of ['upi', 'card'] as const) {
      const receipt = Object.freeze({
        ...order(catalog(mode)),
        paymentStatus: 'paid' as const,
        paymentMethod: selected,
      });
      const original = structuredClone(receipt);
      const details = getPaymentMethodDetails(receipt);
      assert.equal(details.provider, 'razorpay');
      assert.equal(details.paymentMethod, null);
      assert.equal(details.requestedPaymentMethod, selected);
      assert.deepEqual(receipt, original);
    }
  }
});
function request() {
  return parseCreateOrderRequest({
    branchId: 'barra',
    items: [
      {
        id: 'cart-fries',
        productId: initialProducts.find((item) => item.slug === 'french-fries')!.id,
        quantity: 1,
        toppingIds: [],
        notes: '',
      },
    ],
    customer: {
      name: 'Payment Unit Customer',
      phone: '9000000001',
      address: '',
      locality: '',
      postalCode: '',
      landmark: '',
      instructions: '',
    },
    fulfillment: 'pickup',
    paymentMethod: 'upi',
    coupon: '',
    idempotencyKey: 'payment-domain-test',
  });
}
function order(source = catalog()): SharedOrder {
  return priceSharedOrder(
    request(),
    source,
    '11111111-1111-4111-8111-111111111111',
    '2026-10-23T12:00:00Z',
  );
}

test('server-priced Razorpay orders retain initiated state and match the authoritative catalog mode', () => {
  assert.equal(order().paymentMode, 'razorpay_test');
  const live = order(catalog('production'));
  assert.equal(live.paymentMode, 'razorpay_live');
  assert.equal(live.paymentStatus, 'initiated');
  const source = catalog('production');
  const cash = priceSharedOrder(
    { ...request(), paymentMethod: 'cash' },
    source,
    'cash-order',
    '2026-10-23T12:00:00Z',
  );
  assert.equal(cash.paymentStatus, 'pending');
  assert.equal(cash.paymentMode, undefined);
  assert.throws(() => parseCreateOrderRequest({ ...request(), paymentStatus: 'paid' }));
  assert.throws(() => parseCreateOrderRequest({ ...request(), paymentMode: 'razorpay_live' }));
});

test('crossed or disabled provider modes cannot create production online payments or silently simulate', () => {
  const prod = catalog('production');
  for (const payments of [
    undefined,
    { provider: 'razorpay' as const, enabled: false, mode: 'live' as const },
    { provider: 'razorpay' as const, enabled: true, mode: 'test' as const },
  ])
    assert.throws(() => order({ ...prod, payments, allowSimulatedPayments: true }), /unavailable/);
  assert.throws(
    () => order({ ...catalog(), payments: { provider: 'razorpay', enabled: true, mode: 'live' } }),
    /unavailable/,
  );
  const demo = order({ ...catalog(), payments: undefined });
  assert.equal(demo.paymentMode, 'simulation');
  assert.equal(changeSimulatedPayment(demo, 'success', false).paymentStatus, 'simulated_paid');
});

test('rounded bills below ₹1 fail before creating an unpayable receipt for any payment method', () => {
  const source = catalog();
  const product = source.products.find((item) => item.id === request().items[0].productId)!;
  product.price = 49;
  assert.throws(() => order(source), /at least ₹1/);
  assert.throws(
    () =>
      priceSharedOrder(
        { ...request(), paymentMethod: 'cash' },
        source,
        'cash',
        '2026-10-23T12:00:00Z',
      ),
    /at least ₹1/,
  );
});

test('new website cash and gateway orders use the marked nearest payable amount', () => {
  for (const mode of ['development', 'production'] as const) {
    const source = catalog(mode);
    const product = source.products.find((item) => item.id === request().items[0].productId)!;
    product.price = 22050;
    for (const paymentMethod of ['cash', 'upi'] as const) {
      const receipt = priceSharedOrder(
        { ...request(), paymentMethod },
        source,
        `nearest-${mode}-${paymentMethod}`,
        '2026-11-03T12:00:00Z',
      );
      assert.equal(receipt.subtotal, 22050);
      assert.equal(receipt.total, 22100);
      assert.equal(receipt.roundOff, 50);
      assert.equal(receipt.roundOffPolicy, 'nearest_rupee');
      assert.equal(receipt.paymentStatus, paymentMethod === 'cash' ? 'pending' : 'initiated');
    }
  }
});

test('fulfillment requires verified captured state, rejects demo flags on provider orders and preserves terminal cancellation', () => {
  for (const mode of ['development', 'production'] as const) {
    const unpaid = order(catalog(mode));
    assert.throws(() => changeOrderStatus(unpaid, 'confirmed'), /payment/);
    assert.throws(
      () => changeOrderStatus({ ...unpaid, paymentStatus: 'simulated_paid' }, 'confirmed'),
      /payment/,
    );
    const captured = { ...unpaid, paymentStatus: 'paid' as const };
    assert.equal(isOnlinePaymentComplete(captured), true);
    assert.equal(changeOrderStatus(captured, 'confirmed').status, 'confirmed');
    assert.throws(
      () => changeOrderStatus({ ...captured, paymentReviewRequired: true }, 'confirmed'),
      /payment/,
    );
    for (const status of ['cancelled', 'rejected'] as const)
      assert.throws(() => changeOrderStatus({ ...captured, status }, 'confirmed'), /not allowed/);
    for (const value of [unpaid, captured])
      assert.throws(() => changeSimulatedPayment(value, 'success', true), /Provider payments/);
  }
  assert.equal(
    isOnlinePaymentComplete({
      paymentMethod: 'upi',
      paymentStatus: 'paid',
      paymentMode: 'simulation',
    }),
    false,
  );
});

test('real revenue excludes test captures, simulations, review cases and unfulfilled/cancelled orders', () => {
  const completed = {
    ...order(catalog('production')),
    status: 'picked_up' as const,
    paymentStatus: 'paid' as const,
  };
  assert.equal(isRevenueEligible(completed), true);
  assert.equal(isSimulatedRevenueEligible(completed), false);
  const testCapture = { ...completed, paymentMode: 'razorpay_test' as const };
  assert.equal(isRevenueEligible(testCapture), false);
  assert.equal(isSimulatedRevenueEligible(testCapture), true);
  const simulated = {
    ...completed,
    paymentMode: 'simulation' as const,
    paymentStatus: 'simulated_paid' as const,
  };
  assert.equal(isRevenueEligible(simulated), false);
  assert.equal(isSimulatedRevenueEligible(simulated), true);
  for (const extra of [
    { status: 'pending' as const },
    { status: 'cancelled' as const },
    { status: 'rejected' as const },
    { paymentStatus: 'initiated' as const },
    { paymentReviewRequired: true },
  ]) {
    assert.equal(isRevenueEligible({ ...completed, ...extra }), false);
    assert.equal(isSimulatedRevenueEligible({ ...testCapture, ...extra }), false);
  }
  assert.equal(isRevenueEligible({ ...completed, paymentMethod: 'cash' }), false);
});
