import type { SupabaseClient } from '@supabase/supabase-js';
import { authLoginPath, getRequestOrigin, safeAuthNext } from './google';
import { hasRecentRecoveryClaims, passwordResponseHeaders } from './password';

export type AuthCallbackClient = {
  auth: Pick<SupabaseClient['auth'], 'exchangeCodeForSession' | 'getUser' | 'getClaims'>;
};
export type AuthCallbackDependencies = {
  createClient: () => Promise<AuthCallbackClient>;
  origin?: (request: Request) => string;
  now?: () => number;
  onFailure?: (reason: AuthCallbackFailure) => void;
  onVerifiedSignIn?: () => void | Promise<void>;
};
export type AuthCallbackFailure =
  | 'invalid_origin'
  | 'provider_error'
  | 'missing_code'
  | 'missing_verifier'
  | 'exchange_rejected'
  | 'identity_rejected'
  | 'recovery_type_rejected'
  | 'recovery_claims_rejected'
  | 'unexpected_failure';

function redirect(url: URL) {
  return new Response(null, {
    status: 303,
    headers: { ...passwordResponseHeaders, Location: url.toString() },
  });
}

/** Exchange a browser-bound PKCE code, then verify the resulting identity before redirecting. */
export async function handleAuthCallback(
  request: Request,
  dependencies: AuthCallbackDependencies,
): Promise<Response> {
  const report = (reason: AuthCallbackFailure) => {
    try {
      dependencies.onFailure?.(reason);
    } catch {
      // Diagnostics must not affect authentication or expose provider payloads.
    }
  };
  let origin: string;
  try {
    origin = (dependencies.origin ?? getRequestOrigin)(request);
  } catch {
    report('invalid_origin');
    return Response.json(
      { error: 'Invalid application origin.' },
      { status: 400, headers: passwordResponseHeaders },
    );
  }
  const parameters = new URL(request.url).searchParams;
  const next = safeAuthNext(parameters.get('next'));
  const failure = (code: string, reason: AuthCallbackFailure) => {
    report(reason);
    const url = new URL(authLoginPath(next), origin);
    const recovery = next === '/auth/reset-password';
    url.searchParams.set('auth_error', recovery ? 'recovery_expired' : code);
    url.searchParams.set('next', next);
    // Keep recovery failures in the email form, even when an older Google session is present.
    if (recovery) url.searchParams.set('auth_action', 'reset');
    return redirect(url);
  };
  if (parameters.has('error'))
    return failure(
      parameters.get('error') === 'access_denied' ? 'access_denied' : 'callback_failed',
      'provider_error',
    );
  const code = parameters.get('code');
  if (!code || code.length > 2048) return failure('callback_failed', 'missing_code');

  try {
    const client = await dependencies.createClient();
    const flowId = parameters.get('sb_flow_id');
    const { data: exchanged, error } = await client.auth.exchangeCodeForSession(
      code,
      flowId ? { flowId } : undefined,
    );
    if (error)
      return failure(
        'callback_failed',
        error.name === 'AuthPKCECodeVerifierMissingError'
          ? 'missing_verifier'
          : 'exchange_rejected',
      );
    // Establish identity through Supabase Auth, never an unverified cookie user or social role metadata.
    const { data, error: verificationError } = await client.auth.getUser();
    if (verificationError || !data.user) return failure('callback_failed', 'identity_rejected');
    if (next === '/auth/reset-password') {
      if (
        !('redirectType' in exchanged) ||
        exchanged.redirectType !== 'recovery' ||
        !data.user.email_confirmed_at
      )
        return failure('callback_failed', 'recovery_type_rejected');
      const claims = await client.auth.getClaims();
      if (
        claims.error ||
        !hasRecentRecoveryClaims(
          claims.data?.claims,
          data.user.id,
          (dependencies.now ?? Date.now)(),
        )
      )
        return failure('callback_failed', 'recovery_claims_rejected');
    }
    await dependencies.onVerifiedSignIn?.();
    return redirect(new URL(next, origin));
  } catch {
    return failure('callback_failed', 'unexpected_failure');
  }
}
