import assert from 'node:assert/strict';
import test from 'node:test';
import { readCommerceEnvironment } from '../lib/commerce/environment';

test('only explicit development catalog metadata permits a simulation label', () => {
  assert.deepEqual(readCommerceEnvironment({ mode: 'development', allowSimulatedPayments: true }), {
    mode: 'development',
    allowSimulatedPayments: true,
  });
  assert.deepEqual(
    readCommerceEnvironment({ mode: 'development', allowSimulatedPayments: false }),
    {
      mode: 'development',
      allowSimulatedPayments: false,
    },
  );
  for (const allowSimulatedPayments of [true, false])
    assert.deepEqual(readCommerceEnvironment({ mode: 'production', allowSimulatedPayments }), {
      mode: 'production',
      allowSimulatedPayments: false,
    });
});

test('missing or malformed environment metadata stays neutral instead of claiming demo or production', () => {
  for (const snapshot of [
    null,
    undefined,
    [],
    'production',
    {},
    { mode: 'production' },
    { allowSimulatedPayments: true },
    { mode: 'preview', allowSimulatedPayments: true },
    { mode: 'production', allowSimulatedPayments: 'false' },
    { mode: 'development', allowSimulatedPayments: 1 },
  ])
    assert.deepEqual(readCommerceEnvironment(snapshot), {
      mode: null,
      allowSimulatedPayments: false,
    });
});
