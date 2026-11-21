import test from 'node:test';
import assert from 'node:assert/strict';
import { initialProducts, initialSettings } from '../lib/data';
import { migrateDemoState, STORE_VERSION } from '../lib/persistence';
import { attachDemoStoreSync, useDemoStore } from '../lib/store';
import { branchSchema } from '../lib/validation';
import type { Branch, CheckoutInput, Fulfillment, RestaurantSettings } from '../types';

const storageKey = 'hot-pizza-ace-demo-v1';
const noCash: RestaurantSettings['paymentMethods'] = ['upi', 'card'];
const product = {
  ...initialProducts.find((item) => item.slug === 'french-fries')!,
  price: 30000,
};
const cart = [
  { id: 'cod-cart-item', productId: product.id, quantity: 1, toppingIds: [], notes: '' },
];

function branch(
  id = 'barra',
  paymentMethods: RestaurantSettings['paymentMethods'] = ['upi', 'card', 'cash'],
): Branch {
  return {
    id,
    slug: id,
    name: id === 'barra' ? 'Barra' : 'Civil Lines',
    settings: {
      ...structuredClone(initialSettings),
      acceptingOrders: true,
      temporarilyClosed: false,
      deliveryEnabled: true,
      pickupEnabled: true,
      paymentMethods: [...paymentMethods],
      servicePostalCodes: id === 'barra' ? ['208027'] : ['208001'],
    },
  };
}

function checkout(fulfillment: Fulfillment = 'delivery', key = 'new-cod-checkout'): CheckoutInput {
  return {
    customer: {
      name: 'COD Test Customer',
      phone: '9876543210',
      address: fulfillment === 'delivery' ? '123 Test Street, Barra' : '',
      locality: fulfillment === 'delivery' ? 'Barra' : '',
      postalCode: fulfillment === 'delivery' ? '208027' : '',
      landmark: '',
      instructions: '',
    },
    fulfillment,
    paymentMethod: 'cash',
    paymentStatus: 'pending',
    idempotencyKey: key,
    branchId: 'barra',
  };
}

function reset(branches = [branch()]) {
  const selected = branches[0];
  useDemoStore.setState({
    branches: structuredClone(branches),
    settings: structuredClone(selected.settings),
    selectedBranchId: selected.id,
    adminBranchId: selected.id,
    cartBranchId: selected.id,
    products: [structuredClone(product)],
    cart: structuredClone(cart),
    orders: [],
    coupon: '',
    idempotencyKeys: {},
    persistenceError: null,
  });
}

function disableCash() {
  useDemoStore.getState().updateSettings({
    ...useDemoStore.getState().settings,
    paymentMethods: [...noCash],
  });
}

test('disabling COD rejects fresh and previously prepared delivery and pickup submissions without mutation', () => {
  for (const fulfillment of ['delivery', 'pickup'] as const) {
    reset();
    const prepared = checkout(fulfillment);
    const submitFromPreviousRender = useDemoStore.getState().createOrder;
    disableCash();
    const before = useDemoStore.getState();
    assert.throws(() => submitFromPreviousRender(prepared), /payment method.*unavailable/);
    assert.deepEqual(useDemoStore.getState().orders, before.orders);
    assert.deepEqual(useDemoStore.getState().cart, before.cart);
    assert.deepEqual(useDemoStore.getState().idempotencyKeys, before.idempotencyKeys);
    for (const paymentMethod of ['upi', 'card'] as const) {
      const online = useDemoStore.getState().createOrder({
        ...prepared,
        paymentMethod,
        paymentStatus: 'initiated',
        idempotencyKey: `${fulfillment}-online-${paymentMethod}`,
      });
      assert.equal(online.paymentMethod, paymentMethod);
    }
  }
});

test('COD can be disabled and re-enabled without changing an existing receipt or allowing a fresh cash order', () => {
  for (const fulfillment of ['delivery', 'pickup'] as const) {
    reset();
    const input = checkout(fulfillment);
    const first = useDemoStore.getState().createOrder(input);
    disableCash();
    useDemoStore.getState().addToCart(cart[0]);
    const beforeCart = structuredClone(useDemoStore.getState().cart);
    const replay = useDemoStore.getState().createOrder(input);
    assert.deepEqual(replay, first);
    assert.equal(useDemoStore.getState().orders.length, 1);
    assert.deepEqual(useDemoStore.getState().cart, beforeCart);
    assert.throws(
      () =>
        useDemoStore.getState().createOrder({ ...input, idempotencyKey: 'another-cod-attempt' }),
      /payment method.*unavailable/,
    );
    useDemoStore.getState().updateSettings({
      ...useDemoStore.getState().settings,
      paymentMethods: ['upi', 'card', 'cash'],
    });
    const next = useDemoStore
      .getState()
      .createOrder({ ...input, idempotencyKey: 'reenabled-cod-attempt' });
    assert.notEqual(next.id, first.id);
    assert.equal(useDemoStore.getState().orders.length, 2);
    assert.deepEqual(
      useDemoStore.getState().orders.find((order) => order.id === first.id),
      first,
    );
  }
});

test('COD restrictions apply to the selected branch and cannot be bypassed with another branch ID', () => {
  reset([branch(), branch('civil-lines', noCash)]);
  useDemoStore.getState().selectAdminBranch('civil-lines');
  useDemoStore
    .getState()
    .updateSettings({ ...branch('civil-lines').settings, paymentMethods: noCash });
  assert.equal(useDemoStore.getState().settings.paymentMethods.includes('cash'), true);
  assert.equal(useDemoStore.getState().createOrder(checkout()).branchId, 'barra');
  useDemoStore.getState().selectBranch('civil-lines');
  useDemoStore.getState().addToCart(cart[0]);
  const input = {
    ...checkout(),
    branchId: 'civil-lines',
    customer: { ...checkout().customer, postalCode: '208001' },
    idempotencyKey: 'civil-lines-cod-attempt',
  };
  assert.throws(() => useDemoStore.getState().createOrder(input), /payment method.*unavailable/);
  assert.throws(
    () => useDemoStore.getState().createOrder({ ...input, branchId: 'barra' }),
    /branch has changed/,
  );
  assert.equal(useDemoStore.getState().orders.length, 1);
});

test('disabling new COD orders preserves fulfillment and cash collection for previously accepted orders', () => {
  reset();
  const existing = useDemoStore.getState().createOrder(checkout());
  disableCash();
  useDemoStore.getState().updateOrderStatus(existing.id, 'confirmed');
  useDemoStore.getState().updateOrderStatus(existing.id, 'preparing');
  assert.throws(
    () => useDemoStore.getState().updatePaymentStatus(existing.id, 'initiated'),
    /Cash orders await collection/,
  );
  useDemoStore.getState().updatePaymentStatus(existing.id, 'simulated_paid');
  const collected = useDemoStore.getState().orders.find((order) => order.id === existing.id)!;
  assert.equal(collected.status, 'preparing');
  assert.equal(collected.paymentStatus, 'simulated_paid');
  assert.equal(collected.paymentMethod, 'cash');
  assert.equal(useDemoStore.getState().settings.paymentMethods.includes('cash'), false);
  assert.equal(useDemoStore.getState().orders.length, 1);
});

test('a stale full settings save cannot re-enable COD after the payment switch has saved it off', () => {
  reset();
  const baseline = structuredClone(useDemoStore.getState().settings);
  useDemoStore.getState().setPaymentMethodEnabled('cash', false, 'barra');
  assert.equal(useDemoStore.getState().settings.paymentMethods.includes('cash'), false);
  assert.throws(
    () =>
      useDemoStore
        .getState()
        .updateSettings(
          { ...baseline, deliveryFee: 9900 },
          { branchId: 'barra', settings: baseline },
        ),
    /changed|reload|review/i,
  );
  assert.equal(useDemoStore.getState().settings.deliveryFee, baseline.deliveryFee);
  assert.equal(useDemoStore.getState().settings.paymentMethods.includes('cash'), false);
  const fresh = structuredClone(useDemoStore.getState().settings);
  useDemoStore
    .getState()
    .updateSettings({ ...fresh, deliveryFee: 9900 }, { branchId: 'barra', settings: fresh });
  assert.equal(useDemoStore.getState().settings.deliveryFee, 9900);
  assert.equal(useDemoStore.getState().settings.paymentMethods.includes('cash'), false);
});

test('targeted payment switches preserve unrelated fields, customer branch and the other branch', () => {
  reset([branch(), branch('civil-lines')]);
  useDemoStore.getState().selectAdminBranch('civil-lines');
  const before = useDemoStore.getState();
  const original = structuredClone(before.branches);
  const cartBefore = structuredClone(before.cart);
  // The selected admin branch can differ from the customer's branch and cart.
  useDemoStore.getState().setPaymentMethodEnabled('cash', false, 'civil-lines');
  const after = useDemoStore.getState();
  assert.deepEqual(after.settings, original[0].settings);
  assert.deepEqual(after.branches[0], original[0]);
  assert.deepEqual(after.branches[1], {
    ...original[1],
    settings: { ...original[1].settings, paymentMethods: ['upi', 'card'] },
  });
  assert.equal(after.selectedBranchId, before.selectedBranchId);
  assert.equal(after.adminBranchId, before.adminBranchId);
  assert.deepEqual(after.cart, cartBefore);
  assert.deepEqual(after.orders, before.orders);
  useDemoStore.getState().setPaymentMethodEnabled('cash', false, 'civil-lines');
  assert.deepEqual(useDemoStore.getState().branches, after.branches);
  assert.throws(
    () => useDemoStore.getState().setPaymentMethodEnabled('cash', false, 'missing-branch'),
    /branch/i,
  );
  assert.throws(
    () => useDemoStore.getState().setPaymentMethodEnabled('cash', false, 'barra'),
    /branch|changed|review/i,
  );
  assert.deepEqual(useDemoStore.getState().branches, after.branches);
});

test('targeted switches reject disabling the last payment method without changing saved policy', () => {
  reset([branch('barra', ['cash'])]);
  const before = useDemoStore.getState();
  assert.throws(() => useDemoStore.getState().setPaymentMethodEnabled('cash', false, 'barra'));
  assert.deepEqual(useDemoStore.getState().settings, before.settings);
  assert.deepEqual(useDemoStore.getState().branches, before.branches);
  assert.equal(useDemoStore.getState().createOrder(checkout()).paymentMethod, 'cash');
});

test('a full settings save from a previous admin branch cannot overwrite the newly selected branch', () => {
  reset([branch(), branch('civil-lines')]);
  const baseline = structuredClone(useDemoStore.getState().settings);
  useDemoStore.getState().selectAdminBranch('civil-lines');
  const before = structuredClone(useDemoStore.getState().branches);
  assert.throws(
    () =>
      useDemoStore
        .getState()
        .updateSettings(
          { ...baseline, deliveryFee: 9900 },
          { branchId: 'barra', settings: baseline },
        ),
    /branch|changed|review/i,
  );
  assert.deepEqual(useDemoStore.getState().branches, before);
});

function withBrowserStorage(
  run: (browser: {
    get: () => string | null;
    set: (value: string) => void;
    notify: () => void;
    failWrites: (enabled: boolean) => void;
    failReads: (enabled: boolean) => void;
  }) => void | Promise<void>,
) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const baseline = useDemoStore.getState();
  const target = new EventTarget();
  let saved: string | null = null;
  let failWrites = false;
  let failReads = false;
  const fakeWindow = {
    localStorage: {
      getItem: (key: string) => {
        if (failReads) throw new Error('Storage access is disabled.');
        return key === storageKey ? saved : null;
      },
      setItem: (key: string, value: string) => {
        if (failWrites) throw new Error('QuotaExceededError');
        if (key === storageKey) saved = value;
      },
      removeItem: (key: string) => {
        if (key === storageKey) saved = null;
      },
    },
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });
  return Promise.resolve()
    .then(() =>
      run({
        get: () => saved,
        set: (value) => {
          saved = value;
        },
        failWrites: (enabled) => {
          failWrites = enabled;
        },
        failReads: (enabled) => {
          failReads = enabled;
        },
        notify: () => {
          const event = new Event('storage');
          Object.defineProperties(event, {
            key: { value: storageKey },
            newValue: { value: saved },
          });
          target.dispatchEvent(event);
        },
      }),
    )
    .finally(() => {
      failWrites = false;
      failReads = false;
      useDemoStore.setState(baseline);
      if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
      else Reflect.deleteProperty(globalThis, 'window');
    });
}

test('disabled COD survives saved-state migration and same-origin tab synchronization', async () => {
  await withBrowserStorage(async (browser) => {
    reset();
    const enabledSnapshot = browser.get()!;
    disableCash();
    const disabledSnapshot = browser.get()!;
    const envelope = JSON.parse(disabledSnapshot);
    assert.equal(envelope.version, STORE_VERSION);
    const migrated = migrateDemoState(envelope.state, STORE_VERSION);
    assert.equal(migrated.settings?.paymentMethods.includes('cash'), false);
    assert.ok(Array.isArray(migrated.branches));
    const migratedBranch = branchSchema.parse(migrated.branches[0]);
    assert.equal(migratedBranch.settings.paymentMethods.includes('cash'), false);
    browser.set(enabledSnapshot);
    await useDemoStore.persist.rehydrate();
    assert.equal(useDemoStore.getState().settings.paymentMethods.includes('cash'), true);
    const detach = attachDemoStoreSync();
    try {
      browser.set(disabledSnapshot);
      browser.notify();
      await Promise.resolve();
      assert.equal(useDemoStore.getState().settings.paymentMethods.includes('cash'), false);
      assert.throws(
        () => useDemoStore.getState().createOrder(checkout()),
        /payment method.*unavailable/,
      );
      assert.equal(useDemoStore.getState().orders.length, 0);
    } finally {
      detach();
    }
  });
});

test('checkout checks persisted COD restrictions even before another tab storage event is handled', async () => {
  await withBrowserStorage(async (browser) => {
    reset();
    const enabledSnapshot = browser.get()!;
    disableCash();
    const disabledSnapshot = browser.get()!;
    browser.set(enabledSnapshot);
    await useDemoStore.persist.rehydrate();
    browser.set(disabledSnapshot);
    // Another tab has saved COD off; this tab has not handled its storage event yet.
    assert.equal(useDemoStore.getState().settings.paymentMethods.includes('cash'), true);
    assert.throws(
      () => useDemoStore.getState().createOrder(checkout()),
      /payment method.*unavailable/,
    );
    assert.equal(useDemoStore.getState().orders.length, 0);
    assert.equal(JSON.parse(browser.get()!).state.settings.paymentMethods.includes('cash'), false);
  });
});

test('a targeted payment toggle merges the latest persisted branch settings before a storage event', async () => {
  await withBrowserStorage(async (browser) => {
    reset();
    const olderSnapshot = browser.get()!;
    useDemoStore.getState().updateSettings({
      ...useDemoStore.getState().settings,
      deliveryFee: 9900,
    });
    const latestSnapshot = browser.get()!;
    browser.set(olderSnapshot);
    await useDemoStore.persist.rehydrate();
    browser.set(latestSnapshot);
    useDemoStore.getState().setPaymentMethodEnabled('cash', false, 'barra');
    assert.equal(useDemoStore.getState().settings.deliveryFee, 9900);
    assert.equal(useDemoStore.getState().settings.paymentMethods.includes('cash'), false);
    assert.equal(JSON.parse(browser.get()!).state.settings.deliveryFee, 9900);
  });
});

test('full settings baseline validation catches a persisted COD change before a storage event', async () => {
  await withBrowserStorage(async (browser) => {
    reset();
    const baseline = structuredClone(useDemoStore.getState().settings);
    const enabledSnapshot = browser.get()!;
    useDemoStore.getState().setPaymentMethodEnabled('cash', false, 'barra');
    const disabledSnapshot = browser.get()!;
    browser.set(enabledSnapshot);
    await useDemoStore.persist.rehydrate();
    browser.set(disabledSnapshot);
    assert.throws(
      () =>
        useDemoStore
          .getState()
          .updateSettings(
            { ...baseline, deliveryFee: 9900 },
            { branchId: 'barra', settings: baseline },
          ),
      /changed|reload|review/i,
    );
    assert.equal(useDemoStore.getState().settings.paymentMethods.includes('cash'), false);
    assert.equal(JSON.parse(browser.get()!).state.settings.paymentMethods.includes('cash'), false);
  });
});

test('quota failures retain the newer in-memory cart and COD restriction instead of reloading an old saved snapshot', async () => {
  await withBrowserStorage(async (browser) => {
    reset();
    const originalDisk = browser.get()!;
    browser.failWrites(true);
    useDemoStore.getState().updateQuantity(cart[0].id, 2);
    useDemoStore.getState().setPaymentMethodEnabled('cash', false, 'barra');
    assert.throws(
      () => useDemoStore.getState().createOrder(checkout()),
      /payment method.*unavailable/,
    );
    assert.equal(useDemoStore.getState().cart[0].quantity, 2);
    assert.equal(useDemoStore.getState().settings.paymentMethods.includes('cash'), false);
    assert.equal(browser.get(), originalDisk);
    await Promise.resolve();
    await Promise.resolve();
    assert.match(useDemoStore.getState().persistenceError ?? '', /lost on refresh/);
  });
});

test('checkout can use its current in-memory cart when storage writes fail', async () => {
  await withBrowserStorage(async (browser) => {
    reset();
    browser.failWrites(true);
    useDemoStore.getState().updateQuantity(cart[0].id, 2);
    const order = useDemoStore.getState().createOrder(checkout());
    assert.equal(order.items[0].quantity, 2);
    assert.equal(order.subtotal, 60000);
    assert.equal(useDemoStore.getState().cart.length, 0);
    await Promise.resolve();
    await Promise.resolve();
    assert.match(useDemoStore.getState().persistenceError ?? '', /lost on refresh/);
  });
});

test('unavailable storage cannot replace a COD-off in-memory policy with a default policy', async () => {
  await withBrowserStorage(async (browser) => {
    reset();
    useDemoStore.getState().setPaymentMethodEnabled('cash', false, 'barra');
    browser.failReads(true);
    browser.failWrites(true);
    assert.throws(
      () => useDemoStore.getState().createOrder(checkout()),
      /payment method.*unavailable/,
    );
    assert.equal(useDemoStore.getState().settings.paymentMethods.includes('cash'), false);
    assert.equal(useDemoStore.getState().orders.length, 0);
    assert.equal(useDemoStore.getState().cart.length, 1);
    await Promise.resolve();
    await Promise.resolve();
    assert.match(useDemoStore.getState().persistenceError ?? '', /lost on refresh/);
  });
});
