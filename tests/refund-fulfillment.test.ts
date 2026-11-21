import assert from 'node:assert/strict';
import test from 'node:test';
import { initialOrders } from '../lib/data';
import {
  getAllowedOrderStatuses,
  isOnlinePaymentComplete,
  isRevenueEligible,
  isSimulatedRevenueEligible,
} from '../lib/pricing';
import type { Order } from '../types';

test('processed partial and full refunds block fulfillment and completed-sale eligibility without relying on the review flag', () => {
  const captured: Order = {
    ...initialOrders[0],
    paymentMode: 'razorpay_live',
    paymentStatus: 'paid',
    paymentMethod: 'upi',
    paymentReviewRequired: false,
    status: 'picked_up',
  };
  assert.equal(isOnlinePaymentComplete(captured), true);
  assert.equal(isRevenueEligible(captured), true);
  for (const amount of [1, captured.total]) {
    const refunded: Order = {
      ...captured,
      refund: {
        amount,
        status: amount === captured.total ? 'full' : 'partial',
        entries: [
          {
            id: 'rfnd_qa',
            amount,
            processedAt: '2026-10-30T05:00:00Z',
            timestampSource: 'provider_event',
          },
        ],
      },
    };
    assert.equal(isOnlinePaymentComplete(refunded), false);
    assert.equal(isRevenueEligible(refunded), false);
    assert.equal(isSimulatedRevenueEligible({ ...refunded, paymentMode: 'razorpay_test' }), false);
    for (const status of [
      'pending',
      'confirmed',
      'preparing',
      'ready',
      'out_for_delivery',
    ] as const)
      assert.deepEqual(getAllowedOrderStatuses({ ...refunded, status }), []);
    assert.equal(refunded.paymentStatus, 'paid');
    assert.equal(refunded.total, captured.total);
  }
});
