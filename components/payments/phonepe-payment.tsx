'use client';

import { useEffect, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, Smartphone } from 'lucide-react';
import type { Order } from '@/types';
import { money } from '@/lib/utils';
import { CommerceError } from '@/lib/commerce/client';
import {
  loadPhonePeCheckout,
  phonePeAttemptId,
  phonePeCallbackResult,
  readPhonePeAttemptId,
} from '@/lib/payments/phonepe-client';
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

/** Changing the signed-in account remounts the card and drops its in-memory attempt. */
export function PhonePePayment(props: { order: Order; onConfirmed?: (order: Order) => void }) {
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
  const generation = useRef(0);
  const attempt = useRef<string | undefined>(undefined);
  const confirmed = useRef(false);
  const autoChecked = useRef(false);
  const onConfirmedRef = useRef(onConfirmed);
  useEffect(() => {
    onConfirmedRef.current = onConfirmed;
  }, [onConfirmed]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      generation.current += 1;
    };
  }, []);
  useEffect(() => {
    if (order.paymentStatus === 'paid' && !confirmed.current) {
      confirmed.current = true;
      onConfirmedRef.current?.(order);
    }
  }, [order]);
  const testMode = order.paymentMode === 'phonepe_test';
  const terminal = ['cancelled', 'rejected'].includes(order.status);
  const busy = ['opening', 'paying', 'verifying'].includes(stage);
  const scope = { userId: auth.user?.id ?? null, orderId: order.id };

  const applyResult = (latest: Order): boolean => {
    if (!active.current) return true;
    if (latest.paymentStatus === 'paid') {
      setMessage(
        ['cancelled', 'rejected'].includes(latest.status) || latest.paymentReviewRequired
          ? 'Payment was received, but this order needs restaurant review. Contact the restaurant; do not pay again.'
          : latest.paymentMode === 'phonepe_test'
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
    return false;
  };

  /** Ask the server for PhonePe's Order Status. The PayPage callback proves nothing. */
  const verify = async (isCurrent: () => boolean) => {
    if (!attempt.current) throw new Error('Reopen this order to check payment status.');
    setStage('verifying');
    setMessage('Checking the payment with PhonePe…');
    for (let count = 0; count < 5; count += 1) {
      const latest = await shared.verifyPhonePePayment(order.id, attempt.current);
      if (!isCurrent()) return;
      if (applyResult(latest)) return;
      if (latest.paymentStatus === 'failed') {
        setStage('failed');
        setMessage('PhonePe reported that this payment did not complete. You can try again.');
        return;
      }
      if (count < 4) await new Promise((resolve) => setTimeout(resolve, 3000));
      if (!isCurrent()) return;
    }
    setStage('pending');
    setMessage(
      'PhonePe has not confirmed this payment yet. If money was debited, wait a few minutes and check again before paying again.',
    );
  };

  const checkStatus = async () => {
    if (inFlight.current || !active.current) return;
    inFlight.current = true;
    const owner = ++generation.current;
    const isCurrent = () => active.current && generation.current === owner;
    setStage('verifying');
    try {
      const current = await shared.getOrder(order.id);
      if (!isCurrent() || applyResult(current)) return;
      const existing = attempt.current ?? readPhonePeAttemptId(storage(), scope);
      if (!existing) {
        setStage(current.paymentStatus === 'failed' ? 'failed' : 'ready');
        setMessage('');
        return;
      }
      const status = await shared.getPhonePeCheckoutStatus(order.id, existing);
      if (!isCurrent()) return;
      attempt.current = existing;
      const latest = await shared.getOrder(order.id);
      if (!isCurrent() || applyResult(latest)) return;
      if (status.retryable) {
        setStage('failed');
        setMessage('The earlier payment did not complete. You can try again.');
      } else if (status.resumable) {
        setStage('dismissed');
        setMessage('Your PhonePe payment page is still open for this order. Resume to finish.');
      } else {
        setStage('pending');
        setMessage(
          'Payment is not confirmed yet. If money was debited, wait a few minutes and check again before paying again.',
        );
      }
    } catch (cause) {
      if (isCurrent()) {
        setStage('pending');
        setMessage(
          cause instanceof Error
            ? cause.message
            : 'Payment status could not be checked. Please try again.',
        );
      }
    } finally {
      if (generation.current === owner) inFlight.current = false;
    }
  };

  // Returning from a redirect or reload: re-check once if this browser already started a payment.
  useEffect(() => {
    if (autoChecked.current || !shared.phonepe || auth.loading) return;
    if (!['initiated', 'failed'].includes(order.paymentStatus) || terminal) return;
    if (!readPhonePeAttemptId(storage(), scope)) return;
    autoChecked.current = true;
    void checkStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared.phonepe, auth.loading, order.paymentStatus, terminal]);

  const pay = async () => {
    if (inFlight.current || !active.current || !shared.phonepe || auth.loading) return;
    inFlight.current = true;
    const owner = ++generation.current;
    const isCurrent = () => active.current && generation.current === owner;
    let handedToSdk = false;
    setStage('opening');
    setMessage('Opening PhonePe…');
    try {
      const current = await shared.getOrder(order.id);
      if (!isCurrent() || applyResult(current)) return;
      // A verified failure is the only reason to start a new PhonePe order for this receipt.
      attempt.current = phonePeAttemptId(storage(), scope, {
        existing: stage === 'failed' ? undefined : attempt.current,
        fresh: stage === 'failed',
      });
      const checkout = await shared.createPhonePeCheckout(order.id, attempt.current);
      if (!isCurrent()) return;
      if (
        checkout.amount !== current.total ||
        checkout.mode !== (current.paymentMode === 'phonepe_live' ? 'live' : 'test')
      )
        throw new Error('Payment details changed. Reopen your order and check its total.');
      const sdk = await loadPhonePeCheckout();
      if (!isCurrent()) return;
      setStage('paying');
      setMessage('Complete payment in the PhonePe window.');
      handedToSdk = true;
      sdk.transact({
        tokenUrl: checkout.checkoutUrl,
        type: 'IFRAME',
        callback: (response: unknown) => {
          if (!isCurrent()) return;
          const result = phonePeCallbackResult(response);
          if (result === 'USER_CANCEL') {
            inFlight.current = false;
            setStage('dismissed');
            setMessage(
              'The PhonePe window was closed. Your order is saved; check its status before paying again.',
            );
            return;
          }
          void verify(isCurrent)
            .catch((cause: unknown) => {
              if (!isCurrent()) return;
              setStage('pending');
              setMessage(
                cause instanceof Error
                  ? cause.message
                  : 'We could not confirm payment. Check this order before paying again.',
              );
            })
            .finally(() => {
              if (isCurrent()) inFlight.current = false;
            });
        },
      });
    } catch (cause) {
      if (!isCurrent()) return;
      const code = cause instanceof CommerceError ? cause.code : undefined;
      if (code === 'payment_retry_required' || code === 'payment_complete') {
        inFlight.current = false;
        void checkStatus();
        return;
      }
      setStage(
        code && ['payment_initialization_pending', 'payment_conflict'].includes(code)
          ? 'pending'
          : 'dismissed',
      );
      setMessage(
        cause instanceof Error
          ? cause.message
          : 'PhonePe is unavailable right now. Check the order before retrying.',
      );
    } finally {
      // The PayPage callback owns the lock once PhonePe is open.
      if (!handedToSdk && generation.current === owner) inFlight.current = false;
    }
  };

  return (
    <div className={styles.card} aria-label="Secure online payment">
      <div className={styles.heading}>
        <ShieldCheck size={22} aria-hidden="true" />
        <div>
          <strong>{testMode ? 'PhonePe test payment' : 'Pay securely with PhonePe'}</strong>
          <p>
            {testMode
              ? 'Test mode · no real money is charged. Use only PhonePe sandbox test details.'
              : 'Pay by UPI, card or net banking on PhonePe’s secure payment page.'}
          </p>
        </div>
      </div>
      {message && (
        <p role="status" className={styles.message}>
          {message}
        </p>
      )}
      {!shared.phonepe && (
        <p className={styles.message}>
          Online payment is temporarily unavailable. You can still check this order’s payment
          status.
        </p>
      )}
      {order.paymentStatus === 'paid' ? (
        <p className="green-text">{testMode ? 'Test payment received.' : 'Payment received.'}</p>
      ) : (
        <div className={styles.actions}>
          {!terminal &&
            stage !== 'blocked' &&
            !['pending', 'verifying', 'paying', 'opening'].includes(stage) && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !shared.phonepe || auth.loading}
                onClick={() => void pay()}
              >
                <Smartphone size={17} />
                {stage === 'failed' ? 'Try again' : stage === 'dismissed' ? 'Resume' : 'Pay'}{' '}
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
        Only a payment PhonePe confirms to our server changes this receipt to paid. Never share your
        UPI PIN, card details or OTP with the restaurant.
      </small>
    </div>
  );
}
