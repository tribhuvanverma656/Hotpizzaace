import test from 'node:test';
import assert from 'node:assert/strict';
import { initialProducts, initialSettings, initialOrders } from '../lib/data';
import { getCartTotals, isCouponActive, validateCoupon } from '../lib/pricing';
import { settingsSchema } from '../lib/validation';
import { attachDemoStoreSync, useDemoStore } from '../lib/store';
import { STORE_VERSION } from '../lib/persistence';
import type { CartItem, CheckoutInput, RestaurantSettings } from '../types';

const product = {
  ...initialProducts.find((product) => product.slug === 'french-fries')!,
  price: 50000,
};
const cart: CartItem[] = [
  { id: 'coupon-cart', productId: product.id, toppingIds: [], quantity: 1, notes: '' },
];
const settings: RestaurantSettings = {
  ...initialSettings,
  couponCode: 'ACE20',
  couponPercent: 20,
  couponMinimum: 50000,
  couponMaximum: 7500,
};
const input: CheckoutInput = {
  customer: {
    name: 'Coupon Tester',
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
  idempotencyKey: 'coupon-checkout-first',
};
function reset() {
  useDemoStore.setState({
    products: [structuredClone(product)],
    settings: structuredClone(settings),
    orders: structuredClone(initialOrders),
    cart: structuredClone(cart),
    coupon: '',
    idempotencyKeys: {},
    customerSession: null,
  });
}

test('coupons normalize case and whitespace, enforce minimum, cap, and never discount delivery', () => {
  assert.equal(validateCoupon('  ace20 ', settings, 50000), 'ACE20');
  assert.throws(() => validateCoupon('ACE20', settings, 49999), /Add ₹0.01 more/);
  const capped = getCartTotals(cart, [product], settings, 'ACE20');
  assert.equal(capped.discount, 7500);
  assert.equal(capped.total, 42500);
  const freeOrder = getCartTotals(
    cart,
    [product],
    { ...settings, couponPercent: 100, couponMaximum: 100000, freeDeliveryThreshold: null },
    'ACE20',
  );
  assert.equal(freeOrder.discount, 50000);
  assert.equal(freeOrder.total, 4900);
});

test('renaming the admin coupon removes the applied old code, accepts the new code, and snapshots receipts', () => {
  reset();
  useDemoStore.getState().applyCoupon('ace20');
  const oldOrder = useDemoStore.getState().createOrder(input);
  assert.equal(oldOrder.coupon, 'ACE20');
  assert.equal(oldOrder.discount, 7500);
  useDemoStore.getState().addToCart(cart[0]);
  useDemoStore.getState().applyCoupon('ACE20');
  useDemoStore
    .getState()
    .updateSettings({ ...settings, couponCode: 'new15', couponPercent: 15, couponMaximum: 10000 });
  assert.equal(useDemoStore.getState().settings.couponCode, 'NEW15');
  assert.equal(useDemoStore.getState().coupon, '');
  assert.throws(
    () => useDemoStore.getState().applyCoupon('ACE20'),
    (error) =>
      error instanceof Error &&
      error.message.includes('NEW15') &&
      !error.message.includes('demo code ACE20'),
  );
  useDemoStore.getState().applyCoupon(' new15 ');
  const next = useDemoStore
    .getState()
    .createOrder({ ...input, idempotencyKey: 'coupon-checkout-renamed' });
  assert.equal(next.coupon, 'NEW15');
  assert.equal(next.discount, 7500);
  assert.equal(
    useDemoStore.getState().orders.find((order) => order.id === oldOrder.id)?.coupon,
    'ACE20',
  );
  assert.equal(
    useDemoStore.getState().orders.find((order) => order.id === oldOrder.id)?.discount,
    7500,
  );
});

test('disabling a coupon by code, percentage or cap hides and rejects the offer and removes applied code', () => {
  for (const disabled of [{ couponCode: '' }, { couponPercent: 0 }, { couponMaximum: 0 }]) {
    reset();
    useDemoStore.getState().applyCoupon('ACE20');
    const updated = { ...settings, ...disabled };
    useDemoStore.getState().updateSettings(updated);
    assert.equal(isCouponActive(updated), false);
    assert.equal(useDemoStore.getState().coupon, '');
    assert.throws(() => useDemoStore.getState().applyCoupon('ACE20'), /No coupon offer/);
    assert.equal(getCartTotals(cart, [product], updated, 'ACE20').discount, 0);
  }
});

test('minimum, percentage and cap edits reprice cart, clear lost eligibility and reject stale checkout', () => {
  reset();
  useDemoStore.getState().applyCoupon('ACE20');
  useDemoStore.getState().updateSettings({ ...settings, couponPercent: 10, couponMaximum: 2000 });
  assert.equal(
    getCartTotals(cart, [product], useDemoStore.getState().settings, useDemoStore.getState().coupon)
      .discount,
    2000,
  );
  useDemoStore.getState().updateSettings({ ...settings, couponMinimum: 60000 });
  assert.equal(useDemoStore.getState().coupon, '');
  useDemoStore.setState({ coupon: 'ACE20' });
  assert.throws(() => useDemoStore.getState().createOrder(input), /Add ₹100 more/);
  assert.equal(useDemoStore.getState().cart.length, 1);
});

test('quantity, product price and deletion changes revalidate the coupon against the current cart', () => {
  reset();
  useDemoStore.getState().updateQuantity(cart[0].id, 2);
  useDemoStore.getState().updateSettings({ ...settings, couponMinimum: 75000 });
  useDemoStore.getState().applyCoupon('ACE20');
  useDemoStore.getState().updateQuantity(cart[0].id, 1);
  assert.equal(useDemoStore.getState().coupon, '');
  reset();
  useDemoStore.getState().applyCoupon('ACE20');
  useDemoStore.getState().saveProduct({ ...product, price: 40000 });
  assert.equal(useDemoStore.getState().coupon, '');
  reset();
  useDemoStore.getState().applyCoupon('ACE20');
  useDemoStore.getState().archiveProduct(product.id);
  assert.equal(useDemoStore.getState().coupon, '');
});

test('coupon codes and values use shared settings validation', () => {
  for (const code of ['AB', 'NOT VALID', '!', 'X'.repeat(21)])
    assert.equal(settingsSchema.safeParse({ ...settings, couponCode: code }).success, false);
  assert.equal(
    settingsSchema.parse({ ...settings, couponCode: ' fresh10 ' }).couponCode,
    'FRESH10',
  );
  for (const couponPercent of [-1, 101, NaN, Infinity])
    assert.equal(settingsSchema.safeParse({ ...settings, couponPercent }).success, false);
  for (const value of [-1, 0.5, NaN, Infinity])
    assert.equal(settingsSchema.safeParse({ ...settings, couponMinimum: value }).success, false);
});

test('cross-tab settings changes replace stale applied codes without storage feedback writes', async () => {
  reset();
  useDemoStore.getState().applyCoupon('ACE20');
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const saved = {
    ...useDemoStore.getState(),
    settings: { ...settings, couponCode: 'NEW15' },
    coupon: 'ACE20',
  };
  const serialized = JSON.stringify({ state: saved, version: STORE_VERSION });
  let writes = 0;
  let handler: ((event: StorageEvent) => void) | undefined;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: () => serialized,
        setItem: () => {
          writes++;
        },
        removeItem: () => {},
      },
      addEventListener: (_type: string, callback: (event: StorageEvent) => void) => {
        handler = callback;
      },
      removeEventListener: () => {
        handler = undefined;
      },
    },
  });
  try {
    const cleanup = attachDemoStoreSync();
    handler?.({ key: 'hot-pizza-ace-demo-v1', newValue: serialized } as StorageEvent);
    await Promise.resolve();
    assert.equal(useDemoStore.getState().settings.couponCode, 'NEW15');
    assert.equal(useDemoStore.getState().coupon, '');
    assert.equal(writes, 0);
    cleanup();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
