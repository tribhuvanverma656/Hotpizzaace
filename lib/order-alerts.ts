import type { Order } from '../types';

/**
 * Website orders the restaurant must act on: placed online (not at the counter), not removed,
 * still awaiting acceptance, and either cash or already paid online. Unpaid
 * online attempts stay silent until the payment is confirmed.
 */
export function websiteOrderAlertIds(orders: readonly Order[]): string[] {
  return orders
    .filter(
      (order) =>
        order.channel !== 'counter' &&
        !order.testVoid &&
        order.status === 'pending' &&
        !order.paymentReviewRequired &&
        !order.refundSyncPending &&
        !order.refund &&
        (order.paymentMethod === 'cash' ||
          order.paymentStatus === 'paid' ||
          order.paymentStatus === 'simulated_paid'),
    )
    .map((order) => order.id);
}
