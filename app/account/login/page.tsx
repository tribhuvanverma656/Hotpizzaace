import { Suspense } from 'react';
import { CustomerLoginForm } from '@/components/customer-login-form';
import '@/components/customer-login.css';

export const metadata = { title: 'Customer sign in' };

export default function CustomerLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="container empty-state" role="status">
          Opening customer sign-in…
        </div>
      }
    >
      <CustomerLoginForm />
    </Suspense>
  );
}
