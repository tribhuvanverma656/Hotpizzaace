import { isGatewayMode } from './payments/method';
import type { Order } from '../types';
import { getOrderBranchId } from './branches';
import { counterKitchenEligible } from './counter';
import { hasProcessedRefund } from './pricing';

/** Confirmation is the restaurant's acceptance gate; unpaid online orders never enter preparation. */
export function kitchenOrders(orders: Order[], branchId: string): Order[] {
  return orders
    .filter(
      (order) =>
        getOrderBranchId(order) === branchId &&
        ['confirmed', 'preparing'].includes(order.status) &&
        !order.paymentReviewRequired &&
        !hasProcessedRefund(order) &&
        (order.channel === 'counter'
          ? counterKitchenEligible(order)
          : order.paymentMethod === 'cash' ||
            (order.paymentStatus === 'paid' && isGatewayMode(order.paymentMode)) ||
            (order.paymentStatus === 'simulated_paid' &&
              (!order.paymentMode || order.paymentMode === 'simulation'))),
    )
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}
