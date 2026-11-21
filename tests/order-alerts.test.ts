import assert from 'node:assert/strict';
import test from 'node:test';
import { initialOrders } from '../lib/data';
import { websiteOrderAlertIds } from '../lib/order-alerts';
import { newOrderIds } from '../components/order-sound';
import type { Order } from '../types';

const base = { ...initialOrders[0], channel: 'website' as const, testVoid: undefined };
const order = (id: string, change: Partial<Order>): Order => ({ ...base, id, ...change }) as Order;

test('only website orders the restaurant must act on trigger the admin sound', () => {
  const orders = [
    order('paid', { status: 'pending', paymentMethod: 'upi', paymentStatus: 'paid' }),
    order('cash', { status: 'pending', paymentMethod: 'cash', paymentStatus: 'pending' }),
    order('unpaid', { status: 'pending', paymentMethod: 'upi', paymentStatus: 'initiated' }),
    order('failed', { status: 'pending', paymentMethod: 'upi', paymentStatus: 'failed' }),
    order('counter', {
      status: 'confirmed',
      channel: 'counter',
      paymentMethod: 'cash',
      paymentStatus: 'paid',
    }),
    order('preparing', { status: 'preparing', paymentMethod: 'upi', paymentStatus: 'paid' }),
    order('cancelled', { status: 'cancelled', paymentMethod: 'cash' }),
    order('removed', {
      status: 'pending',
      paymentMethod: 'cash',
      testVoid: { kind: 'no_money_software_test', recordedAt: '', reason: 'test' },
    }),
  ];
  assert.deepEqual(websiteOrderAlertIds(orders), ['paid', 'cash']);
});

test('the chime fires only for ids the screen has not already seen', () => {
  const seen = new Set(['a', 'b']);
  assert.deepEqual(newOrderIds(seen, ['a', 'b']), []);
  assert.deepEqual(newOrderIds(seen, ['b']), []);
  assert.deepEqual(newOrderIds(seen, ['a', 'c', 'd']), ['c', 'd']);
  assert.deepEqual(newOrderIds(new Set(), []), []);
});

test('accepted and payment-review orders stop alerting', () => {
  assert.deepEqual(
    websiteOrderAlertIds([
      order('accepted', { status: 'confirmed', paymentStatus: 'paid' }),
      order('review', { status: 'pending', paymentStatus: 'paid', paymentReviewRequired: true }),
      order('refund-sync', { status: 'pending', paymentStatus: 'paid', refundSyncPending: true }),
    ]),
    [],
  );
});
