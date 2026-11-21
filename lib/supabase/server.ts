import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getSupabasePublicConfig, supabaseAuthOptions } from './config';
import { serverAuthCookieOptions } from './server-cookie-options';

/** Each request gets its own RLS-scoped client. Never share a user's session globally. */
export async function createSupabaseServerClient() {
  const { url, publishableKey } = getSupabasePublicConfig();
  const cookieStore = await cookies();
  const canonicalOrigin =
    process.env.APP_BASE_URL?.trim() || process.env.RENDER_EXTERNAL_URL?.trim();
  return createServerClient(url, publishableKey, {
    auth: supabaseAuthOptions,
    cookieOptions: serverAuthCookieOptions(canonicalOrigin),
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(values) {
        // This helper is used by route handlers/actions where response cookies are writable.
        for (const { name, value, options } of values) cookieStore.set(name, value, options);
      },
    },
  });
}

export async function getVerifiedSupabaseUser() {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.auth.getUser();
  if (error) return null;
  return data.user;
}
