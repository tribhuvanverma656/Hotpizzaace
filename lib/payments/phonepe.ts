/**
 * PhonePe Payment Gateway, Standard Checkout v2. Portable server/Edge utilities only:
 * never import this module into a browser bundle. Credentials stay in Edge secrets.
 *
 * Trust model: the browser PayPage callback, the redirect and the webhook body are all
 * hints. Only a server-side Order Status GET, matched against the stored attempt's
 * merchantOrderId, PhonePe orderId and exact amount, can mark an order paid or failed.
 * An unbound attempt can recover its canonical PhonePe orderId only from a terminal
 * authenticated status response for its stored merchantOrderId and exact amount.
 */
import { RazorpayError } from './razorpay';

export type PhonePeMode = 'test' | 'live';
export type PhonePeConfig = {
  mode: PhonePeMode;
  paymentMode: 'phonepe_test' | 'phonepe_live';
  clientId: string;
  clientSecret: string;
  clientVersion: string;
  webhookUsername: string;
  webhookPassword: string;
  siteOrigin: string;
};
export type PhonePeEnvironment = {
  PHONEPE_ENABLED?: string;
  PHONEPE_MODE?: string;
  PHONEPE_CLIENT_ID?: string;
  PHONEPE_CLIENT_SECRET?: string;
  PHONEPE_CLIENT_VERSION?: string;
  PHONEPE_WEBHOOK_USERNAME?: string;
  PHONEPE_WEBHOOK_PASSWORD?: string;
  PHONEPE_SITE_ORIGIN?: string;
};
export type PhonePeCreatedPayment = {
  orderId: string;
  state: 'PENDING';
  checkoutUrl: string;
  expiresAt: string;
};
export type PhonePePaymentDetail = {
  transactionId: string;
  state: 'PENDING' | 'COMPLETED' | 'FAILED';
  amount: number;
};
export type PhonePeOrderStatus = {
  orderId: string;
  state: 'PENDING' | 'COMPLETED' | 'FAILED';
  amount: number;
  paymentDetails: PhonePePaymentDetail[];
};
export type PhonePeVerifiedOutcome =
  | { kind: 'captured'; transactionId: string }
  | { kind: 'failed'; transactionId: string | null }
  | { kind: 'pending' };
export type PhonePeRefundStatus = {
  originalMerchantOrderId: string;
  amount: number;
  state: 'PENDING' | 'COMPLETED' | 'FAILED';
};
export type PhonePeWebhook =
  | { kind: 'order'; event: string; merchantOrderId: string }
  | { kind: 'refund'; event: string; merchantRefundId: string; originalMerchantOrderId: string };

/** Subclass so existing Edge error mapping returns the same safe JSON shape. */
export class PhonePeError extends RazorpayError {
  constructor(message: string, status = 400, code = 'invalid_payment_request') {
    super(message, status, code);
    this.name = 'PhonePeError';
  }
}

const HOSTS = {
  test: {
    token: 'https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token',
    api: 'https://api-preprod.phonepe.com/apis/pg-sandbox',
  },
  live: {
    token: 'https://api.phonepe.com/apis/identity-manager/v1/oauth/token',
    api: 'https://api.phonepe.com/apis/pg',
  },
} as const;
const MERCHANT_ORDER_ID = /^[A-Za-z0-9_-]{1,63}$/;
const PROVIDER_ID = /^[A-Za-z0-9_-]{6,100}$/;
const PROVIDER_BODY_LIMIT = 65_536;
const WEBHOOK_BODY_LIMIT = 262_144;
const MAX_AMOUNT = 100_000_000;
/** PayPage lifetime. PhonePe accepts 300–3600 seconds. */
export const PHONEPE_EXPIRE_SECONDS = 1200;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidProvider();
  return value as Record<string, unknown>;
}
function printable(value: unknown, min: number, max: number): value is string {
  return (
    typeof value === 'string' &&
    value.length >= min &&
    value.length <= max &&
    /^[\x21-\x7e]+$/.test(value)
  );
}
function amount(value: unknown, minimum = 100): number | null {
  // Order Status documents a String amount while every sample is a number.
  const parsed = typeof value === 'string' && /^[0-9]{1,12}$/.test(value) ? Number(value) : value;
  return Number.isSafeInteger(parsed) && Number(parsed) >= minimum && Number(parsed) <= MAX_AMOUNT
    ? Number(parsed)
    : null;
}
function unavailable(): never {
  throw new PhonePeError(
    'Online payment is not configured for this environment.',
    503,
    'payment_unavailable',
  );
}
function invalidProvider(): never {
  throw new PhonePeError(
    'The payment provider could not verify this payment. Please retry the same payment check.',
    502,
    'payment_provider_unavailable',
  );
}
function siteOrigin(value: unknown, mode: PhonePeMode): string | null {
  if (typeof value !== 'string' || value.length > 200) return null;
  try {
    const url = new URL(value);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.origin !== value.replace(/\/$/, '')) return null;
    if (url.protocol === 'https:' || (mode === 'test' && local && url.protocol === 'http:'))
      return url.origin;
  } catch {
    return null;
  }
  return null;
}

/** Explicit enablement, complete secrets and a mode matching the database environment are required. */
export function readPhonePeConfig(
  environment: PhonePeEnvironment,
  catalogMode: unknown,
): PhonePeConfig | null {
  if (environment.PHONEPE_ENABLED !== 'true') return null;
  const mode = environment.PHONEPE_MODE;
  if (
    (mode !== 'test' && mode !== 'live') ||
    !['development', 'production'].includes(String(catalogMode)) ||
    (catalogMode === 'development' ? mode !== 'test' : mode !== 'live')
  )
    unavailable();
  const origin = siteOrigin(environment.PHONEPE_SITE_ORIGIN, mode);
  if (
    typeof environment.PHONEPE_CLIENT_ID !== 'string' ||
    !/^[A-Za-z0-9_-]{4,100}$/.test(environment.PHONEPE_CLIENT_ID) ||
    !printable(environment.PHONEPE_CLIENT_SECRET, 8, 256) ||
    typeof environment.PHONEPE_CLIENT_VERSION !== 'string' ||
    !/^[0-9]{1,4}$/.test(environment.PHONEPE_CLIENT_VERSION) ||
    !printable(environment.PHONEPE_WEBHOOK_USERNAME, 4, 128) ||
    !printable(environment.PHONEPE_WEBHOOK_PASSWORD, 8, 128) ||
    !origin
  )
    unavailable();
  return {
    mode,
    paymentMode: mode === 'test' ? 'phonepe_test' : 'phonepe_live',
    clientId: environment.PHONEPE_CLIENT_ID,
    clientSecret: environment.PHONEPE_CLIENT_SECRET,
    clientVersion: environment.PHONEPE_CLIENT_VERSION,
    webhookUsername: environment.PHONEPE_WEBHOOK_USERNAME,
    webhookPassword: environment.PHONEPE_WEBHOOK_PASSWORD,
    siteOrigin: origin,
  };
}

async function boundedBytes(source: Request | Response, limit: number): Promise<Uint8Array> {
  const declared = source.headers.get('content-length');
  if (declared && Number(declared) > limit)
    throw new PhonePeError('This payment message is too large.', 413, 'payment_body_too_large');
  const reader = source.body?.getReader();
  if (!reader) throw new PhonePeError('Send a valid payment message.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new PhonePeError('This payment message is too large.', 413, 'payment_body_too_large');
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
function parseJson(raw: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  } catch {
    throw new PhonePeError('Send a valid payment message.');
  }
}

type CachedToken = { token: string; refreshAfter: number };
const tokens = new Map<string, CachedToken>();
/** Tests reset module state between scenarios. */
export function clearPhonePeTokenCache() {
  tokens.clear();
}

/** OAuth client-credentials token, reused until two minutes before its expires_at. */
export async function phonePeAccessToken(
  config: PhonePeConfig,
  request: typeof fetch = fetch,
  now = () => Date.now(),
): Promise<string> {
  const key = `${config.mode}:${config.clientId}:${config.clientVersion}`;
  const cached = tokens.get(key);
  if (cached && cached.refreshAfter > now()) return cached.token;
  let body: Record<string, unknown>;
  try {
    const response = await request(HOSTS[config.mode].token, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_version: config.clientVersion,
        client_secret: config.clientSecret,
        grant_type: 'client_credentials',
      }).toString(),
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) invalidProvider();
    body = object(parseJson(await boundedBytes(response, PROVIDER_BODY_LIMIT)));
  } catch {
    invalidProvider();
  }
  const token = body.access_token;
  const expiresAt = Number(body.expires_at);
  if (
    typeof token !== 'string' ||
    token.length < 16 ||
    token.length > 4096 ||
    !/^[\x21-\x7e]+$/.test(token) ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt * 1000 <= now()
  )
    invalidProvider();
  tokens.set(key, {
    token,
    refreshAfter: Math.min(expiresAt * 1000 - 120_000, now() + 86_400_000),
  });
  return token;
}

async function providerRequest(
  config: PhonePeConfig,
  path: string,
  options: { method: 'GET' | 'POST'; body?: unknown },
  request: typeof fetch,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await phonePeAccessToken(config, request);
    let response: Response;
    try {
      response = await request(`${HOSTS[config.mode].api}${path}`, {
        method: options.method,
        headers: {
          Accept: 'application/json',
          Authorization: `O-Bearer ${token}`,
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      invalidProvider();
    }
    // A revoked/rotated token is retried once with a fresh one.
    if (response.status === 401 && attempt === 0) {
      tokens.clear();
      await response.body?.cancel();
      continue;
    }
    if (
      !response.ok ||
      response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !==
        'application/json'
    ) {
      await response.body?.cancel().catch(() => undefined);
      invalidProvider();
    }
    try {
      return object(parseJson(await boundedBytes(response, PROVIDER_BODY_LIMIT)));
    } catch {
      invalidProvider();
    }
  }
  invalidProvider();
}

function checkoutUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) invalidProvider();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    invalidProvider();
  }
  if (url.protocol !== 'https:' || !/(^|\.)phonepe\.com$/.test(url.hostname)) invalidProvider();
  return url.toString();
}
function epochToIso(value: unknown): string {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) invalidProvider();
  // expireAt samples are milliseconds; accept seconds defensively.
  return new Date(number < 10_000_000_000 ? number * 1000 : number).toISOString();
}

/** Server-authoritative paise and our merchantOrderId are the only payment inputs. */
export async function createPhonePePayment(
  config: PhonePeConfig,
  input: { merchantOrderId: string; amount: number; redirectUrl: string },
  request: typeof fetch = fetch,
): Promise<PhonePeCreatedPayment> {
  if (
    !MERCHANT_ORDER_ID.test(input.merchantOrderId) ||
    amount(input.amount) !== input.amount ||
    !input.redirectUrl.startsWith(`${config.siteOrigin}/`)
  )
    throw new PhonePeError('This order cannot be paid online.');
  const result = await providerRequest(
    config,
    '/checkout/v2/pay',
    {
      method: 'POST',
      body: {
        merchantOrderId: input.merchantOrderId,
        amount: input.amount,
        expireAfter: PHONEPE_EXPIRE_SECONDS,
        paymentFlow: {
          type: 'PG_CHECKOUT',
          merchantUrls: { redirectUrl: input.redirectUrl },
        },
      },
    },
    request,
  );
  if (
    typeof result.orderId !== 'string' ||
    !PROVIDER_ID.test(result.orderId) ||
    result.state !== 'PENDING'
  )
    invalidProvider();
  const expiresAt = epochToIso(result.expireAt);
  const lifetime = Date.parse(expiresAt) - Date.now();
  if (lifetime < 60_000 || lifetime > 2 * 3_600_000) invalidProvider();
  return {
    orderId: result.orderId,
    state: 'PENDING',
    checkoutUrl: checkoutUrl(result.redirectUrl),
    expiresAt,
  };
}

function parseState(value: unknown): PhonePeOrderStatus['state'] {
  if (value === 'PENDING' || value === 'COMPLETED' || value === 'FAILED') return value;
  invalidProvider();
}

export async function fetchPhonePeOrderStatus(
  config: PhonePeConfig,
  merchantOrderId: string,
  request: typeof fetch = fetch,
): Promise<PhonePeOrderStatus> {
  if (!MERCHANT_ORDER_ID.test(merchantOrderId))
    throw new PhonePeError('Send a valid payment order identifier.');
  const result = await providerRequest(
    config,
    `/checkout/v2/order/${encodeURIComponent(merchantOrderId)}/status?details=true&errorContext=false`,
    { method: 'GET' },
    request,
  );
  const total = amount(result.amount);
  if (typeof result.orderId !== 'string' || !PROVIDER_ID.test(result.orderId) || total === null)
    invalidProvider();
  const details = result.paymentDetails === undefined ? [] : result.paymentDetails;
  if (!Array.isArray(details) || details.length > 50) invalidProvider();
  return {
    orderId: result.orderId,
    state: parseState(result.state),
    amount: total,
    paymentDetails: details.map((value) => {
      const detail = object(value);
      const paid = amount(detail.amount);
      if (
        typeof detail.transactionId !== 'string' ||
        !PROVIDER_ID.test(detail.transactionId) ||
        paid === null
      )
        invalidProvider();
      return { transactionId: detail.transactionId, state: parseState(detail.state), amount: paid };
    }),
  };
}

/** Binding and exact amount are compared before any ledger write. */
export function verifyPhonePeOrderStatus(
  status: PhonePeOrderStatus,
  expected: { providerOrderId: string; amount: number },
): PhonePeVerifiedOutcome {
  if (status.orderId !== expected.providerOrderId || status.amount !== expected.amount)
    throw new PhonePeError(
      'This payment does not match the stored order.',
      409,
      'payment_mismatch',
    );
  const completed = status.paymentDetails.filter((detail) => detail.state === 'COMPLETED');
  if (status.state === 'COMPLETED') {
    // Exactly one completed instrument must carry the whole amount.
    if (completed.length !== 1 || completed[0].amount !== expected.amount) invalidProvider();
    return { kind: 'captured', transactionId: completed[0].transactionId };
  }
  if (completed.length > 0)
    throw new PhonePeError('This payment needs restaurant review.', 409, 'payment_review_required');
  if (status.state === 'FAILED')
    return {
      kind: 'failed',
      transactionId:
        status.paymentDetails.filter((detail) => detail.amount === expected.amount).at(-1)
          ?.transactionId ?? null,
    };
  return { kind: 'pending' };
}

export async function fetchPhonePeRefundStatus(
  config: PhonePeConfig,
  merchantRefundId: string,
  request: typeof fetch = fetch,
): Promise<PhonePeRefundStatus> {
  if (!MERCHANT_ORDER_ID.test(merchantRefundId))
    throw new PhonePeError('Send a valid refund identifier.');
  const result = await providerRequest(
    config,
    `/payments/v2/refund/${encodeURIComponent(merchantRefundId)}/status`,
    { method: 'GET' },
    request,
  );
  // PhonePe's refund-status examples include partial refunds below the ₹1
  // minimum for creating an order; any positive verified refund must hold it.
  const refunded = amount(result.amount, 1);
  if (
    typeof result.originalMerchantOrderId !== 'string' ||
    !MERCHANT_ORDER_ID.test(result.originalMerchantOrderId) ||
    refunded === null
  )
    invalidProvider();
  return {
    originalMerchantOrderId: result.originalMerchantOrderId,
    amount: refunded,
    state: parseState(result.state),
  };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * PhonePe sends Authorization: SHA256(username:password) as lowercase hex for the
 * username/password configured in the Business Dashboard webhook.
 */
export async function verifyPhonePeWebhookAuthorization(
  header: string | null,
  config: Pick<PhonePeConfig, 'webhookUsername' | 'webhookPassword'>,
): Promise<boolean> {
  const supplied = (header ?? '')
    .trim()
    .replace(/^SHA256\s+/i, '')
    .toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(supplied)) return false;
  const expected = await sha256Hex(`${config.webhookUsername}:${config.webhookPassword}`);
  let difference = 0;
  for (let index = 0; index < 64; index += 1)
    difference |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  return difference === 0;
}

export async function readPhonePeWebhookBody(request: Request): Promise<Uint8Array> {
  if (
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
  )
    throw new PhonePeError('Send a JSON payment event.');
  return boundedBytes(request, WEBHOOK_BODY_LIMIT);
}

/**
 * Only identifiers are read from an authenticated body; states come from a fresh GET.
 * Unknown events are acknowledged without mutation (PhonePe advises tolerant parsing).
 */
export function parsePhonePeWebhook(raw: Uint8Array): PhonePeWebhook | null {
  if (raw.byteLength > WEBHOOK_BODY_LIMIT)
    throw new PhonePeError('This payment message is too large.', 413, 'payment_body_too_large');
  const body = parseJson(raw);
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new PhonePeError('Send a valid payment event.');
  const event = (body as Record<string, unknown>).event;
  const payload = (body as Record<string, unknown>).payload;
  if (typeof event !== 'string' || !payload || typeof payload !== 'object')
    throw new PhonePeError('Send a valid payment event.');
  const fields = payload as Record<string, unknown>;
  if (event === 'checkout.order.completed' || event === 'checkout.order.failed') {
    if (
      typeof fields.merchantOrderId !== 'string' ||
      !MERCHANT_ORDER_ID.test(fields.merchantOrderId)
    )
      throw new PhonePeError('Send a valid payment event.');
    return { kind: 'order', event, merchantOrderId: fields.merchantOrderId };
  }
  if (
    event === 'pg.refund.completed' ||
    event === 'pg.refund.failed' ||
    event === 'pg.refund.accepted'
  ) {
    if (
      typeof fields.merchantRefundId !== 'string' ||
      !MERCHANT_ORDER_ID.test(fields.merchantRefundId) ||
      typeof fields.originalMerchantOrderId !== 'string' ||
      !MERCHANT_ORDER_ID.test(fields.originalMerchantOrderId)
    )
      throw new PhonePeError('Send a valid payment event.');
    return {
      kind: 'refund',
      event,
      merchantRefundId: fields.merchantRefundId,
      originalMerchantOrderId: fields.originalMerchantOrderId,
    };
  }
  return null;
}
