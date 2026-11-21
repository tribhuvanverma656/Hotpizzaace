import { NextResponse } from 'next/server';
import { getRequestOrigin } from '@/lib/auth/google';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { rotateGuestSession } from '@/lib/commerce/guest-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = {
  'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
};

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
      { error: 'Use the sign-out form on this website.' },
      { status: 403, headers },
    );

  try {
    // The SDK may clear local auth cookies even when remote session revocation fails.
    // An explicit local sign-out must always discard the browser's guest capability.
    await rotateGuestSession(origin);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error)
      return Response.json(
        { error: 'Sign-out could not complete. Please try again.' },
        { status: 503, headers },
      );
    if (request.headers.get('accept')?.includes('application/json'))
      return Response.json({ ok: true }, { headers });
    return NextResponse.redirect(new URL('/account/login', origin), { status: 303, headers });
  } catch {
    return Response.json(
      { error: 'Sign-out could not complete. Please try again.' },
      { status: 503, headers },
    );
  }
}
