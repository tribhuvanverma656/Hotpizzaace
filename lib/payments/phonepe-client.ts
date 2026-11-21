import type { Order } from '@/types';

export type PhonePeCapability = { provider: 'phonepe'; mode: 'test' | 'live'; enabled: boolean };
export type PhonePeCheckout = {
  provider: 'phonepe';
  mode: 'test' | 'live';
  orderId: string;
  attemptId: string;
  amount: number;
  checkoutUrl: string;
  expiresAt: string;
};
export type PhonePeCheckoutStatus = {
  provider: 'phonepe';
  mode: 'test' | 'live';
  orderId: string;
  attemptId: string;
  resumable: boolean;
  retryable: boolean;
};
type AttemptStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function isPhonePeOrder(order: Pick<Order, 'paymentMode'>): boolean {
  return order.paymentMode === 'phonepe_test' || order.paymentMode === 'phonepe_live';
}

export function readPhonePeCapability(snapshot: unknown): PhonePeCapability | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const catalog = snapshot as Record<string, unknown>;
  const value = catalog.payments;
  if (!value || typeof value !== 'object') return null;
  const payments = value as Record<string, unknown>;
  if (
    payments.provider !== 'phonepe' ||
    payments.enabled !== true ||
    !(
      (catalog.mode === 'development' && payments.mode === 'test') ||
      (catalog.mode === 'production' && payments.mode === 'live')
    )
  )
    return null;
  return { provider: 'phonepe', mode: payments.mode as 'test' | 'live', enabled: true };
}

function phonePeUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /(^|\.)phonepe\.com$/.test(url.hostname);
  } catch {
    return false;
  }
}

/** Only the authenticated server response selects the PayPage and amount. */
export function parsePhonePeCheckout(
  value: unknown,
  expected: { orderId: string; attemptId: string },
): PhonePeCheckout {
  if (!value || typeof value !== 'object') throw new Error('Payment details are unavailable.');
  const result = value as Record<string, unknown>;
  if (
    result.provider !== 'phonepe' ||
    !['test', 'live'].includes(String(result.mode)) ||
    !phonePeUrl(result.checkoutUrl) ||
    !Number.isSafeInteger(result.amount) ||
    Number(result.amount) < 100 ||
    typeof result.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(result.expiresAt)) ||
    result.orderId !== expected.orderId ||
    result.attemptId !== expected.attemptId ||
    !uuid.test(expected.attemptId)
  )
    throw new Error('Payment details could not be verified. Check your order before trying again.');
  return result as PhonePeCheckout;
}

export function parsePhonePeCheckoutStatus(
  value: unknown,
  expected: { orderId: string; attemptId: string },
): PhonePeCheckoutStatus {
  if (!value || typeof value !== 'object') throw new Error('Payment status is unavailable.');
  const result = value as Record<string, unknown>;
  if (
    result.provider !== 'phonepe' ||
    !['test', 'live'].includes(String(result.mode)) ||
    result.orderId !== expected.orderId ||
    result.attemptId !== expected.attemptId ||
    !uuid.test(expected.attemptId) ||
    typeof result.resumable !== 'boolean' ||
    typeof result.retryable !== 'boolean'
  )
    throw new Error('Payment status could not be verified. Keep this order and check again.');
  return result as PhonePeCheckoutStatus;
}

function attemptStorageKey(scope: { userId: string | null; orderId: string }): string {
  return `hpa-phonepe-attempt:v1:${encodeURIComponent(scope.userId ?? 'guest')}:${encodeURIComponent(scope.orderId)}`;
}

export function readPhonePeAttemptId(
  storage: AttemptStorage | undefined,
  scope: { userId: string | null; orderId: string },
): string | undefined {
  try {
    const saved = JSON.parse(storage?.getItem(attemptStorageKey(scope)) ?? 'null');
    return typeof saved?.attemptId === 'string' && uuid.test(saved.attemptId)
      ? saved.attemptId
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Keep one attempt across reloads and closed PayPages. Only a server-verified failure
 * (`fresh: true`) starts a new attempt, because a PhonePe order cannot be reopened once FAILED.
 */
export function phonePeAttemptId(
  storage: AttemptStorage | undefined,
  scope: { userId: string | null; orderId: string },
  options: { existing?: string; fresh?: boolean } = {},
): string {
  const stored = readPhonePeAttemptId(storage, scope);
  const attemptId = options.fresh
    ? crypto.randomUUID()
    : options.existing && uuid.test(options.existing)
      ? options.existing
      : (stored ?? crypto.randomUUID());
  try {
    storage?.setItem(attemptStorageKey(scope), JSON.stringify({ attemptId }));
  } catch {
    // The server still refuses a second unresolved PhonePe order for this receipt.
  }
  return attemptId;
}

export type PhonePeTransactResult = 'USER_CANCEL' | 'CONCLUDED';
type PhonePeCheckoutSdk = {
  transact: (options: {
    tokenUrl: string;
    type: 'IFRAME';
    callback: (response: unknown) => void;
  }) => void;
  closePage?: () => void;
};
let sdkRequest: Promise<PhonePeCheckoutSdk> | null = null;

/** PhonePe publishes one checkout.js for its PayPage; it is loaded only when paying. */
export function loadPhonePeCheckout(): Promise<PhonePeCheckoutSdk> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Open payment in a browser.'));
  const browser = window as Window & { PhonePeCheckout?: PhonePeCheckoutSdk };
  if (typeof browser.PhonePeCheckout?.transact === 'function')
    return Promise.resolve(browser.PhonePeCheckout);
  if (sdkRequest) return sdkRequest;
  sdkRequest = new Promise<PhonePeCheckoutSdk>((resolve, reject) => {
    let settled = false;
    const script = document.createElement('script');
    script.src = 'https://mercury.phonepe.com/web/bundle/checkout.js';
    script.async = true;
    const fail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      script.onload = null;
      script.onerror = null;
      script.remove();
      sdkRequest = null;
      reject(new Error('PhonePe could not load. Check your connection and try again.'));
    };
    const timeout = setTimeout(fail, 15000);
    script.onerror = fail;
    script.onload = () => {
      clearTimeout(timeout);
      if (typeof browser.PhonePeCheckout?.transact === 'function') {
        settled = true;
        resolve(browser.PhonePeCheckout);
      } else fail();
    };
    document.head.appendChild(script);
  });
  return sdkRequest;
}

/** The SDK callback reports only whether the PayPage closed; it is never a payment result. */
export function phonePeCallbackResult(response: unknown): PhonePeTransactResult {
  return response === 'USER_CANCEL' ? 'USER_CANCEL' : 'CONCLUDED';
}
