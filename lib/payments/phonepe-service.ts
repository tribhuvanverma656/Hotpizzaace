/**
 * PhonePe checkout orchestration for the Edge functions. Server/Edge only.
 *
 * Rules carried over from the Razorpay ledger:
 * - the server alone chooses the amount, merchantOrderId and redirect;
 * - a reservation is consumed once, and a lost create response leaves the attempt
 *   `unknown` until a terminal Order Status can recover it, never a second PhonePe order;
 * - only a server-side Order Status GET that matches the stored binding marks paid/failed;
 * - the app never initiates refunds; a verified PhonePe refund pauses fulfilment for review.
 */
import {
  createPhonePePayment,
  fetchPhonePeOrderStatus,
  fetchPhonePeRefundStatus,
  PhonePeError,
  verifyPhonePeOrderStatus,
  type PhonePeConfig,
  type PhonePeVerifiedOutcome,
} from './phonepe';
import { paymentRpc } from './service';

type Database = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};
export type PhonePeAttempt = {
  id: string;
  order_id: string;
  provider: 'phonepe';
  mode: 'test' | 'live';
  amount: number;
  currency: 'INR';
  receipt: string;
  state: 'creating' | 'ready' | 'unknown' | 'authorized' | 'failed' | 'captured';
  provider_order_id: string | null;
  captured_payment_id: string | null;
  checkout_url: string | null;
  provider_expires_at: string | null;
};
export type PhonePeStatusOrder = {
  id: string;
  total: number;
  status: string;
  paymentStatus: string;
  paymentMode?: string;
  paymentReviewRequired?: boolean;
  refund?: { amount: number };
};
export type PhonePeCheckout = {
  provider: 'phonepe';
  mode: PhonePeConfig['mode'];
  orderId: string;
  attemptId: string;
  amount: number;
  checkoutUrl: string;
  expiresAt: string;
};
export type PhonePeCheckoutStatus = {
  provider: 'phonepe';
  mode: PhonePeConfig['mode'];
  orderId: string;
  attemptId: string;
  resumable: boolean;
  /** A verified failure lets the customer start one fresh PhonePe attempt. */
  retryable: boolean;
};

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
/** A PayPage expiring within this window is not offered; the customer would land on an error. */
const MINIMUM_REMAINING_MS = 60_000;

/** The client supplies only an idempotency identity. */
export function parsePhonePeAttemptRequest(value: unknown): { attemptId: string } {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    typeof (value as { attemptId?: unknown }).attemptId !== 'string' ||
    !UUID.test((value as { attemptId: string }).attemptId)
  )
    throw new PhonePeError('Start a fresh payment attempt.');
  return { attemptId: (value as { attemptId: string }).attemptId };
}

function matching(
  attempt: unknown,
  config: PhonePeConfig,
  orderId: string,
): attempt is PhonePeAttempt {
  if (!attempt || typeof attempt !== 'object') return false;
  const value = attempt as PhonePeAttempt;
  return (
    value.provider === 'phonepe' &&
    value.order_id === orderId &&
    value.mode === config.mode &&
    value.currency === 'INR' &&
    Number.isSafeInteger(value.amount) &&
    value.amount >= 100 &&
    value.amount <= 100_000_000 &&
    typeof value.receipt === 'string' &&
    /^[A-Za-z0-9_-]{1,40}$/.test(value.receipt)
  );
}
function mismatch(): never {
  throw new PhonePeError(
    'This payment could not be matched to your order.',
    409,
    'payment_mismatch',
  );
}

async function findAttempt(db: Database, query: { attemptId?: string; orderId?: string }) {
  const attempt = await paymentRpc(db, 'hpa_payment_find', {
    p_attempt_id: query.attemptId ?? null,
    p_order_id: query.orderId ?? null,
    p_provider_order_id: null,
  });
  if (!attempt || typeof attempt !== 'object' || Array.isArray(attempt))
    throw new PhonePeError('This payment could not be found.', 404, 'payment_not_found');
  return attempt;
}

export async function findPhonePeAttemptByMerchantOrderId(
  db: Database,
  merchantOrderId: string,
): Promise<PhonePeAttempt> {
  const attempt = await paymentRpc(db, 'hpa_payment_find_receipt', { p_receipt: merchantOrderId });
  if (!attempt || typeof attempt !== 'object' || Array.isArray(attempt))
    throw new PhonePeError('This payment could not be found.', 404, 'payment_not_found');
  return attempt as PhonePeAttempt;
}

function usableCheckout(attempt: PhonePeAttempt, now: number): boolean {
  return (
    attempt.state === 'ready' &&
    typeof attempt.provider_order_id === 'string' &&
    typeof attempt.checkout_url === 'string' &&
    typeof attempt.provider_expires_at === 'string' &&
    Date.parse(attempt.provider_expires_at) - now > MINIMUM_REMAINING_MS
  );
}

/** Apply a verified provider outcome atomically. Pending outcomes change nothing. */
export async function applyPhonePeOutcome(
  db: Database,
  attempt: PhonePeAttempt,
  outcome: PhonePeVerifiedOutcome,
  eventHash?: string,
): Promise<unknown | null> {
  if (!attempt.provider_order_id) mismatch();
  if (outcome.kind === 'pending') return null;
  if (outcome.kind === 'captured' || outcome.transactionId)
    return paymentRpc(db, 'hpa_payment_apply', {
      p_attempt_id: attempt.id,
      p_provider_order_id: attempt.provider_order_id,
      p_payment_id: outcome.kind === 'captured' ? outcome.transactionId : outcome.transactionId,
      p_status: outcome.kind === 'captured' ? 'captured' : 'failed',
      p_amount: attempt.amount,
      p_currency: 'INR',
      p_event_hash: eventHash ?? null,
    });
  return paymentRpc(db, 'hpa_payment_mark_failed', {
    p_attempt_id: attempt.id,
    p_provider_order_id: attempt.provider_order_id,
    p_amount: attempt.amount,
    p_event_hash: eventHash ?? null,
  });
}

/** Fetch Order Status for one stored attempt and apply it. */
export async function synchronizePhonePeAttempt(
  db: Database,
  config: PhonePeConfig,
  attempt: PhonePeAttempt,
  options: { eventHash?: string } = {},
  request: typeof fetch = fetch,
) {
  if (!matching(attempt, config, attempt.order_id)) mismatch();
  const status = await fetchPhonePeOrderStatus(config, attempt.receipt, request);
  const outcome = verifyPhonePeOrderStatus(status, {
    // For an unbound create, the authenticated GET for our stored merchantOrderId
    // supplies its canonical provider ID. Only a terminal outcome may bind it;
    // a pending response cannot recover the lost PayPage or permit a second create.
    providerOrderId: attempt.provider_order_id ?? status.orderId,
    amount: attempt.amount,
  });
  if (!attempt.provider_order_id) {
    if (outcome.kind === 'pending') return { outcome, order: null };
    const order = await paymentRpc(db, 'hpa_payment_recover_phonepe', {
      p_attempt_id: attempt.id,
      p_receipt: attempt.receipt,
      p_provider_order_id: status.orderId,
      p_amount: attempt.amount,
      p_status: outcome.kind === 'captured' ? 'captured' : 'failed',
      p_payment_id: outcome.transactionId ?? null,
      p_event_hash: options.eventHash ?? null,
    });
    return { outcome, order };
  }
  const order = await applyPhonePeOutcome(db, attempt, outcome, options.eventHash);
  return { outcome, order };
}

/**
 * Create or resume the PayPage for one attempt. A resumed attempt is re-checked with
 * PhonePe first, so a payment completed in another tab is applied, never repeated.
 */
export async function preparePhonePeCheckout(
  db: Database,
  config: PhonePeConfig,
  orderId: string,
  input: unknown,
  request: typeof fetch = fetch,
  now = () => Date.now(),
): Promise<PhonePeCheckout> {
  const { attemptId } = parsePhonePeAttemptRequest(input);
  const reserved = (await paymentRpc(db, 'hpa_payment_reserve', {
    p_order_id: orderId,
    p_attempt_id: attemptId,
    p_mode: config.mode,
  })) as { attempt: unknown; create: boolean };
  if (!matching(reserved?.attempt, config, orderId) || reserved.attempt.id !== attemptId)
    mismatch();
  let attempt = reserved.attempt;
  if (reserved.create === true) {
    if (attempt.state !== 'creating' || attempt.provider_order_id !== null)
      throw new PhonePeError(
        'Check the order status before starting another payment attempt.',
        409,
        'payment_conflict',
      );
    try {
      const created = await createPhonePePayment(
        config,
        {
          merchantOrderId: attempt.receipt,
          amount: attempt.amount,
          // The confirmation page re-checks payment with the server; nothing here is trusted.
          redirectUrl: `${config.siteOrigin}/order-success?id=${encodeURIComponent(orderId)}`,
        },
        request,
      );
      const bound = await paymentRpc(db, 'hpa_payment_bind_checkout', {
        p_attempt_id: attempt.id,
        p_provider_order_id: created.orderId,
        p_checkout_url: created.checkoutUrl,
        p_expires_at: created.expiresAt,
      });
      if (!matching(bound, config, orderId)) mismatch();
      attempt = bound;
    } catch (cause) {
      // PhonePe may have created the order even when its response was lost.
      await paymentRpc(db, 'hpa_payment_mark_unknown', { p_attempt_id: attempt.id }).catch(
        () => undefined,
      );
      throw cause;
    }
  } else {
    if (['creating', 'unknown'].includes(attempt.state)) {
      const { outcome } = await synchronizePhonePeAttempt(db, config, attempt, {}, request);
      if (outcome.kind !== 'pending')
        throw new PhonePeError(
          outcome.kind === 'captured'
            ? 'This order is already paid. Check your receipt.'
            : 'The earlier payment did not complete. Check the order before trying again.',
          409,
          outcome.kind === 'captured' ? 'payment_complete' : 'payment_retry_required',
        );
      throw new PhonePeError(
        'Payment setup is not confirmed yet. Keep this order and contact the restaurant if it does not recover; do not create another order.',
        409,
        'payment_initialization_pending',
      );
    }
    if (attempt.state !== 'ready' || !attempt.provider_order_id)
      throw new PhonePeError(
        'Check the order status before starting another payment attempt.',
        409,
        'payment_conflict',
      );
    const { outcome } = await synchronizePhonePeAttempt(db, config, attempt, {}, request);
    if (outcome.kind !== 'pending')
      throw new PhonePeError(
        outcome.kind === 'captured'
          ? 'This order is already paid. Check your receipt.'
          : 'The earlier payment did not complete. Check the order before trying again.',
        409,
        outcome.kind === 'captured' ? 'payment_complete' : 'payment_retry_required',
      );
  }
  if (!usableCheckout(attempt, now()))
    throw new PhonePeError(
      'This payment page has expired. Check the order status before trying again.',
      409,
      'payment_retry_required',
    );
  return {
    provider: 'phonepe',
    mode: config.mode,
    orderId,
    attemptId,
    amount: attempt.amount,
    checkoutUrl: attempt.checkout_url!,
    expiresAt: attempt.provider_expires_at!,
  };
}

/** Browser callbacks only ask the server to check; the server asks PhonePe. */
export async function confirmPhonePeCheckout(
  db: Database,
  config: PhonePeConfig,
  orderId: string,
  input: unknown,
  request: typeof fetch = fetch,
) {
  const { attemptId } = parsePhonePeAttemptRequest(input);
  const attempt = await findAttempt(db, { attemptId, orderId });
  if (!matching(attempt, config, orderId)) mismatch();
  return synchronizePhonePeAttempt(db, config, attempt, {}, request);
}

/** Read-only for the order: may apply a verified outcome but never creates a PhonePe order. */
export async function readPhonePeCheckoutStatus(
  db: Database,
  config: PhonePeConfig,
  order: PhonePeStatusOrder,
  input: unknown,
  request: typeof fetch = fetch,
  now = () => Date.now(),
): Promise<PhonePeCheckoutStatus> {
  const { attemptId } = parsePhonePeAttemptRequest(input);
  const result: PhonePeCheckoutStatus = {
    provider: 'phonepe',
    mode: config.mode,
    orderId: order.id,
    attemptId,
    resumable: false,
    retryable: false,
  };
  if (
    order.paymentMode !== config.paymentMode ||
    order.paymentReviewRequired ||
    (order.refund?.amount ?? 0) > 0 ||
    !['initiated', 'failed'].includes(order.paymentStatus) ||
    order.status !== 'pending'
  )
    return result;
  let attempt: unknown;
  try {
    attempt = await findAttempt(db, { attemptId, orderId: order.id });
  } catch (cause) {
    if (cause instanceof PhonePeError && cause.code === 'payment_not_found')
      return { ...result, retryable: order.paymentStatus === 'failed' };
    throw cause;
  }
  if (!matching(attempt, config, order.id) || attempt.amount !== order.total) return result;
  if (attempt.state === 'failed') return { ...result, retryable: true };
  if (!['creating', 'unknown', 'ready'].includes(attempt.state)) return result;
  const { outcome } = await synchronizePhonePeAttempt(db, config, attempt, {}, request);
  if (outcome.kind === 'failed') return { ...result, retryable: true };
  return { ...result, resumable: outcome.kind === 'pending' && usableCheckout(attempt, now()) };
}

/**
 * A verified PhonePe refund (pending or completed) pauses fulfilment and asks the owner to
 * reconcile. Refund money is not posted to the ledger automatically.
 */
export async function flagPhonePeRefund(
  db: Database,
  config: PhonePeConfig,
  attempt: PhonePeAttempt,
  merchantRefundId: string,
  request: typeof fetch = fetch,
) {
  if (!matching(attempt, config, attempt.order_id)) mismatch();
  const refund = await fetchPhonePeRefundStatus(config, merchantRefundId, request);
  if (refund.originalMerchantOrderId !== attempt.receipt || refund.amount > attempt.amount)
    mismatch();
  if (refund.state === 'FAILED') return { ignored: true, reason: 'refund_failed' };
  // Refunds can arrive before the order-completed callback or a browser check.
  // Persist the hold even then, so a later capture cannot make refunded food
  // eligible for fulfilment. The SQL guard permits a missing payment ID only
  // for PhonePe; authenticated refund status already binds the stored receipt.
  return paymentRpc(db, 'hpa_payment_flag_refund_review', {
    p_attempt_id: attempt.id,
    p_provider_order_id: attempt.provider_order_id,
    p_payment_id: attempt.captured_payment_id,
    p_amount: attempt.amount,
    p_currency: 'INR',
    p_mode: config.mode,
    p_evidence_amount: refund.amount,
  });
}

/** Owner-only route: re-check bound and unresolved PhonePe attempts for one order. */
export async function reconcilePhonePeOrder(
  db: Database,
  config: PhonePeConfig,
  orderId: string,
  request: typeof fetch = fetch,
) {
  const attempts = await paymentRpc(db, 'hpa_payment_reconciliation_attempts', {
    p_order_id: orderId,
    p_mode: config.mode,
  });
  if (!Array.isArray(attempts) || attempts.length > 100)
    throw new PhonePeError('Payment history could not be verified.', 503, 'payment_unavailable');
  let unresolved = false;
  for (const attempt of attempts) {
    if (!matching(attempt, config, orderId)) mismatch();
    if (attempt.state === 'captured') continue;
    const { outcome } = await synchronizePhonePeAttempt(db, config, attempt, {}, request);
    if (!attempt.provider_order_id && outcome.kind === 'pending') unresolved = true;
  }
  if (unresolved)
    throw new PhonePeError(
      'PhonePe still reports pending setup for this order. Its payment page cannot be recovered. Keep the order for review and check again; do not create another payment.',
      409,
      'payment_initialization_pending',
    );
}
