import type { Order } from '@/types';
import { normalizeCustomerPhone } from './customer-auth';
import { hasProcessedRefund, isOnlinePaymentComplete } from './pricing';

export const orderStatusLabels = {
  pending: 'Awaiting confirmation',
  confirmed: 'Order confirmed',
  preparing: 'In the oven',
  ready: 'Ready to go',
  out_for_delivery: 'On the way',
  delivered: 'Delivered with love',
  picked_up: 'Picked up',
  served: 'Served',
  closed: 'Closed',
  cancelled: 'Order cancelled',
  rejected: 'Order declined',
} as const;

/** Browser-local demo filtering only; production order ownership must be enforced on the server. */
export function getOrdersForCustomer(orders: Order[], phone: string) {
  const customerPhone = normalizeCustomerPhone(phone);
  return orders
    .filter((order) => {
      if (order.channel === 'counter' || order.fulfillment === 'dine_in') return false;
      try {
        return normalizeCustomerPhone(order.customer.phone) === customerPhone;
      } catch {
        return false;
      }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function isActiveOrder(order: Order) {
  return !['delivered', 'picked_up', 'closed', 'cancelled', 'rejected'].includes(order.status);
}

export function getTrackingStatus(order: Order) {
  if (hasProcessedRefund(order))
    return order.refund?.status === 'full' ? 'Refunded' : 'Partial refund';
  if (!isActiveOrder(order)) return orderStatusLabels[order.status];
  if (order.paymentMethod !== 'cash' && !isOnlinePaymentComplete(order)) {
    return order.paymentStatus === 'failed' || order.paymentReviewRequired
      ? 'Payment needs attention'
      : 'Awaiting payment';
  }
  return orderStatusLabels[order.status];
}

export function trackingHref(order: Pick<Order, 'id'>) {
  return `/track-order?order=${encodeURIComponent(order.id)}`;
}
