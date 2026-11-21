'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, KeyRound, ShieldCheck } from 'lucide-react';
import { ADMIN_LOGIN_ID } from '@/lib/auth/admin-account';
import { useCustomerAuth } from '@/components/customer-auth-provider';

type PasswordStatus = 'checking' | 'ready' | 'reauth_required' | 'forbidden' | 'auth_unavailable';
const signInPath = '/admin/login?auth_notice=password_updated';

function statusFromError(code: unknown): Exclude<PasswordStatus, 'checking' | 'ready'> {
  return code === 'reauth_required' || code === 'forbidden' ? code : 'auth_unavailable';
}

function errorMessage(code: unknown): string {
  const messages: Record<string, string> = {
    invalid_request: 'Check your password details and try again.',
    password_requirements: 'Choose a password between 12 and 128 characters.',
    password_mismatch: 'The passwords do not match. Enter them again.',
    reauth_required: 'Confirm your identity with Google to set or change your password.',
    forbidden:
      'Only the restaurant owner can change this password. Use the owner’s Google account.',
    password_update_failed: 'We couldn’t save your password. Please try again.',
    auth_unavailable: 'Password settings are temporarily unavailable. Please try again.',
  };
  return typeof code === 'string' && Object.hasOwn(messages, code)
    ? messages[code]
    : messages.auth_unavailable;
}

export function OwnerPasswordSettings() {
  const auth = useCustomerAuth();
  const router = useRouter();
  const [status, setStatus] = useState<PasswordStatus>('checking');
  const [verifiedUserId, setVerifiedUserId] = useState<string | undefined>();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [startingGoogle, setStartingGoogle] = useState(false);
  const savingRef = useRef(false);
  const userId = auth.user?.id;
  const ready = status === 'ready' && verifiedUserId === userId;

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    setStatus('checking');
    setPassword('');
    setConfirmPassword('');
    setError('');
    void (async () => {
      try {
        const response = await fetch('/api/auth/owner-password', {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        const result = await response.json();
        if (!active) return;
        if (
          response.ok &&
          result?.ok === true &&
          result.ready === true &&
          result.loginId === ADMIN_LOGIN_ID
        ) {
          setVerifiedUserId(userId);
          setStatus('ready');
        } else setStatus(statusFromError(result?.error));
      } catch {
        if (active) setStatus('auth_unavailable');
      } finally {
        window.clearTimeout(timeout);
      }
    })();
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [userId]);

  useEffect(() => {
    const clear = () => {
      setPassword('');
      setConfirmPassword('');
      setStartingGoogle(false);
    };
    window.addEventListener('pageshow', clear);
    return () => window.removeEventListener('pageshow', clear);
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready || savingRef.current || startingGoogle || saved) return;
    if (password.length < 12 || password.length > 128 || !/\S/.test(password)) {
      setError(errorMessage('password_requirements'));
      return;
    }
    if (password !== confirmPassword) {
      setError(errorMessage('password_mismatch'));
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError('');
    const body = new URLSearchParams({ password, confirmPassword });
    setPassword('');
    setConfirmPassword('');
    try {
      const response = await fetch('/api/auth/owner-password', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
        signal: AbortSignal.timeout(15000),
      });
      const result = await response.json();
      if (response.ok && result?.ok === true && result.signInPath === signInPath) {
        setSaved(true);
        // The password is already saved; a display refresh cannot change that result.
        await auth.refresh().catch(() => {});
        router.replace(signInPath);
        router.refresh();
        return;
      }
      if (result?.error === 'reauth_required' || result?.error === 'forbidden') {
        setStatus(result.error);
        setError('');
      } else setError(errorMessage(result?.error));
    } catch {
      setError(errorMessage('auth_unavailable'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <section
      className="admin-card"
      aria-labelledby="owner-password-heading"
      style={{ marginBottom: 24 }}
    >
      <div className="admin-card-heading">
        <h2 id="owner-password-heading">
          <ShieldCheck size={18} /> Owner password
        </h2>
      </div>
      <div className="admin-card-padding admin-form">
        <p className="muted" style={{ margin: 0 }}>
          Admin user ID: <strong>{ADMIN_LOGIN_ID}</strong>
        </p>
        <p className="admin-inline-note" style={{ margin: 0 }}>
          Set or change your owner password after confirming your identity with Google. Saving signs
          you out; then sign in with your user ID and new password, or Google.
        </p>
        <form
          action="/api/auth/google"
          method="post"
          onSubmit={(event) => {
            if (savingRef.current || startingGoogle || saved) {
              event.preventDefault();
              return;
            }
            setPassword('');
            setConfirmPassword('');
            setStartingGoogle(true);
          }}
        >
          <input type="hidden" name="next" value="/admin/settings" />
          <button
            className="btn btn-outline"
            type="submit"
            disabled={saving || startingGoogle || saved}
          >
            {startingGoogle ? 'Opening Google…' : 'Confirm identity with Google'}
            <ArrowRight size={17} />
          </button>
        </form>
        {status === 'checking' && <p role="status">Checking owner password access…</p>}
        {status !== 'checking' && status !== 'ready' && (
          <p role="status" className="admin-inline-note" style={{ margin: 0 }}>
            {errorMessage(status)}
          </p>
        )}
        {saved ? (
          <p role="status">Your password was updated. Opening sign in…</p>
        ) : ready ? (
          <form
            action="/api/auth/owner-password"
            method="post"
            className="admin-form"
            onSubmit={submit}
          >
            <div className="form-grid">
              <label className="field" htmlFor="owner-new-password">
                New owner password
                <input
                  id="owner-new-password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={128}
                  value={password}
                  disabled={saving || startingGoogle}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <label className="field" htmlFor="owner-confirm-password">
                Confirm new password
                <input
                  id="owner-confirm-password"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={128}
                  value={confirmPassword}
                  disabled={saving || startingGoogle}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              </label>
            </div>
            <small className="muted">
              Use 12–128 characters and a password you don’t use elsewhere.
            </small>
            <button className="btn btn-dark" type="submit" disabled={saving || startingGoogle}>
              <KeyRound size={17} /> {saving ? 'Saving password…' : 'Save owner password'}
            </button>
          </form>
        ) : null}
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
