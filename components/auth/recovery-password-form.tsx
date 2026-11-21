'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { LockKeyhole } from 'lucide-react';
import { readRecoveryFragment } from '@/lib/auth/recovery-token';
import { RestaurantLogo } from '@/components/restaurant-logo';
import { useCustomerAuth } from '@/components/customer-auth-provider';

const messages: Record<string, string> = {
  password_requirements: 'Choose a password between 12 and 128 characters.',
  password_mismatch: 'The passwords do not match. Please enter them again.',
  invalid_request: 'Check your password details and try again.',
  recovery_expired: 'This link has expired or was already used. Request a new password email.',
  auth_unavailable:
    'Your link could not be verified. Request a fresh password email and try again.',
  password_update_failed: 'Your password could not be saved. Request a fresh password email.',
};

export function RecoveryPasswordForm() {
  const router = useRouter();
  const auth = useCustomerAuth();
  const captured = useRef(false);
  const privateToken = useRef<string | null>(null);
  const submitting = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [linkState, setLinkState] = useState<'loading' | 'ready' | 'invalid'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const capture = () => {
      const token = readRecoveryFragment(window.location.hash);
      window.history.replaceState(window.history.state, '', window.location.pathname);
      if (submitting.current) return;
      privateToken.current = token;
      formRef.current?.reset();
      setError('');
      setLinkState(token ? 'ready' : 'invalid');
    };
    if (!captured.current) {
      captured.current = true;
      capture();
    }
    window.addEventListener('hashchange', capture);
    return () => window.removeEventListener('hashchange', capture);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !privateToken.current) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const password = String(values.get('password') ?? '');
    const confirmPassword = String(values.get('confirmPassword') ?? '');
    if (password.length < 12 || password.length > 128 || !/\S/.test(password)) {
      setError(messages.password_requirements);
      return;
    }
    if (password !== confirmPassword) {
      setError(messages.password_mismatch);
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/recovery', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token_hash: privateToken.current,
          type: 'recovery',
          password,
          confirmPassword,
        }),
        signal: AbortSignal.timeout(30000),
      });
      const result = await response.json();
      if (response.ok && result?.ok === true) {
        privateToken.current = null;
        form.reset();
        await auth.refresh();
        router.replace('/admin/login?auth_notice=password_updated');
        router.refresh();
        return;
      }
      const code = typeof result?.error === 'string' ? result.error : '';
      setError(
        Object.hasOwn(messages, code)
          ? messages[code]
          : 'This request could not be completed. Request a fresh password email.',
      );
      if (!['password_requirements', 'password_mismatch', 'invalid_request'].includes(code)) {
        privateToken.current = null;
        form.reset();
        setLinkState('invalid');
      }
    } catch {
      privateToken.current = null;
      form.reset();
      setLinkState('invalid');
      setError(
        'We could not confirm whether your password was saved. Try signing in, or request a fresh password email.',
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <main
      className="page-section container"
      style={{ maxWidth: 560, minHeight: '65vh', paddingTop: 48, paddingBottom: 48 }}
    >
      <section className="card" style={{ padding: 'clamp(24px, 5vw, 40px)' }}>
        <RestaurantLogo variant="login" />
        <LockKeyhole size={28} aria-hidden="true" style={{ marginTop: 24 }} />
        <h1 className="section-title" style={{ marginTop: 20, fontSize: 'clamp(28px, 6vw, 36px)' }}>
          Set your password
        </h1>
        <p className="muted">
          Choose a new password for your Hot Pizza Ace account. This doesn’t change your Gmail
          password.
        </p>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        {linkState === 'loading' && <p role="status">Opening your password link…</p>}
        {linkState === 'invalid' && !error && (
          <p className="error-message" role="alert">
            Reopen the newest password email to continue. If its link has expired, request a new
            email.
          </p>
        )}
        {linkState === 'ready' && (
          <form ref={formRef} onSubmit={submit} className="admin-form" style={{ marginTop: 24 }}>
            <fieldset
              disabled={busy}
              style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 16 }}
            >
              <label className="field" htmlFor="recovery-password">
                New password
                <input
                  id="recovery-password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={128}
                />
              </label>
              <label className="field" htmlFor="recovery-confirm-password">
                Confirm new password
                <input
                  id="recovery-confirm-password"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={128}
                />
              </label>
              <small className="muted">
                Use at least 12 characters. After saving, sign in with your new password.
              </small>
              <button className="btn btn-primary" type="submit" style={{ marginTop: 20 }}>
                {busy ? 'Saving your password…' : 'Save new password'}
              </button>
            </fieldset>
          </form>
        )}
        <noscript>Enable JavaScript to open your private password link.</noscript>
        <Link
          href="/admin/login?auth_action=reset"
          className="admin-back-link"
          style={{ display: 'inline-block', marginTop: 24 }}
          prefetch={false}
        >
          Request a new password email
        </Link>
        <Link
          href="/admin/login"
          className="admin-back-link"
          style={{ display: 'block', marginTop: 16 }}
          prefetch={false}
        >
          Back to restaurant sign in
        </Link>
      </section>
    </main>
  );
}
