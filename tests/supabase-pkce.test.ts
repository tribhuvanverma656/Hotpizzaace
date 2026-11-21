import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import test from 'node:test';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { SupabaseClientOptions } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { supabaseAuthOptions } from '../lib/supabase/config';
import { hasRecentRecoveryClaims } from '../lib/auth/password';
import { handleAuthCallback } from '../lib/auth/callback';
import { updateSupabaseSession } from '../lib/supabase/proxy';
import { serverAuthCookieOptions } from '../lib/supabase/server-cookie-options';

const callback = 'https://app.example.invalid/auth/callback?next=/auth/reset-password';
const storageKey = 'sb-offline-pkce-auth-token';
type AuthOptions = NonNullable<SupabaseClientOptions<'public'>['auth']>;
type Start = { redirect: URL; challenge: string; method: string };
type CookieWrite = { name: string; value: string; options: CookieOptions };

/** Real SDK and SSR storage; every HTTP request terminates in this offline fixture. */
function fixture(
  auth: AuthOptions = supabaseAuthOptions,
  acceptExchange = false,
  applicationOrigin = 'https://app.example.invalid',
) {
  const jar = new Map<string, string>();
  const starts: Start[] = [];
  const tokenChallenges: string[] = [];
  const writes: CookieWrite[][] = [];
  const requests: string[] = [];
  const now = Math.floor(Date.now() / 1000);
  const owner = {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'owner@example.invalid',
    email_confirmed_at: new Date().toISOString(),
    app_metadata: { provider: 'google', providers: ['google'] },
    user_metadata: {},
    aud: 'authenticated',
    created_at: new Date().toISOString(),
  };
  function offlineToken(method: 'oauth' | 'recovery') {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: owner.id,
        aud: 'authenticated',
        exp: now + 3600,
        iat: now,
        amr: [{ method, timestamp: now }],
      }),
    ).toString('base64url');
    const signed = `${header}.${payload}`;
    const signature = createHmac('sha256', 'offline-fixture-only')
      .update(signed)
      .digest('base64url');
    return `${signed}.${signature}`;
  }
  const googleToken = offlineToken('oauth');
  const recoveryToken = offlineToken('recovery');

  function client(requestCookies = new Map(jar)) {
    return createServerClient('https://offline-pkce.supabase.co', 'sb_publishable_offline_test', {
      auth,
      cookieOptions: serverAuthCookieOptions(applicationOrigin),
      cookies: {
        getAll: () => Array.from(requestCookies, ([name, value]) => ({ name, value })),
        setAll(values) {
          writes.push(values);
          // Model Next's request cookie store and the browser merging Set-Cookie by name.
          for (const cookie of values) {
            for (const store of [requestCookies, jar]) {
              if (cookie.options.maxAge === 0) store.delete(cookie.name);
              else store.set(cookie.name, cookie.value);
            }
          }
        },
      },
      global: {
        fetch: async (input, init) => {
          const url = new URL(String(input));
          assert.equal(url.origin, 'https://offline-pkce.supabase.co');
          requests.push(url.pathname);
          const body = JSON.parse(String(init?.body ?? '{}'));
          if (url.pathname === '/auth/v1/recover' || url.pathname === '/auth/v1/signup') {
            starts.push({
              redirect: new URL(url.searchParams.get('redirect_to') ?? callback),
              challenge: body.code_challenge,
              method: body.code_challenge_method,
            });
            return Response.json(
              url.pathname === '/auth/v1/signup'
                ? { user: { id: 'offline-user', identities: [] }, session: null }
                : {},
            );
          }
          if (url.pathname === '/auth/v1/token') {
            assert.equal(url.searchParams.get('grant_type'), 'pkce');
            assert.equal(typeof body.code_verifier, 'string');
            tokenChallenges.push(
              createHash('sha256').update(body.code_verifier).digest('base64url'),
            );
            if (acceptExchange)
              return Response.json({
                access_token: recoveryToken,
                refresh_token: 'offline-recovery-refresh-only',
                expires_in: 3600,
                token_type: 'bearer',
                user: owner,
              });
            // Check the submitted verifier without minting or accepting any session.
            return Response.json(
              { code: 'bad_code_verifier', msg: 'Offline fixture declines token exchange.' },
              { status: 400, headers: { 'X-Supabase-Api-Version': '2024-01-01' } },
            );
          }
          if (url.pathname === '/auth/v1/user') {
            const authorization = new Headers(init?.headers).get('authorization');
            // The fixture Auth server accepts only tokens it signed locally above.
            assert.equal(
              authorization === `Bearer ${googleToken}` ||
                authorization === `Bearer ${recoveryToken}`,
              true,
            );
            return Response.json(owner);
          }
          throw new Error('Unexpected HTTP call in offline PKCE fixture.');
        },
      },
    });
  }

  async function recover(request = client()) {
    const result = await request.auth.resetPasswordForEmail('owner@example.invalid', {
      redirectTo: callback,
    });
    assert.equal(result.error, null);
    return starts.at(-1)!;
  }

  async function signInGoogle() {
    const result = await client().auth.setSession({
      access_token: googleToken,
      refresh_token: 'offline-google-refresh-only',
    });
    assert.equal(result.error, null);
    assert.equal(result.data.user?.id, owner.id);
    assert.equal(jar.has(storageKey), true);
  }

  return { jar, starts, tokenChallenges, writes, requests, client, recover, signInGoogle, owner };
}

function flowId(start: Start) {
  const id = start.redirect.searchParams.get('sb_flow_id');
  assert.equal(typeof id === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(id), true);
  return id!;
}

function slot(id: string) {
  return `${storageKey}-flow-${id}-code-verifier`;
}

function corruptExistingSession(jar: Map<string, string>) {
  jar.set(
    storageKey,
    'base64-' + Buffer.from(JSON.stringify({ invalid_session: true })).toString('base64url'),
  );
}

test('default SDK recovery redirects reproduce the legacy verifier overwrite', async () => {
  const f = fixture({});
  const first = await f.recover();
  const second = await f.recover();
  assert.equal(first.redirect.searchParams.has('sb_flow_id'), false);
  assert.equal(second.redirect.searchParams.has('sb_flow_id'), false);
  assert.equal(first.challenge !== second.challenge, true);
  assert.equal(first.method, 's256');
  const result = await f.client().auth.exchangeCodeForSession('offline-first-code');
  assert.equal(result.error?.code, 'bad_code_verifier');
  assert.equal(f.tokenChallenges.length, 1);
  assert.equal(f.tokenChallenges[0] === first.challenge, false);
  assert.equal(f.tokenChallenges[0] === second.challenge, true);
});

test('recovery callback selects its own verifier after a later recovery starts', async () => {
  const f = fixture();
  const first = await f.recover();
  const firstId = flowId(first);
  const firstCookie = f.jar.get(slot(firstId));
  assert.equal(typeof firstCookie, 'string');
  const second = await f.recover();
  const secondId = flowId(second);
  assert.equal(firstId !== secondId, true);
  assert.equal(f.jar.get(slot(firstId)) === firstCookie, true);
  assert.equal(first.redirect.searchParams.get('next'), '/auth/reset-password');
  assert.equal(f.jar.has(slot(secondId)), true);

  const result = await f.client().auth.exchangeCodeForSession('offline-first-code', {
    flowId: firstId,
  });
  assert.equal(result.error?.code, 'bad_code_verifier');
  assert.equal(f.tokenChallenges.length, 1);
  assert.equal(f.tokenChallenges[0] === first.challenge, true);
  assert.equal(f.tokenChallenges[0] === second.challenge, false);
  // Failed exchanges immediately clear only their own slot; the other email still works.
  assert.equal(f.jar.has(slot(firstId)), false);
  assert.equal(f.jar.has(slot(secondId)), true);
  assert.equal(f.jar.get(`${storageKey}-code-verifier`) === f.jar.get(slot(secondId)), true);
});

test('separate requests with the same initial cookies retain independently addressable slots', async () => {
  const f = fixture();
  const initial = new Map(f.jar);
  // Both requests start with the same browser snapshot, as overlapping tabs would.
  const requestA = f.client(new Map(initial));
  const requestB = f.client(new Map(initial));
  const first = await f.recover(requestA);
  const firstId = flowId(first);
  const second = await f.recover(requestB);
  const secondId = flowId(second);
  assert.equal(f.jar.has(slot(firstId)), true);
  assert.equal(f.jar.has(slot(secondId)), true);
  await f.client().auth.exchangeCodeForSession('offline-first-code', { flowId: firstId });
  assert.equal(f.tokenChallenges[0] === first.challenge, true);
  assert.equal(f.tokenChallenges[0] === second.challenge, false);
  assert.equal(f.jar.has(slot(secondId)), true);
});

test('an explicit missing or malformed flow cannot borrow the legacy verifier', async () => {
  for (const invalidId of ['missing_slot_1234', '../malformed']) {
    const f = fixture();
    await f.recover();
    assert.equal(f.jar.has(`${storageKey}-code-verifier`), true);
    const result = await f.client().auth.exchangeCodeForSession('offline-code', {
      flowId: invalidId,
    });
    assert.equal(result.error?.name, 'AuthPKCECodeVerifierMissingError');
    assert.equal(f.tokenChallenges.length, 0);
    assert.equal(f.requests.includes('/auth/v1/token'), false);
  }
});

test('session polling does not write or replace pending recovery verifiers', async () => {
  const f = fixture();
  const first = await f.recover();
  const before = new Map(f.jar);
  const writeCount = f.writes.length;
  const requestCount = f.requests.length;
  const result = await f.client().auth.getClaims();
  assert.equal(result.data, null);
  assert.equal(f.writes.length, writeCount);
  assert.equal(f.requests.length, requestCount);
  assert.equal(
    before.size === f.jar.size && [...before].every(([name, value]) => f.jar.get(name) === value),
    true,
  );
  await f.client().auth.exchangeCodeForSession('offline-code', { flowId: flowId(first) });
  assert.equal(f.tokenChallenges[0] === first.challenge, true);
});

test('the SDK clears pending PKCE slots when asked to load an invalid existing session', async () => {
  const f = fixture();
  const first = await f.recover();
  const id = flowId(first);
  assert.equal(f.jar.has(slot(id)), true);
  corruptExistingSession(f.jar);
  const claims = await f.client().auth.getClaims();
  assert.equal(claims.data, null);
  assert.equal(f.jar.has(slot(id)), false);
  const exchanged = await f.client().auth.exchangeCodeForSession('offline-code', { flowId: id });
  assert.equal(exchanged.error?.name, 'AuthPKCECodeVerifierMissingError');
  assert.equal(f.tokenChallenges.length, 0);
  assert.deepEqual(f.requests, ['/auth/v1/recover']);
});

test('only the exact callback avoids invalid old-session cleanup before its verified exchange', async (context) => {
  const environment = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    APP_BASE_URL: process.env.APP_BASE_URL,
  };
  context.after(() => {
    for (const [name, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://offline-pkce.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_offline_test';
  process.env.APP_BASE_URL = 'https://app.example.invalid';
  // Neither proxy branch should make an HTTP call with the malformed session fixture.
  let proxyNetworkCalls = 0;
  context.mock.method(globalThis, 'fetch', async () => {
    proxyNetworkCalls += 1;
    throw new Error('Unexpected proxy network call in offline PKCE fixture.');
  });

  for (const pathname of [
    '/auth/callback',
    '/auth/callback-extra',
    '/auth/reset-password',
    '/api/auth/session',
  ]) {
    await context.test(pathname, async () => {
      const f = fixture(supabaseAuthOptions, true);
      const first = await f.recover();
      const id = flowId(first);
      corruptExistingSession(f.jar);
      const target = new URL(first.redirect);
      target.pathname = pathname;
      target.searchParams.set('code', 'offline-recovery-code');
      const request = new NextRequest(target, {
        headers: { cookie: [...f.jar].map(([name, value]) => `${name}=${value}`).join('; ') },
      });
      const response = await updateSupabaseSession(request);
      for (const cookie of response.cookies.getAll()) {
        // Proxy cleanup must retain the same protections as route-handler writes.
        assert.equal(cookie.httpOnly, true);
        assert.equal(cookie.secure, true);
        assert.equal(cookie.sameSite, 'lax');
        assert.equal(cookie.path, '/');
        if (cookie.maxAge === 0) f.jar.delete(cookie.name);
        else f.jar.set(cookie.name, cookie.value);
      }
      assert.match(response.headers.get('cache-control') ?? '', /no-store/);
      assert.equal(proxyNetworkCalls, 0);
      const exactCallback = pathname === '/auth/callback';
      assert.equal(f.jar.has(slot(id)), exactCallback);
      assert.equal(response.cookies.getAll().length === 0, exactCallback);

      if (exactCallback) {
        // Exercise the real application callback and SDK, not an assumed authenticated shortcut.
        const result = await handleAuthCallback(request, {
          createClient: async () => f.client(),
          origin: () => 'https://app.example.invalid',
        });
        assert.equal(result.status, 303);
        assert.equal(new URL(result.headers.get('location')!).pathname, '/auth/reset-password');
        assert.equal(f.tokenChallenges.length, 1);
        assert.equal(f.tokenChallenges[0] === first.challenge, true);
        assert.equal(f.requests.filter((path) => path === '/auth/v1/user').length, 2);
        assert.equal(f.jar.has(slot(id)), false);
        assert.equal(f.jar.has(storageKey), true);
      } else {
        const exchanged = await f.client().auth.exchangeCodeForSession('offline-code', {
          flowId: id,
        });
        assert.equal(exchanged.error?.name, 'AuthPKCECodeVerifierMissingError');
        assert.equal(f.tokenChallenges.length, 0);
      }
    });
  }
});

test('a single recovery from a Google session persists a verified recovery session', async (context) => {
  for (const [label, auth] of [
    ['legacy single flow', {}],
    ['isolated single flow', supabaseAuthOptions],
  ] as const) {
    await context.test(label, async () => {
      const f = fixture(auth, true);
      await f.signInGoogle();
      const originalClaims = await f.client().auth.getClaims();
      assert.equal(originalClaims.error, null);
      assert.equal(hasRecentRecoveryClaims(originalClaims.data?.claims, f.owner.id), false);
      const first = await f.recover();
      const pending = new Map(f.jar);
      const writesBeforePolling = f.writes.length;
      const polled = await f.client().auth.getClaims();
      assert.equal(polled.error, null);
      assert.equal(f.writes.length, writesBeforePolling);
      assert.equal(
        [...pending].every(([name, value]) => f.jar.get(name) === value),
        true,
      );

      const callbackClient = f.client();
      const id = first.redirect.searchParams.get('sb_flow_id');
      const exchanged = await callbackClient.auth.exchangeCodeForSession(
        'offline-recovery-code',
        id ? { flowId: id } : undefined,
      );
      assert.equal(exchanged.error, null);
      assert.equal(f.tokenChallenges[0] === first.challenge, true);
      assert.equal(
        'redirectType' in exchanged.data && exchanged.data.redirectType === 'recovery',
        true,
      );
      if (id) assert.equal(f.jar.has(slot(id)), false);
      assert.equal(f.jar.has(`${storageKey}-code-verifier`), false);
      assert.equal(f.jar.has(storageKey), true);
      // A new SSR request reads the changed cookies, verifies through Auth, and sees recovery AMR.
      const fresh = f.client();
      const verified = await fresh.auth.getUser();
      assert.equal(verified.error, null);
      assert.equal(verified.data.user?.id, f.owner.id);
      const claims = await fresh.auth.getClaims();
      assert.equal(claims.error, null);
      assert.equal(hasRecentRecoveryClaims(claims.data?.claims, f.owner.id), true);
    });
  }
});

test('sign-up confirmations and Google OAuth also round-trip isolated PKCE ids', async () => {
  const f = fixture();
  const signup = await f.client().auth.signUp({
    email: 'owner@example.invalid',
    password: 'Offline fixture password only 123!',
    options: { emailRedirectTo: callback },
  });
  assert.equal(signup.error, null);
  const signupId = flowId(f.starts[0]);
  const oauth = await f.client().auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: callback, skipBrowserRedirect: true },
  });
  assert.equal(oauth.error, null);
  assert.equal(typeof oauth.data.url, 'string');
  const authorize = new URL(oauth.data.url!);
  const redirect = new URL(authorize.searchParams.get('redirect_to')!);
  const oauthId = flowId({ redirect, challenge: '', method: '' });
  assert.equal(signupId !== oauthId, true);
  assert.equal(f.jar.has(slot(signupId)), true);
  assert.equal(f.jar.has(slot(oauthId)), true);
  assert.equal(redirect.searchParams.get('next'), '/auth/reset-password');
  // OAuth builds an authorization URL locally; no provider or network was visited.
  assert.deepEqual(f.requests, ['/auth/v1/signup']);
});

test('server-only HttpOnly cookies preserve Google PKCE exchange and verified subsequent requests', async (context) => {
  for (const applicationOrigin of ['https://app.example.invalid', 'http://localhost:3001']) {
    await context.test(applicationOrigin, async () => {
      const f = fixture(supabaseAuthOptions, true, applicationOrigin);
      const started = await f.client().auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${applicationOrigin}/auth/callback?next=/account/profile`,
          skipBrowserRedirect: true,
        },
      });
      assert.equal(started.error, null);
      const authorize = new URL(started.data.url!);
      const target = new URL(authorize.searchParams.get('redirect_to')!);
      assert.equal(typeof target.searchParams.get('sb_flow_id'), 'string');
      target.searchParams.set('code', 'offline-google-code');

      // The browser returns its HttpOnly cookies; no document.cookie/browser SDK is needed.
      const response = await handleAuthCallback(new Request(target), {
        createClient: async () => f.client(),
        origin: () => applicationOrigin,
      });
      assert.equal(response.status, 303);
      assert.equal(response.headers.get('location'), `${applicationOrigin}/account/profile`);
      assert.deepEqual(f.tokenChallenges, [authorize.searchParams.get('code_challenge')]);
      const verified = await f.client().auth.getUser();
      assert.equal(verified.error, null);
      assert.equal(verified.data.user?.id, f.owner.id);
      const written = f.writes.flat();
      assert.ok(written.some(({ name, options }) => name === storageKey && options.maxAge !== 0));
      assert.ok(
        written.some(({ name, options }) => name.includes('code-verifier') && options.maxAge === 0),
      );
      for (const { options } of written) {
        assert.equal(options.httpOnly, true);
        assert.equal(options.sameSite, 'lax');
        assert.equal(options.secure, applicationOrigin.startsWith('https://'));
        assert.equal(options.path, '/');
      }
    });
  }
});
