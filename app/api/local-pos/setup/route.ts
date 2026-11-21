import { z } from 'zod';
import { NextResponse } from 'next/server';
import {
  createFirstSuperUser,
  createLocalSession,
  LOCAL_SESSION_COOKIE,
  LOCAL_SESSION_TTL_SECONDS,
  localPosIsConfigured,
  LocalPosError,
} from '@/lib/local-pos/auth';
import { assertLocalPosOrigin, logLocalPosFailure, readLocalPosJson } from '@/lib/local-pos/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const setupSchema = z
  .object({
    username: z.string().max(32),
    displayName: z.string().max(80),
    password: z.string().max(128),
  })
  .strict();

export async function POST(request: Request) {
  try {
    assertLocalPosOrigin(request);
    if (localPosIsConfigured())
      throw new LocalPosError(
        'This POS is already set up. Sign in instead.',
        409,
        'already_configured',
      );
    const body = setupSchema.parse(await readLocalPosJson(request));
    const user = await createFirstSuperUser(body);
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
