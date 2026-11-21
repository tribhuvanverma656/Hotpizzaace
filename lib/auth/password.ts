import type { SupabaseClient, User } from '@supabase/supabase-js';
import { z } from 'zod';
import { authLoginPath, getRequestOrigin, safeAuthNext } from './google';
import { ADMIN_LOGIN_ID } from './admin-account';

export type PasswordClient = {
  auth: Pick<
    SupabaseClient['auth'],
    | 'signInWithPassword'
    | 'signUp'
    | 'resetPasswordForEmail'
    | 'getUser'
    | 'getClaims'
    | 'updateUser'
    | 'signOut'
  >;
};
export type PasswordRouteDependencies = {
  createClient: () => Promise<PasswordClient>;
  origin?: (request: Request) => string;
  now?: () => number;
  recoveryEnabled?: boolean;
  adminLoginId?: string;
  signInOnly?: boolean;
  onVerifiedSignIn?: () => void | Promise<void>;
};
export const passwordResponseHeaders = {
  'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
  'Referrer-Policy': 'no-referrer',
};
const FORM_LIMIT = 8192;
const emailSchema = z.email().max(254);

export function resetPasswordErrorMessage(code: unknown): string {
  const errors: Record<string, string> = {
    password_requirements: 'Choose a password between 12 and 128 characters.',
    password_mismatch: 'The passwords do not match. Please enter them again.',
    password_update_failed:
      'We could not update your password. Try again or request a fresh reset link.',
    recovery_expired:
      'This password reset link has expired. Request a new link from the sign-in page.',
  };
  return typeof code === 'string' && Object.hasOwn(errors, code) ? errors[code] : '';
}

export function validNewPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 12 && value.length <= 128 && /\S/.test(value);
}

/** Claims must come from getClaims(), never JSON-decoded cookies or editable profile metadata. */
export function hasRecentRecoveryClaims(
  claims: unknown,
  userId: string,
  now = Date.now(),
): boolean {
  if (!claims || typeof claims !== 'object') return false;
  const value = claims as Record<string, unknown>;
  if (value.sub !== userId || !Array.isArray(value.amr)) return false;
  const nowSeconds = Math.floor(now / 1000);
  return value.amr.some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const method = entry as Record<string, unknown>;
    return (
      method.method === 'recovery' &&
      Number.isSafeInteger(method.timestamp) &&
      Number(method.timestamp) >= nowSeconds - 900 &&
      Number(method.timestamp) <= nowSeconds + 60
    );
  });
}

export async function verifiedRecoveryUser(
  client: { auth: Pick<PasswordClient['auth'], 'getUser' | 'getClaims'> },
  now = Date.now(),
): Promise<User | null> {
  try {
    const { data, error } = await client.auth.getUser();
    if (error || !data.user?.email_confirmed_at) return null;
    const verified = await client.auth.getClaims();
    return !verified.error && hasRecentRecoveryClaims(verified.data?.claims, data.user.id, now)
      ? data.user
      : null;
  } catch {
    return null;
  }
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: passwordResponseHeaders });
}
function redirect(origin: string, path: string, parameters: Record<string, string>) {
  const url = new URL(path, origin);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  return new Response(null, {
    status: 303,
    headers: { ...passwordResponseHeaders, Location: url.toString() },
  });
}
export function passwordRequestOrigin(
  request: Request,
  dependencies: Pick<PasswordRouteDependencies, 'origin'>,
): string | Response {
  let origin: string;
  try {
    origin = (dependencies.origin ?? getRequestOrigin)(request);
  } catch {
    return jsonError('Invalid application origin.', 400);
  }
  if (request.method !== 'POST') return jsonError('Method not allowed.', 405);
  if (
    request.headers.get('origin') !== origin ||
    request.headers.get('sec-fetch-site') === 'cross-site'
  )
    return jsonError('Use the password form on this website.', 403);
  return origin;
}
export async function boundedPasswordForm(request: Request): Promise<URLSearchParams> {
  if (
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !==
    'application/x-www-form-urlencoded'
  )
    throw new Error('Invalid form.');
  if (Number(request.headers.get('content-length')) > FORM_LIMIT) throw new Error('Invalid form.');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Invalid form.');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > FORM_LIMIT) {
        await reader.cancel();
        throw new Error('Invalid form.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const data = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const form = new URLSearchParams(new TextDecoder('utf-8', { fatal: true }).decode(data));
  for (const name of new Set(form.keys()))
    if (form.getAll(name).length !== 1) throw new Error('Invalid form.');
  return form;
}
function errorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : '';
}

/** Email credentials establish identity only. The commerce API separately enforces protected membership. */
export async function handlePasswordForm(
  request: Request,
  dependencies: PasswordRouteDependencies,
): Promise<Response> {
  const origin = passwordRequestOrigin(request, dependencies);
  if (origin instanceof Response) return origin;
  let action = 'signin';
  let next = '/admin/dashboard';
  const feedback = (key: 'auth_error' | 'auth_notice', code: string) =>
    redirect(origin, '/admin/login', { [key]: code, next, auth_action: action });
  let form: URLSearchParams;
  try {
    form = await boundedPasswordForm(request);
  } catch {
    return feedback('auth_error', 'invalid_request');
  }
  try {
    const chosen = form.get('action');
    if (!['signin', 'signup', 'reset'].includes(chosen ?? ''))
      return feedback('auth_error', 'invalid_request');
    action = chosen!;
    if (dependencies.signInOnly && action !== 'signin')
      return feedback('auth_error', 'email_flow_disabled');
    const destination = safeAuthNext(form.get('next'));
    if (authLoginPath(destination) === '/admin/login' && destination.startsWith('/admin/'))
      next = destination;
    const recoveryEnabled =
      dependencies.recoveryEnabled ?? process.env.NEXT_PUBLIC_PASSWORD_RECOVERY_ENABLED === 'true';
    if (action === 'reset' && !recoveryEnabled) return feedback('auth_error', 'recovery_not_ready');
    const email = form.get('email')?.trim().toLowerCase() ?? '';
    if (!emailSchema.safeParse(email).success) return feedback('auth_error', 'invalid_request');
    if (action === 'signin' && email !== (dependencies.adminLoginId ?? ADMIN_LOGIN_ID))
      return feedback('auth_error', 'invalid_credentials');
    const password = form.get('password') ?? '';
    if (
      action === 'signin' &&
      (password.length < 1 || password.length > 128 || !/\S/.test(password))
    )
      return feedback('auth_error', 'invalid_request');
    if (
      action === 'signup' &&
      (!validNewPassword(password) || form.get('confirmPassword') !== password)
    )
      return feedback('auth_error', 'invalid_request');
    const client = await dependencies.createClient();
    if (action === 'signin') {
      const result = await client.auth.signInWithPassword({ email, password });
      if (result.error)
        return feedback(
          'auth_error',
          errorCode(result.error) === 'email_not_confirmed'
            ? 'password_confirmation_required'
            : 'invalid_credentials',
        );
      const verified = await client.auth.getUser();
      if (
        verified.error ||
        !verified.data.user ||
        !result.data.user ||
        verified.data.user.id !== result.data.user.id
      )
        return feedback('auth_error', 'invalid_credentials');
      if (!verified.data.user.email_confirmed_at)
        return feedback('auth_error', 'password_confirmation_required');
      await dependencies.onVerifiedSignIn?.();
      return redirect(origin, next, {});
    }
    const callback = new URL('/auth/callback', origin);
    callback.searchParams.set('next', action === 'reset' ? '/auth/reset-password' : next);
    if (action === 'reset') {
      const result = await client.auth.resetPasswordForEmail(email, {
        redirectTo: callback.toString(),
      });
      if (result.error && !['user_not_found', 'email_not_found'].includes(errorCode(result.error)))
        return feedback('auth_error', 'auth_unavailable');
      return feedback('auth_notice', 'password_reset_sent');
    }
    const result = await client.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: callback.toString() },
    });
    if (result.error && !['user_already_exists', 'email_exists'].includes(errorCode(result.error)))
      return feedback('auth_error', 'auth_unavailable');
    // Owner access must follow inbox confirmation. Never retain an auto-confirm signup session.
    if (result.data.session) {
      const signedOut = await client.auth.signOut({ scope: 'local' });
      if (signedOut.error) return feedback('auth_error', 'auth_unavailable');
    }
    return feedback('auth_notice', 'signup_confirmation_sent');
  } catch {
    return feedback('auth_error', 'auth_unavailable');
  }
}

/** A normal sign-in session cannot use this endpoint; a fresh, verified recovery AMR is required. */
export async function handlePasswordUpdate(
  request: Request,
  dependencies: PasswordRouteDependencies,
): Promise<Response> {
  const origin = passwordRequestOrigin(request, dependencies);
  if (origin instanceof Response) return origin;
  const failure = (code: string) => redirect(origin, '/auth/reset-password', { auth_error: code });
  let form: URLSearchParams;
  try {
    form = await boundedPasswordForm(request);
  } catch {
    return failure('password_requirements');
  }
  try {
    const password = form.get('password');
    if (!validNewPassword(password)) return failure('password_requirements');
    if (form.get('confirmPassword') !== password) return failure('password_mismatch');
    const client = await dependencies.createClient();
    if (!(await verifiedRecoveryUser(client, (dependencies.now ?? Date.now)())))
      return failure('recovery_expired');
    const result = await client.auth.updateUser({ password });
    if (result.error) return failure('password_update_failed');
    // Revoke refresh sessions after changing a credential; no tokens are included in the redirect.
    try {
      await client.auth.signOut({ scope: 'global' });
    } catch {
      /* The password update already succeeded. */
    }
    return redirect(origin, '/admin/login', { auth_notice: 'password_updated' });
  } catch {
    return failure('password_update_failed');
  }
}
