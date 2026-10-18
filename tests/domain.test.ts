import test from 'node:test';
import assert from 'node:assert/strict';
import type { CartItem, CartSelection, CheckoutInput, Order } from '../types';
import {
  initialCategories,
  initialOrders,
  initialProducts,
  initialSettings,
} from '../lib/legacy-demo-data';
import {
  getAllowedOrderStatuses,
  getCartTotals,
  getUnitPrice,
  isRevenueEligible,
  validateSelection,
} from '../lib/pricing';
import { STORE_VERSION } from '../lib/persistence';
import { attachDemoStoreSync, useDemoStore } from '../lib/store';
import { validateCheckout } from '../lib/validation';

const pizza = initialProducts.find((product) => product.id === 'margherita')!;
const selection: CartSelection = {
  productId: pizza.id,
  sizeId: 'regular',
  crustId: 'classic',
  toppingIds: [],
  quantity: 1,
  notes: '',
};
const input: CheckoutInput = {
  customer: {
    name: 'Test Customer',
    phone: '9876543210',
    address: '12, Church Street, Apartment 2',
    locality: 'Church Street',
    postalCode: '560001',
    landmark: '',
    instructions: '',
  },
  fulfillment: 'delivery',
  paymentMethod: 'upi',
  paymentStatus: 'simulated_paid',
  idempotencyKey: 'test-checkout-123456',
};

function reset() {
  useDemoStore.setState({
    products: structuredClone(initialProducts),
    categories: structuredClone(initialCategories),
    orders: structuredClone(initialOrders),
    settings: structuredClone(initialSettings),
    cart: [],
    coupon: '',
    idempotencyKeys: {},
    adminSession: false,
    persistenceError: null,
  });
}

test('sizes replace the base price; crust and extras add integer paise', () => {
  assert.equal(getUnitPrice(pizza, selection), 24900);
  assert.equal(
    getUnitPrice(pizza, {
      ...selection,
      sizeId: 'medium',
      crustId: 'cheese-burst',
      toppingIds: ['extra-cheese', 'olives'],
    }),
    55400,
  );
  const item: CartItem = { ...selection, id: 'cart-a', quantity: 2 };
  assert.deepEqual(getCartTotals([item], initialProducts, initialSettings), {
    subtotal: 49800,
    deliveryFee: 4900,
    discount: 0,
    total: 54700,
  });
  assert.equal(getCartTotals([item], initialProducts, initialSettings, '', 'pickup').total, 49800);
});

test('forged options, duplicate extras, unavailable products and invalid quantities fail', () => {
  assert.throws(() => getUnitPrice(pizza, { ...selection, sizeId: 'free-pizza' }), /valid size/);
  assert.throws(
    () => getUnitPrice(pizza, { ...selection, toppingIds: ['not-in-menu'] }),
    /no longer available/,
  );
  assert.throws(
    () => getUnitPrice(pizza, { ...selection, toppingIds: ['extra-cheese', 'extra-cheese'] }),
    /only once/,
  );
  assert.throws(() => validateSelection(pizza, { ...selection, quantity: 1.5 }), /quantity/);
  assert.throws(() => validateSelection(pizza, { ...selection, quantity: 21 }), /quantity/);
  assert.throws(() => validateSelection({ ...pizza, available: false }, selection), /unavailable/);
  assert.throws(
    () => getUnitPrice(pizza, { ...selection, productId: 'farmhouse' }),
    /no longer exists/,
  );
});

test('coupons respect minimum subtotal and their configured cap', () => {
  const largeCart: CartItem[] = [{ ...selection, id: 'cart-a', quantity: 20 }];
  const totals = getCartTotals(largeCart, initialProducts, initialSettings, ' ace20 ');
  assert.equal(totals.discount, 20000);
  assert.equal(totals.total, 482900);
  assert.equal(
    getCartTotals([{ ...selection, id: 'cart-a' }], initialProducts, initialSettings, 'ACE20')
      .discount,
    0,
  );
  assert.equal(getCartTotals(largeCart, initialProducts, initialSettings, 'FORGED').discount, 0);
});

test('checkout enforces delivery area, configurable minimum and enabled methods', () => {
  assert.equal(validateCheckout(input, initialSettings, 24900).customer.name, input.customer.name);
  assert.throws(
    () =>
      validateCheckout(
        { ...input, customer: { ...input.customer, postalCode: '110001' } },
        initialSettings,
        24900,
      ),
    /outside our delivery area/,
  );
  assert.throws(
    () => validateCheckout(input, { ...initialSettings, minimumOrder: 50000 }, 24900),
    /minimum order/,
  );
  assert.throws(
    () => validateCheckout(input, { ...initialSettings, acceptingOrders: false }, 24900),
    /not accepting orders/,
  );
  assert.throws(
    () => validateCheckout(input, { ...initialSettings, paymentMethods: ['cash'] }, 24900),
    /payment method/,
  );
  assert.throws(
    () =>
      validateCheckout(
        { ...input, customer: { ...input.customer, phone: '12345' } },
        initialSettings,
        24900,
      ),
    /mobile number/,
  );
  const pickup: CheckoutInput = {
    ...input,
    fulfillment: 'pickup',
    customer: { ...input.customer, address: '', locality: '', postalCode: '' },
  };
  assert.equal(validateCheckout(pickup, initialSettings, 24900).fulfillment, 'pickup');
});

test('cart merges identical configurations independently of topping order and keeps notes distinct', () => {
  reset();
  useDemoStore.getState().addToCart({ ...selection, toppingIds: ['olives', 'extra-cheese'] });
  useDemoStore
    .getState()
    .addToCart({ ...selection, toppingIds: ['extra-cheese', 'olives'], notes: '  ' });
  assert.equal(useDemoStore.getState().cart.length, 1);
  assert.equal(useDemoStore.getState().cart[0].quantity, 2);
  useDemoStore.getState().addToCart({ ...selection, notes: 'No chilli please' });
  assert.equal(useDemoStore.getState().cart.length, 2);
});

test('checkout reprices from catalogue, preserves immutable snapshots and is idempotent', () => {
  reset();
  useDemoStore.getState().addToCart(selection);
  const order = useDemoStore.getState().createOrder(input);
  assert.equal(order.items[0].unitPrice, 24900);
  assert.equal(order.total, 29800);
  assert.equal(useDemoStore.getState().cart.length, 0);
  const orderCount = useDemoStore.getState().orders.length;
  const repeated = useDemoStore.getState().createOrder(input);
  assert.equal(repeated.id, order.id);
  assert.equal(useDemoStore.getState().orders.length, orderCount);
  useDemoStore.getState().saveProduct({
    ...pizza,
    name: 'Updated pizza',
    price: 90000,
    sizes: [{ id: 'regular', name: 'Regular', price: 90000 }],
  });
  const historical = useDemoStore.getState().orders.find((item) => item.id === order.id)!;
  assert.equal(historical.items[0].name, 'The Margherita');
  assert.equal(historical.items[0].unitPrice, 24900);
  order.customer.name = 'Mutated return value';
  assert.equal(historical.customer.name, 'Test Customer');
});

test('checkout rejects stale selections and uses latest prices', () => {
  reset();
  useDemoStore.getState().addToCart(selection);
  useDemoStore.getState().saveProduct({
    ...pizza,
    sizes: pizza.sizes.map((size) => (size.id === 'regular' ? { ...size, price: 29900 } : size)),
  });
  assert.equal(useDemoStore.getState().createOrder(input).items[0].unitPrice, 29900);
  reset();
  useDemoStore.getState().addToCart(selection);
  useDemoStore.getState().archiveProduct(pizza.id);
  assert.throws(() => useDemoStore.getState().createOrder(input), /unavailable/);
});

test('failed payment retains cart and retries the existing order without duplicating it', () => {
  reset();
  useDemoStore.getState().addToCart(selection);
  const failed = useDemoStore.getState().createOrder({ ...input, paymentStatus: 'failed' });
  assert.equal(useDemoStore.getState().cart.length, 1);
  assert.equal(isRevenueEligible(failed), false);
  useDemoStore.getState().updatePaymentStatus(failed.id, 'pending');
  useDemoStore.getState().updatePaymentStatus(failed.id, 'simulated_paid');
  assert.equal(useDemoStore.getState().cart.length, 0);
  assert.equal(useDemoStore.getState().orders.filter((order) => order.id === failed.id).length, 1);
  assert.throws(
    () => useDemoStore.getState().updatePaymentStatus(failed.id, 'failed'),
    /cannot be changed/,
  );
});

test('pickup cash orders have no delivery fee and await collection', () => {
  reset();
  useDemoStore.getState().addToCart(selection);
  const pickup = useDemoStore.getState().createOrder({
    ...input,
    fulfillment: 'pickup',
    paymentMethod: 'cash',
    paymentStatus: 'pending',
  });
  assert.equal(pickup.deliveryFee, 0);
  assert.equal(pickup.paymentStatus, 'pending');
  assert.equal(useDemoStore.getState().cart.length, 0);
  assert.equal(isRevenueEligible({ ...pickup, status: 'picked_up' }), false);
});

test('delivery and pickup orders follow their own valid fulfillment paths', () => {
  reset();
  useDemoStore.getState().addToCart(selection);
  const order = useDemoStore.getState().createOrder(input);
  assert.throws(
    () => useDemoStore.getState().updateOrderStatus(order.id, 'delivered'),
    /Cannot change/,
  );
  for (const status of [
    'confirmed',
    'preparing',
    'ready',
    'out_for_delivery',
    'delivered',
  ] as const)
    useDemoStore.getState().updateOrderStatus(order.id, status);
  assert.equal(
    isRevenueEligible(useDemoStore.getState().orders.find((item) => item.id === order.id)!),
    true,
  );
  assert.deepEqual(getAllowedOrderStatuses({ status: 'ready', fulfillment: 'pickup' }), [
    'picked_up',
    'cancelled',
  ]);
  assert.deepEqual(getAllowedOrderStatuses({ status: 'picked_up', fulfillment: 'pickup' }), []);
  assert.deepEqual(getAllowedOrderStatuses({ status: 'cancelled', fulfillment: 'delivery' }), []);
});

test('failed, unpaid and cancelled orders are excluded from completed revenue', () => {
  const complete = {
    ...initialOrders[0],
    status: 'delivered',
    paymentStatus: 'simulated_paid',
  } as Order;
  assert.equal(isRevenueEligible(complete), true);
  assert.equal(isRevenueEligible({ ...complete, paymentStatus: 'failed' }), false);
  assert.equal(isRevenueEligible({ ...complete, paymentStatus: 'pending' }), false);
  assert.equal(isRevenueEligible({ ...complete, status: 'cancelled' }), false);
  assert.equal(isRevenueEligible({ ...complete, status: 'preparing' }), false);
});

test('categories protect active products and restore archived categories without reviving products or rewriting receipts', () => {
  reset();
  assert.throws(() => useDemoStore.getState().archiveCategory('veg-pizza'), /Move or archive/);
  useDemoStore.getState().reorderCategory('non-veg-pizza', 'up');
  assert.equal(
    useDemoStore.getState().categories.find((category) => category.id === 'non-veg-pizza')
      ?.sortOrder,
    0,
  );
  const empty = { id: 'seasonal', slug: 'seasonal', name: 'Seasonal', sortOrder: 7 };
  useDemoStore.getState().saveCategory(empty);
  useDemoStore.getState().archiveCategory(empty.id);
  assert.equal(
    useDemoStore.getState().categories.find((category) => category.id === empty.id)?.archived,
    true,
  );
  useDemoStore.getState().saveCategory({ ...empty, archived: false });
  assert.deepEqual(
    useDemoStore.getState().categories.find((category) => category.id === empty.id),
    { ...empty, archived: false },
  );
  const seasonalPizza = {
    ...pizza,
    id: 'seasonal-pizza',
    slug: 'seasonal-pizza',
    name: 'Seasonal Pizza',
    categoryId: empty.id,
  };
  useDemoStore.getState().saveProduct(seasonalPizza);
  useDemoStore.getState().addToCart({ ...selection, productId: seasonalPizza.id });
  const receipt = useDemoStore.getState().createOrder({
    ...input,
    idempotencyKey: 'seasonal-category-receipt',
  });
  const receiptSnapshot = structuredClone(receipt);
  assert.throws(() => useDemoStore.getState().archiveCategory(empty.id), /Move or archive/);
  useDemoStore.getState().archiveProduct(seasonalPizza.id);
  useDemoStore.getState().archiveCategory(empty.id);
  const archived = useDemoStore.getState().categories.find((category) => category.id === empty.id)!;
  const productsBeforeRestore = useDemoStore.getState().products;
  const ordersBeforeRestore = useDemoStore.getState().orders;
  useDemoStore.getState().saveCategory({ ...archived, archived: false });
  const restored = useDemoStore.getState().categories.find((category) => category.id === empty.id)!;
  assert.deepEqual(restored, { ...empty, archived: false });
  assert.equal(
    useDemoStore.getState().categories.filter((category) => category.id === empty.id).length,
    1,
  );
  assert.strictEqual(useDemoStore.getState().products, productsBeforeRestore);
  assert.strictEqual(useDemoStore.getState().orders, ordersBeforeRestore);
  assert.equal(
    useDemoStore.getState().products.find((product) => product.id === seasonalPizza.id)?.archived,
    true,
  );
  assert.equal(
    useDemoStore.getState().products.find((product) => product.id === seasonalPizza.id)?.available,
    false,
  );
  assert.deepEqual(
    useDemoStore.getState().orders.find((order) => order.id === receipt.id),
    receiptSnapshot,
  );

  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const savedState = JSON.stringify({ state: useDemoStore.getState(), version: STORE_VERSION });
  let writes = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: () => savedState,
        setItem: () => {
          writes++;
        },
        removeItem: () => {},
      },
    },
  });
  try {
    useDemoStore.persist.rehydrate();
    assert.deepEqual(
      useDemoStore.getState().categories.find((category) => category.id === empty.id),
      restored,
    );
    assert.equal(
      useDemoStore.getState().products.find((product) => product.id === seasonalPizza.id)?.archived,
      true,
    );
    assert.deepEqual(
      useDemoStore.getState().orders.find((order) => order.id === receipt.id),
      receiptSnapshot,
    );
    assert.equal(writes, 0);
  } finally {
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('base-only and first-size-only edits keep advertised and checkout prices aligned', () => {
  reset();
  useDemoStore.getState().saveProduct({ ...pizza, price: 27900 });
  let updated = useDemoStore.getState().products.find((product) => product.id === pizza.id)!;
  assert.equal(updated.sizes[0].price, 27900);
  useDemoStore.getState().saveProduct({
    ...updated,
    sizes: updated.sizes.map((size, index) => (index === 0 ? { ...size, price: 28900 } : size)),
  });
  updated = useDemoStore.getState().products.find((product) => product.id === pizza.id)!;
  assert.equal(updated.price, 28900);
});

test('permanent category deletion rejects missing and active categories without changing state', () => {
  reset();
  const active = { id: 'empty-active', slug: 'empty-active', name: 'Empty Active', sortOrder: 8 };
  useDemoStore.getState().saveCategory(active);
  const categories = useDemoStore.getState().categories;
  assert.throws(() => useDemoStore.getState().deleteCategory('missing-category'));
  assert.throws(() => useDemoStore.getState().deleteCategory(active.id));
  assert.strictEqual(useDemoStore.getState().categories, categories);
  useDemoStore.getState().archiveCategory(active.id);
  assert.throws(
    () => useDemoStore.getState().saveCategory({ ...active, id: 'duplicate-slug' }),
    /slug/,
  );
});

test('permanent category deletion protects active and archived product references, including stale archived categories', () => {
  for (const archived of [false, true]) {
    reset();
    const category = {
      id: 'linked-category',
      slug: 'linked-category',
      name: 'Linked Category',
      archived: true,
      sortOrder: 8,
    };
    const linkedProduct = {
      ...pizza,
      id: 'linked-product',
      slug: 'linked-product',
      categoryId: category.id,
      archived,
      available: !archived,
    };
    // A stale saved state can contain a live product under an already archived category.
    useDemoStore.setState({
      categories: [...useDemoStore.getState().categories, category],
      products: [...useDemoStore.getState().products, linkedProduct],
    });
    const before = useDemoStore.getState();
    assert.throws(() => useDemoStore.getState().deleteCategory(category.id));
    assert.strictEqual(useDemoStore.getState().categories, before.categories);
    assert.strictEqual(useDemoStore.getState().products, before.products);
    assert.strictEqual(useDemoStore.getState().orders, before.orders);
  }
});

test('permanent deletion persists an unused category removal, permits slug reuse, and preserves cart and historical receipts', () => {
  reset();
  const category = {
    id: 'retired-specials',
    slug: 'retired-specials',
    name: 'Retired Specials',
    sortOrder: 8,
  };
  useDemoStore.getState().saveCategory(category);
  const special = {
    ...pizza,
    id: 'special-moving-category',
    slug: 'special-moving-category',
    name: 'Special Pizza',
    categoryId: category.id,
  };
  useDemoStore.getState().saveProduct(special);
  useDemoStore.getState().addToCart({ ...selection, productId: special.id });
  const receipt = useDemoStore
    .getState()
    .createOrder({ ...input, idempotencyKey: 'category-delete-receipt' });
  const receiptSnapshot = structuredClone(receipt);
  // Moving the product frees its old category while keeping the same product in future carts.
  useDemoStore.getState().saveProduct({ ...special, categoryId: pizza.categoryId });
  useDemoStore.getState().addToCart({ ...selection, productId: special.id });
  useDemoStore.getState().archiveCategory(category.id);
  const before = useDemoStore.getState();
  const cartSnapshot = structuredClone(before.cart);
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let stored = JSON.stringify({ state: before, version: STORE_VERSION });
  let writes = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: () => stored,
        setItem: (_name: string, value: string) => {
          stored = value;
          writes++;
        },
        removeItem: () => {},
      },
    },
  });
  try {
    useDemoStore.getState().deleteCategory(category.id);
    const after = useDemoStore.getState();
    assert.equal(
      after.categories.some((item) => item.id === category.id),
      false,
    );
    assert.equal(after.categories.length, before.categories.length - 1);
    assert.strictEqual(after.products, before.products);
    assert.strictEqual(after.orders, before.orders);
    assert.strictEqual(after.cart, before.cart);
    assert.strictEqual(after.settings, before.settings);
    assert.strictEqual(after.idempotencyKeys, before.idempotencyKeys);
    assert.equal(writes, 1);
    const persisted = JSON.parse(stored).state;
    assert.equal(
      persisted.categories.some((item: { id: string }) => item.id === category.id),
      false,
    );
    assert.deepEqual(persisted.cart, cartSnapshot);
    assert.deepEqual(
      persisted.orders.find((order: Order) => order.id === receipt.id),
      receiptSnapshot,
    );
    useDemoStore.persist.rehydrate();
    assert.equal(
      useDemoStore.getState().categories.some((item) => item.id === category.id),
      false,
    );
    assert.deepEqual(useDemoStore.getState().cart, cartSnapshot);
    assert.deepEqual(
      useDemoStore.getState().orders.find((order) => order.id === receipt.id),
      receiptSnapshot,
    );
    assert.equal(writes, 1);
    const reused = { ...category, id: 'new-specials', name: 'New Specials' };
    useDemoStore.getState().saveCategory(reused);
    assert.deepEqual(
      useDemoStore.getState().categories.find((item) => item.id === reused.id),
      reused,
    );
    assert.equal(
      useDemoStore.getState().categories.some((item) => item.id === category.id),
      false,
    );
  } finally {
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('storage quota failure is visible while cart remains usable in memory', async () => {
  reset();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error('QuotaExceededError');
        },
        removeItem: () => {},
      },
    },
  });
  try {
    useDemoStore.getState().addToCart(selection);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(useDemoStore.getState().cart.length, 1);
    assert.match(useDemoStore.getState().persistenceError ?? '', /lost on refresh/);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('cross-tab updates rehydrate without writing a storage feedback event', () => {
  reset();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const snapshot = {
    ...useDemoStore.getState(),
    orders: useDemoStore
      .getState()
      .orders.map((order, index) => (index === 0 ? { ...order, status: 'ready' } : order)),
  };
  const serialized = JSON.stringify({ state: snapshot, version: STORE_VERSION });
  let writeCount = 0;
  let handler: ((event: StorageEvent) => void) | undefined;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: () => serialized,
        setItem: () => {
          writeCount++;
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
    assert.ok(handler);
    handler({ key: 'hot-pizza-ace-demo-v1', newValue: serialized } as StorageEvent);
    assert.equal(useDemoStore.getState().orders[0].status, 'ready');
    assert.equal(useDemoStore.getState().hydrated, true);
    assert.equal(writeCount, 0);
    cleanup();
    assert.equal(handler, undefined);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
