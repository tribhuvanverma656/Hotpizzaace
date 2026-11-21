import assert from 'node:assert/strict';
import test from 'node:test';
import { unstable_doesMiddlewareMatch as doesProxyMatch } from 'next/experimental/testing/server';
import { GET, dynamic, runtime } from '../app/api/liveness/route';
import { config } from '../proxy';

test('liveness returns only a small uncached process status on each request', async () => {
  assert.equal(runtime, 'nodejs');
  assert.equal(dynamic, 'force-dynamic');
  const first = GET();
  const second = GET();
  assert.notEqual(first, second);
  for (const response of [first, second]) {
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
    assert.match(response.headers.get('content-type') ?? '', /^application\/json\b/);
    assert.equal(response.headers.has('set-cookie'), false);
    assert.equal(response.headers.has('location'), false);
    assert.deepEqual(await response.json(), { status: 'ok' });
  }
});

test('liveness makes no external requests regardless of dependency configuration or availability', async (context) => {
  const configurations = [
    {},
    {
      COMMERCE_ENABLED: 'true',
      NEXT_PUBLIC_SUPABASE_URL: 'https://liveness-test.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_PRIVATE_LIVENESS_KEY',
      SUPABASE_SERVICE_ROLE_KEY: 'PRIVATE_LIVENESS_SERVICE_KEY',
      RAZORPAY_KEY_SECRET: 'PRIVATE_LIVENESS_PAYMENT_SECRET',
    },
    {
      COMMERCE_ENABLED: 'true',
      NEXT_PUBLIC_SUPABASE_URL: 'invalid-PRIVATE_LIVENESS_URL',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_PRIVATE_LIVENESS_KEY',
    },
  ];
  const names = [...new Set(configurations.flatMap((values) => Object.keys(values)))];
  const original = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  context.after(() => {
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  const fetchMock = context.mock.method(globalThis, 'fetch', async () => {
    throw new Error('External Auth, database, and Edge requests are unavailable in this test.');
  });
  for (const values of configurations) {
    for (const name of names) delete process.env[name];
    Object.assign(process.env, values);
    const response = GET();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
    assert.equal(fetchMock.mock.callCount(), 0);
  }
});

test('liveness probes bypass the Supabase session refresh proxy', () => {
  for (const url of ['/api/liveness', '/api/liveness?probe=render'])
    assert.equal(doesProxyMatch({ config, nextConfig: {}, url }), false, url);
});
