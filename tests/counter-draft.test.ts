import assert from 'node:assert/strict';
import test from 'node:test';
import {
  noteCounterDraftIdentity,
  readCounterDraft,
  writeCounterDraft,
} from '../lib/counter-draft';

test('unfinished counter state survives a connection remount, stays scoped to branch/account and clears on verified sign-out or account change', () => {
  noteCounterDraftIdentity('qa-owner');
  const pending = {
    cart: [{ productId: 'fictional-item', quantity: 1 }],
    attempt: 'same-idempotency-key',
  };
  writeCounterDraft('qa-owner:barra', pending);
  // Reconfirming the same identity must not discard a payment attempt or draft.
  noteCounterDraftIdentity('qa-owner');
  assert.deepEqual(readCounterDraft('qa-owner:barra'), pending);
  assert.equal(readCounterDraft('qa-owner:other'), undefined);
  assert.equal(readCounterDraft('other-user:barra'), undefined);
  noteCounterDraftIdentity(null);
  assert.equal(readCounterDraft('qa-owner:barra'), undefined);
  noteCounterDraftIdentity('qa-owner');
  writeCounterDraft('qa-owner:barra', pending);
  noteCounterDraftIdentity('other-user');
  assert.equal(readCounterDraft('qa-owner:barra'), undefined);
});
