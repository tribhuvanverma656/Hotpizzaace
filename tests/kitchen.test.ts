import assert from 'node:assert/strict';
import test from 'node:test';
import { kitchenOrders } from '../lib/kitchen';
import { initialOrders } from '../lib/data';
import type { Order } from '../types';

test('kitchen queue contains accepted payable orders only, for one branch, oldest first', () => {
  const base = {
    ...initialOrders[0],
    branchId: 'barra',
    paymentMode: 'razorpay_live',
    paymentStatus: 'paid',
    paymentMethod: 'upi',
    status: 'confirmed',
  } as Order;
  const rows = [
    { ...base, id: 'later', createdAt: '2026-10-23T11:00:00Z' },
    { ...base, id: 'oldest', createdAt: '2026-10-23T10:00:00Z', status: 'preparing' },
    ...(
      [
        'pending',
        'ready',
        'delivered',
        'picked_up',
        'cancelled',
        'rejected',
        'out_for_delivery',
      ] as const
    ).map((status) => ({ ...base, id: status, status })),
    { ...base, id: 'unpaid', paymentStatus: 'initiated' },
    { ...base, id: 'review', paymentReviewRequired: true },
    {
      ...base,
      id: 'refunded-without-review',
      refund: { amount: 1, status: 'partial', entries: [] },
    },
    { ...base, id: 'other', branchId: 'other' },
    {
      ...base,
      id: 'cash',
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      createdAt: '2026-10-23T12:00:00Z',
    },
  ] as Order[];
  assert.deepEqual(
    kitchenOrders(rows, 'barra').map((o) => o.id),
    ['oldest', 'later', 'cash'],
  );
  assert.deepEqual(kitchenOrders(rows, 'unknown'), []);
  assert.deepEqual(
    kitchenOrders(rows, 'other').map((o) => o.id),
    ['other'],
  );
  // Branch identity controls the queue even when two branches have the same display name.
  assert.deepEqual(
    kitchenOrders(
      rows.map((row) => ({ ...row, branchName: 'Same branch name' })),
      'barra',
    ).map((o) => o.id),
    ['oldest', 'later', 'cash'],
  );
});
