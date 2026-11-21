import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_SHARED_SAVED_ADDRESSES,
  SharedAddressError,
  mutateSharedAddressBook,
  parseSharedAddressBook,
  parseSharedAddressMutation,
  parseSharedSavedAddress,
  sharedAddressFingerprint,
  type SharedAddressBook,
  type SharedSavedAddress,
} from '../lib/commerce/addresses';

function address(index = 1, options: Partial<SharedSavedAddress> = {}): SharedSavedAddress {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    label: 'Home',
    customer: {
      name: 'Fixture Recipient',
      phone: '9000000000',
      address: `${index} Fixture Street`,
      locality: 'Fixture Nagar',
      postalCode: '208027',
      landmark: '',
      instructions: '',
    },
    isDefault: false,
    ...options,
  };
}
const empty: SharedAddressBook = { revision: 0, addresses: [] };
function add(book: SharedAddressBook, value: SharedSavedAddress) {
  return mutateSharedAddressBook(book, {
    action: 'create',
    expectedRevision: book.revision,
    address: value,
  });
}
function expectFailure(operation: () => unknown, code: string, status = 400) {
  assert.throws(
    operation,
    (error) =>
      error instanceof SharedAddressError && error.code === code && error.status === status,
  );
}

test('saved addresses normalize display text, UUID case and editable Indian contact numbers', () => {
  const input = address();
  const value = parseSharedSavedAddress({
    ...input,
    id: input.id.toUpperCase(),
    label: '  Ｈｏｍｅ  ',
    customer: {
      ...input.customer,
      name: '  Fixture\t Recipient  ',
      phone: '+91 90000-00000',
      address: '  1   Fixture\nStreet  ',
      instructions: '  Call\tbefore arrival  ',
    },
  });
  assert.equal(value.id, input.id);
  assert.equal(value.label, 'Home');
  assert.equal(value.customer.phone, '9000000000');
  assert.equal(value.customer.name, 'Fixture Recipient');
  assert.equal(value.customer.address, '1 Fixture Street');
  assert.equal(value.customer.instructions, 'Call before arrival');
  assert.equal(
    parseSharedSavedAddress(address(1, { customer: { ...input.customer, postalCode: '110001' } }))
      .customer.postalCode,
    '110001',
  );
});

test('address and mutation schemas reject owner fields, unknown keys and invalid identifiers', () => {
  for (const value of [
    { ...address(), ownerPhone: '9000000000' },
    { ...address(), userId: 'another-account' },
    { ...address(), id: 'local-address-1' },
    { ...address(), isDefault: 'true' },
    { ...address(), customer: { ...address().customer, ownerId: 'another-account' } },
  ])
    expectFailure(() => parseSharedSavedAddress(value), 'address_invalid');
  for (const value of [
    { action: 'create', expectedRevision: 0, address: address(), user_id: 'another-account' },
    { action: 'remove', expectedRevision: 0, id: address().id, ownerPhone: '9000000000' },
    { action: 'create', expectedRevision: 0, address: address(), id: address(2).id },
    { action: 'default', expectedRevision: 0, id: 'invalid' },
    { action: 'replace', expectedRevision: 0, addresses: [] },
    { action: 'remove', expectedRevision: -1, id: address().id },
    { action: 'remove', expectedRevision: 0.5, id: address().id },
    { action: 'remove', expectedRevision: Number.MAX_SAFE_INTEGER + 1, id: address().id },
  ])
    expectFailure(() => parseSharedAddressMutation(value), 'address_invalid');
});

test('strict saved-address bounds reject incomplete, oversized or invalid contact data', () => {
  for (const customer of [
    { ...address().customer, name: 'x' },
    { ...address().customer, name: 'x'.repeat(81) },
    { ...address().customer, phone: '1234567890' },
    { ...address().customer, phone: '+1 9000000000' },
    { ...address().customer, address: 'short' },
    { ...address().customer, address: 'x'.repeat(301) },
    { ...address().customer, locality: 'x' },
    { ...address().customer, locality: 'x'.repeat(101) },
    { ...address().customer, postalCode: '012345' },
    { ...address().customer, postalCode: '20802' },
    { ...address().customer, postalCode: '2080270' },
    { ...address().customer, landmark: 'x'.repeat(151) },
    { ...address().customer, instructions: 'x'.repeat(301) },
    { ...address().customer, instructions: 'Call\u0000first' },
  ])
    expectFailure(() => parseSharedSavedAddress(address(1, { customer })), 'address_invalid');
  for (const label of ['', ' '.repeat(3), 'x'.repeat(41)])
    expectFailure(() => parseSharedSavedAddress(address(1, { label })), 'address_invalid');
});

test('first address automatically becomes default and accepted writes advance the revision', () => {
  const first = add(empty, address());
  assert.equal(first.revision, 1);
  assert.equal(first.addresses[0].isDefault, true);
  const second = add(first, address(2));
  assert.equal(second.revision, 2);
  assert.deepEqual(
    second.addresses.map((value) => value.isDefault),
    [true, false],
  );
  const chosen = mutateSharedAddressBook(second, {
    action: 'default',
    expectedRevision: 2,
    id: address(2).id,
  });
  assert.equal(chosen.revision, 3);
  assert.deepEqual(
    chosen.addresses.map((value) => value.isDefault),
    [false, true],
  );
  const unchangedDefault = mutateSharedAddressBook(chosen, {
    action: 'default',
    expectedRevision: 3,
    id: address(2).id,
  });
  assert.equal(unchangedDefault.revision, 4);
});

test('creating or updating another explicit default replaces the old default atomically', () => {
  const first = add(empty, address());
  const second = add(first, address(2, { isDefault: true }));
  assert.deepEqual(
    second.addresses.map((value) => value.isDefault),
    [false, true],
  );
  const changed = mutateSharedAddressBook(second, {
    action: 'update',
    expectedRevision: 2,
    address: { ...second.addresses[0], isDefault: true },
  });
  assert.deepEqual(
    changed.addresses.map((value) => value.isDefault),
    [true, false],
  );
});

test('unchecking the existing default preserves it until a different default is explicitly chosen', () => {
  const first = add(add(empty, address()), address(2));
  const changed = mutateSharedAddressBook(first, {
    action: 'update',
    expectedRevision: 2,
    address: { ...first.addresses[0], label: 'Updated home', isDefault: false },
  });
  assert.equal(changed.addresses[0].label, 'Updated home');
  assert.deepEqual(
    changed.addresses.map((value) => value.isDefault),
    [true, false],
  );
});

test('deleting the default promotes the earliest remaining address and deleting the final row empties the book', () => {
  const book = add(add(add(empty, address()), address(2)), address(3));
  const afterDefault = mutateSharedAddressBook(book, {
    action: 'remove',
    expectedRevision: 3,
    id: address().id,
  });
  assert.deepEqual(
    afterDefault.addresses.map((value) => [value.id, value.isDefault]),
    [
      [address(2).id, true],
      [address(3).id, false],
    ],
  );
  const afterOther = mutateSharedAddressBook(afterDefault, {
    action: 'remove',
    expectedRevision: 4,
    id: address(3).id,
  });
  assert.equal(afterOther.addresses[0].isDefault, true);
  const final = mutateSharedAddressBook(afterOther, {
    action: 'remove',
    expectedRevision: 5,
    id: address(2).id,
  });
  assert.deepEqual(final, { revision: 6, addresses: [] });
});

test('canonical duplicates ignore formatting, label, notes and default changes', () => {
  const first = add(empty, address());
  const duplicate = address(2, {
    label: 'Another label',
    customer: {
      ...address().customer,
      name: ' fixture, recipient ',
      phone: '+91 90000 00000',
      address: '  １, FIXTURE   STREET ',
      locality: 'fixture,nagar',
      instructions: 'Different instructions',
    },
    isDefault: true,
  });
  expectFailure(() => add(first, duplicate), 'address_duplicate', 409);
  const normalized = parseSharedSavedAddress(duplicate);
  assert.equal(
    sharedAddressFingerprint(first.addresses[0]) === sharedAddressFingerprint(normalized),
    true,
  );
});

test('different recipient phone or recipient name can distinguish an otherwise identical destination', () => {
  const first = add(empty, address());
  const second = add(
    first,
    address(2, { customer: { ...address().customer, phone: '9000000001' } }),
  );
  const third = add(
    second,
    address(3, { customer: { ...address().customer, name: 'Other Recipient' } }),
  );
  assert.equal(third.addresses.length, 3);
});

test('an update cannot collide with another destination but can change its own label and instructions', () => {
  const book = add(add(empty, address()), address(2));
  expectFailure(
    () =>
      mutateSharedAddressBook(book, {
        action: 'update',
        expectedRevision: 2,
        address: { ...book.addresses[1], customer: { ...book.addresses[0].customer } },
      }),
    'address_duplicate',
    409,
  );
  const edited = mutateSharedAddressBook(book, {
    action: 'update',
    expectedRevision: 2,
    address: {
      ...book.addresses[0],
      label: 'Front gate',
      customer: { ...book.addresses[0].customer, instructions: 'Call on arrival' },
    },
  });
  assert.equal(edited.addresses[0].label, 'Front gate');
  assert.equal(edited.addresses[0].customer.instructions, 'Call on arrival');
});

test('limit ten applies to creates while updates and removal remain available', () => {
  let book = empty;
  for (let index = 1; index <= MAX_SHARED_SAVED_ADDRESSES; index++)
    book = add(book, address(index));
  expectFailure(() => add(book, address(11)), 'address_limit', 409);
  const changed = mutateSharedAddressBook(book, {
    action: 'update',
    expectedRevision: 10,
    address: { ...book.addresses[0], label: 'Still editable' },
  });
  assert.equal(changed.addresses.length, 10);
  const removed = mutateSharedAddressBook(changed, {
    action: 'remove',
    expectedRevision: 11,
    id: address(10).id,
  });
  assert.equal(add(removed, address(11)).addresses.length, 10);
});

test('stable client IDs prevent accidental repeated creation and unknown IDs cannot be changed', () => {
  const book = add(empty, address());
  expectFailure(() => add(book, address()), 'address_conflict', 409);
  for (const action of ['update', 'remove', 'default'] as const) {
    const change =
      action === 'update'
        ? { action, expectedRevision: 1, address: address(2) }
        : { action, expectedRevision: 1, id: address(2).id };
    expectFailure(() => mutateSharedAddressBook(book, change), 'address_not_found', 404);
  }
});

test('all valid write actions reject stale revisions before no-op or missing-address handling', () => {
  const book = add(empty, address());
  for (const change of [
    { action: 'create', expectedRevision: 0, address: address(2) },
    { action: 'update', expectedRevision: 0, address: address(2) },
    { action: 'remove', expectedRevision: 0, id: address(2).id },
    { action: 'default', expectedRevision: 0, id: address().id },
  ])
    expectFailure(() => mutateSharedAddressBook(book, change), 'address_revision_conflict', 409);
});

test('parsing never repairs malformed server books into a misleading empty book', () => {
  assert.deepEqual(parseSharedAddressBook(empty), empty);
  for (const value of [
    null,
    {},
    { revision: null, addresses: [] },
    { revision: 1, addresses: null },
    { ...empty, user_id: 'another-account' },
    { revision: 1, addresses: [address()] },
    { revision: 1, addresses: [address(1, { isDefault: true }), address(2, { isDefault: true })] },
    { revision: 1, addresses: [address(1, { isDefault: true }), address(1)] },
    {
      revision: 1,
      addresses: [address(1, { isDefault: true }), address(2, { customer: address().customer })],
    },
  ])
    expectFailure(() => parseSharedAddressBook(value), 'address_invalid');
});

test('mutations do not modify previous snapshots or caller-owned address objects', () => {
  const source = address();
  const sourceBefore = structuredClone(source);
  const first = add(empty, source);
  const firstBefore = structuredClone(first);
  const changed = mutateSharedAddressBook(first, {
    action: 'update',
    expectedRevision: 1,
    address: { ...source, label: 'Edited' },
  });
  changed.addresses[0].customer.name = 'Later local edit';
  assert.deepEqual(source, sourceBefore);
  assert.deepEqual(first, firstBefore);
  assert.deepEqual(empty, { revision: 0, addresses: [] });
});
