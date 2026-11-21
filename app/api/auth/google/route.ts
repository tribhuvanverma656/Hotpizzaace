import { NextResponse } from 'next/server';
import { authLoginPath, getRequestOrigin, safeAuthNext } from '@/lib/auth/google';
import { getGoogleProviderStatus } from '@/lib/auth/provider';
import { getSupabasePublicConfig } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { boundedPasswordForm } from '@/lib/auth/password';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = {
  'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
  'Referrer-Policy': 'no-referrer',
};

/** A form POST prevents cross-site login initiation; the SDK stores the PKCE verifier. */
export async function POST(request: Request) {
  let origin: string;
  try {
    origin = getRequestOrigin(request);
  } catch {
    return Response.json({ error: 'Invalid application origin.' }, { status: 400, headers });
  }
  if (
    request.headers.get('origin') !== origin ||
    request.headers.get('sec-fetch-site') === 'cross-site'
  )
    return Response.json(
      { error: 'Use the sign-in form on this website.' },
      { status: 403, headers },
    );

  let next = safeAuthNext(null);
  const failure = (code: string) => {
    const url = new URL(authLoginPath(next), origin);
    url.searchParams.set('auth_error', code);
    url.searchParams.set('next', next);
    return NextResponse.redirect(url, { status: 303, headers });
  };

  let form: URLSearchParams;
  try {
    // Google forms carry only a return path. Do not buffer multipart uploads or
    // unbounded request bodies before starting an unauthenticated OAuth flow.
    form = await boundedPasswordForm(request);
    if (form.size !== 1 || !form.has('next')) throw new Error('Invalid sign-in form.');
  } catch {
    return Response.json({ error: 'Send a valid sign-in request.' }, { status: 400, headers });
  }
  next = safeAuthNext(form.get('next'));

  try {
    const config = getSupabasePublicConfig();
    if ((await getGoogleProviderStatus(config)) !== 'enabled')
      return failure('provider_unavailable');

    const callback = new URL('/auth/callback', origin);
    callback.searchParams.set('next', next);
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        scopes: 'openid email profile',
        redirectTo: callback.toString(),
        skipBrowserRedirect: true,
        ...(authLoginPath(next) === '/admin/login'
          ? { queryParams: { prompt: 'select_account' } }
          : {}),
      },
    });
    if (error || !data.url) return failure('provider_unavailable');
    return NextResponse.redirect(data.url, { status: 303, headers });
  } catch {
    // Provider/SDK errors can contain identifiers and must never be reflected to the browser.
    return failure('provider_unavailable');
  }
}
