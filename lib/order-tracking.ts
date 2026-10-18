import type { Order } from '@/types';
import { normalizeCustomerPhone } from './customer-auth';

export const orderStatusLabels = {
  pending: 'Awaiting confirmation',
  confirmed: 'Order confirmed',
  preparing: 'In the oven',
  ready: 'Ready to go',
  out_for_delivery: 'On the way',
  delivered: 'Delivered with love',
  picked_up: 'Picked up',
  cancelled: 'Order cancelled',
  rejected: 'Order declined',
} as const;

/** Browser-local demo filtering only; production order ownership must be enforced on the server. */
export function getOrdersForCustomer(orders: Order[], phone: string) {
  const customerPhone = normalizeCustomerPhone(phone);
  return orders
    .filter((order) => {
      try {
        return normalizeCustomerPhone(order.customer.phone) === customerPhone;
      } catch {
        return false;
      }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function isActiveOrder(order: Order) {
  return !['delivered', 'picked_up', 'cancelled', 'rejected'].includes(order.status);
}

export function getTrackingStatus(order: Order) {
  if (!isActiveOrder(order)) return orderStatusLabels[order.status];
  if (order.paymentMethod !== 'cash' && order.paymentStatus !== 'simulated_paid') {
    return order.paymentStatus === 'failed' ? 'Payment needs attention' : 'Awaiting demo payment';
  }
  return orderStatusLabels[order.status];
}

export function trackingHref(order: Pick<Order, 'id'>) {
  return `/track-order?order=${encodeURIComponent(order.id)}`;
}
