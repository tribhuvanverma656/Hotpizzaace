'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { useSharedCommerce } from '@/components/shared-commerce-provider';
import { useCustomerAuth } from '@/components/customer-auth-provider';
import { getAuthFailureMessage, safeAdminNext } from '@/lib/auth/google';
import { AdminPasswordLogin } from './admin-password-login';
import { shouldRedirectAdminLogin } from './password-auth-feedback';
import { RestaurantLogo } from '@/components/restaurant-logo';
import { GoogleSignInButton, GoogleSignInLegal } from '@/components/auth/google-sign-in-button';

export function GoogleAdminLogin() {
  const shared = useSharedCommerce();
  const auth = useCustomerAuth();
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [passwordStarting, setPasswordStarting] = useState(false);
  const [error, setError] = useState('');
  const [next, setNext] = useState<string | null>(null);
  const submissionLock = useRef(false);
  useEffect(() => {
    if (next && shouldRedirectAdminLogin(shared.ready, shared.admin)) router.replace(next);
  }, [shared.ready, shared.admin, router, next]);
  useEffect(() => {
    const reset = () => {
      submissionLock.current = false;
      setStarting(false);
      setPasswordStarting(false);
    };
    window.addEventListener('pageshow', reset);
    const parameters = new URLSearchParams(window.location.search);
    setNext(safeAdminNext(parameters.get('next')));
    const code = parameters.get('auth_error');
    setError(
      code && ['access_denied', 'provider_unavailable', 'callback_failed'].includes(code)
        ? getAuthFailureMessage(code)
        : '',
    );
    return () => window.removeEventListener('pageshow', reset);
  }, []);
  // Slow background checks must not prevent the owner from starting a fresh sign-in.
  const busy = !next || starting || passwordStarting;
  return (
    <div className="admin-login-card">
      <Link href="/" className="admin-login-brand restaurant-login-brand">
        <RestaurantLogo variant="login" />
      </Link>
      <span className="badge admin-demo-badge">CONNECTED WORKSPACE</span>
      <h1>
        Your restaurant,
        <br />
        all in one place.
      </h1>
      <p className="muted">
        Manage your restaurant with your owner account. Continue with Google or use your admin user
        ID and password.
      </p>
      {(error || shared.adminError || shared.error || auth.error) && (
        <p className="error-message" role="alert">
          {error || shared.adminError || shared.error || auth.error}
        </p>
      )}
      {auth.user && !busy && shared.ready && !shared.admin ? (
        <div className="admin-login-disclaimer" role="alert">
          <ShieldCheck size={22} />
          <div>
            <strong>This account does not have dashboard access.</strong>
            <p>
              Signed in as {auth.user.email || 'a customer'}. Use an account authorized by the
              restaurant owner.
            </p>
          </div>
        </div>
      ) : null}
      <form
        action="/api/auth/google"
        method="post"
        className="admin-form"
        onSubmit={(event) => {
          if (!next || submissionLock.current) {
            event.preventDefault();
            return;
          }
          submissionLock.current = true;
          setStarting(true);
        }}
      >
        <input type="hidden" name="next" value={next ?? '/admin/dashboard'} />
        <GoogleSignInButton type="submit" disabled={busy} aria-busy={busy}>
          {starting
            ? 'Opening Google…'
            : passwordStarting
              ? 'Please wait…'
              : busy
                ? 'Checking access…'
                : 'Continue with Google'}
        </GoogleSignInButton>
      </form>
      <GoogleSignInLegal />
      <AdminPasswordLogin
        next={next ?? '/admin/dashboard'}
        disabled={busy}
        onStarting={() => {
          submissionLock.current = true;
          setPasswordStarting(true);
        }}
      />
      {auth.user && (
        <button
          className="btn btn-outline"
          onClick={async () => {
            setError('');
            try {
              await auth.signOut();
              await shared.refresh();
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Unable to sign out.');
            }
          }}
        >
          Sign out of this account
        </button>
      )}
      {(shared.adminError || shared.error) && (
        <button className="btn btn-outline" onClick={() => void shared.refresh()}>
          Retry connection
        </button>
      )}
      <div className="admin-login-disclaimer">
        <ShieldCheck size={20} />
        <p>
          Only the authorized owner account can open this workspace. Customer sign-in does not grant
          dashboard access. Payment availability is controlled separately.
        </p>
      </div>
      <Link className="admin-back-link" href="/">
        ← Back to the storefront
      </Link>
    </div>
  );
}
