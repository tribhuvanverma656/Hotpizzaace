import assert from 'node:assert/strict';
import test from 'node:test';
import {
  handleKitchenGateway,
  type KitchenCookieOptions,
  type KitchenGatewayDependencies,
} from '../lib/kitchen-gateway';

const now = Date.parse('2026-10-30T16:00:00Z');
const origin = 'https://kitchen-fixture.example.invalid';
const profile = {
  id: 'chef',
  username: 'chef-one',
  displayName: 'Chef',
  branchId: 'barra',
  branchName: 'Barra',
  version: 2,
  environment: 'development',
  expiresAt: new Date(now + 12 * 3600_000).toISOString(),
};
const session = {
  accessToken: 'PRIVATE_CHEF_ACCESS_TOKEN',
  refreshToken: 'PRIVATE_CHEF_REFRESH_TOKEN',
  expiresAt: new Date(now + 3600_000).toISOString(),
};
function fixture(
  handler: (path: string, body: unknown, headers: Headers) => Response | Promise<Response> = () =>
    Response.json({ profile }),
) {
  const jar = new Map<string, string>([
    ['sb-owner-auth-token', 'PRIVATE_OWNER_COOKIE'],
    ['hpa_guest_session', 'PRIVATE_GUEST_COOKIE'],
  ]);
  const writes: { name: string; value: string; options: KitchenCookieOptions }[] = [];
  const calls: {
    path: string;
    method: string;
    body: unknown;
    headers: Headers;
    cache?: RequestCache;
  }[] = [];
  let owners = 0;
  const dependencies: KitchenGatewayDependencies = {
    origin: () => origin,
    now: () => now,
    config: () => ({
      url: 'https://project.example.invalid',
      publishableKey: 'sb_publishable_fixture',
    }),
    cookies: async () => ({
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      set: (name, value, options) => {
        writes.push({ name, value, options });
        if (options.maxAge === 0) jar.delete(name);
        else jar.set(name, value);
      },
    }),
    ownerToken: async () => {
      owners++;
      return 'PRIVATE_VERIFIED_OWNER_TOKEN';
    },
    fetch: (async (input, init) => {
      const path = String(input).split('/hpa-kitchen/')[1];
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      const headers = new Headers(init?.headers);
      calls.push({ path, method: init?.method ?? 'GET', body, headers, cache: init?.cache });
      return handler(path, body, headers);
    }) as typeof fetch,
  };
  const request = (
    path: string,
    method = 'GET',
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    new Request(`${origin}/kitchen/api/${path}`, {
      method,
      headers: {
        origin,
        'sec-fetch-site': 'same-origin',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const active = () => {
    jar.set('hpa_kitchen_access.0', session.accessToken);
    jar.set('hpa_kitchen_refresh.0', session.refreshToken);
    jar.set('hpa_kitchen_deadline', String(Date.parse(profile.expiresAt)));
    jar.set('hpa_kitchen_access_expiry', String(Date.parse(session.expiresAt)));
  };
  return { dependencies, jar, writes, calls, request, active, owners: () => owners };
}
async function result(response: Response, status: number) {
  assert.equal(response.status, status);
  assert.match(response.headers.get('cache-control') ?? '', /private.*no-store/);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  const text = await response.text();
  for (const value of [
    'PRIVATE_CHEF',
    'PRIVATE_OWNER',
    'PRIVATE_GUEST',
    'UNTRUSTED_PROVIDER_SECRET',
  ])
    assert.equal(text.includes(value), false);
  return JSON.parse(text);
}
test('chef login keeps credentials server-side and writes only isolated HttpOnly cookies', async () => {
  const f = fixture(() =>
    Response.json({ session, profile, authAlias: 'PRIVATE_OWNER_ALIAS', unexpected: session }),
  );
  const response = await handleKitchenGateway(
    f.request('auth/login', 'POST', { username: 'chef-one', password: 'PRIVATE_CHEF_PASSWORD' }),
    ['auth', 'login'],
    f.dependencies,
  );
  assert.deepEqual(await result(response, 200), { profile });
  assert.equal(f.owners(), 0);
  assert.equal(f.calls[0].headers.has('authorization'), false);
  assert.equal(f.calls[0].cache, 'no-store');
  assert.equal(f.jar.get('sb-owner-auth-token'), 'PRIVATE_OWNER_COOKIE');
  assert.equal(f.jar.get('hpa_guest_session'), 'PRIVATE_GUEST_COOKIE');
  for (const write of f.writes) {
    assert.match(write.name, /^hpa_kitchen_/);
    assert.equal(write.options.path, '/kitchen');
    assert.equal(write.options.httpOnly, true);
    assert.equal(write.options.secure, true);
    assert.equal(write.options.sameSite, 'lax');
    assert.ok(write.options.maxAge <= 12 * 3600);
    assert.equal('domain' in write.options, false);
  }
});
test('chef APIs never fall back to an owner cookie or accept owner routes', async () => {
  const f = fixture(() =>
    Response.json({ code: 'auth_required', error: 'UNTRUSTED_PROVIDER_SECRET' }, { status: 401 }),
  );
  await result(await handleKitchenGateway(f.request('queue'), ['queue'], f.dependencies), 401);
  assert.equal(f.calls[0].headers.has('authorization'), false);
  assert.equal(f.owners(), 0);
  await result(
    await handleKitchenGateway(f.request('admin/staff'), ['admin', 'staff'], f.dependencies),
    404,
  );
  await result(
    await handleKitchenGateway(
      f.request('auth/refresh', 'POST', {}),
      ['auth', 'refresh'],
      f.dependencies,
    ),
    404,
  );
  assert.equal(f.calls.length, 1);
});
test('mutations require exact origin and same-origin fetch metadata before reading Auth', async () => {
  for (const headers of [
    { origin: '' },
    { origin: 'null' },
    { origin: 'https://other.invalid' },
    { 'sec-fetch-site': 'same-site' },
    { 'sec-fetch-site': 'cross-site' },
    { 'sec-fetch-site': 'none' },
  ] as Record<string, string>[]) {
    const f = fixture();
    await result(
      await handleKitchenGateway(
        f.request('auth/login', 'POST', {}, headers),
        ['auth', 'login'],
        f.dependencies,
      ),
      403,
    );
    assert.equal(f.calls.length, 0);
    assert.equal(f.owners(), 0);
    assert.equal(f.writes.length, 0);
  }
});
test('oversized streamed JSON and invalid content types are refused without proxying', async () => {
  for (const request of [
    new Request(`${origin}/kitchen/api/auth/login`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'x'.repeat(9000) }),
    }),
    new Request(`${origin}/kitchen/api/auth/login`, {
      method: 'POST',
      headers: { origin, 'content-type': 'text/plain' },
      body: '{}',
    }),
  ]) {
    const f = fixture();
    await result(
      await handleKitchenGateway(request, ['auth', 'login'], f.dependencies),
      request.headers.get('content-type') === 'text/plain' ? 400 : 413,
    );
    assert.equal(f.calls.length, 0);
  }
});
test('refresh rotates chef cookies, preserves the registered deadline and retries an identical versioned mutation', async () => {
  let writes = 0;
  const f = fixture((path, body) => {
    if (path === 'auth/refresh') {
      assert.deepEqual(body, { refreshToken: session.refreshToken });
      return Response.json({
        profile,
        session: { ...session, accessToken: 'PRIVATE_CHEF_NEW_TOKEN' },
      });
    }
    if (!writes++) return Response.json({ code: 'auth_required' }, { status: 401 });
    return Response.json({ profile, ticket: { id: 'ticket' }, session });
  });
  f.active();
  const id = '11111111-1111-4111-8111-111111111111',
    body = { expectedVersion: 4, status: 'ready' };
  assert.deepEqual(
    await result(
      await handleKitchenGateway(
        f.request(`orders/${id}`, 'PATCH', body),
        ['orders', id],
        f.dependencies,
      ),
      200,
    ),
    { profile, ticket: { id: 'ticket' } },
  );
  assert.deepEqual(
    f.calls.map((c) => c.path),
    [`orders/${id}`, 'auth/refresh', `orders/${id}`],
  );
  assert.deepEqual(f.calls[0].body, f.calls[2].body);
  assert.equal(f.jar.get('hpa_kitchen_deadline'), String(Date.parse(profile.expiresAt)));
  assert.equal(f.calls[2].headers.get('authorization'), 'Bearer PRIVATE_CHEF_NEW_TOKEN');
});
test('revocation clears all chef cookies without touching the owner session', async () => {
  const f = fixture(() => Response.json({ code: 'session_revoked' }, { status: 401 }));
  f.active();
  await result(await handleKitchenGateway(f.request('queue'), ['queue'], f.dependencies), 401);
  assert.equal(
    [...f.jar.keys()].some((key) => key.startsWith('hpa_kitchen_')),
    false,
  );
  assert.equal(f.jar.get('sb-owner-auth-token'), 'PRIVATE_OWNER_COOKIE');
});
test('expired fixed deadline never refreshes into another shift', async () => {
  const f = fixture();
  f.active();
  f.jar.set('hpa_kitchen_deadline', String(now - 1));
  await result(await handleKitchenGateway(f.request('queue'), ['queue'], f.dependencies), 401);
  assert.equal(f.calls.length, 0);
});
test('refresh cannot extend registration and internal session data never reaches the browser', async () => {
  const f = fixture(() =>
    Response.json({
      profile: { ...profile, expiresAt: new Date(now + 11 * 3600_000).toISOString() },
      session,
    }),
  );
  f.active();
  f.jar.set('hpa_kitchen_access_expiry', String(now - 1));
  await result(await handleKitchenGateway(f.request('queue'), ['queue'], f.dependencies), 503);
  assert.equal(f.calls.length, 1);
});
test('network uncertainty does not retry a preparation mutation', async () => {
  const f = fixture(() => {
    throw new Error('UNTRUSTED_PROVIDER_SECRET');
  });
  f.active();
  const id = '11111111-1111-4111-8111-111111111111';
  await result(
    await handleKitchenGateway(
      f.request(`orders/${id}`, 'PATCH', { status: 'ready', expectedVersion: 2 }),
      ['orders', id],
      f.dependencies,
    ),
    503,
  );
  assert.equal(f.calls.length, 1);
});
test('logout clears local chef cookies even when refresh or upstream signout is unavailable', async () => {
  const f = fixture(() => Response.json({ code: 'kitchen_unavailable' }, { status: 503 }));
  f.active();
  f.jar.set('hpa_kitchen_access_expiry', String(now - 1));
  await result(
    await handleKitchenGateway(
      f.request('auth/logout', 'POST', {}),
      ['auth', 'logout'],
      f.dependencies,
    ),
    503,
  );
  assert.equal(
    [...f.jar.keys()].some((key) => key.startsWith('hpa_kitchen_')),
    false,
  );
  assert.equal(f.jar.get('sb-owner-auth-token'), 'PRIVATE_OWNER_COOKIE');
});
test('owner management forwards only the verified owner token and never touches chef cookies', async () => {
  const f = fixture(() =>
    Response.json({ staff: [], branches: [{ id: 'barra', name: 'Barra' }], session }),
  );
  f.active();
  assert.deepEqual(
    await result(
      await handleKitchenGateway(f.request('unused'), ['admin', 'staff'], f.dependencies, true),
      200,
    ),
    { staff: [], branches: [{ id: 'barra', name: 'Barra' }] },
  );
  assert.equal(f.owners(), 1);
  assert.equal(f.calls[0].headers.get('authorization'), 'Bearer PRIVATE_VERIFIED_OWNER_TOKEN');
  assert.equal(f.writes.length, 0);
});
test('unexpected error codes and provider text cannot echo credentials', async () => {
  const f = fixture(() =>
    Response.json(
      { code: 'UNTRUSTED_PROVIDER_SECRET', error: 'PRIVATE_OWNER_PASSWORD' },
      { status: 400 },
    ),
  );
  assert.equal(
    (
      await result(
        await handleKitchenGateway(f.request('session'), ['session'], f.dependencies),
        400,
      )
    ).code,
    'kitchen_unavailable',
  );
});
