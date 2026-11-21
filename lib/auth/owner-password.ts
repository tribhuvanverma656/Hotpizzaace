import type { SupabaseClient } from '@supabase/supabase-js';
import { ADMIN_LOGIN_ID } from './admin-account';
import {
  boundedPasswordForm,
  passwordRequestOrigin,
  passwordResponseHeaders,
  validNewPassword,
} from './password';

export type OwnerPasswordClient = {
  auth: Pick<SupabaseClient['auth'], 'getUser' | 'getClaims' | 'updateUser' | 'signOut'>;
};
export type OwnerPasswordDependencies = {
  createClient: () => Promise<OwnerPasswordClient>;
  /** Uses the existing protected commerce session API, never a local admin flag. */
  verifyOwner: (request: Request, userId: string) => Promise<boolean>;
  origin?: (request: Request) => string;
  now?: () => number;
};

function failure(error: string, status: number) {
  return Response.json(
    { ok: false, ready: false, error },
    {
      status,
      headers: { ...passwordResponseHeaders, ...(status === 405 ? { Allow: 'GET, POST' } : {}) },
    },
  );
}

/** Only the protected commerce session endpoint can supply this membership decision. */
export function isVerifiedOwnerSession(value: unknown, userId: string): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const session = value as Record<string, unknown>;
  if (session.shared !== true || session.admin !== true) return false;
  if (!session.user || typeof session.user !== 'object' || Array.isArray(session.user))
    return false;
  return (session.user as Record<string, unknown>).id === userId;
}

function recentOAuth(claims: unknown, userId: string, now: number) {
  if (!claims || typeof claims !== 'object') return false;
  const value = claims as Record<string, unknown>;
  if (value.sub !== userId || !Array.isArray(value.amr)) return false;
  const seconds = Math.floor(now / 1000);
  return value.amr.some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const proof = entry as Record<string, unknown>;
    return (
      proof.method === 'oauth' &&
      Number.isSafeInteger(proof.timestamp) &&
      Number(proof.timestamp) >= seconds - 900 &&
      Number(proof.timestamp) <= seconds + 60
    );
  });
}

async function authorizeOwner(request: Request, dependencies: OwnerPasswordDependencies) {
  try {
    const client = await dependencies.createClient();
    const verified = await client.auth.getUser();
    if (verified.error) {
      const status = verified.error.status;
      const missingSignIn = status === 401 || status === 403 || status === 400;
      return failure(
        missingSignIn ? 'reauth_required' : 'auth_unavailable',
        missingSignIn ? 401 : 503,
      );
    }
    const user = verified.data.user;
    if (!user) return failure('reauth_required', 401);
    if (!user.email_confirmed_at || user.email?.trim().toLowerCase() !== ADMIN_LOGIN_ID)
      return failure('forbidden', 403);
    if (
      !user.identities?.some(
        (identity) => identity.provider === 'google' && identity.user_id === user.id,
      )
    )
      return failure('reauth_required', 401);
    const claims = await client.auth.getClaims();
    if (claims.error) return failure('auth_unavailable', 503);
    if (!recentOAuth(claims.data?.claims, user.id, (dependencies.now ?? Date.now)()))
      return failure('reauth_required', 401);
    if (!(await dependencies.verifyOwner(request, user.id))) return failure('forbidden', 403);
    return client;
  } catch {
    return failure('auth_unavailable', 503);
  }
}

/** Existing owner membership and a fresh Google sign-in authorize only this account's password. */
export async function handleOwnerPassword(
  request: Request,
  dependencies: OwnerPasswordDependencies,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST')
    return failure('method_not_allowed', 405);
  let password: string | undefined;
  if (request.method === 'POST') {
    const origin = passwordRequestOrigin(request, dependencies);
    if (origin instanceof Response) return failure('invalid_origin', origin.status);
    const fetchSite = request.headers.get('sec-fetch-site');
    if (fetchSite !== null && fetchSite !== 'same-origin') return failure('invalid_origin', 403);
    let form: URLSearchParams;
    try {
      form = await boundedPasswordForm(request);
    } catch {
      return failure('invalid_request', 400);
    }
    if (
      form.size !== 2 ||
      form.getAll('password').length !== 1 ||
      form.getAll('confirmPassword').length !== 1
    )
      return failure('invalid_request', 400);
    const chosen = form.get('password');
    if (!validNewPassword(chosen)) return failure('password_requirements', 400);
    if (form.get('confirmPassword') !== chosen) return failure('password_mismatch', 400);
    password = chosen;
  }
  const client = await authorizeOwner(request, dependencies);
  if (client instanceof Response) return client;
  if (request.method === 'GET')
    return Response.json(
      { ok: true, ready: true, loginId: ADMIN_LOGIN_ID },
      { headers: passwordResponseHeaders },
    );
  try {
    const updated = await client.auth.updateUser({ password });
    if (updated.error) return failure('password_update_failed', 503);
    // Password storage has already committed; sign-out failure must not claim it failed.
    try {
      await client.auth.signOut({ scope: 'global' });
    } catch {
      /* A subsequent password sign-in uses the value that was just saved. */
    }
    return Response.json(
      { ok: true, signInPath: '/admin/login?auth_notice=password_updated' },
      { headers: passwordResponseHeaders },
    );
  } catch {
    return failure('password_update_failed', 503);
  }
}
