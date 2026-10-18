import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCheckoutAttempt, type CheckoutAttempt } from '../lib/checkout-attempt';
import { initialOrders, initialProducts, initialSettings } from '../lib/data';
import { useDemoStore } from '../lib/store';
import type { Branch, CheckoutInput, Order, OrderStatus, PaymentStatus } from '../types';

const attempt: CheckoutAttempt = {
  key: 'existing-checkout-key',
  fingerprint: 'same',
  orderId: 'previous',
};
const previous: Order = {
  ...initialOrders[0],
  id: 'previous',
  number: 'HPA-PREVIOUS',
  paymentMethod: 'upi',
  paymentStatus: 'initiated',
  status: 'pending',
};

test('completed cash and paid checkouts always get a new attempt, including identical repeat orders', () => {
  for (const paymentMethod of ['cash', 'upi', 'card'] as const) {
    for (const status of [
      'pending',
      'confirmed',
      'preparing',
      'delivered',
      'cancelled',
      'rejected',
    ] as OrderStatus[]) {
      const order = {
        ...previous,
        paymentMethod,
        status,
        paymentStatus:
          paymentMethod === 'cash' ? ('pending' as const) : ('simulated_paid' as const),
      };
      for (const fingerprint of ['same', 'different'])
        assert.deepEqual(resolveCheckoutAttempt(attempt, fingerprint, order), { action: 'fresh' });
    }
  }
});

test('unchanged unpaid online attempts reuse their checkout key for retries', () => {
  for (const paymentMethod of ['upi', 'card'] as const)
    for (const paymentStatus of ['initiated', 'pending', 'failed'] as PaymentStatus[])
      for (const status of ['pending', 'confirmed', 'preparing'] as OrderStatus[])
        assert.deepEqual(
          resolveCheckoutAttempt(attempt, 'same', {
            ...previous,
            paymentMethod,
            paymentStatus,
            status,
          }),
          { action: 'reuse' },
        );
});

test('only superseded unpaid pending online orders can be automatically cancelled', () => {
  for (const paymentMethod of ['upi', 'card'] as const) {
    for (const paymentStatus of ['initiated', 'pending', 'failed'] as PaymentStatus[]) {
      assert.deepEqual(
        resolveCheckoutAttempt(attempt, 'different', { ...previous, paymentMethod, paymentStatus }),
        { action: 'fresh', cancelOrderId: 'previous' },
      );
      for (const status of ['confirmed', 'preparing', 'ready', 'out_for_delivery'] as OrderStatus[])
        assert.throws(
          () =>
            resolveCheckoutAttempt(attempt, 'different', {
              ...previous,
              paymentMethod,
              paymentStatus,
              status,
            }),
          /HPA-PREVIOUS is already being prepared/,
        );
    }
  }
});

test('cancelled, rejected and missing saved orders start a fresh checkout', () => {
  for (const status of ['cancelled', 'rejected'] as const)
    for (const fingerprint of ['same', 'different'])
      assert.deepEqual(resolveCheckoutAttempt(attempt, fingerprint, { ...previous, status }), {
        action: 'fresh',
      });
  assert.deepEqual(resolveCheckoutAttempt(null, 'same'), { action: 'fresh' });
  assert.deepEqual(resolveCheckoutAttempt(attempt, 'same'), { action: 'fresh' });
  const notCreatedYet = { key: 'unsubmitted-key', fingerprint: 'same' };
  assert.deepEqual(resolveCheckoutAttempt(notCreatedYet, 'same'), { action: 'reuse' });
  assert.deepEqual(resolveCheckoutAttempt(notCreatedYet, 'different'), { action: 'fresh' });
});

test('placing another identical cash or paid order preserves the first receipt and creates a new order', () => {
  const baseline = useDemoStore.getState();
  try {
    const settings = {
      ...structuredClone(initialSettings),
      acceptingOrders: true,
      temporarilyClosed: false,
      minimumOrder: 0,
      paymentMethods: ['upi', 'card', 'cash'] as Branch['settings']['paymentMethods'],
    };
    const branch: Branch = { id: 'barra', slug: 'barra', name: 'Barra', settings };
    const product = {
      ...initialProducts.find((product) => product.slug === 'french-fries')!,
      price: 30000,
    };
    const cart = [
      { id: 'repeat-item', productId: product.id, quantity: 1, toppingIds: [], notes: '' },
    ];
    const input: CheckoutInput = {
      customer: {
        name: 'Repeat Customer',
        phone: '9876543210',
        address: '123 Test Street, Barra',
        locality: 'Barra',
        postalCode: '208027',
        landmark: '',
        instructions: '',
      },
      fulfillment: 'delivery',
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      idempotencyKey: 'first-checkout-key',
    };
    for (const paymentMethod of ['cash', 'upi'] as const) {
      useDemoStore.setState({
        branches: [branch],
        settings,
        selectedBranchId: 'barra',
        adminBranchId: 'barra',
        cartBranchId: 'barra',
        products: [product],
        orders: [],
        cart: structuredClone(cart),
        coupon: '',
        idempotencyKeys: {},
      });
      const first = useDemoStore
        .getState()
        .createOrder({
          ...input,
          paymentMethod,
          paymentStatus: paymentMethod === 'cash' ? 'pending' : 'simulated_paid',
        });
      const snapshot = structuredClone(first);
      useDemoStore.getState().updateOrderStatus(first.id, 'confirmed');
      const placed = useDemoStore.getState().orders.find((order) => order.id === first.id)!;
      useDemoStore.setState({ cart: structuredClone(cart) });
      const savedAttempt = {
        key: input.idempotencyKey,
        fingerprint: 'identical-order',
        orderId: first.id,
      };
      const decision = resolveCheckoutAttempt(savedAttempt, 'identical-order', placed);
      assert.equal(decision.action, 'fresh');
      assert.equal(decision.cancelOrderId, undefined);
      const second = useDemoStore
        .getState()
        .createOrder({
          ...input,
          paymentMethod,
          paymentStatus: paymentMethod === 'cash' ? 'pending' : 'simulated_paid',
          idempotencyKey: 'second-checkout-key',
        });
      assert.notEqual(second.id, first.id);
      assert.equal(useDemoStore.getState().orders.length, 2);
      assert.deepEqual(
        useDemoStore.getState().orders.find((order) => order.id === first.id),
        { ...snapshot, status: 'confirmed' },
      );
    }
  } finally {
    useDemoStore.setState(baseline);
  }
});
