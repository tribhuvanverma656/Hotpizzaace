'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Order } from '@/types';
import { startVisiblePolling } from '@/lib/visible-polling';
import { useCustomerAuth } from './customer-auth-provider';
import { useSharedCommerce } from './shared-commerce-provider';
import { OrderDetail } from './order-detail';

/** Private receipts require the server session or the opaque access link on every refresh. */
export function SharedOrderView({
  id,
  access,
  confirmation = false,
}: {
  id: string;
  access?: string;
  confirmation?: boolean;
}) {
  const { getOrder, customerOrders, adminOrders } = useSharedCommerce();
  const auth = useCustomerAuth();
  const identity = auth.contextId ?? 'unverified';
  const scope = `${identity}:${id}:${access ?? ''}`;
  const [state, setState] = useState<{ scope: string; order?: Order; error?: string }>({ scope });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (auth.loading || auth.error || !auth.contextId) return;
    let active = true;
    const load = async () => {
      try {
        const order = await getOrder(id, access);
        if (active) setState({ scope, order });
      } catch (error) {
        if (active)
          setState({
            scope,
            error: error instanceof Error ? error.message : 'Your order could not be loaded.',
          });
      }
    };
    // Keep tracking visible receipts after fulfillment: refunds and payment reviews
    // can still change independently of an order's preparation status.
    const stopPolling = startVisiblePolling({ refresh: load, intervalMs: 10000 });
    return () => {
      active = false;
      stopPolling();
    };
  }, [scope, id, access, getOrder, retry, auth.loading, auth.error, auth.contextId]);
  if (
    auth.loading ||
    (!auth.error && (!auth.contextId || state.scope !== scope || (!state.order && !state.error)))
  )
    return (
      <div className="container empty-state" role="status">
        Finding your order…
      </div>
    );
  if (auth.error || state.error)
    return (
      <div className="container empty-state">
        <h1>Let’s find your order.</h1>
        <p role="alert">{auth.error ?? state.error}</p>
        <p>
          Use your private tracking link, the browser where you ordered, or the Google account used
          at checkout.
        </p>
        <button
          className="btn btn-primary"
          onClick={() => {
            void auth.refresh();
            setRetry((value) => value + 1);
          }}
        >
          Try again
        </button>
        <Link href="/account/orders" className="text-link">
          My orders
        </Link>
      </div>
    );
  const cached = [...customerOrders, ...adminOrders].find((order) => order.id === id);
  const order =
    cached && (cached.version ?? 0) >= (state.order?.version ?? 0) ? cached : state.order!;
  return (
    <div className="container order-page">
      <OrderDetail
        order={order}
        confirmation={confirmation}
        canRetryPayment={customerOrders.some((candidate) => candidate.id === id)}
      />
    </div>
  );
}
