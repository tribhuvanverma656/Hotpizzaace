import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import {
  createRazorpayOrder,
  equalRazorpaySignature,
  fetchRazorpayOrderPayments,
  fetchRazorpayPayment,
  parseRazorpayCheckoutRequest,
  parseRazorpayVerificationRequest,
  parseRazorpayWebhook,
  readRazorpayConfig,
  readRazorpayWebhookBody,
  verifyRazorpayCheckoutSignature,
  verifyRazorpayPayment,
  verifyRazorpayWebhookSignature,
  type RazorpayEnvironment,
  type RazorpayPayment,
} from '../lib/payments/razorpay';

const attemptId = '11111111-1111-4111-8111-111111111111';
const providerOrderId = 'order_ABCDEF12345678';
const paymentId = 'pay_ABCDEF12345678';
const keySecret = 'synthetic-api-secret-for-unit-only';
const webhookSecret = 'synthetic-webhook-secret-unit-only';
const environment: RazorpayEnvironment = {
  RAZORPAY_ENABLED: 'true',
  RAZORPAY_MODE: 'test',
  RAZORPAY_KEY_ID: 'rzp_test_ABCDEF12345678',
  RAZORPAY_KEY_SECRET: keySecret,
  RAZORPAY_WEBHOOK_SECRET: webhookSecret,
};
const config = readRazorpayConfig(environment, 'development')!;
const payment: RazorpayPayment = {
  id: paymentId,
  order_id: providerOrderId,
  amount: 21900,
  currency: 'INR',
  status: 'captured',
  captured: true,
  amount_refunded: 0,
};
const providerPayment = {
  ...payment,
  entity: 'payment',
  email: 'private@unit.invalid',
  card: { private: true },
};
const signature = createHmac('sha256', keySecret)
  .update(`${providerOrderId}|${paymentId}`)
  .digest('hex');

test('Razorpay configuration requires explicit enablement, complete secrets and matching test/live catalog/key modes', () => {
  for (const enabled of [undefined, '', 'false', 'TRUE', '1'])
    assert.equal(
      readRazorpayConfig({ ...environment, RAZORPAY_ENABLED: enabled }, 'production'),
      null,
    );
  assert.equal(config.paymentMode, 'razorpay_test');
  assert.equal(
    readRazorpayConfig(
      { ...environment, RAZORPAY_MODE: 'live', RAZORPAY_KEY_ID: 'rzp_live_ABCDEF12345678' },
      'production',
    )?.paymentMode,
    'razorpay_live',
  );
  for (const [env, mode] of [
    [environment, 'production'],
    [environment, undefined],
    [{ ...environment, RAZORPAY_MODE: 'live' }, 'development'],
    [{ ...environment, RAZORPAY_KEY_ID: 'rzp_live_ABCDEF12345678' }, 'development'],
    [{ ...environment, RAZORPAY_KEY_SECRET: '' }, 'development'],
    [{ ...environment, RAZORPAY_WEBHOOK_SECRET: '' }, 'development'],
    [{ ...environment, RAZORPAY_KEY_SECRET: 'unicode-secret-é-unit' }, 'development'],
  ] as const)
    assert.throws(() => readRazorpayConfig(env, mode), /not configured/);
});

test('checkout/verification payloads exclude amount, paid flags, ownership and unexpected fields', () => {
  assert.deepEqual(parseRazorpayCheckoutRequest({ attemptId }), { attemptId });
  for (const extra of [
    { amount: 1 },
    { paid: true },
    { userId: 'victim' },
    { providerOrderId },
    { attemptId: '../not-uuid' },
  ])
    assert.throws(() => parseRazorpayCheckoutRequest({ attemptId, ...extra }));
  const value = {
    attemptId,
    razorpay_order_id: providerOrderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: signature,
  };
  assert.deepEqual(parseRazorpayVerificationRequest(value), value);
  for (const extra of [
    { amount: 1 },
    { paymentStatus: 'paid' },
    { razorpay_order_id: '//evil.invalid' },
    { razorpay_signature: signature.toUpperCase() },
  ])
    assert.throws(() => parseRazorpayVerificationRequest({ ...value, ...extra }));
});

test('Checkout HMAC uses the stored order binding, rejects tampering and never treats a signature as capture proof', async () => {
  assert.equal(
    await verifyRazorpayCheckoutSignature({ providerOrderId, paymentId, signature }, keySecret),
    true,
  );
  for (const changed of [
    { providerOrderId: 'order_DIFFERENT12345' },
    { paymentId: 'pay_DIFFERENT12345' },
    { signature: '0'.repeat(64) },
  ])
    assert.equal(
      await verifyRazorpayCheckoutSignature(
        { providerOrderId, paymentId, signature, ...changed },
        keySecret,
      ),
      false,
    );
  assert.equal(
    await verifyRazorpayCheckoutSignature({ providerOrderId, paymentId, signature }, webhookSecret),
    false,
  );
  assert.equal(equalRazorpaySignature(signature, signature), true);
  for (const wrong of [
    '',
    signature.slice(1),
    signature.toUpperCase(),
    'z'.repeat(64),
    signature.slice(0, 63) + (signature.at(-1) === '0' ? '1' : '0'),
  ])
    assert.equal(equalRazorpaySignature(signature, wrong), false);
  assert.equal(
    verifyRazorpayPayment(
      { ...payment, status: 'authorized', captured: false },
      { providerOrderId, amount: 21900 },
    ).status,
    'authorized',
  );
});

test('provider order creation uses a fixed endpoint, server amount/receipt, INR and no partial payments or customer PII', async () => {
  const calls: { url: string; options?: RequestInit }[] = [];
  const order = await createRazorpayOrder(
    config,
    { amount: 21900, receipt: attemptId },
    async (input, options) => {
      calls.push({ url: String(input), options });
      return Response.json({
        id: providerOrderId,
        entity: 'order',
        amount: 21900,
        currency: 'INR',
        receipt: attemptId,
        status: 'created',
        amount_paid: 0,
        amount_due: 21900,
        private_extra: 'not-projected',
      });
    },
  );
  assert.equal(calls[0].url, 'https://api.razorpay.com/v1/orders');
  assert.equal(calls[0].options?.redirect, 'error');
  assert.equal(calls[0].options?.cache, 'no-store');
  assert.deepEqual(JSON.parse(String(calls[0].options?.body)), {
    amount: 21900,
    currency: 'INR',
    receipt: attemptId,
    partial_payment: false,
  });
  assert.doesNotMatch(JSON.stringify(order), /private_extra|synthetic-api-secret/);
  assert.equal(
    new Headers(calls[0].options?.headers).get('authorization'),
    `Basic ${btoa(`${config.keyId}:${keySecret}`)}`,
  );
});

test('provider create mismatches and outages fail safely without reflecting diagnostics', async () => {
  const good = {
    id: providerOrderId,
    entity: 'order',
    amount: 21900,
    currency: 'INR',
    receipt: attemptId,
    status: 'created',
    amount_paid: 0,
    amount_due: 21900,
  };
  for (const changed of [
    { amount: 1 },
    { currency: 'USD' },
    { receipt: 'different' },
    { status: 'paid' },
    { amount_paid: 1 },
    { id: '//evil.invalid' },
  ])
    await assert.rejects(
      createRazorpayOrder(config, { amount: 21900, receipt: attemptId }, async () =>
        Response.json({ ...good, ...changed }),
      ),
      /payment provider/,
    );
  for (const response of [
    new Response('PRIVATE_SECRET', { status: 502 }),
    new Response('{PRIVATE', { headers: { 'Content-Type': 'application/json' } }),
    Response.json({ private: 'x'.repeat(65_536) }),
  ])
    await assert.rejects(
      createRazorpayOrder(config, { amount: 21900, receipt: attemptId }, async () => response),
      (error: Error) => !error.message.includes('PRIVATE_SECRET'),
    );
  let called = false;
  for (const value of [0, 99, -1, 1.1, Number.NaN, Number.MAX_SAFE_INTEGER])
    await assert.rejects(
      createRazorpayOrder(config, { amount: value, receipt: attemptId }, async () => {
        called = true;
        return Response.json(good);
      }),
    );
  assert.equal(called, false);
});

test('payment fetch projects only provider state and rejects endpoint injection and another payment ID', async () => {
  let called = false;
  const fetched = await fetchRazorpayPayment(config, paymentId, async (input, options) => {
    called = true;
    assert.equal(input, `https://api.razorpay.com/v1/payments/${paymentId}`);
    assert.equal(options?.method, 'GET');
    return Response.json(providerPayment);
  });
  assert.equal(called, true);
  assert.deepEqual(fetched, payment);
  await assert.rejects(
    fetchRazorpayPayment(config, '../orders', async () => {
      throw new Error('must not fetch');
    }),
    /identifier/,
  );
  await assert.rejects(
    fetchRazorpayPayment(config, paymentId, async () =>
      Response.json({ ...providerPayment, id: 'pay_DIFFERENT12345' }),
    ),
    /payment provider/,
  );
});

test('order payment reads use the fixed authenticated GET and project only complete bound payment facts', async () => {
  const failed = { ...providerPayment, status: 'failed', captured: false };
  const fetched = await fetchRazorpayOrderPayments(
    config,
    providerOrderId,
    async (input, options) => {
      assert.equal(input, `https://api.razorpay.com/v1/orders/${providerOrderId}/payments`);
      assert.equal(options?.method, 'GET');
      assert.equal(options?.cache, 'no-store');
      assert.equal(options?.redirect, 'error');
      assert.equal(options?.body, undefined);
      assert.equal(
        new Headers(options?.headers).get('authorization'),
        `Basic ${btoa(`${config.keyId}:${keySecret}`)}`,
      );
      return Response.json({ entity: 'collection', count: 1, items: [failed] });
    },
  );
  assert.deepEqual(fetched, [{ ...payment, status: 'failed', captured: false }]);
  assert.doesNotMatch(JSON.stringify(fetched), /email|card|private|secret/);
  assert.deepEqual(
    await fetchRazorpayOrderPayments(config, providerOrderId, async () =>
      Response.json({ entity: 'collection', count: 0, items: [] }),
    ),
    [],
  );
  await assert.rejects(
    fetchRazorpayOrderPayments(config, '../payments', async () => {
      throw new Error('must not fetch');
    }),
    /identifier/,
  );
});

test('order payment reads fail closed on malformed, paginated, duplicate, unbound or oversized collections', async () => {
  const failed = { ...providerPayment, status: 'failed', captured: false };
  const good = { entity: 'collection', count: 1, items: [failed] };
  for (const value of [
    null,
    [],
    { ...good, entity: 'payment' },
    { ...good, count: '1' },
    { ...good, count: -1 },
    { ...good, count: 2 },
    { ...good, items: null },
    { ...good, has_more: true },
    { ...good, next: '/next-page' },
    { ...good, count: 2, items: [failed, failed] },
    {
      ...good,
      count: 100,
      items: Array.from({ length: 100 }, (_, index) => ({ ...failed, id: `pay_fixture${index}` })),
    },
    { ...good, items: [{ ...failed, order_id: 'order_DIFFERENT12345' }] },
    { ...good, items: [{ ...failed, amount: 0 }] },
    { ...good, items: [{ ...failed, status: 'pending' }] },
    { ...good, items: [{ ...failed, captured: true }] },
    { ...good, items: [{ ...failed, refund_status: 'partial' }] },
  ])
    await assert.rejects(
      fetchRazorpayOrderPayments(config, providerOrderId, async () => Response.json(value)),
    );
  for (const response of [
    new Response('PRIVATE_DIAGNOSTIC', { status: 500 }),
    new Response('{INVALID', { headers: { 'Content-Type': 'application/json' } }),
    Response.json({
      entity: 'collection',
      count: 1,
      items: [{ ...failed, private_extra: 'x'.repeat(65_536) }],
    }),
  ])
    await assert.rejects(
      fetchRazorpayOrderPayments(config, providerOrderId, async () => response),
      (error: Error) => !error.message.includes('PRIVATE_DIAGNOSTIC'),
    );
});

test('only matching provider amount/order/captured state produces a captured ledger projection; refunds require review', () => {
  const verified = verifyRazorpayPayment(payment, { providerOrderId, amount: 21900, paymentId });
  assert.deepEqual(verified, {
    id: paymentId,
    order_id: providerOrderId,
    amount: 21900,
    currency: 'INR',
    status: 'captured',
    captured: true,
  });
  for (const expected of [
    { providerOrderId: 'order_DIFFERENT12345', amount: 21900 },
    { providerOrderId, amount: 21899 },
    { providerOrderId, amount: 21900, paymentId: 'pay_DIFFERENT12345' },
  ])
    assert.throws(() => verifyRazorpayPayment(payment, expected), /stored order/);
  for (const changed of [
    { captured: false },
    { amount: -1 },
    { currency: 'USD' },
    { status: 'paid' },
  ])
    assert.throws(() =>
      verifyRazorpayPayment({ ...payment, ...changed } as RazorpayPayment, {
        providerOrderId,
        amount: 21900,
      }),
    );
  for (const changed of [{ amount_refunded: 100 }, { status: 'refunded', amount_refunded: 21900 }])
    assert.throws(
      () =>
        verifyRazorpayPayment({ ...payment, ...changed } as RazorpayPayment, {
          providerOrderId,
          amount: 21900,
        }),
      /review/,
    );
});

test('webhook HMAC covers exact raw bytes with its separate secret and signed event payload must match state', async () => {
  const raw = new TextEncoder().encode(
    JSON.stringify({
      entity: 'event',
      account_id: 'acc_ABCDEF12345678',
      event: 'payment.captured',
      payload: { payment: { entity: providerPayment } },
    }),
  );
  const signed = createHmac('sha256', webhookSecret).update(raw).digest('hex');
  assert.equal(await verifyRazorpayWebhookSignature(raw, signed, webhookSecret), true);
  assert.equal(await verifyRazorpayWebhookSignature(raw, signed, keySecret), false);
  assert.equal(
    await verifyRazorpayWebhookSignature(
      new TextEncoder().encode(new TextDecoder().decode(raw) + '\n'),
      signed,
      webhookSecret,
    ),
    false,
  );
  assert.deepEqual(parseRazorpayWebhook(raw), {
    event: 'payment.captured',
    accountId: 'acc_ABCDEF12345678',
    payment,
  });
  assert.equal(
    parseRazorpayWebhook(
      new TextEncoder().encode('{"entity":"event","event":"refund.speed_changed"}'),
    ),
    null,
  );
  assert.throws(
    () =>
      parseRazorpayWebhook(
        new TextEncoder().encode(
          new TextDecoder().decode(raw).replace('payment.captured', 'payment.failed'),
        ),
      ),
    /does not match/,
  );
  assert.throws(() => parseRazorpayWebhook(new Uint8Array([0xff])));
});

test('webhook reads enforce JSON and streaming byte limits without consuming or reserializing the signed body', async () => {
  const raw = '{ "signed" : "spaces must remain" }';
  assert.equal(
    new TextDecoder().decode(
      await readRazorpayWebhookBody(
        new Request('https://unit.invalid', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: raw,
        }),
      ),
    ),
    raw,
  );
  await assert.rejects(
    readRazorpayWebhookBody(new Request('https://unit.invalid', { method: 'POST', body: raw })),
    /JSON/,
  );
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(262_145));
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request('https://unit.invalid', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: stream,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  await assert.rejects(readRazorpayWebhookBody(request), /too large/);
  assert.equal(cancelled, true);
});
