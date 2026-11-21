#!/usr/bin/env node

import assert from 'node:assert/strict';

// Explicit opt-in only. This script never follows an OAuth redirect or completes Google consent.
const suppliedBase = process.env.AUTH_SMOKE_BASE_URL;
if (!suppliedBase) {
  console.error('Set AUTH_SMOKE_BASE_URL to a local preview or the Render development origin.');
  process.exit(2);
}

const base = new URL(suppliedBase);
const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
const renderDevelopment = base.hostname === 'hotpizzaace-development.onrender.com';
assert.ok(
  ((local && ['http:', 'https:'].includes(base.protocol)) ||
    (renderDevelopment && base.protocol === 'https:')) &&
    !base.username &&
    !base.password &&
    base.pathname === '/' &&
    !base.search &&
    !base.hash,
  'Use a loopback origin or the explicitly named Render development service.',
);

const origin = base.origin;
let checks = 0;

async function request(path, init = {}) {
  return fetch(new URL(path, origin), {
    ...init,
    redirect: 'manual',
    credentials: 'omit',
    signal: AbortSignal.timeout(20000),
  });
}

function noStore(response) {
  assert.match(response.headers.get('cache-control') ?? '', /private/);
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
}

function localFailure(response, error, next = '/account/profile', login = '/account/login') {
  assert.equal(response.status, 303);
  noStore(response);
  const location = new URL(response.headers.get('location'));
  assert.equal(location.origin, origin);
  assert.equal(location.pathname, login);
  assert.equal(location.searchParams.get('auth_error'), error);
  assert.equal(location.searchParams.get('next'), next);
  assert.equal(location.searchParams.has('error_description'), false);
  assert.equal(location.searchParams.has('code'), false);
  assert.ok(!location.href.includes('PRIVATE_PROVIDER_DETAILS'));
}

async function check(label, run) {
  await run();
  checks += 1;
  console.log(`PASS ${label}`);
}

try {
  for (const path of ['/admin/login', '/account/login', '/auth/reset-password', '/auth/confirm']) {
    await check(
      `${path} preserves native form Origin without sending private URL paths`,
      async () => {
        const response = await request(path);
        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-type') ?? '', /text\/html/);
        // A manually supplied Origin on fetch() hides this browser failure:
        // no-referrer turns a native HTML form POST's Origin into "null".
        // strict-origin keeps the real Origin and excludes paths/query capabilities.
        const headerPolicy = response.headers
          .get('referrer-policy')
          ?.split(',')
          .map((value) => value.trim())
          .at(-1);
        assert.equal(
          headerPolicy,
          'strict-origin',
          'The delivered auth document must preserve form Origin while withholding private paths.',
        );
        const html = await response.text();
        for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
          if (!/\bname\s*=\s*["']referrer["']/i.test(tag)) continue;
          const policy = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1];
          assert.equal(
            policy,
            'strict-origin',
            'A document meta policy must not override the safe native-form policy.',
          );
        }
      },
    );
  }

  await check('anonymous session is verified, private and contains no session tokens', async () => {
    const response = await request('/api/auth/session');
    assert.equal(response.status, 200);
    noStore(response);
    const body = await response.json();
    assert.equal(
      body.configured,
      true,
      'This smoke run requires the connected development project.',
    );
    assert.deepEqual(body.user, null);
    assert.deepEqual(Object.keys(body).sort(), ['configured', 'user']);
  });

  for (const path of [
    '/api/auth/google',
    '/auth/signout',
    '/api/auth/password',
    '/api/auth/password/update',
    '/api/auth/recovery',
  ]) {
    await check(`GET ${path} cannot mutate authentication`, async () => {
      const response = await request(path);
      assert.equal(response.status, 405);
      assert.equal(response.headers.has('location'), false);
    });

    for (const [label, suppliedHeaders] of [
      ['without Origin', {}],
      ['with an opaque null Origin', { Origin: 'null' }],
      ['with a foreign Origin', { Origin: 'https://untrusted.example' }],
      ['with a cross-site fetch', { Origin: origin, 'Sec-Fetch-Site': 'cross-site' }],
    ]) {
      await check(`POST ${path} rejects ${label}`, async () => {
        const response = await request(path, {
          method: 'POST',
          headers: suppliedHeaders,
          body: new URLSearchParams({ next: '/checkout' }),
        });
        assert.equal(response.status, 403);
        noStore(response);
        assert.equal(response.headers.has('location'), false);
      });
    }
  }

  await check('opening the recovery page never verifies or consumes an email token', async () => {
    const response = await request('/auth/confirm');
    assert.equal(response.status, 200);
    // This generic document contains no token or identity; dev Next may use only "no-store".
    assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    assert.equal(response.headers.getSetCookie().length, 0);
    const html = await response.text();
    assert.ok(html.includes('Set your password'));
    assert.equal(html.includes('token_hash='), false);
  });

  await check('email recovery is deferred and cannot consume a token', async () => {
    const response = await request('/api/auth/recovery', {
      method: 'POST',
      headers: { Origin: origin },
      body: new URLSearchParams(),
    });
    assert.equal(response.status, 404);
    noStore(response);
    assert.deepEqual(await response.json(), { ok: false, error: 'recovery_disabled' });
  });

  await check(
    'admin login offers a fixed user ID, password and Google without email setup links',
    async () => {
      const response = await request('/admin/login');
      const html = await response.text();
      assert.ok(html.includes('hotpizzaace@gmail.com'));
      assert.ok(html.includes('Admin user ID'));
      assert.ok(html.includes('action="/api/auth/google"'));
      assert.doesNotMatch(html, /Forgot password|Set up owner password|Send password link/);
    },
  );

  await check(
    'the public admin password endpoint cannot register accounts or request email resets',
    async () => {
      for (const action of ['signup', 'reset']) {
        const response = await request('/api/auth/password', {
          method: 'POST',
          headers: { Origin: origin },
          body: new URLSearchParams({ action, email: 'hotpizzaace@gmail.com' }),
        });
        assert.equal(response.status, 303);
        const location = new URL(response.headers.get('location'));
        assert.equal(location.origin, origin);
        assert.equal(location.searchParams.get('auth_error'), 'email_flow_disabled');
        assert.equal(location.searchParams.has('auth_notice'), false);
      }
    },
  );

  await check('anonymous visitors cannot read private owner password readiness', async () => {
    const response = await request('/api/auth/owner-password');
    assert.equal(response.status, 401);
    noStore(response);
    assert.equal((await response.json()).error, 'reauth_required');
  });

  for (const [label, headers] of [
    ['without Origin', {}],
    ['with null Origin', { Origin: 'null' }],
    ['with a foreign Origin', { Origin: 'https://untrusted.example' }],
    ['with cross-site fetch metadata', { Origin: origin, 'Sec-Fetch-Site': 'cross-site' }],
  ]) {
    await check(`owner password changes reject ${label}`, async () => {
      const response = await request('/api/auth/owner-password', {
        method: 'POST',
        headers,
        body: new URLSearchParams(),
      });
      assert.equal(response.status, 403);
      noStore(response);
    });
  }

  await check('an anonymous same-origin request cannot change the owner password', async () => {
    const response = await request('/api/auth/owner-password', {
      method: 'POST',
      headers: { Origin: origin },
      body: new URLSearchParams({
        password: 'offline-anonymous-password-test',
        confirmPassword: 'offline-anonymous-password-test',
      }),
    });
    assert.equal(response.status, 401);
    noStore(response);
    assert.equal((await response.json()).error, 'reauth_required');
  });

  await check(
    'canceled consent is redacted and cannot redirect outside the customer area',
    async () => {
      const response = await request(
        '/auth/callback?error=access_denied&error_description=PRIVATE_PROVIDER_DETAILS&next=%2F%2Funtrusted.example',
      );
      localFailure(response, 'access_denied');
    },
  );

  await check(
    'missing authorization code preserves only an allowed checkout destination',
    async () => {
      const response = await request('/auth/callback?next=%2Fcheckout');
      localFailure(response, 'callback_failed', '/checkout');
    },
  );

  await check(
    'provider errors never reflect raw details or an unrecognized administrative destination',
    async () => {
      const response = await request(
        '/auth/callback?error=PRIVATE_PROVIDER_DETAILS&error_description=PRIVATE_PROVIDER_DETAILS&next=%2Fadmin%2Funknown',
      );
      localFailure(response, 'callback_failed');
    },
  );

  await check(
    'failed admin consent returns to the allowlisted admin sign-in page without granting access',
    async () => {
      const response = await request(
        '/auth/callback?error=access_denied&next=%2Fadmin%2Fdashboard',
      );
      localFailure(response, 'access_denied', '/admin/dashboard', '/admin/login');
    },
  );

  await check('invalid authorization codes are rejected consistently when repeated', async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await request(
        '/auth/callback?code=invalid-smoke-code-without-pkce-verifier&next=%2Fcheckout',
      );
      localFailure(response, 'callback_failed', '/checkout');
    }
  });

  for (const [label, query] of [
    [
      'expired or reused recovery links',
      'error=access_denied&error_description=PRIVATE_PROVIDER_DETAILS',
    ],
    ['recovery links without a code', ''],
    [
      'recovery codes without this browser’s verifier',
      'code=invalid-recovery-code-without-verifier',
    ],
  ]) {
    await check(`${label} stay in password recovery without Google cancellation copy`, async () => {
      const response = await request(
        `/auth/callback?next=%2Fauth%2Freset-password${query ? `&${query}` : ''}`,
      );
      localFailure(response, 'recovery_expired', '/auth/reset-password', '/admin/login');
      const location = new URL(response.headers.get('location'));
      assert.equal(location.searchParams.get('auth_action'), 'reset');
    });
  }

  await check('an anonymous visitor cannot open the new-password form', async () => {
    const response = await request('/auth/reset-password');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    const html = await response.text();
    assert.match(html, /This reset link has expired or is not valid in this browser/);
    assert.doesNotMatch(html, /action="\/api\/auth\/password\/update"/);
  });

  await check('the deferred legacy password-reset endpoint fails closed', async () => {
    const response = await request('/api/auth/password/update', {
      method: 'POST',
      headers: { Origin: origin },
      body: new URLSearchParams({
        password: 'fictional-recovery-test-password',
        confirmPassword: 'fictional-recovery-test-password',
      }),
    });
    assert.equal(response.status, 404);
    noStore(response);
    assert.equal(response.headers.has('location'), false);
  });

  await check('same-origin JSON sign-out supports the account UI', async () => {
    const response = await request('/auth/signout', {
      method: 'POST',
      headers: { Origin: origin, Accept: 'application/json' },
    });
    assert.equal(response.status, 200);
    noStore(response);
    assert.deepEqual(await response.json(), { ok: true });
  });

  await check(
    'Google initiation either creates a PKCE flow or clearly reports unavailable setup',
    async () => {
      const response = await request('/api/auth/google', {
        method: 'POST',
        headers: { Origin: origin },
        body: new URLSearchParams({ next: '/checkout' }),
      });
      assert.equal(response.status, 303);
      noStore(response);
      const location = new URL(response.headers.get('location'));
      if (location.origin === origin) {
        localFailure(response, 'provider_unavailable', '/checkout');
        console.log('INFO Google provider setup is not enabled; consent was not attempted.');
        return;
      }
      const expectedProject = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (expectedProject) assert.equal(location.origin, new URL(expectedProject).origin);
      else {
        assert.equal(location.protocol, 'https:');
        assert.match(location.hostname, /^[a-z0-9-]+\.supabase\.co$/);
      }
      assert.equal(location.pathname, '/auth/v1/authorize');
      assert.equal(location.searchParams.get('provider'), 'google');
      assert.ok(location.searchParams.get('code_challenge'));
      const callback = new URL(location.searchParams.get('redirect_to'));
      assert.equal(callback.origin, origin);
      assert.equal(callback.pathname, '/auth/callback');
      assert.equal(callback.searchParams.get('next'), '/checkout');
      const flowId = callback.searchParams.get('sb_flow_id');
      assert.equal(typeof flowId === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(flowId), true);
      const cookies = response.headers.getSetCookie();
      assert.equal(
        cookies.some((cookie) => cookie.split('=', 1)[0].endsWith(`-flow-${flowId}-code-verifier`)),
        true,
        'The callback must reference the verifier cookie created for its own flow.',
      );
      for (const cookie of cookies) {
        assert.match(cookie, /SameSite=lax/i);
        if (base.protocol === 'https:') assert.match(cookie, /; Secure/i);
      }
      console.log(
        'INFO OAuth redirect and verifier cookie verified; Google consent was not opened.',
      );
    },
  );

  console.log(
    `Auth smoke checks passed: ${checks}. No user created and no Google consent completed.`,
  );
  console.log(
    'A valid authorization-code replay and signed-in session require the owner to complete Google sign-in separately.',
  );
} catch (error) {
  console.error(`Auth smoke check failed after ${checks} passes: ${error.message}`);
  process.exitCode = 1;
}
