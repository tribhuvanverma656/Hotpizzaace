'use client';

import Link from 'next/link';
import { ArrowRight, ShoppingBag } from 'lucide-react';
import { useCustomerAuth } from './customer-auth-provider';
import { useSharedCommerce } from './shared-commerce-provider';
import { LocalOrderList } from './local-order-list';

export function SharedOrderHistory({ compact = false }: { compact?: boolean }) {
  const shared = useSharedCommerce();
  const auth = useCustomerAuth();
  const orders = compact ? shared.customerOrders.slice(0, 4) : shared.customerOrders;
  return (
    <div className={compact ? 'recent-tracking-orders' : 'container journey-page'}>
      <div className="page-heading account-orders-heading">
        <div>
          <span className="eyebrow">YOUR PIZZA, YOUR PROGRESS</span>
          <h1>Your orders.</h1>
          <p>
            {auth.user
              ? 'Orders placed with your Google account are available on every device.'
              : 'Guest orders are available in the browser where you placed them. Keep your private tracking link to reopen an order elsewhere.'}
          </p>
        </div>
        {!auth.user && (
          <Link href="/account/login?next=/account/orders" className="btn btn-outline">
            Sign in with Google <ArrowRight size={16} />
          </Link>
        )}
      </div>
      {shared.ordersError || shared.error ? (
        <div className="empty-state">
          <p className="error-message" role="alert">
            {shared.ordersError || shared.error}
          </p>
          <button className="btn btn-primary" onClick={() => void shared.refresh()}>
            Try again
          </button>
        </div>
      ) : !shared.ready || shared.ordersLoading ? (
        <div className="empty-state" role="status">
          Loading your orders…
        </div>
      ) : orders.length ? (
        <LocalOrderList orders={orders} shared />
      ) : (
        <div className="empty-state">
          <ShoppingBag size={38} />
          <h2>Your next favourite order starts here.</h2>
          <p>
            {auth.user
              ? 'New orders placed while signed in will appear here.'
              : 'There are no guest orders in this browser yet. Sign in before ordering to save future orders to your account.'}
          </p>
          <Link href="/menu" className="btn btn-primary">
            Explore the menu <ArrowRight size={17} />
          </Link>
        </div>
      )}
    </div>
  );
}
