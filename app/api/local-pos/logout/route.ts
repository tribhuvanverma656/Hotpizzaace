import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { LOCAL_SESSION_COOKIE, revokeLocalSession } from '@/lib/local-pos/auth';
import { assertLocalPosOrigin, logLocalPosFailure } from '@/lib/local-pos/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    assertLocalPosOrigin(request);
    const cookieStore = await cookies();
    revokeLocalSession(cookieStore.get(LOCAL_SESSION_COOKIE)?.value);
    const response = NextResponse.json(
      { signedOut: true },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
    response.cookies.set(LOCAL_SESSION_COOKIE, '', {
      httpOnly: true,
      secure: new URL(request.url).protocol === 'https:',
      sameSite: 'strict',
      path: '/',
      maxAge: 0,
    });
    return response;
  } catch (error) {
    return logLocalPosFailure(error);
  }
}
