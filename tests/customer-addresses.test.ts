import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCustomerAddresses,
  getDefaultCustomerAddress,
  parseCustomerAddress,
  sanitizeSavedAddresses,
} from '../lib/customer-addresses';
import { initialBranches, initialOrders, initialProducts, initialSettings } from '../lib/data';
import { migrateDemoState, STORE_VERSION } from '../lib/persistence';
import { useDemoStore } from '../lib/store';
import type { SavedAddress } from '../types';

const ownerPhone = '9876543210';
const otherPhone = '9988776655';

function draft(
  id = 'home',
  overrides: Partial<Omit<SavedAddress, 'ownerPhone'>> = {},
): Omit<SavedAddress, 'ownerPhone'> {
  return {
    id,
    label: 'Home',
    isDefault: false,
    customer: {
      name: 'Address Test Customer',
      phone: ownerPhone,
      address: id === 'home' ? '123 Test Street, Building 2' : `${id} Test Street, Building 2`,
      locality: 'Barra',
      postalCode: '208027',
      landmark: 'Test landmark',
      instructions: '',
    },
    ...overrides,
  };
}

function reset() {
  useDemoStore.setState({
    savedAddresses: [],
    customerSession: null,
    orders: structuredClone(initialOrders),
    branches: structuredClone(initialBranches),
    selectedBranchId: 'barra',
    adminBranchId: 'barra',
    settings: structuredClone(initialSettings),
    cart: [],
    cartBranchId: null,
    coupon: '',
    idempotencyKeys: {},
    persistenceError: null,
  });
}

function signIn(phone = ownerPhone) {
  useDemoStore.getState().loginCustomer(phone, '123456');
}

function own(phone = ownerPhone) {
  return getCustomerAddresses(useDemoStore.getState().savedAddresses, phone);
}

function edit(input: Omit<SavedAddress, 'ownerPhone'>) {
  const phone = useDemoStore.getState().customerSession!.phone;
  const expected = getCustomerAddresses(useDemoStore.getState().savedAddresses, phone).find(
    (address) => address.id === input.id,
  )!;
  useDemoStore
    .getState()
    .saveCustomerAddress(input, { mode: 'update', expectedOwnerPhone: phone, expected });
}

test('saved address reads normalize owner identity, put the default first and never expose another owner', () => {
  const addresses: SavedAddress[] = [
    { ...draft('first'), ownerPhone },
    { ...draft('other', { isDefault: true }), ownerPhone: otherPhone },
    { ...draft('default', { isDefault: true }), ownerPhone: '+91 98765 43210' },
  ];
  const before = structuredClone(addresses);
  assert.deepEqual(
    getCustomerAddresses(addresses, '+91 (98765) 43210').map((address) => address.id),
    ['default', 'first'],
  );
  assert.equal(getDefaultCustomerAddress(addresses, ownerPhone)?.id, 'default');
  assert.deepEqual(
    getCustomerAddresses(addresses, otherPhone).map((address) => address.id),
    ['other'],
  );
  for (const phone of ['', '12345', '1234567890']) {
    assert.deepEqual(getCustomerAddresses(addresses, phone), []);
    assert.equal(getDefaultCustomerAddress(addresses, phone), undefined);
  }
  assert.deepEqual(addresses, before);
});

test('all address changes require a signed-in customer', () => {
  reset();
  assert.throws(() => useDemoStore.getState().saveCustomerAddress(draft()), /Sign in/);
  assert.throws(() => useDemoStore.getState().removeCustomerAddress('home'), /Sign in/);
  assert.throws(() => useDemoStore.getState().setDefaultCustomerAddress('home'), /Sign in/);
  assert.deepEqual(useDemoStore.getState().savedAddresses, []);
});

test('duplicate addresses reject normalized repeat saves without creating extra records', () => {
  reset();
  signIn();
  useDemoStore.getState().saveCustomerAddress(draft());
  const duplicate = {
    ...draft('duplicate', { label: 'Another label' }),
    customer: {
      ...draft().customer,
      address: '  123  TEST STREET  BUILDING 2 ',
      locality: ' BARRA ',
    },
  };
  assert.throws(
    () =>
      useDemoStore
        .getState()
        .saveCustomerAddress(duplicate, { mode: 'create', expectedOwnerPhone: ownerPhone }),
    /already saved/,
  );
  assert.equal(own().length, 1);
  assert.throws(() => useDemoStore.getState().saveCustomerAddress(draft()), /already exists/);
});

test('stale updates and removal confirmations cannot overwrite changed records or recreate deleted addresses', () => {
  reset();
  signIn();
  useDemoStore.getState().saveCustomerAddress(draft());
  const original = structuredClone(own()[0]);
  edit({ ...draft(), customer: { ...draft().customer, address: '789 Newer Street, Building 3' } });
  const current = structuredClone(own()[0]);
  assert.throws(
    () =>
      useDemoStore
        .getState()
        .saveCustomerAddress(draft(), {
          mode: 'update',
          expectedOwnerPhone: ownerPhone,
          expected: original,
        }),
    /changed in another tab/,
  );
  assert.throws(
    () => useDemoStore.getState().removeCustomerAddress('home', original),
    /changed in another tab/,
  );
  assert.deepEqual(own()[0], current);
  useDemoStore.getState().removeCustomerAddress('home', current);
  assert.throws(
    () =>
      useDemoStore
        .getState()
        .saveCustomerAddress(draft(), {
          mode: 'update',
          expectedOwnerPhone: ownerPhone,
          expected: current,
        }),
    /was removed/,
  );
  assert.deepEqual(own(), []);
});

test('a sign-in change during address entry rejects the previous owner’s pending save', () => {
  reset();
  signIn();
  signIn(otherPhone);
  assert.throws(
    () =>
      useDemoStore
        .getState()
        .saveCustomerAddress(draft(), { mode: 'create', expectedOwnerPhone: ownerPhone }),
    /account changed/,
  );
  assert.deepEqual(own(otherPhone), []);
});

test('malformed persisted addresses are repaired without changing orders, cart or settings', () => {
  reset();
  const value = [
    null,
    {},
    { ...draft('invalid'), ownerPhone, customer: { ...draft().customer, postalCode: '000000' } },
    { ...draft('first'), ownerPhone, isDefault: true },
    { ...draft('second'), ownerPhone, isDefault: true },
    { ...draft('duplicate-id'), id: 'first', ownerPhone: otherPhone },
  ];
  const repaired = sanitizeSavedAddresses(value);
  assert.deepEqual(
    repaired.map((a) => a.id),
    ['first', 'second'],
  );
  assert.equal(repaired.filter((a) => a.isDefault).length, 1);
  for (const broken of [null, {}, 'invalid']) assert.deepEqual(sanitizeSavedAddresses(broken), []);
  const current = useDemoStore.getState();
  const merged = useDemoStore.persist.getOptions().merge!({ savedAddresses: value }, current);
  assert.deepEqual(merged.savedAddresses, repaired);
  assert.strictEqual(merged.orders, current.orders);
  assert.strictEqual(merged.cart, current.cart);
  assert.strictEqual(merged.settings, current.settings);
  assert.deepEqual(getCustomerAddresses(null as unknown as SavedAddress[], ownerPhone), []);
});

test('saving forces session ownership and contact phone, clears order instructions and isolates caller objects', () => {
  reset();
  signIn('+91 98765 43210');
  const input = {
    ...draft('home'),
    ownerPhone: otherPhone,
    label: '  Home  ',
    customer: {
      ...draft().customer,
      phone: otherPhone,
      name: '  Address Test Customer  ',
      address: '  123 Test Street, Building 2  ',
      postalCode: ' 208027 ',
      instructions: 'Leave this particular order with the guard',
    },
  };
  useDemoStore.getState().saveCustomerAddress(input);
  const saved = own()[0];
  assert.equal(saved.ownerPhone, ownerPhone);
  assert.equal(saved.customer.phone, ownerPhone);
  assert.equal(saved.customer.instructions, '');
  assert.equal(saved.customer.name, 'Address Test Customer');
  assert.equal(saved.customer.address, '123 Test Street, Building 2');
  assert.equal(saved.customer.postalCode, '208027');
  assert.equal(saved.label, 'Home');
  assert.equal(saved.isDefault, true);
  assert.deepEqual(own(otherPhone), []);
  input.customer.address = 'Changed by caller after saving';
  input.label = 'Changed by caller';
  assert.equal(own()[0].customer.address, '123 Test Street, Building 2');
  assert.equal(own()[0].label, 'Home');
});

test('address edits keep IDs unique and preserve the default unless another address is explicitly chosen', () => {
  reset();
  signIn();
  useDemoStore.getState().saveCustomerAddress(draft('home'));
  useDemoStore.getState().saveCustomerAddress(draft('work', { label: 'Work' }));
  assert.equal(own().length, 2);
  assert.equal(getDefaultCustomerAddress(own(), ownerPhone)?.id, 'home');
  edit(draft('home', { label: 'Updated Home' }));
  assert.equal(own().length, 2);
  assert.equal(own()[0].label, 'Updated Home');
  assert.equal(own()[0].isDefault, true);
  useDemoStore.getState().setDefaultCustomerAddress('work');
  assert.equal(own()[0].id, 'work');
  assert.equal(own().filter((address) => address.isDefault).length, 1);
  edit(draft('home', { isDefault: true }));
  assert.equal(own()[0].id, 'home');
  assert.equal(own().filter((address) => address.isDefault).length, 1);
});

test('deleting the default promotes a remaining address and deleting the last address leaves none', () => {
  reset();
  signIn();
  for (const id of ['home', 'work', 'other'])
    useDemoStore.getState().saveCustomerAddress(draft(id));
  useDemoStore.getState().removeCustomerAddress('other');
  assert.equal(own()[0].id, 'home');
  useDemoStore.getState().removeCustomerAddress('home');
  assert.deepEqual(
    own().map(({ id, isDefault }) => ({ id, isDefault })),
    [{ id: 'work', isDefault: true }],
  );
  useDemoStore.getState().removeCustomerAddress('work');
  assert.deepEqual(own(), []);
  assert.equal(getDefaultCustomerAddress(own(), ownerPhone), undefined);
  useDemoStore.getState().saveCustomerAddress(draft('new-home'));
  assert.equal(own()[0].isDefault, true);
});

test('one customer cannot edit, remove or make another customer’s address the default', () => {
  reset();
  signIn();
  useDemoStore.getState().saveCustomerAddress(draft('first-owner-home'));
  signIn(otherPhone);
  useDemoStore.getState().saveCustomerAddress(draft('other-owner-home'));
  const before = structuredClone(useDemoStore.getState().savedAddresses);
  assert.throws(
    () => useDemoStore.getState().saveCustomerAddress(draft('first-owner-home')),
    /not available for your signed-in mobile/,
  );
  assert.throws(
    () => useDemoStore.getState().removeCustomerAddress('first-owner-home'),
    /not available for your signed-in mobile/,
  );
  assert.throws(
    () => useDemoStore.getState().setDefaultCustomerAddress('first-owner-home'),
    /not available for your signed-in mobile/,
  );
  assert.deepEqual(useDemoStore.getState().savedAddresses, before);
  useDemoStore.getState().saveCustomerAddress(draft('other-work', { isDefault: true }));
  assert.equal(own(otherPhone)[0].id, 'other-work');
  assert.equal(own()[0].id, 'first-owner-home');
  assert.equal(own()[0].isDefault, true);
  signIn();
  assert.deepEqual(
    own().map((address) => address.id),
    ['first-owner-home'],
  );
});

test('delivery address validation rejects incomplete or oversized fields without saving any record', () => {
  reset();
  signIn();
  const base = draft();
  const invalid = [
    { ...base, id: ' ' },
    { ...base, id: 'x'.repeat(101) },
    { ...base, label: ' ' },
    { ...base, label: 'x'.repeat(41) },
    { ...base, customer: { ...base.customer, name: ' ' } },
    { ...base, customer: { ...base.customer, name: 'x'.repeat(81) } },
    { ...base, customer: { ...base.customer, address: 'short' } },
    { ...base, customer: { ...base.customer, address: 'x'.repeat(301) } },
    { ...base, customer: { ...base.customer, locality: ' ' } },
    { ...base, customer: { ...base.customer, locality: 'x'.repeat(101) } },
    { ...base, customer: { ...base.customer, postalCode: '20802' } },
    { ...base, customer: { ...base.customer, postalCode: '2080277' } },
    { ...base, customer: { ...base.customer, postalCode: '20802x' } },
    { ...base, customer: { ...base.customer, landmark: 'x'.repeat(151) } },
  ];
  for (const input of invalid) {
    assert.throws(() => useDemoStore.getState().saveCustomerAddress(input));
    assert.deepEqual(useDemoStore.getState().savedAddresses, []);
  }
  // Address books can include valid postal codes outside a branch’s current service area.
  const outsideCurrentArea = { ...base, customer: { ...base.customer, postalCode: '110001' } };
  assert.equal(parseCustomerAddress(outsideCurrentArea, ownerPhone).customer.postalCode, '110001');
});

test('the ten-address limit is per owner and still permits editing an existing address', () => {
  reset();
  signIn();
  for (let index = 0; index < 10; index++)
    useDemoStore.getState().saveCustomerAddress(draft(`address-${index}`));
  assert.equal(own().length, 10);
  assert.throws(
    () => useDemoStore.getState().saveCustomerAddress(draft('eleventh')),
    /up to 10 addresses/,
  );
  edit(draft('address-0', { label: 'Edited at limit' }));
  assert.equal(own()[0].label, 'Edited at limit');
  assert.equal(own().length, 10);
  signIn(otherPhone);
  useDemoStore.getState().saveCustomerAddress(draft('other-owner-first'));
  assert.equal(own(otherPhone).length, 1);
  assert.equal(own().length, 10);
});

test('editing or removing a saved address cannot rewrite a placed order’s customer snapshot', () => {
  reset();
  signIn();
  useDemoStore.getState().saveCustomerAddress(draft());
  const customer = own()[0].customer;
  const product = {
    ...initialProducts.find((item) => item.slug === 'french-fries')!,
    price: 30000,
  };
  useDemoStore.setState({ products: [product] });
  useDemoStore.getState().addToCart({
    productId: product.id,
    quantity: 1,
    toppingIds: [],
    notes: '',
  });
  const order = useDemoStore.getState().createOrder({
    customer,
    fulfillment: 'delivery',
    paymentMethod: 'cash',
    paymentStatus: 'pending',
    idempotencyKey: 'saved-address-order-first',
    branchId: 'barra',
  });
  const before = structuredClone(order.customer);
  edit({
    ...draft(),
    customer: { ...draft().customer, address: '456 Updated Street, Building 3' },
  });
  useDemoStore.getState().removeCustomerAddress('home');
  assert.deepEqual(
    useDemoStore.getState().orders.find((item) => item.id === order.id)?.customer,
    before,
  );
});

test('v8 migration adds the address book without changing saved branches, cart, orders or sessions', () => {
  const state = {
    branches: structuredClone(initialBranches),
    selectedBranchId: 'barra',
    adminBranchId: 'barra',
    cartBranchId: 'barra',
    settings: structuredClone(initialSettings),
    orders: structuredClone(initialOrders),
    cart: [{ id: 'existing-cart' }],
    coupon: 'KEEPME',
    customerSession: { phone: ownerPhone },
    adminSession: true,
  };
  const migrated = migrateDemoState(state, 7);
  assert.deepEqual(migrated.savedAddresses, []);
  for (const key of ['branches', 'settings', 'orders', 'cart', 'customerSession'] as const)
    assert.strictEqual(migrated[key], state[key]);
  assert.equal(migrated.coupon, 'KEEPME');
  assert.equal(migrated.adminSession, true);
  assert.equal(migrated.selectedBranchId, 'barra');
  const existing = [{ ...draft(), ownerPhone }];
  const withExisting = migrateDemoState({ ...state, savedAddresses: existing }, 7);
  assert.strictEqual(withExisting.savedAddresses, existing);
  assert.strictEqual(migrateDemoState(withExisting, STORE_VERSION), withExisting);
});

test('address persistence round-trips and deletion persists using isolated in-memory browser storage', async () => {
  reset();
  signIn();
  useDemoStore.getState().saveCustomerAddress(draft());
  const options = useDemoStore.persist.getOptions();
  assert.ok(options.partialize);
  let serialized = JSON.stringify({
    state: options.partialize(useDemoStore.getState()),
    version: STORE_VERSION,
  });
  assert.equal(JSON.parse(serialized).state.savedAddresses[0].id, 'home');
  useDemoStore.setState({ savedAddresses: [], customerSession: null });
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: () => serialized,
        setItem: (_key: string, value: string) => {
          serialized = value;
        },
        removeItem: () => {},
      },
    },
  });
  try {
    await useDemoStore.persist.rehydrate();
    assert.equal(own()[0].id, 'home');
    assert.equal(useDemoStore.getState().customerSession?.phone, ownerPhone);
    useDemoStore.getState().removeCustomerAddress('home');
    assert.deepEqual(JSON.parse(serialized).state.savedAddresses, []);
    assert.equal(JSON.parse(serialized).version, STORE_VERSION);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
