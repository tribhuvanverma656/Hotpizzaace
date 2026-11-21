import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  clearPhonePeTokenCache,
  createPhonePePayment,
  fetchPhonePeOrderStatus,
  parsePhonePeWebhook,
  phonePeAccessToken,
  PhonePeError,
  readPhonePeConfig,
  verifyPhonePeOrderStatus,
  verifyPhonePeWebhookAuthorization,
  type PhonePeConfig,
} from '../lib/payments/phonepe';
import {
  confirmPhonePeCheckout,
  flagPhonePeRefund,
  preparePhonePeCheckout,
  readPhonePeCheckoutStatus,
  reconcilePhonePeOrder,
  synchronizePhonePeAttempt,
  type PhonePeAttempt,
} from '../lib/payments/phonepe-service';
import { parsePhonePeCheckout, phonePeAttemptId } from '../lib/payments/phonepe-client';
import { gatewayProvider, isLiveGatewayMode, isTestGatewayMode } from '../lib/payments/method';

const environment = {
  PHONEPE_ENABLED: 'true',
  PHONEPE_MODE: 'test',
  PHONEPE_CLIENT_ID: 'TEST-CLIENT_1',
  PHONEPE_CLIENT_SECRET: 'fictional-secret-value',
  PHONEPE_CLIENT_VERSION: '1',
  PHONEPE_WEBHOOK_USERNAME: 'hpa-hook',
  PHONEPE_WEBHOOK_PASSWORD: 'fictional-hook-password',
  PHONEPE_SITE_ORIGIN: 'https://hotpizzaace-development.onrender.com',
};
const config = readPhonePeConfig(environment, 'development')!;
const ORDER = '7b0c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3';
const ATTEMPT = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const RECEIPT = `hpa_${ATTEMPT.replaceAll('-', '')}`;
const PAYPAGE = 'https://mercury-uat.phonepe.com/transact/uat_v2?token=fictional';

type Call = { url: string; init: RequestInit };
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
/** Fake PhonePe: OAuth token plus scripted API answers, recording every call. */
function fakePhonePe(answers: ((call: Call) => Response)[]) {
  const calls: Call[] = [];
  const request = (async (url: string | URL, init: RequestInit = {}) => {
    const call = { url: String(url), init };
    calls.push(call);
    if (call.url.endsWith('/oauth/token'))
      return jsonResponse({
        access_token: 'fictional-access-token-value',
        token_type: 'O-Bearer',
        issued_at: Math.floor(Date.now() / 1000),
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      });
    const answer = answers.shift();
    if (!answer) throw new Error(`Unexpected PhonePe call ${call.url}`);
    return answer(call);
  }) as typeof fetch;
  return { calls, request };
}
function status(state: 'PENDING' | 'COMPLETED' | 'FAILED', amount = 15646, details?: unknown[]) {
  return () =>
    jsonResponse({
      orderId: 'OMO2511071234567890',
      state,
      amount,
      expireAt: Date.now() + 600_000,
      paymentDetails:
        details ??
        (state === 'PENDING'
          ? []
          : [{ transactionId: 'OM2511071234567890', state, amount, paymentMode: 'UPI_QR' }]),
    });
}
function attempt(overrides: Partial<PhonePeAttempt> = {}): PhonePeAttempt {
  return {
    id: ATTEMPT,
    order_id: ORDER,
    provider: 'phonepe',
    mode: 'test',
    amount: 15646,
    currency: 'INR',
    receipt: RECEIPT,
    state: 'ready',
    provider_order_id: 'OMO2511071234567890',
    captured_payment_id: null,
    checkout_url: PAYPAGE,
    provider_expires_at: new Date(Date.now() + 600_000).toISOString(),
    ...overrides,
  };
}
/** Records RPC calls and answers from a script keyed by RPC name. */
function fakeDb(answers: Record<string, (args: Record<string, unknown>) => unknown>) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  return {
    calls,
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      const answer = answers[name];
      if (!answer) return { data: null, error: { message: `unexpected ${name}` } };
      try {
        return { data: answer(args), error: null };
      } catch (cause) {
        return { data: null, error: { message: (cause as Error).message } };
      }
    },
  };
}

test('PhonePe config requires explicit enablement, complete secrets and matching environments', () => {
  assert.equal(
    readPhonePeConfig({ ...environment, PHONEPE_ENABLED: 'false' }, 'development'),
    null,
  );
  assert.equal(config.paymentMode, 'phonepe_test');
  assert.equal(config.siteOrigin, 'https://hotpizzaace-development.onrender.com');
  assert.throws(() => readPhonePeConfig(environment, 'production'), PhonePeError);
  assert.throws(
    () => readPhonePeConfig({ ...environment, PHONEPE_MODE: 'live' }, 'development'),
    PhonePeError,
  );
  assert.throws(
    () => readPhonePeConfig({ ...environment, PHONEPE_CLIENT_SECRET: 'short' }, 'development'),
    PhonePeError,
  );
  assert.throws(
    () =>
      readPhonePeConfig(
        { ...environment, PHONEPE_SITE_ORIGIN: 'http://example.com' },
        'development',
      ),
    PhonePeError,
  );
  const live = readPhonePeConfig(
    { ...environment, PHONEPE_MODE: 'live', PHONEPE_SITE_ORIGIN: 'https://hotpizzaace.com' },
    'production',
  ) as PhonePeConfig;
  assert.equal(live.paymentMode, 'phonepe_live');
});

test('the OAuth token is form-encoded, cached and refreshed before expiry', async () => {
  clearPhonePeTokenCache();
  let clock = Date.now();
  const forms: string[] = [];
  const request = (async (_url: string | URL, init: RequestInit = {}) => {
    forms.push(String(init.body));
    return jsonResponse({
      access_token: `fictional-access-token-${forms.length}`,
      expires_at: Math.floor(clock / 1000) + 600,
    });
  }) as typeof fetch;
  assert.equal(await phonePeAccessToken(config, request, () => clock), 'fictional-access-token-1');
  assert.equal(await phonePeAccessToken(config, request, () => clock), 'fictional-access-token-1');
  const form = new URLSearchParams(forms[0]);
  assert.equal(form.get('grant_type'), 'client_credentials');
  assert.equal(form.get('client_id'), 'TEST-CLIENT_1');
  assert.equal(form.get('client_version'), '1');
  clock += 500_000;
  assert.equal(await phonePeAccessToken(config, request, () => clock), 'fictional-access-token-2');
  clearPhonePeTokenCache();
});

test('create payment sends only server amount, merchantOrderId and the site redirect', async () => {
  clearPhonePeTokenCache();
  const phonepe = fakePhonePe([
    () =>
      jsonResponse({
        orderId: 'OMO2511071234567890',
        state: 'PENDING',
        expireAt: Date.now() + 1_200_000,
        redirectUrl: PAYPAGE,
      }),
  ]);
  const created = await createPhonePePayment(
    config,
    {
      merchantOrderId: RECEIPT,
      amount: 15646,
      redirectUrl: `${config.siteOrigin}/order-success?id=${ORDER}`,
    },
    phonepe.request,
  );
  assert.equal(created.checkoutUrl, PAYPAGE);
  const call = phonepe.calls[1];
  assert.equal(call.url, 'https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/pay');
  assert.equal(
    (call.init.headers as Record<string, string>).Authorization,
    'O-Bearer fictional-access-token-value',
  );
  assert.deepEqual(JSON.parse(String(call.init.body)), {
    merchantOrderId: RECEIPT,
    amount: 15646,
    expireAfter: 1200,
    paymentFlow: {
      type: 'PG_CHECKOUT',
      merchantUrls: { redirectUrl: `${config.siteOrigin}/order-success?id=${ORDER}` },
    },
  });
  await assert.rejects(
    createPhonePePayment(
      config,
      { merchantOrderId: RECEIPT, amount: 15646, redirectUrl: 'https://evil.example/' },
      phonepe.request,
    ),
    PhonePeError,
  );
  const foreign = fakePhonePe([
    () =>
      jsonResponse({
        orderId: 'OMO2511071234567890',
        state: 'PENDING',
        expireAt: Date.now() + 1_200_000,
        redirectUrl: 'https://phonepe.evil.example/pay',
      }),
  ]);
  await assert.rejects(
    createPhonePePayment(
      config,
      { merchantOrderId: RECEIPT, amount: 15646, redirectUrl: `${config.siteOrigin}/x` },
      foreign.request,
    ),
    (error: unknown) =>
      error instanceof PhonePeError && error.code === 'payment_provider_unavailable',
  );
  clearPhonePeTokenCache();
});

test('order status is trusted only when the binding and exact amount match', async () => {
  clearPhonePeTokenCache();
  const expected = { providerOrderId: 'OMO2511071234567890', amount: 15646 };
  const phonepe = fakePhonePe([status('COMPLETED'), status('FAILED'), status('PENDING')]);
  const completed = await fetchPhonePeOrderStatus(config, RECEIPT, phonepe.request);
  assert.match(
    phonepe.calls[1].url,
    /\/checkout\/v2\/order\/hpa_[a-f0-9]{32}\/status\?details=true/,
  );
  assert.deepEqual(verifyPhonePeOrderStatus(completed, expected), {
    kind: 'captured',
    transactionId: 'OM2511071234567890',
  });
  const failed = await fetchPhonePeOrderStatus(config, RECEIPT, phonepe.request);
  assert.deepEqual(verifyPhonePeOrderStatus(failed, expected), {
    kind: 'failed',
    transactionId: 'OM2511071234567890',
  });
  const pending = await fetchPhonePeOrderStatus(config, RECEIPT, phonepe.request);
  assert.deepEqual(verifyPhonePeOrderStatus(pending, expected), { kind: 'pending' });
  assert.throws(
    () => verifyPhonePeOrderStatus({ ...completed, amount: 100 }, expected),
    (error: unknown) => error instanceof PhonePeError && error.code === 'payment_mismatch',
  );
  assert.throws(
    () => verifyPhonePeOrderStatus({ ...completed, orderId: 'OMO9999999999' }, expected),
    (error: unknown) => error instanceof PhonePeError && error.code === 'payment_mismatch',
  );
  // COMPLETED without a completed instrument for the full amount is not accepted.
  assert.throws(
    () => verifyPhonePeOrderStatus({ ...completed, paymentDetails: [] }, expected),
    PhonePeError,
  );
  clearPhonePeTokenCache();
});

test('webhook authorization is SHA-256 of username:password and bodies only name an order', async () => {
  const digest = createHash('sha256').update('hpa-hook:fictional-hook-password').digest('hex');
  assert.equal(await verifyPhonePeWebhookAuthorization(digest, config), true);
  assert.equal(await verifyPhonePeWebhookAuthorization(digest.toUpperCase(), config), true);
  assert.equal(await verifyPhonePeWebhookAuthorization(`${digest.slice(0, 63)}0`, config), false);
  assert.equal(await verifyPhonePeWebhookAuthorization(null, config), false);
  const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  assert.deepEqual(
    parsePhonePeWebhook(
      encode({
        event: 'checkout.order.completed',
        payload: { merchantOrderId: RECEIPT, state: 'COMPLETED', amount: 1 },
      }),
    ),
    { kind: 'order', event: 'checkout.order.completed', merchantOrderId: RECEIPT },
  );
  assert.equal(parsePhonePeWebhook(encode({ event: 'subscription.paused', payload: {} })), null);
  assert.throws(() =>
    parsePhonePeWebhook(
      encode({ event: 'checkout.order.failed', payload: { merchantOrderId: 'bad id' } }),
    ),
  );
});

test('a new checkout binds the PayPage; a lost create response marks the attempt unknown', async () => {
  clearPhonePeTokenCache();
  const reserved = attempt({
    state: 'creating',
    provider_order_id: null,
    checkout_url: null,
    provider_expires_at: null,
  });
  const db = fakeDb({
    hpa_payment_reserve: () => ({ attempt: reserved, create: true }),
    hpa_payment_bind_checkout: (args) => ({
      ...reserved,
      state: 'ready',
      provider_order_id: args.p_provider_order_id,
      checkout_url: args.p_checkout_url,
      provider_expires_at: args.p_expires_at,
    }),
  });
  const phonepe = fakePhonePe([
    () =>
      jsonResponse({
        orderId: 'OMO2511071234567890',
        state: 'PENDING',
        expireAt: Date.now() + 1_200_000,
        redirectUrl: PAYPAGE,
      }),
  ]);
  const checkout = await preparePhonePeCheckout(
    db,
    config,
    ORDER,
    { attemptId: ATTEMPT },
    phonepe.request,
  );
  assert.equal(checkout.checkoutUrl, PAYPAGE);
  assert.equal(checkout.amount, 15646);
  assert.deepEqual(
    db.calls.map((call) => call.name),
    ['hpa_payment_reserve', 'hpa_payment_bind_checkout'],
  );
  assert.equal(
    parsePhonePeCheckout(checkout, { orderId: ORDER, attemptId: ATTEMPT }).checkoutUrl,
    PAYPAGE,
  );

  const lost = fakeDb({
    hpa_payment_reserve: () => ({ attempt: reserved, create: true }),
    hpa_payment_mark_unknown: () => null,
  });
  const outage = fakePhonePe([() => new Response('gateway timeout', { status: 504 })]);
  await assert.rejects(
    preparePhonePeCheckout(lost, config, ORDER, { attemptId: ATTEMPT }, outage.request),
    PhonePeError,
  );
  assert.deepEqual(
    lost.calls.map((call) => call.name),
    ['hpa_payment_reserve', 'hpa_payment_mark_unknown'],
  );
  await assert.rejects(
    preparePhonePeCheckout(db, config, ORDER, { attemptId: 'not-a-uuid' }, phonepe.request),
    PhonePeError,
  );
  clearPhonePeTokenCache();
});

test('resuming re-checks PhonePe first and never reopens a paid or failed PayPage', async () => {
  clearPhonePeTokenCache();
  const ready = attempt();
  const pendingDb = fakeDb({ hpa_payment_reserve: () => ({ attempt: ready, create: false }) });
  const pending = fakePhonePe([status('PENDING')]);
  const resumed = await preparePhonePeCheckout(
    pendingDb,
    config,
    ORDER,
    { attemptId: ATTEMPT },
    pending.request,
  );
  assert.equal(resumed.checkoutUrl, PAYPAGE);

  const paidDb = fakeDb({
    hpa_payment_reserve: () => ({ attempt: ready, create: false }),
    hpa_payment_apply: () => ({ id: ORDER, paymentStatus: 'paid' }),
  });
  const paid = fakePhonePe([status('COMPLETED')]);
  await assert.rejects(
    preparePhonePeCheckout(paidDb, config, ORDER, { attemptId: ATTEMPT }, paid.request),
    (error: unknown) => error instanceof PhonePeError && error.code === 'payment_complete',
  );
  const apply = paidDb.calls.find((call) => call.name === 'hpa_payment_apply')!;
  assert.deepEqual(apply.args, {
    p_attempt_id: ATTEMPT,
    p_provider_order_id: 'OMO2511071234567890',
    p_payment_id: 'OM2511071234567890',
    p_status: 'captured',
    p_amount: 15646,
    p_currency: 'INR',
    p_event_hash: null,
  });

  const expiredDb = fakeDb({
    hpa_payment_reserve: () => ({
      attempt: attempt({ provider_expires_at: new Date(Date.now() + 10_000).toISOString() }),
      create: false,
    }),
  });
  await assert.rejects(
    preparePhonePeCheckout(
      expiredDb,
      config,
      ORDER,
      { attemptId: ATTEMPT },
      fakePhonePe([status('PENDING')]).request,
    ),
    (error: unknown) => error instanceof PhonePeError && error.code === 'payment_retry_required',
  );
  clearPhonePeTokenCache();
});

test('confirmation applies FAILED orders without instruments through the failure RPC', async () => {
  clearPhonePeTokenCache();
  const db = fakeDb({
    hpa_payment_find: () => attempt(),
    hpa_payment_mark_failed: () => ({ id: ORDER, paymentStatus: 'failed' }),
  });
  const phonepe = fakePhonePe([status('FAILED', 15646, [])]);
  const result = await confirmPhonePeCheckout(
    db,
    config,
    ORDER,
    { attemptId: ATTEMPT },
    phonepe.request,
  );
  assert.deepEqual(result.outcome, { kind: 'failed', transactionId: null });
  assert.deepEqual(db.calls.at(-1), {
    name: 'hpa_payment_mark_failed',
    args: {
      p_attempt_id: ATTEMPT,
      p_provider_order_id: 'OMO2511071234567890',
      p_amount: 15646,
      p_event_hash: null,
    },
  });
  const status2 = await readPhonePeCheckoutStatus(
    fakeDb({ hpa_payment_find: () => attempt({ state: 'failed' }) }),
    config,
    {
      id: ORDER,
      total: 15646,
      status: 'pending',
      paymentStatus: 'failed',
      paymentMode: 'phonepe_test',
    },
    { attemptId: ATTEMPT },
    phonepe.request,
  );
  assert.equal(status2.retryable, true);
  assert.equal(status2.resumable, false);
  clearPhonePeTokenCache();
});

test('a verified PhonePe refund pauses fulfilment for review and never posts money', async () => {
  clearPhonePeTokenCache();
  const captured = attempt({ state: 'captured', captured_payment_id: 'OM2511071234567890' });
  const db = fakeDb({
    hpa_payment_flag_refund_review: () => ({ id: ORDER, paymentReviewRequired: true }),
  });
  const phonepe = fakePhonePe([
    () => jsonResponse({ originalMerchantOrderId: RECEIPT, amount: 5000, state: 'COMPLETED' }),
    () => jsonResponse({ originalMerchantOrderId: 'hpa_other', amount: 5000, state: 'COMPLETED' }),
  ]);
  await flagPhonePeRefund(db, config, captured, 'refund_qa_1', phonepe.request);
  assert.equal(db.calls[0].args.p_evidence_amount, 5000);
  assert.equal(db.calls[0].args.p_payment_id, 'OM2511071234567890');
  await assert.rejects(
    flagPhonePeRefund(db, config, captured, 'refund_qa_2', phonepe.request),
    (error: unknown) => error instanceof PhonePeError && error.code === 'payment_mismatch',
  );
  clearPhonePeTokenCache();
});

test('a verified refund received before capture persists its hold, and a failed hold is retried', async () => {
  clearPhonePeTokenCache();
  const uncaptured = attempt();
  const db = fakeDb({ hpa_payment_flag_refund_review: () => ({ paymentReviewRequired: true }) });
  const phonepe = fakePhonePe([
    () => jsonResponse({ originalMerchantOrderId: RECEIPT, amount: 15646, state: 'COMPLETED' }),
    () => jsonResponse({ originalMerchantOrderId: RECEIPT, amount: 50, state: 'PENDING' }),
    () => jsonResponse({ originalMerchantOrderId: RECEIPT, amount: 15646, state: 'COMPLETED' }),
    () => jsonResponse({ originalMerchantOrderId: RECEIPT, amount: 15646, state: 'FAILED' }),
  ]);
  await flagPhonePeRefund(db, config, uncaptured, 'refund_before_capture', phonepe.request);
  assert.equal(db.calls[0].name, 'hpa_payment_flag_refund_review');
  assert.equal(db.calls[0].args.p_payment_id, null);
  assert.equal(db.calls[0].args.p_evidence_amount, 15646);
  await flagPhonePeRefund(
    db,
    config,
    attempt({ state: 'unknown', provider_order_id: null, checkout_url: null }),
    'refund_before_binding',
    phonepe.request,
  );
  assert.equal(db.calls[1].args.p_provider_order_id, null);
  assert.equal(db.calls[1].args.p_evidence_amount, 50);
  const unavailable = fakeDb({
    hpa_payment_flag_refund_review: () => {
      throw new Error('outage');
    },
  });
  await assert.rejects(
    flagPhonePeRefund(unavailable, config, uncaptured, 'refund_retry', phonepe.request),
    (error: unknown) =>
      error instanceof Error && 'code' in error && error.code === 'payment_unavailable',
  );
  assert.deepEqual(
    await flagPhonePeRefund(db, config, uncaptured, 'refund_failed', phonepe.request),
    { ignored: true, reason: 'refund_failed' },
  );
  assert.equal(db.calls.length, 2);
  clearPhonePeTokenCache();
});

test('unknown creates recover terminal status by stored merchantOrderId without another pay request', async () => {
  clearPhonePeTokenCache();
  const unknown = attempt({
    state: 'unknown',
    provider_order_id: null,
    checkout_url: null,
    provider_expires_at: null,
  });
  const db = fakeDb({
    hpa_payment_find: () => unknown,
    hpa_payment_recover_phonepe: (args) => ({
      id: ORDER,
      paymentStatus: args.p_status === 'captured' ? 'paid' : 'failed',
    }),
  });
  const phonepe = fakePhonePe([status('COMPLETED'), status('FAILED', 15646, [])]);
  const captured = await confirmPhonePeCheckout(
    db,
    config,
    ORDER,
    { attemptId: ATTEMPT },
    phonepe.request,
  );
  assert.deepEqual(captured.order, { id: ORDER, paymentStatus: 'paid' });
  assert.deepEqual(db.calls[1], {
    name: 'hpa_payment_recover_phonepe',
    args: {
      p_attempt_id: ATTEMPT,
      p_receipt: RECEIPT,
      p_provider_order_id: 'OMO2511071234567890',
      p_amount: 15646,
      p_status: 'captured',
      p_payment_id: 'OM2511071234567890',
      p_event_hash: null,
    },
  });
  const failed = await readPhonePeCheckoutStatus(
    db,
    config,
    {
      id: ORDER,
      total: 15646,
      status: 'pending',
      paymentStatus: 'initiated',
      paymentMode: 'phonepe_test',
    },
    { attemptId: ATTEMPT },
    phonepe.request,
  );
  assert.equal(failed.retryable, true);
  assert.equal(db.calls.at(-1)?.args.p_payment_id, null);
  // PostgREST requires this named argument even when the failed order has no
  // instrument. Undefined would disappear from JSON and prevent SQL recovery.
  const serializedRecovery = JSON.parse(JSON.stringify(db.calls.at(-1)?.args));
  assert.equal(Object.hasOwn(serializedRecovery, 'p_payment_id'), true);
  assert.equal(serializedRecovery.p_payment_id, null);
  assert.ok(
    phonepe.calls
      .filter((call) => !call.url.endsWith('/oauth/token'))
      .every((call) => call.init.method === 'GET'),
  );
  clearPhonePeTokenCache();
});

test('unknown creates stay blocked on pending or mismatched status and owner review is explicit', async () => {
  clearPhonePeTokenCache();
  const unknown = attempt({ state: 'unknown', provider_order_id: null, checkout_url: null });
  const db = fakeDb({
    hpa_payment_reserve: () => ({ attempt: unknown, create: false }),
    hpa_payment_reconciliation_attempts: () => [unknown],
  });
  const phonepe = fakePhonePe([status('PENDING'), status('PENDING'), status('COMPLETED', 100)]);
  await assert.rejects(
    preparePhonePeCheckout(db, config, ORDER, { attemptId: ATTEMPT }, phonepe.request),
    (error: unknown) =>
      error instanceof PhonePeError && error.code === 'payment_initialization_pending',
  );
  await assert.rejects(
    reconcilePhonePeOrder(db, config, ORDER, phonepe.request),
    (error: unknown) =>
      error instanceof PhonePeError && error.code === 'payment_initialization_pending',
  );
  await assert.rejects(
    synchronizePhonePeAttempt(db, config, unknown, {}, phonepe.request),
    (error: unknown) => error instanceof PhonePeError && error.code === 'payment_mismatch',
  );
  assert.deepEqual(
    db.calls.map((call) => call.name),
    ['hpa_payment_reserve', 'hpa_payment_reconciliation_attempts'],
  );
  assert.ok(
    phonepe.calls
      .filter((call) => !call.url.endsWith('/oauth/token'))
      .every((call) => call.init.method === 'GET'),
  );
  clearPhonePeTokenCache();
});

test('browser attempt IDs persist until a verified failure starts a fresh one', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
  const scope = { userId: null, orderId: ORDER };
  const first = phonePeAttemptId(storage, scope);
  assert.equal(phonePeAttemptId(storage, scope), first);
  const fresh = phonePeAttemptId(storage, scope, { fresh: true });
  assert.notEqual(fresh, first);
  assert.equal(phonePeAttemptId(storage, scope), fresh);
});

test('gateway helpers classify PhonePe and historical Razorpay modes', () => {
  assert.equal(gatewayProvider('phonepe_live'), 'phonepe');
  assert.equal(gatewayProvider('razorpay_test'), 'razorpay');
  assert.equal(gatewayProvider('counter_manual'), null);
  assert.equal(isLiveGatewayMode('phonepe_live'), true);
  assert.equal(isTestGatewayMode('phonepe_test'), true);
  assert.equal(isLiveGatewayMode('phonepe_test'), false);
});
