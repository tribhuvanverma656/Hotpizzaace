import test from 'node:test';
import assert from 'node:assert/strict';
import { initialOrders } from '../lib/data';
import type { Order } from '../types';
import {
  getTrackingStatus,
  isActiveOrder,
  orderStatusLabels,
  trackingHref,
} from '../lib/order-tracking';

test('tracking shortcuts distinguish unpaid payment attempts and terminal fulfillment', () => {
  const base = initialOrders[0];
  assert.equal(getTrackingStatus({ ...base, paymentStatus: 'failed' }), 'Payment needs attention');
  assert.equal(getTrackingStatus({ ...base, paymentStatus: 'pending' }), 'Awaiting payment');
  assert.equal(
    getTrackingStatus({
      ...base,
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'pending',
    }),
    'Awaiting confirmation',
  );
  assert.equal(
    getTrackingStatus({ ...base, paymentStatus: 'simulated_paid', status: 'preparing' }),
    'In the oven',
  );
  for (const status of ['delivered', 'picked_up', 'cancelled', 'rejected'] as const)
    assert.equal(isActiveOrder({ ...base, status }), false);
  assert.equal(
    getTrackingStatus({ ...base, status: 'cancelled', paymentStatus: 'failed' }),
    'Order cancelled',
  );
});
test('verified Razorpay captures show fulfillment progress while incomplete or review payments stay distinct', () => {
  const base = initialOrders[0];
  for (const paymentMode of ['razorpay_test', 'razorpay_live'] as const) {
    for (const status of [
      'pending',
      'confirmed',
      'preparing',
      'ready',
      'out_for_delivery',
    ] as const)
      assert.equal(
        getTrackingStatus({ ...base, paymentMode, paymentStatus: 'paid', status }),
        orderStatusLabels[status],
      );
    for (const paymentStatus of ['initiated', 'pending', 'simulated_paid'] as const)
      assert.equal(
        getTrackingStatus({ ...base, paymentMode, paymentStatus, status: 'pending' }),
        'Awaiting payment',
      );
    assert.equal(
      getTrackingStatus({
        ...base,
        paymentMode,
        paymentStatus: 'paid',
        paymentReviewRequired: true,
        status: 'pending',
      }),
      'Payment needs attention',
    );
    assert.equal(
      getTrackingStatus({ ...base, paymentMode, paymentStatus: 'paid', status: 'cancelled' }),
      'Order cancelled',
    );
  }
  for (const paymentMode of [undefined, 'simulation'] as const)
    assert.equal(
      getTrackingStatus({ ...base, paymentMode, paymentStatus: 'paid', status: 'pending' }),
      'Awaiting payment',
    );
});

test('cash on delivery tracking follows fulfillment before collection', () => {
  const base = initialOrders[0];
  for (const status of ['pending', 'confirmed', 'preparing', 'out_for_delivery'] as const)
    assert.equal(
      getTrackingStatus({ ...base, paymentMethod: 'cash', paymentStatus: 'pending', status }),
      orderStatusLabels[status],
    );
});

test('tracking links preserve the selected order without exposing contact information', () => {
  assert.equal(trackingHref({ id: 'order-a/b' }), '/track-order?order=order-a%2Fb');
});

test('processed refunds remain distinct from awaiting payment and completed fulfillment', () => {
  for (const status of ['pending', 'preparing', 'picked_up'] as const) {
    for (const refundStatus of ['partial', 'full'] as const) {
      const order: Order = {
        ...initialOrders[0],
        status,
        paymentMode: 'razorpay_live',
        paymentStatus: 'paid',
        refund: { amount: 1, status: refundStatus, entries: [] },
      };
      assert.equal(
        getTrackingStatus(order),
        refundStatus === 'full' ? 'Refunded' : 'Partial refund',
      );
    }
  }
});
