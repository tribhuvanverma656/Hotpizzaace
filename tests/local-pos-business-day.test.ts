import assert from 'node:assert/strict';
import test from 'node:test';
import { localBusinessDate } from '../lib/local-pos/business-day';

test('local POS business date rolls over at 3 AM India time', () => {
  assert.equal(localBusinessDate('2026-11-10T21:29:00.000Z'), '2026-11-10');
  assert.equal(localBusinessDate('2026-11-10T21:30:00.000Z'), '2026-11-11');
});

test('local POS business date uses India time regardless of host timezone', () => {
  assert.equal(localBusinessDate('2026-11-10T18:29:59.999Z'), '2026-11-10');
  assert.equal(localBusinessDate('2026-11-10T18:30:00.000Z'), '2026-11-10');
});

test('invalid local POS business timestamps are rejected', () => {
  assert.throws(() => localBusinessDate('not a timestamp'), /timestamp is invalid/);
});
