import assert from 'node:assert/strict';
import test from 'node:test';
import { initialBranches, initialCategories, initialProducts } from '../lib/data';
import {
  changeCounterStatus,
  CounterError,
  counterKitchenEligible,
  isCounterPaymentComplete,
  parseCounterOrderRequest,
  parseCounterSettlementRequest,
  parseCounterStatusRequest,
  priceCounterOrder,
  settleCounterOrder,
} from '../lib/counter';
import {
  parseCreateOrderRequest,
  type CommerceCatalog,
  type SharedOrder,
} from '../lib/commerce/domain';
import {
  getAllowedOrderStatuses,
  isRevenueEligible,
  isSimulatedRevenueEligible,
} from '../lib/pricing';
import { kitchenOrders } from '../lib/kitchen';
import type { BillingProfile } from '../types';
const actor = '11111111-1111-4111-8111-111111111111';
const key = '22222222-2222-4222-8222-222222222222';
const now = '2026-10-24T05:00:00.000Z';
const profile: BillingProfile = {
  businessName: 'HOT PIZZA ACE',
  address: 'ME346, Barra2, Kanpur 208027',
  gstin: '09ANCPV1491R1Z3',
  fssaiNumber: '12721045000614',
  stateName: 'Uttar Pradesh',
  stateCode: '09',
  sac: '996331',
  cgstRate: 2.5,
  sgstRate: 2.5,
};
function catalog(mode: 'development' | 'production' = 'production'): CommerceCatalog {
  const branches = structuredClone(initialBranches);
  branches[0].settings = {
    ...branches[0].settings,
    billing: structuredClone(profile),
    counterAcceptingOrders: true,
    temporarilyClosed: false,
    acceptingOrders: false,
    paymentMethods: [],
    minimumOrder: 999999,
    deliveryFee: 99999,
  };
  const product = {
    ...structuredClone(initialProducts[0]),
    price: 10000,
    sizes: [],
    crusts: [],
    toppings: [],
    available: true,
    archived: false,
  };
  return {
    products: [product],
    categories: structuredClone(initialCategories),
    branches,
    revision: 7,
    mode,
    allowSimulatedPayments: mode === 'development',
  };
}
function rawRequest(source = catalog()) {
  return {
    branchId: 'barra',
    items: [
      {
        id: 'counter-line',
        productId: source.products[0].id,
        quantity: 2,
        toppingIds: [],
        notes: 'Less spicy',
      },
    ],
    tableLabel: 'A1',
    coupon: '',
    expectedRevision: source.revision,
    idempotencyKey: key,
    payment: { method: 'cash', confirmedReceived: true, cashTendered: 30000 },
  };
}
function create(extra: Record<string, unknown> = {}, source = catalog()): SharedOrder {
  return priceCounterOrder(
    parseCounterOrderRequest({ ...rawRequest(source), ...extra }),
    source,
    '33333333-3333-4333-8333-333333333333',
    now,
    actor,
  );
}
function expectCode(fn: () => unknown, code: string) {
  assert.throws(fn, (cause: unknown) => cause instanceof CounterError && cause.code === code);
}

function deliveryCatalog() {
  const source = catalog();
  Object.assign(source.branches[0].settings, {
    deliveryEnabled: true,
    deliveryFee: 4900,
    freeDeliveryThreshold: 25000,
    minimumOrder: 19900,
    servicePostalCodes: ['208027'],
  });
  return source;
}
const deliveryDetails = {
  fulfillment: 'delivery',
  customerName: 'Delivery Customer',
  customerPhone: '9876543210',
  deliveryAddress: {
    address: 'ME 346 Near Ram Janki Mandir',
    locality: 'Barra 2',
    postalCode: '208027',
    landmark: 'Near the temple',
    instructions: 'Call on arrival',
  },
};

test('staff Home delivery snapshots contact/address and applies branch fees, tax and minimum while website payments stay paused', () => {
  const source = deliveryCatalog();
  const order = create(deliveryDetails, source);
  assert.equal(order.fulfillment, 'delivery');
  assert.equal(order.channel, 'counter');
  assert.equal(order.paymentMode, 'counter_manual');
  assert.equal(order.paymentStatus, 'paid');
  assert.equal(order.subtotal, 20000);
  assert.equal(order.deliveryFee, 4900);
  assert.equal(order.tax?.cgst, 623);
  assert.equal(order.tax?.sgst, 623);
  assert.equal(order.total, 26100);
  assert.equal(order.customer.phone, deliveryDetails.customerPhone);
  assert.equal(order.customer.address, deliveryDetails.deliveryAddress.address);
  assert.equal(order.customer.locality, 'Barra 2');
  assert.equal(order.customer.postalCode, '208027');
  assert.equal(order.customer.instructions, 'Call on arrival');
  assert.equal(order.counter?.tableLabel, '');
  assert.equal(source.branches[0].settings.acceptingOrders, false);
  assert.deepEqual(source.branches[0].settings.paymentMethods, []);
  assert.equal(isCounterPaymentComplete(order), true);
  assert.deepEqual(
    kitchenOrders([order], 'barra').map((item) => item.id),
    [order.id],
  );
  source.branches[0].settings.deliveryFee = 99900;
  assert.equal(order.deliveryFee, 4900);
  const free = deliveryCatalog();
  const freeOrder = create(
    {
      ...deliveryDetails,
      items: [{ ...rawRequest(free).items[0], quantity: 3 }],
      payment: { method: 'cash', confirmedReceived: true, cashTendered: 40000 },
    },
    free,
  );
  assert.equal(freeOrder.deliveryFee, 0);
  assert.equal(freeOrder.total, 31500);
  const boundary = deliveryCatalog();
  boundary.branches[0].settings.minimumOrder = 26100;
  assert.equal(create(deliveryDetails, boundary).total, 26100);
  boundary.branches[0].settings.minimumOrder++;
  expectCode(() => create(deliveryDetails, boundary), 'delivery_minimum');
});

test('Home delivery requires contact and a complete serviceable address and never ignores closed branch or fee rules', () => {
  const source = deliveryCatalog();
  for (const extra of [
    { customerName: '' },
    { customerName: 'A' },
    { customerPhone: '' },
    { customerPhone: '1234567890' },
    { deliveryAddress: undefined },
    ...[
      { address: 'Short' },
      { locality: '' },
      { postalCode: '20802' },
      { address: 'a'.repeat(201) },
      { landmark: 'a'.repeat(121) },
      { instructions: 'a'.repeat(301) },
    ].map((fields) => ({ deliveryAddress: { ...deliveryDetails.deliveryAddress, ...fields } })),
  ])
    assert.throws(() => create({ ...deliveryDetails, ...extra }, source), CounterError);
  expectCode(
    () =>
      create(
        {
          ...deliveryDetails,
          deliveryAddress: { ...deliveryDetails.deliveryAddress, postalCode: '208001' },
        },
        source,
      ),
    'delivery_area_unavailable',
  );
  source.branches[0].settings.deliveryEnabled = false;
  expectCode(() => create(deliveryDetails, source), 'delivery_unavailable');
  source.branches[0].settings.deliveryEnabled = true;
  source.branches[0].settings.temporarilyClosed = true;
  expectCode(() => create(deliveryDetails, source), 'counter_closed');
  assert.throws(() => create({ deliveryAddress: deliveryDetails.deliveryAddress }), CounterError);
});

test('Home delivery uses dispatch and delivery completion, while pay-later cannot leave the restaurant unpaid', () => {
  const source = deliveryCatalog();
  let order = create(
    {
      ...deliveryDetails,
      payment: null,
      payLaterReason: 'Owner approved preparation before payment',
    },
    source,
  );
  assert.equal(counterKitchenEligible(order), true);
  order = changeCounterStatus(changeCounterStatus(order, 'preparing'), 'ready');
  expectCode(() => changeCounterStatus(order, 'served'), 'invalid_status_transition');
  expectCode(() => changeCounterStatus(order, 'out_for_delivery'), 'payment_not_complete');
  expectCode(() => changeCounterStatus(order, 'delivered'), 'invalid_status_transition');
  order = settleCounterOrder(
    order,
    { method: 'upi', confirmedReceived: true, upiReference: 'QA1234567890' },
    actor,
    '2026-10-24T06:00:00Z',
  );
  const frozen = structuredClone({
    total: order.total,
    tax: order.tax,
    customer: order.customer,
    settlement: order.settlement,
  });
  order = changeCounterStatus(order, 'out_for_delivery', '2026-10-24T06:05:00Z');
  assert.equal(order.completedAt, undefined);
  order = changeCounterStatus(order, 'delivered', '2026-10-24T06:20:00Z');
  assert.equal(order.completedAt, '2026-10-24T06:20:00Z');
  assert.equal(order.counter?.servedAt, undefined);
  assert.equal(order.counter?.closedAt, undefined);
  assert.deepEqual(
    { total: order.total, tax: order.tax, customer: order.customer, settlement: order.settlement },
    frozen,
  );
  expectCode(() => changeCounterStatus(order, 'closed'), 'invalid_status_transition');
  for (const status of ['out_for_delivery', 'delivered'])
    assert.equal(parseCounterStatusRequest({ expectedVersion: 1, status }).status, status);
  const dineIn = create();
  expectCode(
    () =>
      changeCounterStatus(
        changeCounterStatus(changeCounterStatus(dineIn, 'preparing'), 'ready'),
        'out_for_delivery',
      ),
    'invalid_status_transition',
  );
});

test('removed no-money software tests cannot return to Kitchen, collect payment or earn revenue', () => {
  const original = create();
  const removed = {
    ...original,
    testVoid: {
      kind: 'no_money_software_test' as const,
      recordedAt: now,
      reason: 'User confirmed software test; no money received.',
    },
  };
  // Defensive handling even if a stale client carries the original active status.
  assert.equal(counterKitchenEligible(removed), false);
  assert.deepEqual(kitchenOrders([removed], 'barra'), []);
  assert.equal(isCounterPaymentComplete(removed), false);
  assert.deepEqual(getAllowedOrderStatuses(removed), []);
  assert.equal(isRevenueEligible({ ...removed, status: 'served' }), false);
  assert.equal(
    isSimulatedRevenueEligible({ ...removed, status: 'served', environment: 'development' }),
    false,
  );
  expectCode(() => changeCounterStatus(removed, 'preparing'), 'order_removed');
  expectCode(
    () =>
      settleCounterOrder(
        removed,
        { method: 'cash', confirmedReceived: true, cashTendered: 30000 },
        actor,
        now,
      ),
    'order_removed',
  );
  assert.deepEqual(removed.settlement, original.settlement);
  assert.equal(removed.total, original.total);
});

test('counter reprices base menu plus CGST/SGST, has no delivery/minimum and authors branch/staff/environment snapshots', () => {
  const order = create();
  assert.equal(order.subtotal, 20000);
  assert.equal(order.deliveryFee, 0);
  assert.equal(order.tax?.cgst, 500);
  assert.equal(order.tax?.sgst, 500);
  assert.equal(order.total, 21000);
  assert.equal(order.paymentMode, 'counter_manual');
  assert.equal(order.environment, 'production');
  assert.equal(order.branchId, 'barra');
  assert.equal(order.counter?.createdBy, actor);
  assert.equal(order.counter?.tableLabel, 'A1');
  assert.equal(order.customer.name, 'Walk-in customer');
  assert.equal(order.customer.phone, '');
  assert.equal(order.customer.address, '');
  assert.equal(order.paymentStatus, 'paid');
  assert.equal(order.status, 'confirmed');
  assert.equal(order.settlement?.cashTendered, 30000);
  assert.equal(order.settlement?.change, 9000);
  assert.equal(order.settlement?.amount, order.total);
  assert.equal(order.settlement?.confirmedAt, now);
  assert.equal(order.settlement?.confirmedBy, actor);
  assert.equal(isCounterPaymentComplete(order), true);
});

test('counter default-off, kitchen closure, missing billing, unknown environment and stale revision fail closed', () => {
  for (const settings of [
    { counterAcceptingOrders: false },
    { counterAcceptingOrders: undefined },
    { temporarilyClosed: true },
  ]) {
    const source = catalog();
    source.branches[0].settings = { ...source.branches[0].settings, ...settings };
    expectCode(() => create({}, source), 'counter_closed');
  }
  const missingBilling = catalog();
  delete missingBilling.branches[0].settings.billing;
  expectCode(() => create({}, missingBilling), 'billing_required');
  expectCode(() => create({ expectedRevision: 6 }), 'revision_conflict');
  expectCode(() => create({}, { ...catalog(), mode: undefined }), 'counter_unavailable');
  assert.equal(create().status, 'confirmed'); // Website ordering/COD being off does not close the counter.
});

test('counter request rejects client-set money/paid/staff/environment fields and validates merchant receipt input', () => {
  for (const extra of [
    { total: 1 },
    { discount: 9999 },
    { paymentStatus: 'paid' },
    { createdBy: actor },
    { environment: 'production' },
    { channel: 'counter' },
    { fulfillment: 'pickup' },
  ])
    assert.throws(() => parseCounterOrderRequest({ ...rawRequest(), ...extra }));
  for (const payment of [
    { method: 'cash', confirmedReceived: false, cashTendered: 30000 },
    { method: 'upi', confirmedReceived: true, upiReference: 'short' },
    { method: 'card', confirmedReceived: true },
  ])
    assert.throws(() => parseCounterOrderRequest({ ...rawRequest(), payment }));
  assert.throws(
    () => create({ payment: { method: 'cash', confirmedReceived: true, cashTendered: 100 } }),
    /less than/,
  );
  const upi = create({
    payment: { method: 'upi', confirmedReceived: true, upiReference: ' abc123456789 ' },
  });
  assert.equal(upi.paymentMethod, 'upi');
  assert.equal(upi.settlement?.upiReference, 'ABC123456789');
  assert.equal(upi.settlement?.source, 'staff');
  assert.equal(isCounterPaymentComplete(upi), true);
});

test('ordinary website create-order parser rejects dine-in and manual settlements even with a valid customer session payload', () => {
  const counter = rawRequest();
  const customer = {
    name: 'Fictional website user',
    phone: '9000000001',
    address: '',
    locality: '',
    postalCode: '',
    landmark: '',
    instructions: '',
  };
  const website = {
    branchId: 'barra',
    items: counter.items,
    customer,
    fulfillment: 'pickup',
    paymentMethod: 'cash',
    coupon: '',
    idempotencyKey: key,
  };
  assert.doesNotThrow(() => parseCreateOrderRequest(website));
  for (const extra of [
    { fulfillment: 'dine_in' },
    { channel: 'counter' },
    { paymentMode: 'counter_manual' },
    { settlement: { source: 'staff' } },
    { counter: { payLater: true } },
    { paymentStatus: 'paid' },
  ])
    assert.throws(() => parseCreateOrderRequest({ ...website, ...extra }));
});

test('pay-later is an explicit exceptional authorization and does not imply paid or closed', () => {
  assert.throws(() => create({ payment: null }), /reason/);
  assert.throws(() => create({ payLaterReason: 'Will pay later' }), /Choose payment/);
  const unpaid = create({ payment: null, payLaterReason: 'Owner approved payment after meal' });
  assert.equal(unpaid.paymentStatus, 'pending');
  assert.equal(unpaid.settlement, undefined);
  assert.equal(unpaid.counter?.payLater, true);
  assert.equal(counterKitchenEligible(unpaid), true);
  assert.equal(
    counterKitchenEligible({ ...unpaid, counter: { ...unpaid.counter!, payLater: false } }),
    false,
  );
  assert.equal(
    counterKitchenEligible({ ...unpaid, counter: { ...unpaid.counter!, payLaterReason: '' } }),
    false,
  );
});

test('counter kitchen queue filters the branch and admits only accepted paid or explicitly deferred active tickets', () => {
  const paid = create();
  const deferred = {
    ...create({ payment: null, payLaterReason: 'Pay after meal' }),
    id: 'deferred',
    createdAt: '2026-10-24T04:00:00Z',
  };
  const others = [
    { ...paid, id: 'wrong-branch', branchId: 'other' },
    { ...paid, id: 'ready', status: 'ready' as const },
    { ...paid, id: 'cancelled', status: 'cancelled' as const },
    { ...paid, id: 'review', paymentReviewRequired: true },
    {
      ...paid,
      id: 'missing-cash-proof',
      settlement: { ...paid.settlement!, cashTendered: undefined },
    },
  ];
  assert.deepEqual(
    kitchenOrders([paid, deferred, ...others], 'barra').map((order) => order.id),
    ['deferred', paid.id],
  );
});

test('counter fulfillment preserves frozen amounts, increments versions and closes only after service and payment', () => {
  let order = create();
  const originalTotal = order.total;
  expectCode(() => changeCounterStatus(order, 'served'), 'invalid_status_transition');
  expectCode(() => changeCounterStatus(order, 'cancelled'), 'refund_required');
  for (const [index, status] of (['preparing', 'ready', 'served', 'closed'] as const).entries()) {
    order = changeCounterStatus(order, status, `2026-10-24T0${6 + index}:00:00.000Z`);
    assert.equal(order.version, index + 2);
    assert.equal(order.total, originalTotal);
    assert.equal(order.tax?.total, 1000);
    assert.equal(order.status, status);
  }
  assert.equal(order.completedAt, '2026-10-24T08:00:00.000Z');
  assert.equal(order.counter?.servedAt, order.completedAt);
  assert.equal(order.counter?.closedAt, '2026-10-24T09:00:00.000Z');
  expectCode(() => changeCounterStatus(order, 'preparing'), 'invalid_status_transition');
});

test('a served pay-later bill can be settled once, retains its service time and then closes', () => {
  let order = create({ payment: null, payLaterReason: 'Owner approved' });
  order = changeCounterStatus(
    changeCounterStatus(changeCounterStatus(order, 'preparing'), 'ready'),
    'served',
    '2026-10-24T06:00:00.000Z',
  );
  expectCode(() => changeCounterStatus(order, 'closed'), 'payment_not_complete');
  const received = settleCounterOrder(
    order,
    { method: 'upi', confirmedReceived: true, upiReference: 'ABC123456789' },
    actor,
    '2026-10-24T07:00:00.000Z',
  );
  assert.equal(received.status, 'served');
  assert.equal(received.completedAt, '2026-10-24T06:00:00.000Z');
  assert.equal(received.settlement?.confirmedAt, '2026-10-24T07:00:00.000Z');
  assert.equal(received.version, order.version + 1);
  assert.equal(changeCounterStatus(received, 'closed').status, 'closed');
  expectCode(
    () =>
      settleCounterOrder(
        received,
        { method: 'cash', confirmedReceived: true, cashTendered: 30000 },
        actor,
        now,
      ),
    'payment_already_complete',
  );
  const cancelled = changeCounterStatus(
    create({ payment: null, payLaterReason: 'Owner approved' }),
    'cancelled',
  );
  expectCode(
    () =>
      settleCounterOrder(
        cancelled,
        { method: 'cash', confirmedReceived: true, cashTendered: 30000 },
        actor,
        now,
      ),
    'order_not_payable',
  );
});

test('counter mutation parsers require a positive expected version and reject client settlement amounts', () => {
  const body = {
    expectedVersion: 1,
    idempotencyKey: key,
    payment: { method: 'cash', confirmedReceived: true, cashTendered: 30000 },
  };
  assert.doesNotThrow(() => parseCounterSettlementRequest(body));
  for (const extra of [
    { expectedVersion: 0 },
    { idempotencyKey: 'bad' },
    { amount: 1 },
    { payment: { ...body.payment, amount: 1 } },
  ])
    assert.throws(() => parseCounterSettlementRequest({ ...body, ...extra }));
  assert.doesNotThrow(() => parseCounterStatusRequest({ expectedVersion: 1, status: 'served' }));
  assert.throws(() => parseCounterStatusRequest({ expectedVersion: 0, status: 'served' }));
  assert.throws(() => parseCounterStatusRequest({ expectedVersion: 1, status: 'picked_up' }));
});

test('valid counter cash/direct UPI completed sales count only in the server-authored environment', () => {
  const paid = { ...create(), status: 'served' as const };
  assert.equal(isRevenueEligible(paid), true);
  assert.equal(isSimulatedRevenueEligible(paid), false);
  const development = { ...paid, environment: 'development' as const };
  assert.equal(isRevenueEligible(development), false);
  assert.equal(isSimulatedRevenueEligible(development), true);
  const upi = {
    ...create({
      payment: { method: 'upi', confirmedReceived: true, upiReference: 'ABC123456789' },
    }),
    status: 'closed' as const,
  };
  assert.equal(isRevenueEligible(upi), true);
  for (const changed of [
    { ...paid, status: 'ready' as const },
    { ...paid, status: 'cancelled' as const },
    { ...paid, paymentStatus: 'pending' as const },
    { ...paid, paymentReviewRequired: true },
    { ...paid, environment: undefined },
    { ...paid, settlement: undefined },
    { ...paid, settlement: { ...paid.settlement!, change: 999 } },
    { ...upi, settlement: { ...upi.settlement!, upiReference: 'bad' } },
  ]) {
    assert.equal(isRevenueEligible(changed), false);
    assert.equal(isSimulatedRevenueEligible(changed), false);
  }
});

test('counter configured coupons reduce taxable food and bill snapshots survive catalog edits', () => {
  const source = catalog();
  source.branches[0].settings = {
    ...source.branches[0].settings,
    couponCode: 'COUNTER10',
    couponPercent: 10,
    couponMinimum: 0,
    couponMaximum: 99999,
  };
  const order = create({ coupon: 'counter10' }, source);
  assert.equal(order.discount, 2000);
  assert.equal(order.tax?.taxableValue, 18000);
  assert.equal(order.tax?.cgst, 450);
  assert.equal(order.total, 18900);
  source.products[0].price = 99999;
  source.branches[0].settings.billing!.businessName = 'Changed branch';
  assert.equal(order.items[0].unitPrice, 10000);
  assert.equal(order.tax?.supplier.businessName, 'HOT PIZZA ACE');
});

test('new counter cash, direct UPI and later collection use the frozen nearest payable total', () => {
  const source = catalog();
  source.products[0].price = 21000;
  const items = [{ ...rawRequest(source).items[0], quantity: 1 }];
  const paid = create(
    { items, payment: { method: 'cash', confirmedReceived: true, cashTendered: 25000 } },
    source,
  );
  assert.equal(paid.total, 22100);
  assert.equal(paid.roundOff, 50);
  assert.equal(paid.roundOffPolicy, 'nearest_rupee');
  assert.equal(paid.tax?.total, 1050);
  assert.equal(paid.settlement?.amount, 22100);
  assert.equal(paid.settlement?.change, 2900);
  const upi = create(
    { items, payment: { method: 'upi', confirmedReceived: true, upiReference: 'ABC123456789' } },
    source,
  );
  assert.equal(upi.settlement?.amount, 22100);
  const later = create({ items, payment: null, payLaterReason: 'Owner approved' }, source);
  const saved = structuredClone(later);
  source.products[0].price = 99900;
  const received = settleCounterOrder(
    later,
    { method: 'cash', confirmedReceived: true, cashTendered: 25000 },
    actor,
    now,
  );
  assert.equal(received.total, 22100);
  assert.equal(received.settlement?.amount, 22100);
  assert.equal(received.settlement?.change, 2900);
  assert.equal(received.roundOffPolicy, 'nearest_rupee');
  assert.deepEqual(received.tax, saved.tax);
  assert.deepEqual(later, saved);
});

test('staff-confirmed UPI without a reference remains complete and counts as revenue', () => {
  const paid = create({ payment: { method: 'upi', confirmedReceived: true } });
  assert.equal(paid.settlement?.upiReference, undefined);
  assert.equal(isCounterPaymentComplete(paid), true);
  assert.equal(isRevenueEligible({ ...paid, status: 'served' }), true);
  assert.throws(() =>
    parseCounterOrderRequest({
      ...rawRequest(),
      payment: { method: 'upi', confirmedReceived: false },
    }),
  );
});
