import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeCounterPaymentCursor, parseCounterPaymentCursor } from '../lib/counter';

test('awaiting-payment seek cursor preserves database timestamp precision and tied order IDs', () => {
  assert.equal(parseCounterPaymentCursor('start'), null);
  const id = '11111111-1111-4111-8111-111111111111';
  for (const createdAt of ['2026-10-30T12:30:00.123456+00:00', '2026-10-30T12:30:00.123Z']) {
    const cursor = encodeCounterPaymentCursor(createdAt, id);
    assert.match(cursor, /^[A-Za-z0-9_-]{1,100}$/);
    assert.deepEqual(parseCounterPaymentCursor(cursor), { createdAt, id });
  }
});

test('awaiting-payment cursor rejects filter syntax, invalid IDs and noncanonical encodings', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  for (const value of [
    '',
    'x'.repeat(101),
    'not-cursor!',
    encodeCounterPaymentCursor('2026-10-30T12:30:00Z,or(id.gt.0)', id),
    encodeCounterPaymentCursor('2026-10-30T12:30:00Z', 'not-an-id'),
    encodeCounterPaymentCursor('not-a-date', id),
    `${encodeCounterPaymentCursor('2026-10-30T12:30:00Z', id)}=`,
  ])
    assert.throws(() => parseCounterPaymentCursor(value), /Refresh the awaiting-payment list/);
});
