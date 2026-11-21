import assert from 'node:assert/strict';
import test from 'node:test';
import { ADMIN_LOGIN_ID } from '../lib/auth/admin-account';
import {
  handleOwnerPassword,
  isVerifiedOwnerSession,
  type OwnerPasswordClient,
} from '../lib/auth/owner-password';

const origin = 'https://owner-fixture.example.invalid';
const now = Date.parse('2026-10-21T12:00:00Z');
const password = 'Offline owner password phrase 123!';
const owner = {
  id: 'verified-owner-uid',
  email: ADMIN_LOGIN_ID,
  email_confirmed_at: '2026-10-20T12:00:00Z',
  identities: [{ provider: 'google', user_id: 'verified-owner-uid' }],
};
type Method = (...args: unknown[]) => Promise<unknown>;

function fixture(overrides: Record<string, Method> = {}, membership = true) {
  const calls: { method: string; args: unknown[] }[] = [];
  let creations = 0;
  const methods: Record<string, Method> = {
    getUser: async () => ({ data: { user: owner }, error: null }),
    getClaims: async () => ({
      data: { claims: { sub: owner.id, amr: [{ method: 'oauth', timestamp: now / 1000 }] } },
      error: null,
    }),
    updateUser: async () => ({ data: { user: owner }, error: null }),
    signOut: async () => ({ error: null }),
    ...overrides,
  };
  const client = {
    auth: Object.fromEntries(
      Object.entries(methods).map(([method, implementation]) => [
        method,
        async (...args: unknown[]) => {
          calls.push({ method, args });
          return implementation(...args);
        },
      ]),
    ),
  } as unknown as OwnerPasswordClient;
  return {
    calls,
    creations: () => creations,
    dependencies: {
      createClient: async () => {
        creations++;
        return client;
      },
      verifyOwner: async (request: Request, userId: string) => {
        calls.push({ method: 'verifyOwner', args: [request.method, userId] });
        return membership;
      },
      origin: () => origin,
      now: () => now,
    },
  };
}

function request(
  method = 'POST',
  values: Record<string, string> = {},
  headers: Record<string, string> = {},
) {
  return new Request(`${origin}/api/auth/owner-password`, {
    method,
    headers: {
      Origin: origin,
      'Sec-Fetch-Site': 'same-origin',
      'Content-Type': 'application/x-www-form-urlencoded',
      ...headers,
    },
    ...(method === 'POST'
      ? { body: new URLSearchParams({ password, confirmPassword: password, ...values }) }
      : {}),
  });
}

async function result(response: Response, status: number) {
  assert.equal(response.status, status);
  assert.match(response.headers.get('cache-control') ?? '', /private.*no-store/);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.has('location'), false);
  const text = await response.text();
  for (const secret of [password, 'PRIVATE_PROVIDER_TEXT', 'PRIVATE_ACCESS_TOKEN'])
    assert.equal(text.includes(secret), false);
  return JSON.parse(text);
}

function unchanged(f: ReturnType<typeof fixture>) {
  assert.equal(
    f.calls.some((call) => call.method === 'updateUser' || call.method === 'signOut'),
    false,
  );
}

test('only a protected shared owner session for the same verified UID proves membership', () => {
  assert.equal(
    isVerifiedOwnerSession({ shared: true, admin: true, user: { id: owner.id } }, owner.id),
    true,
  );
  for (const value of [
    null,
    [],
    {},
    { shared: false, admin: true, user: { id: owner.id } },
    { shared: true, admin: false, user: { id: owner.id } },
    { shared: true, admin: 'true', user: { id: owner.id } },
    { shared: true, admin: true, user: { id: 'other-uid' } },
    { shared: true, admin: true, user: null },
    { shared: true, admin: true, user: [] },
    { role: 'owner', user: { id: owner.id }, user_metadata: { admin: true } },
  ])
    assert.equal(isVerifiedOwnerSession(value, owner.id), false);
});

test('GET checks fresh owner authorization and returns readiness without changing credentials', async () => {
  const f = fixture();
  assert.deepEqual(await result(await handleOwnerPassword(request('GET'), f.dependencies), 200), {
    ok: true,
    ready: true,
    loginId: ADMIN_LOGIN_ID,
  });
  assert.deepEqual(
    f.calls.map((call) => call.method),
    ['getUser', 'getClaims', 'verifyOwner'],
  );
  assert.deepEqual(f.calls[2].args, ['GET', owner.id]);
  unchanged(f);
});

test('unsupported methods never create a client or change credentials', async () => {
  for (const method of ['HEAD', 'OPTIONS', 'PUT', 'PATCH', 'DELETE']) {
    const f = fixture();
    const response = await handleOwnerPassword(request(method), f.dependencies);
    assert.equal(response.headers.get('allow'), 'GET, POST');
    assert.equal((await result(response, 405)).error, 'method_not_allowed');
    assert.equal(f.creations(), 0);
  }
});

test('POST refuses foreign, null and missing origins and anything beyond same-origin fetch metadata', async () => {
  for (const headers of [
    { Origin: '' },
    { Origin: 'null' },
    { Origin: 'https://other.example.invalid' },
    { 'Sec-Fetch-Site': 'cross-site' },
    { 'Sec-Fetch-Site': 'same-site' },
    { 'Sec-Fetch-Site': 'none' },
    { 'Sec-Fetch-Site': 'unknown' },
  ] as Record<string, string>[]) {
    const f = fixture();
    assert.equal(
      (await result(await handleOwnerPassword(request('POST', {}, headers), f.dependencies), 403))
        .error,
      'invalid_origin',
    );
    assert.equal(f.creations(), 0);
  }
  const f = fixture();
  const post = request();
  post.headers.delete('sec-fetch-site');
  assert.equal((await handleOwnerPassword(post, f.dependencies)).status, 200);
});

test('invalid, duplicate, unknown and oversized form fields fail before auth or password changes', async () => {
  const cases = [
    request('POST', { userId: 'another-account' }),
    request('POST', { email: 'another@example.invalid' }),
    request('POST', {}, { 'Content-Type': 'application/json' }),
    request('POST', {}, { 'Content-Length': '8193' }),
    new Request(`${origin}/api/auth/owner-password`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams([
        ['password', password],
        ['password', password],
        ['confirmPassword', password],
      ]),
    }),
    new Request(`${origin}/api/auth/owner-password`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'password=' + 'x'.repeat(9000),
    }),
    new Request(`${origin}/api/auth/owner-password`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new Uint8Array([255]),
    }),
  ];
  for (const post of cases) {
    const f = fixture();
    assert.equal(
      (await result(await handleOwnerPassword(post, f.dependencies), 400)).error,
      'invalid_request',
    );
    assert.equal(f.creations(), 0);
  }
});

test('new password strength and matching confirmation are enforced before auth', async () => {
  for (const value of ['', 'short', ' '.repeat(12), 'x'.repeat(129)]) {
    const f = fixture();
    assert.equal(
      (
        await result(
          await handleOwnerPassword(
            request('POST', { password: value, confirmPassword: value }),
            f.dependencies,
          ),
          400,
        )
      ).error,
      'password_requirements',
    );
    assert.equal(f.creations(), 0);
  }
  const f = fixture();
  assert.equal(
    (
      await result(
        await handleOwnerPassword(
          request('POST', { confirmPassword: password + 'x' }),
          f.dependencies,
        ),
        400,
      )
    ).error,
    'password_mismatch',
  );
  assert.equal(f.creations(), 0);
});

test('anonymous, wrong-owner and unconfirmed accounts cannot create an admin password', async () => {
  for (const [user, status] of [
    [null, 401],
    [{ ...owner, email: 'customer@example.invalid' }, 403],
    [{ ...owner, email_confirmed_at: null }, 403],
    [{ ...owner, email: null }, 403],
  ] as const) {
    for (const method of ['GET', 'POST']) {
      const f = fixture({ getUser: async () => ({ data: { user }, error: null }) });
      assert.equal((await handleOwnerPassword(request(method), f.dependencies)).status, status);
      assert.deepEqual(
        f.calls.map((call) => call.method),
        ['getUser'],
      );
      unchanged(f);
    }
  }
});

test('editable Google metadata or another identity cannot replace a verified linked Google identity', async () => {
  for (const identities of [
    undefined,
    [],
    [{ provider: 'email', user_id: owner.id }],
    [{ provider: 'google', user_id: 'other-uid' }],
  ]) {
    const f = fixture({
      getUser: async () => ({
        data: {
          user: { ...owner, identities, user_metadata: { provider: 'google', admin: true } },
        },
        error: null,
      }),
    });
    assert.equal(
      (await result(await handleOwnerPassword(request(), f.dependencies), 401)).error,
      'reauth_required',
    );
    assert.deepEqual(
      f.calls.map((call) => call.method),
      ['getUser'],
    );
    unchanged(f);
  }
});

test('fresh signed OAuth proof must match the verified UID and detailed AMR timestamp', async () => {
  for (const claims of [
    null,
    { sub: owner.id },
    { sub: owner.id, amr: ['oauth'] },
    { sub: 'other-uid', amr: [{ method: 'oauth', timestamp: now / 1000 }] },
    { sub: owner.id, amr: [{ method: 'password', timestamp: now / 1000 }] },
    { sub: owner.id, amr: [{ method: 'recovery', timestamp: now / 1000 }] },
    { sub: owner.id, amr: [{ method: 'otp', timestamp: now / 1000 }] },
    { sub: owner.id, amr: [{ method: 'oauth', timestamp: now / 1000 - 901 }] },
    { sub: owner.id, amr: [{ method: 'oauth', timestamp: now / 1000 + 61 }] },
    { sub: owner.id, amr: [{ method: 'oauth', timestamp: String(now / 1000) }] },
    { sub: owner.id, amr: [{ method: 'oauth', timestamp: now / 1000 + 0.5 }] },
  ]) {
    const f = fixture({ getClaims: async () => ({ data: { claims }, error: null }) });
    assert.equal(
      (await result(await handleOwnerPassword(request(), f.dependencies), 401)).error,
      'reauth_required',
    );
    assert.equal(
      f.calls.some((call) => call.method === 'verifyOwner'),
      false,
    );
    unchanged(f);
  }
});

test('exact OAuth age and future clock-tolerance boundaries authorize the verified owner', async () => {
  for (const offset of [-900, 0, 60]) {
    const f = fixture({
      getClaims: async () => ({
        data: {
          claims: { sub: owner.id, amr: [{ method: 'oauth', timestamp: now / 1000 + offset }] },
        },
        error: null,
      }),
    });
    assert.equal((await handleOwnerPassword(request('GET'), f.dependencies)).status, 200);
    unchanged(f);
  }
});

test('customer membership, removed membership and inconsistent server UID cannot authorize updates', async () => {
  const f = fixture({}, false);
  assert.equal(
    (await result(await handleOwnerPassword(request(), f.dependencies), 403)).error,
    'forbidden',
  );
  assert.deepEqual(
    f.calls.map((call) => call.method),
    ['getUser', 'getClaims', 'verifyOwner'],
  );
  unchanged(f);
  const other = fixture();
  assert.equal(
    (
      await handleOwnerPassword(request(), {
        ...other.dependencies,
        verifyOwner: async (_request, uid) =>
          isVerifiedOwnerSession({ shared: true, admin: true, user: { id: 'other-uid' } }, uid),
      })
    ).status,
    403,
  );
  unchanged(other);
});

test('POST rechecks server membership even after GET previously reported ready', async () => {
  let ownerMember = true;
  const f = fixture();
  const dependencies = { ...f.dependencies, verifyOwner: async () => ownerMember };
  assert.equal((await handleOwnerPassword(request('GET'), dependencies)).status, 200);
  ownerMember = false;
  assert.equal((await handleOwnerPassword(request(), dependencies)).status, 403);
  unchanged(f);
});

test('identity, claims, membership and client errors fail closed without provider details', async () => {
  for (const method of ['getUser', 'getClaims']) {
    for (const throws of [false, true]) {
      const f = fixture({
        [method]: async () => {
          if (throws) throw new Error('PRIVATE_PROVIDER_TEXT');
          return { data: null, error: { status: 503, message: 'PRIVATE_PROVIDER_TEXT' } };
        },
      });
      assert.equal(
        (await result(await handleOwnerPassword(request(), f.dependencies), 503)).error,
        'auth_unavailable',
      );
      unchanged(f);
    }
  }
  for (const failure of ['createClient', 'verifyOwner']) {
    const f = fixture();
    const dependencies = {
      ...f.dependencies,
      [failure]: async () => {
        throw new Error('PRIVATE_PROVIDER_TEXT');
      },
    };
    assert.equal(
      (await result(await handleOwnerPassword(request(), dependencies), 503)).error,
      'auth_unavailable',
    );
    unchanged(f);
  }
  const signedOut = fixture({
    getUser: async () => ({
      data: { user: null },
      error: { status: 400, message: 'PRIVATE_PROVIDER_TEXT' },
    }),
  });
  assert.equal(
    (await result(await handleOwnerPassword(request(), signedOut.dependencies), 401)).error,
    'reauth_required',
  );
  unchanged(signedOut);
});

test('an authorized owner saves only their password and globally signs out after commit', async () => {
  const f = fixture();
  assert.deepEqual(await result(await handleOwnerPassword(request(), f.dependencies), 200), {
    ok: true,
    signInPath: '/admin/login?auth_notice=password_updated',
  });
  assert.deepEqual(
    f.calls.map((call) => call.method),
    ['getUser', 'getClaims', 'verifyOwner', 'updateUser', 'signOut'],
  );
  assert.deepEqual(Object.keys(f.calls[3].args[0] as object), ['password']);
  assert.equal((f.calls[3].args[0] as { password: string }).password === password, true);
  assert.deepEqual(f.calls[4].args, [{ scope: 'global' }]);
});

test('returned and thrown password-update errors do not claim success or sign out', async () => {
  for (const throws of [false, true]) {
    const f = fixture({
      updateUser: async () => {
        if (throws) throw new Error('PRIVATE_PROVIDER_TEXT');
        return { data: null, error: { message: 'PRIVATE_PROVIDER_TEXT' } };
      },
    });
    assert.equal(
      (await result(await handleOwnerPassword(request(), f.dependencies), 503)).error,
      'password_update_failed',
    );
    assert.equal(
      f.calls.some((call) => call.method === 'signOut'),
      false,
    );
  }
});

test('a committed password stays successful if global sign-out returns an error or throws', async () => {
  for (const throws of [false, true]) {
    const f = fixture({
      signOut: async () => {
        if (throws) throw new Error('PRIVATE_PROVIDER_TEXT');
        return { error: { message: 'PRIVATE_PROVIDER_TEXT' } };
      },
    });
    assert.equal(
      (await result(await handleOwnerPassword(request(), f.dependencies), 200)).ok,
      true,
    );
  }
});
