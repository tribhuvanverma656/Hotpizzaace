import type { Order } from '../types';

/** Self-service cancellation is limited to unpaid website orders awaiting acceptance. */
export function canCancelUnpaidOrder(order: Order): boolean {
  return (
    (order.channel === undefined || order.channel === 'website') &&
    order.status === 'pending' &&
    order.paymentMethod !== 'cash' &&
    ['initiated', 'pending', 'failed'].includes(order.paymentStatus) &&
    !order.paymentReviewRequired &&
    !order.refundSyncPending &&
    !order.refund
  );
}
