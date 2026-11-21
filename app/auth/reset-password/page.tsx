import type { Metadata } from 'next';
import Link from 'next/link';
import { LockKeyhole } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { resetPasswordErrorMessage, verifiedRecoveryUser } from '@/lib/auth/password';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Set a new password | Hot Pizza Ace',
  robots: { index: false, follow: false },
  referrer: 'strict-origin',
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ auth_error?: string }>;
}) {
  let ready = false;
  try {
    ready = !!(await verifiedRecoveryUser(await createSupabaseServerClient()));
  } catch {
    /* Display a safe request-new-link state. */
  }
  const query = await searchParams;
  const error = resetPasswordErrorMessage(query.auth_error);
  return (
    <main
      className="page-section container"
      style={{ maxWidth: 560, minHeight: '65vh', paddingTop: 48, paddingBottom: 48 }}
    >
      <section className="card" style={{ padding: 'clamp(24px, 5vw, 40px)' }}>
        <LockKeyhole size={32} aria-hidden="true" />
        <h1 className="section-title" style={{ marginTop: 20, fontSize: 'clamp(28px, 6vw, 36px)' }}>
          Set a new password
        </h1>
        {ready ? (
          <>
            <p className="muted">
              Choose a password you don’t use elsewhere. After saving, sign in again with your new
              password.
            </p>
            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}
            <form
              action="/api/auth/password/update"
              method="post"
              className="admin-form"
              style={{ marginTop: 24 }}
            >
              <label className="field" htmlFor="new-password">
                New password
                <input
                  id="new-password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={128}
                />
              </label>
              <label className="field" htmlFor="confirm-new-password">
                Confirm new password
                <input
                  id="confirm-new-password"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={128}
                />
              </label>
              <small className="muted">Use at least 12 characters.</small>
              <button className="btn btn-primary" type="submit">
                Save new password
              </button>
            </form>
          </>
        ) : (
          <p className="error-message" role="alert">
            This reset link has expired or is not valid in this browser. Request a fresh link and
            open it in the same browser.
          </p>
        )}
        <Link
          href="/admin/login?auth_action=reset"
          className="admin-back-link"
          style={{ display: 'inline-block', marginTop: 24 }}
        >
          ← Back to restaurant sign in
        </Link>
      </section>
    </main>
  );
}
