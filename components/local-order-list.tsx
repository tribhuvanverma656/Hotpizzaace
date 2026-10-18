'use client';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { Order } from '@/types';
import { getTrackingStatus, trackingHref } from '@/lib/order-tracking';
import { money } from '@/lib/utils';
export function LocalOrderList({ orders }: { orders: Order[] }) {
  return (
    <div className="history-grid">
      {orders.map((order) => (
        <article className="history-card" key={order.id}>
          <div>
            <strong>{order.number}</strong>
            <span className="status-pill">{getTrackingStatus(order)}</span>
          </div>
          <p>
            {new Date(order.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} ·{' '}
            {order.fulfillment}
          </p>
          <h3>{order.items.map((item) => `${item.quantity} × ${item.name}`).join(', ')}</h3>
          <div>
            <b>{money(order.total)}</b>
            <Link href={trackingHref(order)} className="text-link">
              Track order <ArrowRight size={16} />
            </Link>
          </div>
          <small>
            Payment: {order.paymentStatus.replaceAll('_', ' ')} · Demo order on this device
          </small>
        </article>
      ))}
    </div>
  );
}
