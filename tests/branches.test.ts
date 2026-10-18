import test from 'node:test';
import assert from 'node:assert/strict';
import {
  branchesForPostalCode,
  getOrderBranchDetails,
  getOrderBranchId,
  isBranchOpen,
} from '../lib/branches';
import { initialOrders, initialProducts, initialSettings } from '../lib/data';
import { migrateDemoState, STORE_VERSION } from '../lib/persistence';
import { useDemoStore } from '../lib/store';
import { branchSchema } from '../lib/validation';
import type { Branch, CartSelection, CheckoutInput, RestaurantSettings } from '../types';

function branch(id = 'barra', overrides: Partial<RestaurantSettings> = {}): Branch {
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
      paymentMethods: ['upi', 'card', 'cash'],
      servicePostalCodes: id === 'barra' ? ['208027'] : ['208001'],
      couponCode: 'TEST10',
      couponPercent: 10,
      couponMinimum: 0,
      couponMaximum: 5000,
      ...overrides,
    },
  };
}

test('branch availability requires an accepting kitchen and at least one enabled fulfillment mode', () => {
  for (const acceptingOrders of [false, true]) {
    for (const temporarilyClosed of [false, true]) {
      for (const deliveryEnabled of [false, true]) {
        for (const pickupEnabled of [false, true]) {
          assert.equal(
            isBranchOpen(
              branch('barra', {
                acceptingOrders,
                temporarilyClosed,
                deliveryEnabled,
                pickupEnabled,
              }),
            ),
            acceptingOrders && !temporarilyClosed && (deliveryEnabled || pickupEnabled),
          );
        }
      }
    }
  }
});

const product = {
  ...initialProducts.find((item) => item.slug === 'french-fries')!,
  price: 30000,
};
const selection: CartSelection = {
  productId: product.id,
  quantity: 1,
  toppingIds: [],
  notes: '',
};
const checkout: CheckoutInput = {
  customer: {
    name: 'Branch Test Customer',
    phone: '9876543210',
    address: '123 Test Street, Test Building',
    locality: 'Test locality',
    postalCode: '208027',
    landmark: '',
    instructions: '',
  },
  fulfillment: 'delivery',
  paymentMethod: 'cash',
  paymentStatus: 'pending',
  idempotencyKey: 'branch-checkout-first',
};

function reset() {
  const barra = branch();
  const civilLines = branch('civil-lines', {
    address: '456 Test Avenue, Civil Lines, Kanpur 208001',
    phone: '+91 98765 43210',
    deliveryFee: 5900,
    freeDeliveryThreshold: null,
    couponCode: 'CIVIL20',
    couponPercent: 20,
  });
  useDemoStore.setState({
    branches: [barra, civilLines],
    selectedBranchId: barra.id,
    adminBranchId: barra.id,
    cartBranchId: null,
    settings: structuredClone(barra.settings),
    products: [structuredClone(product)],
    orders: structuredClone(initialOrders),
    cart: [],
    coupon: '',
    idempotencyKeys: {},
    adminSession: true,
    customerSession: null,
    persistenceError: null,
  });
  return { barra, civilLines };
}

test('admin saves valid branches, updates an existing ID once and rejects duplicate URL names', () => {
  reset();
  const newBranch = branch('test-branch', {
    servicePostalCodes: ['208002', '208002', '208003'],
  });
  useDemoStore.getState().saveBranch(newBranch);
  let saved = useDemoStore.getState().branches.find((item) => item.id === newBranch.id)!;
  assert.deepEqual(saved.settings.servicePostalCodes, ['208002', '208003']);
  assert.equal(useDemoStore.getState().branches.length, 3);
  useDemoStore.getState().saveBranch({ ...saved, name: 'Updated test branch' });
  saved = useDemoStore.getState().branches.find((item) => item.id === newBranch.id)!;
  assert.equal(saved.name, 'Updated test branch');
  assert.equal(useDemoStore.getState().branches.length, 3);
  assert.throws(
    () => useDemoStore.getState().saveBranch({ ...branch('collision'), slug: 'test-branch' }),
    /already uses/,
  );
  assert.equal(useDemoStore.getState().branches.length, 3);
});

test('branch saves reject invalid identities, postal codes and checkout configuration without mutation', () => {
  reset();
  const before = structuredClone(useDemoStore.getState().branches);
  const candidate = branch('test-branch');
  const invalid: Branch[] = [
    { ...candidate, id: '' },
    { ...candidate, name: ' ' },
    { ...candidate, slug: 'Invalid slug' },
    branch('test-branch', { servicePostalCodes: ['20802'] }),
    branch('test-branch', { servicePostalCodes: ['20802x'] }),
    branch('test-branch', { servicePostalCodes: [] }),
    branch('test-branch', { deliveryFee: -1 }),
    branch('test-branch', { freeDeliveryThreshold: 1.5 }),
    branch('test-branch', { paymentMethods: [] }),
    branch('test-branch', { deliveryEnabled: false, pickupEnabled: false }),
  ];
  for (const value of invalid) {
    assert.throws(() => useDemoStore.getState().saveBranch(value));
    assert.deepEqual(useDemoStore.getState().branches, before);
  }
  assert.throws(() => useDemoStore.getState().selectBranch('missing'), /not available/);
  assert.throws(() => useDemoStore.getState().selectAdminBranch('missing'), /existing branch/);
});

test('changing a customer branch guards the cart; selecting the same branch leaves its coupon intact', () => {
  reset();
  useDemoStore.getState().addToCart(selection);
  useDemoStore.getState().applyCoupon('TEST10');
  const before = structuredClone(useDemoStore.getState().cart);
  assert.equal(useDemoStore.getState().cartBranchId, 'barra');
  useDemoStore.getState().selectBranch('barra');
  assert.deepEqual(useDemoStore.getState().cart, before);
  assert.equal(useDemoStore.getState().coupon, 'TEST10');
  assert.throws(() => useDemoStore.getState().selectBranch('civil-lines'), /Clear it/);
  assert.equal(useDemoStore.getState().selectedBranchId, 'barra');
  assert.deepEqual(useDemoStore.getState().cart, before);
  assert.equal(useDemoStore.getState().coupon, 'TEST10');
});

test('a confirmed branch switch clears the previous cart and coupon while leaving admin selection alone', () => {
  const { civilLines } = reset();
  useDemoStore.getState().addToCart(selection);
  useDemoStore.getState().applyCoupon('TEST10');
  useDemoStore.getState().selectBranch('civil-lines', true);
  assert.equal(useDemoStore.getState().selectedBranchId, 'civil-lines');
  assert.equal(useDemoStore.getState().adminBranchId, 'barra');
  assert.deepEqual(useDemoStore.getState().settings, civilLines.settings);
  assert.deepEqual(useDemoStore.getState().cart, []);
  assert.equal(useDemoStore.getState().cartBranchId, null);
  assert.equal(useDemoStore.getState().coupon, '');
  useDemoStore.getState().addToCart(selection);
  assert.equal(useDemoStore.getState().cartBranchId, 'civil-lines');
  assert.throws(() => useDemoStore.getState().applyCoupon('TEST10'), /CIVIL20/);
  useDemoStore.getState().applyCoupon('CIVIL20');
  assert.equal(useDemoStore.getState().coupon, 'CIVIL20');
  useDemoStore.getState().clearCart();
  assert.equal(useDemoStore.getState().cartBranchId, null);
});

test('admin branch selection and settings edits remain independent of the customer cart and branch', () => {
  const { barra, civilLines } = reset();
  useDemoStore.getState().addToCart(selection);
  useDemoStore.getState().applyCoupon('TEST10');
  const cartBefore = structuredClone(useDemoStore.getState().cart);
  useDemoStore.getState().selectAdminBranch(civilLines.id);
  assert.equal(useDemoStore.getState().selectedBranchId, barra.id);
  assert.deepEqual(useDemoStore.getState().settings, barra.settings);
  const edited = { ...civilLines.settings, deliveryFee: 9900, couponCode: 'CIVILNEW' };
  useDemoStore.getState().updateSettings(edited);
  assert.deepEqual(
    useDemoStore.getState().branches.find((item) => item.id === civilLines.id)?.settings,
    edited,
  );
  assert.deepEqual(useDemoStore.getState().settings, barra.settings);
  assert.deepEqual(useDemoStore.getState().cart, cartBefore);
  assert.equal(useDemoStore.getState().coupon, 'TEST10');
  useDemoStore.getState().selectAdminBranch(barra.id);
  useDemoStore.getState().updateSettings({ ...barra.settings, couponCode: 'BARRANEW' });
  assert.equal(useDemoStore.getState().settings.couponCode, 'BARRANEW');
  assert.equal(useDemoStore.getState().coupon, '');
});

test('branch saves update the selected settings only and preserve another branch customer coupon', () => {
  const { barra, civilLines } = reset();
  useDemoStore.getState().addToCart(selection);
  useDemoStore.getState().applyCoupon('TEST10');
  useDemoStore.getState().saveBranch({
    ...civilLines,
    settings: { ...civilLines.settings, couponCode: '' },
  });
  assert.deepEqual(useDemoStore.getState().settings, barra.settings);
  assert.equal(useDemoStore.getState().coupon, 'TEST10');
  useDemoStore.getState().saveBranch({
    ...barra,
    settings: { ...barra.settings, couponCode: '' },
  });
  assert.equal(useDemoStore.getState().settings.couponCode, '');
  assert.equal(useDemoStore.getState().coupon, '');
});

test('checkout enforces the selected branch postal code and rejects stale branch or cart ownership', () => {
  reset();
  useDemoStore.getState().selectBranch('civil-lines');
  useDemoStore.getState().addToCart(selection);
  const count = useDemoStore.getState().orders.length;
  assert.throws(() => useDemoStore.getState().createOrder(checkout), /outside our delivery area/);
  const civilCheckout = {
    ...checkout,
    customer: { ...checkout.customer, postalCode: '208001' },
  };
  assert.throws(
    () => useDemoStore.getState().createOrder({ ...civilCheckout, branchId: 'barra' }),
    /branch has changed/,
  );
  useDemoStore.setState({ cartBranchId: 'barra' });
  assert.throws(() => useDemoStore.getState().createOrder(civilCheckout), /branch has changed/);
  assert.throws(() => useDemoStore.getState().addToCart(selection), /another branch/);
  assert.equal(useDemoStore.getState().orders.length, count);
  useDemoStore.setState({ cartBranchId: 'civil-lines' });
  const order = useDemoStore.getState().createOrder({
    ...civilCheckout,
    branchId: 'civil-lines',
  });
  assert.equal(order.branchId, 'civil-lines');
  assert.equal(order.deliveryFee, 5900);
  assert.equal(order.total, 35900);
});

test('new order receipts snapshot the chosen branch while branch edits preserve all previous receipts', () => {
  const { civilLines } = reset();
  const previousOrders = structuredClone(useDemoStore.getState().orders);
  useDemoStore.getState().selectBranch(civilLines.id);
  useDemoStore.getState().addToCart(selection);
  const order = useDemoStore.getState().createOrder({
    ...checkout,
    branchId: civilLines.id,
    customer: { ...checkout.customer, postalCode: '208001' },
  });
  assert.equal(order.branchId, civilLines.id);
  assert.equal(order.branchName, civilLines.name);
  assert.equal(order.branchAddress, civilLines.settings.address);
  assert.equal(order.branchPhone, civilLines.settings.phone);
  const receipt = structuredClone(order);
  useDemoStore.getState().saveBranch({
    ...civilLines,
    name: 'Renamed test restaurant',
    settings: {
      ...civilLines.settings,
      address: '789 Updated Test Avenue, Kanpur 208001',
      phone: '+91 91234 56789',
      deliveryFee: 7900,
    },
  });
  assert.deepEqual(
    useDemoStore.getState().orders.find((item) => item.id === order.id),
    receipt,
  );
  assert.deepEqual(useDemoStore.getState().orders.slice(1), previousOrders);
  order.branchName = 'Mutated returned copy';
  order.customer.name = 'Mutated returned customer';
  assert.deepEqual(
    useDemoStore.getState().orders.find((item) => item.id === receipt.id),
    receipt,
  );
});

test('checkout retries return the original branch receipt and cannot replay it under another branch', () => {
  reset();
  useDemoStore.getState().addToCart(selection);
  const first = useDemoStore.getState().createOrder(checkout);
  assert.equal(useDemoStore.getState().createOrder(checkout).id, first.id);
  useDemoStore.getState().selectBranch('civil-lines');
  useDemoStore.getState().addToCart(selection);
  assert.throws(
    () =>
      useDemoStore.getState().createOrder({
        ...checkout,
        branchId: 'civil-lines',
        customer: { ...checkout.customer, postalCode: '208001' },
      }),
    /checkout belongs to another branch/,
  );
  assert.equal(useDemoStore.getState().cart.length, 1);
});

test('branch migration assigns existing carts to Barra without rewriting receipts or saved settings', () => {
  const settings = {
    ...structuredClone(initialSettings),
    deliveryFee: 3500,
    servicePostalCodes: ['208027', '208022'],
    couponCode: 'SAVED15',
    couponPercent: 15,
  };
  const oldState = {
    settings,
    products: [product],
    orders: structuredClone(initialOrders),
    cart: [{ ...selection, id: 'saved-cart' }],
    coupon: 'SAVED15',
    customerSession: { phone: '9876543210' },
    adminSession: true,
  };
  const migrated = migrateDemoState(oldState, 6);
  assert.equal(migrated.selectedBranchId, 'barra');
  assert.equal(migrated.adminBranchId, 'barra');
  assert.equal(migrated.cartBranchId, 'barra');
  assert.ok(Array.isArray(migrated.branches));
  const migratedBranches = migrated.branches.map((value) => branchSchema.parse(value));
  assert.equal(migratedBranches.length, 1);
  assert.deepEqual(migratedBranches[0].settings, settings);
  assert.strictEqual(migrated.orders, oldState.orders);
  assert.strictEqual(migrated.cart, oldState.cart);
  assert.strictEqual(migrated.customerSession, oldState.customerSession);
  assert.equal(migrated.coupon, 'SAVED15');
  const empty = migrateDemoState({ settings, cart: [] }, 6);
  assert.equal(empty.cartBranchId, null);
  assert.strictEqual(migrateDemoState(migrated, STORE_VERSION), migrated);
});

test('postal-code discovery requires an exact six-digit delivery match and retains covered paused kitchens', () => {
  const open = branch();
  const paused = branch('paused', {
    acceptingOrders: false,
    servicePostalCodes: ['208027'],
  });
  const pickupOnly = branch('pickup-only', {
    deliveryEnabled: false,
    servicePostalCodes: ['208027'],
  });
  const other = branch('civil-lines');
  const candidates = [open, paused, pickupOnly, other];
  assert.deepEqual(
    branchesForPostalCode(candidates, '208027').map((item) => item.id),
    ['barra', 'paused'],
  );
  assert.deepEqual(branchesForPostalCode(candidates, '208001'), [other]);
  for (const postalCode of ['', '208', '2080277', ' 208027', '208027 ', '20802a', 'x208027']) {
    assert.deepEqual(branchesForPostalCode(candidates, postalCode), []);
  }
  assert.deepEqual(branchesForPostalCode(candidates, '110001'), []);
  assert.equal(isBranchOpen(paused), false);
});

test('legacy receipts resolve to Barra without changing their stored snapshots', () => {
  const legacy = structuredClone(initialOrders[0]);
  Reflect.deleteProperty(legacy, 'branchId');
  const snapshot = structuredClone(legacy);
  assert.equal(getOrderBranchId(legacy), 'barra');
  assert.deepEqual(legacy, snapshot);
  assert.equal(getOrderBranchId({ branchId: 'civil-lines' }), 'civil-lines');
  assert.equal(getOrderBranchId({ branchId: '' }), 'barra');
});

test('receipt contact details prefer purchase snapshots, resolve legacy Barra and never borrow another branch', () => {
  const barra = branch('barra', {
    address: '123 Original Barra Address, Kanpur 208027',
    phone: '+91 91234 56789',
    preparationMinutes: 20,
  });
  const civilLines = branch('civil-lines', {
    address: '456 Current Civil Lines Address, Kanpur 208001',
    phone: '+91 98765 43210',
    preparationMinutes: 40,
  });
  const branches = [civilLines, barra];
  const before = structuredClone(branches);
  const receipt = {
    branchId: 'civil-lines',
    branchName: 'Civil Lines at purchase',
    branchAddress: '789 Civil Lines Address at Purchase, Kanpur 208001',
    branchPhone: '+91 99887 76655',
  };
  assert.deepEqual(getOrderBranchDetails(receipt, branches), {
    id: 'civil-lines',
    name: receipt.branchName,
    address: receipt.branchAddress,
    phone: receipt.branchPhone,
    preparationMinutes: 40,
  });
  const legacy = getOrderBranchDetails({}, branches);
  assert.equal(legacy.id, 'barra');
  assert.equal(legacy.name, barra.name);
  assert.equal(legacy.address, barra.settings.address);
  assert.equal(legacy.phone, barra.settings.phone);
  assert.equal(legacy.preparationMinutes, 20);
  const missing = getOrderBranchDetails({ branchId: 'removed-branch' }, branches);
  assert.equal(missing.address, null);
  assert.equal(missing.phone, null);
  assert.equal(missing.preparationMinutes, null);
  const storedOnly = getOrderBranchDetails(receipt, []);
  assert.equal(storedOnly.address, receipt.branchAddress);
  assert.equal(storedOnly.phone, receipt.branchPhone);
  assert.deepEqual(branches, before);
});
