import assert from 'node:assert/strict';
import test from 'node:test';
import { initialBranches, initialCategories, initialProducts, initialSettings } from '../lib/data';
import { branchSchema, settingsSchema, validateCheckout } from '../lib/validation';
import { mutateCatalog, type CommerceCatalog } from '../lib/commerce/domain';
import { parseCounterOrderRequest, priceCounterOrder } from '../lib/counter';
import { useDemoStore } from '../lib/store';
import type { BillingProfile, Branch, CheckoutInput, RestaurantSettings } from '../types';

const billing: BillingProfile = {
  businessName: 'HOT PIZZA ACE',
  address: 'ME346 Barra2 Kanpur 208027',
  gstin: '09ANCPV1491R1Z3',
  fssaiNumber: '12721045000614',
  stateName: 'Uttar Pradesh',
  stateCode: '09',
  sac: '996331',
  cgstRate: 2.5,
  sgstRate: 2.5,
};
function pausedSettings(): RestaurantSettings {
  return {
    ...structuredClone(initialSettings),
    billing: structuredClone(billing),
    acceptingOrders: false,
    temporarilyClosed: false,
    counterAcceptingOrders: false,
    deliveryEnabled: false,
    pickupEnabled: false,
    servicePostalCodes: [],
    paymentMethods: [],
  };
}
function catalog(settings = pausedSettings()): CommerceCatalog {
  return {
    products: structuredClone(initialProducts),
    categories: structuredClone(initialCategories),
    branches: [{ ...structuredClone(initialBranches[0]), settings }],
    revision: 7,
    mode: 'production',
    allowSimulatedPayments: false,
    payments: { provider: 'razorpay', mode: 'live', enabled: false },
  };
}
function resetStore(settings: RestaurantSettings) {
  useDemoStore.setState({
    settings: structuredClone(settings),
    branches: [{ ...structuredClone(initialBranches[0]), settings: structuredClone(settings) }],
    selectedBranchId: 'barra',
    adminBranchId: 'barra',
    products: structuredClone(initialProducts),
    categories: structuredClone(initialCategories),
    cart: [],
    coupon: '',
    orders: [],
    idempotencyKeys: {},
    persistenceError: null,
  });
}

test('paused website settings allow zero website payment methods independently of counter availability', () => {
  for (const counterAcceptingOrders of [true, false, undefined]) {
    for (const temporarilyClosed of [true, false]) {
      const settings = { ...pausedSettings(), counterAcceptingOrders, temporarilyClosed };
      assert.equal(settingsSchema.safeParse(settings).success, true);
      assert.equal(branchSchema.safeParse({ ...initialBranches[0], settings }).success, true);
    }
  }
  for (const paymentMethods of [['bank'], ['cash', 'upi', 'card', 'cash'], null])
    assert.equal(settingsSchema.safeParse({ ...pausedSettings(), paymentMethods }).success, false);
});

test('website acceptance always requires a payment method, even when counter is open or temporarily closed', () => {
  for (const counterAcceptingOrders of [true, false, undefined]) {
    for (const temporarilyClosed of [true, false]) {
      const parsed = settingsSchema.safeParse({
        ...pausedSettings(),
        acceptingOrders: true,
        pickupEnabled: true,
        counterAcceptingOrders,
        temporarilyClosed,
      });
      assert.equal(parsed.success, false);
      if (!parsed.success)
        assert.equal(
          parsed.error.issues.some((issue) => issue.path[0] === 'paymentMethods'),
          true,
        );
    }
  }
});

test('shared counter-only settings save preserves all website and gateway gates and enables manual counter pricing', () => {
  const source = catalog();
  const before = structuredClone(source);
  const next = mutateCatalog(source, 'updateSettings', [
    { ...source.branches[0].settings, counterAcceptingOrders: true },
    { branchId: 'barra', settings: source.branches[0].settings },
  ]);
  assert.deepEqual(source, before);
  assert.equal(next.revision, 8);
  const settings = next.branches[0].settings;
  assert.equal(settings.acceptingOrders, false);
  assert.deepEqual(settings.paymentMethods, []);
  assert.equal(settings.deliveryEnabled, false);
  assert.equal(settings.pickupEnabled, false);
  assert.equal(settings.counterAcceptingOrders, true);
  assert.equal(next.allowSimulatedPayments, false);
  assert.deepEqual(next.payments, before.payments);
  assert.deepEqual(settings.billing, billing);
  const product = next.products.find((item) => item.slug === 'french-fries')!;
  const order = priceCounterOrder(
    parseCounterOrderRequest({
      branchId: 'barra',
      items: [{ id: 'line-fries', productId: product.id, quantity: 1, toppingIds: [], notes: '' }],
      coupon: '',
      expectedRevision: next.revision,
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
      payment: { method: 'cash', confirmedReceived: true, cashTendered: 10_000 },
    }),
    next,
    '33333333-3333-4333-8333-333333333333',
    '2026-10-26T05:00:00.000Z',
    '11111111-1111-4111-8111-111111111111',
  );
  assert.equal(order.status, 'confirmed');
  assert.equal(order.paymentMode, 'counter_manual');
  assert.equal(order.paymentStatus, 'paid');
  assert.equal(order.deliveryFee, 0);
  for (const fulfillment of ['delivery', 'pickup'] as const) {
    for (const paymentMethod of ['cash', 'upi', 'card'] as const) {
      const input: CheckoutInput = {
        customer: {
          name: 'Test Customer',
          phone: '9876543210',
          address: 'ME346 Barra2 Kanpur',
          locality: 'Barra',
          postalCode: '208027',
          landmark: '',
          instructions: '',
        },
        fulfillment,
        paymentMethod,
        paymentStatus: paymentMethod === 'cash' ? 'pending' : 'initiated',
        idempotencyKey: 'paused-checkout-attempt',
        branchId: 'barra',
      };
      assert.throws(
        () => validateCheckout(input, settings, 30_000, 30_000),
        /not accepting orders/,
      );
    }
  }
});

test('shared branch and payment-switch edits accept no methods only while website acceptance stays off', () => {
  const source = catalog({
    ...pausedSettings(),
    paymentMethods: ['cash'],
    counterAcceptingOrders: true,
  });
  const disabled = mutateCatalog(source, 'setPaymentMethodEnabled', ['cash', false, 'barra']);
  assert.deepEqual(disabled.branches[0].settings.paymentMethods, []);
  assert.equal(disabled.branches[0].settings.acceptingOrders, false);
  assert.equal(disabled.branches[0].settings.counterAcceptingOrders, true);
  assert.deepEqual(
    mutateCatalog(source, 'updatePaymentMethods', {
      branchId: 'barra',
      paymentMethods: [],
    }).branches[0].settings.paymentMethods,
    [],
  );
  const savedBranch = mutateCatalog(disabled, 'saveBranch', [
    {
      ...disabled.branches[0],
      name: 'Updated counter branch',
    },
  ]);
  assert.equal(savedBranch.branches[0].name, 'Updated counter branch');
  assert.deepEqual(savedBranch.branches[0].settings.paymentMethods, []);
  assert.throws(
    () =>
      mutateCatalog(disabled, 'updateSettings', [
        { ...disabled.branches[0].settings, acceptingOrders: true, pickupEnabled: true },
        { branchId: 'barra', settings: disabled.branches[0].settings },
      ]),
    /payment method/,
  );
  const active = catalog({
    ...pausedSettings(),
    acceptingOrders: true,
    pickupEnabled: true,
    paymentMethods: ['cash'],
  });
  assert.throws(
    () => mutateCatalog(active, 'setPaymentMethodEnabled', ['cash', false, 'barra']),
    /payment method/,
  );
});

test('local payment switches and counter-only saves follow the same paused-website rule', () => {
  resetStore({ ...pausedSettings(), paymentMethods: ['cash'] });
  useDemoStore.getState().setPaymentMethodEnabled('cash', false, 'barra');
  assert.deepEqual(useDemoStore.getState().settings.paymentMethods, []);
  const saved = useDemoStore.getState();
  saved.updateSettings(
    { ...saved.settings, counterAcceptingOrders: true },
    {
      branchId: 'barra',
      settings: saved.settings,
    },
  );
  assert.equal(useDemoStore.getState().settings.counterAcceptingOrders, true);
  assert.equal(useDemoStore.getState().settings.acceptingOrders, false);
  assert.deepEqual(useDemoStore.getState().settings.paymentMethods, []);
  const branch: Branch = useDemoStore.getState().branches[0];
  assert.deepEqual(branch.settings, useDemoStore.getState().settings);
  resetStore({
    ...pausedSettings(),
    acceptingOrders: true,
    pickupEnabled: true,
    paymentMethods: ['cash'],
  });
  assert.throws(
    () => useDemoStore.getState().setPaymentMethodEnabled('cash', false, 'barra'),
    /payment method/,
  );
  assert.deepEqual(useDemoStore.getState().settings.paymentMethods, ['cash']);
});
