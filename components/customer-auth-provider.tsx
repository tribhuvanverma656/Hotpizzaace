'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useDemoStore } from '@/lib/store';
import { noteCounterDraftIdentity } from '@/lib/counter-draft';
import {
  clearCustomerPrivateDrafts,
  parseCustomerPrivacyContext,
  reconcileCustomerPrivacyStorage,
} from '@/lib/customer-privacy';

export type AuthCustomer = { id: string; email: string | null; name: string | null };
type CustomerAuth = {
  user: AuthCustomer | null;
  contextId: string | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<CustomerAuth | null>(null);

function parseUser(value: unknown): AuthCustomer | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object') throw new Error('Invalid session response.');
  const user = value as Partial<AuthCustomer>;
  if (
    typeof user.id !== 'string' ||
    !user.id ||
    !(typeof user.email === 'string' || user.email === null) ||
    !(typeof user.name === 'string' || user.name === null)
  )
    throw new Error('Invalid session response.');
  return { id: user.id, email: user.email, name: user.name };
}

/** Display state only. Protected server operations must independently verify the session. */
export function CustomerAuthProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [user, setUser] = useState<AuthCustomer | null>(null);
  const [contextId, setContextId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const verifiedContext = useRef<string | null | undefined>(undefined);
  const contextChannel = useRef<BroadcastChannel | null>(null);
  const quietRefreshAllowed = useRef(false);
  const announceContextChange = useCallback(() => {
    try {
      contextChannel.current?.postMessage({ type: 'recheck' });
    } catch {
      // Cross-tab notification is optional; server checks and focus refresh remain active.
    }
  }, []);
  const invalidateRequests = useCallback(() => {
    ++requestVersion.current;
  }, []);

  const refresh = useCallback(
    async (options?: { quiet?: boolean }) => {
      const version = ++requestVersion.current;
      // Rechecking an unchanged browser on focus must not dispose an active hosted
      // payment form. Explicit auth boundaries and manual retries still mask it.
      if (!(options?.quiet && quietRefreshAllowed.current)) setLoading(true);
      try {
        const response = await fetch('/api/auth/session', {
          cache: 'no-store',
          credentials: 'same-origin',
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new Error('Sign-in could not be checked.');
        const result = await response.json();
        const nextUser = parseUser(result.user);
        const nextContext = parseCustomerPrivacyContext(
          result.configured,
          result.contextId,
          nextUser?.id ?? null,
        );
        if (version !== requestVersion.current) return;
        let storedContextChanged = false;
        try {
          if (nextContext)
            storedContextChanged = reconcileCustomerPrivacyStorage(
              window.sessionStorage,
              nextContext,
            );
        } catch {
          // Private views also bind to the verified context without browser storage.
        }
        if (
          storedContextChanged ||
          (verifiedContext.current !== undefined &&
            verifiedContext.current !== (nextContext?.contextId ?? null))
        )
          announceContextChange();
        verifiedContext.current = nextContext?.contextId ?? null;
        quietRefreshAllowed.current = nextContext !== null;
        setContextId(nextContext?.contextId ?? null);
        noteCounterDraftIdentity(nextUser?.id ?? null);
        if (nextUser && useDemoStore.getState().customerSession)
          useDemoStore.getState().logoutCustomer();
        setUser(nextUser);
        setError(null);
      } catch {
        if (version !== requestVersion.current) return;
        quietRefreshAllowed.current = false;
        setUser(null);
        setContextId(null);
        setError('We couldn’t check your sign-in. Please try again.');
      } finally {
        if (version === requestVersion.current) setLoading(false);
      }
    },
    [announceContextChange],
  );

  const signOut = useCallback(async () => {
    ++requestVersion.current;
    quietRefreshAllowed.current = false;
    setLoading(true);
    // An explicit sign-out is a privacy boundary even if remote revocation fails.
    try {
      clearCustomerPrivateDrafts(window.sessionStorage);
    } catch {
      // No browser storage is required to clear the in-memory identity.
    }
    noteCounterDraftIdentity(null);
    setUser(null);
    setContextId(null);
    try {
      const response = await fetch('/auth/signout', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok || (await response.json()).ok !== true)
        throw new Error('Sign-out could not complete. Please try again.');
      ++requestVersion.current;
      setError(null);
    } finally {
      // The server rotates the guest context on every valid sign-out attempt.
      announceContextChange();
      await refresh();
    }
  }, [refresh, announceContextChange]);

  useEffect(() => {
    if (typeof window.BroadcastChannel !== 'function') return;
    let channel: BroadcastChannel;
    try {
      channel = new window.BroadcastChannel('hpa-customer-privacy:v1');
    } catch {
      return;
    }
    contextChannel.current = channel;
    const recheck = (event: MessageEvent) => {
      if (event.data?.type === 'recheck') void refresh();
    };
    channel.addEventListener('message', recheck);
    return () => {
      contextChannel.current = null;
      channel.removeEventListener('message', recheck);
      channel.close();
    };
  }, [refresh]);

  useEffect(() => {
    void refresh({ quiet: true });
    const focused = () => {
      if (document.visibilityState === 'visible') void refresh({ quiet: true });
    };
    window.addEventListener('focus', focused);
    document.addEventListener('visibilitychange', focused);
    return () => {
      invalidateRequests();
      window.removeEventListener('focus', focused);
      document.removeEventListener('visibilitychange', focused);
    };
  }, [pathname, refresh, invalidateRequests]);

  return (
    <AuthContext.Provider value={{ user, contextId, loading, error, refresh, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useCustomerAuth(): CustomerAuth {
  const context = useContext(AuthContext);
  if (!context) throw new Error('CustomerAuthProvider is required.');
  return context;
}
