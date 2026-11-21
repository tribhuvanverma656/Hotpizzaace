/** Portable server/Edge utilities. Never import this module into a browser payment form. */
export type RazorpayMode = 'test' | 'live';
export type RazorpayConfig = {
  mode: RazorpayMode;
  paymentMode: 'razorpay_test' | 'razorpay_live';
  keyId: string;
  keySecret: string;
  webhookSecret: string;
};
export type RazorpayEnvironment = {
  RAZORPAY_ENABLED?: string;
  RAZORPAY_MODE?: string;
  RAZORPAY_KEY_ID?: string;
  RAZORPAY_KEY_SECRET?: string;
  RAZORPAY_WEBHOOK_SECRET?: string;
};
export type RazorpayProviderOrder = {
  id: string;
  entity: 'order';
  amount: number;
  currency: 'INR';
  receipt: string;
  status: 'created' | 'attempted' | 'paid';
  amount_paid: number;
  amount_due: number;
};
export type RazorpayVerifiedPayment = {
  id: string;
  order_id: string;
  amount: number;
  currency: 'INR';
  status: 'created' | 'authorized' | 'captured' | 'failed';
  captured: boolean;
};
export type RazorpayPayment = Omit<RazorpayVerifiedPayment, 'status'> & {
  status: RazorpayVerifiedPayment['status'] | 'refunded';
  amount_refunded: number;
};
export type RazorpayRefund = {
  id: string;
  payment_id: string;
  amount: number;
  currency: 'INR';
  status: 'pending' | 'processed' | 'failed';
  created_at: number;
};
export type RazorpayWebhook =
  | {
      event: 'payment.authorized' | 'payment.captured' | 'payment.failed' | 'order.paid';
      accountId: string;
      payment: RazorpayPayment;
    }
  | {
      event: 'refund.created' | 'refund.processed' | 'refund.failed';
      accountId: string;
      payment: RazorpayPayment;
      refund: RazorpayRefund;
      createdAt: number;
    };

export class RazorpayError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code = 'invalid_payment_request',
  ) {
    super(message);
    this.name = 'RazorpayError';
  }
}

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ORDER_ID = /^order_[A-Za-z0-9]{6,100}$/;
const PAYMENT_ID = /^pay_[A-Za-z0-9]{6,100}$/;
const REFUND_ID = /^rfnd_[A-Za-z0-9]{6,100}$/;
const SIGNATURE = /^[a-f0-9]{64}$/;
const API_ORIGIN = 'https://api.razorpay.com/v1';
const PROVIDER_BODY_LIMIT = 65_536;
const WEBHOOK_BODY_LIMIT = 262_144;
const MAX_AMOUNT = 100_000_000;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new RazorpayError('Send valid payment details.');
  return value as Record<string, unknown>;
}
function exactFields(value: unknown, fields: string[]) {
  const input = object(value);
  if (
    Object.keys(input).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(input, field))
  )
    throw new RazorpayError('Send valid payment details.');
  return input;
}
function amount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 100 && Number(value) <= MAX_AMOUNT;
}
function secret(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 16 &&
    value.length <= 256 &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}
function unavailable(): never {
  throw new RazorpayError(
    'Online payment is not configured for this environment.',
    503,
    'payment_unavailable',
  );
}
function invalidProvider(): never {
  throw new RazorpayError(
    'The payment provider could not verify this payment. Please retry the same payment check.',
    502,
    'payment_provider_unavailable',
  );
}

/** Explicit enablement, complete secrets and matching environment/key modes are all required. */
export function readRazorpayConfig(
  environment: RazorpayEnvironment,
  catalogMode: unknown,
): RazorpayConfig | null {
  if (environment.RAZORPAY_ENABLED !== 'true') return null;
  const mode = environment.RAZORPAY_MODE;
  if (
    (mode !== 'test' && mode !== 'live') ||
    !['development', 'production'].includes(String(catalogMode)) ||
    (catalogMode === 'development' ? mode !== 'test' : mode !== 'live')
  )
    unavailable();
  const keyId = environment.RAZORPAY_KEY_ID;
  if (
    typeof keyId !== 'string' ||
    !new RegExp(`^rzp_${mode}_[A-Za-z0-9]{6,100}$`).test(keyId) ||
    !secret(environment.RAZORPAY_KEY_SECRET) ||
    !/^[\x21-\x7e]+$/.test(environment.RAZORPAY_KEY_SECRET) ||
    !secret(environment.RAZORPAY_WEBHOOK_SECRET)
  )
    unavailable();
  return {
    mode,
    paymentMode: mode === 'test' ? 'razorpay_test' : 'razorpay_live',
    keyId,
    keySecret: environment.RAZORPAY_KEY_SECRET,
    webhookSecret: environment.RAZORPAY_WEBHOOK_SECRET,
  };
}

/** The client chooses an idempotency identity, never an amount, status or provider binding. */
export function parseRazorpayCheckoutRequest(value: unknown): { attemptId: string } {
  const input = exactFields(value, ['attemptId']);
  if (typeof input.attemptId !== 'string' || !UUID.test(input.attemptId))
    throw new RazorpayError('Start a fresh payment attempt.');
  return { attemptId: input.attemptId };
}

export function parseRazorpayVerificationRequest(value: unknown) {
  const input = exactFields(value, [
    'attemptId',
    'razorpay_order_id',
    'razorpay_payment_id',
    'razorpay_signature',
  ]);
  const { attemptId } = parseRazorpayCheckoutRequest({ attemptId: input.attemptId });
  if (
    typeof input.razorpay_order_id !== 'string' ||
    !ORDER_ID.test(input.razorpay_order_id) ||
    typeof input.razorpay_payment_id !== 'string' ||
    !PAYMENT_ID.test(input.razorpay_payment_id) ||
    typeof input.razorpay_signature !== 'string' ||
    !SIGNATURE.test(input.razorpay_signature)
  )
    throw new RazorpayError('Send valid payment verification details.');
  return {
    attemptId,
    razorpay_order_id: input.razorpay_order_id,
    razorpay_payment_id: input.razorpay_payment_id,
    razorpay_signature: input.razorpay_signature,
  };
}

/** Compare fixed-length SHA-256 hex without an early exit on matching prefixes. */
export function equalRazorpaySignature(first: unknown, second: unknown): boolean {
  if (
    typeof first !== 'string' ||
    typeof second !== 'string' ||
    !SIGNATURE.test(first) ||
    !SIGNATURE.test(second)
  )
    return false;
  let difference = 0;
  for (let index = 0; index < 64; index++)
    difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
  return difference === 0;
}

async function hmacHex(raw: Uint8Array, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(value),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signed = await crypto.subtle.sign('HMAC', key, new Uint8Array(raw));
  return Array.from(new Uint8Array(signed), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** providerOrderId MUST come from the stored server attempt, not the Checkout response. */
export async function verifyRazorpayCheckoutSignature(
  input: { providerOrderId: string; paymentId: string; signature: string },
  keySecret: string,
): Promise<boolean> {
  if (
    !ORDER_ID.test(input.providerOrderId) ||
    !PAYMENT_ID.test(input.paymentId) ||
    !SIGNATURE.test(input.signature) ||
    !secret(keySecret)
  )
    return false;
  const expected = await hmacHex(
    new TextEncoder().encode(`${input.providerOrderId}|${input.paymentId}`),
    keySecret,
  );
  return equalRazorpaySignature(expected, input.signature);
}

export async function verifyRazorpayWebhookSignature(
  raw: Uint8Array,
  signature: string,
  webhookSecret: string,
): Promise<boolean> {
  if (raw.byteLength > WEBHOOK_BODY_LIMIT || !SIGNATURE.test(signature) || !secret(webhookSecret))
    return false;
  return equalRazorpaySignature(await hmacHex(raw, webhookSecret), signature);
}

async function boundedBytes(source: Request | Response, limit: number): Promise<Uint8Array> {
  const declared = source.headers.get('content-length');
  if (declared && Number(declared) > limit)
    throw new RazorpayError('This payment message is too large.', 413, 'payment_body_too_large');
  const reader = source.body?.getReader();
  if (!reader) throw new RazorpayError('Send a valid payment message.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new RazorpayError(
          'This payment message is too large.',
          413,
          'payment_body_too_large',
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const raw = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    raw.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return raw;
}

export async function readRazorpayWebhookBody(request: Request): Promise<Uint8Array> {
  if (
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
  )
    throw new RazorpayError('Send a JSON payment event.');
  return boundedBytes(request, WEBHOOK_BODY_LIMIT);
}

function parseJson(raw: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  } catch {
    throw new RazorpayError('Send a valid payment message.');
  }
}

function parsePayment(value: unknown): RazorpayPayment {
  const payment = object(value);
  if (
    payment.entity !== 'payment' ||
    typeof payment.id !== 'string' ||
    !PAYMENT_ID.test(payment.id) ||
    typeof payment.order_id !== 'string' ||
    !ORDER_ID.test(payment.order_id) ||
    !amount(payment.amount) ||
    payment.currency !== 'INR' ||
    typeof payment.captured !== 'boolean' ||
    !['created', 'authorized', 'captured', 'failed', 'refunded'].includes(String(payment.status)) ||
    !Number.isSafeInteger(payment.amount_refunded) ||
    Number(payment.amount_refunded) < 0 ||
    Number(payment.amount_refunded) > payment.amount
  )
    invalidProvider();
  if ((payment.status === 'captured' || payment.status === 'refunded') !== payment.captured)
    invalidProvider();
  return {
    id: payment.id,
    order_id: payment.order_id,
    amount: payment.amount,
    currency: 'INR',
    status: payment.status as RazorpayPayment['status'],
    captured: payment.captured,
    amount_refunded: Number(payment.amount_refunded),
  };
}

/** Parse only authenticated raw webhook bytes; unknown event types are acknowledged without mutation. */
export function parseRazorpayWebhook(raw: Uint8Array): RazorpayWebhook | null {
  if (raw.byteLength > WEBHOOK_BODY_LIMIT)
    throw new RazorpayError('This payment message is too large.', 413, 'payment_body_too_large');
  const event = object(parseJson(raw));
  if (event.entity !== 'event' || typeof event.event !== 'string' || event.event.length > 100)
    throw new RazorpayError('Send a valid payment event.');
  if (
    ![
      'payment.authorized',
      'payment.captured',
      'payment.failed',
      'order.paid',
      'refund.created',
      'refund.processed',
      'refund.failed',
    ].includes(event.event)
  )
    return null;
  if (typeof event.account_id !== 'string' || !/^acc_[A-Za-z0-9]{6,100}$/.test(event.account_id))
    throw new RazorpayError('Send a valid payment event.');
  const payment = parsePayment(object(object(event.payload).payment).entity);
  if (event.event.startsWith('refund.')) {
    const refund = parseRefund(object(object(event.payload).refund).entity);
    if (
      refund.payment_id !== payment.id ||
      refund.currency !== payment.currency ||
      refund.amount > payment.amount ||
      !Number.isSafeInteger(event.created_at) ||
      Number(event.created_at) < refund.created_at ||
      Number(event.created_at) > Math.floor(Date.now() / 1000) + 300 ||
      (event.event === 'refund.processed' && refund.status !== 'processed') ||
      (event.event === 'refund.failed' && refund.status !== 'failed')
    )
      throw new RazorpayError('The refund event does not match its entity.');
    return {
      event: event.event as 'refund.created' | 'refund.processed' | 'refund.failed',
      accountId: event.account_id,
      payment,
      refund,
      createdAt: Number(event.created_at),
    };
  }
  const expectedStatus =
    event.event === 'payment.authorized'
      ? 'authorized'
      : event.event === 'payment.failed'
        ? 'failed'
        : 'captured';
  if (payment.status !== expectedStatus)
    throw new RazorpayError('The payment event does not match its entity.');
  return {
    event: event.event as
      'payment.authorized' | 'payment.captured' | 'payment.failed' | 'order.paid',
    accountId: event.account_id,
    payment,
  };
}

function parseRefund(value: unknown): RazorpayRefund {
  const refund = object(value);
  if (
    refund.entity !== 'refund' ||
    typeof refund.id !== 'string' ||
    !REFUND_ID.test(refund.id) ||
    typeof refund.payment_id !== 'string' ||
    !PAYMENT_ID.test(refund.payment_id) ||
    !Number.isSafeInteger(refund.amount) ||
    Number(refund.amount) < 1 ||
    Number(refund.amount) > MAX_AMOUNT ||
    refund.currency !== 'INR' ||
    !['pending', 'processed', 'failed'].includes(String(refund.status)) ||
    !Number.isSafeInteger(refund.created_at) ||
    Number(refund.created_at) < 1 ||
    Number(refund.created_at) > Math.floor(Date.now() / 1000) + 300
  )
    invalidProvider();
  return {
    id: refund.id as string,
    payment_id: refund.payment_id as string,
    amount: Number(refund.amount),
    currency: 'INR',
    status: refund.status as RazorpayRefund['status'],
    created_at: Number(refund.created_at),
  };
}

/** Server-only cancellation refund. Reuse the same key and amount on every retry. */
export async function createRazorpayRefund(
  config: RazorpayConfig,
  input: { paymentId: string; amount: number; idempotencyKey: string },
  request: typeof fetch = fetch,
): Promise<RazorpayRefund> {
  if (
    !PAYMENT_ID.test(input.paymentId) ||
    !Number.isSafeInteger(input.amount) ||
    input.amount < 1 ||
    input.amount > MAX_AMOUNT ||
    !/^[A-Za-z0-9_-]{10,100}$/.test(input.idempotencyKey)
  )
    throw new RazorpayError('Send valid refund details.');
  const refund = parseRefund(
    await providerRequest(
      config,
      `/payments/${input.paymentId}/refund`,
      {
        method: 'POST',
        headers: { 'X-Refund-Idempotency': input.idempotencyKey },
        body: JSON.stringify({ amount: input.amount }),
      },
      request,
    ),
  );
  if (refund.payment_id !== input.paymentId || refund.amount !== input.amount) invalidProvider();
  return refund;
}

export async function fetchRazorpayRefund(
  config: RazorpayConfig,
  paymentId: string,
  refundId: string,
  request: typeof fetch = fetch,
): Promise<RazorpayRefund> {
  if (!PAYMENT_ID.test(paymentId) || !REFUND_ID.test(refundId))
    throw new RazorpayError('Send a valid refund identifier.');
  const refund = parseRefund(
    await providerRequest(
      config,
      `/payments/${paymentId}/refunds/${refundId}`,
      { method: 'GET' },
      request,
    ),
  );
  if (refund.id !== refundId || refund.payment_id !== paymentId) invalidProvider();
  return refund;
}

/** A short complete page is mandatory; an oversized/moving history needs operator reconciliation. */
export async function fetchRazorpayPaymentRefunds(
  config: RazorpayConfig,
  paymentId: string,
  request: typeof fetch = fetch,
): Promise<RazorpayRefund[]> {
  if (!PAYMENT_ID.test(paymentId)) throw new RazorpayError('Send a valid payment identifier.');
  const collection = object(
    await providerRequest(
      config,
      `/payments/${paymentId}/refunds?count=100&skip=0`,
      { method: 'GET' },
      request,
    ),
  );
  if (
    collection.entity !== 'collection' ||
    !Number.isSafeInteger(collection.count) ||
    Number(collection.count) < 0 ||
    Number(collection.count) >= 100 ||
    !Array.isArray(collection.items) ||
    collection.count !== collection.items.length ||
    Object.keys(collection).some((key) => !['entity', 'count', 'items'].includes(key))
  )
    invalidProvider();
  const refunds = collection.items.map(parseRefund);
  if (
    new Set(refunds.map((refund) => refund.id)).size !== refunds.length ||
    refunds.some((refund) => refund.payment_id !== paymentId)
  )
    invalidProvider();
  return refunds;
}

function authorization(config: RazorpayConfig): string {
  // Validated keys are printable ASCII; no browser or Node-only Buffer dependency is needed.
  return `Basic ${btoa(`${config.keyId}:${config.keySecret}`)}`;
}

async function providerRequest(
  config: RazorpayConfig,
  path: string,
  options: RequestInit,
  request: typeof fetch,
): Promise<unknown> {
  try {
    const response = await request(`${API_ORIGIN}${path}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        Authorization: authorization(config),
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers ?? {}),
      },
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
    if (
      !response.ok ||
      response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !==
        'application/json'
    )
      invalidProvider();
    return parseJson(await boundedBytes(response, PROVIDER_BODY_LIMIT));
  } catch {
    invalidProvider();
  }
}

/** Server-authoritative INR paise and an opaque server receipt are the only create inputs. */
export async function createRazorpayOrder(
  config: RazorpayConfig,
  input: { amount: number; receipt: string },
  request: typeof fetch = fetch,
): Promise<RazorpayProviderOrder> {
  if (!amount(input.amount) || !/^[\x21-\x7e]{1,40}$/.test(input.receipt))
    throw new RazorpayError('This order cannot be paid online.');
  const order = object(
    await providerRequest(
      config,
      '/orders',
      {
        method: 'POST',
        body: JSON.stringify({
          amount: input.amount,
          currency: 'INR',
          receipt: input.receipt,
          partial_payment: false,
        }),
      },
      request,
    ),
  );
  if (
    order.entity !== 'order' ||
    typeof order.id !== 'string' ||
    !ORDER_ID.test(order.id) ||
    order.amount !== input.amount ||
    order.currency !== 'INR' ||
    order.receipt !== input.receipt ||
    order.status !== 'created' ||
    order.amount_paid !== 0 ||
    order.amount_due !== input.amount
  )
    invalidProvider();
  return {
    id: order.id,
    entity: 'order',
    amount: input.amount,
    currency: 'INR',
    receipt: input.receipt,
    status: 'created',
    amount_paid: 0,
    amount_due: input.amount,
  };
}

export async function fetchRazorpayPayment(
  config: RazorpayConfig,
  paymentId: string,
  request: typeof fetch = fetch,
): Promise<RazorpayPayment> {
  if (!PAYMENT_ID.test(paymentId)) throw new RazorpayError('Send a valid payment identifier.');
  const payment = parsePayment(
    await providerRequest(config, `/payments/${paymentId}`, { method: 'GET' }, request),
  );
  if (payment.id !== paymentId) invalidProvider();
  return payment;
}

/**
 * The order-specific endpoint documents a complete collection, not a paginated page.
 * Never infer an unpaid order from a truncated, duplicate or unfamiliar envelope.
 */
export async function fetchRazorpayOrderPayments(
  config: RazorpayConfig,
  providerOrderId: string,
  request: typeof fetch = fetch,
  allowRefunds = false,
): Promise<RazorpayPayment[]> {
  if (!ORDER_ID.test(providerOrderId))
    throw new RazorpayError('Send a valid payment order identifier.');
  const collection = object(
    await providerRequest(
      config,
      `/orders/${providerOrderId}/payments`,
      { method: 'GET' },
      request,
    ),
  );
  if (
    collection.entity !== 'collection' ||
    !Number.isSafeInteger(collection.count) ||
    Number(collection.count) < 0 ||
    Number(collection.count) >= 100 ||
    !Array.isArray(collection.items) ||
    collection.count !== collection.items.length ||
    Object.keys(collection).some((key) => !['entity', 'count', 'items'].includes(key))
  )
    invalidProvider();
  const payments = collection.items.map((value) => {
    const payment = object(value);
    if (!allowRefunds && payment.refund_status !== undefined && payment.refund_status !== null)
      invalidProvider();
    return parsePayment(payment);
  });
  const identities = new Set(payments.map((payment) => payment.id));
  if (
    identities.size !== payments.length ||
    payments.some((payment) => payment.order_id !== providerOrderId)
  )
    invalidProvider();
  return payments;
}

/** Binding/amount/capture must be independently verified before an atomic server ledger write. */
export function verifyRazorpayPayment(
  payment: RazorpayPayment,
  expected: { providerOrderId: string; amount: number; paymentId?: string },
): RazorpayVerifiedPayment {
  const parsed = parsePayment({ ...payment, entity: 'payment' });
  if (
    !ORDER_ID.test(expected.providerOrderId) ||
    !amount(expected.amount) ||
    parsed.order_id !== expected.providerOrderId ||
    parsed.amount !== expected.amount ||
    (expected.paymentId !== undefined && parsed.id !== expected.paymentId)
  )
    throw new RazorpayError(
      'This payment does not match the stored order.',
      409,
      'payment_mismatch',
    );
  if (parsed.status === 'refunded' || parsed.amount_refunded !== 0)
    throw new RazorpayError(
      'This payment needs restaurant review.',
      409,
      'payment_review_required',
    );
  const { id, order_id, amount: paidAmount, currency, captured, status } = parsed;
  return { id, order_id, amount: paidAmount, currency, captured, status };
}
