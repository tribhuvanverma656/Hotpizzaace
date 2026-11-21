import 'server-only';
import { cookies } from 'next/headers';
import { isAuthSessionMissingError } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '../supabase/server';
import { getSupabasePublicConfig } from '../supabase/config';
import { getRequestOrigin } from '../auth/google';
import { commercePrivateHeaders, isCommerceEnabled } from './config';
import { GUEST_COOKIE, guestCookieOptions, newGuestSession } from './guest-session';

const BODY_LIMIT = 65_536;

function failure(message: string, status: number, code: string) {
  return Response.json({ error: message, code }, { status, headers: commercePrivateHeaders });
}

async function readBody(request: Request): Promise<unknown> {
  if (
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
  )
    throw new Error('content_type');
  if (Number(request.headers.get('content-length')) > BODY_LIMIT) throw new Error('body_limit');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('invalid_json');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > BODY_LIMIT) {
        await reader.cancel();
        throw new Error('body_limit');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(joined));
  } catch {
    throw new Error('invalid_json');
  }
}

/** Browser cookies stay on this origin. Only a verified user's access token crosses to the Edge API. */
export async function proxyCommerce(request: Request, path: string[]) {
  if (!isCommerceEnabled()) {
    if (request.method === 'GET' && path.join('/') === 'session')
      return Response.json(
        { shared: false, user: null, admin: false },
        { headers: commercePrivateHeaders },
      );
    return failure(
      'Shared ordering is not enabled on this deployment.',
      503,
      'commerce_unavailable',
    );
  }
  if (path.length > 5 || path.some((part) => !/^[A-Za-z0-9_-]{1,100}$/.test(part)))
    return failure('This page could not be found.', 404, 'not_found');
  let origin: string;
  try {
    origin = getRequestOrigin(request);
  } catch {
    return failure('The website address is not configured.', 503, 'commerce_unavailable');
  }
  if (
    request.method !== 'GET' &&
    (request.headers.get('origin') !== origin ||
      request.headers.get('sec-fetch-site') === 'cross-site')
  )
    return failure('This request is not allowed.', 403, 'forbidden');
  let body: unknown = null;
  if (request.method !== 'GET') {
    try {
      body = await readBody(request);
    } catch (error) {
      const kind = error instanceof Error ? error.message : '';
      return failure(
        kind === 'body_limit' ? 'This request is too large.' : 'Send a valid JSON request.',
        kind === 'body_limit' ? 413 : 400,
        'invalid_request',
      );
    }
  }
  try {
    const { url, publishableKey } = getSupabasePublicConfig();
    const supabase = await createSupabaseServerClient();
    const { data: verified, error: authError } = await supabase.auth.getUser();
    if (authError && !isAuthSessionMissingError(authError))
      return failure(
        'We could not verify your sign-in. Please sign in again.',
        401,
        'auth_required',
      );
    let token: string | undefined;
    if (verified.user) {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session || session.session.user.id !== verified.user.id)
        return failure('Please sign in again.', 401, 'auth_required');
      token = session.session.access_token;
    }
    const cookieStore = await cookies();
    let guestSession = cookieStore.get(GUEST_COOKIE)?.value;
    if (!guestSession || !/^[a-f0-9]{64}$/.test(guestSession)) {
      guestSession = newGuestSession();
      if (!(request.method === 'GET' && path.join('/') === 'catalog'))
        cookieStore.set(GUEST_COOKIE, guestSession, guestCookieOptions(origin));
      // Never place an anonymous order or table request before the browser has one stable nonce.
      // The client may retry this exact checkout once after receiving Set-Cookie.
      if (
        request.method === 'POST' &&
        (path.join('/') === 'orders' ||
          (path.length === 3 &&
            path[0] === 'table' &&
            ['requests', 'online-order'].includes(path[2])))
      )
        return failure(
          'Your checkout session is ready. Please retry the same checkout.',
          409,
          'guest_session_initialized',
        );
    }
    const access = new URL(request.url).searchParams.get('access');
    if (access && !/^[a-f0-9]{64}$/.test(access))
      return failure('This order could not be found.', 404, 'not_found');
    const response = await fetch(`${url}/functions/v1/hpa-commerce`, {
      method: 'POST',
      headers: {
        apikey: publishableKey,
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        method: request.method,
        path,
        query: access ? { access } : {},
        body,
        guestSession,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
      redirect: 'error',
    });
    const result: unknown = await response.json();
    if (!result || typeof result !== 'object' || Array.isArray(result))
      return failure(
        'Ordering is temporarily unavailable. Please try again.',
        503,
        'commerce_unavailable',
      );
    return Response.json(result, { status: response.status, headers: commercePrivateHeaders });
  } catch {
    return failure(
      'Ordering is temporarily unavailable. Please try again.',
      503,
      'commerce_unavailable',
    );
  }
}
