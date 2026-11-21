import assert from 'node:assert/strict';
import test from 'node:test';
import { startAddressRefresh } from '../lib/address-refresh-policy';
import { CustomerAddressesState } from '../lib/customer-addresses-state';
import { CommerceError } from '../lib/commerce/client';
import type { SharedAddressBook } from '../lib/commerce/addresses';
import type { VisiblePollingEnvironment } from '../lib/visible-polling';

class Events {
  private listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, listener: () => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
  get size() {
    return [...this.listeners.values()].reduce((count, listeners) => count + listeners.size, 0);
  }
}

function browser(visibilityState = 'visible') {
  const document = Object.assign(new Events(), { visibilityState });
  const window = new Events();
  let now = 0;
  let nextTimer = 0;
  const timers = new Map<number, { callback: () => void; interval: number; due: number }>();
  const environment: VisiblePollingEnvironment = {
    document,
    window,
    now: () => now,
    setInterval(callback, interval) {
      const id = ++nextTimer;
      timers.set(id, { callback, interval, due: now + interval });
      return id;
    },
    clearInterval: (timer) => void timers.delete(timer as number),
  };
  return {
    environment,
    document,
    window,
    timers,
    advance(milliseconds: number) {
      const until = now + milliseconds;
      while (true) {
        const due = Math.min(...[...timers.values()].map((timer) => timer.due));
        if (due > until) break;
        now = due;
        for (const timer of timers.values()) {
          if (timer.due !== due) continue;
          timer.due += timer.interval;
          timer.callback();
        }
      }
      now = until;
    },
  };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const book = (revision: number): SharedAddressBook => ({ revision, addresses: [] });

function addresses(read: () => Promise<unknown>) {
  const state = new CustomerAddressesState({ read, mutate: async () => book(2) });
  state.setIdentity('customer');
  return state;
}

test('menu, owner and other account screens never load or poll a signed-in address book', async () => {
  for (const pathname of [
    null,
    '/',
    '/menu',
    '/owner',
    '/owner/orders',
    '/account/profile',
    '/account/orders',
    '/checkout/complete',
    '/account/addresses-old',
  ]) {
    const tab = browser();
    let reads = 0;
    const state = addresses(async () => book(++reads));
    const stop = startAddressRefresh(
      { pathname, refresh: () => state.refreshIfIdle() },
      tab.environment,
    );
    tab.advance(60_000);
    tab.window.emit('focus');
    tab.document.emit('visibilitychange');
    await settle();
    assert.equal(reads, 0, String(pathname));
    assert.equal(tab.timers.size, 0);
    assert.equal(tab.document.size + tab.window.size, 0);
    stop();
    state.dispose();
  }
});

test('entering checkout or saved addresses refreshes immediately and cleanup stops further reads', async () => {
  for (const pathname of ['/checkout', '/account/addresses', '/checkout/', '/account/addresses/']) {
    const tab = browser();
    let reads = 0;
    const state = addresses(async () => book(++reads));
    const stop = startAddressRefresh(
      { pathname, refresh: () => state.refreshIfIdle() },
      tab.environment,
    );
    await settle();
    assert.equal(reads, 1, pathname);
    tab.advance(15_000);
    await settle();
    assert.equal(reads, 2);
    stop();
    tab.advance(60_000);
    tab.window.emit('focus');
    await settle();
    assert.equal(reads, 2);
    assert.equal(tab.document.size + tab.window.size + tab.timers.size, 0);
    state.dispose();
  }
});

test('a hidden checkout waits for visibility and coalesces its paired focus event', async () => {
  const tab = browser('hidden');
  let reads = 0;
  const state = addresses(async () => book(++reads));
  const stop = startAddressRefresh(
    { pathname: '/checkout', refresh: () => state.refreshIfIdle() },
    tab.environment,
  );
  tab.advance(60_000);
  tab.window.emit('focus');
  await settle();
  assert.equal(reads, 0);
  tab.document.visibilityState = 'visible';
  tab.document.emit('visibilitychange');
  await settle();
  tab.window.emit('focus');
  await settle();
  assert.equal(reads, 1);
  stop();
  state.dispose();
});

test('a slow read survives intervals, focus, and leaving then reentering checkout without overlap', async () => {
  const tab = browser();
  let reads = 0;
  let resolve!: (response: SharedAddressBook) => void;
  let signal: AbortSignal | undefined;
  const state = new CustomerAddressesState({
    read: async (readSignal) => {
      ++reads;
      signal = readSignal;
      return new Promise<SharedAddressBook>((done) => {
        resolve = done;
      });
    },
    mutate: async () => book(2),
  });
  state.setIdentity('customer');
  const options = { pathname: '/checkout', refresh: () => state.refreshIfIdle() };
  const stop = startAddressRefresh(options, tab.environment);
  tab.advance(15_000);
  tab.window.emit('focus');
  stop();
  const stopAgain = startAddressRefresh(options, tab.environment);
  assert.equal(reads, 1);
  assert.equal(signal?.aborted, false);
  resolve(book(1));
  await settle();
  assert.equal(state.getSnapshot().book?.revision, 1);
  stopAgain();
  state.dispose();
});

test('manual refresh still works outside address routes and route entry reads the latest revision', async () => {
  const tab = browser();
  let revision = 1;
  let reads = 0;
  const state = addresses(async () => {
    ++reads;
    return book(revision);
  });
  const stopMenu = startAddressRefresh(
    { pathname: '/menu', refresh: () => state.refreshIfIdle() },
    tab.environment,
  );
  await state.refresh();
  assert.equal(reads, 1);
  stopMenu();
  revision = 2;
  const stopCheckout = startAddressRefresh(
    { pathname: '/checkout', refresh: () => state.refreshIfIdle() },
    tab.environment,
  );
  await settle();
  assert.equal(reads, 2);
  assert.equal(state.getSnapshot().book?.revision, 2);
  stopCheckout();
  state.dispose();
});

test("active address tabs still detect another tab's mutation and reject a stale editor without replaying it", async () => {
  let revision = 1;
  let writes = 0;
  const transport = {
    read: async () => book(revision),
    mutate: async () => {
      ++writes;
      return book(++revision);
    },
  };
  const first = new CustomerAddressesState(transport);
  const second = new CustomerAddressesState(transport);
  first.setIdentity('customer');
  second.setIdentity('customer');
  const firstTab = browser();
  const secondTab = browser();
  const stopFirst = startAddressRefresh(
    {
      pathname: '/account/addresses',
      refresh: () => first.refreshIfIdle(),
      canRefresh: () => !first.getSnapshot().saving,
    },
    firstTab.environment,
  );
  const stopSecond = startAddressRefresh(
    {
      pathname: '/checkout',
      refresh: () => second.refreshIfIdle(),
      canRefresh: () => !second.getSnapshot().saving,
    },
    secondTab.environment,
  );
  await settle();
  const editorRevision = second.getSnapshot().book!.revision;
  await first.mutate({ action: 'remove', id: 'other-address', expectedRevision: 1 });
  assert.equal(first.getSnapshot().book?.revision, 2);
  secondTab.advance(15_000);
  await settle();
  assert.equal(second.getSnapshot().book?.revision, 2);
  await assert.rejects(
    second.mutate({ action: 'remove', id: 'other-address', expectedRevision: editorRevision }),
    (error: unknown) =>
      error instanceof CommerceError && error.code === 'address_revision_conflict',
  );
  assert.equal(writes, 1);
  stopFirst();
  stopSecond();
  first.dispose();
  second.dispose();
});

test('scheduled refresh skips a pending mutation while its response updates the current book', async () => {
  const tab = browser();
  let reads = 0;
  let resolve!: (response: SharedAddressBook) => void;
  const state = new CustomerAddressesState({
    read: async () => {
      ++reads;
      return book(1);
    },
    mutate: async () =>
      new Promise<SharedAddressBook>((done) => {
        resolve = done;
      }),
  });
  state.setIdentity('customer');
  const stop = startAddressRefresh(
    {
      pathname: '/account/addresses',
      refresh: () => state.refreshIfIdle(),
      canRefresh: () => !state.getSnapshot().saving,
    },
    tab.environment,
  );
  await settle();
  const pending = state.mutate({ action: 'remove', id: 'other-address', expectedRevision: 1 });
  tab.advance(15_000);
  tab.window.emit('focus');
  await settle();
  assert.equal(reads, 1);
  resolve(book(2));
  await pending;
  assert.equal(state.getSnapshot().book?.revision, 2);
  stop();
  state.dispose();
});
