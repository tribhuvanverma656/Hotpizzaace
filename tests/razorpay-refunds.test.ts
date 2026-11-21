import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fetchRazorpayRefund,
  fetchRazorpayPaymentRefunds,
  parseRazorpayWebhook,
  type RazorpayConfig,
  type RazorpayPayment,
} from '../lib/payments/razorpay';
import {
  synchronizeRazorpayRefunds,
  reconcileRazorpayOrderRefunds,
  type PaymentAttempt,
} from '../lib/payments/service';

const config: RazorpayConfig = {
  mode: 'test',
  paymentMode: 'razorpay_test',
  keyId: 'rzp_test_fixture123',
  keySecret: 'synthetic-test-key-secret',
  webhookSecret: 'synthetic-test-webhook-secret',
};
const attempt: PaymentAttempt = {
  id: '11111111-1111-4111-8111-111111111111',
  order_id: '33333333-3333-4333-8333-333333333333',
  mode: 'test',
  amount: 10000,
  currency: 'INR',
  receipt: 'fixture',
  state: 'captured',
  provider_order_id: 'order_fixture123',
};
const payment: RazorpayPayment = {
  id: 'pay_fixture123',
  order_id: 'order_fixture123',
  amount: 10000,
  currency: 'INR',
  captured: true,
  status: 'captured',
  amount_refunded: 1000,
};
const refund = {
  id: 'rfnd_fixture123',
  entity: 'refund',
  payment_id: payment.id,
  amount: 1000,
  currency: 'INR',
  status: 'processed',
  created_at: 1793289600,
};
const rawEvent = (event = 'refund.processed', changed = {}) => ({
  entity: 'event',
  account_id: 'acc_fixture123',
  event,
  created_at: 1793293200,
  payload: {
    payment: { entity: { ...payment, entity: 'payment' } },
    refund: { entity: { ...refund, ...changed } },
  },
});
const parse = (value: unknown) =>
  parseRazorpayWebhook(new TextEncoder().encode(JSON.stringify(value)));
function fixture() {
  const commits: { name: string; args: Record<string, unknown> }[] = [];
  const calls: string[] = [];
  const db = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      commits.push({ name, args });
      return {
        data:
          name === 'hpa_payment_reconciliation_attempts'
            ? [{ ...attempt }]
            : { id: attempt.order_id, paymentStatus: 'paid' },
        error: null,
      };
    },
  };
  let refunds: unknown[] = [refund];
  let specific: unknown = refund;
  let providerPayment = payment;
  const request: typeof fetch = async (url, options) => {
    calls.push(String(url));
    assert.equal(options?.method, 'GET');
    assert.equal(options?.redirect, 'error');
    if (String(url).endsWith('/payments/order_fixture123')) assert.fail('wrong endpoint');
    if (String(url).endsWith('/orders/order_fixture123/payments'))
      return Response.json({
        entity: 'collection',
        count: 1,
        items: [{ ...providerPayment, entity: 'payment', refund_status: 'partial' }],
      });
    if (String(url).endsWith('/refunds/rfnd_fixture123')) return Response.json(specific);
    assert.equal(
      String(url),
      'https://api.razorpay.com/v1/payments/pay_fixture123/refunds?count=100&skip=0',
    );
    return Response.json({ entity: 'collection', count: refunds.length, items: refunds });
  };
  return {
    db,
    request,
    calls,
    commits,
    setRefunds: (value: unknown[]) => {
      refunds = value;
    },
    setSpecific: (value: unknown) => {
      specific = value;
    },
    setPayment: (value: RazorpayPayment) => {
      providerPayment = value;
    },
  };
}

test('refund events distinguish created/processed/failed and reject changed bindings, amounts and event times', () => {
  const event = parse(rawEvent());
  assert.ok(event && 'refund' in event);
  assert.equal(event.refund.id, refund.id);
  assert.equal(event.createdAt, 1793293200);
  assert.equal(parse(rawEvent('refund.created', { status: 'pending' }))?.event, 'refund.created');
  assert.equal(parse(rawEvent('refund.failed', { status: 'failed' }))?.event, 'refund.failed');
  // Created may already be processed: accounting follows fresh API state, not the event title.
  assert.equal(parse(rawEvent('refund.created'))?.event, 'refund.created');
  for (const changed of [
    { payment_id: 'pay_another123' },
    { amount: 10001 },
    { currency: 'USD' },
    { id: '../refunds' },
    { amount: 0 },
    { amount: 1.1 },
    { status: 'created' },
    { created_at: 1793293300 },
  ])
    assert.throws(() => parse(rawEvent('refund.processed', changed)));
  assert.throws(() => parse({ ...rawEvent(), created_at: undefined }));
  assert.throws(() => parse(rawEvent('refund.processed', { status: 'pending' })));
  assert.throws(() => parse(rawEvent('refund.failed', { status: 'processed' })));
});

test('refund GETs bind exact identifiers, omit private provider fields and refuse incomplete histories', async () => {
  const f = fixture();
  assert.deepEqual(await fetchRazorpayRefund(config, payment.id, refund.id, f.request), {
    id: refund.id,
    payment_id: payment.id,
    amount: 1000,
    currency: 'INR',
    status: 'processed',
    created_at: refund.created_at,
  });
  assert.equal((await fetchRazorpayPaymentRefunds(config, payment.id, f.request)).length, 1);
  await assert.rejects(fetchRazorpayRefund(config, '../payments', refund.id, f.request));
  await assert.rejects(fetchRazorpayRefund(config, payment.id, '../refunds', f.request));
  for (const changed of [
    { id: 'rfnd_other123' },
    { payment_id: 'pay_other123' },
    { amount: 0 },
    { currency: 'USD' },
  ]) {
    f.setSpecific({ ...refund, ...changed });
    await assert.rejects(fetchRazorpayRefund(config, payment.id, refund.id, f.request));
  }
  for (const value of [
    { entity: 'collection', count: 2, items: [refund] },
    { entity: 'collection', count: 1, items: [refund], has_more: true },
    { entity: 'collection', count: 2, items: [refund, refund] },
    { entity: 'collection', count: 1, items: [{ ...refund, payment_id: 'pay_other123' }] },
    {
      entity: 'collection',
      count: 100,
      items: Array.from({ length: 100 }, (_, i) => ({ ...refund, id: `rfnd_fixture${i}` })),
    },
  ])
    await assert.rejects(
      fetchRazorpayPaymentRefunds(config, payment.id, async () => Response.json(value)),
    );
});

test('signed processed evidence maps to provider-event day; reconciliation fallbacks use verification time explicitly', async () => {
  const f = fixture();
  const event = parse(rawEvent());
  assert.ok(event && 'refund' in event);
  await synchronizeRazorpayRefunds(
    f.db,
    config,
    attempt,
    payment,
    { event, eventHash: 'a'.repeat(64), now: '2026-10-30T00:00:00.000Z' },
    f.request,
  );
  const commit = f.commits[0];
  assert.equal(commit.name, 'hpa_payment_sync_refunds');
  assert.equal(commit.args.p_mode, 'test');
  assert.equal(commit.args.p_amount, 10000);
  assert.equal(commit.args.p_payment_id, payment.id);
  assert.deepEqual(commit.args.p_refunds, [
    {
      id: refund.id,
      amount: 1000,
      status: 'processed',
      createdAt: new Date(refund.created_at * 1000).toISOString(),
      processedAt: new Date(1793293200 * 1000).toISOString(),
      timestampSource: 'provider_event',
    },
  ]);
  assert.equal(commit.args.p_event_hash, 'a'.repeat(64));
  const recovery = fixture();
  await synchronizeRazorpayRefunds(
    recovery.db,
    config,
    attempt,
    payment,
    { now: '2026-10-30T00:00:00.000Z' },
    recovery.request,
  );
  assert.deepEqual((recovery.commits[0].args.p_refunds as Record<string, unknown>[])[0], {
    id: refund.id,
    amount: 1000,
    status: 'processed',
    createdAt: new Date(refund.created_at * 1000).toISOString(),
    processedAt: '2026-10-30T00:00:00.000Z',
    timestampSource: 'verified_at',
  });
});

test('pending and failed refunds are audited without processed timestamps; stale failure can fetch processed truth', async () => {
  for (const status of ['pending', 'failed']) {
    const f = fixture();
    f.setRefunds([{ ...refund, status }]);
    await synchronizeRazorpayRefunds(
      f.db,
      config,
      attempt,
      { ...payment, amount_refunded: 0 },
      {},
      f.request,
    );
    const projection = (f.commits[0].args.p_refunds as Record<string, unknown>[])[0];
    assert.equal(projection.status, status);
    assert.equal(projection.processedAt, null);
    assert.equal(projection.timestampSource, null);
  }
  const f = fixture();
  const event = parse(rawEvent('refund.failed', { status: 'failed' }));
  assert.ok(event && 'refund' in event);
  await synchronizeRazorpayRefunds(f.db, config, attempt, payment, { event }, f.request);
  assert.equal((f.commits[0].args.p_refunds as Record<string, unknown>[])[0].status, 'processed');
});

test('refund mismatch, cross-environment, unverified amount and provider outage cannot write financial state', async () => {
  for (const changed of [
    { order_id: 'order_other123' },
    { amount: 9999 },
    { currency: 'USD' as const },
    { amount_refunded: 999 },
  ]) {
    const f = fixture();
    await assert.rejects(
      synchronizeRazorpayRefunds(
        f.db,
        config,
        attempt,
        { ...payment, ...changed } as RazorpayPayment,
        {},
        f.request,
      ),
    );
    assert.equal(
      f.commits.filter((commit) => commit.name === 'hpa_payment_sync_refunds').length,
      0,
    );
  }
  const f = fixture();
  await assert.rejects(
    synchronizeRazorpayRefunds(f.db, config, { ...attempt, mode: 'live' }, payment, {}, f.request),
  );
  assert.equal(f.commits.filter((commit) => commit.name === 'hpa_payment_sync_refunds').length, 0);
  const event = parse(rawEvent());
  assert.ok(event && 'refund' in event);
  f.setSpecific({ ...refund, amount: 1001 });
  await assert.rejects(
    synchronizeRazorpayRefunds(f.db, config, attempt, payment, { event }, f.request),
  );
  assert.equal(f.commits.filter((commit) => commit.name === 'hpa_payment_sync_refunds').length, 0);
  await assert.rejects(
    synchronizeRazorpayRefunds(
      f.db,
      config,
      attempt,
      payment,
      {},
      async () => new Response('PRIVATE_ERROR', { status: 503 }),
    ),
    (error: Error) => !error.message.includes('PRIVATE_ERROR'),
  );
  assert.equal(f.commits.filter((commit) => commit.name === 'hpa_payment_sync_refunds').length, 0);
});

test('uncaptured auto-refunds never become captured restaurant sales or net outgoing restaurant refunds', async () => {
  const f = fixture();
  const result = await synchronizeRazorpayRefunds(
    f.db,
    config,
    { ...attempt, state: 'failed' },
    { ...payment, captured: false, status: 'failed' },
    {},
    f.request,
  );
  assert.deepEqual(result, { ignored: true, reason: 'uncaptured_payment' });
  assert.equal(f.commits.filter((commit) => commit.name === 'hpa_payment_sync_refunds').length, 0);
});

test('incoherent full/partial refund histories cannot ACK or project a captured receipt with zero refund', async () => {
  for (const changed of [
    { status: 'refunded', amount_refunded: 10000 },
    { status: 'captured', amount_refunded: 1000 },
  ]) {
    for (const items of [[], [{ ...refund, amount: 500 }]]) {
      const f = fixture();
      f.setRefunds(items);
      await assert.rejects(
        synchronizeRazorpayRefunds(
          f.db,
          config,
          attempt,
          { ...payment, ...changed } as RazorpayPayment,
          {},
          f.request,
        ),
      );
      assert.equal(
        f.commits.filter((commit) => commit.name === 'hpa_payment_sync_refunds').length,
        0,
      );
    }
  }
});

test('owner reconciliation restores historical refunded receipts using only bound provider GETs', async () => {
  const f = fixture();
  await reconcileRazorpayOrderRefunds(f.db, config, attempt.order_id, f.request);
  assert.deepEqual(
    f.commits.map((commit) => commit.name),
    ['hpa_payment_reconciliation_attempts', 'hpa_payment_sync_refunds'],
  );
  assert.equal((f.commits[1].args.p_refunds as Record<string, unknown>[])[0].amount, 1000);
  assert.equal(f.calls.length, 2);
});

test('owner reconciliation retains a verified pending refund hold when processed totals are inconsistent', async () => {
  const f = fixture();
  f.setPayment({ ...payment, amount_refunded: 0 });
  f.setRefunds([
    { ...refund, status: 'pending' },
    { ...refund, id: 'rfnd_second123', amount: 500 },
  ]);
  await assert.rejects(reconcileRazorpayOrderRefunds(f.db, config, attempt.order_id, f.request), {
    code: 'payment_unavailable',
  });
  assert.deepEqual(
    f.commits.map((commit) => commit.name),
    ['hpa_payment_reconciliation_attempts', 'hpa_payment_flag_refund_review'],
  );
  const hold = f.commits[1].args;
  assert.equal(hold.p_evidence_amount, 1000);
  assert.equal(hold.p_payment_id, payment.id);
  assert.equal(hold.p_provider_order_id, attempt.provider_order_id);
  assert.equal(hold.p_mode, 'test');
  assert.equal('p_refunds' in hold, false);
  assert.equal(f.calls.length, 2);
});

test('failed-only or incorrectly bound specific refunds cannot invent a pending-refund hold on history outage', async () => {
  for (const specific of [
    { ...refund, status: 'failed' },
    { ...refund, status: 'pending', payment_id: 'pay_another123' },
  ]) {
    const f = fixture();
    f.setSpecific(specific);
    const event = parse(rawEvent('refund.created', { status: 'pending' }));
    assert.ok(event && 'refund' in event);
    await assert.rejects(
      synchronizeRazorpayRefunds(
        f.db,
        config,
        attempt,
        { ...payment, amount_refunded: 0 },
        { event },
        async (url, options) =>
          String(url).includes('/refunds?')
            ? new Response('', { status: 503 })
            : f.request(url, options),
      ),
    );
    assert.deepEqual(f.commits, []);
  }
});
