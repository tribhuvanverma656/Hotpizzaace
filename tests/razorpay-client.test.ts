import assert from 'node:assert/strict';
import test from 'node:test';
import type { Order } from '../types';
import {
  canResumeRazorpayCheckout,
  parseRazorpayCheckoutStatus,
  paymentAttemptId,
  readPaymentAttemptId,
  createRazorpayCheckoutLifecycle,
} from '../lib/payments/razorpay-client';

const orderId = '33333333-3333-4333-8333-333333333333';
const attemptId = '11111111-1111-4111-8111-111111111111';
const order: Pick<Order, 'id' | 'paymentMode' | 'paymentStatus' | 'status'> = {
  id: orderId,
  paymentMode: 'razorpay_test',
  paymentStatus: 'initiated',
  status: 'pending',
};
const ready = {
  provider: 'razorpay',
  mode: 'test',
  orderId,
  attemptId,
  resumable: true,
};

test('resume requires an explicit server capability bound to the same unpaid order, attempt and environment', () => {
  const capability = parseRazorpayCheckoutStatus(ready, { orderId, attemptId });
  assert.equal(canResumeRazorpayCheckout(order, attemptId, capability), true);
  assert.equal(
    canResumeRazorpayCheckout({ ...order, paymentMode: 'razorpay_live' }, attemptId, {
      ...capability,
      mode: 'live',
    }),
    true,
  );
  for (const change of [
    { resumable: false },
    { resumable: 'true' },
    { resumable: undefined },
    { orderId: 'another-order' },
    { attemptId: '22222222-2222-4222-8222-222222222222' },
    { mode: 'live' },
    { provider: 'another-provider' },
  ])
    assert.equal(canResumeRazorpayCheckout(order, attemptId, { ...ready, ...change }), false);
  assert.equal(
    canResumeRazorpayCheckout({ ...order, paymentStatus: 'failed' }, attemptId, capability),
    true,
  );
  for (const paymentStatus of ['paid', 'pending', 'simulated_paid'] as const)
    assert.equal(canResumeRazorpayCheckout({ ...order, paymentStatus }, attemptId, ready), false);
  for (const status of ['cancelled', 'rejected', 'confirmed', 'preparing', 'ready'] as const)
    assert.equal(canResumeRazorpayCheckout({ ...order, status }, attemptId, ready), false);
  assert.equal(
    canResumeRazorpayCheckout({ ...order, paymentMode: 'simulation' }, attemptId, ready),
    false,
  );
});

test('retired SDK dismissal, failure and proof callbacks cannot change a newer Checkout', () => {
  const lifecycle = createRazorpayCheckoutLifecycle();
  let locked = true;
  let stage = 'paying';
  let proofs = 0;
  const first = lifecycle.begin();
  const dismissed = first.guard(() => {
    locked = false;
    stage = 'dismissed';
  });
  const failed = first.guard(() => {
    locked = false;
    stage = 'failed';
  });
  const completed = first.guard(() => {
    proofs += 1;
  });
  let firstClosed = false;
  first.attach({
    close() {
      firstClosed = true;
      dismissed(); // SDK close may synchronously report dismissal.
    },
  });
  const second = lifecycle.begin();
  second.attach({ close() {} });
  assert.equal(firstClosed, true);
  dismissed();
  failed();
  completed();
  assert.equal(locked, true);
  assert.equal(stage, 'paying');
  assert.equal(proofs, 0);
  assert.equal(first.isActive(), false);
  assert.equal(second.isActive(), true);
  second.guard(() => {
    locked = false;
    stage = 'dismissed';
  })();
  assert.equal(locked, false);
  assert.equal(stage, 'dismissed');
});

test('unmount and stale asynchronous SDK setup cannot reattach or release the current lease', () => {
  const lifecycle = createRazorpayCheckoutLifecycle();
  const old = lifecycle.begin();
  const current = lifecycle.begin();
  let currentClosed = false;
  current.attach({
    close() {
      currentClosed = true;
    },
  });
  let staleClosed = false;
  assert.equal(
    old.attach({
      close: () => {
        staleClosed = true;
      },
    }),
    false,
  );
  assert.equal(staleClosed, true);
  assert.equal(currentClosed, false);
  let changes = 0;
  const callback = current.guard(() => {
    changes += 1;
  });
  lifecycle.dispose();
  callback();
  assert.equal(currentClosed, true);
  assert.equal(current.isActive(), false);
  assert.equal(changes, 0);
});

test('older or malformed backend status responses never restore Resume', () => {
  for (const value of [null, {}, { order }, { ...ready, resumable: undefined }]) {
    assert.equal(canResumeRazorpayCheckout(order, attemptId, value), false);
    assert.throws(() => parseRazorpayCheckoutStatus(value, { orderId, attemptId }));
  }
  assert.throws(() =>
    parseRazorpayCheckoutStatus({ ...ready, attemptId: 'other' }, { orderId, attemptId }),
  );
  assert.throws(() =>
    parseRazorpayCheckoutStatus({ ...ready, orderId: 'other' }, { orderId, attemptId }),
  );
  assert.equal(canResumeRazorpayCheckout(order, 'invalid-attempt', ready), false);
});

test('checking a stored attempt is read-only and preserves its identity for subsequent resume', () => {
  const scope = { userId: 'qa-user', orderId };
  const values = new Map<string, string>();
  let writes = 0;
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      writes += 1;
      values.set(key, value);
    },
  };
  assert.equal(readPaymentAttemptId(storage, scope), undefined);
  assert.equal(writes, 0);
  assert.equal(paymentAttemptId(storage, scope, attemptId), attemptId);
  assert.equal(writes, 1);
  assert.equal(readPaymentAttemptId(storage, scope), attemptId);
  assert.equal(writes, 1);
  assert.equal(readPaymentAttemptId(storage, { ...scope, userId: 'other' }), undefined);
  assert.equal(readPaymentAttemptId(storage, { ...scope, orderId: 'other' }), undefined);
  assert.equal(writes, 1);
  assert.equal(paymentAttemptId(storage, scope), attemptId);
});

test('missing or unusable browser storage cannot allocate a replacement attempt during a status check', () => {
  const scope = { userId: null, orderId };
  assert.equal(readPaymentAttemptId(undefined, scope), undefined);
  for (const value of ['not json', '{}', '{"attemptId":"not-a-uuid"}']) {
    assert.equal(
      readPaymentAttemptId(
        { getItem: () => value, setItem: () => assert.fail('status read wrote storage') },
        scope,
      ),
      undefined,
    );
  }
  assert.equal(
    readPaymentAttemptId(
      {
        getItem: () => {
          throw new Error('Storage unavailable');
        },
        setItem: () => assert.fail('status read wrote storage'),
      },
      scope,
    ),
    undefined,
  );
});

test('confirmed failures and repeated retries preserve the same provider-attempt identity', () => {
  const scope = { userId: null, orderId };
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  assert.equal(paymentAttemptId(storage, scope, attemptId), attemptId);
  assert.equal(paymentAttemptId(storage, scope), attemptId);
  assert.equal(paymentAttemptId(storage, scope), attemptId);
  assert.equal(paymentAttemptId(undefined, scope, attemptId), attemptId);
});
