import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHECKOUT_DRAFT_VERSION,
  checkoutDraftKey,
  clearCheckoutDraft,
  clearMatchingGuestCheckoutDraft,
  emptyCheckoutCustomer,
  initializeCheckoutDraft,
  isCheckoutScopeCurrent,
  isCompletedCheckout,
  getSelectedCheckoutAddressState,
  loadCheckoutDraft,
  saveCheckoutDraft,
} from '../lib/checkout-draft';
import type { Customer, Order, SavedAddress } from '../types';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
const scope = { branchId: 'barra', phone: '9876543210' };
const customer: Customer = {
  name: 'Checkout Customer',
  phone: '9876543210',
  address: '12 Test Road, Apartment 2',
  locality: 'Barra',
  postalCode: '208027',
  landmark: 'Near the park',
  instructions: 'Call at the gate',
};
const defaultAddress = {
  id: 'home-address',
  label: 'Home',
  customer: { ...customer, instructions: 'Old order note' },
};
const savedAddress: SavedAddress = {
  ...defaultAddress,
  ownerPhone: scope.phone,
  isDefault: true,
  customer: { ...customer, instructions: '' },
};

test('versioned checkout drafts retain partial form fields, optional notes, fulfillment and payment across reload', () => {
  const storage = memoryStorage();
  const initial = initializeCheckoutDraft(scope, null);
  const edited = {
    ...initial,
    customer: { ...customer, address: 'Partly typed address' },
    fulfillment: 'pickup' as const,
    paymentMethod: 'cash' as const,
    selectedAddressId: 'home-address',
    addressLabel: 'My place',
  };
  assert.equal(saveCheckoutDraft(storage, scope, edited), true);
  const restored = loadCheckoutDraft(storage, scope);
  assert.deepEqual(restored, edited);
  assert.equal(restored?.version, CHECKOUT_DRAFT_VERSION);
  assert.deepEqual(initializeCheckoutDraft(scope, restored, defaultAddress), edited);
});

test('draft scope isolates guests, branches and signed-in customers and normalizes equivalent phone numbers', () => {
  const storage = memoryStorage();
  const edited = { ...initializeCheckoutDraft(scope, null), customer };
  saveCheckoutDraft(storage, scope, edited);
  assert.deepEqual(
    loadCheckoutDraft(storage, { branchId: 'barra', phone: '+91 98765 43210' }),
    edited,
  );
  for (const other of [
    { branchId: 'barra' },
    { branchId: 'civil-lines', phone: scope.phone },
    { branchId: 'barra', phone: '9988776655' },
  ])
    assert.equal(loadCheckoutDraft(storage, other), null);
  assert.notEqual(
    checkoutDraftKey({ branchId: 'barra:guest' }),
    checkoutDraftKey({ branchId: 'barra' }),
  );
  const wrongScope = { branchId: 'civil-lines', phone: scope.phone };
  storage.setItem(checkoutDraftKey(wrongScope), JSON.stringify(edited));
  assert.equal(loadCheckoutDraft(storage, wrongScope), null);
});

test('malformed or unsupported drafts are ignored while valid incomplete fields are restored safely', () => {
  const storage = memoryStorage();
  const base = initializeCheckoutDraft(scope, null);
  for (const invalid of [
    '{broken-json',
    JSON.stringify({ ...base, version: CHECKOUT_DRAFT_VERSION + 1 }),
    JSON.stringify({ ...base, identity: '9988776655' }),
    JSON.stringify({ ...base, customer: { ...base.customer, name: null } }),
    JSON.stringify({ ...base, customer: { ...base.customer, postalCode: '1234567' } }),
    JSON.stringify({ ...base, paymentMethod: 'bank-transfer' }),
    JSON.stringify({ ...base, fulfillment: 'courier' }),
    JSON.stringify({ ...base, addressLabel: 'X'.repeat(41) }),
  ]) {
    storage.setItem(checkoutDraftKey(scope), invalid);
    assert.equal(loadCheckoutDraft(storage, scope), null);
  }
  const incomplete = { ...base, customer: { ...base.customer, name: 'A', postalCode: '208' } };
  assert.equal(saveCheckoutDraft(storage, scope, incomplete), true);
  assert.deepEqual(loadCheckoutDraft(storage, scope), incomplete);
});

test('an edited draft wins over default address changes; empty forms may autofill without changing fulfillment choices', () => {
  const blank = initializeCheckoutDraft(scope, null);
  const chosen = initializeCheckoutDraft(
    scope,
    { ...blank, fulfillment: 'pickup', paymentMethod: 'card' },
    defaultAddress,
  );
  assert.equal(chosen.customer.address, defaultAddress.customer.address);
  assert.equal(chosen.customer.instructions, '');
  assert.equal(chosen.fulfillment, 'pickup');
  assert.equal(chosen.paymentMethod, 'card');
  assert.equal(chosen.selectedAddressId, defaultAddress.id);
  const partial = {
    ...chosen,
    customer: { ...emptyCheckoutCustomer(scope.phone), address: 'My unfinished new address' },
  };
  const changedDefault = {
    ...defaultAddress,
    customer: { ...customer, address: 'Changed elsewhere' },
  };
  assert.deepEqual(initializeCheckoutDraft(scope, partial, changedDefault), partial);
  assert.equal(
    initializeCheckoutDraft({ branchId: 'barra' }, null, defaultAddress).customer.address,
    '',
  );
});

test('signed-in drafts always lock the contact phone to the authenticated customer', () => {
  const storage = memoryStorage();
  const edited = {
    ...initializeCheckoutDraft(scope, null),
    customer: { ...customer, phone: '9988776655' },
  };
  assert.equal(saveCheckoutDraft(storage, scope, edited), true);
  assert.equal(loadCheckoutDraft(storage, scope)?.customer.phone, scope.phone);
});

test('same-phone guest checkout may transfer on sign-in only when no customer draft or default exists', () => {
  const guestScope = { branchId: 'barra' };
  const guest = {
    ...initializeCheckoutDraft(guestScope, null),
    customer: { ...customer, phone: '+91 98765 43210' },
    paymentMethod: 'cash' as const,
  };
  const transferred = initializeCheckoutDraft(scope, null, undefined, guest);
  assert.equal(transferred.identity, scope.phone);
  assert.equal(transferred.customer.address, customer.address);
  assert.equal(transferred.customer.phone, scope.phone);
  assert.equal(transferred.paymentMethod, 'cash');
  const otherCustomer = initializeCheckoutDraft(
    { branchId: 'barra', phone: '9988776655' },
    null,
    undefined,
    guest,
  );
  assert.equal(otherCustomer.customer.address, '');
  assert.equal(
    initializeCheckoutDraft({ branchId: 'civil-lines', phone: scope.phone }, null, undefined, guest)
      .customer.address,
    '',
  );
  const saved = {
    ...initializeCheckoutDraft(scope, null),
    customer: { ...customer, address: 'Existing customer draft' },
  };
  assert.equal(
    initializeCheckoutDraft(scope, saved, undefined, guest).customer.address,
    'Existing customer draft',
  );
  const suggestion = {
    ...defaultAddress,
    customer: { ...customer, address: 'My default saved address' },
  };
  assert.equal(
    initializeCheckoutDraft(scope, null, suggestion, guest).customer.address,
    'My default saved address',
  );
});

test('consuming a matching guest draft preserves other customers and branches', () => {
  const storage = memoryStorage();
  const guestScope = { branchId: 'barra' };
  saveCheckoutDraft(storage, guestScope, {
    ...initializeCheckoutDraft(guestScope, null),
    customer,
  });
  saveCheckoutDraft(storage, scope, { ...initializeCheckoutDraft(scope, null), customer });
  const otherBranch = { branchId: 'civil-lines' };
  saveCheckoutDraft(storage, otherBranch, {
    ...initializeCheckoutDraft(otherBranch, null),
    customer,
  });
  assert.equal(
    clearMatchingGuestCheckoutDraft(storage, { branchId: 'barra', phone: '9988776655' }),
    false,
  );
  assert.ok(loadCheckoutDraft(storage, guestScope));
  assert.equal(clearMatchingGuestCheckoutDraft(storage, scope), true);
  assert.equal(loadCheckoutDraft(storage, guestScope), null);
  assert.ok(loadCheckoutDraft(storage, scope));
  assert.ok(loadCheckoutDraft(storage, otherBranch));
});

test('completed cash and paid checkouts clear their draft while failed or unpaid retries retain theirs', () => {
  const storage = memoryStorage();
  const states: Pick<Order, 'paymentMethod' | 'paymentStatus'>[] = [
    { paymentMethod: 'cash', paymentStatus: 'pending' },
    { paymentMethod: 'upi', paymentStatus: 'simulated_paid' },
    { paymentMethod: 'card', paymentStatus: 'simulated_paid' },
    { paymentMethod: 'upi', paymentStatus: 'initiated' },
    { paymentMethod: 'card', paymentStatus: 'pending' },
    { paymentMethod: 'upi', paymentStatus: 'failed' },
  ];
  for (const order of states) {
    const draft = {
      ...initializeCheckoutDraft(scope, null),
      customer,
      paymentMethod: order.paymentMethod,
    };
    saveCheckoutDraft(storage, scope, draft);
    const completed = order.paymentMethod === 'cash' || order.paymentStatus === 'simulated_paid';
    assert.equal(isCompletedCheckout(order), completed);
    if (isCompletedCheckout(order)) clearCheckoutDraft(storage, scope);
    assert.deepEqual(loadCheckoutDraft(storage, scope), completed ? null : draft);
  }
});

test('unavailable browser storage never prevents checkout from using its in-memory draft', () => {
  const blocked = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
    removeItem: () => {
      throw new Error('blocked');
    },
  };
  const draft = initializeCheckoutDraft(scope, loadCheckoutDraft(blocked, scope), defaultAddress);
  assert.equal(draft.customer.address, defaultAddress.customer.address);
  assert.equal(saveCheckoutDraft(blocked, scope, draft), false);
  assert.equal(clearCheckoutDraft(blocked, scope), false);
  assert.equal(saveCheckoutDraft(undefined, scope, draft), false);
  assert.equal(clearMatchingGuestCheckoutDraft(blocked, scope), false);
});

test('legacy v1 drafts retain all entered details when a selected-address snapshot is missing', () => {
  const storage = memoryStorage();
  const draft = {
    ...initializeCheckoutDraft(scope, null),
    customer,
    fulfillment: 'pickup' as const,
    paymentMethod: 'cash' as const,
    selectedAddressId: savedAddress.id,
    addressLabel: savedAddress.label,
  };
  const legacy: Record<string, unknown> = { ...draft };
  delete legacy.selectedAddressSnapshot;
  storage.setItem(checkoutDraftKey(scope), JSON.stringify(legacy));
  const restored = loadCheckoutDraft(storage, scope)!;
  assert.deepEqual(restored.customer, customer);
  assert.equal(restored.fulfillment, 'pickup');
  assert.equal(restored.paymentMethod, 'cash');
  assert.equal(restored.selectedAddressSnapshot, null);
  assert.equal(
    getSelectedCheckoutAddressState(
      restored.selectedAddressId,
      restored.selectedAddressSnapshot,
      savedAddress,
    ),
    'unverified',
  );
});

test('removed or externally edited saved addresses preserve draft edits and retain the original update snapshot', () => {
  const storage = memoryStorage();
  const initial = initializeCheckoutDraft(scope, null, savedAddress);
  assert.deepEqual(initial.selectedAddressSnapshot, savedAddress);
  const edited = {
    ...initial,
    customer: {
      ...initial.customer,
      address: 'User edited this order address',
      instructions: 'This order only',
    },
  };
  saveCheckoutDraft(storage, scope, edited);
  const changedElsewhere = {
    ...savedAddress,
    customer: { ...savedAddress.customer, address: 'Other tab changed the saved address' },
  };
  const restored = initializeCheckoutDraft(
    scope,
    loadCheckoutDraft(storage, scope),
    changedElsewhere,
  );
  assert.deepEqual(restored.customer, edited.customer);
  assert.deepEqual(restored.selectedAddressSnapshot, savedAddress);
  assert.equal(
    getSelectedCheckoutAddressState(
      restored.selectedAddressId,
      restored.selectedAddressSnapshot,
      changedElsewhere,
    ),
    'changed',
  );
  assert.equal(
    getSelectedCheckoutAddressState(restored.selectedAddressId, restored.selectedAddressSnapshot),
    'removed',
  );
  assert.equal(
    getSelectedCheckoutAddressState(
      restored.selectedAddressId,
      restored.selectedAddressSnapshot,
      savedAddress,
    ),
    'current',
  );
  assert.equal(getSelectedCheckoutAddressState('', null), 'new');
});

test('untrusted selected-address snapshots cannot cross customer ownership or address IDs', () => {
  const storage = memoryStorage();
  const draft = initializeCheckoutDraft(scope, null, savedAddress);
  for (const selectedAddressSnapshot of [
    { ...savedAddress, ownerPhone: '9988776655' },
    { ...savedAddress, id: 'different-address' },
  ]) {
    storage.setItem(checkoutDraftKey(scope), JSON.stringify({ ...draft, selectedAddressSnapshot }));
    const restored = loadCheckoutDraft(storage, scope)!;
    assert.deepEqual(restored.customer, draft.customer);
    assert.equal(restored.selectedAddressSnapshot, null);
  }
});

test('checkout continuation scope rejects logout, customer changes and branch changes', () => {
  assert.equal(
    isCheckoutScopeCurrent(scope, { branchId: 'barra', phone: '+91 98765 43210' }),
    true,
  );
  assert.equal(isCheckoutScopeCurrent(scope, { branchId: 'barra' }), false);
  assert.equal(isCheckoutScopeCurrent(scope, { branchId: 'barra', phone: '9988776655' }), false);
  assert.equal(
    isCheckoutScopeCurrent(scope, { branchId: 'civil-lines', phone: scope.phone }),
    false,
  );
  assert.equal(isCheckoutScopeCurrent(scope, { branchId: 'barra', phone: 'bad-phone' }), false);
  assert.equal(isCheckoutScopeCurrent({ branchId: 'barra' }, scope), false);
  assert.equal(isCheckoutScopeCurrent({ branchId: 'barra' }, { branchId: 'barra' }), true);
});
