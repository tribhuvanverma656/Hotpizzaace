import test from 'node:test';
import assert from 'node:assert/strict';
import { initialBranches, initialCategories, initialProducts } from '../lib/data';
import {
  changeOrderStatus,
  cancelUnpaidOrder,
  changeSimulatedPayment,
  canAccessSharedOrder,
  mutateCatalog,
  parseCreateOrderRequest,
  priceSharedOrder,
  type CommerceCatalog,
} from '../lib/commerce/domain';
import { isCommerceEnabled } from '../lib/commerce/config';

function catalog(): CommerceCatalog {
  const branches = structuredClone(initialBranches);
  branches[0].settings = {
    ...branches[0].settings,
    acceptingOrders: true,
    temporarilyClosed: false,
    deliveryEnabled: true,
    pickupEnabled: true,
    paymentMethods: ['cash', 'upi', 'card'],
  };
  return {
    products: structuredClone(initialProducts),
    categories: structuredClone(initialCategories),
    branches,
    revision: 1,
  };
}
function input() {
  const product = initialProducts.find((item) => item.slug === 'french-fries')!;
  return {
    branchId: 'barra',
    items: [{ id: 'cart-fries', productId: product.id, quantity: 2, toppingIds: [], notes: '' }],
    customer: {
      name: 'Shared Order Test',
      phone: '9876543210',
      address: '123 Test Street, Barra',
      locality: 'Barra',
      postalCode: '208027',
      landmark: '',
      instructions: '',
    },
    fulfillment: 'delivery' as const,
    paymentMethod: 'cash' as const,
    coupon: '',
    idempotencyKey: 'shared-test-checkout',
  };
}
function order(source = catalog()) {
  return priceSharedOrder(
    parseCreateOrderRequest(input()),
    source,
    '8c4a1b0d-4018-493f-9bae-76fda61c2ab9',
    '2026-10-19T10:00:00.000Z',
  );
}

test('order authorization isolates identities, shared browsers and tracking-only capabilities', () => {
  const guest = { user_id: null, guest_session_hash: 'guest-a', tracking_token_hash: 'token-a' };
  const signedIn = { ...guest, user_id: 'customer-a' };
  const viewer = { userId: null, admin: false, guestHash: 'guest-b' };
  assert.equal(canAccessSharedOrder(guest, viewer, true), false);
  assert.equal(canAccessSharedOrder(guest, { ...viewer, guestHash: 'guest-a' }, false), true);
  assert.equal(
    canAccessSharedOrder(guest, { ...viewer, userId: 'customer-b', guestHash: 'guest-a' }, false),
    false,
  );
  assert.equal(canAccessSharedOrder(signedIn, { ...viewer, guestHash: 'guest-a' }, true), false);
  assert.equal(
    canAccessSharedOrder(signedIn, { ...viewer, userId: 'customer-b', guestHash: 'guest-a' }, true),
    false,
  );
  assert.equal(canAccessSharedOrder(signedIn, { ...viewer, userId: 'customer-a' }, false), true);
  assert.equal(canAccessSharedOrder(signedIn, { ...viewer, accessHash: 'token-a' }, true), true);
  assert.equal(canAccessSharedOrder(signedIn, { ...viewer, accessHash: 'token-a' }, false), false);
  assert.equal(canAccessSharedOrder(signedIn, { ...viewer, admin: true }, false), true);
});

test('shared mode enables only through the explicit server configuration', () => {
  for (const COMMERCE_ENABLED of [undefined, '', 'false', 'TRUE', '1'])
    assert.equal(isCommerceEnabled({ COMMERCE_ENABLED }), false);
  assert.equal(isCommerceEnabled({ COMMERCE_ENABLED: 'true' }), true);
});
test('untrusted checkout cannot inject prices, user ownership, status or paid flags', () => {
  for (const [field, value] of Object.entries({
    total: 1,
    roundOff: 1,
    roundOffPolicy: 'nearest_rupee',
    userId: 'victim',
    paymentStatus: 'simulated_paid',
    status: 'delivered',
    guestSession: 'victim',
  }))
    assert.throws(() => parseCreateOrderRequest({ ...input(), [field]: value }));
  assert.throws(() =>
    parseCreateOrderRequest({ ...input(), items: [{ ...input().items[0], unitPrice: 1 }] }),
  );
});
test('malformed, duplicate and oversized cart lines are rejected', () => {
  assert.throws(() => parseCreateOrderRequest({ ...input(), items: [] }));
  assert.throws(() =>
    parseCreateOrderRequest({ ...input(), items: [input().items[0], input().items[0]] }),
  );
  for (const quantity of [0, -1, 1.5, 21, '2', Number.NaN])
    assert.throws(() =>
      parseCreateOrderRequest({ ...input(), items: [{ ...input().items[0], quantity }] }),
    );
  assert.throws(() =>
    parseCreateOrderRequest({
      ...input(),
      items: [{ ...input().items[0], notes: 'a'.repeat(301) }],
    }),
  );
  assert.throws(() =>
    parseCreateOrderRequest({
      ...input(),
      items: Array.from({ length: 51 }, (_, index) => ({
        ...input().items[0],
        id: `line-${index}`,
      })),
    }),
  );
});
test('server recomputes food, delivery, coupon and immutable product snapshots', () => {
  const source = catalog();
  const product = source.products.find((candidate) => candidate.id === input().items[0].productId)!;
  product.price = 8500;
  source.branches[0].settings.minimumOrder = 19900;
  const result = order(source);
  assert.equal(result.subtotal, 17000);
  assert.equal(result.deliveryFee, 4900);
  assert.equal(result.total, 21900);
  assert.equal(result.items[0].unitPrice, 8500);
  assert.equal(result.paymentStatus, 'pending');
  assert.equal(result.status, 'pending');
  assert.equal(result.version, 1);
  product.name = 'Changed after receipt';
  assert.notEqual(result.items[0].name, product.name);
});
test('fresh checkout enforces current COD, kitchen, branch, delivery PIN and archived menu policy', () => {
  const changes = [
    (source: CommerceCatalog) => {
      source.branches[0].settings.paymentMethods = ['upi'];
    },
    (source: CommerceCatalog) => {
      source.branches[0].settings.acceptingOrders = false;
    },
    (source: CommerceCatalog) => {
      source.branches[0].settings.temporarilyClosed = true;
    },
    (source: CommerceCatalog) => {
      source.branches[0].settings.servicePostalCodes = ['208001'];
    },
    (source: CommerceCatalog) => {
      source.branches[0].settings.deliveryEnabled = false;
    },
    (source: CommerceCatalog) => {
      source.products.find((item) => item.id === input().items[0].productId)!.archived = true;
    },
    (source: CommerceCatalog) => {
      source.categories.find(
        (item) =>
          item.id ===
          source.products.find((item) => item.id === input().items[0].productId)!.categoryId,
      )!.archived = true;
    },
  ];
  for (const change of changes) {
    const source = catalog();
    change(source);
    assert.throws(() => order(source));
  }
  assert.throws(() =>
    priceSharedOrder(
      parseCreateOrderRequest({ ...input(), branchId: 'missing' }),
      catalog(),
      'id',
      new Date().toISOString(),
    ),
  );
});
test('pickup skips delivery address and minimum; delivery total uses current fee and coupons', () => {
  const source = catalog();
  source.branches[0].settings.minimumOrder = 999_900;
  const request = {
    ...input(),
    fulfillment: 'pickup',
    customer: { ...input().customer, address: '', locality: '', postalCode: '' },
  };
  const result = priceSharedOrder(
    parseCreateOrderRequest(request),
    source,
    'id',
    new Date().toISOString(),
  );
  assert.equal(result.deliveryFee, 0);
  assert.equal(result.total, result.subtotal);
  assert.throws(() => order(source), /minimum/);
});
test('old coupon code fails after owner renames it and current code uses authoritative limits', () => {
  const source = catalog();
  source.branches[0].settings = {
    ...source.branches[0].settings,
    couponCode: 'NEW10',
    couponPercent: 10,
    couponMinimum: 0,
    couponMaximum: 10000,
    minimumOrder: 0,
  };
  const request = { ...input(), coupon: 'OLD10' };
  assert.throws(
    () =>
      priceSharedOrder(parseCreateOrderRequest(request), source, 'id', new Date().toISOString()),
    /coupon/,
  );
  const result = priceSharedOrder(
    parseCreateOrderRequest({ ...request, coupon: ' new10 ' }),
    source,
    'id',
    new Date().toISOString(),
  );
  assert.equal(result.discount, Math.round(result.subtotal / 10));
  assert.equal(result.coupon, 'NEW10');
});
test('online orders require simulated payment before kitchen confirmation and cannot skip statuses', () => {
  const cash = order();
  const unpaid = { ...cash, paymentMethod: 'upi' as const, paymentStatus: 'initiated' as const };
  assert.throws(() => changeOrderStatus(unpaid, 'confirmed'), /payment/);
  assert.equal(changeOrderStatus(unpaid, 'cancelled').status, 'cancelled');
  const paid = changeSimulatedPayment(unpaid, 'success', false);
  assert.equal(paid.paymentStatus, 'simulated_paid');
  assert.equal(paid.paymentMode, 'simulation');
  assert.equal(changeOrderStatus(paid, 'confirmed').version, paid.version + 1);
  assert.throws(() => changeOrderStatus(paid, 'delivered'));
  assert.throws(() =>
    changeOrderStatus({ ...cash, status: 'ready', fulfillment: 'pickup' }, 'out_for_delivery'),
  );
});
test('demo payment cannot downgrade or revive an order; tracking alone does not grant cash privileges', () => {
  const cash = order();
  assert.throws(() => changeSimulatedPayment(cash, 'success', true), /administrator/);
  assert.throws(
    () => changeSimulatedPayment({ ...cash, status: 'delivered' }, 'cash_collected', false),
    /administrator/,
  );
  assert.throws(() => changeSimulatedPayment(cash, 'cash_collected', true), /handed over/);
  const collected = changeSimulatedPayment(
    { ...cash, status: 'delivered' },
    'cash_collected',
    true,
  );
  assert.equal(collected.paymentStatus, 'simulated_paid');
  assert.equal(changeSimulatedPayment(collected, 'cash_collected', true), collected);
  const online = {
    ...cash,
    paymentMethod: 'card' as const,
    paymentStatus: 'simulated_paid' as const,
  };
  assert.throws(() => changeSimulatedPayment(online, 'failed', true), /completed/);
  assert.throws(
    () => changeSimulatedPayment({ ...online, status: 'cancelled' }, 'success', false),
    /cancelled/,
  );
});
test('catalog mutations support positional admin calls without mutating the previous revision', () => {
  const source = catalog();
  const changed = mutateCatalog(source, 'setPaymentMethodEnabled', ['cash', false, 'barra']);
  assert.equal(changed.revision, 2);
  assert.equal(changed.branches[0].settings.paymentMethods.includes('cash'), false);
  assert.equal(source.branches[0].settings.paymentMethods.includes('cash'), true);
  const updated = mutateCatalog(changed, 'updateSettings', [
    { ...changed.branches[0].settings, deliveryFee: 9900 },
    { branchId: 'barra', settings: changed.branches[0].settings },
  ]);
  assert.equal(updated.branches[0].settings.deliveryFee, 9900);
  assert.equal(updated.branches[0].settings.paymentMethods.includes('cash'), false);
});
test('catalog rules protect linked categories, unique slugs, first-size prices and final payment method', () => {
  const source = catalog();
  const product = source.products[0];
  assert.throws(
    () => mutateCatalog(source, 'archiveCategory', [product.categoryId]),
    /products first/,
  );
  assert.throws(
    () => mutateCatalog(source, 'saveCategory', [{ ...source.categories[0], id: 'other' }]),
    /slug/,
  );
  const onlyCash = mutateCatalog(source, 'updatePaymentMethods', {
    branchId: 'barra',
    paymentMethods: ['cash'],
  });
  assert.throws(() => mutateCatalog(onlyCash, 'setPaymentMethodEnabled', ['cash', false, 'barra']));
  const sized = source.products.find((candidate) => candidate.sizes.length)!;
  const changed = mutateCatalog(source, 'saveProduct', [{ ...sized, price: sized.price + 100 }]);
  assert.equal(
    changed.products.find((candidate) => candidate.id === sized.id)!.sizes[0].price,
    sized.price + 100,
  );
});
test('archiving, restoring and permanently deleting an empty category preserves linked receipt semantics', () => {
  let source = catalog();
  const empty = { id: 'new-category', name: 'New Category', slug: 'new-category', sortOrder: 99 };
  source = mutateCatalog(source, 'saveCategory', [empty]);
  assert.throws(() => mutateCatalog(source, 'deleteCategory', [empty.id]), /Archive/);
  source = mutateCatalog(source, 'archiveCategory', [empty.id]);
  source = mutateCatalog(source, 'restoreCategory', [empty.id]);
  assert.equal(source.categories.find((category) => category.id === empty.id)!.archived, false);
  source = mutateCatalog(source, 'archiveCategory', [empty.id]);
  source = mutateCatalog(source, 'deleteCategory', [empty.id]);
  assert.equal(
    source.categories.some((category) => category.id === empty.id),
    false,
  );
  assert.throws(() => mutateCatalog(source, 'unsupported', {}));
});

test('customers can cancel unpaid pending orders without changing payment or billing', () => {
  for (const paymentStatus of ['initiated', 'pending', 'failed'] as const) {
    const pending = {
      ...order(),
      paymentMethod: 'upi' as const,
      paymentStatus,
      paymentMode: 'razorpay_live' as const,
    };
    const cancelled = cancelUnpaidOrder(pending);
    assert.deepEqual(cancelled, { ...pending, status: 'cancelled', version: pending.version + 1 });
    assert.equal(pending.status, 'pending');
  }
});

test('customer cancellation rejects settled, accepted, counter and review/refund orders', () => {
  const pending = { ...order(), paymentMethod: 'upi' as const, paymentStatus: 'pending' as const };
  const blocked = [
    ...(['paid', 'simulated_paid'] as const).map((paymentStatus) => ({
      ...pending,
      paymentStatus,
    })),
    ...(
      [
        'confirmed',
        'preparing',
        'ready',
        'out_for_delivery',
        'delivered',
        'picked_up',
        'cancelled',
        'rejected',
      ] as const
    ).map((status) => ({ ...pending, status })),
    { ...pending, channel: 'counter' as const },
    { ...pending, paymentMethod: 'cash' as const },
    { ...pending, paymentReviewRequired: true },
    { ...pending, refundSyncPending: true },
  ];
  for (const candidate of blocked) assert.throws(() => cancelUnpaidOrder(candidate), /Only unpaid/);
});
