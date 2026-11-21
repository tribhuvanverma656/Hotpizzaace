import assert from 'node:assert/strict';
import test from 'node:test';
import {
  branchQrDraftKey,
  clearCustomerPrivateDrafts,
  parseCustomerPrivacyContext,
  reconcileCustomerPrivacyStorage,
} from '../lib/customer-privacy';
import {
  newSharedCheckoutDraft,
  saveSharedCheckoutDraft,
  sharedCheckoutDraftKey,
} from '../lib/shared-checkout-draft';

const guest = { contextId: 'a'.repeat(64), userId: null };
const account = { contextId: 'b'.repeat(64), userId: 'customer-a' };
function storage() {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
    removeItem: (key: string) => void entries.delete(key),
  };
}
function addPrivateDrafts(target: ReturnType<typeof storage>) {
  for (const userId of [null, 'customer-a', 'customer-b']) {
    const scope = { branchId: 'barra', userId };
    saveSharedCheckoutDraft(target, scope, newSharedCheckoutDraft(scope));
    target.setItem(`${sharedCheckoutDraftKey(scope)}:attempt`, 'PRIVATE_ATTEMPT');
  }
  target.setItem('hpa-table-request:legacy-token:1', 'PRIVATE_QR_ATTEMPT');
  target.setItem(branchQrDraftKey(guest.contextId, 'c'.repeat(64), 1), 'PRIVATE_QR_REQUEST');
  target.setItem('shared:customer-a:hot-pizza-ace-checkout-draft:v1:barra:guest', 'PRIVATE_LEGACY');
  target.setItem('hot-pizza-ace-store', 'PUBLIC_CART_AND_BRANCH');
}
function assertPrivateCleared(target: ReturnType<typeof storage>) {
  for (let index = 0; index < target.length; index++) {
    const key = target.key(index)!;
    assert.doesNotMatch(target.getItem(key)!, /PRIVATE_/);
  }
  assert.equal(target.getItem('hot-pizza-ace-store'), 'PUBLIC_CART_AND_BRANCH');
}

test('a verified context is a strict non-bearer digest; unconfigured demo accepts only no identity', () => {
  assert.deepEqual(parseCustomerPrivacyContext(true, guest.contextId, null), guest);
  assert.deepEqual(parseCustomerPrivacyContext(true, account.contextId, account.userId), account);
  assert.equal(parseCustomerPrivacyContext(false, null, null), null);
  for (const value of [undefined, null, '', 'a'.repeat(63), 'G'.repeat(64), {}, 1])
    assert.throws(() => parseCustomerPrivacyContext(true, value, null));
  assert.throws(() => parseCustomerPrivacyContext(false, null, account.userId));
  assert.throws(() => parseCustomerPrivacyContext(undefined, guest.contextId, null));
});

test('ordinary guest verification and reload keep the exact checkout and payment retry', () => {
  const target = storage();
  addPrivateDrafts(target);
  assert.equal(reconcileCustomerPrivacyStorage(target, guest), false);
  const before = Array.from({ length: target.length }, (_, index) => {
    const key = target.key(index)!;
    return [key, target.getItem(key)];
  });
  assert.equal(reconcileCustomerPrivacyStorage(target, { ...guest }), false);
  assert.deepEqual(
    Array.from({ length: target.length }, (_, index) => {
      const key = target.key(index)!;
      return [key, target.getItem(key)];
    }),
    before,
  );
});

test('verified sign-in, sign-out and account switching clear private drafts across branches and QR links', () => {
  for (const [before, after] of [
    [guest, account],
    [account, { contextId: 'd'.repeat(64), userId: null }],
    [account, { contextId: 'e'.repeat(64), userId: 'customer-b' }],
    [guest, { contextId: 'f'.repeat(64), userId: null }],
    [account, { contextId: 'f'.repeat(64), userId: account.userId }],
  ]) {
    const target = storage();
    reconcileCustomerPrivacyStorage(target, before);
    addPrivateDrafts(target);
    assert.equal(reconcileCustomerPrivacyStorage(target, after), true);
    assertPrivateCleared(target);
  }
});

test('first verified signed-in mount and malformed cache markers cannot restore private guest drafts', () => {
  for (const malformed of [undefined, '{broken', '{"contextId":"invalid","userId":null}']) {
    const target = storage();
    addPrivateDrafts(target);
    if (malformed !== undefined) target.setItem('hpa-customer-privacy-context:v1', malformed);
    reconcileCustomerPrivacyStorage(target, account);
    assertPrivateCleared(target);
  }
});

test('QR cache keys separate anonymous contexts even when branch link and account identity are unchanged', () => {
  const token = 'c'.repeat(64);
  assert.equal(
    branchQrDraftKey(guest.contextId, token, 2),
    branchQrDraftKey(guest.contextId, token, 2),
  );
  assert.notEqual(
    branchQrDraftKey(guest.contextId, token, 2),
    branchQrDraftKey(account.contextId, token, 2),
  );
  assert.notEqual(branchQrDraftKey(guest.contextId, token, 2), `hpa-table-request:${token}:2`);
  assert.throws(() => branchQrDraftKey('', token, 2));
});

test('explicit privacy cleanup and blocked storage never erase public cart or require storage access', () => {
  const target = storage();
  addPrivateDrafts(target);
  clearCustomerPrivateDrafts(target);
  assertPrivateCleared(target);
  assert.doesNotThrow(() => clearCustomerPrivateDrafts(undefined));
  assert.equal(reconcileCustomerPrivacyStorage(undefined, guest), false);
  const blocked = Object.create(target, {
    length: {
      get() {
        throw new Error('blocked');
      },
    },
  });
  assert.doesNotThrow(() => clearCustomerPrivateDrafts(blocked));
});
