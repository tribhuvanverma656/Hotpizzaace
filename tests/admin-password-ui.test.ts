import assert from 'node:assert/strict';
import test from 'node:test';
import {
  passwordAuthFeedback,
  passwordActionForIntent,
  safePasswordAction,
  shouldRedirectAdminLogin,
} from '../components/admin/password-auth-feedback';
import { handlePasswordForm, type PasswordClient } from '../lib/auth/password';

test('password form action modes accept only supported local operations', () => {
  assert.equal(safePasswordAction('signin'), 'signin');
  assert.equal(safePasswordAction('signup'), 'signup');
  assert.equal(safePasswordAction('reset'), 'reset');
  for (const input of [undefined, null, {}, 'delete', '//attacker.example', '<script>'])
    assert.equal(safePasswordAction(input), 'signin');
});

test('owner setup and forgot-password intents request inbox recovery without a new password or signup', async () => {
  const origin = 'http://localhost:3001';
  for (const intent of ['setup', 'forgot'] as const) {
    const calls: string[] = [];
    const client = {
      auth: {
        resetPasswordForEmail: async (email: string, options: { redirectTo: string }) => {
          calls.push('resetPasswordForEmail');
          assert.equal(email, 'owner@example.com');
          assert.equal(
            new URL(options.redirectTo).searchParams.get('next'),
            '/auth/reset-password',
          );
          return { data: {}, error: null };
        },
        signUp: async () => {
          calls.push('signUp');
          throw new Error('Existing Google setup must not register another account.');
        },
      },
    } as unknown as PasswordClient;
    const action = passwordActionForIntent(intent);
    assert.equal(action, 'reset');
    const request = new Request(`${origin}/api/auth/password`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ action, email: 'owner@example.com', next: '/admin/dashboard' }),
    });
    const response = await handlePasswordForm(request, {
      createClient: async () => client,
      origin: () => origin,
      recoveryEnabled: true,
    });
    assert.equal(response.status, 303);
    const destination = new URL(response.headers.get('location')!);
    assert.equal(destination.searchParams.get('auth_action'), 'reset');
    assert.equal(destination.searchParams.get('auth_notice'), 'password_reset_sent');
    assert.deepEqual(calls, ['resetPasswordForEmail']);
  }
  assert.equal(passwordActionForIntent('signin'), 'signin');
  assert.equal(
    safePasswordAction('signup'),
    'signup',
    'Explicit initial registration remains supported.',
  );
});

test('an authenticated owner returns to the dashboard even from obsolete recovery queries', () => {
  const recoveryAction = new URL(
    'https://pizza.example/admin/login?auth_action=reset',
  ).searchParams.get('auth_action');
  assert.equal(shouldRedirectAdminLogin(true, true, recoveryAction), true);
  for (const action of [
    undefined,
    null,
    'signin',
    'signup',
    '',
    'RESET',
    '__proto__',
    '//attacker.example',
  ])
    assert.equal(shouldRedirectAdminLogin(true, true, action), true);
  for (const action of [null, 'signin', 'reset']) {
    assert.equal(shouldRedirectAdminLogin(false, true, action), false);
    assert.equal(shouldRedirectAdminLogin(true, false, action), false);
    assert.equal(shouldRedirectAdminLogin(false, false, action), false);
  }
});

test('password notices do not disclose whether an email account exists', () => {
  const signup = passwordAuthFeedback(null, 'signup_confirmation_sent');
  const reset = passwordAuthFeedback(null, 'password_reset_sent');
  assert.match(signup.notice, /If this email can be registered/);
  assert.match(reset.notice, /If this email is eligible/);
  assert.equal(signup.error, '');
  assert.equal(reset.error, '');
});

test('password feedback never echoes arbitrary provider or query payloads', () => {
  for (const value of [
    'PRIVATE_AUTH_TOKEN@example.com',
    '<img src=x onerror=alert(1)>',
    '__proto__',
    'constructor',
  ]) {
    const feedback = passwordAuthFeedback(value, value);
    assert.equal(feedback.notice, '');
    assert.match(feedback.error, /couldn’t complete/);
    assert.ok(!feedback.error.includes(value));
  }
  assert.match(
    passwordAuthFeedback('invalid_credentials', null).error,
    /Check the admin user ID and password/,
  );
  assert.match(
    passwordAuthFeedback('password_confirmation_required', null).error,
    /Confirm your email/,
  );
  assert.match(passwordAuthFeedback('invalid_request', null).error, /12–128/);
  assert.match(passwordAuthFeedback('recovery_expired', null).error, /expired or was already used/);
  assert.match(passwordAuthFeedback('recovery_expired', null).error, /newest email/);
  assert.deepEqual(passwordAuthFeedback(null, null), { error: '', notice: '' });
});
