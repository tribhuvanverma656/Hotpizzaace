import type { SupabaseClientOptions } from '@supabase/supabase-js';

export type SupabasePublicConfig = { url: string; publishableKey: string };

/** Carry each PKCE flow's id through our wildcard-allowlisted callback URL. */
export const supabaseAuthOptions = {
  experimental: { appendPkceFlowIdToRedirects: true },
} satisfies NonNullable<SupabaseClientOptions<'public'>['auth']>;

type PublicEnvironment = {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
};

/** Connection configuration only. Setting these values does not migrate demo data. */
export function readSupabasePublicConfig(
  environment: PublicEnvironment,
): SupabasePublicConfig | null {
  const url = environment.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url && !publishableKey) return null;
  if (!url || !publishableKey)
    throw new Error('Configure both the Supabase URL and publishable key.');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('The Supabase project URL is invalid.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (
    (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== '/' && parsed.pathname !== '')
  )
    throw new Error('Use the HTTPS Supabase project URL without a path or credentials.');
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey))
    throw new Error('Use a Supabase publishable key, never a secret or service-role key.');
  return { url: parsed.origin, publishableKey };
}

export function getSupabasePublicConfig(): SupabasePublicConfig {
  // Direct references are required for Next.js build-time browser substitution.
  const config = readSupabasePublicConfig({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  if (!config) throw new Error('Supabase connection has not been configured.');
  return config;
}
