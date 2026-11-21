#!/usr/bin/env node

import assert from 'node:assert/strict';

// Anonymous only: no account creation, session cookies, credentials or real address writes.
const suppliedBase = process.env.ADDRESS_SMOKE_BASE_URL;
if (!suppliedBase) {
  console.error('Set ADDRESS_SMOKE_BASE_URL to localhost or the Render development origin.');
  process.exit(2);
}

const base = new URL(suppliedBase);
assert.ok(
  ((base.hostname === 'localhost' && base.protocol === 'http:') ||
    (base.origin === 'https://hotpizzaace-development.onrender.com' &&
      base.protocol === 'https:')) &&
    !base.username &&
    !base.password &&
    base.pathname === '/' &&
    !base.search &&
    !base.hash,
  'Use localhost or the explicitly named Render development service.',
);

const suppliedSupabase = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
assert.ok(
  suppliedSupabase && publishableKey,
  'Configure the development Supabase public environment.',
);
const supabase = new URL(suppliedSupabase);
assert.ok(
  supabase.origin === 'https://kaypgsstngguvrpftpwo.supabase.co' &&
    !supabase.username &&
    !supabase.password &&
    supabase.pathname === '/' &&
    !supabase.search &&
    !supabase.hash,
  'Public API probes are restricted to the connected development Supabase project.',
);
assert.ok(
  /^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey),
  'Use only the public publishable key.',
);

const origin = base.origin;
const addressPath = '/api/commerce/addresses';
const fakeMutation = JSON.stringify({
  action: 'create',
  expectedRevision: 0,
  address: {
    id: '00000000-0000-4000-8000-000000000001',
    label: 'Smoke fixture',
    customer: {
      name: 'Smoke Fixture',
      phone: '9000000000',
      address: '1 Smoke Fixture Street',
      locality: 'Smoke Fixture',
      postalCode: '208027',
      landmark: '',
      instructions: '',
    },
    isDefault: true,
  },
});
let checks = 0;

function request(init = {}) {
  return fetch(new URL(addressPath, origin), {
    ...init,
    credentials: 'omit',
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
  });
}

function privateResponse(response) {
  const cacheControl = response.headers.get('cache-control') ?? '';
  assert.match(cacheControl, /private/);
  assert.match(cacheControl, /no-cache/);
  assert.match(cacheControl, /no-store/);
  assert.match(cacheControl, /must-revalidate/);
  assert.match(cacheControl, /max-age=0/);
  assert.equal(response.headers.get('pragma'), 'no-cache');
  assert.equal(response.headers.get('expires'), '0');
  assert.match(response.headers.get('vary') ?? '', /Cookie/i);
  // The global native-form policy is strict-origin; both policies withhold private paths.
  assert.ok(
    ['no-referrer', 'strict-origin'].includes(response.headers.get('referrer-policy')),
    'The referrer policy must withhold private paths.',
  );
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.has('location'), false);
}

async function failure(response, status, code) {
  assert.equal(response.status, status);
  privateResponse(response);
  const body = await response.json();
  assert.equal(body.code, code);
  assert.equal(typeof body.error, 'string');
  assert.deepEqual(Object.keys(body).sort(), ['code', 'error']);
}

async function check(label, run) {
  await run();
  checks += 1;
  console.log(`PASS ${label}`);
}

try {
  await check('anonymous GET cannot read saved addresses', async () => {
    await failure(await request(), 401, 'auth_required');
  });

  await check('anonymous same-origin POST cannot create a saved address', async () => {
    await failure(
      await request({
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: fakeMutation,
      }),
      401,
      'auth_required',
    );
  });

  for (const [label, headers] of [
    ['missing Origin', {}],
    ['foreign Origin', { Origin: 'https://untrusted.example' }],
    ['opaque null Origin', { Origin: 'null' }],
    ['cross-site fetch metadata', { Origin: origin, 'Sec-Fetch-Site': 'cross-site' }],
  ]) {
    await check(`address mutations reject ${label}`, async () => {
      await failure(
        await request({
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: fakeMutation,
        }),
        403,
        'forbidden',
      );
    });
  }

  await check('malformed JSON is rejected before authentication or writes', async () => {
    await failure(
      await request({
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: '{broken-json',
      }),
      400,
      'invalid_request',
    );
  });

  await check('oversized bodies are rejected before authentication or writes', async () => {
    await failure(
      await request({
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ padding: 'x'.repeat(65536) }),
      }),
      413,
      'invalid_request',
    );
  });

  for (const [label, path, init] of [
    ['read private address-book rows', '/rest/v1/hpa_address_books?select=revision&limit=1', {}],
    [
      'invoke private address-book reads',
      '/rest/v1/rpc/hpa_get_address_book',
      {
        method: 'POST',
        body: JSON.stringify({ p_user_id: '00000000-0000-4000-8000-000000000001' }),
      },
    ],
    [
      'invoke private address-book replacement',
      '/rest/v1/rpc/hpa_replace_address_book',
      // If accidentally exposed, validation must fail before any INSERT/UPDATE can occur.
      {
        method: 'POST',
        body: JSON.stringify({ p_user_id: null, p_expected_revision: -1, p_addresses: [] }),
      },
    ],
  ]) {
    await check(`the public publishable key cannot ${label}`, async () => {
      const response = await fetch(new URL(path, supabase.origin), {
        ...init,
        headers: {
          apikey: publishableKey,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        credentials: 'omit',
        redirect: 'manual',
        signal: AbortSignal.timeout(20000),
      });
      assert.ok(
        [401, 403, 404].includes(response.status),
        'Private storage and RPCs must deny the public key.',
      );
      await response.body?.cancel();
    });
  }

  console.log(`${checks} anonymous saved-address smoke checks passed.`);
} catch (error) {
  // Avoid logging provider responses, environment values, or credentials on failure.
  console.error(
    `FAIL after ${checks} checks: ${error instanceof assert.AssertionError ? error.message : 'Request could not complete.'}`,
  );
  process.exitCode = 1;
}
