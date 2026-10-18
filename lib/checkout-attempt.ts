import type { Order } from '../types';

export type CheckoutAttempt = { key: string; fingerprint: string; orderId?: string };
type AttemptDecision = { action: 'reuse' | 'fresh'; cancelOrderId?: string };

/** Reuse only an unfinished online checkout, never an already placed cash or paid order. */
export function resolveCheckoutAttempt(
  attempt: CheckoutAttempt | null,
  fingerprint: string,
  previous?: Pick<Order, 'id' | 'number' | 'paymentMethod' | 'paymentStatus' | 'status'>,
): AttemptDecision {
  if (!attempt || (attempt.orderId && !previous)) return { action: 'fresh' };
  if (
    previous &&
    (previous.paymentMethod === 'cash' ||
      previous.paymentStatus === 'simulated_paid' ||
      previous.status === 'cancelled' ||
      previous.status === 'rejected')
  )
    return { action: 'fresh' };
  if (attempt.fingerprint === fingerprint) return { action: 'reuse' };
  if (!previous) return { action: 'fresh' };
  if (previous.status !== 'pending')
    throw new Error(
      `Order ${previous.number} is already being prepared. View that order before starting a different checkout.`,
    );
  return { action: 'fresh', cancelOrderId: previous.id };
}
