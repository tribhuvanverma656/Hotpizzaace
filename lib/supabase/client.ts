'use client';

import { createBrowserClient } from '@supabase/ssr';
import { getSupabasePublicConfig, supabaseAuthOptions } from './config';

/** For future authenticated browser repositories; contains no privileged credentials. */
export function createSupabaseBrowserClient() {
  const { url, publishableKey } = getSupabasePublicConfig();
  return createBrowserClient(url, publishableKey, { auth: supabaseAuthOptions });
}
