'use client';
import Link from 'next/link';
import { useState } from 'react';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  MapPin,
  XCircle,
  Copy,
  RefreshCw,
  PackageSearch,
} from 'lucide-react';
import { toast } from 'sonner';
import { Order, OrderStatus } from '@/types';
import { useDemoStore } from '@/lib/store';
import { getOrderBranchDetails } from '@/lib/branches';
import { orderStatusLabels as labels, trackingHref } from '@/lib/order-tracking';
import { useSharedCommerce } from './shared-commerce-provider';
import { orderTrackingHref } from '@/lib/commerce/client';
import { OnlinePayment } from './payments/online-payment';
import {
  gatewayLabels,
  getPaymentMethodDetails,
  isGatewayMode,
  isLiveGatewayMode,
  paymentMethodLabels,
} from '@/lib/payments/method';
import { hasProcessedRefund } from '@/lib/pricing';
import { canCancelUnpaidOrder } from '@/lib/order-cancellation';
import { money } from '@/lib/utils';
import { OrderBill } from './order-bill';
export function OrderDetail({
  order,
  confirmation = false,
  canRetryPayment = true,
}: {
  order: Order;
  confirmation?: boolean;
  canRetryPayment?: boolean;
}) {
  const branches = useDemoStore((s) => s.branches);
  const shared = useSharedCommerce();
  const branch = getOrderBranchDetails(order, branches);
  const updatePayment = useDemoStore((s) => s.updatePaymentStatus);
  const [retrying, setRetrying] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const canCancel = canRetryPayment && canCancelUnpaidOrder(order);
  const cancel = async () => {
    if (cancelling) return;
    setCancelling(true);
    try {
      if (shared.enabled) {
        if (order.version === undefined) throw new Error('Refresh your order before cancelling.');
        await shared.cancelOrder(order.id, order.version);
      } else {
        const current = useDemoStore.getState().orders.find((item) => item.id === order.id);
        if (!current || !canCancelUnpaidOrder(current))
          throw new Error(
            'This order can no longer be cancelled. Refresh it or contact the restaurant.',
          );
        useDemoStore.getState().updateOrderStatus(order.id, 'cancelled');
      }
      setConfirmCancel(false);
      toast.success('Order cancelled.');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not cancel the order. Try again.',
      );
    } finally {
      setCancelling(false);
    }
  };
  const terminal = ['cancelled', 'rejected'].includes(order.status);
  const steps: OrderStatus[] =
    order.fulfillment === 'delivery'
      ? ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered']
      : order.fulfillment === 'dine_in'
        ? ['pending', 'confirmed', 'preparing', 'ready', 'served', 'closed']
        : ['pending', 'confirmed', 'preparing', 'ready', 'picked_up'];
  const index = steps.indexOf(order.status);
  const gateway = isGatewayMode(order.paymentMode);
  const paymentMethod = getPaymentMethodDetails(order);
  const testPayment = !isLiveGatewayMode(order.paymentMode);
  const paid = order.paymentStatus === 'simulated_paid' || order.paymentStatus === 'paid';
  const refunded = hasProcessedRefund(order);
  const refundLabel = order.refund?.status === 'full' ? 'Refunded' : 'Partial refund';
  const retry = async () => {
    setRetrying(true);
    try {
      if (gateway || (shared.enabled && !shared.allowSimulatedPayments)) return;
      if (shared.enabled) await shared.simulatePayment(order.id, 'success');
      else {
        updatePayment(order.id, 'pending');
        await new Promise((r) => setTimeout(r, 650));
        updatePayment(order.id, 'simulated_paid');
      }
      toast.success('Simulated payment complete. No money was charged.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Unable to retry payment');
    } finally {
      setRetrying(false);
    }
  };
  return (
    <>
      <div className="confirmation-heading">
        <span className={`confirmation-icon ${terminal ? 'cancelled' : ''}`}>
          {terminal ? (
            <XCircle size={36} />
          ) : refunded || order.refundSyncPending || order.paymentReviewRequired ? (
            <Clock size={36} />
          ) : paid || order.paymentMethod === 'cash' ? (
            <CheckCircle2 size={36} />
          ) : (
            <Clock size={36} />
          )}
        </span>
        <span className="eyebrow">
          {confirmation
            ? shared.enabled
              ? 'YOUR ORDER IS SAVED'
              : 'YOUR LOCAL DEMO ORDER'
            : 'A LITTLE PIZZA PROGRESS'}
        </span>
        <h1>
          {terminal ? (
            'A change of pizza plans.'
          ) : order.refundSyncPending ? (
            'Updating refund status'
          ) : refunded ? (
            refundLabel
          ) : confirmation ? (
            paid || order.paymentMethod === 'cash' ? (
              <>
                Happiness is <em>on the menu.</em>
              </>
            ) : (
              <>
                Your order is <em>awaiting payment.</em>
              </>
            )
          ) : (
            labels[order.status]
          )}
        </h1>
        <p>
          {order.refundSyncPending
            ? `Your ${testPayment ? 'test payment ' : ''}refund details are being reconciled. Contact the restaurant if you need help. Do not pay again.`
            : refunded
              ? `${money(order.refund!.amount)} has been refunded${testPayment ? ' in Test Mode' : ''}. Contact the restaurant about this order. Do not pay again.`
              : terminal
                ? 'This order will not be fulfilled.'
                : paid
                  ? order.paymentReviewRequired
                    ? 'Payment was captured, but the order requires restaurant review. Do not pay again.'
                    : gateway
                      ? testPayment
                        ? 'Your test payment is confirmed. No real money was charged.'
                        : 'Your payment has been verified by the server.'
                      : 'Your simulated payment is complete. No money has been charged.'
                  : order.paymentMethod === 'cash'
                    ? 'Cash is due when your order is handed over. No payment has been collected.'
                    : canRetryPayment
                      ? gateway
                        ? 'Your order is saved. Complete payment securely below, or check its payment status.'
                        : 'This demo order has not been paid. Use the simulator below to retry.'
                      : 'This order has not been paid. Open the original ordering browser or sign in with the account used at checkout to manage payment.'}
        </p>
        <button
          className="order-number"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(order.number);
              toast.success('Order number copied');
            } catch {
              toast('Your order number is shown above.');
            }
          }}
        >
          {order.number}
          <Copy size={14} />
        </button>
        {confirmation && (
          <div className="confirmation-tracking-actions">
            <Link
              href={shared.enabled ? orderTrackingHref(order) : trackingHref(order)}
              className="btn btn-primary"
            >
              <PackageSearch size={18} />
              Track order
              <ArrowRight size={17} />
            </Link>
            <Link href="/account/orders" className="text-link">
              View my orders
            </Link>
            <small>
              {shared.enabled
                ? 'Track from My orders or keep the private link below.'
                : 'Reopen tracking anytime from My orders on this device.'}
            </small>
          </div>
        )}
        {shared.enabled && order.trackingUrl && (
          <div className="confirmation-tracking-actions">
            <button
              type="button"
              className="btn btn-outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    new URL(orderTrackingHref(order), window.location.origin).href,
                  );
                  toast.success('Private tracking link copied.');
                } catch {
                  toast.error('Could not copy the link. Keep this page bookmarked.');
                }
              }}
            >
              <Copy size={16} />
              Copy private tracking link
            </button>
            <small>Keep this link private. Anyone with it can view this order.</small>
          </div>
        )}
      </div>
      <div className="order-detail-grid">
        <div>
          <section className="tracking-card">
            <div className="tracking-title">
              <h2>{labels[order.status]}</h2>
              <span className="demo-pill">
                {gateway
                  ? testPayment
                    ? 'RAZORPAY TEST'
                    : 'RAZORPAY'
                  : shared.enabled && shared.mode === 'production'
                    ? 'RESTAURANT ORDER'
                    : 'DEMO ORDER'}
              </span>
            </div>
            <p className="muted">
              {order.fulfillment === 'delivery'
                ? 'Delivery'
                : order.fulfillment === 'dine_in'
                  ? 'Dine-in'
                  : 'Pickup'}
              {branch.preparationMinutes !== null && (
                <> · Preparation estimate: {branch.preparationMinutes} minutes</>
              )}
              .{' '}
              {shared.enabled
                ? 'Status updates from the restaurant appear automatically.'
                : 'Demo status is updated by staff in the admin dashboard.'}
            </p>
            {refunded || order.refundSyncPending ? (
              <p className="error-message">
                {order.refundSyncPending ? 'Refund needs reconciliation.' : 'Refund processed.'}{' '}
                Fulfillment is paused for restaurant review. Your saved bill and order history
                remain available below.
              </p>
            ) : terminal ? (
              <div className="error-message">
                {labels[order.status]}. Contact the restaurant for assistance in a real ordering
                environment.
              </div>
            ) : (
              <ol className="tracking-steps">
                {steps.map((step, i) => (
                  <li key={step} className={i < index ? 'complete' : i === index ? 'current' : ''}>
                    <span>{i < index ? <Check size={15} /> : i + 1}</span>
                    <div>
                      <strong>{labels[step]}</strong>
                      {i === index && <small>Current status</small>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
            <div className="tracking-address">
              <MapPin size={20} />
              <div>
                <strong>
                  {order.fulfillment === 'delivery' ? 'Delivering to' : 'Collect from'}{' '}
                  {order.fulfillment === 'delivery' ? order.customer.name : branch.name}
                </strong>
                <p>
                  {order.fulfillment === 'delivery'
                    ? `${order.customer.address}, ${order.customer.locality} ${order.customer.postalCode}`
                    : branch.address || 'Pickup address unavailable. Contact the restaurant.'}
                </p>
                {branch.phone && (
                  <a href={`tel:${branch.phone.replace(/[^+\d]/g, '')}`} className="text-link">
                    Call restaurant · {branch.phone}
                  </a>
                )}
                {order.customer.instructions && <small>{order.customer.instructions}</small>}
              </div>
            </div>
          </section>
          <section className="tracking-card payment-status-card">
            <div>
              <h3>Payment status</h3>
              <span
                className={`status-pill ${paid && !refunded && !order.refundSyncPending && !order.paymentReviewRequired ? 'status-paid' : ''}`}
              >
                {order.refundSyncPending
                  ? 'Refund needs reconciliation'
                  : refunded
                    ? refundLabel
                    : order.paymentReviewRequired
                      ? 'Payment needs review'
                      : paid
                        ? gateway
                          ? testPayment
                            ? 'Captured · test'
                            : 'Captured'
                          : 'Successful · simulated'
                        : order.paymentStatus === 'failed'
                          ? gateway
                            ? 'Failed'
                            : 'Failed · simulated'
                          : order.paymentStatus === 'initiated'
                            ? gateway
                              ? 'Awaiting payment'
                              : 'Initiated · simulated'
                            : 'Pending'}
              </span>
              <p className="muted">
                {paymentMethod.provider
                  ? `Payment provider: ${gatewayLabels[paymentMethod.provider]}${testPayment ? ' · test' : ''}`
                  : `Method: ${order.paymentMethod === 'cash' ? 'Cash at handover' : `${paymentMethodLabels[order.paymentMethod]} · demo simulation`}`}
              </p>
              {(refunded || order.refundSyncPending) && (
                <p>
                  {refunded && (
                    <>
                      {order.refundSyncPending ? 'Confirmed processed refunds' : 'Refunded'}:{' '}
                      <strong>{money(order.refund!.amount)}</strong> ·{' '}
                    </>
                  )}
                  Net payment retained:{' '}
                  <strong>
                    {order.refundSyncPending
                      ? 'Awaiting reconciliation'
                      : money(Math.max(0, order.total - order.refund!.amount))}
                  </strong>
                </p>
              )}
            </div>
            {canRetryPayment &&
              !gateway &&
              (!shared.enabled || shared.allowSimulatedPayments) &&
              !paid &&
              !refunded &&
              !order.refundSyncPending &&
              order.paymentMethod !== 'cash' &&
              !terminal && (
                <button className="btn btn-primary" disabled={retrying} onClick={retry}>
                  <RefreshCw size={16} className={retrying ? 'spin' : ''} />
                  {retrying ? 'Simulating…' : 'Simulate a successful retry'}
                </button>
              )}
          </section>
        </div>
        <aside>
          {canCancel && (
            <section className="tracking-card" aria-label="Cancel unpaid order">
              <h2>Changed your mind?</h2>
              <p>You can cancel this unpaid order before the restaurant confirms it.</p>
              {confirmCancel ? (
                <>
                  <p role="status">Cancel this order? You can place a new order afterwards.</p>
                  <div className="confirmation-tracking-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={cancelling}
                      onClick={cancel}
                    >
                      {cancelling ? 'Cancelling…' : 'Yes, cancel order'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline"
                      disabled={cancelling}
                      onClick={() => setConfirmCancel(false)}
                    >
                      Keep order
                    </button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setConfirmCancel(true)}
                >
                  <XCircle size={18} /> Cancel order
                </button>
              )}
            </section>
          )}
          {canRetryPayment &&
            gateway &&
            !terminal &&
            !cancelling &&
            !refunded &&
            !order.refundSyncPending && <OnlinePayment order={order} />}
          <OrderBill order={order} />
        </aside>
      </div>
    </>
  );
}
