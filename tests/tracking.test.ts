import test from 'node:test';
import assert from 'node:assert/strict';
import { initialOrders } from '../lib/data';
import { getTrackingStatus, isActiveOrder, trackingHref } from '../lib/order-tracking';

test('tracking shortcuts distinguish unpaid payment attempts and terminal fulfillment', () => {
  const base = initialOrders[0];
  assert.equal(getTrackingStatus({ ...base, paymentStatus: 'failed' }), 'Payment needs attention');
  assert.equal(getTrackingStatus({ ...base, paymentStatus: 'pending' }), 'Awaiting demo payment');
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
test('tracking links preserve the selected order without exposing contact information', () => {
  assert.equal(trackingHref({ id: 'order-a/b' }), '/track-order?order=order-a%2Fb');
});
