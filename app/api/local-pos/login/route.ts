import { z } from 'zod';
import { NextResponse } from 'next/server';
import {
  authenticateLocalUser,
  createLocalSession,
  LOCAL_SESSION_COOKIE,
  LOCAL_SESSION_TTL_SECONDS,
  LocalPosError,
  localPosIsConfigured,
} from '@/lib/local-pos/auth';
import { assertLocalPosOrigin, logLocalPosFailure, readLocalPosJson } from '@/lib/local-pos/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const loginSchema = z
  .object({ username: z.string().max(32), password: z.string().max(128) })
  .strict();

export async function POST(request: Request) {
  try {
    assertLocalPosOrigin(request);
    if (!localPosIsConfigured())
      throw new LocalPosError(
        'Set up the Super User account before signing in.',
        409,
        'setup_required',
      );
    const body = loginSchema.parse(await readLocalPosJson(request));
    const user = await authenticateLocalUser(body.username, body.password);
    if (!user)
      throw new LocalPosError(
        'Unable to sign in with those credentials. Check the username and password, or try again later.',
        401,
        'invalid_credentials',
      );
    const session = createLocalSession(user.id);
    const response = NextResponse.json(
      { user },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
    response.cookies.set(LOCAL_SESSION_COOKIE, session.token, {
      httpOnly: true,
      secure: new URL(request.url).protocol === 'https:',
      sameSite: 'strict',
      path: '/',
      maxAge: LOCAL_SESSION_TTL_SECONDS,
    });
    return response;
  } catch (error) {
    return logLocalPosFailure(error);
  }
}
