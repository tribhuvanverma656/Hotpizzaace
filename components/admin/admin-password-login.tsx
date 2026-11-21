'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, KeyRound } from 'lucide-react';
import { safeAdminNext } from '@/lib/auth/google';
import { passwordAuthFeedback } from './password-auth-feedback';
import styles from './admin-password-login.module.css';

export function AdminPasswordLogin({
  disabled,
  onStarting,
  next = '/admin/dashboard',
}: {
  disabled: boolean;
  onStarting: () => void;
  next?: string;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const code = query.get('auth_error');
    const retiredEmailFlow = code === 'recovery_not_ready' || code === 'recovery_expired';
    const feedback = passwordAuthFeedback(
      code && ['access_denied', 'provider_unavailable', 'callback_failed'].includes(code)
        ? null
        : retiredEmailFlow
          ? 'email_flow_disabled'
          : code,
      query.get('auth_notice') === 'password_updated' ? 'password_updated' : null,
    );
    setError(feedback.error);
    setNotice(feedback.notice);
    const reset = () => {
      setSubmitting(false);
      setPassword('');
    };
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);
  return (
    <section className={styles.section} aria-labelledby="admin-password-heading">
      <div className={styles.divider}>
        <span>or use your password</span>
      </div>
      <h2 id="admin-password-heading" className={styles.title}>
        Sign in with your user ID
      </h2>
      <p className={styles.description}>
        Use your owner password. To set or change it, sign in with Google and open Restaurant
        settings.
      </p>
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      <form
        action="/api/auth/password"
        method="post"
        className="admin-form"
        onSubmit={(event) => {
          if (disabled || submitting) {
            event.preventDefault();
            return;
          }
          setError('');
          setSubmitting(true);
          onStarting();
        }}
      >
        <input type="hidden" name="action" value="signin" />
        <input type="hidden" name="next" value={safeAdminNext(next)} />
        <label className="field" htmlFor="admin-user-id">
          Email address
          <input
            id="admin-user-id"
            name="email"
            type="email"
            autoComplete="username"
            required
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Enter your email address"
          />
        </label>
        <label className="field" htmlFor="admin-password">
          Password
          <input
            id="admin-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            minLength={1}
            maxLength={128}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button className="btn btn-dark" type="submit" disabled={disabled || submitting}>
          <KeyRound size={17} />
          {submitting ? 'Please wait…' : 'Sign in with password'}
          <ArrowRight size={17} />
        </button>
      </form>
    </section>
  );
}
