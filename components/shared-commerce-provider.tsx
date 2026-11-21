'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { usePathname } from 'next/navigation';
import type { Order, OrderStatus } from '@/types';
import { useDemoStore } from '@/lib/store';
import {
  commerceRequest,
  type SharedCatalog,
  type SharedOrderRequest,
} from '@/lib/commerce/client';
import { useCustomerAuth, type AuthCustomer } from './customer-auth-provider';
import { readCommerceEnvironment, type CommerceEnvironment } from '@/lib/commerce/environment';
import { commerceRefreshPolicy } from '@/lib/commerce-refresh-policy';
import { isActiveOrder } from '@/lib/order-tracking';
import { startVisiblePolling } from '@/lib/visible-polling';
import {
  parseRazorpayCheckout,
  parseRazorpayCheckoutStatus,
  readRazorpayCapability,
  type RazorpayCapability,
  type RazorpayCheckout,
  type RazorpayCheckoutStatus,
  type RazorpayProof,
} from '@/lib/payments/razorpay-client';
import {
  parsePhonePeCheckout,
  parsePhonePeCheckoutStatus,
  readPhonePeCapability,
  type PhonePeCapability,
  type PhonePeCheckout,
  type PhonePeCheckoutStatus,
} from '@/lib/payments/phonepe-client';

type SharedCommerce = CommerceEnvironment & {
  enabled: boolean;
  ready: boolean;
  error: string | null;
  ordersError: string | null;
  ordersLoading: boolean;
  adminError: string | null;
  revision: number;
  user: AuthCustomer | null;
  customerOrders: Order[];
  adminOrders: Order[];
  admin: boolean;
  adminLoading: boolean;
  razorpay: RazorpayCapability | null;
  phonepe: PhonePeCapability | null;
  /** The online gateway new website orders will use: PhonePe when configured. */
  onlinePayment: RazorpayCapability | PhonePeCapability | null;
  refresh: () => Promise<void>;
  refreshOrders: () => Promise<void>;
  refreshAdmin: () => Promise<void>;
  createOrder: (request: SharedOrderRequest) => Promise<Order>;
  getOrder: (id: string, access?: string) => Promise<Order>;
  changeOrderStatus: (id: string, status: OrderStatus) => Promise<Order>;
  cancelOrder: (id: string, expectedVersion: number) => Promise<Order>;
  simulatePayment: (id: string, outcome: 'success' | 'failed' | 'cash_collected') => Promise<Order>;
  createRazorpayCheckout: (id: string, attemptId: string) => Promise<RazorpayCheckout>;
  getRazorpayCheckoutStatus: (id: string, attemptId: string) => Promise<RazorpayCheckoutStatus>;
  verifyRazorpayPayment: (id: string, attemptId: string, proof: RazorpayProof) => Promise<Order>;
  createPhonePeCheckout: (id: string, attemptId: string) => Promise<PhonePeCheckout>;
  getPhonePeCheckoutStatus: (id: string, attemptId: string) => Promise<PhonePeCheckoutStatus>;
  verifyPhonePePayment: (id: string, attemptId: string) => Promise<Order>;
  mutateCatalog: (action: string, args: unknown, expectedRevision?: number) => Promise<void>;
};
const SharedContext = createContext<SharedCommerce | null>(null);
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'The restaurant connection failed. Please try again.';

/** Public menu may use the local cart store. Shared orders and identities never enter it. */
export function SharedCommerceProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const auth = useCustomerAuth();
  const refreshAuth = auth.refresh;
  const identity = auth.error ? 'unverified' : (auth.contextId ?? 'unverified');
  const verifiedUserId = useRef(auth.user?.id ?? null);
  const identityRef = useRef(identity);
  const identityEpoch = useRef(0);
  useLayoutEffect(() => {
    identityRef.current = identity;
    verifiedUserId.current = auth.user?.id ?? null;
    ++identityEpoch.current;
  }, [identity, auth.user?.id]);
  const privateVersion = useRef(0);
  const catalogVersion = useRef(0);
  const ordersReadVersion = useRef(0);
  const adminReadVersion = useRef(0);
  const [catalog, setCatalog] = useState<SharedCatalog | null>(null);
  const [ready, setReady] = useState(!enabled);
  const [sessionReady, setSessionReady] = useState(!enabled);
  const [ordersLoading, setOrdersLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [user, setUser] = useState<AuthCustomer | null>(null);
  const [privateIdentity, setPrivateIdentity] = useState(identity);
  const [verifiedIdentity, setVerifiedIdentity] = useState<string>('unverified');
  const [customerOrders, setCustomerOrders] = useState<Order[]>([]);
  const [adminOrders, setAdminOrders] = useState<Order[]>([]);
  const [admin, setAdmin] = useState(false);
  const [adminLoading, setAdminLoading] = useState(enabled);
  const policy = commerceRefreshPolicy(pathname, customerOrders.some(isActiveOrder));
  const policyRef = useRef(policy);
  const authErrorRef = useRef(auth.error);
  useLayoutEffect(() => {
    policyRef.current = policy;
    authErrorRef.current = auth.error;
  }, [policy, auth.error]);
  const refreshGeneration = useRef(0);
  const inFlightRefresh = useRef<{
    owner: string;
    epoch: number;
    policy: { adminSnapshot: boolean; customerOrders: boolean };
    promise: Promise<void>;
  } | null>(null);
  const selectedBranchId = useDemoStore((s) => s.selectedBranchId);
  const hydrated = useDemoStore((s) => s.hydrated);
  const ordersRef = useRef({ customerOrders, adminOrders });
  useEffect(() => {
    ordersRef.current = { customerOrders, adminOrders };
  }, [customerOrders, adminOrders]);
  const catalogAppliedRevision = useRef(-1);
  const revision = catalog?.revision ?? 0;
  const applyCatalog = useCallback((next: SharedCatalog) => {
    if (
      !Array.isArray(next.products) ||
      !Array.isArray(next.categories) ||
      !Array.isArray(next.branches) ||
      !next.branches.length ||
      !Number.isSafeInteger(next.revision)
    )
      throw new Error('The restaurant menu is incomplete. Please reload.');
    if (next.revision < catalogAppliedRevision.current) return;
    catalogAppliedRevision.current = next.revision;
    setCatalog(next);
    const state = useDemoStore.getState();
    const selected =
      next.branches.find((branch) => branch.id === state.selectedBranchId) ?? next.branches[0];
    useDemoStore.setState({
      products: next.products,
      categories: next.categories,
      branches: next.branches,
      settings: selected.settings,
      selectedBranchId: selected.id,
      adminBranchId: next.branches.some((branch) => branch.id === state.adminBranchId)
        ? state.adminBranchId
        : selected.id,
    });
    setReady(true);
    setError(null);
  }, []);
  const refreshCatalog = useCallback(async () => {
    if (!enabled) return;
    const version = ++catalogVersion.current;
    try {
      const next = await commerceRequest<SharedCatalog>('catalog');
      if (version === catalogVersion.current) applyCatalog(next);
    } catch (cause) {
      if (version === catalogVersion.current) {
        setError(message(cause));
        setReady(false);
      }
    }
  }, [enabled, applyCatalog]);
  const refreshOrders = useCallback(async () => {
    if (!enabled) return;
    const version = privateVersion.current;
    const readVersion = ++ordersReadVersion.current;
    const owner = identityRef.current;
    setOrdersLoading(true);
    try {
      const result = await commerceRequest<{ orders: Order[] }>('orders');
      if (
        owner !== identityRef.current ||
        version !== privateVersion.current ||
        readVersion !== ordersReadVersion.current
      )
        return;
      if (!Array.isArray(result.orders))
        throw new Error('Your orders could not be read. Please try again.');
      setCustomerOrders(result.orders);
      setOrdersError(null);
    } catch (cause) {
      if (
        owner !== identityRef.current ||
        version !== privateVersion.current ||
        readVersion !== ordersReadVersion.current
      )
        return;
      setCustomerOrders([]);
      setOrdersError(message(cause));
    } finally {
      if (
        owner === identityRef.current &&
        version === privateVersion.current &&
        readVersion === ordersReadVersion.current
      )
        setOrdersLoading(false);
    }
  }, [enabled]);
  const refreshSession = useCallback(
    async (includeSnapshot: boolean) => {
      if (!enabled) return false;
      const version = ++privateVersion.current;
      const adminRead = ++adminReadVersion.current;
      const owner = identityRef.current;
      setAdminLoading(true);
      let sessionChecked = false;
      try {
        const session = await commerceRequest<{ user: AuthCustomer | null; admin: boolean }>(
          'session',
        );
        if (owner !== identityRef.current || version !== privateVersion.current) return false;
        sessionChecked = true;
        setSessionReady(true);
        const sameUser = (session.user?.id ?? null) === verifiedUserId.current;
        setVerifiedIdentity(sameUser ? owner : 'unverified');
        if (!sameUser) void refreshAuth();
        setUser(session.user);
        if (typeof session.admin !== 'boolean')
          throw new Error('The restaurant session could not be checked.');
        if (!session.admin) setAdmin(false);
        if (session.admin === true && includeSnapshot) {
          const snapshot = await commerceRequest<SharedCatalog & { orders: Order[] }>(
            'admin/snapshot',
          );
          if (owner !== identityRef.current || version !== privateVersion.current) return false;
          if (!Array.isArray(snapshot.orders))
            throw new Error('The restaurant orders could not be read.');
          applyCatalog(snapshot);
          if (adminRead === adminReadVersion.current) setAdminOrders(snapshot.orders);
          setAdmin(true);
        } else {
          setAdmin(session.admin);
          if (!session.admin) setAdminOrders([]);
        }
        setAdminError(null);
        return session.admin && includeSnapshot;
      } catch (cause) {
        if (owner !== identityRef.current || version !== privateVersion.current) return false;
        if (!sessionChecked) {
          setSessionReady(false);
          setVerifiedIdentity('unverified');
        }
        setAdmin(false);
        setUser(null);
        setAdminOrders([]);
        setAdminError(message(cause));
        return false;
      } finally {
        if (owner === identityRef.current && version === privateVersion.current)
          setAdminLoading(false);
      }
    },
    [enabled, applyCatalog, refreshAuth],
  );
  const runRefresh = useCallback(
    async (force: boolean, fullAdmin = false) => {
      if (!enabled) return;
      const owner = identityRef.current;
      const epoch = identityEpoch.current;
      const selectedPolicy = fullAdmin
        ? { adminSnapshot: true, customerOrders: false }
        : policyRef.current;
      const current = inFlightRefresh.current;
      if (
        !force &&
        current?.owner === owner &&
        current.epoch === epoch &&
        (!selectedPolicy.adminSnapshot || current.policy.adminSnapshot) &&
        (!selectedPolicy.customerOrders || current.policy.customerOrders)
      )
        return current.promise;
      const generation = ++refreshGeneration.current;
      // A replacement snapshot must also invalidate a pending lightweight catalog read.
      ++catalogVersion.current;
      const isCurrent = () =>
        owner === identityRef.current &&
        epoch === identityEpoch.current &&
        generation === refreshGeneration.current;
      const promise = (async () => {
        if (authErrorRef.current) await refreshAuth();
        if (!isCurrent()) return;
        const includedCatalog = await refreshSession(selectedPolicy.adminSnapshot);
        if (!isCurrent()) return;
        // Owner snapshots already contain the complete catalog. Avoid a second copy.
        if (!includedCatalog) await refreshCatalog();
        if (!isCurrent()) return;
        if (selectedPolicy.customerOrders) await refreshOrders();
        else setOrdersLoading(false);
      })();
      const entry = { owner, epoch, policy: selectedPolicy, promise };
      inFlightRefresh.current = entry;
      try {
        await promise;
      } finally {
        if (inFlightRefresh.current === entry) inFlightRefresh.current = null;
      }
    },
    [enabled, refreshAuth, refreshSession, refreshCatalog, refreshOrders],
  );
  // Explicit retries and post-mutation reads must see work committed after any older poll.
  const refresh = useCallback(() => runRefresh(true), [runRefresh]);
  const refreshAdmin = useCallback(() => runRefresh(true, true), [runRefresh]);
  const invalidate = useCallback(() => {
    ++refreshGeneration.current;
    inFlightRefresh.current = null;
    ++privateVersion.current;
    ++catalogVersion.current;
  }, []);
  useEffect(() => {
    if (!enabled) return;
    invalidate();
    if (identity === 'unverified') return invalidate;
    const begin = setTimeout(() => {
      setPrivateIdentity(identity);
      setSessionReady(false);
      setVerifiedIdentity('unverified');
      setOrdersLoading(true);
      setCustomerOrders([]);
      setAdminOrders([]);
      setAdmin(false);
      setUser(null);
      void runRefresh(false);
    }, 0);
    return () => {
      clearTimeout(begin);
      invalidate();
    };
  }, [enabled, identity, runRefresh, invalidate]);
  useEffect(() => {
    if (!enabled || identity === 'unverified') return;
    return startVisiblePolling({
      refresh: () => runRefresh(false),
      intervalMs: policy.intervalMs,
      immediate: false,
    });
  }, [enabled, identity, policy.intervalMs, runRefresh]);
  const previousPath = useRef(pathname);
  useEffect(() => {
    const changed = previousPath.current !== pathname;
    previousPath.current = pathname;
    if (changed && enabled && identity !== 'unverified' && privateIdentity === identity)
      void runRefresh(false);
  }, [pathname, enabled, identity, privateIdentity, runRefresh]);
  useEffect(() => {
    if (!enabled || !catalog || !hydrated) return;
    const selected =
      catalog.branches.find((branch) => branch.id === selectedBranchId) ?? catalog.branches[0];
    // Rehydrate only public catalog values after local storage or branch selection changes.
    useDemoStore.setState({
      products: catalog.products,
      categories: catalog.categories,
      branches: catalog.branches,
      settings: selected.settings,
      selectedBranchId: selected.id,
    });
  }, [enabled, catalog, hydrated, selectedBranchId]);
  const updateOrder = useCallback((order: Order, add = false) => {
    ++ordersReadVersion.current;
    ++adminReadVersion.current;
    setOrdersLoading(false);
    setCustomerOrders((current) =>
      current.some((item) => item.id === order.id)
        ? current.map((item) =>
            item.id === order.id && (order.version ?? 0) >= (item.version ?? 0) ? order : item,
          )
        : add
          ? [order, ...current]
          : current,
    );
    setAdminOrders((current) =>
      current.map((item) =>
        item.id === order.id && (order.version ?? 0) >= (item.version ?? 0) ? order : item,
      ),
    );
    return order;
  }, []);
  const privateRequest = useCallback(
    async (path: string, options?: Parameters<typeof commerceRequest>[1]) => {
      if (!enabled) throw new Error('Shared ordering is not enabled.');
      const owner = identityRef.current;
      const epoch = identityEpoch.current;
      const result = await commerceRequest<{ order: Order; trackingUrl?: string }>(path, options);
      if (owner !== identityRef.current || epoch !== identityEpoch.current)
        throw new Error('Your account changed. Reopen your orders to continue.');
      return result.trackingUrl
        ? { ...result.order, trackingUrl: result.trackingUrl }
        : result.order;
    },
    [enabled],
  );
  const createOrder = useCallback(
    async (request: SharedOrderRequest) =>
      updateOrder(await privateRequest('orders', { method: 'POST', body: request }), true),
    [privateRequest, updateOrder],
  );
  const getOrder = useCallback(
    async (id: string, access?: string) =>
      updateOrder(
        await privateRequest(
          `orders/${encodeURIComponent(id)}${access ? `?access=${encodeURIComponent(access)}` : ''}`,
        ),
      ),
    [privateRequest, updateOrder],
  );
  const cancelOrder = useCallback(
    async (id: string, expectedVersion: number) => {
      try {
        return updateOrder(
          await privateRequest(`orders/${encodeURIComponent(id)}/cancel`, {
            method: 'POST',
            body: { expectedVersion },
          }),
        );
      } catch (cause) {
        await getOrder(id).catch(() => undefined);
        throw cause;
      }
    },
    [privateRequest, updateOrder, getOrder],
  );
  const changeOrderStatus = useCallback(
    async (id: string, status: OrderStatus) => {
      const order = [...ordersRef.current.adminOrders, ...ordersRef.current.customerOrders].find(
        (item) => item.id === id,
      );
      try {
        return updateOrder(
          await privateRequest(`orders/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            body: { status, expectedVersion: order?.version },
          }),
        );
      } catch (cause) {
        await getOrder(id).catch(() => undefined);
        throw cause;
      }
    },
    [privateRequest, updateOrder, getOrder],
  );
  const simulatePayment = useCallback(
    async (id: string, outcome: 'success' | 'failed' | 'cash_collected') => {
      const order = [...ordersRef.current.adminOrders, ...ordersRef.current.customerOrders].find(
        (item) => item.id === id,
      );
      try {
        return updateOrder(
          await privateRequest(`orders/${encodeURIComponent(id)}/payment`, {
            method: 'POST',
            body: { outcome, expectedVersion: order?.version },
          }),
        );
      } catch (cause) {
        await getOrder(id).catch(() => undefined);
        throw cause;
      }
    },
    [privateRequest, updateOrder, getOrder],
  );
  const createRazorpayCheckout = useCallback(
    async (id: string, attemptId: string) => {
      if (!enabled) throw new Error('Online payment is not enabled.');
      const owner = identityRef.current;
      const epoch = identityEpoch.current;
      const result = await commerceRequest<unknown>(
        `orders/${encodeURIComponent(id)}/payment/checkout`,
        { method: 'POST', body: { attemptId } },
      );
      if (owner !== identityRef.current || epoch !== identityEpoch.current)
        throw new Error('Your account changed. Reopen your order before paying.');
      return parseRazorpayCheckout(result, { orderId: id, attemptId });
    },
    [enabled],
  );
  const verifyRazorpayPayment = useCallback(
    async (id: string, attemptId: string, proof: RazorpayProof) =>
      updateOrder(
        await privateRequest(`orders/${encodeURIComponent(id)}/payment/verify`, {
          method: 'POST',
          body: { attemptId, ...proof },
        }),
      ),
    [privateRequest, updateOrder],
  );
  const getRazorpayCheckoutStatus = useCallback(
    async (id: string, attemptId: string) => {
      if (!enabled) throw new Error('Online payment is not enabled.');
      const owner = identityRef.current;
      const epoch = identityEpoch.current;
      const result = await commerceRequest<unknown>(
        `orders/${encodeURIComponent(id)}/payment/status`,
        { method: 'POST', body: { attemptId } },
      );
      if (owner !== identityRef.current || epoch !== identityEpoch.current)
        throw new Error('Your account changed. Reopen your order before checking payment.');
      return parseRazorpayCheckoutStatus(result, { orderId: id, attemptId });
    },
    [enabled],
  );
  const createPhonePeCheckout = useCallback(
    async (id: string, attemptId: string) => {
      if (!enabled) throw new Error('Online payment is not enabled.');
      const owner = identityRef.current;
      const epoch = identityEpoch.current;
      const result = await commerceRequest<unknown>(
        `orders/${encodeURIComponent(id)}/payment/checkout`,
        { method: 'POST', body: { attemptId } },
      );
      if (owner !== identityRef.current || epoch !== identityEpoch.current)
        throw new Error('Your account changed. Reopen your order before paying.');
      return parsePhonePeCheckout(result, { orderId: id, attemptId });
    },
    [enabled],
  );
  const verifyPhonePePayment = useCallback(
    async (id: string, attemptId: string) =>
      updateOrder(
        await privateRequest(`orders/${encodeURIComponent(id)}/payment/verify`, {
          method: 'POST',
          body: { attemptId },
        }),
      ),
    [privateRequest, updateOrder],
  );
  const getPhonePeCheckoutStatus = useCallback(
    async (id: string, attemptId: string) => {
      if (!enabled) throw new Error('Online payment is not enabled.');
      const owner = identityRef.current;
      const epoch = identityEpoch.current;
      const result = await commerceRequest<unknown>(
        `orders/${encodeURIComponent(id)}/payment/status`,
        { method: 'POST', body: { attemptId } },
      );
      if (owner !== identityRef.current || epoch !== identityEpoch.current)
        throw new Error('Your account changed. Reopen your order before checking payment.');
      return parsePhonePeCheckoutStatus(result, { orderId: id, attemptId });
    },
    [enabled],
  );
  const mutateCatalog = useCallback(
    async (action: string, args: unknown, expectedRevision?: number) => {
      if (!enabled) throw new Error('Shared ordering is not enabled.');
      try {
        await commerceRequest('admin/mutate', {
          method: 'POST',
          body: { action, args, expectedRevision: expectedRevision ?? revision },
        });
      } catch (cause) {
        await refresh();
        throw cause;
      }
      await refresh();
    },
    [enabled, revision, refresh],
  );
  const privateVisible =
    !auth.loading &&
    !auth.error &&
    !!auth.contextId &&
    privateIdentity === identity &&
    verifiedIdentity === identity;
  const environment = readCommerceEnvironment(enabled ? catalog : null);
  return (
    <SharedContext.Provider
      value={{
        enabled,
        ...environment,
        razorpay: enabled ? readRazorpayCapability(catalog) : null,
        phonepe: enabled ? readPhonePeCapability(catalog) : null,
        onlinePayment: enabled
          ? (readPhonePeCapability(catalog) ?? readRazorpayCapability(catalog))
          : null,
        ready: !enabled || (ready && sessionReady && privateVisible),
        error: enabled
          ? (error ?? auth.error ?? (!sessionReady || !privateVisible ? adminError : null))
          : null,
        ordersError,
        ordersLoading: enabled && (!privateVisible || ordersLoading),
        adminError,
        revision,
        user: privateVisible ? user : null,
        customerOrders: privateVisible ? customerOrders : [],
        adminOrders: privateVisible ? adminOrders : [],
        admin: privateVisible && admin,
        adminLoading: enabled && (privateIdentity !== identity || adminLoading),
        refresh,
        refreshOrders,
        refreshAdmin,
        createOrder,
        getOrder,
        changeOrderStatus,
        cancelOrder,
        simulatePayment,
        createRazorpayCheckout,
        getRazorpayCheckoutStatus,
        verifyRazorpayPayment,
        createPhonePeCheckout,
        getPhonePeCheckoutStatus,
        verifyPhonePePayment,
        mutateCatalog,
      }}
    >
      {children}
    </SharedContext.Provider>
  );
}
export function useSharedCommerce(): SharedCommerce {
  const context = useContext(SharedContext);
  if (!context) throw new Error('SharedCommerceProvider is required.');
  return context;
}
