import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
// The installed Next package still exports this matcher helper under its previous name.
import { unstable_doesMiddlewareMatch as doesProxyMatch } from 'next/experimental/testing/server';
import { canonicalPageRedirect } from '../lib/canonical-origin';
import { getRequestOrigin } from '../lib/auth/google';
import { config, proxy } from '../proxy';

const deployment = {
  APP_BASE_URL: 'https://hotpizzaace.com',
  RENDER_EXTERNAL_URL: 'https://hotpizzaace.onrender.com',
};

test('configured www and exact Render aliases preserve page paths and query on the canonical origin', () => {
  for (const host of [
    'www.hotpizzaace.com',
    'WWW.HOTPIZZAACE.COM:443',
    'hotpizzaace.onrender.com',
  ]) {
    const request = new Request('http://internal:10000/menu?category=veg&search=corn', {
      headers: { host, 'x-forwarded-host': 'attacker.example' },
    });
    assert.equal(
      canonicalPageRedirect(request, deployment)?.href,
      'https://hotpizzaace.com/menu?category=veg&search=corn',
    );
  }
});

test('canonical redirects do not accept arbitrary, forwarded, malformed or lookalike hosts', () => {
  for (const host of [
    'hotpizzaace.com',
    'attacker.example',
    'www.hotpizzaace.com.attacker.example',
    'other-service.onrender.com',
    'www.hotpizzaace.com:8443',
    'www.hotpizzaace.com@attacker.example',
    'www.hotpizzaace.com/path',
    'www.hotpizzaace.com.',
  ])
    assert.equal(
      canonicalPageRedirect(
        new Request('https://attacker.example/menu', {
          headers: { host, 'x-forwarded-host': 'www.hotpizzaace.com' },
        }),
        deployment,
      ),
      null,
    );
});

test('mutations, API responses and static assets are never redirected between origins', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'])
    assert.equal(
      canonicalPageRedirect(
        new Request('https://www.hotpizzaace.com/checkout', { method }),
        deployment,
      ),
      null,
    );
  for (const pathname of ['/api', '/api/health', '/api/auth/session', '/_next/image', '/logo.gif'])
    assert.equal(
      canonicalPageRedirect(new Request(`https://www.hotpizzaace.com${pathname}`), deployment),
      null,
    );
  // Redirect support does not relax the mutation handlers' exact canonical Origin check.
  const request = new Request('https://www.hotpizzaace.com/api/auth/google', {
    method: 'POST',
    headers: { origin: 'https://www.hotpizzaace.com' },
  });
  assert.notEqual(request.headers.get('origin'), getRequestOrigin(request, deployment));
});

test('development without APP_BASE_URL and invalid canonical configuration do not redirect', () => {
  const request = new Request('https://www.hotpizzaace.com/menu');
  for (const APP_BASE_URL of [
    undefined,
    '',
    'http://hotpizzaace.com',
    'https://user:password@hotpizzaace.com',
    'https://hotpizzaace.com/path',
    'https://hotpizzaace.com?next=attacker.example',
    'https://hotpizzaace.com#fragment',
    'https://hotpizzaace.com:8443',
    'not a URL',
  ])
    assert.equal(canonicalPageRedirect(request, { ...deployment, APP_BASE_URL }), null);
  assert.equal(
    canonicalPageRedirect(new Request('https://hotpizzaace.onrender.com/menu'), {
      APP_BASE_URL: deployment.APP_BASE_URL,
      RENDER_EXTERNAL_URL: 'https://hotpizzaace.onrender.com/untrusted-path',
    }),
    null,
  );
});

test('a protocol-relative pathname cannot replace the configured destination host', () => {
  const destination = canonicalPageRedirect(
    new Request('https://www.hotpizzaace.com//attacker.example/orders?access=example'),
    deployment,
  );
  assert.equal(destination?.origin, 'https://hotpizzaace.com');
  assert.equal(destination?.pathname, '//attacker.example/orders');
  assert.equal(destination?.search, '?access=example');
});

test('proxy canonicalizes before session handling and leaves public development pages unchanged', async () => {
  const previousApp = process.env.APP_BASE_URL;
  const previousRender = process.env.RENDER_EXTERNAL_URL;
  try {
    process.env.APP_BASE_URL = deployment.APP_BASE_URL;
    process.env.RENDER_EXTERNAL_URL = deployment.RENDER_EXTERNAL_URL;
    const redirected = await proxy(
      new NextRequest('https://www.hotpizzaace.com/account/login?next=%2Fcheckout'),
    );
    assert.equal(redirected.status, 307);
    assert.equal(
      redirected.headers.get('location'),
      'https://hotpizzaace.com/account/login?next=%2Fcheckout',
    );
    assert.equal(redirected.headers.get('cache-control'), 'private, no-store');
    assert.equal(redirected.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(redirected.headers.get('set-cookie'), null);
    delete process.env.APP_BASE_URL;
    const unchanged = await proxy(new NextRequest('https://hotpizzaace.onrender.com/menu'));
    assert.equal(unchanged.headers.get('location'), null);
    assert.equal(unchanged.headers.get('x-middleware-next'), '1');
  } finally {
    if (previousApp === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = previousApp;
    if (previousRender === undefined) delete process.env.RENDER_EXTERNAL_URL;
    else process.env.RENDER_EXTERNAL_URL = previousRender;
  }
});

test('proxy matcher covers page redirects and existing auth/commerce refresh paths without assets', () => {
  for (const pathname of [
    '/',
    '/menu',
    '/admin/login',
    '/account/profile',
    '/checkout',
    '/auth/callback',
    '/api/auth/session',
    '/api/commerce/orders',
  ])
    assert.equal(doesProxyMatch({ config, nextConfig: {}, url: pathname }), true, pathname);
  for (const pathname of [
    '/api/health',
    '/_next/static/chunk.js',
    '/_next/image',
    '/logo.gif',
    '/images/pizza.avif',
  ])
    assert.equal(doesProxyMatch({ config, nextConfig: {}, url: pathname }), false, pathname);
});
