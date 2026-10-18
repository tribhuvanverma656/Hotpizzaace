'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, PackageSearch, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { useDemoStore } from '@/lib/store';
import { normalizeCustomerPhone } from '@/lib/customer-auth';

export function CustomerLoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const requestedNext = params.get('next');
  const next = ['/checkout', '/account/addresses'].includes(requestedNext || '')
    ? requestedNext!
    : '/account/orders';
  const hydrated = useDemoStore((state) => state.hydrated);
  const session = useDemoStore((state) => state.customerSession);
  const loginCustomer = useDemoStore((state) => state.loginCustomer);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [error, setError] = useState('');

  useEffect(() => {
    if (hydrated && session) router.replace(next);
  }, [hydrated, session, next, router]);

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
      router.replace(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to sign in. Please try again.');
    }
  }

  if (!hydrated || session)
    return (
      <div className="container empty-state" role="status">
        {session ? 'Opening your account…' : 'Opening customer sign-in…'}
      </div>
    );

  return (
    <div className="container customer-login-page">
      <Link className="back-link" href="/menu">
        <ArrowLeft size={16} /> Back to the menu
      </Link>
      <div className="customer-login-layout">
        <div className="customer-login-intro">
          <span className="eyebrow">YOUR PIZZA, ALL IN ONE PLACE</span>
          <h1>
            Every order.
            <br />
            Every <em>happy box.</em>
          </h1>
          <p>
            Sign in with your mobile number to find your orders, save addresses and check out
            faster.
          </p>
          <div className="customer-login-benefit">
            <span>
              <PackageSearch size={23} />
            </span>
            <div>
              <strong>From our oven to your door</strong>
              <p>Track your orders and reuse your saved delivery addresses.</p>
            </div>
          </div>
        </div>
        <section className="customer-login-card" aria-labelledby="customer-login-title">
          <div className="customer-login-icon">
            <Smartphone size={26} />
          </div>
          <div
            className="customer-login-steps"
            aria-label={`Step ${step === 'phone' ? '1' : '2'} of 2`}
          >
            <span className="is-current">{step === 'code' ? <Check size={12} /> : '1'} Mobile</span>
            <span aria-hidden="true" />
            <span className={step === 'code' ? 'is-current' : ''}>2 Demo code</span>
          </div>
          <h2 id="customer-login-title">
            {step === 'phone' ? 'Sign in to your orders' : 'Enter the demo code'}
          </h2>
          <p className="customer-login-description">
            {step === 'phone'
              ? 'Start with your mobile number. No password needed.'
              : `Continue with the number ending in ${phone.slice(-4)}.`}
          </p>
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
                <small id="customer-mobile-help">Indian mobile number · +91 is optional</small>
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
              {step === 'phone' ? 'Continue' : 'Verify and sign in'} <ArrowRight size={17} />
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
                  Resend demo code
                </button>
              </div>
            )}
          </form>
          <p className="customer-login-disclaimer">
            <strong>Demo sign-in — no SMS sent. This is not secure authentication.</strong>
            Orders and your sign-in are saved in this browser only.
          </p>
        </section>
      </div>
    </div>
  );
}
