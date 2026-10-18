import test from 'node:test';
import assert from 'node:assert/strict';
import { initialBranches, initialProducts, initialSettings } from '../lib/data';
import { initialOrders } from '../lib/legacy-demo-data';
import { getCartTotals, getMinimumOrderShortfall } from '../lib/pricing';
import { migrateDemoState, STORE_VERSION } from '../lib/persistence';
import { settingsSchema, validateCheckout } from '../lib/validation';
import { useDemoStore } from '../lib/store';
import type { CartItem, CheckoutInput, Fulfillment, RestaurantSettings } from '../types';

const settings: RestaurantSettings = {
  ...initialSettings,
  deliveryFee: 4900,
  freeDeliveryThreshold: 25000,
};
const product = {
  ...initialProducts.find((product) => product.slug === 'french-fries')!,
  price: 24900,
};
const item: CartItem = {
  id: 'delivery-test',
  productId: product.id,
  quantity: 1,
  toppingIds: [],
  notes: '',
};
const input: CheckoutInput = {
  customer: {
    name: 'Test Customer',
    phone: '9876543210',
    address: '123 Test Street, Barra',
    locality: 'Barra',
    postalCode: '208027',
    landmark: '',
    instructions: '',
  },
  fulfillment: 'delivery',
  paymentMethod: 'cash',
  paymentStatus: 'pending',
  idempotencyKey: 'delivery-test-checkout',
};
const totals = (
  subtotal: number,
  configuration = settings,
  fulfillment: Fulfillment = 'delivery',
  coupon = '',
) => getCartTotals([item], [{ ...product, price: subtotal }], configuration, coupon, fulfillment);

test('pickup has no minimum and delivery minimum uses the payable total including fee and discounts', () => {
  const pickup: CheckoutInput = {
    ...input,
    fulfillment: 'pickup',
    customer: { ...input.customer, address: '', locality: '', postalCode: '', landmark: '' },
    idempotencyKey: 'small-pickup-checkout',
  };
  assert.equal(
    validateCheckout(pickup, { ...settings, minimumOrder: 999900 }, 5000).fulfillment,
    'pickup',
  );
  assert.equal(validateCheckout(input, settings, 17000).fulfillment, 'delivery');
  assert.equal(getMinimumOrderShortfall(totals(17000).total, settings, 'delivery'), 0);
  assert.equal(validateCheckout(input, settings, 15000).fulfillment, 'delivery');
  assert.throws(() => validateCheckout(input, settings, 14999), /Add ₹0.01 more/);
  assert.throws(() => validateCheckout(input, settings, 17000, 19899), /after discounts/);
  assert.equal(validateCheckout(input, settings, 17000, 19900).fulfillment, 'delivery');
  assert.equal(validateCheckout(input, settings, 19900).fulfillment, 'delivery');
  useDemoStore.setState({
    products: [{ ...product, price: 5000 }],
    settings,
    branches: [{ ...initialBranches[0], settings }],
    selectedBranchId: 'barra',
    adminBranchId: 'barra',
    cartBranchId: 'barra',
    orders: structuredClone(initialOrders),
    cart: [item],
    coupon: '',
    idempotencyKeys: {},
  });
  const order = useDemoStore.getState().createOrder(pickup);
  assert.equal(order.subtotal, 5000);
  assert.equal(order.deliveryFee, 0);
  assert.equal(order.total, 5000);
  assert.equal(order.customer.address, '');
  useDemoStore.getState().saveProduct({ ...product, price: 17000 });
  useDemoStore.getState().addToCart(item);
  const delivery = useDemoStore
    .getState()
    .createOrder({ ...input, idempotencyKey: 'delivery-total-219' });
  assert.equal(delivery.subtotal, 17000);
  assert.equal(delivery.deliveryFee, 4900);
  assert.equal(delivery.total, 21900);
  useDemoStore
    .getState()
    .updateSettings({
      ...settings,
      couponCode: 'LESS',
      couponPercent: 50,
      couponMinimum: 0,
      couponMaximum: 100000,
    });
  useDemoStore.getState().addToCart(item);
  useDemoStore.getState().applyCoupon('LESS');
  assert.throws(
    () => useDemoStore.getState().createOrder({ ...input, idempotencyKey: 'discounted-under-min' }),
    /minimum order total/,
  );
});

test('delivery is charged below the threshold and free at or above it', () => {
  assert.equal(totals(24999).deliveryFee, 4900);
  assert.equal(totals(25000).deliveryFee, 0);
  assert.equal(totals(25001).deliveryFee, 0);
  assert.equal(totals(24999).total, 29899);
  assert.equal(getCartTotals([], [], settings).deliveryFee, 0);
  assert.equal(totals(10000, settings, 'pickup').deliveryFee, 0);
});

test('threshold uses food subtotal before coupons and supports configurable or disabled rules', () => {
  const discounted = totals(
    25000,
    {
      ...settings,
      couponCode: 'TEST20',
      couponPercent: 20,
      couponMinimum: 0,
      couponMaximum: 100000,
    },
    'delivery',
    'TEST20',
  );
  assert.equal(discounted.discount, 5000);
  assert.equal(discounted.deliveryFee, 0);
  assert.equal(discounted.total, 20000);
  assert.equal(totals(30000, { ...settings, freeDeliveryThreshold: 40000 }).deliveryFee, 4900);
  assert.equal(totals(100000, { ...settings, freeDeliveryThreshold: null }).deliveryFee, 4900);
  assert.equal(totals(100, { ...settings, freeDeliveryThreshold: 0 }).deliveryFee, 0);
  assert.equal(totals(100, { ...settings, deliveryFee: 0 }).deliveryFee, 0);
  assert.throws(() => totals(25000, { ...settings, freeDeliveryThreshold: -1 }), /non-negative/);
  for (const value of [-1, 1.5, NaN, Infinity])
    assert.equal(
      settingsSchema.safeParse({ ...settings, freeDeliveryThreshold: value }).success,
      false,
    );
  assert.ok(settingsSchema.safeParse({ ...settings, freeDeliveryThreshold: null }).success);
});

test('delivery settings migration applies confirmed rules and preserves catalog, cart, sessions and receipts', () => {
  const oldSettings = { ...settings, deliveryFee: 0 };
  Reflect.deleteProperty(oldSettings, 'freeDeliveryThreshold');
  const state = {
    settings: oldSettings,
    products: [product],
    orders: initialOrders,
    cart: [item],
    adminSession: true,
    customerSession: { phone: '9876543210' },
  };
  const migrated = migrateDemoState(state, 4);
  assert.equal(migrated.settings?.freeDeliveryThreshold, 25000);
  assert.equal(migrated.settings?.deliveryFee, 4900);
  assert.strictEqual(migrated.products, state.products);
  assert.strictEqual(migrated.orders, state.orders);
  assert.strictEqual(migrated.cart, state.cart);
  assert.strictEqual(migrated.customerSession, state.customerSession);
  const inProgress = migrateDemoState({ settings: { ...settings, deliveryFee: 0 } }, 5);
  assert.equal(inProgress.settings?.deliveryFee, 4900);
  const edited = {
    ...migrated,
    settings: { ...settings, deliveryFee: 3000, freeDeliveryThreshold: 40000 },
  };
  assert.strictEqual(migrateDemoState(edited, STORE_VERSION), edited);
});

test('checkout reprices delivery using latest admin rules and preserves previous receipt totals', () => {
  useDemoStore.setState({
    products: [product],
    settings,
    orders: structuredClone(initialOrders),
    cart: [item],
    coupon: '',
    idempotencyKeys: {},
  });
  const first = useDemoStore.getState().createOrder(input);
  assert.equal(first.deliveryFee, 4900);
  assert.equal(first.total, 29800);
  useDemoStore
    .getState()
    .updateSettings({ ...settings, freeDeliveryThreshold: 20000, deliveryFee: 5000 });
  useDemoStore.getState().addToCart({ ...item, quantity: 1 });
  const second = useDemoStore
    .getState()
    .createOrder({ ...input, idempotencyKey: 'delivery-test-new-rule' });
  assert.equal(second.deliveryFee, 0);
  assert.equal(second.total, 24900);
  assert.equal(
    useDemoStore.getState().orders.find((order) => order.id === first.id)?.deliveryFee,
    4900,
  );
});

test('admin can disable COD while leaving other methods and existing cash orders intact', () => {
  const noCash = {
    ...settings,
    paymentMethods: ['upi', 'card'] as RestaurantSettings['paymentMethods'],
  };
  assert.throws(() => validateCheckout(input, noCash, 24900), /payment method/);
  assert.equal(
    validateCheckout({ ...input, paymentMethod: 'upi', paymentStatus: 'initiated' }, noCash, 24900)
      .paymentMethod,
    'upi',
  );
  assert.throws(
    () => validateCheckout({ ...input, fulfillment: 'pickup' }, noCash, 24900),
    /payment method/,
  );
  assert.equal(settingsSchema.safeParse({ ...settings, paymentMethods: [] }).success, false);
  useDemoStore.setState({ settings, orders: structuredClone(initialOrders) });
  const before = structuredClone(useDemoStore.getState().orders);
  useDemoStore.getState().updateSettings(noCash);
  assert.equal(useDemoStore.getState().settings.paymentMethods.includes('cash'), false);
  assert.deepEqual(useDemoStore.getState().orders, before);
});

test('kitchen switches block new checkout when paused or closed and reopen without changing existing orders', () => {
  for (const acceptingOrders of [true, false]) {
    for (const temporarilyClosed of [true, false]) {
      const kitchen = { ...settings, acceptingOrders, temporarilyClosed };
      assert.ok(settingsSchema.safeParse(kitchen).success);
      for (const fulfillment of ['delivery', 'pickup'] as const) {
        if (acceptingOrders && !temporarilyClosed)
          assert.equal(
            validateCheckout({ ...input, fulfillment }, kitchen, 24900).fulfillment,
            fulfillment,
          );
        else
          assert.throws(
            () => validateCheckout({ ...input, fulfillment }, kitchen, 24900),
            /not accepting orders/,
          );
      }
    }
  }
  useDemoStore.setState({
    products: [product],
    settings,
    orders: structuredClone(initialOrders),
    cart: [item],
    coupon: '',
    idempotencyKeys: {},
  });
  const originalOrders = structuredClone(useDemoStore.getState().orders);
  useDemoStore.getState().updateSettings({ ...settings, acceptingOrders: false });
  assert.throws(() => useDemoStore.getState().createOrder(input), /not accepting orders/);
  assert.deepEqual(useDemoStore.getState().orders, originalOrders);
  assert.equal(useDemoStore.getState().cart.length, 1);
  const existing = useDemoStore.getState().orders.find((order) => order.status === 'preparing')!;
  useDemoStore.getState().updateOrderStatus(existing.id, 'ready');
  assert.equal(
    useDemoStore.getState().orders.find((order) => order.id === existing.id)?.status,
    'ready',
  );
  useDemoStore
    .getState()
    .updateSettings({ ...settings, acceptingOrders: true, temporarilyClosed: false });
  assert.equal(
    useDemoStore.getState().createOrder({ ...input, idempotencyKey: 'kitchen-reopened-checkout' })
      .status,
    'pending',
  );
});
