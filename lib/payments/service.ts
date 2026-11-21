import {
  createRazorpayOrder,
  createRazorpayRefund,
  fetchRazorpayOrderPayments,
  fetchRazorpayPayment,
  fetchRazorpayRefund,
  fetchRazorpayPaymentRefunds,
  parseRazorpayCheckoutRequest,
  parseRazorpayVerificationRequest,
  RazorpayError,
  verifyRazorpayCheckoutSignature,
  verifyRazorpayPayment,
  type RazorpayConfig,
  type RazorpayVerifiedPayment,
  type RazorpayPayment,
  type RazorpayRefund,
  type RazorpayWebhook,
} from './razorpay';

type Database = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{
    data: unknown;
    error: { message?: string } | null;
  }>;
};
type AttemptHistoryQuery = {
  eq: (column: string, value: string) => AttemptHistoryQuery;
  neq: (column: string, value: string) => AttemptHistoryQuery;
  limit: (count: number) => PromiseLike<{
    data: unknown;
    count: number | null;
    error: { message?: string } | null;
  }>;
};
type CheckoutDatabase = Database & {
  from: (table: string) => {
    select: (columns: string, options: { count: 'exact' }) => AttemptHistoryQuery;
  };
};
export type PaymentAttempt = {
  id: string;
  order_id: string;
  mode: 'test' | 'live';
  amount: number;
  currency: 'INR';
  receipt: string;
  state: 'creating' | 'ready' | 'unknown' | 'authorized' | 'failed' | 'captured';
  provider_order_id: string | null;
};
export type RazorpayCheckoutStatusOrder = {
  id: string;
  total: number;
  status: string;
  paymentStatus: string;
  paymentMode?: string;
  paymentReviewRequired?: boolean;
  refund?: { amount: number };
};
export type RazorpayCheckoutStatus = {
  provider: 'razorpay';
  mode: RazorpayConfig['mode'];
  orderId: string;
  attemptId: string;
  resumable: boolean;
};

function matchingAttempt(
  attempt: PaymentAttempt,
  config: RazorpayConfig,
  orderId: string,
  attemptId: string,
) {
  return (
    attempt.id === attemptId &&
    attempt.order_id === orderId &&
    attempt.mode === config.mode &&
    attempt.currency === 'INR' &&
    Number.isSafeInteger(attempt.amount) &&
    attempt.amount >= 100 &&
    attempt.amount <= 100_000_000
  );
}

/** A ready local reservation is insufficient while the provider still has an unresolved debit. */
async function canResumeAttempt(
  config: RazorpayConfig,
  attempt: PaymentAttempt,
  request: typeof fetch,
) {
  if (!['ready', 'failed'].includes(attempt.state) || !attempt.provider_order_id) return false;
  return providerPaymentsFailed(config, attempt, request, attempt.state === 'failed');
}

async function providerPaymentsFailed(
  config: RazorpayConfig,
  attempt: PaymentAttempt,
  request: typeof fetch,
  requirePayment: boolean,
) {
  if (!attempt.provider_order_id) return false;
  const payments = await fetchRazorpayOrderPayments(config, attempt.provider_order_id, request);
  return (
    (!requirePayment || payments.length > 0) &&
    payments.every(
      (payment) =>
        payment.order_id === attempt.provider_order_id &&
        payment.amount === attempt.amount &&
        payment.currency === attempt.currency &&
        payment.status === 'failed' &&
        payment.captured === false &&
        payment.amount_refunded === 0,
    )
  );
}

/** Keep one provider order per application order, including after failed/late-authorized payments. */
async function assertSinglePaymentAttempt(
  db: CheckoutDatabase,
  orderId: string,
  attemptId: string,
) {
  let result: Awaited<ReturnType<AttemptHistoryQuery['limit']>>;
  try {
    result = await db
      .from('hpa_payment_attempts')
      .select('id', { count: 'exact' })
      .eq('order_id', orderId)
      .neq('id', attemptId)
      .limit(1);
  } catch {
    throw new RazorpayError(
      'Payment history could not be verified. Check this order before retrying.',
      503,
      'payment_unavailable',
    );
  }
  if (
    result.error ||
    !Array.isArray(result.data) ||
    !Number.isSafeInteger(result.count) ||
    Number(result.count) < 0
  )
    throw new RazorpayError(
      'Payment history could not be verified. Check this order before retrying.',
      503,
      'payment_unavailable',
    );
  // A failed snapshot does not retire an older Checkout or prevent late authorization.
  // Legacy multiple-attempt orders require trusted reconciliation instead of another charge.
  if (result.count !== 0 || result.data.length !== 0)
    throw new RazorpayError(
      'Another payment attempt exists. Keep this order and contact the restaurant before paying again.',
      409,
      'payment_conflict',
    );
}

/** Read-only capability check. It never creates/reserves, binds or applies a payment. */
export async function readRazorpayCheckoutStatus(
  db: CheckoutDatabase,
  config: RazorpayConfig,
  order: RazorpayCheckoutStatusOrder,
  input: unknown,
  request: typeof fetch = fetch,
): Promise<RazorpayCheckoutStatus> {
  const { attemptId } = parseRazorpayCheckoutRequest(input);
  const result: RazorpayCheckoutStatus = {
    provider: 'razorpay',
    mode: config.mode,
    orderId: order.id,
    attemptId,
    resumable: false,
  };
  if (
    order.paymentMode !== config.paymentMode ||
    order.paymentReviewRequired ||
    (order.refund?.amount ?? 0) > 0 ||
    !['initiated', 'failed'].includes(order.paymentStatus) ||
    order.status !== 'pending'
  )
    return result;
  const attempt = await findPaymentAttempt(db, { orderId: order.id, attemptId });
  if (
    !matchingAttempt(attempt, config, order.id, attemptId) ||
    attempt.amount !== order.total ||
    !['ready', 'failed'].includes(attempt.state) ||
    !attempt.provider_order_id
  )
    return result;
  try {
    await assertSinglePaymentAttempt(db, order.id, attemptId);
  } catch (cause) {
    if (cause instanceof RazorpayError && cause.code === 'payment_conflict') return result;
    throw cause;
  }
  return { ...result, resumable: await canResumeAttempt(config, attempt, request) };
}

export async function paymentRpc(db: Database, name: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, args);
  if (error) {
    const code = [
      'payment_mismatch',
      'payment_not_found',
      'payment_conflict',
      'payment_not_payable',
    ].find((value) => error.message?.includes(value));
    if (code)
      throw new RazorpayError(
        code === 'payment_not_payable'
          ? 'This order no longer accepts payment. Check the receipt before trying again.'
          : code === 'payment_conflict'
            ? 'Another payment attempt is unresolved. Check the order before paying again.'
            : 'This payment could not be matched to your order.',
        code === 'payment_not_found' ? 404 : 409,
        code,
      );
    throw new RazorpayError(
      'Payment records are temporarily unavailable. Check this order before retrying.',
      503,
      'payment_unavailable',
    );
  }
  return data;
}

/** A reservation is consumed once, including an uncertain upstream timeout. Never repeat a charge setup blindly. */
export async function prepareRazorpayCheckout(
  db: CheckoutDatabase,
  config: RazorpayConfig,
  orderId: string,
  input: unknown,
  request: typeof fetch = fetch,
) {
  const { attemptId } = parseRazorpayCheckoutRequest(input);
  // An unavailable preflight never consumes a reservation. The second read below
  // closes the race with another request between this read and the atomic reserve.
  await assertSinglePaymentAttempt(db, orderId, attemptId);
  const reserved = (await paymentRpc(db, 'hpa_payment_reserve', {
    p_order_id: orderId,
    p_attempt_id: attemptId,
    p_mode: config.mode,
  })) as { attempt: PaymentAttempt; create: boolean };
  let attempt = reserved.attempt;
  if (!matchingAttempt(attempt, config, orderId, attemptId))
    throw new RazorpayError(
      'This payment could not be matched to your order.',
      409,
      'payment_mismatch',
    );
  // If this read alone fails, leave an unbound reservation creating, not unknown:
  // no upstream create has started. Recovery still needs trusted reconciliation
  // because the existing reserve RPC intentionally never repeats create permission.
  await assertSinglePaymentAttempt(db, orderId, attemptId);
  if (reserved.create === true) {
    if (attempt.state !== 'creating' || attempt.provider_order_id !== null)
      throw new RazorpayError(
        'Check the order status before starting another payment attempt.',
        409,
        'payment_conflict',
      );
    try {
      const provider = await createRazorpayOrder(
        config,
        { amount: attempt.amount, receipt: attempt.receipt },
        request,
      );
      attempt = (await paymentRpc(db, 'hpa_payment_bind', {
        p_attempt_id: attempt.id,
        p_provider_order_id: provider.id,
      })) as PaymentAttempt;
    } catch (cause) {
      // An external order may exist even when its response was lost. No new attempt is exposed.
      await paymentRpc(db, 'hpa_payment_mark_unknown', { p_attempt_id: attempt.id }).catch(
        () => undefined,
      );
      throw cause;
    }
  }
  if (!attempt.provider_order_id || ['creating', 'unknown'].includes(attempt.state))
    throw new RazorpayError(
      'Payment setup is not confirmed yet. Keep this order and contact the restaurant if it does not recover; do not create another order.',
      409,
      'payment_initialization_pending',
    );
  if (
    !matchingAttempt(attempt, config, orderId, attemptId) ||
    !['ready', 'failed'].includes(attempt.state)
  )
    throw new RazorpayError(
      'Check the order status before starting another payment attempt.',
      409,
      'payment_conflict',
    );
  if (reserved.create !== true) {
    if (!(await canResumeAttempt(config, attempt, request)))
      throw new RazorpayError(
        'Check the order status before starting another payment attempt.',
        409,
        'payment_conflict',
      );
  }
  return {
    provider: 'razorpay' as const,
    mode: config.mode,
    keyId: config.keyId,
    providerOrderId: attempt.provider_order_id,
    amount: attempt.amount,
    currency: 'INR' as const,
    orderId,
    attemptId,
  };
}

export async function findPaymentAttempt(
  db: Database,
  query: {
    attemptId?: string;
    orderId?: string;
    providerOrderId?: string;
  },
): Promise<PaymentAttempt> {
  const attempt = await paymentRpc(db, 'hpa_payment_find', {
    p_attempt_id: query.attemptId ?? null,
    p_order_id: query.orderId ?? null,
    p_provider_order_id: query.providerOrderId ?? null,
  });
  if (!attempt || typeof attempt !== 'object' || Array.isArray(attempt))
    throw new RazorpayError('This payment could not be found.', 404, 'payment_not_found');
  return attempt as PaymentAttempt;
}

export async function commitVerifiedPayment(
  db: Database,
  attempt: PaymentAttempt,
  payment: RazorpayVerifiedPayment,
  eventHash?: string,
) {
  return paymentRpc(db, 'hpa_payment_apply', {
    p_attempt_id: attempt.id,
    p_provider_order_id: payment.order_id,
    p_payment_id: payment.id,
    p_status: payment.status,
    p_amount: payment.amount,
    p_currency: payment.currency,
    p_event_hash: eventHash ?? null,
  });
}

/** Browser proof is necessary but insufficient: query Razorpay and compare the stored binding and exact amount. */
export async function confirmRazorpayCheckout(
  db: Database,
  config: RazorpayConfig,
  orderId: string,
  input: unknown,
  request: typeof fetch = fetch,
) {
  const proof = parseRazorpayVerificationRequest(input);
  const attempt = await findPaymentAttempt(db, { attemptId: proof.attemptId, orderId });
  if (
    attempt.mode !== config.mode ||
    attempt.provider_order_id !== proof.razorpay_order_id ||
    !(await verifyRazorpayCheckoutSignature(
      {
        providerOrderId: attempt.provider_order_id,
        paymentId: proof.razorpay_payment_id,
        signature: proof.razorpay_signature,
      },
      config.keySecret,
    ))
  )
    throw new RazorpayError(
      'The payment response could not be verified. Check this order before paying again.',
      400,
      'payment_invalid',
    );
  const payment = verifyRazorpayPayment(
    await fetchRazorpayPayment(config, proof.razorpay_payment_id, request),
    {
      providerOrderId: attempt.provider_order_id,
      amount: attempt.amount,
      paymentId: proof.razorpay_payment_id,
    },
  );
  return commitVerifiedPayment(db, attempt, payment);
}

/** Only verified provider GETs feed the refund ledger. This never initiates a refund or charge. */
export async function synchronizeRazorpayRefunds(
  db: Database,
  config: RazorpayConfig,
  attempt: PaymentAttempt,
  payment: RazorpayPayment,
  options: {
    event?: Extract<RazorpayWebhook, { refund: RazorpayRefund }>;
    eventHash?: string;
    now?: string;
  } = {},
  request: typeof fetch = fetch,
) {
  if (
    attempt.mode !== config.mode ||
    payment.order_id !== attempt.provider_order_id ||
    payment.amount !== attempt.amount ||
    payment.currency !== attempt.currency
  )
    throw new RazorpayError(
      'This refund does not match the stored payment.',
      409,
      'payment_mismatch',
    );
  // Evidence is a provider-confirmed refund intention/state, not money to post.
  // Pending refunds can have amount_refunded=0 and still require a kitchen hold.
  let reviewEvidenceAmount = payment.amount_refunded;
  try {
    const event = options.event;
    if (event) {
      const verified = await fetchRazorpayRefund(config, payment.id, event.refund.id, request);
      if (['pending', 'processed'].includes(verified.status) && verified.amount <= payment.amount)
        reviewEvidenceAmount = Math.max(reviewEvidenceAmount, verified.amount);
      if (
        verified.amount !== event.refund.amount ||
        verified.currency !== event.refund.currency ||
        verified.payment_id !== event.payment.id ||
        verified.created_at !== event.refund.created_at
      )
        throw new RazorpayError(
          'This refund does not match its provider record.',
          409,
          'payment_mismatch',
        );
    }
    // Uncaptured auto-refunds release bank authorizations, not restaurant collections.
    if (!payment.captured) return { ignored: true, reason: 'uncaptured_payment' };
    if (!['captured', 'refunded'].includes(payment.status))
      throw new RazorpayError(
        'This payment needs restaurant review.',
        409,
        'payment_review_required',
      );
    const refunds = await fetchRazorpayPaymentRefunds(config, payment.id, request);
    for (const refund of refunds) {
      if (['pending', 'processed'].includes(refund.status) && refund.amount <= payment.amount)
        reviewEvidenceAmount = Math.max(reviewEvidenceAmount, refund.amount);
    }
    if (event) {
      const listed = refunds.find((refund) => refund.id === event.refund.id);
      if (
        !listed ||
        listed.amount !== event.refund.amount ||
        listed.currency !== event.refund.currency ||
        listed.created_at !== event.refund.created_at
      )
        throw new RazorpayError(
          'Refund history is not complete yet. Please check again.',
          503,
          'payment_unavailable',
        );
    }
    const processed = refunds
      .filter((refund) => refund.status === 'processed')
      .reduce((total, refund) => total + refund.amount, 0);
    if (
      !Number.isSafeInteger(processed) ||
      processed !== payment.amount_refunded ||
      (payment.status === 'refunded' && payment.amount_refunded !== payment.amount) ||
      refunds.some((refund) => refund.amount > payment.amount) ||
      processed > attempt.amount
    )
      throw new RazorpayError(
        'Refund history does not yet match the captured payment. Please check again.',
        503,
        'payment_unavailable',
      );
    const now = options.now ?? new Date().toISOString();
    return await paymentRpc(db, 'hpa_payment_sync_refunds', {
      p_attempt_id: attempt.id,
      p_provider_order_id: payment.order_id,
      p_payment_id: payment.id,
      p_amount: payment.amount,
      p_currency: payment.currency,
      p_mode: config.mode,
      p_refunds: refunds.map((refund) => {
        const providerTime =
          event?.event === 'refund.processed' &&
          event.refund.id === refund.id &&
          refund.status === 'processed';
        return {
          id: refund.id,
          amount: refund.amount,
          status: refund.status,
          createdAt: new Date(refund.created_at * 1000).toISOString(),
          processedAt:
            refund.status === 'processed'
              ? providerTime
                ? new Date(event.createdAt * 1000).toISOString()
                : now
              : null,
          timestampSource:
            refund.status === 'processed'
              ? providerTime
                ? 'provider_event'
                : 'verified_at'
              : null,
        };
      }),
      p_event_hash: options.eventHash ?? null,
    });
  } catch (cause) {
    // A verified provider refund must stop fulfillment even while its detail API is inconsistent.
    // Do not fabricate a processed amount, refund ID or financial date from an outage.
    if (payment.captured && reviewEvidenceAmount > 0) {
      await paymentRpc(db, 'hpa_payment_flag_refund_review', {
        p_attempt_id: attempt.id,
        p_provider_order_id: payment.order_id,
        p_payment_id: payment.id,
        p_amount: payment.amount,
        p_currency: payment.currency,
        p_mode: config.mode,
        p_evidence_amount: reviewEvidenceAmount,
      }).catch(() => undefined);
    }
    throw cause;
  }
}

/** Owner-only caller is enforced by the Edge route. Repairs missed/historical webhook projections. */
export async function reconcileRazorpayOrderRefunds(
  db: Database,
  config: RazorpayConfig,
  orderId: string,
  request: typeof fetch = fetch,
) {
  const attempts = await paymentRpc(db, 'hpa_payment_reconciliation_attempts', {
    p_order_id: orderId,
    p_mode: config.mode,
  });
  if (!Array.isArray(attempts) || attempts.length > 100)
    throw new RazorpayError('Payment history could not be verified.', 503, 'payment_unavailable');
  for (const attempt of attempts as PaymentAttempt[]) {
    if (
      !attempt ||
      !matchingAttempt(attempt, config, orderId, attempt.id) ||
      !attempt.provider_order_id
    )
      throw new RazorpayError(
        'This payment could not be matched to your order.',
        409,
        'payment_mismatch',
      );
    const payments = await fetchRazorpayOrderPayments(
      config,
      attempt.provider_order_id,
      request,
      true,
    );
    for (const payment of payments) {
      if (payment.captured)
        await synchronizeRazorpayRefunds(db, config, attempt, payment, {}, request);
    }
  }
}

/** A cancelled order is the durable refund intent; owner reconciliation can retry safely. */
export async function refundCancelledRazorpayOrder(
  db: Database,
  config: RazorpayConfig,
  order: RazorpayCheckoutStatusOrder,
  request: typeof fetch = fetch,
) {
  if (
    !['cancelled', 'rejected'].includes(order.status) ||
    order.paymentStatus !== 'paid' ||
    order.paymentMode !== config.paymentMode
  )
    throw new RazorpayError(
      'Only a cancelled paid order can be refunded.',
      409,
      'refund_not_allowed',
    );
  const attempts = await paymentRpc(db, 'hpa_payment_reconciliation_attempts', {
    p_order_id: order.id,
    p_mode: config.mode,
  });
  if (!Array.isArray(attempts) || attempts.length > 100)
    throw new RazorpayError('Payment history could not be verified.', 503, 'payment_unavailable');
  const captures: { attempt: PaymentAttempt; payment: RazorpayPayment }[] = [];
  for (const attempt of attempts as PaymentAttempt[]) {
    if (
      !attempt ||
      !matchingAttempt(attempt, config, order.id, attempt.id) ||
      !attempt.provider_order_id ||
      attempt.amount !== order.total
    )
      throw new RazorpayError('Payment history needs owner review.', 409, 'payment_mismatch');
    const payments = await fetchRazorpayOrderPayments(
      config,
      attempt.provider_order_id,
      request,
      true,
    );
    for (const payment of payments) {
      if (payment.captured) {
        if (
          payment.amount !== order.total ||
          payment.currency !== 'INR' ||
          payment.order_id !== attempt.provider_order_id
        )
          throw new RazorpayError(
            'Captured payment does not match this bill.',
            409,
            'payment_mismatch',
          );
        captures.push({ attempt, payment });
      }
    }
  }
  if (captures.length !== 1)
    throw new RazorpayError(
      'Refund needs review: expected one captured payment.',
      409,
      'payment_conflict',
    );
  const { attempt, payment } = captures[0];
  const refunds = await fetchRazorpayPaymentRefunds(config, payment.id, request);
  if (refunds.length) {
    if (
      refunds.length !== 1 ||
      refunds[0].amount !== order.total ||
      !['pending', 'processed'].includes(refunds[0].status)
    )
      throw new RazorpayError(
        'Existing refunds need owner review before another refund.',
        409,
        'refund_review_required',
      );
  } else {
    if (payment.amount_refunded !== 0 || payment.status !== 'captured')
      throw new RazorpayError('Refund history needs owner review.', 409, 'refund_review_required');
    const refund = await createRazorpayRefund(
      config,
      {
        paymentId: payment.id,
        amount: order.total,
        idempotencyKey: `hpa_cancel_${order.id}`,
      },
      request,
    );
    if (refund.status === 'failed')
      throw new RazorpayError(
        'The gateway rejected the refund. Review it in Razorpay.',
        502,
        'refund_failed',
      );
  }
  // Only provider GET responses update the financial ledger, never the POST acknowledgement.
  const refreshed = await fetchRazorpayPayment(config, payment.id, request);
  return synchronizeRazorpayRefunds(db, config, attempt, refreshed, {}, request);
}
