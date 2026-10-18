'use client';

import Link from 'next/link';
import { ArrowRight, PackageSearch } from 'lucide-react';
import { useDemoStore } from '@/lib/store';
import {
  getOrdersForCustomer,
  getTrackingStatus,
  isActiveOrder,
  trackingHref,
} from '@/lib/order-tracking';

export function OrderTrackingShortcut({ banner = false }: { banner?: boolean }) {
  const { orders, customerSession, hydrated } = useDemoStore();
  const localOrders = customerSession ? getOrdersForCustomer(orders, customerSession.phone) : [];
  const order = banner ? localOrders.find(isActiveOrder) : localOrders[0];
  if (!hydrated || (banner && !order)) return null;
  if (!order)
    return (
      <Link
        href={customerSession ? '/track-order' : '/account/orders'}
        className="recent-order-shortcut"
      >
        <span className="tracking-shortcut-icon">
          <PackageSearch size={21} />
        </span>
        <span className="tracking-shortcut-copy">
          <strong>Already placed an order?</strong>
          <small>
            {customerSession
              ? 'Find it with your order number and mobile.'
              : 'Sign in with your checkout mobile to see your orders.'}
          </small>
        </span>
        <span className="tracking-shortcut-action">
          Track order <ArrowRight size={16} />
        </span>
      </Link>
    );
  return (
    <Link
      href={trackingHref(order)}
      className={banner ? 'active-order-banner container' : 'recent-order-shortcut'}
    >
      <span className="tracking-shortcut-icon">
        <PackageSearch size={21} />
      </span>
      <span className="tracking-shortcut-copy">
        <strong>{banner ? getTrackingStatus(order) : 'Already ordered? Track it here.'}</strong>
        <small>
          {order.number}
          {!banner && ` · ${getTrackingStatus(order)}`}
        </small>
      </span>
      <span className="tracking-shortcut-action">
        Track order <ArrowRight size={16} />
      </span>
    </Link>
  );
}
