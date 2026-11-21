import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applySharedCheckoutDefault,
  clearSharedCheckoutDraft,
  clearSharedCheckoutIdentityDrafts,
  loadSharedCheckoutDraft,
  newSharedCheckoutDraft,
  saveSharedCheckoutDraft,
  sharedCheckoutAddressState,
  sharedCheckoutDraftKey,
} from '../lib/shared-checkout-draft';
import type { SharedSavedAddress } from '../lib/commerce/addresses';

const account = { branchId: 'barra', userId: 'account-one' };
const saved: SharedSavedAddress = {
  id: '3847f804-5260-4144-b69b-ae1bbbf6aa50',
  label: 'Home',
  isDefault: true,
  customer: {
    name: 'Test Customer',
    phone: '9876543210',
    address: '12 Test Road, Apartment 2',
    locality: 'Barra',
    postalCode: '208027',
    landmark: 'Near the park',
    instructions: '',
  },
};
function memoryStorage() {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

test('a cloud default autofills a new delivery once, preserving editable contact and revision', () => {
  const initial = newSharedCheckoutDraft(account);
  const filled = applySharedCheckoutDefault(initial, saved, 4);
  assert.deepEqual(filled.customer, saved.customer);
  assert.equal(filled.selectedAddressRevision, 4);
  assert.equal(filled.identity, account.userId);
  assert.equal('ownerPhone' in filled.selectedAddressSnapshot!, false);
  const changed = { ...saved, customer: { ...saved.customer, address: 'Changed in another tab' } };
  assert.equal(applySharedCheckoutDefault(filled, changed, 5), filled);
});

test('a delayed address book never replaces typed, restored, pickup, or guest checkout details', () => {
  const initial = newSharedCheckoutDraft(account);
  const candidates = [
    { ...initial, customer: { ...initial.customer, phone: '9988776655' } },
    { ...initial, customer: { ...initial.customer, address: 'Partly entered address' } },
    { ...initial, addressTouched: true },
    { ...initial, fulfillment: 'pickup' as const },
    newSharedCheckoutDraft({ ...account, userId: null }),
  ];
  for (const current of candidates)
    assert.equal(applySharedCheckoutDefault(current, saved, 9), current);
});

test('shared checkout drafts survive navigation within their UID and branch without phone ownership', () => {
  const storage = memoryStorage();
  const filled = applySharedCheckoutDefault(newSharedCheckoutDraft(account), saved, 7);
  const draft = {
    ...filled,
    customer: { ...filled.customer, phone: '9988776655', instructions: 'Call at the gate' },
    addressTouched: true,
  };
  assert.equal(saveSharedCheckoutDraft(storage, account, draft), true);
  assert.deepEqual(loadSharedCheckoutDraft(storage, account), draft);
  for (const other of [
    { ...account, userId: 'account-two' },
    { ...account, userId: null },
    { ...account, branchId: 'civil-lines' },
  ]) {
    assert.equal(loadSharedCheckoutDraft(storage, other), null);
    storage.setItem(sharedCheckoutDraftKey(other), JSON.stringify(draft));
    assert.equal(loadSharedCheckoutDraft(storage, other), null);
  }
});

test('malformed and oversized draft fields fail closed while partial customer input remains usable', () => {
  const storage = memoryStorage();
  const initial = newSharedCheckoutDraft(account);
  for (const bad of [
    '{broken',
    JSON.stringify({ ...initial, version: 2 }),
    JSON.stringify({ ...initial, customer: { ...initial.customer, postalCode: '1234567' } }),
    JSON.stringify({ ...initial, customer: { ...initial.customer, name: null } }),
    JSON.stringify({ ...initial, selectedAddressRevision: -1 }),
    JSON.stringify({ ...initial, selectedAddressRevision: 1.5 }),
    JSON.stringify({ ...initial, addressTouched: 'yes' }),
  ]) {
    storage.setItem(sharedCheckoutDraftKey(account), bad);
    assert.equal(loadSharedCheckoutDraft(storage, account), null);
  }
  const partial = { ...initial, customer: { ...initial.customer, postalCode: '208', name: 'A' } };
  assert.equal(saveSharedCheckoutDraft(storage, account, partial), true);
  assert.deepEqual(loadSharedCheckoutDraft(storage, account), partial);
});

test('selected addresses become reviewable on remote changes or deletion without changing entered order details', () => {
  const draft = applySharedCheckoutDefault(newSharedCheckoutDraft(account), saved, 4);
  const entered = { ...draft.customer, address: 'Customer edited order address' };
  const receiptSnapshot = JSON.stringify({ ...draft, customer: entered });
  assert.equal(sharedCheckoutAddressState(saved.id, saved, saved), 'current');
  for (const changed of [
    { ...saved, isDefault: false },
    { ...saved, label: 'My home' },
    { ...saved, customer: { ...saved.customer, phone: '9988776655' } },
    { ...saved, customer: { ...saved.customer, address: 'Changed remotely' } },
  ])
    assert.equal(sharedCheckoutAddressState(saved.id, saved, changed), 'changed');
  assert.equal(sharedCheckoutAddressState(saved.id, saved), 'removed');
  assert.equal(sharedCheckoutAddressState(saved.id, null, saved), 'unverified');
  assert.equal(sharedCheckoutAddressState('', null), 'new');
  assert.equal(JSON.stringify({ ...draft, customer: entered }), receiptSnapshot);
});

test('account sign-out cleanup removes only that UID across branches including pending attempts', () => {
  const storage = memoryStorage();
  const owned = [account, { ...account, branchId: 'civil-lines' }];
  const other = { ...account, userId: 'account-two' };
  const guest = { ...account, userId: null };
  for (const scope of [...owned, other, guest]) {
    saveSharedCheckoutDraft(storage, scope, newSharedCheckoutDraft(scope));
    storage.setItem(`${sharedCheckoutDraftKey(scope)}:attempt`, 'pending-order');
  }
  storage.setItem('unrelated', 'keep');
  const legacyKey = `shared:${account.userId}:hot-pizza-ace-checkout-draft:v1:barra:guest`;
  storage.setItem(legacyKey, 'legacy account draft');
  storage.setItem(`${legacyKey}:attempt`, 'legacy account attempt');
  clearSharedCheckoutIdentityDrafts(storage, account.userId);
  for (const scope of owned) {
    assert.equal(loadSharedCheckoutDraft(storage, scope), null);
    assert.equal(storage.getItem(`${sharedCheckoutDraftKey(scope)}:attempt`), null);
  }
  assert.ok(loadSharedCheckoutDraft(storage, other));
  assert.ok(loadSharedCheckoutDraft(storage, guest));
  assert.equal(storage.getItem('unrelated'), 'keep');
  assert.equal(storage.getItem(legacyKey), null);
  assert.equal(storage.getItem(`${legacyKey}:attempt`), null);
});

test('order completion clears its scoped draft and attempt; unavailable storage never blocks ordering', () => {
  const storage = memoryStorage();
  const other = { ...account, branchId: 'other' };
  saveSharedCheckoutDraft(storage, account, newSharedCheckoutDraft(account));
  saveSharedCheckoutDraft(storage, other, newSharedCheckoutDraft(other));
  storage.setItem(`${sharedCheckoutDraftKey(account)}:attempt`, 'attempt');
  clearSharedCheckoutDraft(storage, account);
  assert.equal(loadSharedCheckoutDraft(storage, account), null);
  assert.equal(storage.getItem(`${sharedCheckoutDraftKey(account)}:attempt`), null);
  assert.ok(loadSharedCheckoutDraft(storage, other));
  assert.equal(saveSharedCheckoutDraft(undefined, account, newSharedCheckoutDraft(account)), false);
  assert.equal(loadSharedCheckoutDraft(undefined, account), null);
  assert.doesNotThrow(() => clearSharedCheckoutDraft(undefined, account));
  assert.doesNotThrow(() => clearSharedCheckoutIdentityDrafts(undefined, account.userId));
});
