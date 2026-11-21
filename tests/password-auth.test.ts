import assert from 'node:assert/strict';
import test from 'node:test';
import {
  handlePasswordForm,
  handlePasswordUpdate,
  hasRecentRecoveryClaims,
  resetPasswordErrorMessage,
  validNewPassword,
  verifiedRecoveryUser,
  type PasswordClient,
} from '../lib/auth/password';

const origin = 'http://localhost:3001';
const now = Date.parse('2026-10-20T10:00:00Z');
const user = { id: 'verified-owner-id', email_confirmed_at: '2026-10-19T12:00:00Z' };
const password = 'a distinct test phrase';
type MockMethod = (...args: unknown[]) => Promise<unknown>;
function fixture(overrides: Record<string, MockMethod> = {}) {
  const calls: { method: string; args: unknown[] }[] = [];
  let clientCreations = 0;
  const methods: Record<string, MockMethod> = {
    signInWithPassword: async () => ({ data: { user, session: {} }, error: null }),
    getUser: async () => ({ data: { user }, error: null }),
    getClaims: async () => ({
      data: { claims: { sub: user.id, amr: [{ method: 'recovery', timestamp: now / 1000 }] } },
      error: null,
    }),
    signUp: async () => ({ data: { user, session: null }, error: null }),
    resetPasswordForEmail: async () => ({ data: {}, error: null }),
    updateUser: async () => ({ data: { user }, error: null }),
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
  } as unknown as PasswordClient;
  return {
    client,
    calls,
    deps: {
      createClient: async () => {
        clientCreations++;
        return client;
      },
      origin: () => origin,
      now: () => now,
      recoveryEnabled: true,
      adminLoginId: 'owner@example.com',
    },
    creations: () => clientCreations,
  };
}
function form(values: Record<string, string> = {}, headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/auth/password`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams({
      action: 'signin',
      email: 'Owner@example.com',
      password,
      next: '/admin/dashboard',
      ...values,
    }),
  });
}
function destination(response: Response) {
  assert.equal(response.status, 303);
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  const url = new URL(response.headers.get('location')!);
  assert.equal(url.origin, origin);
  assert.equal(url.toString().includes(password), false);
  return url;
}

test('password mutations reject foreign, missing and cross-site origins before auth calls', async () => {
  for (const handler of [handlePasswordForm, handlePasswordUpdate]) {
    for (const headers of [
      { Origin: '' },
      { Origin: 'null' },
      { Origin: 'https://invalid.example' },
      { 'Sec-Fetch-Site': 'cross-site' },
    ] as Record<string, string>[]) {
      const state = fixture();
      const response = await handler(form({}, headers), state.deps);
      assert.equal(response.status, 403);
      assert.equal(state.creations(), 0);
      assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    }
    const state = fixture();
    assert.equal(
      (await handler(new Request(`${origin}/api/auth/password`), state.deps)).status,
      405,
    );
    assert.equal(state.creations(), 0);
  }
});
test('invalid, duplicate, malformed and oversized auth forms never call Supabase', async () => {
  const cases = [
    form({ email: 'invalid' }),
    form({ action: 'grant_admin' }),
    form({ password: '' }),
    form({ password: 'x'.repeat(129) }),
    new Request(`${origin}/api/auth/password`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: '{}',
    }),
    new Request(`${origin}/api/auth/password`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'action=signin&action=signup&email=owner%40example.com&password=secret',
    }),
    new Request(`${origin}/api/auth/password`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'email=' + 'a'.repeat(9000),
    }),
  ];
  for (const request of cases) {
    const state = fixture();
    const url = destination(await handlePasswordForm(request, state.deps));
    assert.equal(url.searchParams.get('auth_error'), 'invalid_request');
    assert.equal(state.creations(), 0);
  }
});
test('password sign-in normalizes email, preserves the secret, and verifies identity before returning', async () => {
  const state = fixture();
  const url = destination(
    await handlePasswordForm(
      form({ email: ' OWNER@example.com ', password: ' old password ' }),
      state.deps,
    ),
  );
  assert.equal(url.pathname, '/admin/dashboard');
  assert.deepEqual(
    state.calls.map((call) => call.method),
    ['signInWithPassword', 'getUser'],
  );
  assert.deepEqual(state.calls[0].args, [
    { email: 'owner@example.com', password: ' old password ' },
  ]);
});

test('the deployed admin policy allows one fixed login ID and rejects signup/reset without auth calls', async () => {
  for (const action of ['signup', 'reset']) {
    const state = fixture();
    const url = destination(
      await handlePasswordForm(form({ action }), { ...state.deps, signInOnly: true }),
    );
    assert.equal(url.searchParams.get('auth_error'), 'email_flow_disabled');
    assert.equal(state.creations(), 0);
  }
  for (const email of ['owner@example.com', 'other@example.com']) {
    const state = fixture();
    const url = destination(
      await handlePasswordForm(form({ email }), {
        ...state.deps,
        adminLoginId: undefined,
        signInOnly: true,
      }),
    );
    assert.equal(url.searchParams.get('auth_error'), 'invalid_credentials');
    assert.equal(state.creations(), 0);
  }
  const state = fixture();
  const url = destination(
    await handlePasswordForm(form({ email: ' HOTPIZZAACE@gmail.com ' }), {
      ...state.deps,
      adminLoginId: undefined,
      signInOnly: true,
    }),
  );
  assert.equal(url.pathname, '/admin/dashboard');
  assert.deepEqual(state.calls[0].args, [{ email: 'hotpizzaace@gmail.com', password }]);
});
test('existing short passwords can sign in but cannot be chosen as new credentials', async () => {
  const state = fixture();
  assert.equal(
    destination(await handlePasswordForm(form({ password: 'old' }), state.deps)).pathname,
    '/admin/dashboard',
  );
  for (const value of ['', 'short', ' '.repeat(12), 'a'.repeat(129), null, {}])
    assert.equal(validNewPassword(value), false);
  assert.equal(validNewPassword('a'.repeat(12)), true);
  assert.equal(validNewPassword('a'.repeat(128)), true);
});
test('return destinations cannot redirect password sign-in to an external or recovery path', async () => {
  for (const next of [
    'https://invalid.example',
    '//invalid.example',
    '/auth/reset-password',
    '/admin/unknown',
    '%2Fadmin%2Forders',
  ]) {
    assert.equal(
      destination(await handlePasswordForm(form({ next }), fixture().deps)).pathname,
      '/admin/dashboard',
    );
  }
  assert.equal(
    destination(await handlePasswordForm(form({ next: '/admin/orders' }), fixture().deps)).pathname,
    '/admin/orders',
  );
});
test('invalid login and unconfirmed email responses expose finite feedback only', async () => {
  for (const [code, expected] of [
    ['invalid_credentials', 'invalid_credentials'],
    ['email_not_confirmed', 'password_confirmation_required'],
    ['PRIVATE_PROVIDER_ERROR', 'invalid_credentials'],
  ]) {
    const state = fixture({
      signInWithPassword: async () => ({
        data: { user: null },
        error: { code, message: 'PRIVATE_PASSWORD_OR_TOKEN' },
      }),
    });
    const url = destination(await handlePasswordForm(form(), state.deps));
    assert.equal(url.searchParams.get('auth_error'), expected);
    assert.equal(url.toString().includes('PRIVATE'), false);
    assert.equal(state.calls.length, 1);
  }
});
test('sign-in cannot accept a missing, unverified or mismatched server identity', async () => {
  for (const result of [
    { data: { user: null }, error: null },
    { data: { user }, error: new Error('PRIVATE') },
    { data: { user: { ...user, id: 'other' } }, error: null },
    { data: { user: { ...user, email_confirmed_at: undefined } }, error: null },
  ]) {
    const state = fixture({ getUser: async () => result });
    assert.equal(
      destination(await handlePasswordForm(form(), state.deps)).pathname,
      '/admin/login',
    );
  }
});
test('signup requires a matching new password and does not pass user-selected privilege fields', async () => {
  for (const fields of [
    { password: 'short', confirmPassword: 'short' },
    { password, confirmPassword: 'different test phrase' },
  ]) {
    const state = fixture();
    const url = destination(
      await handlePasswordForm(form({ action: 'signup', ...fields }), state.deps),
    );
    assert.equal(url.searchParams.get('auth_error'), 'invalid_request');
    assert.equal(state.creations(), 0);
  }
  const state = fixture();
  const url = destination(
    await handlePasswordForm(
      form({ action: 'signup', confirmPassword: password, admin: 'true' }),
      state.deps,
    ),
  );
  assert.equal(url.searchParams.get('auth_notice'), 'signup_confirmation_sent');
  assert.equal(url.searchParams.get('auth_action'), 'signup');
  const call = state.calls[0];
  assert.equal(call.method, 'signUp');
  assert.deepEqual(call.args, [
    {
      email: 'owner@example.com',
      password,
      options: { emailRedirectTo: `${origin}/auth/callback?next=%2Fadmin%2Fdashboard` },
    },
  ]);
});
test('existing signup addresses have the same notice and auto-confirm sessions are not retained', async () => {
  for (const code of ['user_already_exists', 'email_exists']) {
    const state = fixture({
      signUp: async () => ({
        data: { user: null, session: null },
        error: { code, message: 'PRIVATE_ACCOUNT_EXISTS' },
      }),
    });
    assert.equal(
      destination(
        await handlePasswordForm(form({ action: 'signup', confirmPassword: password }), state.deps),
      ).searchParams.get('auth_notice'),
      'signup_confirmation_sent',
    );
  }
  const state = fixture({ signUp: async () => ({ data: { user, session: {} }, error: null }) });
  await handlePasswordForm(form({ action: 'signup', confirmPassword: password }), state.deps);
  assert.deepEqual(state.calls.at(-1), { method: 'signOut', args: [{ scope: 'local' }] });
});
test('an obfuscated duplicate signup returns only the same generic notice without establishing a session', async () => {
  const duplicate = fixture({
    signUp: async () => ({
      data: { user: { id: 'obfuscated-duplicate-id', identities: [] }, session: null },
      error: null,
    }),
  });
  const fresh = fixture();
  const duplicateResponse = await handlePasswordForm(
    form({ action: 'signup', confirmPassword: password }),
    duplicate.deps,
  );
  const freshResponse = await handlePasswordForm(
    form({ action: 'signup', confirmPassword: password }),
    fresh.deps,
  );
  const url = destination(duplicateResponse);
  assert.equal(duplicateResponse.headers.get('location'), freshResponse.headers.get('location'));
  assert.equal(url.searchParams.get('auth_notice'), 'signup_confirmation_sent');
  assert.equal(url.toString().includes('obfuscated'), false);
  assert.deepEqual(
    duplicate.calls.map((call) => call.method),
    ['signUp'],
  );
});
test('an unexpected signup session cannot report confirmation success when local sign-out fails', async () => {
  for (const signOut of [
    async () => ({ error: { code: 'unexpected_failure', message: 'PRIVATE_LOCAL_SIGNOUT_ERROR' } }),
    async () => {
      throw new Error('PRIVATE_LOCAL_SIGNOUT_EXCEPTION');
    },
  ] as MockMethod[]) {
    const state = fixture({
      signUp: async () => ({ data: { user, session: {} }, error: null }),
      signOut,
    });
    const url = destination(
      await handlePasswordForm(form({ action: 'signup', confirmPassword: password }), state.deps),
    );
    assert.equal(url.searchParams.get('auth_error'), 'auth_unavailable');
    assert.equal(url.searchParams.has('auth_notice'), false);
    assert.equal(url.toString().includes('PRIVATE'), false);
    assert.deepEqual(
      state.calls.map((call) => call.method),
      ['signUp', 'signOut'],
    );
    assert.deepEqual(state.calls[1].args, [{ scope: 'local' }]);
  }
});
test('password reset stays disabled by default and only the exact public flag enables delivery', async (context) => {
  const original = process.env.NEXT_PUBLIC_PASSWORD_RECOVERY_ENABLED;
  context.after(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_PASSWORD_RECOVERY_ENABLED;
    else process.env.NEXT_PUBLIC_PASSWORD_RECOVERY_ENABLED = original;
  });
  for (const value of [undefined, '', 'false', 'TRUE', '1', ' true ', 'true']) {
    if (value === undefined) delete process.env.NEXT_PUBLIC_PASSWORD_RECOVERY_ENABLED;
    else process.env.NEXT_PUBLIC_PASSWORD_RECOVERY_ENABLED = value;
    const state = fixture();
    const url = destination(
      await handlePasswordForm(form({ action: 'reset', password: '' }), {
        ...state.deps,
        recoveryEnabled: undefined,
      }),
    );
    assert.equal(url.searchParams.get('auth_action'), 'reset');
    if (value === 'true') {
      assert.equal(url.searchParams.get('auth_notice'), 'password_reset_sent');
      assert.equal(state.creations(), 1);
      assert.deepEqual(
        state.calls.map((call) => call.method),
        ['resetPasswordForEmail'],
      );
    } else {
      assert.equal(url.searchParams.get('auth_error'), 'recovery_not_ready');
      assert.equal(url.searchParams.has('auth_notice'), false);
      assert.equal(state.creations(), 0);
      assert.deepEqual(state.calls, []);
    }
  }
});
test('the injected recovery switch controls reset delivery without changing password sign-in', async () => {
  for (const recoveryEnabled of [false, true]) {
    const reset = fixture();
    const resetUrl = destination(
      await handlePasswordForm(form({ action: 'reset', password: '' }), {
        ...reset.deps,
        recoveryEnabled,
      }),
    );
    assert.equal(
      resetUrl.searchParams.get(recoveryEnabled ? 'auth_notice' : 'auth_error'),
      recoveryEnabled ? 'password_reset_sent' : 'recovery_not_ready',
    );
    assert.equal(reset.creations(), recoveryEnabled ? 1 : 0);
    assert.deepEqual(
      reset.calls.map((call) => call.method),
      recoveryEnabled ? ['resetPasswordForEmail'] : [],
    );
    const signin = fixture();
    const signinUrl = destination(
      await handlePasswordForm(form(), { ...signin.deps, recoveryEnabled }),
    );
    assert.equal(signinUrl.pathname, '/admin/dashboard');
    assert.deepEqual(
      signin.calls.map((call) => call.method),
      ['signInWithPassword', 'getUser'],
    );
  }
});
test('enabled password reset uses the canonical callback and does not enumerate registered addresses', async () => {
  for (const code of [null, 'user_not_found', 'email_not_found']) {
    const state = fixture({
      resetPasswordForEmail: async () => ({
        data: {},
        error: code ? { code, message: 'PRIVATE_EXISTENCE' } : null,
      }),
    });
    const url = destination(
      await handlePasswordForm(form({ action: 'reset', password: '' }), state.deps),
    );
    assert.equal(url.searchParams.get('auth_notice'), 'password_reset_sent');
    assert.equal(url.searchParams.get('auth_action'), 'reset');
    assert.deepEqual(state.calls, [
      {
        method: 'resetPasswordForEmail',
        args: [
          'owner@example.com',
          { redirectTo: `${origin}/auth/callback?next=%2Fauth%2Freset-password` },
        ],
      },
    ]);
  }
});
test('provider exceptions and reset delivery errors never reveal provider payloads', async () => {
  for (const overrides of [
    {
      resetPasswordForEmail: async () => ({
        data: {},
        error: { code: 'smtp_error', message: 'PRIVATE_MAIL_KEY' },
      }),
    },
    {
      resetPasswordForEmail: async () => {
        throw new Error('PRIVATE_AUTH_SECRET');
      },
    },
  ]) {
    const url = destination(
      await handlePasswordForm(form({ action: 'reset' }), fixture(overrides).deps),
    );
    assert.equal(url.searchParams.get('auth_error'), 'auth_unavailable');
    assert.equal(url.toString().includes('PRIVATE'), false);
  }
});
test('only a recent detailed signed recovery claim for the verified subject opens password update', () => {
  const valid = { sub: user.id, amr: [{ method: 'recovery', timestamp: now / 1000 }] };
  assert.equal(hasRecentRecoveryClaims(valid, user.id, now), true);
  for (const claims of [
    null,
    { ...valid, sub: 'another-user' },
    { ...valid, amr: ['recovery'] },
    { ...valid, amr: [{ method: 'oauth', timestamp: now / 1000 }] },
    { ...valid, amr: [{ method: 'recovery', timestamp: now / 1000 - 901 }] },
    { ...valid, amr: [{ method: 'recovery', timestamp: now / 1000 + 61 }] },
    { ...valid, amr: [{ method: 'recovery', timestamp: 'recent' }] },
  ])
    assert.equal(hasRecentRecoveryClaims(claims, user.id, now), false);
});
test('recovery checks reject invalid signatures, missing users and unverified email before mutation', async () => {
  for (const overrides of [
    { getUser: async () => ({ data: { user: null }, error: null }) },
    {
      getUser: async () => ({
        data: { user: { ...user, email_confirmed_at: undefined } },
        error: null,
      }),
    },
    { getClaims: async () => ({ data: null, error: new Error('invalid signature') }) },
    {
      getClaims: async () => {
        throw new Error('PRIVATE_AUTH');
      },
    },
  ] as Record<string, MockMethod>[]) {
    const state = fixture(overrides);
    assert.equal(await verifiedRecoveryUser(state.client, now), null);
  }
});
test('password update refuses normal sign-in sessions and never calls updateUser for them', async () => {
  const state = fixture({
    getClaims: async () => ({
      data: { claims: { sub: user.id, amr: [{ method: 'password', timestamp: now / 1000 }] } },
      error: null,
    }),
  });
  const url = destination(
    await handlePasswordUpdate(form({ confirmPassword: password }), state.deps),
  );
  assert.equal(url.pathname, '/auth/reset-password');
  assert.equal(url.searchParams.get('auth_error'), 'recovery_expired');
  assert.equal(
    state.calls.some((call) => call.method === 'updateUser'),
    false,
  );
});
test('the full update handler refuses expired, future, wrong-subject and missing recovery evidence without mutation', async () => {
  const cases = [
    {
      label: 'expired by one second',
      claims: { sub: user.id, amr: [{ method: 'recovery', timestamp: now / 1000 - 901 }] },
    },
    {
      label: 'future beyond clock tolerance',
      claims: { sub: user.id, amr: [{ method: 'recovery', timestamp: now / 1000 + 61 }] },
    },
    {
      label: 'different subject',
      claims: { sub: 'other-user', amr: [{ method: 'recovery', timestamp: now / 1000 }] },
    },
    { label: 'missing AMR', claims: { sub: user.id } },
    {
      label: 'OAuth-only session',
      claims: { sub: user.id, amr: [{ method: 'oauth', timestamp: now / 1000 }] },
    },
    {
      label: 'missing recovery timestamp',
      claims: { sub: user.id, amr: [{ method: 'recovery' }] },
    },
  ];
  for (const { label, claims } of cases) {
    const state = fixture({ getClaims: async () => ({ data: { claims }, error: null }) });
    const url = destination(
      await handlePasswordUpdate(form({ confirmPassword: password }), state.deps),
    );
    assert.equal(url.pathname, '/auth/reset-password', label);
    assert.equal(url.searchParams.get('auth_error'), 'recovery_expired', label);
    assert.deepEqual(
      state.calls.map((call) => call.method),
      ['getUser', 'getClaims'],
      label,
    );
  }
});
test('the full update handler fails closed on returned and thrown identity or claims errors', async () => {
  const cases: { label: string; overrides: Record<string, MockMethod>; methods: string[] }[] = [
    {
      label: 'getUser error',
      overrides: {
        getUser: async () => ({ data: { user: null }, error: { message: 'PRIVATE_USER_ERROR' } }),
      },
      methods: ['getUser'],
    },
    {
      label: 'getUser exception',
      overrides: {
        getUser: async () => {
          throw new Error('PRIVATE_USER_EXCEPTION');
        },
      },
      methods: ['getUser'],
    },
    {
      label: 'getClaims error',
      overrides: {
        getClaims: async () => ({ data: null, error: { message: 'PRIVATE_CLAIMS_ERROR' } }),
      },
      methods: ['getUser', 'getClaims'],
    },
    {
      label: 'getClaims exception',
      overrides: {
        getClaims: async () => {
          throw new Error('PRIVATE_CLAIMS_EXCEPTION');
        },
      },
      methods: ['getUser', 'getClaims'],
    },
  ];
  for (const { label, overrides, methods } of cases) {
    const state = fixture(overrides);
    const url = destination(
      await handlePasswordUpdate(form({ confirmPassword: password }), state.deps),
    );
    assert.equal(url.searchParams.get('auth_error'), 'recovery_expired', label);
    assert.equal(url.toString().includes('PRIVATE'), false, label);
    assert.deepEqual(
      state.calls.map((call) => call.method),
      methods,
      label,
    );
  }
});
test('the full update handler accepts the exact recovery age and future clock-tolerance boundaries', async () => {
  for (const offset of [-900, 60]) {
    const state = fixture({
      getClaims: async () => ({
        data: {
          claims: { sub: user.id, amr: [{ method: 'recovery', timestamp: now / 1000 + offset }] },
        },
        error: null,
      }),
    });
    const url = destination(
      await handlePasswordUpdate(form({ confirmPassword: password }), state.deps),
    );
    assert.equal(url.searchParams.get('auth_notice'), 'password_updated');
    assert.deepEqual(
      state.calls.map((call) => call.method),
      ['getUser', 'getClaims', 'updateUser', 'signOut'],
    );
  }
});
test('password update enforces strength and confirmation on the server before verifying sessions', async () => {
  for (const [fields, error] of [
    [{ password: 'short', confirmPassword: 'short' }, 'password_requirements'],
    [{ password, confirmPassword: 'different phrase' }, 'password_mismatch'],
  ] as const) {
    const state = fixture();
    const url = destination(await handlePasswordUpdate(form(fields), state.deps));
    assert.equal(url.searchParams.get('auth_error'), error);
    assert.equal(state.creations(), 0);
  }
});
test('successful recovery update revokes refresh sessions and redirects with no credentials', async () => {
  const state = fixture();
  const url = destination(
    await handlePasswordUpdate(form({ confirmPassword: password }), state.deps),
  );
  assert.equal(url.pathname, '/admin/login');
  assert.equal(url.searchParams.get('auth_notice'), 'password_updated');
  assert.deepEqual(
    state.calls.map((call) => call.method),
    ['getUser', 'getClaims', 'updateUser', 'signOut'],
  );
  assert.deepEqual(state.calls[2].args, [{ password }]);
  assert.deepEqual(state.calls[3].args, [{ scope: 'global' }]);
});
test('returned password-update errors stay redacted and do not attempt sign-out', async () => {
  const failed = fixture({
    updateUser: async () => ({ data: { user: null }, error: { message: 'PRIVATE_PASSWORD' } }),
  });
  assert.equal(
    destination(
      await handlePasswordUpdate(form({ confirmPassword: password }), failed.deps),
    ).searchParams.get('auth_error'),
    'password_update_failed',
  );
  assert.equal(
    failed.calls.some((call) => call.method === 'signOut'),
    false,
  );
});
test('thrown password-update errors return safe failure without sign-out or a success notice', async () => {
  const state = fixture({
    updateUser: async () => {
      throw new Error('PRIVATE_UPDATE_EXCEPTION');
    },
  });
  const url = destination(
    await handlePasswordUpdate(form({ confirmPassword: password }), state.deps),
  );
  assert.equal(url.searchParams.get('auth_error'), 'password_update_failed');
  assert.equal(url.searchParams.has('auth_notice'), false);
  assert.equal(url.toString().includes('PRIVATE'), false);
  assert.deepEqual(
    state.calls.map((call) => call.method),
    ['getUser', 'getClaims', 'updateUser'],
  );
});
test('client creation failures never continue sign-in, signup, reset or password mutation', async () => {
  let clientAttempts = 0;
  const state = fixture();
  const deps = {
    ...state.deps,
    createClient: async () => {
      clientAttempts++;
      throw new Error('PRIVATE_CLIENT_CONFIG');
    },
  };
  for (const action of ['signin', 'signup', 'reset']) {
    const url = destination(
      await handlePasswordForm(form({ action, confirmPassword: password }), deps),
    );
    assert.equal(url.searchParams.get('auth_error'), 'auth_unavailable');
    assert.equal(url.searchParams.has('auth_notice'), false);
    assert.equal(url.toString().includes('PRIVATE'), false);
  }
  const url = destination(await handlePasswordUpdate(form({ confirmPassword: password }), deps));
  assert.equal(url.searchParams.get('auth_error'), 'password_update_failed');
  assert.equal(url.toString().includes('PRIVATE'), false);
  assert.equal(clientAttempts, 4);
  assert.deepEqual(state.calls, []);
});
test('a committed password stays successful when global sign-out returns an error or throws', async () => {
  for (const signOut of [
    async () => ({ error: { message: 'PRIVATE_GLOBAL_SIGNOUT_ERROR' } }),
    async () => {
      throw new Error('PRIVATE_GLOBAL_SIGNOUT_EXCEPTION');
    },
  ] as MockMethod[]) {
    const state = fixture({ signOut });
    const url = destination(
      await handlePasswordUpdate(form({ confirmPassword: password }), state.deps),
    );
    assert.equal(url.pathname, '/admin/login');
    assert.equal(url.searchParams.get('auth_notice'), 'password_updated');
    assert.equal(url.searchParams.has('auth_error'), false);
    assert.equal(url.toString().includes('PRIVATE'), false);
    assert.deepEqual(
      state.calls.map((call) => call.method),
      ['getUser', 'getClaims', 'updateUser', 'signOut'],
    );
    assert.deepEqual(state.calls[3].args, [{ scope: 'global' }]);
  }
});
test('reset page feedback never reflects arbitrary query strings or inherited object properties', () => {
  for (const value of [null, {}, [], '__proto__', 'constructor', 'toString', 'PRIVATE_PASSWORD'])
    assert.equal(resetPasswordErrorMessage(value), '');
  assert.match(resetPasswordErrorMessage('password_mismatch'), /do not match/);
});
