import { ZodError } from 'zod';
import { cookies } from 'next/headers';
import { LOCAL_SESSION_COOKIE, readLocalSession } from './auth';
import { LocalPosError } from './errors';
export { assertLocalPosOrigin } from './origin';
import type { LocalRole, LocalUser } from './database';

const responseHeaders = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

export function localPosJson(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: responseHeaders });
}

export async function readLocalPosJson(
  request: Request,
  maxBytes = 16_384,
): Promise<unknown> {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > maxBytes)
    throw new LocalPosError('This request is too large.', 413, 'request_too_large');
  const text = await request.text();
  if (text.length > maxBytes)
    throw new LocalPosError('This request is too large.', 413, 'request_too_large');
  try {
    return JSON.parse(text);
  } catch {
    throw new LocalPosError('Send a valid JSON request.', 400, 'invalid_json');
  }
}

export async function currentLocalPosUser(): Promise<LocalUser | null> {
  const cookieStore = await cookies();
  const session = cookieStore.get(LOCAL_SESSION_COOKIE)?.value;
  return readLocalSession(session);
}

export async function requireLocalPosUser(roles?: LocalRole[]): Promise<LocalUser> {
  const user = await currentLocalPosUser();
  if (!user) throw new LocalPosError('Sign in to the local POS to continue.', 401, 'auth_required');
  if (roles && !roles.includes(user.role))
    throw new LocalPosError(
      'This account does not have permission for that action.',
      403,
      'role_denied',
    );
  return user;
}

export function logLocalPosFailure(error: unknown): Response {
  if (error instanceof LocalPosError)
    return localPosJson({ error: error.message, code: error.code }, error.status);
  if (error instanceof ZodError)
    return localPosJson(
      {
        error: error.issues[0]?.message ?? 'Review the submitted fields.',
        code: 'invalid_request',
      },
      400,
    );
  console.error('Local POS request failed:', error);
  return localPosJson(
    {
      error: 'The local POS could not complete this request. Check the system log and retry.',
      code: 'local_pos_error',
    },
    500,
  );
}
