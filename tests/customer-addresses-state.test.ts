import assert from 'node:assert/strict';
import test from 'node:test';
import { CustomerAddressesState } from '../lib/customer-addresses-state';
import { CommerceError } from '../lib/commerce/client';
import type { SharedAddressBook, SharedAddressMutation } from '../lib/commerce/addresses';

const address = {
  id: 'b65df004-138a-4548-a1af-f6971d1b30b3',
  label: 'Home',
  customer: {
    name: 'Test Customer',
    phone: '9876543210',
    address: '12 Example Street',
    locality: 'Kanpur',
    postalCode: '208001',
    landmark: '',
    instructions: '',
  },
  isDefault: true,
};
const book = (revision: number, name = 'Test Customer'): SharedAddressBook => ({
  revision,
  addresses: [{ ...address, customer: { ...address.customer, name } }],
});
const input: SharedAddressMutation = { action: 'default', expectedRevision: 1, id: address.id };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (value: unknown) => void;
  const promise = new Promise<T>((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
}

test('an old account read cannot reveal contacts after a switch, even when abort is ignored', async () => {
  const oldRead = deferred<unknown>();
  let reads = 0;
  const state = new CustomerAddressesState({
    read: async () => (++reads === 1 ? oldRead.promise : book(1, 'Second Account')),
    mutate: async () => book(2),
  });
  state.setIdentity('first');
  const pending = state.refresh();
  state.setIdentity('second');
  assert.equal(state.getSnapshot().book, null);
  await state.refresh();
  oldRead.resolve(book(8, 'First Account Private Contact'));
  await pending;
  assert.equal(state.getSnapshot().userId, 'second');
  assert.equal(state.getSnapshot().book?.addresses[0].customer.name, 'Second Account');
  state.dispose();
});

test('background polling leaves a slow read alive so its own timeout can finish', async () => {
  const read = deferred<unknown>();
  let reads = 0;
  let readSignal: AbortSignal | undefined;
  const state = new CustomerAddressesState({
    read: async (signal) => {
      ++reads;
      readSignal = signal;
      return read.promise;
    },
    mutate: async () => book(2),
  });
  state.setIdentity('first');
  const pending = state.refresh();
  await state.refreshIfIdle();
  await state.refreshIfIdle();
  assert.equal(reads, 1);
  assert.equal(readSignal?.aborted, false);
  read.resolve(book(1));
  await pending;
  assert.equal(state.getSnapshot().loading, false);
  state.dispose();
});

test('sign-out clears a pending write and its late response cannot restore contacts or retry', async () => {
  const write = deferred<unknown>();
  let writes = 0;
  let writeSignal: AbortSignal | undefined;
  const state = new CustomerAddressesState({
    read: async () => book(1),
    mutate: async (_input, signal) => {
      ++writes;
      writeSignal = signal;
      return write.promise;
    },
  });
  state.setIdentity('first');
  await state.refresh();
  const pending = state.mutate(input);
  state.setIdentity(null);
  assert.equal(writeSignal?.aborted, true);
  write.resolve(book(2));
  await assert.rejects(
    pending,
    (error: unknown) => error instanceof CommerceError && error.code === 'address_identity_changed',
  );
  assert.deepEqual(state.getSnapshot(), {
    userId: null,
    book: null,
    loading: false,
    saving: false,
    error: null,
    errorCode: null,
  });
  assert.equal(writes, 1);
});

test('a read started before a write cannot replace the committed address book', async () => {
  const oldRead = deferred<unknown>();
  let reads = 0;
  const state = new CustomerAddressesState({
    read: async () => (++reads === 1 ? book(1) : oldRead.promise),
    mutate: async () => book(2, 'Updated Contact'),
  });
  state.setIdentity('first');
  await state.refresh();
  const pending = state.refresh();
  await state.mutate(input);
  oldRead.resolve(book(1));
  await pending;
  assert.equal(state.getSnapshot().book?.revision, 2);
  assert.equal(state.getSnapshot().book?.addresses[0].customer.name, 'Updated Contact');
  state.dispose();
});

test('a delayed mutation response cannot regress a newer book refreshed from another device', async () => {
  const write = deferred<unknown>();
  let reads = 0;
  const state = new CustomerAddressesState({
    read: async () => book(++reads === 1 ? 1 : 3, reads === 1 ? 'First Contact' : 'Newest Contact'),
    mutate: async () => write.promise,
  });
  state.setIdentity('first');
  await state.refresh();
  const pending = state.mutate(input);
  await state.refresh();
  write.resolve(book(2, 'Older Contact'));
  const result = await pending;
  assert.equal(result.revision, 3);
  assert.equal(state.getSnapshot().book?.addresses[0].customer.name, 'Newest Contact');
  state.dispose();
});

test('a stale editor refreshes for review without sending a mutation', async () => {
  let writes = 0;
  let reads = 0;
  const state = new CustomerAddressesState({
    read: async () => book(++reads),
    mutate: async () => {
      ++writes;
      return book(3);
    },
  });
  state.setIdentity('first');
  await state.refresh();
  await assert.rejects(
    state.mutate({ ...input, expectedRevision: 0 }),
    (error: unknown) =>
      error instanceof CommerceError && error.code === 'address_revision_conflict',
  );
  assert.equal(writes, 0);
  assert.equal(reads, 2);
  assert.equal(state.getSnapshot().book?.revision, 2);
  state.dispose();
});

test('a server conflict triggers one refresh and never automatically replays the write', async () => {
  let writes = 0;
  let reads = 0;
  const state = new CustomerAddressesState({
    read: async () => book(++reads),
    mutate: async () => {
      ++writes;
      throw new CommerceError('PRIVATE provider payload', 409, 'address_duplicate');
    },
  });
  state.setIdentity('first');
  await state.refresh();
  await assert.rejects(
    state.mutate(input),
    (error: unknown) =>
      error instanceof CommerceError &&
      error.code === 'address_duplicate' &&
      !error.message.includes('PRIVATE'),
  );
  assert.equal(writes, 1);
  assert.equal(reads, 2);
  assert.equal(state.getSnapshot().book?.revision, 2);
  assert.match(state.getSnapshot().error ?? '', /already saved/);
  assert.equal(state.getSnapshot().saving, false);
  state.dispose();
});

test('response loss keeps the current book and does not silently retry a mutation', async () => {
  let reads = 0;
  let writes = 0;
  const state = new CustomerAddressesState({
    read: async () => {
      ++reads;
      return book(1);
    },
    mutate: async () => {
      ++writes;
      throw new Error('private network text');
    },
  });
  state.setIdentity('first');
  await state.refresh();
  await assert.rejects(state.mutate(input), /couldn’t sync/);
  assert.equal(writes, 1);
  assert.equal(reads, 1);
  assert.equal(state.getSnapshot().book?.revision, 1);
  assert.doesNotMatch(state.getSnapshot().error ?? '', /private/);
  state.dispose();
});

test('refresh service failures retain only the current account book; authorization failure clears it', async () => {
  let cause: unknown;
  const state = new CustomerAddressesState({
    read: async () => {
      if (cause) throw cause;
      return book(1);
    },
    mutate: async () => book(2),
  });
  state.setIdentity('first');
  await state.refresh();
  cause = new CommerceError('private outage', 503);
  await state.refresh();
  assert.equal(state.getSnapshot().book?.revision, 1);
  cause = new CommerceError('private auth', 401);
  await state.refresh();
  assert.equal(state.getSnapshot().book, null);
  assert.match(state.getSnapshot().error ?? '', /Sign in with Google/);
  state.dispose();
});
