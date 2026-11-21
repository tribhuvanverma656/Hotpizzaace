'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { KitchenProfile } from '@/lib/kitchen-staff';
import { KitchenApiError, kitchenAccessEnded, kitchenRequest } from './client';

type Access = 'checking' | 'ready' | 'signed_out' | 'disabled' | 'unavailable';
type KitchenContextValue = {
  status: Access;
  profile: KitchenProfile | null;
  notice: string;
  logoutUnconfirmed: boolean;
  checkSession: () => Promise<void>;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  endSession: (disabled?: boolean) => void;
  acceptProfile: (profile: KitchenProfile) => void;
};
const KitchenContext = createContext<KitchenContextValue | null>(null);
export function validKitchenProfile(profile: KitchenProfile): boolean {
  return (
    !!profile &&
    typeof profile.id === 'string' &&
    typeof profile.displayName === 'string' &&
    typeof profile.username === 'string' &&
    typeof profile.branchId === 'string' &&
    typeof profile.branchName === 'string' &&
    Number.isSafeInteger(profile.version) &&
    profile.version > 0 &&
    ['development', 'production'].includes(profile.environment) &&
    Number.isFinite(Date.parse(profile.expiresAt)) &&
    Date.parse(profile.expiresAt) > Date.now()
  );
}
export function KitchenProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Access>('checking');
  const [profile, setProfile] = useState<KitchenProfile | null>(null);
  const [notice, setNotice] = useState('');
  const [logoutUnconfirmed, setLogoutUnconfirmed] = useState(false);
  const current = useRef<KitchenProfile | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const publish = useCallback((next: KitchenProfile | null, access: Access) => {
    current.current = next;
    setProfile(next);
    setStatus(access);
  }, []);
  const endSession = useCallback(
    (disabled = false) => {
      ++generation.current;
      publish(null, disabled ? 'disabled' : 'signed_out');
      setNotice(
        disabled
          ? 'Kitchen staff access is not enabled for this restaurant yet.'
          : 'Your kitchen session has ended. Sign in again.',
      );
    },
    [publish],
  );
  const checkSession = useCallback(async () => {
    const attempt = ++generation.current;
    setStatus('checking');
    try {
      const result = await kitchenRequest<{ profile: KitchenProfile | null }>('session');
      if (!mounted.current || attempt !== generation.current) return;
      if (result.profile === null) publish(null, 'signed_out');
      else {
        if (!validKitchenProfile(result.profile))
          throw new KitchenApiError(502, 'invalid_response');
        publish(result.profile, 'ready');
      }
      setNotice('');
      setLogoutUnconfirmed(false);
    } catch (cause) {
      if (!mounted.current || attempt !== generation.current) return;
      if (cause instanceof KitchenApiError && cause.code === 'kitchen_disabled') endSession(true);
      else if (
        cause instanceof KitchenApiError &&
        cause.code === 'auth_required' &&
        !current.current
      ) {
        publish(null, 'signed_out');
        setNotice('');
      } else if (kitchenAccessEnded(cause)) endSession();
      else {
        publish(null, 'unavailable');
        setNotice('The kitchen connection is unavailable. Retry before signing in.');
      }
    }
  }, [endSession, publish]);
  useEffect(() => {
    mounted.current = true;
    void checkSession();
    return () => {
      mounted.current = false;
      // This is a request generation, not a DOM ref; invalidate its latest value.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ++generation.current;
      current.current = null;
    };
  }, [checkSession]);
  const signIn = useCallback(
    async (username: string, password: string) => {
      const attempt = ++generation.current;
      const result = await kitchenRequest<{ profile: KitchenProfile }>('auth/login', {
        method: 'POST',
        body: { username: username.trim().toLowerCase(), password },
      });
      if (!mounted.current || attempt !== generation.current) return;
      if (!validKitchenProfile(result.profile)) throw new KitchenApiError(502, 'invalid_response');
      publish(result.profile, 'ready');
      setNotice('');
      setLogoutUnconfirmed(false);
    },
    [publish],
  );
  const signOut = useCallback(async () => {
    ++generation.current;
    publish(null, 'checking');
    try {
      await kitchenRequest('auth/logout', { method: 'POST', body: {} });
      if (!mounted.current) return;
      publish(null, 'signed_out');
      setNotice('You have signed out of the kitchen.');
      setLogoutUnconfirmed(false);
    } catch {
      if (!mounted.current) return;
      publish(null, 'unavailable');
      setLogoutUnconfirmed(true);
      setNotice('Sign out could not be confirmed. Retry signing out before leaving this device.');
    }
  }, [publish]);
  const acceptProfile = useCallback(
    (next: KitchenProfile) => {
      const previous = current.current;
      if (
        !validKitchenProfile(next) ||
        !previous ||
        next.id !== previous.id ||
        next.branchId !== previous.branchId ||
        next.version !== previous.version ||
        next.environment !== previous.environment
      ) {
        endSession();
        throw new KitchenApiError(401, 'session_revoked');
      }
      publish(next, 'ready');
    },
    [endSession, publish],
  );
  const value = useMemo(
    () => ({
      status,
      profile,
      notice,
      logoutUnconfirmed,
      checkSession,
      signIn,
      signOut,
      endSession,
      acceptProfile,
    }),
    [
      status,
      profile,
      notice,
      logoutUnconfirmed,
      checkSession,
      signIn,
      signOut,
      endSession,
      acceptProfile,
    ],
  );
  return <KitchenContext.Provider value={value}>{children}</KitchenContext.Provider>;
}
export function useKitchen() {
  const value = useContext(KitchenContext);
  if (!value) throw new Error('Kitchen access requires its dedicated provider.');
  return value;
}
