export type AdminPasswordAction = 'signin' | 'signup' | 'reset';

export function safePasswordAction(value: unknown): AdminPasswordAction {
  return value === 'signup' || value === 'reset' ? value : 'signin';
}

/** Existing Google accounts set a password through inbox recovery, not a second signup. */
export function passwordActionForIntent(
  intent: 'signin' | 'setup' | 'forgot',
): AdminPasswordAction {
  return intent === 'signin' ? 'signin' : 'reset';
}

/** Obsolete email-setup queries do not keep an authenticated owner on the sign-in page. */
export function shouldRedirectAdminLogin(
  ready: boolean,
  admin: boolean,
  _action?: unknown,
): boolean {
  void _action;
  return ready && admin;
}

/** Only finite application codes become UI text; provider payloads and account existence stay private. */
export function passwordAuthFeedback(error: string | null, notice: string | null) {
  const errors: Record<string, string> = {
    invalid_credentials:
      'We couldn’t sign you in. Check the admin user ID and password, or continue with Google.',
    email_flow_disabled:
      'Email password setup and recovery are currently unavailable. Continue with Google.',
    password_confirmation_required:
      'Confirm your email before signing in. Check your inbox and spam folder.',
    invalid_request:
      'Check your email and password details. A new password must contain 12–128 characters.',
    auth_unavailable: 'Sign-in is temporarily unavailable. Please try again.',
    recovery_not_ready: 'Password email setup is pending. Continue with Google for now.',
    recovery_expired:
      'This password setup link has expired or was already used. Request a new link and open the newest email.',
  };
  const notices: Record<string, string> = {
    signup_confirmation_sent:
      'If this email can be registered, you’ll receive confirmation instructions. Confirm your email before signing in.',
    password_reset_sent:
      'If this email is eligible, you’ll receive a private link to set or reset your password. Check your inbox and spam folder.',
    password_updated: 'Your password was updated. Sign in to continue.',
  };
  return {
    error: error
      ? Object.hasOwn(errors, error)
        ? errors[error]
        : 'We couldn’t complete this sign-in request. Please try again.'
      : '',
    notice: notice && Object.hasOwn(notices, notice) ? notices[notice] : '',
  };
}
