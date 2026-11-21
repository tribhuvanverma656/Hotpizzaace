'use client';

import Link from 'next/link';
import { ArrowRight, Check, LogOut, UserRound } from 'lucide-react';
import { useState } from 'react';
import { useCustomerAuth } from './customer-auth-provider';
import { useSharedCommerce } from './shared-commerce-provider';
import { SharedOrderHistory } from './shared-order-history';
import { SharedCustomerAddressBook } from './shared-customer-address-book';

export function CustomerGoogleAccount({
  section = 'profile',
}: {
  section?: 'profile' | 'orders' | 'addresses';
}) {
  const { user, loading, error, refresh, signOut } = useCustomerAuth();
  const shared = useSharedCommerce();
  const [signOutError, setSignOutError] = useState('');
  if (shared.enabled && section === 'orders') return <SharedOrderHistory />;
  if (shared.enabled && section === 'addresses') return <SharedCustomerAddressBook />;
  if (loading)
    return (
      <div className="container empty-state" role="status">
        Checking your account…
      </div>
    );
  if (error)
    return (
      <div className="container empty-state">
        <h1>Let’s reconnect.</h1>
        <p role="alert">{error}</p>
        <button className="btn btn-primary" onClick={() => void refresh()}>
          Try again
        </button>
      </div>
    );
  if (!user)
    return (
      <div className="container empty-state">
        <UserRound size={38} />
        <h1>Your Pizza Ace account.</h1>
        <p>Continue with Google to sign in securely.</p>
        <Link className="btn btn-primary" href={`/account/login?next=/account/${section}`}>
          Sign in <ArrowRight size={17} />
        </Link>
      </div>
    );
  return (
    <div className="container customer-login-page">
      <section
        className="customer-login-card customer-profile-card"
        aria-labelledby="google-profile-title"
      >
        <span className="customer-login-icon">
          <UserRound size={25} />
        </span>
        <span className="eyebrow">YOUR PIZZA ACE ACCOUNT</span>
        <h1 id="google-profile-title">Hello, {user.name?.split(' ')[0] || 'pizza lover'}.</h1>
        <p className="customer-login-description">
          {user.email || 'Your Google account is connected.'}
        </p>
        <p className="customer-auth-verified">
          <Check size={16} /> Signed in securely with Google
        </p>
        {section !== 'profile' && (
          <h2>{section === 'orders' ? 'Your orders' : 'Your saved addresses'}</h2>
        )}
        <p className="customer-login-description">
          {shared.enabled
            ? 'Your orders and saved delivery addresses are linked to this Google account and available on your other devices. Online payments are currently simulated.'
            : 'Ordering is currently in demo mode. Order history and saved addresses from the mobile demo are kept separate from your Google account.'}
        </p>
        <div className="customer-profile-actions">
          {shared.enabled && (
            <Link className="btn btn-outline" href="/account/addresses">
              Saved addresses <ArrowRight size={17} />
            </Link>
          )}
          {shared.enabled && (
            <Link className="btn btn-primary" href="/account/orders">
              My orders <ArrowRight size={17} />
            </Link>
          )}
          <Link className="btn btn-primary" href="/menu">
            Explore the menu <ArrowRight size={17} />
          </Link>
          {section !== 'profile' && (
            <Link className="btn btn-outline" href="/account/profile">
              My account
            </Link>
          )}
          <button
            type="button"
            className="btn btn-outline"
            onClick={async () => {
              setSignOutError('');
              try {
                await signOut();
              } catch {
                setSignOutError('Sign-out could not complete. Please try again.');
              }
            }}
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
        {signOutError && (
          <p className="error-message" role="alert">
            {signOutError}
          </p>
        )}
      </section>
    </div>
  );
}
