'use client';

import { useEffect, useRef, useState } from 'react';
import { CreditCard, RefreshCw, ShieldCheck } from 'lucide-react';
import type { Order } from '@/types';
import { money } from '@/lib/utils';
import { publicBusinessIdentity } from '@/lib/business-identity';
import { CommerceError } from '@/lib/commerce/client';
import {
  loadRazorpayCheckout,
  parseRazorpayProof,
  paymentAttemptId,
  readPaymentAttemptId,
  canResumeRazorpayCheckout,
  createRazorpayCheckoutLifecycle,
  type RazorpayCheckoutLease,
  type RazorpayProof,
} from '@/lib/payments/razorpay-client';
import { useCustomerAuth } from '@/components/customer-auth-provider';
import { useSharedCommerce } from '@/components/shared-commerce-provider';
import styles from './razorpay-payment.module.css';

type Stage =
  'ready' | 'opening' | 'paying' | 'verifying' | 'pending' | 'dismissed' | 'failed' | 'blocked';

function storage() {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

/** Changing the signed-in account must close its Checkout and discard in-memory proof. */
export function RazorpayPayment(props: { order: Order; onConfirmed?: (order: Order) => void }) {
  const auth = useCustomerAuth();
  return <PaymentCard key={`${auth.user?.id ?? 'guest'}:${props.order.id}`} {...props} />;
}

function PaymentCard({
  order,
  onConfirmed,
}: {
  order: Order;
  onConfirmed?: (order: Order) => void;
}) {
  const auth = useCustomerAuth();
  const shared = useSharedCommerce();
  const [stage, setStage] = useState<Stage>(order.paymentStatus === 'failed' ? 'pending' : 'ready');
  const [message, setMessage] = useState('');
  const active = useRef(true);
  const inFlight = useRef(false);
  const checkout = useRef(createRazorpayCheckoutLifecycle());
  const attempt = useRef<string | undefined>(undefined);
  const proof = useRef<RazorpayProof | null>(null);
  const confirmed = useRef(false);
  const onConfirmedRef = useRef(onConfirmed);
  useEffect(() => {
    onConfirmedRef.current = onConfirmed;
  }, [onConfirmed]);
  useEffect(() => {
    const lifecycle = checkout.current;
    active.current = true;
    return () => {
      active.current = false;
      lifecycle.dispose();
      proof.current = null;
    };
  }, []);
  useEffect(() => {
    if (order.paymentStatus === 'paid' && !confirmed.current) {
      confirmed.current = true;
      onConfirmedRef.current?.(order);
    }
  }, [order]);
  const testMode = order.paymentMode === 'razorpay_test';
  const terminal = ['cancelled', 'rejected'].includes(order.status);
  const busy = ['opening', 'paying', 'verifying'].includes(stage);

  const applyResult = (latest: Order): boolean => {
    if (!active.current) return true;
    if (latest.paymentStatus === 'paid') {
      setMessage(
        ['cancelled', 'rejected'].includes(latest.status) || latest.paymentReviewRequired
          ? 'Payment was received, but this order needs restaurant review. Contact the restaurant; do not pay again.'
          : latest.paymentMode === 'razorpay_test'
            ? 'Test payment confirmed. No real money was charged.'
            : 'Payment confirmed by the server.',
      );
      setStage('pending');
      if (!confirmed.current) {
        confirmed.current = true;
        onConfirmedRef.current?.(latest);
      }
      return true;
    }
    if (['cancelled', 'rejected'].includes(latest.status)) {
      setStage('blocked');
      setMessage(
        'This order is no longer accepting payment. Contact the restaurant if you were debited.',
      );
      return true;
    }
    if (latest.paymentStatus === 'failed') {
      setStage('pending');
      setMessage(
        'An earlier payment failed. Check payment status before trying again; another attempt may still be processing.',
      );
      return false;
    }
    setStage('pending');
    setMessage(
      'Payment is not confirmed yet. If you were debited, wait and check this order before paying again.',
    );
    return false;
  };

  const verifyAndCheck = async (returned: RazorpayProof, isCurrent = () => active.current) => {
    if (!isCurrent()) return;
    if (!attempt.current) throw new Error('Reopen this order to check payment status.');
    setStage('verifying');
    setMessage('Checking the payment with our server…');
    const verified = await shared.verifyRazorpayPayment(order.id, attempt.current, returned);
    if (!isCurrent()) return;
    if (applyResult(verified)) return;
    setStage('verifying');
    // Authorisation alone is not payment completion; wait briefly for a captured payment/webhook.
    for (let count = 0; count < 4; count += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      if (!isCurrent()) return;
      const latest = await shared.getOrder(order.id);
      if (!isCurrent()) return;
      if (applyResult(latest)) return;
      if (count < 3) setStage('verifying');
    }
  };

  const checkStatus = async () => {
    if (inFlight.current || !active.current) return;
    inFlight.current = true;
    setStage('verifying');
    try {
      if (proof.current && attempt.current) await verifyAndCheck(proof.current);
      else {
        const current = await shared.getOrder(order.id);
        if (applyResult(current)) return;
        const existingAttempt =
          attempt.current ??
          readPaymentAttemptId(storage(), { userId: auth.user?.id ?? null, orderId: order.id });
        if (!existingAttempt || !['initiated', 'failed'].includes(current.paymentStatus)) return;
        const capability = await shared.getRazorpayCheckoutStatus(order.id, existingAttempt);
        if (active.current && canResumeRazorpayCheckout(current, existingAttempt, capability)) {
          attempt.current = existingAttempt;
          setStage(current.paymentStatus === 'failed' ? 'failed' : 'dismissed');
          setMessage('Checkout is ready to resume for your saved order.');
        }
      }
    } catch (cause) {
      if (active.current) {
        setStage(
          cause instanceof CommerceError && cause.code === 'payment_invalid'
            ? 'blocked'
            : 'pending',
        );
        setMessage(
          cause instanceof Error
            ? cause.message
            : 'Payment status could not be checked. Please try again.',
        );
      }
    } finally {
      inFlight.current = false;
    }
  };

  const pay = async (retryFailed = false) => {
    if (inFlight.current || !active.current || !shared.razorpay || auth.loading) return;
    inFlight.current = true;
    setStage('opening');
    setMessage('Preparing secure Checkout…');
    let opened = false;
    let lease: RazorpayCheckoutLease | undefined;
    try {
      lease = checkout.current.begin();
      const generation = lease;
      const isCurrent = () => active.current && generation.isActive();
      const current = await shared.getOrder(order.id);
      if (!isCurrent()) return;
      if (current.paymentStatus === 'paid' || ['cancelled', 'rejected'].includes(current.status)) {
        applyResult(current);
        return;
      }
      if (current.paymentStatus === 'failed' && !retryFailed) {
        applyResult(current);
        return;
      }
      if (current.paymentStatus === 'failed' && retryFailed) proof.current = null;
      attempt.current = paymentAttemptId(
        storage(),
        { userId: auth.user?.id ?? null, orderId: order.id },
        attempt.current,
      );
      const payment = await shared.createRazorpayCheckout(order.id, attempt.current);
      if (!isCurrent()) return;
      if (
        payment.amount !== current.total ||
        payment.mode !== (current.paymentMode === 'razorpay_live' ? 'live' : 'test')
      )
        throw new Error('Payment details changed. Reopen your order and check its total.');
      const Razorpay = await loadRazorpayCheckout();
      if (!isCurrent()) return;
      let resultReceived = false;
      const digits = current.customer.phone.replace(/\D/g, '');
      const instance = new Razorpay({
        key: payment.keyId,
        amount: payment.amount,
        currency: payment.currency,
        order_id: payment.providerOrderId,
        name: publicBusinessIdentity.name,
        description: `Order ${current.number}${payment.mode === 'test' ? ' (test payment)' : ''}`,
        prefill: {
          name: current.customer.name,
          contact: `+${digits.length === 10 ? '91' : ''}${digits}`,
        },
        retry: { enabled: false },
        theme: { color: '#ed3524' },
        modal: {
          ondismiss: generation.guard(() => {
            if (!active.current || resultReceived) return;
            inFlight.current = false;
            setStage('dismissed');
            setMessage(
              'Checkout was closed. Your order is saved; closing does not prove payment failed. Check its status before resuming.',
            );
          }),
        },
        handler: generation.guard((returned: unknown) => {
          resultReceived = true;
          if (!active.current) return;
          try {
            proof.current = parseRazorpayProof(returned, payment.providerOrderId);
          } catch {
            inFlight.current = false;
            setStage('blocked');
            setMessage(
              'The payment response could not be verified. Check this order or contact the restaurant; do not pay again.',
            );
            return;
          }
          void verifyAndCheck(proof.current, isCurrent)
            .catch((cause: unknown) => {
              if (!isCurrent()) return;
              setStage(
                cause instanceof CommerceError && cause.code === 'payment_invalid'
                  ? 'blocked'
                  : 'pending',
              );
              setMessage(
                cause instanceof Error
                  ? cause.message
                  : 'We could not confirm payment. Check this order before paying again.',
              );
            })
            .finally(() => {
              if (isCurrent()) inFlight.current = false;
            });
        }),
      });
      instance.on(
        'payment.failed',
        generation.guard(() => {
          resultReceived = true;
          instance.close();
          inFlight.current = false;
          if (!active.current) return;
          setStage('pending');
          setMessage(
            'Razorpay reported an unsuccessful attempt. Check the server status before retrying; your order has not been marked paid.',
          );
          void checkStatus();
        }),
      );
      if (!generation.attach(instance)) return;
      setStage('paying');
      setMessage('Complete payment in Razorpay Checkout.');
      opened = true;
      instance.open();
    } catch (cause) {
      if (active.current && (!lease || lease.isActive())) {
        setStage(
          cause instanceof CommerceError && cause.code === 'payment_invalid'
            ? 'blocked'
            : cause instanceof CommerceError &&
                ['payment_initialization_pending', 'payment_conflict'].includes(cause.code ?? '')
              ? 'pending'
              : 'dismissed',
        );
        setMessage(
          cause instanceof Error
            ? cause.message
            : 'Secure Checkout is unavailable. Check the order before retrying.',
        );
      }
      if (!lease || lease.isActive()) inFlight.current = false;
    } finally {
      // The SDK callback owns this lock once its payment form is open.
      if ((!lease || lease.isActive()) && (!opened || !active.current)) inFlight.current = false;
    }
  };

  return (
    <div className={styles.card} aria-label="Secure online payment">
      <div className={styles.heading}>
        <ShieldCheck size={22} aria-hidden="true" />
        <div>
          <strong>{testMode ? 'Razorpay test payment' : 'Pay securely with Razorpay'}</strong>
          <p>
            {testMode
              ? 'Test mode · no real money is charged. Use only Razorpay test payment details.'
              : 'Payment details are entered in Razorpay’s hosted Checkout.'}
          </p>
        </div>
      </div>
      {message && (
        <p role="status" className={styles.message}>
          {message}
        </p>
      )}
      {!shared.razorpay && (
        <p className={styles.message}>
          Online payment is temporarily unavailable. You can still check this order’s payment
          status.
        </p>
      )}
      {order.paymentStatus === 'paid' ? (
        <p className="green-text">{testMode ? 'Test payment captured.' : 'Payment captured.'}</p>
      ) : (
        <div className={styles.actions}>
          {!terminal &&
            stage !== 'blocked' &&
            !['pending', 'verifying', 'paying', 'opening'].includes(stage) && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !shared.razorpay || auth.loading}
                onClick={() => void pay(stage === 'failed' || order.paymentStatus === 'failed')}
              >
                <CreditCard size={17} />
                {stage === 'failed' || order.paymentStatus === 'failed'
                  ? 'Retry'
                  : stage === 'dismissed'
                    ? 'Resume'
                    : 'Pay'}{' '}
                {money(order.total)}
                {testMode ? ' · test' : ''}
              </button>
            )}
          <button
            type="button"
            className="btn btn-outline"
            disabled={busy}
            onClick={() => void checkStatus()}
          >
            <RefreshCw size={16} className={busy ? 'spin' : ''} />
            {busy ? 'Checking payment…' : 'Check payment status'}
          </button>
        </div>
      )}
      <small>
        Only a captured payment verified by the server changes this receipt to paid. Never share
        your UPI PIN, card details or payment codes with the restaurant.
      </small>
    </div>
  );
}
