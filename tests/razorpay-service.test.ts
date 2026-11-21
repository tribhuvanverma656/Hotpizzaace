import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import {
  prepareRazorpayCheckout,
  confirmRazorpayCheckout,
  readRazorpayCheckoutStatus,
} from '../lib/payments/service';
import type { RazorpayConfig } from '../lib/payments/razorpay';

const attemptId = '11111111-1111-4111-8111-111111111111';
const config: RazorpayConfig = {
  mode: 'test',
  paymentMode: 'razorpay_test',
  keyId: 'rzp_test_fixture123',
  keySecret: 'fixture-only-secret-123',
  webhookSecret: 'fixture-webhook-secret-123',
};
function fixture(existing = false) {
  const attempt = {
    id: attemptId,
    order_id: 'internal-order',
    mode: 'test',
    amount: 22996,
    currency: 'INR',
    receipt: `hpa_${attemptId}`,
    state: existing ? 'ready' : 'creating',
    provider_order_id: (existing ? 'order_fixture123' : null) as string | null,
  };
  let created = existing;
  const calls: string[] = [];
  const history = {
    data: [] as unknown,
    count: 0 as number | null,
    error: null as { message?: string } | null,
  };
  const historyResponses: (typeof history)[] = [];
  const historyQueries: unknown[][] = [];
  const historyQuery = {
    eq(column: string, value: string) {
      historyQueries.push(['eq', column, value]);
      return historyQuery;
    },
    neq(column: string, value: string) {
      historyQueries.push(['neq', column, value]);
      return historyQuery;
    },
    async limit(count: number) {
      historyQueries.push(['limit', count]);
      return historyResponses.shift() ?? history;
    },
  };
  let applied = 0;
  const db = {
    from(table: string) {
      historyQueries.push(['from', table]);
      return {
        select(columns: string, options: { count: 'exact' }) {
          historyQueries.push(['select', columns, options]);
          return historyQuery;
        },
      };
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push(name);
      if (name === 'hpa_payment_reserve') {
        const fresh = !created;
        created = true;
        return { data: { attempt: { ...attempt }, create: fresh }, error: null };
      }
      if (name === 'hpa_payment_bind') {
        attempt.provider_order_id = String(args.p_provider_order_id);
        attempt.state = 'ready';
        return { data: { ...attempt }, error: null };
      }
      if (name === 'hpa_payment_mark_unknown') {
        attempt.state = 'unknown';
        return { data: null, error: null };
      }
      if (name === 'hpa_payment_find') return { data: { ...attempt }, error: null };
      if (name === 'hpa_payment_apply') {
        applied++;
        return {
          data: {
            id: 'internal-order',
            paymentStatus: args.p_status === 'captured' ? 'paid' : 'initiated',
          },
          error: null,
        };
      }
      throw new Error('Unexpected RPC');
    },
  };
  return {
    attempt,
    db,
    calls,
    history,
    historyQueries,
    historyResponses,
    get applied() {
      return applied;
    },
  };
}
test('repeated checkout uses one stored provider order and the exact GST-inclusive server amount', async () => {
  const state = fixture();
  let external = 0;
  let reads = 0;
  const request: typeof fetch = async (url, options) => {
    if (options?.method === 'GET') {
      reads++;
      assert.equal(url, 'https://api.razorpay.com/v1/orders/order_fixture123/payments');
      return Response.json({ entity: 'collection', count: 0, items: [] });
    }
    external++;
    assert.equal(JSON.parse(String(options?.body)).amount, 22996);
    return Response.json({
      id: 'order_fixture123',
      entity: 'order',
      amount: 22996,
      currency: 'INR',
      receipt: state.attempt.receipt,
      status: 'created',
      amount_paid: 0,
      amount_due: 22996,
    });
  };
  const first = await prepareRazorpayCheckout(
    state.db,
    config,
    'internal-order',
    { attemptId },
    request,
  );
  const second = await prepareRazorpayCheckout(
    state.db,
    config,
    'internal-order',
    { attemptId },
    request,
  );
  assert.deepEqual(first, second);
  assert.equal(external, 1);
  assert.equal(reads, 1);
  assert.equal(first.amount, 22996);
  assert.equal('keySecret' in first, false);
  assert.equal('webhookSecret' in first, false);
});
test('a marked new bill gateway setup sends its frozen rounded payable amount exactly once', async () => {
  const state = fixture();
  state.attempt.amount = 22100;
  let creates = 0;
  const request: typeof fetch = async (_url, options) => {
    if (options?.method === 'GET')
      return Response.json({ entity: 'collection', count: 0, items: [] });
    creates++;
    const body = JSON.parse(String(options?.body));
    assert.equal(body.amount, 22100);
    return Response.json({
      id: 'order_fixture123',
      entity: 'order',
      amount: 22100,
      currency: 'INR',
      receipt: state.attempt.receipt,
      status: 'created',
      amount_paid: 0,
      amount_due: 22100,
    });
  };
  const first = await prepareRazorpayCheckout(
    state.db,
    config,
    'internal-order',
    { attemptId },
    request,
  );
  const resumed = await prepareRazorpayCheckout(
    state.db,
    config,
    'internal-order',
    { attemptId },
    request,
  );
  assert.equal(first.amount, 22100);
  assert.deepEqual(first, resumed);
  assert.equal(creates, 1);
});

test('an uncertain upstream create timeout is never blindly repeated', async () => {
  const state = fixture();
  let external = 0;
  const request: typeof fetch = async () => {
    external++;
    throw new Error('PRIVATE_CREDENTIAL_DIAGNOSTIC');
  };
  await assert.rejects(
    prepareRazorpayCheckout(state.db, config, 'internal-order', { attemptId }, request),
    /provider could not verify/,
  );
  assert.equal(state.attempt.state, 'unknown');
  await assert.rejects(
    prepareRazorpayCheckout(state.db, config, 'internal-order', { attemptId }, request),
    /not confirmed/,
  );
  assert.equal(external, 1);
});
test('browser success needs both stored-order HMAC and a matching captured provider payment', async () => {
  const state = fixture();
  state.attempt.provider_order_id = 'order_fixture123';
  const proof = {
    attemptId,
    razorpay_order_id: 'order_fixture123',
    razorpay_payment_id: 'pay_fixture123',
    razorpay_signature: createHmac('sha256', config.keySecret)
      .update('order_fixture123|pay_fixture123')
      .digest('hex'),
  };
  const request: typeof fetch = async () =>
    Response.json({
      id: 'pay_fixture123',
      entity: 'payment',
      order_id: 'order_fixture123',
      amount: 22996,
      currency: 'INR',
      captured: true,
      status: 'captured',
      amount_refunded: 0,
    });
  await assert.rejects(
    confirmRazorpayCheckout(
      state.db,
      config,
      'internal-order',
      { ...proof, razorpay_signature: '0'.repeat(64) },
      request,
    ),
    /could not be verified/,
  );
  assert.equal(state.applied, 0);
  await assert.rejects(
    confirmRazorpayCheckout(
      state.db,
      config,
      'internal-order',
      { ...proof, razorpay_order_id: 'order_other123' },
      request,
    ),
    /could not be verified/,
  );
  assert.equal(state.applied, 0);
  const result = await confirmRazorpayCheckout(state.db, config, 'internal-order', proof, request);
  assert.deepEqual(result, { id: 'internal-order', paymentStatus: 'paid' });
  assert.equal(state.applied, 1);
  for (const altered of [{ amount: 100 }, { currency: 'USD' }, { order_id: 'order_other123' }]) {
    await assert.rejects(
      confirmRazorpayCheckout(state.db, config, 'internal-order', proof, async () =>
        Response.json({
          id: 'pay_fixture123',
          entity: 'payment',
          order_id: 'order_fixture123',
          amount: 22996,
          currency: 'INR',
          captured: true,
          status: 'captured',
          amount_refunded: 0,
          ...altered,
        }),
      ),
    );
  }
  assert.equal(state.applied, 1);
});

const unpaidOrder = {
  id: 'internal-order',
  total: 22996,
  status: 'pending',
  paymentStatus: 'initiated',
  paymentMode: 'razorpay_test',
};
const failedPayment = {
  id: 'pay_fixture123',
  entity: 'payment',
  order_id: 'order_fixture123',
  amount: 22996,
  currency: 'INR',
  status: 'failed',
  captured: false,
  amount_refunded: 0,
};
function collectionRequest(items: Record<string, unknown>[]): typeof fetch {
  return async (url, options) => {
    assert.equal(url, 'https://api.razorpay.com/v1/orders/order_fixture123/payments');
    assert.equal(options?.method, 'GET');
    return Response.json({ entity: 'collection', count: items.length, items });
  };
}

test('read-only checkout status retains the attempt and allows only provider-proven no-payment/all-failed state', async () => {
  for (const payments of [
    [],
    [failedPayment],
    [failedPayment, { ...failedPayment, id: 'pay_fixture456' }],
  ]) {
    const state = fixture(true);
    const before = structuredClone(state.attempt);
    const result = await readRazorpayCheckoutStatus(
      state.db,
      config,
      unpaidOrder,
      { attemptId },
      collectionRequest(payments),
    );
    assert.deepEqual(result, {
      provider: 'razorpay',
      mode: 'test',
      orderId: unpaidOrder.id,
      attemptId,
      resumable: true,
    });
    assert.deepEqual(state.calls, ['hpa_payment_find']);
    assert.deepEqual(state.attempt, before);
    assert.equal(state.applied, 0);
    assert.equal('keyId' in result, false);
    assert.equal('providerOrderId' in result, false);
  }
});

test('checkout status cannot authorize resume from initiated/ready labels when provider still has a debit or refund', async () => {
  for (const changed of [
    { status: 'created' },
    { status: 'authorized' },
    { status: 'captured', captured: true },
    { status: 'refunded', captured: true, amount_refunded: 22996 },
    { status: 'failed', amount_refunded: 1 },
    { amount: 22995 },
  ]) {
    const state = fixture(true);
    const result = await readRazorpayCheckoutStatus(
      state.db,
      config,
      unpaidOrder,
      { attemptId },
      collectionRequest([{ ...failedPayment, ...changed }]),
    );
    assert.equal(result.resumable, false);
    assert.deepEqual(state.calls, ['hpa_payment_find']);
    assert.equal(state.applied, 0);
  }
});

test('checkout status rejects nonpayable orders and mismatched or unresolved stored attempts before provider access', async () => {
  const mustNotFetch: typeof fetch = async () => {
    throw new Error('must not fetch');
  };
  for (const changed of [
    { paymentMode: 'razorpay_live' },
    { paymentMode: 'simulation' },
    ...['pending', 'paid', 'simulated_paid'].map((paymentStatus) => ({ paymentStatus })),
    ...[
      'confirmed',
      'preparing',
      'ready',
      'out_for_delivery',
      'delivered',
      'picked_up',
      'served',
      'closed',
      'cancelled',
      'rejected',
      'unknown',
    ].map((status) => ({ status })),
  ]) {
    const state = fixture(true);
    assert.equal(
      (
        await readRazorpayCheckoutStatus(
          state.db,
          config,
          { ...unpaidOrder, ...changed },
          { attemptId },
          mustNotFetch,
        )
      ).resumable,
      false,
    );
    assert.deepEqual(state.calls, []);
  }
  for (const changed of [
    { id: '22222222-2222-4222-8222-222222222222' },
    { order_id: 'another-order' },
    { mode: 'live' },
    { amount: 100 },
    { amount: -1 },
    { amount: 22996.5 },
    { currency: 'USD' },
    { provider_order_id: null },
    ...['creating', 'unknown', 'authorized', 'captured'].map((state) => ({ state })),
  ]) {
    const state = fixture(true);
    Object.assign(state.attempt, changed);
    assert.equal(
      (await readRazorpayCheckoutStatus(state.db, config, unpaidOrder, { attemptId }, mustNotFetch))
        .resumable,
      false,
    );
    assert.deepEqual(state.calls, ['hpa_payment_find']);
  }
});

test('checkout status fails closed on provider failures, paginated responses and binding mismatches without ledger writes', async () => {
  for (const response of [
    new Response('PRIVATE_DIAGNOSTIC', { status: 503 }),
    Response.json({ entity: 'collection', count: 0, items: [], has_more: true }),
    Response.json({ entity: 'collection', count: 2, items: [failedPayment] }),
    Response.json({
      entity: 'collection',
      count: 1,
      items: [{ ...failedPayment, order_id: 'order_other123' }],
    }),
  ]) {
    const state = fixture(true);
    await assert.rejects(
      readRazorpayCheckoutStatus(
        state.db,
        config,
        unpaidOrder,
        { attemptId },
        async () => response,
      ),
    );
    assert.deepEqual(state.calls, ['hpa_payment_find']);
    assert.equal(state.applied, 0);
  }
});

test('existing ready checkout reuses only an attempt whose provider payments are all failed', async () => {
  const state = fixture(true);
  const result = await prepareRazorpayCheckout(
    state.db,
    config,
    unpaidOrder.id,
    { attemptId },
    collectionRequest([failedPayment]),
  );
  assert.equal(result.attemptId, attemptId);
  assert.equal(result.providerOrderId, 'order_fixture123');
  assert.equal(result.amount, unpaidOrder.total);
  assert.deepEqual(state.calls, ['hpa_payment_reserve']);
  assert.equal(state.applied, 0);
  for (const changed of [
    { status: 'created' },
    { status: 'authorized' },
    { status: 'captured', captured: true },
    { status: 'refunded', captured: true, amount_refunded: 22996 },
    { amount: 22995 },
  ]) {
    const blocked = fixture(true);
    await assert.rejects(
      prepareRazorpayCheckout(
        blocked.db,
        config,
        unpaidOrder.id,
        { attemptId },
        collectionRequest([{ ...failedPayment, ...changed }]),
      ),
      /order status/,
    );
    assert.deepEqual(blocked.calls, ['hpa_payment_reserve']);
    assert.equal(blocked.applied, 0);
  }
});

test('authorized, captured or mismatched reservations never reopen Checkout or create another provider order', async () => {
  for (const changed of [
    { state: 'authorized' },
    { state: 'captured' },
    { mode: 'live' },
    { currency: 'USD' },
    { id: '22222222-2222-4222-8222-222222222222' },
    { order_id: 'another-order' },
  ]) {
    const state = fixture(true);
    Object.assign(state.attempt, changed);
    let calls = 0;
    await assert.rejects(
      prepareRazorpayCheckout(state.db, config, unpaidOrder.id, { attemptId }, async () => {
        calls++;
        throw new Error('must not fetch');
      }),
    );
    assert.equal(calls, 0);
    assert.deepEqual(state.calls, ['hpa_payment_reserve']);
  }
});

function previousAttempt() {
  return {
    ...fixture().attempt,
    id: '22222222-2222-4222-8222-222222222222',
    state: 'failed',
    provider_order_id: 'order_previous123',
  };
}
function withPreviousAttempt(state: ReturnType<typeof fixture>, changed = {}) {
  state.history.data = [{ ...previousAttempt(), ...changed }];
  state.history.count = 1;
}

const noHistory = () => ({ data: [] as unknown, count: 0 as number | null, error: null });
const createdOrder = () =>
  Response.json({
    id: 'order_fixture123',
    entity: 'order',
    amount: 22996,
    currency: 'INR',
    receipt: `hpa_${attemptId}`,
    status: 'created',
    amount_paid: 0,
    amount_due: 22996,
  });

test('failed payments retry the same stored provider order without creating another order or changing the ledger', async () => {
  const state = fixture(true);
  state.attempt.state = 'failed';
  const before = structuredClone(state.attempt);
  const failedOrder = { ...unpaidOrder, paymentStatus: 'failed' };
  const status = await readRazorpayCheckoutStatus(
    state.db,
    config,
    failedOrder,
    { attemptId },
    collectionRequest([failedPayment]),
  );
  assert.equal(status.resumable, true);
  for (let count = 0; count < 2; count++) {
    const checkout = await prepareRazorpayCheckout(
      state.db,
      config,
      failedOrder.id,
      { attemptId },
      collectionRequest([failedPayment]),
    );
    assert.equal(checkout.attemptId, attemptId);
    assert.equal(checkout.providerOrderId, before.provider_order_id);
  }
  assert.deepEqual(state.calls, ['hpa_payment_find', 'hpa_payment_reserve', 'hpa_payment_reserve']);
  assert.deepEqual(state.attempt, before);
  assert.equal(state.applied, 0);
});

test('a failed local attempt needs nonempty all-failed provider proof before it can reopen', async () => {
  for (const items of [
    [],
    [{ ...failedPayment, status: 'created' }],
    [{ ...failedPayment, status: 'authorized' }],
    [{ ...failedPayment, status: 'captured', captured: true }],
    [{ ...failedPayment, status: 'refunded', captured: true, amount_refunded: 22996 }],
    [{ ...failedPayment, amount_refunded: 1 }],
    [{ ...failedPayment, amount: 22995 }],
    [failedPayment, { ...failedPayment, id: 'pay_sibling123', status: 'authorized' }],
  ]) {
    const state = fixture(true);
    state.attempt.state = 'failed';
    const before = structuredClone(state.attempt);
    const failedOrder = { ...unpaidOrder, paymentStatus: 'failed' };
    assert.equal(
      (
        await readRazorpayCheckoutStatus(
          state.db,
          config,
          failedOrder,
          { attemptId },
          collectionRequest(items),
        )
      ).resumable,
      false,
    );
    await assert.rejects(
      prepareRazorpayCheckout(
        state.db,
        config,
        failedOrder.id,
        { attemptId },
        collectionRequest(items),
      ),
      /order status/,
    );
    assert.deepEqual(state.attempt, before);
    assert.equal(state.applied, 0);
  }
});

test('any previous attempt blocks a new provider order even when every older payment would currently be failed', async () => {
  for (const changed of [
    {},
    ...['creating', 'ready', 'unknown', 'authorized', 'captured'].map((state) => ({ state })),
    { provider_order_id: null },
    { mode: 'live' },
    { amount: 100 },
  ]) {
    const state = fixture();
    withPreviousAttempt(state, changed);
    let external = 0;
    await assert.rejects(
      prepareRazorpayCheckout(state.db, config, unpaidOrder.id, { attemptId }, async () => {
        external++;
        // Even an all-failed snapshot cannot retire an older Checkout or late authorization.
        return Response.json({ entity: 'collection', count: 1, items: [failedPayment] });
      }),
      /Another payment attempt exists/,
    );
    assert.equal(external, 0);
    assert.deepEqual(state.calls, []);
    assert.equal(state.applied, 0);
  }
});

test('legacy multiple-attempt orders cannot reopen either ready or failed Checkout or expose a resume capability', async () => {
  for (const localState of ['ready', 'failed']) {
    for (const operation of ['status', 'prepare'] as const) {
      const state = fixture(true);
      state.attempt.state = localState;
      withPreviousAttempt(state);
      const before = structuredClone(state.attempt);
      let external = 0;
      const request: typeof fetch = async () => {
        external++;
        return Response.json({ entity: 'collection', count: 0, items: [] });
      };
      if (operation === 'status') {
        assert.equal(
          (
            await readRazorpayCheckoutStatus(
              state.db,
              config,
              { ...unpaidOrder, paymentStatus: localState === 'failed' ? 'failed' : 'initiated' },
              { attemptId },
              request,
            )
          ).resumable,
          false,
        );
        assert.deepEqual(state.calls, ['hpa_payment_find']);
      } else {
        await assert.rejects(
          prepareRazorpayCheckout(state.db, config, unpaidOrder.id, { attemptId }, request),
          /Another payment attempt exists/,
        );
        assert.deepEqual(state.calls, []);
      }
      assert.equal(external, 0);
      assert.deepEqual(state.attempt, before);
      assert.equal(state.applied, 0);
    }
  }
});

test('the post-reservation history check closes a concurrent attempt race before provider creation', async () => {
  const state = fixture();
  state.historyResponses.push(noHistory(), {
    data: [previousAttempt()],
    count: 1,
    error: null,
  });
  let external = 0;
  await assert.rejects(
    prepareRazorpayCheckout(state.db, config, unpaidOrder.id, { attemptId }, async () => {
      external++;
      return createdOrder();
    }),
    /Another payment attempt exists/,
  );
  assert.equal(external, 0);
  assert.deepEqual(state.calls, ['hpa_payment_reserve']);
  assert.equal(state.attempt.state, 'creating');
  assert.equal(state.attempt.provider_order_id, null);
});

test('unavailable preflight history consumes no reservation and the same attempt can recover when the read recovers', async () => {
  const state = fixture();
  state.history.count = null;
  let external = 0;
  const request: typeof fetch = async (_url, options) => {
    external++;
    assert.equal(options?.method, 'POST');
    return createdOrder();
  };
  await assert.rejects(
    prepareRazorpayCheckout(state.db, config, unpaidOrder.id, { attemptId }, request),
    /history could not be verified/,
  );
  assert.deepEqual(state.calls, []);
  assert.equal(external, 0);
  state.history.count = 0;
  const checkout = await prepareRazorpayCheckout(
    state.db,
    config,
    unpaidOrder.id,
    { attemptId },
    request,
  );
  assert.equal(checkout.providerOrderId, 'order_fixture123');
  assert.equal(external, 1);
  assert.deepEqual(state.calls, ['hpa_payment_reserve', 'hpa_payment_bind']);
});

test('a history-only outage after reservation never marks unknown or authorizes a blind upstream retry', async () => {
  const state = fixture();
  state.historyResponses.push(noHistory(), { data: [], count: null, error: null });
  let external = 0;
  const request: typeof fetch = async () => {
    external++;
    return createdOrder();
  };
  await assert.rejects(
    prepareRazorpayCheckout(state.db, config, unpaidOrder.id, { attemptId }, request),
    /history could not be verified/,
  );
  assert.equal(external, 0);
  assert.deepEqual(state.calls, ['hpa_payment_reserve']);
  assert.equal(state.attempt.state, 'creating');
  await assert.rejects(
    prepareRazorpayCheckout(state.db, config, unpaidOrder.id, { attemptId }, request),
    /not confirmed/,
  );
  assert.equal(external, 0);
  assert.deepEqual(state.calls, ['hpa_payment_reserve', 'hpa_payment_reserve']);
});

test('invalid or incomplete history fails closed before reservation and never exposes private diagnostics', async () => {
  for (const changed of [
    { count: null },
    { count: -1 },
    { count: 1.5 },
    { count: '1' },
    { count: 0, data: null },
    { count: 0, error: { message: 'PRIVATE_DATABASE_DIAGNOSTIC' } },
    { count: 0, data: [previousAttempt()] },
    { count: 1, data: [] },
  ]) {
    const state = fixture();
    Object.assign(state.history, changed);
    let external = 0;
    await assert.rejects(
      prepareRazorpayCheckout(state.db, config, unpaidOrder.id, { attemptId }, async () => {
        external++;
        throw new Error('must not fetch');
      }),
      (error: Error) => !error.message.includes('PRIVATE_DATABASE_DIAGNOSTIC'),
    );
    assert.deepEqual(state.calls, []);
    assert.equal(external, 0);
  }
  const state = fixture();
  state.db.from = () => {
    throw new Error('PRIVATE_DATABASE_DIAGNOSTIC');
  };
  await assert.rejects(
    prepareRazorpayCheckout(state.db, config, unpaidOrder.id, { attemptId }, async () => {
      throw new Error('must not fetch');
    }),
    /history could not be verified/,
  );
  assert.deepEqual(state.calls, []);
});

test('existing resume and status require trustworthy history even when their own provider order appears empty', async () => {
  for (const operation of ['status', 'prepare'] as const) {
    const state = fixture(true);
    state.history.count = null;
    let external = 0;
    const request: typeof fetch = async () => {
      external++;
      return Response.json({ entity: 'collection', count: 0, items: [] });
    };
    if (operation === 'status') {
      await assert.rejects(
        readRazorpayCheckoutStatus(state.db, config, unpaidOrder, { attemptId }, request),
        /history could not be verified/,
      );
    } else {
      await assert.rejects(
        prepareRazorpayCheckout(state.db, config, unpaidOrder.id, { attemptId }, request),
        /history could not be verified/,
      );
    }
    assert.equal(external, 0);
    assert.equal(state.applied, 0);
  }
});
