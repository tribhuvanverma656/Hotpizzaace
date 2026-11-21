'use client';

import { usePathname } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { startAddressRefresh } from '@/lib/address-refresh-policy';
import type { SharedAddressBook, SharedSavedAddress } from '@/lib/commerce/addresses';
import { CommerceError, commerceRequest } from '@/lib/commerce/client';
import { CustomerAddressesState } from '@/lib/customer-addresses-state';
import { clearSharedCheckoutIdentityDrafts } from '@/lib/shared-checkout-draft';
import { useCustomerAuth } from './customer-auth-provider';
import { useSharedCommerce } from './shared-commerce-provider';

export type SharedAddressInput = Omit<SharedSavedAddress, 'id'> & { id?: string };
type CustomerAddresses = {
  addresses: SharedSavedAddress[];
  revision: number | null;
  userId: string | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  errorCode: string | null;
  refresh: () => Promise<void>;
  create: (address: SharedAddressInput, expectedRevision?: number) => Promise<SharedAddressBook>;
  update: (
    id: string,
    address: Omit<SharedSavedAddress, 'id'>,
    expectedRevision?: number,
  ) => Promise<SharedAddressBook>;
  remove: (id: string, expectedRevision?: number) => Promise<SharedAddressBook>;
  setDefault: (id: string, expectedRevision?: number) => Promise<SharedAddressBook>;
};
const AddressesContext = createContext<CustomerAddresses | null>(null);

/** Shared contacts stay in account-scoped memory and are never copied to the demo store. */
export function CustomerAddressesProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const auth = useCustomerAuth();
  const shared = useSharedCommerce();
  const [state] = useState(
    () =>
      new CustomerAddressesState({
        read: (signal) => commerceRequest('addresses', { signal }),
        mutate: (body, signal) => commerceRequest('addresses', { method: 'POST', body, signal }),
      }),
  );
  const snapshot = useSyncExternalStore(state.subscribe, state.getSnapshot, state.getSnapshot);
  const userId = shared.enabled && !auth.error ? (auth.user?.id ?? null) : null;
  const previousUser = useRef<string | null>(null);
  const previousContext = useRef<string | null>(null);

  useLayoutEffect(() => {
    const previous = previousUser.current;
    if (!auth.loading && !auth.error) {
      if (previous && previous !== userId) {
        try {
          clearSharedCheckoutIdentityDrafts(window.sessionStorage, previous);
        } catch {
          // Blocked browser storage cannot restore private address-provider state.
        }
      }
      previousUser.current = userId;
    }
    // A new browser context invalidates stale reads even when its UID is unchanged.
    // An ordinary verification refresh keeps the same account's work in progress.
    if (!auth.loading && !auth.error && previousContext.current !== auth.contextId) {
      state.setIdentity(null);
      previousContext.current = auth.contextId;
    }
    if (!auth.loading || auth.error) state.setIdentity(auth.error ? null : userId);
  }, [state, userId, auth.loading, auth.error, auth.contextId]);

  useEffect(() => {
    if (!userId || auth.loading || auth.error) return;
    return startAddressRefresh({
      pathname,
      refresh: () => state.refreshIfIdle(),
      canRefresh: () => !state.getSnapshot().saving,
    });
  }, [state, userId, auth.loading, auth.error, auth.contextId, pathname]);

  useEffect(() => () => state.dispose(), [state]);

  const revisionFor = useCallback(
    (expectedRevision?: number) => {
      const current = state.getSnapshot();
      if (auth.loading || auth.error || !userId || current.userId !== userId || !current.book)
        throw new CommerceError('Sign in to use your saved addresses.', 401);
      return expectedRevision ?? current.book.revision;
    },
    [state, userId, auth.loading, auth.error],
  );
  const refresh = useCallback(() => state.refresh(), [state]);
  const value = useMemo<CustomerAddresses>(() => {
    const visible = !!userId && !auth.loading && !auth.error && snapshot.userId === userId;
    return {
      userId,
      addresses: visible ? (snapshot.book?.addresses ?? []) : [],
      revision: visible ? (snapshot.book?.revision ?? null) : null,
      loading: shared.enabled && (auth.loading || (!!userId && (!visible || snapshot.loading))),
      saving: visible && snapshot.saving,
      error: visible ? snapshot.error : null,
      errorCode: visible ? snapshot.errorCode : null,
      refresh,
      create: (address, expectedRevision) =>
        state.mutate({
          action: 'create',
          expectedRevision: revisionFor(expectedRevision),
          address: { ...address, id: address.id ?? crypto.randomUUID() },
        }),
      update: (id, address, expectedRevision) =>
        state.mutate({
          action: 'update',
          expectedRevision: revisionFor(expectedRevision),
          address: { ...address, id },
        }),
      remove: (id, expectedRevision) =>
        state.mutate({ action: 'remove', id, expectedRevision: revisionFor(expectedRevision) }),
      setDefault: (id, expectedRevision) =>
        state.mutate({ action: 'default', id, expectedRevision: revisionFor(expectedRevision) }),
    };
  }, [state, snapshot, userId, auth.loading, auth.error, shared.enabled, refresh, revisionFor]);

  return <AddressesContext.Provider value={value}>{children}</AddressesContext.Provider>;
}

export function useCustomerAddresses(): CustomerAddresses {
  const context = useContext(AddressesContext);
  if (!context) throw new Error('CustomerAddressesProvider is required.');
  return context;
}
