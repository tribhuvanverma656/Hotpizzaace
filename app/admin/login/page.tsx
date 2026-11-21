'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useDemoStore } from '@/lib/store';
import { useSharedCommerce } from '@/components/shared-commerce-provider';
import { GoogleAdminLogin } from '@/components/admin/google-admin-login';
import { RestaurantLogo } from '@/components/restaurant-logo';
export default function LoginPage() {
  const shared = useSharedCommerce();
  return shared.enabled ? <GoogleAdminLogin /> : <DemoLoginPage />;
}

function DemoLoginPage() {
  const router = useRouter();
  const login = useDemoStore((s) => s.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  return (
    <div className="admin-login-card">
      <Link href="/" className="admin-login-brand restaurant-login-brand">
        <RestaurantLogo variant="login" />
      </Link>
      <span className="badge admin-demo-badge">DEMO WORKSPACE</span>
      <h1>
        A good day starts
        <br />
        in your kitchen.
      </h1>
      <p className="muted">Sign in to manage orders, your menu, and all the little details.</p>
      <form
        className="admin-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (login(email, password)) {
            toast.success('Welcome to your demo workspace');
            router.push('/admin/dashboard');
          } else setError('The email or password does not match the demo account.');
        }}
      >
        <label className="field">
          Email address
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          Password
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <button className="btn btn-primary" type="submit">
          Sign in to workspace <ArrowRight size={17} />
        </button>
      </form>
      <div className="admin-login-disclaimer">
        <ShieldCheck size={20} />
        <p>
          This is a local prototype. The sign-in gate is cosmetic and does not provide secure
          authentication. No real accounts or payments.
        </p>
      </div>
      <Link className="admin-back-link" href="/">
        ← Back to the storefront
      </Link>
    </div>
  );
}
