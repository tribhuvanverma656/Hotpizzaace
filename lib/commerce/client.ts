import type { ExpectedPayableQuote } from '../rounding';
import type { Branch, CartItem, Category, CheckoutInput, Order, Product } from '@/types';
import type { RazorpayCapability } from '@/lib/payments/razorpay-client';
import type { PhonePeCapability } from '@/lib/payments/phonepe-client';

export type SharedCatalog = {
  products: Product[];
  categories: Category[];
  branches: Branch[];
  revision: number;
  mode?: 'development' | 'production';
  allowSimulatedPayments?: boolean;
  payments?: RazorpayCapability | PhonePeCapability;
};
export type SharedOrderRequest = Omit<CheckoutInput, 'paymentStatus'> &
  ExpectedPayableQuote & {
    items: CartItem[];
    coupon: string;
  };
export class CommerceError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'CommerceError';
  }
}
/** Safari 16.4 supports cancellation and timeouts, but not AbortSignal.any. */
function boundedRequestSignal(caller?: AbortSignal) {
  const deadline = AbortSignal.timeout(20_000);
  if (!caller) return { signal: deadline, dispose: () => {} };
  const controller = new AbortController();
  const listeners: { source: AbortSignal; forward: () => void }[] = [];
  for (const source of [caller, deadline]) {
    const forward = () => controller.abort(source.reason);
    if (source.aborted) {
      forward();
      break;
    }
    source.addEventListener('abort', forward, { once: true });
    listeners.push({ source, forward });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      for (const { source, forward } of listeners) source.removeEventListener('abort', forward);
    },
  };
}
/** Same-origin server routes verify the session and recalculate every order. */
export async function commerceRequest<T>(
  path: string,
  options: { method?: 'GET' | 'POST' | 'PATCH'; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  // A component's lifetime signal cancels obsolete reads; it must not remove the
  // network deadline. Keep one deadline across the single guest bootstrap retry.
  const { signal, dispose } = boundedRequestSignal(options.signal);
  try {
    for (let bootstrapAttempt = 0; ; bootstrapAttempt += 1) {
      signal.throwIfAborted();
      const response = await fetch(`/api/commerce/${path}`, {
        method: options.method ?? 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        signal,
      });
      const result = await response.json().catch(() => null);
      // A cancelled body read is cancellation, not a malformed-response failure.
      signal.throwIfAborted();
      if (
        bootstrapAttempt === 0 &&
        (path === 'orders' || /^table\/[a-f0-9]{64}\/(?:requests|online-order)$/.test(path)) &&
        options.method === 'POST' &&
        response.status === 409 &&
        result?.code === 'guest_session_initialized'
      )
        continue;
      if (!response.ok) {
        const message =
          typeof result?.error === 'string'
            ? result.error
            : typeof result?.message === 'string'
              ? result.message
              : 'The restaurant connection could not complete. Please try again.';
        const code =
          typeof result?.code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(result.code)
            ? result.code
            : undefined;
        throw new CommerceError(message, response.status, code);
      }
      if (!result || typeof result !== 'object')
        throw new CommerceError(
          'The restaurant returned an incomplete response. Please try again.',
          502,
        );
      return result as T;
    }
  } finally {
    dispose();
  }
}
export function orderTrackingHref(order: Pick<Order, 'id'> & { trackingUrl?: string }): string {
  return order.trackingUrl?.startsWith('/track-order?')
    ? order.trackingUrl
    : `/track-order?order=${encodeURIComponent(order.id)}`;
}
export function orderConfirmationHref(order: Pick<Order, 'id'> & { trackingUrl?: string }): string {
  const tracking = new URL(orderTrackingHref(order), 'https://local.invalid');
  const params = new URLSearchParams({ id: order.id });
  const access = tracking.searchParams.get('access');
  if (access) params.set('access', access);
  return `/order-success?${params}`;
}

/** Do not erase a different cart changed in another tab while an order request was pending. */
export function cartMatchesPlacedOrder(cart: CartItem[], order: Order, branchId: string): boolean {
  return (
    order.branchId === branchId &&
    cart.length === order.items.length &&
    cart.every((item) =>
      order.items.some(
        (ordered) =>
          ordered.id === item.id &&
          ordered.productId === item.productId &&
          ordered.quantity === item.quantity,
      ),
    )
  );
}
