import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { isLocalPosPath, localPosEnabled } from '../lib/local-pos/availability';
import { config, proxy } from '../proxy';

test('the local POS is off unless the POS computer explicitly enables it', () => {
  assert.equal(localPosEnabled({}), false);
  assert.equal(localPosEnabled({ LOCAL_POS_ENABLED: 'false' }), false);
  assert.equal(localPosEnabled({ LOCAL_POS_ENABLED: 'TRUE' }), false);
  assert.equal(localPosEnabled({ LOCAL_POS_ENABLED: '1' }), false);
  assert.equal(localPosEnabled({ LOCAL_POS_ENABLED: 'true' }), true);
});

test('every local POS page and API path is recognised, and nothing else', () => {
  for (const path of [
    '/local-pos',
    '/local-pos/dashboard',
    '/local-pos/order/abc',
    '/api/local-pos',
    '/api/local-pos/setup',
    '/api/local-pos/users/1',
  ])
    assert.equal(isLocalPosPath(path), true, path);
  for (const path of ['/', '/menu', '/local-posx', '/admin/local-pos', '/api/commerce/x'])
    assert.equal(isLocalPosPath(path), false, path);
});

test('hosted sites answer 404 for the local POS, including first-run setup', async () => {
  const previous = process.env.LOCAL_POS_ENABLED;
  delete process.env.LOCAL_POS_ENABLED;
  try {
    for (const path of ['/local-pos', '/api/local-pos/setup', '/api/local-pos/status']) {
      const response = await proxy(
        new NextRequest(`http://localhost:3000${path}`, {
          method: path.includes('setup') ? 'POST' : 'GET',
        }),
      );
      assert.equal(response.status, 404, path);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
    }
    assert.ok(config.matcher.includes('/api/local-pos/:path*'));
  } finally {
    if (previous === undefined) delete process.env.LOCAL_POS_ENABLED;
    else process.env.LOCAL_POS_ENABLED = previous;
  }
});
