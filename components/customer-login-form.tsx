'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ShieldCheck,
  Smartphone,
  UserRound,
} from 'lucide-react';
import { toast } from 'sonner';
import { useCustomerAuth } from '@/components/customer-auth-provider';
import { useSharedCommerce } from '@/components/shared-commerce-provider';
import { getAuthFailureMessage, safeCustomerNext } from '@/lib/auth/google';
import { useDemoStore } from '@/lib/store';
import { normalizeCustomerPhone } from '@/lib/customer-auth';
import { GoogleSignInButton, GoogleSignInLegal } from '@/components/auth/google-sign-in-button';

export function CustomerLoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeCustomerNext(params.get('next'));
  const demoNext = next === '/account/profile' ? '/account/orders' : next;
  const auth = useCustomerAuth();
  const shared = useSharedCommerce();
  const hydrated = useDemoStore((state) => state.hydrated);
  const session = useDemoStore((state) => state.customerSession);
  const loginCustomer = useDemoStore((state) => state.loginCustomer);
  const logoutCustomer = useDemoStore((state) => state.logoutCustomer);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  const authFailure = getAuthFailureMessage(params.get('auth_error'));

  useEffect(() => {
    // A full-page OAuth redirect can return through the browser's back-forward cache.
    const resetConnecting = () => setConnecting(false);
    window.addEventListener('pageshow', resetConnecting);
    return () => window.removeEventListener('pageshow', resetConnecting);
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (step === 'phone') {
      try {
        setPhone(normalizeCustomerPhone(phone));
        setCode('');
        setStep('code');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Enter a valid Indian mobile number.');
      }
      return;
    }
    try {
      loginCustomer(phone, code.trim());
      toast.success('Signed in to your demo account');
      router.replace(demoNext);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to sign in. Please try again.');
    }
  }

  async function signOut() {
    setSigningOut(true);
    setSignOutError('');
    try {
      await auth.signOut();
    } catch {
      setSignOutError('Unable to sign out. Please try again.');
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="container customer-login-page">
      <Link className="back-link" href="/menu">
        <ArrowLeft size={16} /> Back to the menu
      </Link>
      <div className="customer-login-layout">
        <div className="customer-login-intro">
          <span className="eyebrow">WELCOME TO HOT PIZZA ACE</span>
          <h1>
            Good food.
            <br />
            <em>Easy sign-in.</em>
          </h1>
          <p>
            Your next pizza night starts here. Use your Google account and skip creating another
            password.
          </p>
          <div className="customer-login-benefit">
            <span>
              <ShieldCheck size={23} />
            </span>
            <div>
              <strong>A familiar way to sign in</strong>
              <p>Choose your account on Google. We never see your Google password.</p>
            </div>
          </div>
        </div>
        <section className="customer-login-card" aria-labelledby="customer-login-title">
          <div className="customer-login-icon">
            <UserRound size={26} />
          </div>
          {auth.user ? (
            <>
              <span className="customer-account-status">
                <Check size={14} /> Signed in with Google
              </span>
              <h2 id="customer-login-title">
                Welcome{auth.user.name ? `, ${auth.user.name.split(' ')[0]}` : ' back'}.
              </h2>
              <div className="customer-signed-in-profile">
                <span className="customer-profile-avatar" aria-hidden="true">
                  {(auth.user.name || auth.user.email || 'P').charAt(0).toUpperCase()}
                </span>
                <div>
                  <strong>{auth.user.name || 'Your Google account'}</strong>
                  {auth.user.email && <span>{auth.user.email}</span>}
                </div>
              </div>
              <Link className="btn btn-primary customer-account-continue" href={next}>
                {next === '/checkout' ? 'Continue to checkout' : 'Continue to my account'}{' '}
                <ArrowRight size={17} />
              </Link>
              {next !== '/account/profile' && (
                <Link className="customer-profile-link" href="/account/profile">
                  View my profile
                </Link>
              )}
              <button
                className="customer-switch-account"
                type="button"
                onClick={signOut}
                disabled={signingOut}
              >
                {signingOut ? 'Signing out…' : 'Sign out of Google account'}
              </button>
              {signOutError && (
                <p className="error-message" role="alert">
                  {signOutError}
                </p>
              )}
            </>
          ) : (
            <>
              <h2 id="customer-login-title">Make yourself at home.</h2>
              <p className="customer-login-description">
                Sign in or create an account in one simple step.
              </p>
              {(authFailure || auth.error) && (
                <p className="error-message customer-google-error" role="alert">
                  {authFailure || auth.error}
                </p>
              )}
              <form
                method="post"
                action="/api/auth/google"
                className="customer-google-form"
                onSubmit={() => setConnecting(true)}
              >
                <input type="hidden" name="next" value={next} />
                <GoogleSignInButton
                  type="submit"
                  disabled={connecting || auth.loading}
                  aria-busy={connecting || auth.loading}
                >
                  {connecting
                    ? 'Connecting to Google…'
                    : auth.loading
                      ? 'Checking your sign-in…'
                      : 'Continue with Google'}
                </GoogleSignInButton>
              </form>
              <GoogleSignInLegal />
            </>
          )}

          {!auth.user && !shared.enabled && (
            <details className="customer-mobile-demo">
              <summary>
                <Smartphone size={16} />
                <span>Try mobile demo sign-in</span>
                <ChevronDown size={16} />
              </summary>
              <div className="customer-mobile-demo-content">
                <p className="customer-demo-explanation">
                  A preview only: no SMS is sent and the demo code does not verify your identity.
                </p>
                {!hydrated ? (
                  <p role="status">Opening the mobile demo…</p>
                ) : session ? (
                  <div className="customer-demo-session">
                    <strong>Mobile demo is already open</strong>
                    <p>Number ending in {session.phone.slice(-4)}</p>
                    <Link className="btn btn-outline" href={demoNext}>
                      Continue to demo account <ArrowRight size={15} />
                    </Link>
                    <button
                      className="customer-switch-account"
                      type="button"
                      onClick={() => {
                        logoutCustomer();
                        setStep('phone');
                        setCode('');
                        setError('');
                      }}
                    >
                      Use another mobile number
                    </button>
                  </div>
                ) : (
                  <>
                    <div
                      className="customer-login-steps"
                      aria-label={`Step ${step === 'phone' ? '1' : '2'} of 2`}
                    >
                      <span className="is-current">
                        {step === 'code' ? <Check size={12} /> : '1'} Mobile
                      </span>
                      <span aria-hidden="true" />
                      <span className={step === 'code' ? 'is-current' : ''}>2 Demo code</span>
                    </div>
                    <form onSubmit={submit} className="customer-login-form">
                      {step === 'phone' ? (
                        <label className="field">
                          Mobile number
                          <input
                            required
                            type="tel"
                            inputMode="tel"
                            autoComplete="tel"
                            placeholder="e.g. 9876543210"
                            maxLength={18}
                            value={phone}
                            onChange={(event) => {
                              setPhone(event.target.value);
                              setError('');
                            }}
                            aria-describedby="customer-mobile-help"
                          />
                          <small id="customer-mobile-help">
                            Indian mobile number · +91 is optional
                          </small>
                        </label>
                      ) : (
                        <>
                          <div className="customer-demo-code" role="note">
                            <span>Use demo code</span>
                            <strong>123456</strong>
                            <small>No SMS is sent. Enter the code shown here.</small>
                          </div>
                          <label className="field">
                            6-digit demo code
                            <input
                              key="demo-code"
                              required
                              type="text"
                              inputMode="numeric"
                              autoComplete="one-time-code"
                              maxLength={6}
                              pattern="[0-9]{6}"
                              placeholder="123456"
                              value={code}
                              onChange={(event) => {
                                setCode(event.target.value.replace(/\D/g, ''));
                                setError('');
                              }}
                              autoFocus
                            />
                          </label>
                        </>
                      )}
                      {error && (
                        <p className="error-message" role="alert">
                          {error}
                        </p>
                      )}
                      <button className="btn btn-primary" type="submit">
                        {step === 'phone' ? 'Continue to demo code' : 'Open demo account'}{' '}
                        <ArrowRight size={17} />
                      </button>
                      {step === 'code' && (
                        <div className="customer-login-secondary">
                          <button
                            type="button"
                            onClick={() => {
                              setStep('phone');
                              setCode('');
                              setError('');
                            }}
                          >
                            Change number
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setCode('');
                              setError('');
                              toast('Your demo code is 123456. No SMS was sent.');
                            }}
                          >
                            Show demo code
                          </button>
                        </div>
                      )}
                    </form>
                  </>
                )}
              </div>
            </details>
          )}
          <p className="customer-login-disclaimer">
            {shared.enabled ? (
              <>
                <strong>Your orders are saved with the restaurant.</strong> Sign in before ordering
                to access them across devices. Online payments remain simulated; existing mobile
                demo orders are separate.
              </>
            ) : (
              <>
                <strong>Ordering is currently a demo.</strong> Orders and delivery addresses are
                saved in this browser only. Google sign-in does not move or link mobile demo orders.
              </>
            )}
          </p>
        </section>
      </div>
    </div>
  );
}
