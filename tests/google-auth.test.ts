import assert from 'node:assert/strict';
import test from 'node:test';
import {
  safeCustomerNext,
  safeAuthNext,
  safeAdminNext,
  authLoginPath,
  getRequestOrigin,
  getAuthFailureMessage,
} from '../lib/auth/google';

test('OAuth destinations exclude external, administrative and encoded redirect variants', () => {
  for (const input of [
    null,
    undefined,
    {},
    '',
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '/admin/dashboard',
    '/account/profile?next=https://evil.example',
    '%2Fcheckout',
    '/checkout#fragment',
    '/checkout/../admin',
    '/checkout\n',
  ])
    assert.equal(safeCustomerNext(input), '/account/profile');
  for (const input of ['/checkout', '/account/orders', '/account/addresses', '/account/profile'])
    assert.equal(safeCustomerNext(input), input);
});

test('hosted OAuth uses configured canonical origin and ignores attacker headers', () => {
  const request = new Request('http://internal:10000/auth/callback', {
    headers: { 'x-forwarded-host': 'evil.example', host: 'evil.example' },
  });
  assert.equal(
    getRequestOrigin(request, {
      RENDER_EXTERNAL_URL: 'https://hotpizzaace-development.onrender.com/',
    }),
    'https://hotpizzaace-development.onrender.com',
  );
  assert.equal(
    getRequestOrigin(request, {
      APP_BASE_URL: 'https://pizza.example',
      RENDER_EXTERNAL_URL: 'https://preview.example',
    }),
    'https://pizza.example',
  );
});

test('unconfigured hosted origins and malformed deployment URLs fail closed', () => {
  const request = new Request('https://evil.example/auth/callback');
  assert.throws(() => getRequestOrigin(request, {}));
  for (const url of [
    'http://pizza.example',
    'https://user:password@pizza.example',
    'https://pizza.example/path',
    'https://pizza.example?redirect=evil',
    'https://pizza.example#fragment',
    'not a URL',
  ])
    assert.throws(() => getRequestOrigin(request, { APP_BASE_URL: url }));
});

test('local development callback origin stays on its original port', () => {
  for (const origin of ['http://localhost:3001', 'http://127.0.0.1:3003', 'http://[::1]:3000'])
    assert.equal(getRequestOrigin(new Request(origin + '/auth/callback'), {}), origin);
});

test('Next wildcard listeners normalize only same-port loopback Host headers', () => {
  const local = new Request('http://0.0.0.0:3003/auth/callback', {
    headers: { host: 'localhost:3003', 'x-forwarded-host': 'evil.example' },
  });
  assert.equal(getRequestOrigin(local, {}), 'http://localhost:3003');
  for (const host of [
    'evil.example:3003',
    'localhost:4000',
    'localhost:3003@evil.example',
    'localhost:3003/path',
  ])
    assert.throws(() =>
      getRequestOrigin(new Request('http://0.0.0.0:3003/auth/callback', { headers: { host } }), {}),
    );
});

test('OAuth failure copy maps only known categories and never reflects provider payloads', () => {
  assert.equal(getAuthFailureMessage(null), '');
  assert.match(getAuthFailureMessage('access_denied'), /cancelled/);
  assert.match(getAuthFailureMessage('provider_unavailable'), /not available yet/);
  assert.doesNotMatch(getAuthFailureMessage('secret-token@example.com'), /secret-token/);
});

test('admin OAuth return paths stay on an exact allowlist without changing customer redirects', () => {
  for (const next of [
    '/admin/dashboard',
    '/admin/orders',
    '/admin/kitchen',
    '/admin/products',
    '/admin/categories',
    '/admin/customers',
    '/admin/branches',
    '/admin/settings',
  ]) {
    assert.equal(safeAuthNext(next), next);
    assert.equal(safeAdminNext(next), next);
    assert.equal(authLoginPath(next), '/admin/login');
    assert.equal(safeCustomerNext(next), '/account/profile');
  }
  for (const next of [
    '/admin',
    '/admin/login',
    '/admin/orders/secret',
    '/admin/dashboard?next=https://evil.example',
    '/admin/dashboard#fragment',
    '/admin/dashboard/../settings',
    '%2Fadmin%2Fdashboard',
    '//evil.example/admin/dashboard',
    '/admin/dashboard\n',
    null,
    {},
    1,
  ]) {
    assert.equal(safeAuthNext(next), '/account/profile');
    assert.equal(safeAdminNext(next), '/admin/dashboard');
  }
  assert.equal(safeAuthNext('/checkout'), '/checkout');
  assert.equal(authLoginPath('/checkout'), '/account/login');
  assert.equal(safeAdminNext('/checkout'), '/admin/dashboard');
  assert.equal(authLoginPath('/admin/orders/secret'), '/account/login');
  assert.equal(safeAuthNext('/auth/reset-password'), '/auth/reset-password');
  assert.equal(authLoginPath('/auth/reset-password'), '/admin/login');
  assert.equal(safeCustomerNext('/auth/reset-password'), '/account/profile');
  assert.equal(safeAuthNext('/auth/reset-password?next=https://evil.example'), '/account/profile');
});
