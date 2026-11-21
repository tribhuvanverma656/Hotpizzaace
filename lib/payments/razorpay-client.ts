import type { Order } from '@/types';

export type RazorpayCapability = { provider: 'razorpay'; mode: 'test' | 'live'; enabled: boolean };
export type RazorpayCheckout = {
  provider: 'razorpay';
  mode: 'test' | 'live';
  keyId: string;
  providerOrderId: string;
  amount: number;
  currency: 'INR';
  orderId: string;
  attemptId: string;
};
export type RazorpayProof = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};
export type RazorpayCheckoutStatus = {
  provider: 'razorpay';
  mode: 'test' | 'live';
  orderId: string;
  attemptId: string;
  resumable: boolean;
};
type AttemptStorage = Pick<Storage, 'getItem' | 'setItem'>;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function readRazorpayCapability(snapshot: unknown): RazorpayCapability | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const catalog = snapshot as Record<string, unknown>;
  const value = catalog.payments;
  if (!value || typeof value !== 'object') return null;
  const payments = value as Record<string, unknown>;
  if (
    payments.provider !== 'razorpay' ||
    payments.enabled !== true ||
    !(
      (catalog.mode === 'development' && payments.mode === 'test') ||
      (catalog.mode === 'production' && payments.mode === 'live')
    )
  )
    return null;
  return { provider: 'razorpay', mode: payments.mode as 'test' | 'live', enabled: true };
}

/** Only the authenticated server response selects a key, provider order and amount. */
export function parseRazorpayCheckout(
  value: unknown,
  expected: { orderId: string; attemptId: string },
): RazorpayCheckout {
  if (!value || typeof value !== 'object') throw new Error('Payment details are unavailable.');
  const result = value as Record<string, unknown>;
  if (
    result.provider !== 'razorpay' ||
    !['test', 'live'].includes(String(result.mode)) ||
    typeof result.keyId !== 'string' ||
    !new RegExp(`^rzp_${result.mode}_[A-Za-z0-9]+$`).test(result.keyId) ||
    typeof result.providerOrderId !== 'string' ||
    !/^order_[A-Za-z0-9]+$/.test(result.providerOrderId) ||
    !Number.isSafeInteger(result.amount) ||
    Number(result.amount) <= 0 ||
    result.currency !== 'INR' ||
    result.orderId !== expected.orderId ||
    result.attemptId !== expected.attemptId ||
    !uuid.test(expected.attemptId)
  )
    throw new Error('Payment details could not be verified. Check your order before trying again.');
  return result as RazorpayCheckout;
}

export function parseRazorpayProof(value: unknown, providerOrderId: string): RazorpayProof {
  if (!value || typeof value !== 'object') throw new Error('Payment confirmation is incomplete.');
  const proof = value as Record<string, unknown>;
  if (
    proof.razorpay_order_id !== providerOrderId ||
    typeof proof.razorpay_payment_id !== 'string' ||
    !/^pay_[A-Za-z0-9]+$/.test(proof.razorpay_payment_id) ||
    typeof proof.razorpay_signature !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(proof.razorpay_signature)
  )
    throw new Error(
      'Payment confirmation could not be verified. Check your order before paying again.',
    );
  return proof as RazorpayProof;
}

export function parseRazorpayCheckoutStatus(
  value: unknown,
  expected: { orderId: string; attemptId: string },
): RazorpayCheckoutStatus {
  if (!value || typeof value !== 'object') throw new Error('Payment status is unavailable.');
  const result = value as Record<string, unknown>;
  if (
    result.provider !== 'razorpay' ||
    !['test', 'live'].includes(String(result.mode)) ||
    result.orderId !== expected.orderId ||
    result.attemptId !== expected.attemptId ||
    !uuid.test(expected.attemptId) ||
    typeof result.resumable !== 'boolean'
  )
    throw new Error('Payment status could not be verified. Keep this order and check again.');
  return result as RazorpayCheckoutStatus;
}

/** An unpaid order alone cannot prove a provider payment is safe to resume. */
export function canResumeRazorpayCheckout(
  order: Pick<Order, 'id' | 'paymentMode' | 'paymentStatus' | 'status'>,
  attemptId: string,
  capability: unknown,
): boolean {
  if (!capability || typeof capability !== 'object') return false;
  const result = capability as Record<string, unknown>;
  return (
    uuid.test(attemptId) &&
    order.status === 'pending' &&
    ['initiated', 'failed'].includes(order.paymentStatus) &&
    isRazorpayOrder(order) &&
    result.provider === 'razorpay' &&
    result.mode === (order.paymentMode === 'razorpay_test' ? 'test' : 'live') &&
    result.orderId === order.id &&
    result.attemptId === attemptId &&
    result.resumable === true
  );
}

function attemptStorageKey(scope: { userId: string | null; orderId: string }): string {
  return `hpa-razorpay-attempt:v1:${encodeURIComponent(scope.userId ?? 'guest')}:${encodeURIComponent(scope.orderId)}`;
}

/** Read status without allocating an attempt, changing storage or starting provider setup. */
export function readPaymentAttemptId(
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

/** A closed Checkout is not a failed payment; keep its attempt across reloads and network retries. */
export function paymentAttemptId(
  storage: AttemptStorage | undefined,
  scope: { userId: string | null; orderId: string },
  existing?: string,
): string {
  const key = attemptStorageKey(scope);
  let stored: string | null = null;
  try {
    const saved = JSON.parse(storage?.getItem(key) ?? 'null');
    if (saved && typeof saved.attemptId === 'string') {
      stored = saved.attemptId;
    }
  } catch {
    // An in-memory attempt still survives requests in this mounted payment card.
  }
  // Keep one provider order across failed payments too. A previous Checkout in another tab
  // may still complete; a fresh provider order would escape Razorpay's paid-order guard.
  const attemptId =
    existing && uuid.test(existing)
      ? existing
      : stored && uuid.test(stored)
        ? stored
        : crypto.randomUUID();
  try {
    storage?.setItem(key, JSON.stringify({ attemptId }));
  } catch {
    // The server independently prevents creating another provider order for an unresolved attempt.
  }
  return attemptId;
}

export function isRazorpayOrder(order: Pick<Order, 'paymentMode'>): boolean {
  return order.paymentMode === 'razorpay_test' || order.paymentMode === 'razorpay_live';
}

export type RazorpayOptions = {
  key: string;
  amount: number;
  currency: 'INR';
  order_id: string;
  name: string;
  description: string;
  prefill: { name: string; contact: string };
  handler: (proof: unknown) => void;
  modal: { ondismiss: () => void };
  retry: { enabled: boolean };
  theme: { color: string };
};
export type RazorpayInstance = {
  open: () => void;
  close: () => void;
  on: (event: 'payment.failed', callback: () => void) => void;
};
export type RazorpayCheckoutLease = {
  isActive: () => boolean;
  attach: (instance: Pick<RazorpayInstance, 'close'>) => boolean;
  guard: <Args extends unknown[]>(callback: (...args: Args) => void) => (...args: Args) => void;
};

/** Retired SDK callbacks cannot alter a newer Checkout or release its request lock. */
export function createRazorpayCheckoutLifecycle() {
  let generation = 0;
  let current: Pick<RazorpayInstance, 'close'> | null = null;
  const retire = () => {
    generation += 1;
    const previous = current;
    current = null;
    previous?.close();
  };
  return {
    begin(): RazorpayCheckoutLease {
      retire();
      const owner = generation;
      let instance: Pick<RazorpayInstance, 'close'> | null = null;
      return {
        isActive: () => generation === owner,
        attach(next) {
          if (generation !== owner) {
            next.close();
            return false;
          }
          instance = next;
          current = next;
          return true;
        },
        guard(callback) {
          return (...args) => {
            if (generation === owner && instance && current === instance) callback(...args);
          };
        },
      };
    },
    dispose: retire,
  };
}
export type RazorpayConstructor = new (options: RazorpayOptions) => RazorpayInstance;
let sdkRequest: Promise<RazorpayConstructor> | null = null;

/** Load the official hosted Checkout only after the customer chooses to pay. */
export function loadRazorpayCheckout(): Promise<RazorpayConstructor> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Open payment in a browser.'));
  const browser = window as Window & { Razorpay?: RazorpayConstructor };
  if (typeof browser.Razorpay === 'function') return Promise.resolve(browser.Razorpay);
  if (sdkRequest) return sdkRequest;
  sdkRequest = new Promise<RazorpayConstructor>((resolve, reject) => {
    let settled = false;
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    const fail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      script.onload = null;
      script.onerror = null;
      script.remove();
      sdkRequest = null;
      reject(new Error('Razorpay could not load. Check your connection and try again.'));
    };
    const timeout = setTimeout(fail, 15000);
    script.onerror = fail;
    script.onload = () => {
      clearTimeout(timeout);
      if (typeof browser.Razorpay === 'function') {
        settled = true;
        resolve(browser.Razorpay);
      } else fail();
    };
    document.head.appendChild(script);
  });
  return sdkRequest;
}
