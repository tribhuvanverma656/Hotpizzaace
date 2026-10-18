import test from 'node:test';
import assert from 'node:assert/strict';
import { initialProducts, initialSettings } from '../lib/data';
import { getCartTotals, getUnitPrice } from '../lib/pricing';
import { attachDemoStoreSync, useDemoStore } from '../lib/store';
import { STORE_VERSION } from '../lib/persistence';
import type { CartSelection } from '../types';

const product = initialProducts.find((item) => item.slug === 'simple-cheese')!;
const selection: CartSelection = {
  productId: product.id,
  sizeId: product.sizes[0].id,
  crustId: product.crusts[0].id,
  toppingIds: [],
  quantity: 1,
  notes: '',
};

function reset() {
  useDemoStore.setState({
    products: [structuredClone(product)],
    settings: structuredClone(initialSettings),
    selectedBranchId: 'barra',
    cartBranchId: null,
    cart: [],
    coupon: '',
    persistenceError: null,
  });
}

test('rapid additions use the latest quantity and enforce the per-configuration limit atomically', () => {
  const baseline = useDemoStore.getState();
  try {
    reset();
    const add = useDemoStore.getState().addToCart;
    for (let count = 0; count < 20; count++) add(selection);
    const state = useDemoStore.getState();
    assert.equal(state.cart.length, 1);
    assert.equal(state.cart[0].quantity, 20);
    assert.equal(
      getCartTotals(state.cart, state.products, state.settings).subtotal,
      getUnitPrice(product, selection) * 20,
    );
    assert.throws(() => add(selection), /up to 20/);
    assert.strictEqual(useDemoStore.getState().cart, state.cart);
  } finally {
    useDemoStore.setState(baseline);
  }
});

test('quantities and totals remain independent for multiple configurations as the last one is removed', () => {
  const baseline = useDemoStore.getState();
  try {
    reset();
    const add = useDemoStore.getState().addToCart;
    add({ ...selection, quantity: 2 });
    const medium = { ...selection, sizeId: product.sizes[1].id, quantity: 3 };
    add(medium);
    const [small, larger] = useDemoStore.getState().cart;
    assert.equal(
      useDemoStore.getState().cart.reduce((total, item) => total + item.quantity, 0),
      5,
    );
    assert.equal(
      getCartTotals(useDemoStore.getState().cart, [product], initialSettings).subtotal,
      getUnitPrice(product, selection) * 2 + getUnitPrice(product, medium) * 3,
    );
    useDemoStore.getState().updateQuantity(larger.id, 2);
    assert.equal(useDemoStore.getState().cart.find((item) => item.id === small.id)?.quantity, 2);
    useDemoStore.getState().updateQuantity(larger.id, 0);
    assert.deepEqual(useDemoStore.getState().cart, [small]);
    add(selection);
    assert.equal(useDemoStore.getState().cart[0].quantity, 3);
    assert.equal(
      getCartTotals(useDemoStore.getState().cart, [product], initialSettings).subtotal,
      getUnitPrice(product, selection) * 3,
    );
  } finally {
    useDemoStore.setState(baseline);
  }
});

test('invalid quantity updates leave the cart unchanged and zero removes the item', () => {
  const baseline = useDemoStore.getState();
  try {
    reset();
    useDemoStore.getState().addToCart({ ...selection, quantity: 3 });
    const cart = useDemoStore.getState().cart;
    const id = cart[0].id;
    for (const quantity of [-1, 0.5, 21, NaN, Infinity]) {
      assert.throws(() => useDemoStore.getState().updateQuantity(id, quantity), /quantity/);
      assert.strictEqual(useDemoStore.getState().cart, cart);
    }
    useDemoStore.getState().updateQuantity(id, 0);
    assert.equal(useDemoStore.getState().cart.length, 0);
    assert.equal(getCartTotals([], [product], initialSettings).total, 0);
  } finally {
    useDemoStore.setState(baseline);
  }
});

test('cross-tab quantity changes replace local counts without feedback writes and subsequent additions use the synced count', async () => {
  const baseline = useDemoStore.getState();
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let cleanup = () => {};
  try {
    reset();
    useDemoStore.getState().addToCart(selection);
    const remoteCart = useDemoStore.getState().cart.map((item) => ({ ...item, quantity: 4 }));
    const serialized = JSON.stringify({
      state: { ...useDemoStore.getState(), cart: remoteCart },
      version: STORE_VERSION,
    });
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
        addEventListener: (_name: string, callback: (event: StorageEvent) => void) => {
          handler = callback;
        },
        removeEventListener: () => {
          handler = undefined;
        },
      },
    });
    cleanup = attachDemoStoreSync();
    assert.ok(handler);
    handler({ key: 'hot-pizza-ace-demo-v1', newValue: serialized } as StorageEvent);
    await Promise.resolve();
    assert.equal(useDemoStore.getState().cart[0].quantity, 4);
    assert.equal(writes, 0);
    useDemoStore.getState().addToCart(selection);
    assert.equal(useDemoStore.getState().cart[0].quantity, 5);
    assert.equal(writes, 1);
  } finally {
    cleanup();
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor);
    else Reflect.deleteProperty(globalThis, 'window');
    useDemoStore.setState(baseline);
  }
});
