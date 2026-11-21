import assert from 'node:assert/strict';
import test from 'node:test';
import {
  handleAuthCallback,
  type AuthCallbackClient,
  type AuthCallbackDependencies,
} from '../lib/auth/callback';

const origin = 'http://localhost:3001';
const now = Date.parse('2026-10-20T10:00:00Z');
const user = { id: 'verified-owner-id', email_confirmed_at: '2026-10-19T12:00:00Z' };
const code = 'PRIVATE_AUTH_CODE';
const recoveryNext = '/auth/reset-password';
const recoveryClaims = {
  sub: user.id,
  amr: [{ method: 'recovery', timestamp: now / 1000 }],
};
type MockMethod = (...args: unknown[]) => Promise<unknown>;

function fixture(overrides: Record<string, MockMethod> = {}) {
  const calls: { method: string; args: unknown[] }[] = [];
  let clientCreations = 0;
  const methods: Record<string, MockMethod> = {
    exchangeCodeForSession: async () => ({
      data: {
        user,
        session: { access_token: 'PRIVATE_ACCESS_TOKEN', refresh_token: 'PRIVATE_REFRESH_TOKEN' },
        redirectType: null,
      },
      error: null,
    }),
    getUser: async () => ({ data: { user }, error: null }),
    getClaims: async () => ({ data: { claims: recoveryClaims }, error: null }),
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
  } as unknown as AuthCallbackClient;
  return {
    calls,
    deps: {
      createClient: async () => {
        clientCreations++;
        return client;
      },
      origin: () => origin,
      now: () => now,
    } satisfies AuthCallbackDependencies,
    creations: () => clientCreations,
  };
}

function recoveryFixture(overrides: Record<string, MockMethod> = {}) {
  return fixture({
    exchangeCodeForSession: async () => ({ data: { user, redirectType: 'recovery' }, error: null }),
    ...overrides,
  });
}

function callback(parameters: Record<string, string> = {}) {
  const url = new URL('/auth/callback', origin);
  url.search = new URLSearchParams({ code, next: '/admin/dashboard', ...parameters }).toString();
  return new Request(url);
}

function privateResponse(response: Response) {
  assert.equal(
    response.headers.get('cache-control'),
    'private, no-cache, no-store, must-revalidate, max-age=0',
  );
  assert.equal(response.headers.get('pragma'), 'no-cache');
  assert.equal(response.headers.get('expires'), '0');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
}

async function destination(response: Response) {
  assert.equal(response.status, 303);
  privateResponse(response);
  assert.equal(await response.text(), '');
  const url = new URL(response.headers.get('location')!);
  assert.equal(url.origin, origin);
  assert.equal(url.toString().includes('PRIVATE'), false);
  for (const name of [
    'code',
    'sb_flow_id',
    'error',
    'error_description',
    'access_token',
    'refresh_token',
  ])
    assert.equal(url.searchParams.has(name), false);
  return url;
}

function expectFailure(url: URL, next: string, expected = 'callback_failed') {
  const recovery = next === recoveryNext;
  assert.equal(
    url.pathname,
    next.startsWith('/admin/') || recovery ? '/admin/login' : '/account/login',
  );
  assert.equal(url.searchParams.get('next'), next);
  assert.equal(url.searchParams.get('auth_error'), recovery ? 'recovery_expired' : expected);
  assert.equal(url.searchParams.get('auth_action'), recovery ? 'reset' : null);
}

test('verified Google callbacks preserve customer and admin destinations without requiring recovery', async () => {
  for (const next of ['/account/profile', '/checkout', '/admin/dashboard', '/admin/orders']) {
    const state = fixture();
    const url = await destination(await handleAuthCallback(callback({ next }), state.deps));
    assert.equal(url.pathname, next);
    assert.equal(url.search, '');
    assert.deepEqual(state.calls, [
      { method: 'exchangeCodeForSession', args: [code, undefined] },
      { method: 'getUser', args: [] },
    ]);
  }
});

test('callbacks forward the exact code and PKCE flow identifier to the auth SDK only', async () => {
  for (const flowId of ['PRIVATE_FLOW_ID', '']) {
    const state = fixture();
    await destination(await handleAuthCallback(callback({ sb_flow_id: flowId }), state.deps));
    assert.deepEqual(state.calls[0], {
      method: 'exchangeCodeForSession',
      args: [code, flowId ? { flowId } : undefined],
    });
  }
});

test('provider cancellation and other error payloads never exchange a code or reflect provider text', async () => {
  for (const next of ['/admin/dashboard', '/checkout', recoveryNext]) {
    for (const error of ['access_denied', 'otp_expired', 'PRIVATE_PROVIDER_ERROR', '']) {
      const state = fixture();
      const url = await destination(
        await handleAuthCallback(
          callback({ next, error, error_description: 'PRIVATE_EMAIL_OR_TOKEN' }),
          state.deps,
        ),
      );
      expectFailure(url, next, error === 'access_denied' ? 'access_denied' : 'callback_failed');
      assert.equal(state.creations(), 0);
      assert.deepEqual(state.calls, []);
    }
  }
});

test('missing, empty and oversized codes fail before creating an auth client', async () => {
  for (const next of ['/admin/dashboard', recoveryNext]) {
    for (const value of [null, '', 'x'.repeat(2049)]) {
      const request = callback({ next, code: value ?? '' });
      const url = new URL(request.url);
      if (value === null) url.searchParams.delete('code');
      const state = fixture();
      expectFailure(
        await destination(await handleAuthCallback(new Request(url), state.deps)),
        next,
      );
      assert.equal(state.creations(), 0);
    }
  }
  const state = fixture();
  assert.equal(
    (await destination(await handleAuthCallback(callback({ code: 'x'.repeat(2048) }), state.deps)))
      .pathname,
    '/admin/dashboard',
  );
  assert.equal(state.calls[0].args[0], 'x'.repeat(2048));
});

test('expired, reused and browser-mismatched recovery codes return to the reset email form', async () => {
  for (const providerCode of [
    'otp_expired',
    'flow_state_not_found',
    'pkce_code_verifier_not_found',
  ]) {
    for (const next of ['/admin/dashboard', recoveryNext]) {
      const state = fixture({
        exchangeCodeForSession: async () => ({
          data: { user: null, session: null, redirectType: null },
          error: { code: providerCode, message: 'PRIVATE_PKCE_VERIFIER_OR_TOKEN' },
        }),
      });
      expectFailure(
        await destination(await handleAuthCallback(callback({ next }), state.deps)),
        next,
      );
      assert.deepEqual(
        state.calls.map((call) => call.method),
        ['exchangeCodeForSession'],
      );
    }
  }
});

test('client creation and exchange exceptions stay redacted and preserve recovery mode', async () => {
  for (const next of ['/admin/dashboard', recoveryNext]) {
    const state = fixture({
      exchangeCodeForSession: async () => {
        throw new Error('PRIVATE_NETWORK_OR_AUTH_SECRET');
      },
    });
    expectFailure(
      await destination(await handleAuthCallback(callback({ next }), state.deps)),
      next,
    );
    assert.equal(state.calls.length, 1);
    expectFailure(
      await destination(
        await handleAuthCallback(callback({ next }), {
          ...state.deps,
          createClient: async () => {
            throw new Error('PRIVATE_CONFIGURATION');
          },
        }),
      ),
      next,
    );
  }
});

test('callback success requires a server-verified user even when exchange includes a user and session', async () => {
  for (const next of ['/admin/dashboard', recoveryNext]) {
    for (const getUser of [
      async () => ({ data: { user: null }, error: null }),
      async () => ({ data: { user }, error: { message: 'PRIVATE_VERIFICATION' } }),
      async () => {
        throw new Error('PRIVATE_VERIFICATION');
      },
    ]) {
      const state = recoveryFixture({ getUser });
      expectFailure(
        await destination(await handleAuthCallback(callback({ next }), state.deps)),
        next,
      );
      assert.deepEqual(
        state.calls.map((call) => call.method),
        ['exchangeCodeForSession', 'getUser'],
      );
    }
  }
});

test('a verified recovery exchange and recent signed recovery claims open the password form', async () => {
  const state = recoveryFixture();
  const url = await destination(
    await handleAuthCallback(callback({ next: recoveryNext }), state.deps),
  );
  assert.equal(url.pathname, recoveryNext);
  assert.equal(url.search, '');
  assert.deepEqual(
    state.calls.map((call) => call.method),
    ['exchangeCodeForSession', 'getUser', 'getClaims'],
  );
});

test('normal sign-in and signup exchanges cannot enter recovery even with recovery claims', async () => {
  for (const exchanged of [
    { user },
    { user, redirectType: null },
    { user, redirectType: 'signup' },
    { user, redirectType: 'signin' },
  ]) {
    const state = fixture({
      exchangeCodeForSession: async () => ({ data: exchanged, error: null }),
    });
    expectFailure(
      await destination(await handleAuthCallback(callback({ next: recoveryNext }), state.deps)),
      recoveryNext,
    );
    assert.equal(
      state.calls.some((call) => call.method === 'getClaims'),
      false,
    );
  }
});

test('recovery requires a confirmed email from the verified user', async () => {
  const state = recoveryFixture({
    getUser: async () => ({
      data: { user: { ...user, email_confirmed_at: undefined } },
      error: null,
    }),
  });
  expectFailure(
    await destination(await handleAuthCallback(callback({ next: recoveryNext }), state.deps)),
    recoveryNext,
  );
  assert.equal(
    state.calls.some((call) => call.method === 'getClaims'),
    false,
  );
});

test('recovery rejects missing, mismatched, stale, future and normal-session claims', async () => {
  for (const claims of [
    null,
    {},
    { ...recoveryClaims, sub: 'another-user' },
    { sub: user.id },
    { ...recoveryClaims, amr: ['recovery'] },
    { ...recoveryClaims, amr: [{ method: 'oauth', timestamp: now / 1000 }] },
    { ...recoveryClaims, amr: [{ method: 'password', timestamp: now / 1000 }] },
    { ...recoveryClaims, amr: [{ method: 'recovery', timestamp: now / 1000 - 901 }] },
    { ...recoveryClaims, amr: [{ method: 'recovery', timestamp: now / 1000 + 61 }] },
    { ...recoveryClaims, amr: [{ method: 'recovery', timestamp: String(now / 1000) }] },
  ]) {
    const state = recoveryFixture({ getClaims: async () => ({ data: { claims }, error: null }) });
    expectFailure(
      await destination(await handleAuthCallback(callback({ next: recoveryNext }), state.deps)),
      recoveryNext,
    );
    assert.equal(state.calls.at(-1)?.method, 'getClaims');
  }
});

test('recovery age checks accept the exact allowed past and future boundaries', async () => {
  for (const timestamp of [now / 1000 - 900, now / 1000 + 60]) {
    const state = recoveryFixture({
      getClaims: async () => ({
        data: { claims: { sub: user.id, amr: [{ method: 'recovery', timestamp }] } },
        error: null,
      }),
    });
    assert.equal(
      (await destination(await handleAuthCallback(callback({ next: recoveryNext }), state.deps)))
        .pathname,
      recoveryNext,
    );
  }
});

test('recovery claims are matched against getUser identity rather than the exchange payload', async () => {
  const verifiedUser = { ...user, id: 'different-verified-user' };
  const state = recoveryFixture({
    getUser: async () => ({ data: { user: verifiedUser }, error: null }),
  });
  expectFailure(
    await destination(await handleAuthCallback(callback({ next: recoveryNext }), state.deps)),
    recoveryNext,
  );
});

test('claims verification errors and exceptions cannot open password recovery', async () => {
  for (const getClaims of [
    async () => ({ data: { claims: recoveryClaims }, error: { message: 'PRIVATE_SIGNATURE' } }),
    async () => ({ data: null, error: null }),
    async () => {
      throw new Error('PRIVATE_SIGNATURE');
    },
  ]) {
    const state = recoveryFixture({ getClaims });
    expectFailure(
      await destination(await handleAuthCallback(callback({ next: recoveryNext }), state.deps)),
      recoveryNext,
    );
  }
});

test('external, encoded and unsupported destinations use the fixed customer destination', async () => {
  for (const next of [
    'https://attacker.example',
    '//attacker.example',
    '/\\attacker.example',
    '%2Fadmin%2Fdashboard',
    '/admin/unknown',
    '/auth/reset-password?next=https://attacker.example',
    '/admin/dashboard#fragment',
  ]) {
    const state = fixture();
    const url = await destination(await handleAuthCallback(callback({ next }), state.deps));
    assert.equal(url.pathname, '/account/profile');
    assert.equal(url.search, '');
  }
});

test('callbacks reject invalid trusted origins before creating an auth client', async () => {
  const state = fixture();
  const response = await handleAuthCallback(callback(), {
    ...state.deps,
    origin: () => {
      throw new Error('PRIVATE_ORIGIN_CONFIGURATION');
    },
  });
  assert.equal(response.status, 400);
  privateResponse(response);
  assert.deepEqual(await response.json(), { error: 'Invalid application origin.' });
  assert.equal(response.headers.get('location'), null);
  assert.equal(state.creations(), 0);
});

test('callbacks use the trusted canonical origin instead of request or forwarded host headers', async () => {
  const state = fixture();
  const request = new Request(
    'https://attacker.example/auth/callback?code=PRIVATE&next=%2Fadmin%2Fdashboard',
    {
      headers: { host: 'attacker.example', 'x-forwarded-host': 'attacker.example' },
    },
  );
  const url = await destination(await handleAuthCallback(request, state.deps));
  assert.equal(url.pathname, '/admin/dashboard');
});

test('failure diagnostics distinguish missing browser proof from rejected codes without provider data', async () => {
  for (const [name, expected] of [
    ['AuthPKCECodeVerifierMissingError', 'missing_verifier'],
    ['AuthApiError', 'exchange_rejected'],
    ['PRIVATE_PROVIDER_ERROR', 'exchange_rejected'],
  ]) {
    const reasons: string[] = [];
    const state = fixture({
      exchangeCodeForSession: async () => ({
        data: { user: null, session: null },
        error: { name, message: 'PRIVATE_TOKEN_AND_VERIFIER', code: 'PRIVATE_CODE' },
      }),
    });
    expectFailure(
      await destination(
        await handleAuthCallback(callback({ next: recoveryNext, sb_flow_id: 'PRIVATE_FLOW_ID' }), {
          ...state.deps,
          onFailure: (reason) => reasons.push(reason),
        }),
      ),
      recoveryNext,
    );
    assert.deepEqual(reasons, [expected]);
    assert.equal(JSON.stringify(reasons).includes('PRIVATE'), false);
  }
});

test('provider and missing-code failures are diagnosed before creating a client', async () => {
  for (const [parameters, expected] of [
    [{ error: 'PRIVATE_PROVIDER_ERROR' }, 'provider_error'],
    [{ code: '' }, 'missing_code'],
  ] as const) {
    const state = fixture();
    const reasons: string[] = [];
    await destination(
      await handleAuthCallback(callback({ next: recoveryNext, ...parameters }), {
        ...state.deps,
        onFailure: (reason) => reasons.push(reason),
      }),
    );
    assert.deepEqual(reasons, [expected]);
    assert.equal(state.creations(), 0);
  }
});

test('diagnostic failures cannot alter authentication results or expose their exception', async () => {
  const state = fixture();
  expectFailure(
    await destination(
      await handleAuthCallback(callback({ next: recoveryNext, error: 'otp_expired' }), {
        ...state.deps,
        onFailure: () => {
          throw new Error('PRIVATE_LOGGING_CONFIGURATION');
        },
      }),
    ),
    recoveryNext,
  );
  assert.equal(state.creations(), 0);
});
