import type { CookieOptions } from '@supabase/ssr';

/**
 * Auth is server-only: the browser uses our session/commerce API projections,
 * never the Supabase browser SDK. Keep tokens and PKCE verifiers out of JS.
 * Reassess HttpOnly before introducing a browser-side Supabase auth client.
 */
export function serverAuthCookieOptions(canonicalOrigin?: string): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: Boolean(canonicalOrigin?.startsWith('https://')),
    path: '/',
  };
}
