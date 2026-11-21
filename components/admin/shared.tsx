'use client';
import {
  gatewayLabels,
  gatewayProvider,
  isGatewayMode,
  isTestGatewayMode,
} from '@/lib/payments/method';

import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { Order, OrderStatus } from '@/types';
import {
  getAllowedOrderStatuses,
  hasProcessedRefund,
  isRevenueEligible as eligible,
} from '@/lib/pricing';

export const statusLabels: Record<OrderStatus, string> = {
  pending: 'Pending confirmation',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  ready: 'Ready',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  picked_up: 'Picked up',
  served: 'Served',
  closed: 'Closed',
  cancelled: 'Cancelled',
  rejected: 'Rejected',
};
export function StatusPill({ status }: { status: OrderStatus }) {
  return <span className={`status-pill status-${status}`}>{statusLabels[status]}</span>;
}
export function PaymentPill({ order }: { order: Order }) {
  const refunded = hasProcessedRefund(order);
  return (
    <span
      className={`payment-label ${!refunded && !order.refundSyncPending && !order.paymentReviewRequired && ['simulated_paid', 'paid'].includes(order.paymentStatus) ? 'payment-paid' : ''}`}
    >
      {order.refundSyncPending
        ? `Refund needs reconciliation${isTestGatewayMode(order.paymentMode) ? ' · test' : ''}`
        : refunded
          ? `${order.refund?.status === 'full' ? 'Refunded' : 'Partial refund'}${isTestGatewayMode(order.paymentMode) ? ' · test' : ''}`
          : order.paymentReviewRequired
            ? 'Payment needs review'
            : order.paymentMode === 'counter_manual'
              ? order.paymentStatus === 'paid'
                ? `${order.paymentMethod === 'cash' ? 'Cash' : 'UPI'} received · staff confirmed`
                : 'Unpaid · pay later approved'
              : order.paymentStatus === 'paid'
                ? isTestGatewayMode(order.paymentMode)
                  ? 'Captured · test'
                  : 'Paid · verified'
                : order.paymentStatus === 'simulated_paid'
                  ? 'Paid · simulated'
                  : order.paymentStatus === 'failed'
                    ? isGatewayMode(order.paymentMode)
                      ? 'Failed'
                      : 'Failed · demo'
                    : order.paymentMethod === 'cash'
                      ? 'Cash · unpaid'
                      : `${order.paymentStatus}${gatewayProvider(order.paymentMode) ? ` · ${gatewayLabels[gatewayProvider(order.paymentMode)!]}` : ' · demo'}`}
    </span>
  );
}
export function dateTime(date: string) {
  return new Date(date).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}
export function localDate(date: string) {
  return new Date(date).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}
export function isRevenueEligible(order: Order) {
  return eligible(order);
}
export function nextStatuses(order: Order): OrderStatus[] {
  return getAllowedOrderStatuses(order);
}
export function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      {children}
    </div>
  );
}
export function ConfirmAction({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  destructive = false,
  label = 'Confirm',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onConfirm: () => void | Promise<void>;
  destructive?: boolean;
  label?: string;
}) {
  const [pending, setPending] = useState(false);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="admin-dialog-overlay" />
        <Dialog.Content className="admin-dialog">
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description>{description}</Dialog.Description>
          <Dialog.Close className="admin-dialog-close" aria-label="Close confirmation">
            <X size={18} />
          </Dialog.Close>
          <div className="admin-actions">
            <Dialog.Close className="btn btn-outline" disabled={pending}>
              Go back
            </Dialog.Close>
            <button
              className={`btn ${destructive ? 'btn-primary' : 'btn-dark'}`}
              disabled={pending}
              onClick={async () => {
                setPending(true);
                try {
                  await onConfirm();
                  onOpenChange(false);
                } finally {
                  setPending(false);
                }
              }}
            >
              {pending ? 'Saving…' : label}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
