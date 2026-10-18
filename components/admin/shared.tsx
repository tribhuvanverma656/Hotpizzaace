'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { Order, OrderStatus } from '@/types';
import { getAllowedOrderStatuses, isRevenueEligible as eligible } from '@/lib/pricing';

export const statusLabels: Record<OrderStatus, string> = {
  pending: 'Pending confirmation',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  ready: 'Ready',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  picked_up: 'Picked up',
  cancelled: 'Cancelled',
  rejected: 'Rejected',
};
export function StatusPill({ status }: { status: OrderStatus }) {
  return <span className={`status-pill status-${status}`}>{statusLabels[status]}</span>;
}
export function PaymentPill({ order }: { order: Order }) {
  return (
    <span
      className={`payment-label ${order.paymentStatus === 'simulated_paid' ? 'payment-paid' : ''}`}
    >
      {order.paymentStatus === 'simulated_paid'
        ? 'Paid · simulated'
        : order.paymentStatus === 'failed'
          ? 'Failed · demo'
          : order.paymentMethod === 'cash'
            ? 'Cash · unpaid'
            : `${order.paymentStatus} · demo`}
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
  onConfirm: () => void;
  destructive?: boolean;
  label?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="admin-dialog-overlay" />
        <Dialog.Content className="admin-dialog">
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description>{description}</Dialog.Description>
          <Dialog.Close className="admin-dialog-close" aria-label="Close confirmation">
            <X size={18} />
          </Dialog.Close>
          <div className="admin-actions">
            <Dialog.Close className="btn btn-outline">Go back</Dialog.Close>
            <button
              className={`btn ${destructive ? 'btn-primary' : 'btn-dark'}`}
              onClick={() => {
                onConfirm();
                onOpenChange(false);
              }}
            >
              {label}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
