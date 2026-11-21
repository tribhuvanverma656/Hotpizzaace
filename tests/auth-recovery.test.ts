import assert from 'node:assert/strict';
import test from 'node:test';
import {
  handleRecoveryConfirmation,
  validRecoveryTokenHash,
  type RecoveryClient,
} from '../lib/auth/recovery';
import { hasRecentRecoveryClaims } from '../lib/auth/password';

const origin = 'https://app.example.invalid';
const now = Date.parse('2026-10-21T12:00:00Z');
const tokenHash = 'pkce_' + 'a'.repeat(56);
const password = 'Offline test password phrase 123!';
const accessToken = 'OFFLINE_NEW_EMAIL_TOKEN_ONLY';
const owner = { id: 'verified-email-owner', email_confirmed_at: '2026-10-20T12:00:00Z' };
type Method = (...args: unknown[]) => Promise<unknown>;

function fixture(overrides: Record<string, Method> = {}) {
  const calls: { method: string; args: unknown[] }[] = [];
  let creations = 0;
  const methods: Record<string, Method> = {
    verifyOtp: async () => ({
      data: { user: owner, session: { user: owner, access_token: accessToken } },
      error: null,
    }),
    getUser: async () => ({ data: { user: owner }, error: null }),
    getClaims: async () => ({
      data: { claims: { sub: owner.id, amr: [{ method: 'otp', timestamp: now / 1000 }] } },
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
  } as unknown as RecoveryClient;
  return {
    calls,
    client,
    creations: () => creations,
    dependencies: {
      createClient: async () => {
        creations++;
        return client;
      },
      origin: () => origin,
      now: () => now,
    },
  };
}

function form(values: Record<string, string> = {}, headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/auth/recovery`, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Sec-Fetch-Site': 'same-origin',
      'Content-Type': 'application/x-www-form-urlencoded',
      ...headers,
    },
    body: new URLSearchParams({
      token_hash: tokenHash,
      type: 'recovery',
      password,
      confirmPassword: password,
      ...values,
    }),
  });
}

async function outcome(response: Response, status: number) {
  assert.equal(response.status, status);
  assert.match(response.headers.get('cache-control') ?? '', /private.*no-store/);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.has('location'), false);
  const text = await response.text();
  for (const secret of [tokenHash, password, accessToken, 'PRIVATE_PROVIDER_TEXT'])
    assert.equal(text.includes(secret), false);
  return JSON.parse(text);
}

test('recovery hash validation accepts bounded URL-safe hashes only', () => {
  for (const value of ['x'.repeat(32), tokenHash, 'x'.repeat(256), '_-'.repeat(24)])
    assert.equal(validRecoveryTokenHash(value), true);
  for (const value of [
    null,
    {},
    '',
    'x'.repeat(31),
    'x'.repeat(257),
    'x '.repeat(32),
    '%'.repeat(64),
  ])
    assert.equal(validRecoveryTokenHash(value), false);
});

test('GET, HEAD and other methods cannot consume email tokens or create an auth client', async () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'DELETE']) {
    const f = fixture();
    const response = await handleRecoveryConfirmation(
      new Request(`${origin}/api/auth/recovery?token_hash=${tokenHash}&type=recovery`, { method }),
      f.dependencies,
    );
    assert.equal(response.headers.get('allow'), 'POST');
    assert.deepEqual(await outcome(response, 405), { ok: false, error: 'method_not_allowed' });
    assert.equal(f.creations(), 0);
    assert.equal(f.calls.length, 0);
  }
});

test('exact Origin and same-origin fetch metadata are required before consuming a token', async () => {
  for (const headers of [
    { Origin: '' },
    { Origin: 'null' },
    { Origin: 'https://other.example.invalid' },
    { Origin: origin + '/' },
    { 'Sec-Fetch-Site': 'cross-site' },
    { 'Sec-Fetch-Site': 'same-site' },
    { 'Sec-Fetch-Site': 'none' },
    { 'Sec-Fetch-Site': 'unknown' },
  ] as Record<string, string>[]) {
    const f = fixture();
    assert.deepEqual(
      await outcome(await handleRecoveryConfirmation(form({}, headers), f.dependencies), 403),
      { ok: false, error: 'invalid_origin' },
    );
    assert.equal(f.creations(), 0);
  }
  const f = fixture();
  const request = form();
  request.headers.delete('Sec-Fetch-Site');
  assert.equal((await handleRecoveryConfirmation(request, f.dependencies)).status, 200);
});

test('invalid canonical origin fails closed without reflecting request headers', async () => {
  const f = fixture();
  const response = await handleRecoveryConfirmation(form(), {
    ...f.dependencies,
    origin: () => {
      throw new Error('PRIVATE_PROVIDER_TEXT');
    },
  });
  assert.deepEqual(await outcome(response, 400), { ok: false, error: 'invalid_origin' });
  assert.equal(f.creations(), 0);
});

test('unknown fields, duplicate fields, non-recovery types and invalid hashes never consume tokens', async () => {
  const requests = [
    form({ next: 'https://other.example.invalid' }),
    form({ type: 'email' }),
    form({ type: 'magiclink' }),
    form({ token_hash: '' }),
    form({ token_hash: 'x'.repeat(257) }),
    form({ token_hash: 'x'.repeat(31) }),
    form({ token_hash: '<script>PRIVATE_PROVIDER_TEXT</script>' }),
  ];
  for (const field of ['token_hash', 'type', 'password', 'confirmPassword']) {
    const body = new URLSearchParams({
      token_hash: tokenHash,
      type: 'recovery',
      password,
      confirmPassword: password,
    });
    body.append(field, body.get(field)!);
    requests.push(
      new Request(`${origin}/api/auth/recovery`, {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      }),
    );
  }
  for (const request of requests) {
    const f = fixture();
    assert.deepEqual(
      await outcome(await handleRecoveryConfirmation(request, f.dependencies), 400),
      {
        ok: false,
        error: 'invalid_request',
      },
    );
    assert.equal(f.creations(), 0);
  }
});

test('JSON, missing bodies, malformed UTF-8 and oversized streamed forms fail before auth', async () => {
  const requests = [
    form({}, { 'Content-Type': 'application/json' }),
    form({}, { 'Content-Length': '8193' }),
    new Request(`${origin}/api/auth/recovery`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
    }),
    new Request(`${origin}/api/auth/recovery`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new Uint8Array([255]),
    }),
    new Request(`${origin}/api/auth/recovery`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(8192));
          controller.enqueue(new Uint8Array(1));
          controller.close();
        },
      }),
      duplex: 'half',
    } as RequestInit),
  ];
  for (const request of requests) {
    const f = fixture();
    assert.deepEqual(
      await outcome(await handleRecoveryConfirmation(request, f.dependencies), 400),
      { ok: false, error: 'invalid_request' },
    );
    assert.equal(f.creations(), 0);
  }
});

test('password requirements and confirmation are checked before one-time verification', async () => {
  for (const value of ['', 'short', ' '.repeat(12), 'x'.repeat(129)]) {
    const f = fixture();
    assert.deepEqual(
      await outcome(
        await handleRecoveryConfirmation(
          form({ password: value, confirmPassword: value }),
          f.dependencies,
        ),
        400,
      ),
      { ok: false, error: 'password_requirements' },
    );
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  assert.deepEqual(
    await outcome(
      await handleRecoveryConfirmation(form({ confirmPassword: password + 'x' }), f.dependencies),
      400,
    ),
    { ok: false, error: 'password_mismatch' },
  );
  assert.equal(f.calls.length, 0);
});

test('fresh email verification and password change work without any pre-existing cookies', async () => {
  const f = fixture();
  const request = form();
  assert.equal(request.headers.has('cookie'), false);
  assert.deepEqual(await outcome(await handleRecoveryConfirmation(request, f.dependencies), 200), {
    ok: true,
    signInPath: '/admin/login?auth_notice=password_updated',
  });
  assert.deepEqual(
    f.calls.map((call) => call.method),
    ['verifyOtp', 'getUser', 'getClaims', 'updateUser', 'signOut'],
  );
  assert.equal(
    JSON.stringify(f.calls[0].args) ===
      JSON.stringify([{ token_hash: tokenHash, type: 'recovery' }]),
    true,
  );
  assert.equal(f.calls[1].args[0] === accessToken, true);
  assert.equal(f.calls[2].args[0] === accessToken, true);
  assert.equal((f.calls[3].args[0] as { password: string }).password === password, true);
  assert.deepEqual(f.calls[4].args, [{ scope: 'global' }]);
  // Existing OTP sessions remain ineligible for the separate password-update endpoint.
  assert.equal(
    hasRecentRecoveryClaims(
      { sub: owner.id, amr: [{ method: 'otp', timestamp: now / 1000 }] },
      owner.id,
      now,
    ),
    false,
  );
});

test('old Google cookies cannot replace successful email-token verification', async () => {
  const f = fixture({
    verifyOtp: async () => ({
      data: { user: null, session: null },
      error: { code: 'otp_expired', message: 'PRIVATE_PROVIDER_TEXT' },
    }),
  });
  const request = form({}, { Cookie: 'offline-google-session=existing' });
  assert.deepEqual(await outcome(await handleRecoveryConfirmation(request, f.dependencies), 410), {
    ok: false,
    error: 'recovery_expired',
  });
  assert.deepEqual(
    f.calls.map((call) => call.method),
    ['verifyOtp'],
  );
});

test('repeated use is rejected by fresh verification and cannot change a password twice', async () => {
  let used = false;
  const f = fixture({
    verifyOtp: async () => {
      if (used) return { data: { user: null, session: null }, error: { code: 'otp_expired' } };
      used = true;
      return {
        data: { user: owner, session: { user: owner, access_token: accessToken } },
        error: null,
      };
    },
  });
  assert.equal((await handleRecoveryConfirmation(form(), f.dependencies)).status, 200);
  assert.deepEqual(await outcome(await handleRecoveryConfirmation(form(), f.dependencies), 410), {
    ok: false,
    error: 'recovery_expired',
  });
  assert.equal(f.calls.filter((call) => call.method === 'updateUser').length, 1);
});

test('missing or inconsistent newly issued sessions fail before identity checks or mutation', async () => {
  for (const data of [
    { user: owner, session: null },
    { user: null, session: { user: owner, access_token: accessToken } },
    { user: owner, session: { user: owner, access_token: '' } },
    { user: owner, session: { user: { id: 'other' }, access_token: accessToken } },
  ]) {
    const f = fixture({ verifyOtp: async () => ({ data, error: null }) });
    assert.equal((await handleRecoveryConfirmation(form(), f.dependencies)).status, 410);
    assert.deepEqual(
      f.calls.map((call) => call.method),
      ['verifyOtp'],
    );
  }
});

test('identity and signed claims must match the fresh verified email session', async () => {
  for (const data of [
    { user: null },
    { user: { ...owner, id: 'other' } },
    { user: { ...owner, email_confirmed_at: null } },
  ]) {
    const f = fixture({ getUser: async () => ({ data, error: null }) });
    assert.equal((await handleRecoveryConfirmation(form(), f.dependencies)).status, 410);
    assert.equal(
      f.calls.some((call) => call.method === 'updateUser'),
      false,
    );
  }
  for (const claims of [
    null,
    { sub: 'other', amr: [{ method: 'otp', timestamp: now / 1000 }] },
    { sub: owner.id },
    { sub: owner.id, amr: ['otp'] },
    { sub: owner.id, amr: [{ method: 'oauth', timestamp: now / 1000 }] },
    { sub: owner.id, amr: [{ method: 'otp', timestamp: now / 1000 - 901 }] },
    { sub: owner.id, amr: [{ method: 'otp', timestamp: now / 1000 + 61 }] },
    { sub: owner.id, amr: [{ method: 'otp', timestamp: String(now / 1000) }] },
  ]) {
    const f = fixture({ getClaims: async () => ({ data: { claims }, error: null }) });
    assert.equal((await handleRecoveryConfirmation(form(), f.dependencies)).status, 410);
    assert.equal(
      f.calls.some((call) => call.method === 'updateUser'),
      false,
    );
  }
});

test('fresh OTP and recovery AMR accept exact age and clock-tolerance boundaries only', async () => {
  for (const method of ['otp', 'recovery'])
    for (const offset of [-900, 0, 60]) {
      const f = fixture({
        getClaims: async () => ({
          data: { claims: { sub: owner.id, amr: [{ method, timestamp: now / 1000 + offset }] } },
          error: null,
        }),
      });
      assert.equal((await handleRecoveryConfirmation(form(), f.dependencies)).status, 200);
    }
});

test('provider failures and thrown exceptions stay finite and cannot mutate passwords', async () => {
  for (const method of ['verifyOtp', 'getUser', 'getClaims']) {
    for (const throws of [false, true]) {
      const f = fixture({
        [method]: async () => {
          if (throws) throw new Error('PRIVATE_PROVIDER_TEXT');
          return { data: null, error: { status: 503, message: 'PRIVATE_PROVIDER_TEXT' } };
        },
      });
      assert.deepEqual(
        await outcome(await handleRecoveryConfirmation(form(), f.dependencies), 503),
        { ok: false, error: 'auth_unavailable' },
      );
      assert.equal(
        f.calls.some((call) => call.method === 'updateUser'),
        false,
      );
    }
  }
  const f = fixture();
  assert.deepEqual(
    await outcome(
      await handleRecoveryConfirmation(form(), {
        ...f.dependencies,
        createClient: async () => {
          throw new Error('PRIVATE_PROVIDER_TEXT');
        },
      }),
      503,
    ),
    { ok: false, error: 'auth_unavailable' },
  );
});

test('returned or thrown update failures require a fresh email link and never claim success', async () => {
  for (const throws of [false, true]) {
    const f = fixture({
      updateUser: async () => {
        if (throws) throw new Error('PRIVATE_PROVIDER_TEXT');
        return { data: null, error: { message: 'PRIVATE_PROVIDER_TEXT' } };
      },
    });
    assert.deepEqual(await outcome(await handleRecoveryConfirmation(form(), f.dependencies), 503), {
      ok: false,
      error: 'password_update_failed',
    });
    assert.equal(
      f.calls.some((call) => call.method === 'signOut'),
      false,
    );
  }
});

test('a committed password change remains successful if global sign-out fails', async () => {
  for (const throws of [false, true]) {
    const f = fixture({
      signOut: async () => {
        if (throws) throw new Error('PRIVATE_PROVIDER_TEXT');
        return { error: { message: 'PRIVATE_PROVIDER_TEXT' } };
      },
    });
    assert.deepEqual(await outcome(await handleRecoveryConfirmation(form(), f.dependencies), 200), {
      ok: true,
      signInPath: '/admin/login?auth_notice=password_updated',
    });
  }
});
