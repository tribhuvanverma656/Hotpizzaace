import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { readSupabasePublicConfig, supabaseAuthOptions } from './config';
import { serverAuthCookieOptions } from './server-cookie-options';

/** Refresh cookies on the request and response; identity/authorization stays inside each handler. */
export async function updateSupabaseSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  try {
    const config = readSupabasePublicConfig({
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    });
    if (!config) return response;
    const canonicalOrigin =
      process.env.APP_BASE_URL?.trim() || process.env.RENDER_EXTERNAL_URL?.trim();
    const supabase = createServerClient(config.url, config.publishableKey, {
      auth: supabaseAuthOptions,
      cookieOptions: serverAuthCookieOptions(canonicalOrigin),
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet, cacheHeaders) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          const previous = response;
          response = NextResponse.next({ request });
          // The SDK may write more than once and only supplies cache headers on its first write.
          for (const cookie of previous.cookies.getAll()) response.cookies.set(cookie);
          for (const [key, value] of previous.headers)
            if (key !== 'set-cookie' && !key.startsWith('x-middleware-'))
              response.headers.set(key, value);
          for (const { name, value, options } of cookiesToSet)
            response.cookies.set(name, value, options);
          for (const [key, value] of Object.entries(cacheHeaders)) response.headers.set(key, value);
        },
      },
    });
    // The callback exchanges its browser-bound code before verifying the new identity itself.
    // Refreshing an invalid old session here can delete that code's pending PKCE verifier.
    if (request.nextUrl.pathname !== '/auth/callback') await supabase.auth.getClaims();
  } catch {
    // A temporary auth outage must not break the public demo or become an authenticated identity.
    // The session endpoint/handlers independently verify the user and fail closed.
  }
  response.headers.set('Cache-Control', 'private, no-cache, no-store, must-revalidate, max-age=0');
  response.headers.set('Pragma', 'no-cache');
  response.headers.set('Expires', '0');
  return response;
}
