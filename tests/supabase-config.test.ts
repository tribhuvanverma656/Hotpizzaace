import assert from 'node:assert/strict';
import test from 'node:test';
import { readSupabasePublicConfig } from '../lib/supabase/config';

const valid = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
};

test('unconfigured local demo does not pretend to have a database', () => {
  assert.equal(readSupabasePublicConfig({}), null);
});

test('complete public connection configuration is normalized', () => {
  assert.deepEqual(
    readSupabasePublicConfig({
      NEXT_PUBLIC_SUPABASE_URL: ' https://example.supabase.co/ ',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ' sb_publishable_example ',
    }),
    { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_example' },
  );
});

test('partial connection configuration fails explicitly', () => {
  assert.throws(() =>
    readSupabasePublicConfig({ NEXT_PUBLIC_SUPABASE_URL: valid.NEXT_PUBLIC_SUPABASE_URL }),
  );
  assert.throws(() =>
    readSupabasePublicConfig({
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: valid.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    }),
  );
});

test('public client refuses secret and legacy service-role keys', () => {
  for (const key of ['sb_secret_example', 'eyJhbGciOiJIUzI1NiJ9.unsafe.signature', 'password'])
    assert.throws(() =>
      readSupabasePublicConfig({ ...valid, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key }),
    );
});

test('project URL rejects credentials, extra paths, and non-local plaintext transport', () => {
  for (const url of [
    'http://example.supabase.co',
    'https://user:password@example.supabase.co',
    'https://example.supabase.co/rest/v1',
    'https://example.supabase.co?key=secret',
    'https://example.supabase.co#fragment',
    'not a URL',
  ])
    assert.throws(() => readSupabasePublicConfig({ ...valid, NEXT_PUBLIC_SUPABASE_URL: url }));
});

test('local Supabase CLI URL supports HTTP', () => {
  assert.equal(
    readSupabasePublicConfig({ ...valid, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' })?.url,
    'http://127.0.0.1:54321',
  );
});
