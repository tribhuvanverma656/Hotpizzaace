'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, LogOut } from 'lucide-react';
import type { LocalUser } from '@/lib/local-pos/database';
import styles from './account-menu.module.css';

const roleLabels = {
  super_user: 'Super User',
  pos_manager: 'POS Manager',
  kitchen: 'Kitchen Staff',
} as const;

export function LocalPosAccountMenu({
  user,
  onSignedOut,
}: {
  user: LocalUser;
  onSignedOut?: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function signOut() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/local-pos/logout', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!response.ok) {
        const result = (await response.json()) as { error?: string };
        throw new Error(result.error ?? 'Unable to sign out.');
      }
      if (onSignedOut) onSignedOut();
      else router.push('/local-pos');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to sign out.');
      setBusy(false);
    }
  }

  return (
    <details className={styles.account}>
      <summary aria-label={`Account menu: ${roleLabels[user.role]}`}>
        <span>{roleLabels[user.role]}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </summary>
      <div className={styles.menu}>
        <div className={styles.identity}>
          <strong>{user.displayName}</strong>
          <span>@{user.username}</span>
          <span className={styles.role}>{roleLabels[user.role]}</span>
        </div>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <button type="button" onClick={() => void signOut()} disabled={busy}>
          <LogOut size={16} />
          {busy ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </details>
  );
}
