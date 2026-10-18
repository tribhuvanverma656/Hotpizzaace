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
import { money } from '@/lib/utils';
import { useDemoStore } from '@/lib/store';
import { getOrderBranchDetails } from '@/lib/branches';
import { orderStatusLabels as labels, trackingHref } from '@/lib/order-tracking';
export function OrderDetail({
  order,
  confirmation = false,
}: {
  order: Order;
  confirmation?: boolean;
}) {
  const branches = useDemoStore((s) => s.branches);
  const branch = getOrderBranchDetails(order, branches);
  const updatePayment = useDemoStore((s) => s.updatePaymentStatus);
  const [retrying, setRetrying] = useState(false);
  const terminal = ['cancelled', 'rejected'].includes(order.status);
  const steps: OrderStatus[] =
    order.fulfillment === 'delivery'
      ? ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered']
      : ['pending', 'confirmed', 'preparing', 'ready', 'picked_up'];
  const index = steps.indexOf(order.status);
  const paid = order.paymentStatus === 'simulated_paid';
  const retry = async () => {
    setRetrying(true);
    try {
      updatePayment(order.id, 'pending');
      await new Promise((r) => setTimeout(r, 650));
      updatePayment(order.id, 'simulated_paid');
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
          ) : paid || order.paymentMethod === 'cash' ? (
            <CheckCircle2 size={36} />
          ) : (
            <Clock size={36} />
          )}
        </span>
        <span className="eyebrow">
          {confirmation ? 'YOUR LOCAL DEMO ORDER' : 'A LITTLE PIZZA PROGRESS'}
        </span>
        <h1>
          {terminal ? (
            'A change of pizza plans.'
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
          {terminal
            ? 'This order will not be fulfilled.'
            : paid
              ? 'Your simulated payment is complete. No money has been charged.'
              : order.paymentMethod === 'cash'
                ? 'Cash is due when your order is handed over. No payment has been collected.'
                : 'This demo order has not been paid. Use the simulator below to retry.'}
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
            <Link href={trackingHref(order)} className="btn btn-primary">
              <PackageSearch size={18} />
              Track order
              <ArrowRight size={17} />
            </Link>
            <Link href="/account/orders" className="text-link">
              View my orders
            </Link>
            <small>Reopen tracking anytime from My orders on this device.</small>
          </div>
        )}
      </div>
      <div className="order-detail-grid">
        <div>
          <section className="tracking-card">
            <div className="tracking-title">
              <h2>{labels[order.status]}</h2>
              <span className="demo-pill">DEMO ORDER</span>
            </div>
            <p className="muted">
              {order.fulfillment === 'delivery' ? 'Delivery' : 'Pickup'}
              {branch.preparationMinutes !== null && (
                <> · Preparation estimate: {branch.preparationMinutes} minutes</>
              )}
              . Demo status is updated by staff in the admin dashboard.
            </p>
            {terminal ? (
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
              <span className={`status-pill ${paid ? 'status-paid' : ''}`}>
                {paid
                  ? 'Successful · simulated'
                  : order.paymentStatus === 'failed'
                    ? 'Failed · simulated'
                    : order.paymentStatus === 'initiated'
                      ? 'Initiated · simulated'
                      : 'Pending'}
              </span>
              <p className="muted">
                Method:{' '}
                {order.paymentMethod === 'cash'
                  ? 'Cash at handover'
                  : `${order.paymentMethod.toUpperCase()} · demo simulation`}
              </p>
            </div>
            {!paid && order.paymentMethod !== 'cash' && !terminal && (
              <button className="btn btn-primary" disabled={retrying} onClick={retry}>
                <RefreshCw size={16} className={retrying ? 'spin' : ''} />
                {retrying ? 'Simulating…' : 'Simulate a successful retry'}
              </button>
            )}
          </section>
        </div>
        <aside className="tracking-card receipt">
          <h3>Your order receipt</h3>
          {order.branchName && <p>Prepared by {order.branchName}</p>}
          <p className="muted">{new Date(order.createdAt).toLocaleString('en-IN')}</p>
          {order.items.map((i) => (
            <div key={i.id} className="receipt-item">
              <img src={i.image} alt={i.name} />
              <div>
                <strong>
                  {i.quantity} × {i.name}
                </strong>
                <small>{i.options.join(' · ')}</small>
                {i.notes && <small>Note: {i.notes}</small>}
              </div>
              <b>{money(i.unitPrice * i.quantity)}</b>
            </div>
          ))}
          <div className="summary-row">
            <span>Subtotal</span>
            <b>{money(order.subtotal)}</b>
          </div>
          <div className="summary-row">
            <span>{order.fulfillment === 'pickup' ? 'Pickup' : 'Delivery'}</span>
            <b>{money(order.deliveryFee)}</b>
          </div>
          {order.discount > 0 && (
            <div className="summary-row green-text">
              <span>Savings ({order.coupon})</span>
              <b>−{money(order.discount)}</b>
            </div>
          )}
          <div className="summary-total">
            <span>Total</span>
            <strong>{money(order.total)}</strong>
          </div>
          <p className="receipt-disclaimer">
            Demo receipt. This is not a tax invoice or proof of an actual payment.
          </p>
          <Link className="btn btn-outline" href="/menu">
            Another slice? <ArrowRight size={16} />
          </Link>
        </aside>
      </div>
    </>
  );
}
