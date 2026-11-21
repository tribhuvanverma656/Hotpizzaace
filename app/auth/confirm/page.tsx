import type { Metadata } from 'next';
import { RecoveryPasswordForm } from '@/components/auth/recovery-password-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Confirm password reset',
  robots: { index: false, follow: false },
  referrer: 'strict-origin',
};

/** A GET never verifies or consumes an email link; its private token stays in the fragment. */
export default function ConfirmRecoveryPage() {
  return <RecoveryPasswordForm />;
}
