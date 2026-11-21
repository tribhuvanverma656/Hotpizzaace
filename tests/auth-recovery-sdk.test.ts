import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { createServerClient } from '@supabase/ssr';
import { handleRecoveryConfirmation } from '../lib/auth/recovery';
import { handlePasswordUpdate } from '../lib/auth/password';
import { supabaseAuthOptions } from '../lib/supabase/config';

const origin = 'https://offline-app.example.invalid';
const project = 'https://offline-email-proof.supabase.co';
const password = 'An offline fixture password 123!';
const tokenHash = 'pkce_' + 'b'.repeat(56);

/** Real Auth SDK and SSR cookie storage. HTTP cannot escape the injected fetch below. */
function sdkFixture() {
  const now = Date.now();
  const seconds = Math.floor(now / 1000);
  const owner = {
    id: '00000000-0000-4000-8000-000000000002',
    email: 'offline-owner@example.invalid',
    email_confirmed_at: new Date(now).toISOString(),
    aud: 'authenticated',
    created_at: new Date(now).toISOString(),
    app_metadata: { provider: 'google', providers: ['google', 'email'] },
    user_metadata: {},
  };
  // HS256 makes getClaims verify through Auth's /user endpoint, also mocked and checked.
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: owner.id,
      aud: 'authenticated',
      exp: seconds + 3600,
      iat: seconds,
      session_id: '00000000-0000-4000-8000-000000000003',
      amr: [{ method: 'otp', timestamp: seconds }],
    }),
  ).toString('base64url');
  const unsigned = `${header}.${payload}`;
  const signature = createHmac('sha256', 'offline-fixture-signing-key-only')
    .update(unsigned)
    .digest('base64url');
  const accessToken = `${unsigned}.${signature}`;
  const refreshToken = 'offline-refresh-token-only';
  const jar = new Map<string, string>();
  const calls: string[] = [];
  let wroteSessionCookie = false;
  let verified = false;

  function client() {
    const requestCookies = new Map(jar);
    return createServerClient(project, 'sb_publishable_offline_fixture', {
      auth: supabaseAuthOptions,
      cookieOptions: { secure: true },
      cookies: {
        getAll: () => [...requestCookies].map(([name, value]) => ({ name, value })),
        setAll(values) {
          for (const { name, value, options } of values) {
            if (name === 'sb-offline-email-proof-auth-token' && options.maxAge !== 0)
              wroteSessionCookie = true;
            for (const store of [requestCookies, jar]) {
              if (options.maxAge === 0) store.delete(name);
              else store.set(name, value);
            }
          }
        },
      },
      global: {
        fetch: async (input, init) => {
          const url = new URL(String(input));
          assert.equal(url.origin, project);
          const method = init?.method ?? 'GET';
          const operation = `${method} ${url.pathname}`;
          calls.push(operation);
          const body = JSON.parse(String(init?.body ?? '{}'));
          if (operation === 'POST /auth/v1/verify') {
            assert.equal(body.type, 'recovery');
            assert.equal(body.token_hash === tokenHash, true);
            assert.equal('code_verifier' in body, false);
            assert.equal('password' in body, false);
            if (verified)
              return Response.json(
                { code: 'otp_expired', msg: 'PRIVATE_PROVIDER_TEXT' },
                { status: 403, headers: { 'X-Supabase-Api-Version': '2024-01-01' } },
              );
            verified = true;
            return Response.json({
              access_token: accessToken,
              refresh_token: refreshToken,
              expires_in: 3600,
              token_type: 'bearer',
              user: owner,
            });
          }
          // The mock Auth server independently recognizes only its locally signed token.
          assert.equal(
            new Headers(init?.headers).get('authorization') === `Bearer ${accessToken}`,
            true,
          );
          if (operation === 'GET /auth/v1/user') return Response.json(owner);
          if (operation === 'PUT /auth/v1/user') {
            assert.equal(body.password === password, true);
            assert.equal(body.code_challenge, null);
            assert.equal(body.code_challenge_method, null);
            return Response.json(owner);
          }
          if (operation === 'POST /auth/v1/logout') {
            assert.equal(url.searchParams.get('scope'), 'global');
            return new Response(null, { status: 204 });
          }
          throw new Error('Unexpected HTTP operation in offline recovery SDK fixture.');
        },
      },
    });
  }

  return {
    jar,
    calls,
    client,
    accessToken,
    refreshToken,
    wroteSessionCookie: () => wroteSessionCookie,
    dependencies: { createClient: async () => client(), origin: () => origin, now: () => now },
  };
}

function request(path = '/api/auth/recovery') {
  return new Request(`${origin}${path}`, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Sec-Fetch-Site': 'same-origin',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      ...(path === '/api/auth/recovery' ? { token_hash: tokenHash, type: 'recovery' } : {}),
      password,
      confirmPassword: password,
    }),
  });
}

test('installed SDK verifies and changes the password without prior cookies or a PKCE exchange', async () => {
  const f = sdkFixture();
  assert.equal(f.jar.size, 0);
  const response = await handleRecoveryConfirmation(request(), f.dependencies);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  const body = await response.text();
  assert.deepEqual(JSON.parse(body), {
    ok: true,
    signInPath: '/admin/login?auth_notice=password_updated',
  });
  for (const privateValue of [tokenHash, password, f.accessToken, f.refreshToken])
    assert.equal(body.includes(privateValue), false);
  assert.deepEqual(f.calls, [
    'POST /auth/v1/verify',
    'GET /auth/v1/user',
    'GET /auth/v1/user',
    'PUT /auth/v1/user',
    'POST /auth/v1/logout',
  ]);
  assert.equal(f.wroteSessionCookie(), true);
  assert.equal(f.jar.size, 0);

  // Replaying the same email link contacts only verification and cannot save another password.
  const replay = await handleRecoveryConfirmation(request(), f.dependencies);
  assert.equal(replay.status, 410);
  assert.deepEqual(await replay.json(), { ok: false, error: 'recovery_expired' });
  assert.equal(f.calls.at(-1), 'POST /auth/v1/verify');
  assert.equal(f.calls.filter((call) => call === 'PUT /auth/v1/user').length, 1);
});

test('an existing SDK OTP session cannot use the separate recovery-only password update route', async () => {
  const f = sdkFixture();
  const seeded = await f.client().auth.setSession({
    access_token: f.accessToken,
    refresh_token: f.refreshToken,
  });
  assert.equal(seeded.error, null);
  assert.equal(f.jar.size > 0, true);
  f.calls.length = 0;
  const response = await handlePasswordUpdate(request('/api/auth/password/update'), f.dependencies);
  assert.equal(response.status, 303);
  const location = new URL(response.headers.get('location')!);
  assert.equal(location.pathname, '/auth/reset-password');
  assert.equal(location.searchParams.get('auth_error'), 'recovery_expired');
  assert.deepEqual(f.calls, ['GET /auth/v1/user', 'GET /auth/v1/user']);
});
