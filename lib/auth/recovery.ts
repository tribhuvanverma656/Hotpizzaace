import type { SupabaseClient } from '@supabase/supabase-js';
import { getRequestOrigin } from './google';
import { passwordResponseHeaders, validNewPassword } from './password';
import { validRecoveryTokenHash } from './recovery-token';

export { validRecoveryTokenHash } from './recovery-token';

export type RecoveryClient = {
  auth: Pick<
    SupabaseClient['auth'],
    'verifyOtp' | 'getUser' | 'getClaims' | 'updateUser' | 'signOut'
  >;
};
export type RecoveryDependencies = {
  createClient: () => Promise<RecoveryClient>;
  origin?: (request: Request) => string;
  now?: () => number;
};
const FORM_LIMIT = 8192;

function failure(error: string, status: number) {
  return Response.json(
    { ok: false, error },
    {
      status,
      headers: { ...passwordResponseHeaders, ...(status === 405 ? { Allow: 'POST' } : {}) },
    },
  );
}

async function readForm(request: Request): Promise<URLSearchParams | null> {
  if (
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !==
      'application/x-www-form-urlencoded' ||
    Number(request.headers.get('content-length')) > FORM_LIMIT
  )
    return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > FORM_LIMIT) {
        await reader.cancel();
        return null;
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
  if (
    form.size !== 4 ||
    !['token_hash', 'type', 'password', 'confirmPassword'].every(
      (name) => form.getAll(name).length === 1,
    ) ||
    form.get('type') !== 'recovery'
  )
    return null;
  return form;
}

function invalidToken(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const value = error as { code?: unknown; status?: unknown };
  return (
    ['otp_expired', 'invalid_token', 'token_expired', 'user_not_found'].includes(
      typeof value.code === 'string' ? value.code : '',
    ) || [400, 401, 403, 404, 410, 422].includes(Number(value.status))
  );
}

/** OTP is accepted only after a fresh recovery-token verification in this same request. */
function freshEmailProof(claims: unknown, userId: string, now: number) {
  if (!claims || typeof claims !== 'object') return false;
  const value = claims as Record<string, unknown>;
  if (value.sub !== userId || !Array.isArray(value.amr)) return false;
  const nowSeconds = Math.floor(now / 1000);
  return value.amr.some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const proof = entry as Record<string, unknown>;
    return (
      (proof.method === 'otp' || proof.method === 'recovery') &&
      Number.isSafeInteger(proof.timestamp) &&
      Number(proof.timestamp) >= nowSeconds - 900 &&
      Number(proof.timestamp) <= nowSeconds + 60
    );
  });
}

/** Verify the email token and change the password together, without a prior PKCE cookie. */
export async function handleRecoveryConfirmation(
  request: Request,
  dependencies: RecoveryDependencies,
): Promise<Response> {
  if (request.method !== 'POST') return failure('method_not_allowed', 405);
  let origin: string;
  try {
    origin = (dependencies.origin ?? getRequestOrigin)(request);
  } catch {
    return failure('invalid_origin', 400);
  }
  const fetchSite = request.headers.get('sec-fetch-site');
  if (
    request.headers.get('origin') !== origin ||
    (fetchSite !== null && fetchSite !== 'same-origin')
  )
    return failure('invalid_origin', 403);

  let form: URLSearchParams | null;
  try {
    form = await readForm(request);
  } catch {
    return failure('invalid_request', 400);
  }
  if (!form || !validRecoveryTokenHash(form.get('token_hash')))
    return failure('invalid_request', 400);
  const password = form.get('password');
  if (!validNewPassword(password)) return failure('password_requirements', 400);
  if (form.get('confirmPassword') !== password) return failure('password_mismatch', 400);

  let stage: 'verify' | 'update' = 'verify';
  try {
    const client = await dependencies.createClient();
    const result = await client.auth.verifyOtp({
      token_hash: form.get('token_hash')!,
      type: 'recovery',
    });
    if (result.error)
      return invalidToken(result.error)
        ? failure('recovery_expired', 410)
        : failure('auth_unavailable', 503);
    if (
      !result.data.session?.access_token ||
      !result.data.user ||
      result.data.session.user?.id !== result.data.user.id
    )
      return failure('recovery_expired', 410);
    // Verify the exact newly issued token, never a pre-existing Google/OTP cookie session.
    const token = result.data.session.access_token;
    const verified = await client.auth.getUser(token);
    if (verified.error) return failure('auth_unavailable', 503);
    if (!verified.data.user?.email_confirmed_at || verified.data.user.id !== result.data.user.id)
      return failure('recovery_expired', 410);
    const claims = await client.auth.getClaims(token);
    if (claims.error) return failure('auth_unavailable', 503);
    if (
      !freshEmailProof(claims.data?.claims, verified.data.user.id, (dependencies.now ?? Date.now)())
    )
      return failure('recovery_expired', 410);
    stage = 'update';
    const updated = await client.auth.updateUser({ password });
    if (updated.error) return failure('password_update_failed', 503);
    // The update is committed. Sign-out failure must not claim the new password was rejected.
    try {
      await client.auth.signOut({ scope: 'global' });
    } catch {
      /* A subsequent sign-in still requires the password that was just saved. */
    }
    return Response.json(
      { ok: true, signInPath: '/admin/login?auth_notice=password_updated' },
      { headers: passwordResponseHeaders },
    );
  } catch {
    return failure(stage === 'update' ? 'password_update_failed' : 'auth_unavailable', 503);
  }
}
