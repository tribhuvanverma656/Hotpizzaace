export class KitchenApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(kitchenErrorMessage(code));
    this.name = 'KitchenApiError';
  }
}
const messages: Record<string, string> = {
  kitchen_disabled: 'Kitchen staff access is not enabled for this restaurant yet.',
  invalid_credentials: 'The username or password is incorrect, or this account is unavailable.',
  invalid_request: 'Check the details and try again.',
  version_conflict:
    'This record changed. Refresh and review the latest details before trying again.',
  username_taken: 'That username is already assigned. Choose another username.',
  username_unavailable: 'That username is unavailable. Choose another username.',
  invalid_username:
    'Use 3–32 letters, digits, dots, underscores or hyphens, beginning with a letter.',
  password_requirements: 'Use a password between 12 and 128 characters.',
  password_mismatch: 'The new passwords do not match.',
  owner_reauth_required: 'Enter your current owner password again to confirm this change.',
  kitchen_operation_pending:
    'A previous credential change is still pending. Wait 15 minutes, refresh, then retry the password reset.',
  reauth_required: 'Enter your current owner password again to confirm this change.',
  branch_not_found: 'That branch is no longer available. Refresh the staff list.',
  staff_reset_failed:
    'The password reset was not completed. This account remains blocked. Refresh and retry the reset.',
  staff_provisioning_failed:
    'This account is not ready to sign in. Refresh the list and review its state.',
  rate_limited: 'Too many attempts. Wait a moment, then try again.',
  forbidden: 'This session cannot perform that action. Sign in again.',
  session_revoked: 'Your kitchen session has ended. Sign in again.',
  session_expired: 'Your kitchen session has ended. Sign in again.',
  auth_required: 'Sign in again to continue.',
};
export function kitchenErrorMessage(code: string): string {
  return messages[code] ?? 'The request could not be confirmed. Refresh before trying again.';
}
export const kitchenAccessEnded = (cause: unknown) =>
  cause instanceof KitchenApiError && (cause.status === 401 || cause.status === 403);

/** Kitchen cookies stay under /kitchen; no Supabase browser client or browser storage. */
export async function kitchenRequest<T>(
  path: string,
  options: { method?: 'GET' | 'POST' | 'PATCH'; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  return privateRequest<T>(`/kitchen/api/${path}`, options);
}
export async function privateRequest<T>(
  path: string,
  options: { method?: 'GET' | 'POST' | 'PATCH'; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (options.signal?.aborted) cancel();
  else options.signal?.addEventListener('abort', cancel, { once: true });
  const deadline = setTimeout(cancel, 20_000);
  try {
    const response = await fetch(path, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: controller.signal,
    });
    const result: unknown = await response.json().catch(() => null);
    controller.signal.throwIfAborted();
    if (!response.ok) {
      const value = result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
      const candidate = typeof value.code === 'string' ? value.code : value.error;
      const code =
        typeof candidate === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(candidate)
          ? candidate
          : response.status === 429
            ? 'rate_limited'
            : 'request_failed';
      throw new KitchenApiError(response.status, code);
    }
    if (!result || typeof result !== 'object') throw new KitchenApiError(502, 'invalid_response');
    return result as T;
  } finally {
    clearTimeout(deadline);
    options.signal?.removeEventListener('abort', cancel);
  }
}
