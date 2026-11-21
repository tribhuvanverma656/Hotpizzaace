import assert from 'node:assert/strict';
import test from 'node:test';
import { getGoogleProviderStatus } from '../lib/auth/provider';

const config = {
  url: 'https://provider-test.supabase.co',
  publishableKey: 'sb_publishable_provider_test',
};

test('Google readiness reads the current public provider configuration without caching or user credentials', async () => {
  let calls = 0;
  const request: typeof fetch = async (input, init) => {
    calls += 1;
    assert.equal(input, `${config.url}/auth/v1/settings`);
    assert.deepEqual(init?.headers, { apikey: config.publishableKey });
    assert.equal(init?.cache, 'no-store');
    assert.ok(init?.signal instanceof AbortSignal);
    return Response.json({ external: { google: calls === 1 } });
  };
  assert.equal(await getGoogleProviderStatus(config, request), 'enabled');
  assert.equal(await getGoogleProviderStatus(config, request), 'disabled');
  assert.equal(calls, 2);
});

test('Google readiness requires an explicit boolean and fails closed for malformed settings', async () => {
  for (const body of [null, {}, { external: {} }, { external: { google: 'true' } }]) {
    assert.equal(
      await getGoogleProviderStatus(config, async () => Response.json(body)),
      'unavailable',
    );
  }
});

test('Google readiness hides provider/network details and handles unavailable or invalid responses', async () => {
  const requests: (typeof fetch)[] = [
    async () => Response.json({ message: 'PRIVATE_PROVIDER_ERROR' }, { status: 503 }),
    async () => new Response('invalid json'),
    async () => {
      throw new Error('PRIVATE_NETWORK_ERROR');
    },
  ];
  for (const request of requests)
    assert.equal(await getGoogleProviderStatus(config, request), 'unavailable');
});
