'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  Search,
  ArrowUpRight,
  ArrowLeft,
  MapPin,
  Phone,
  ShoppingBag,
  CreditCard,
  Clock,
  Truck,
} from 'lucide-react';
import { toast } from 'sonner';
import { getOrderBranchDetails, getOrderBranchId } from '@/lib/branches';
import { useAdminStore } from '@/components/admin/use-admin-store';
import { money } from '@/lib/utils';
import type { Order, OrderStatus } from '@/types';
import { OrderBill } from '@/components/order-bill';
import { getPaymentMethodDetails, paymentMethodLabels } from '@/lib/payments/method';
import { hasProcessedRefund } from '@/lib/pricing';
import { CommerceError, commerceRequest } from '@/lib/commerce/client';
import {
  ConfirmAction,
  dateTime,
  localDate,
  nextStatuses,
  PageHeading,
  PaymentPill,
  statusLabels,
  StatusPill,
} from './shared';

export function OrderTable({ orders }: { orders: Order[] }) {
  return (
    <div className="admin-table-wrap">
      <table className="data-table admin-order-table">
        <thead>
          <tr>
            <th>Order</th>
            <th>Customer</th>
            <th>Fulfillment</th>
            <th>Payment</th>
            <th>Status</th>
            <th className="text-right">Amount</th>
            <th>
              <span className="sr-only">Details</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id}>
              <td className="cell-order">
                <Link className="admin-table-link" href={`/admin/orders/${order.id}`}>
                  #{order.number}
                </Link>
                <small>{dateTime(order.createdAt)}</small>
                <small>{order.branchName || 'Barra · Kanpur'}</small>
              </td>
              <td className="cell-customer">
                <strong>{order.customer.name}</strong>
                <small>{order.customer.phone}</small>
              </td>
              <td className="cell-fulfillment">
                <span className="admin-fulfillment">
                  {order.fulfillment === 'delivery' ? (
                    <Truck size={14} />
                  ) : (
                    <ShoppingBag size={14} />
                  )}{' '}
                  {order.fulfillment === 'dine_in'
                    ? 'Dine-in'
                    : order.fulfillment === 'delivery'
                      ? 'Delivery'
                      : 'Pickup'}
                </span>
              </td>
              <td className="cell-payment">
                <PaymentPill order={order} />
              </td>
              <td className="cell-status">
                <StatusPill status={order.status} />
              </td>
              <td className="cell-amount text-right">
                <strong>{money(order.total)}</strong>
              </td>
              <td className="cell-link">
                <Link
                  href={`/admin/orders/${order.id}`}
                  className="admin-icon-link"
                  aria-label={`View order ${order.number}`}
                >
                  <ArrowUpRight size={18} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {orders.length === 0 && (
        <div className="empty-state">
          <ShoppingBag size={30} />
          <h3>No orders found</h3>
          <p>Try another search or clear the filters.</p>
        </div>
      )}
    </div>
  );
}

export function OrdersPage() {
  const { orders: allOrders, adminBranchId } = useAdminStore();
  const [allBranches, setAllBranches] = useState(false);
  const orders = allBranches
    ? allOrders
    : allOrders.filter((order) => getOrderBranchId(order) === adminBranchId);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [date, setDate] = useState('');
  const filtered = orders
    .filter(
      (o) =>
        (status === 'all' || o.status === status) &&
        (!date || localDate(o.createdAt) === date) &&
        `${o.number} ${o.customer.name} ${o.customer.phone}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return (
    <>
      <PageHeading
        eyebrow="THE KITCHEN LINE"
        title="Orders"
        description="Every order, from the first click to the final slice."
      >
        <span className="badge">{orders.length} total orders</span>
      </PageHeading>
      <div className="admin-order-summary">
        <span>
          <i className="admin-live-dot" />
          {
            orders.filter((o) =>
              ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery'].includes(o.status),
            ).length
          }{' '}
          active orders
        </span>
        <span>{orders.filter((o) => o.status === 'pending').length} awaiting confirmation</span>
        <span>Payment badges distinguish verified, test and unpaid orders</span>
      </div>
      <div className="admin-card">
        <div className="filter-bar">
          <label className="admin-checkbox">
            <input
              type="checkbox"
              checked={allBranches}
              onChange={(event) => setAllBranches(event.target.checked)}
            />
            All branches
          </label>
          <div className="admin-search">
            <Search size={17} />
            <input
              aria-label="Search orders"
              placeholder="Search order, customer, or phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            aria-label="Filter order status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">All statuses</option>
            {Object.entries(statusLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <input
            type="date"
            aria-label="Filter order date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          {(search || status !== 'all' || date) && (
            <button
              className="btn btn-outline"
              onClick={() => {
                setSearch('');
                setStatus('all');
                setDate('');
              }}
            >
              Clear
            </button>
          )}
        </div>
        <OrderTable orders={filtered} />
      </div>
    </>
  );
}

type SharedOrderMutation = (
  path: string,
  options: Parameters<typeof commerceRequest>[1],
) => Promise<Order | null>;

function OrderUnavailable({ retry }: { retry?: () => void }) {
  return (
    <div className="empty-state">
      <h1>Order unavailable</h1>
      <p>This order could not be loaded. Check your restaurant access or try again.</p>
      {retry && (
        <button className="btn btn-outline" onClick={retry}>
          Retry order
        </button>
      )}
      <Link className="btn btn-primary" href="/admin/orders">
        Back to orders
      </Link>
    </div>
  );
}

/** Direct links must not depend on the bounded recent-order snapshot. */
export function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const store = useAdminStore();
  const { shared, adminBranchId, orders } = store;
  if (!shared.enabled) {
    const order = orders.find((item) => item.id === id && !item.testVoid);
    return order ? <OrderDetailPanel order={order} /> : <OrderUnavailable />;
  }
  if (!shared.ready || !shared.admin || !shared.user?.id)
    return shared.adminLoading ? (
      <p role="status" className="empty-state">
        Checking restaurant access…
      </p>
    ) : (
      <OrderUnavailable />
    );
  return (
    <SharedOrderDetail
      key={JSON.stringify([shared.user.id, adminBranchId, id])}
      id={id}
      shared={shared}
      snapshot={orders.find((item) => item.id === id)}
    />
  );
}

function validDetailOrder(order: Order, id: string) {
  return (
    order.id === id &&
    !order.testVoid &&
    Number.isSafeInteger(order.version) &&
    Number(order.version) > 0
  );
}

function SharedOrderDetail({
  id,
  shared,
  snapshot,
}: {
  id: string;
  shared: ReturnType<typeof useAdminStore>['shared'];
  snapshot?: Order;
}) {
  const [result, setResult] = useState<{ order: Order | null; loading: boolean }>({
    order: null,
    loading: true,
  });
  const [attempt, setAttempt] = useState(0);
  const lease = useRef({ active: false, read: 0, inFlight: false });
  const getOrder = shared.getOrder;
  useEffect(() => {
    const request = { active: true, read: 0, inFlight: false };
    lease.current = request;
    const load = async () => {
      if (!request.active || request.inFlight) return;
      request.inFlight = true;
      const read = ++request.read;
      try {
        // getOrder retains the shared client's 20-second request deadline.
        const order = await getOrder(id);
        if (!request.active || read !== request.read) return;
        setResult((current) => ({
          order: validDetailOrder(order, id)
            ? current.order && Number(current.order.version) > Number(order.version)
              ? current.order
              : order
            : null,
          loading: false,
        }));
      } catch (cause) {
        if (!request.active) return;
        if (cause instanceof CommerceError && [401, 403, 404, 410].includes(cause.status)) {
          // Terminal reads invalidate older pending writes as well as reads.
          request.active = false;
          ++request.read;
          setResult({ order: null, loading: false });
        } else if (read === request.read) setResult({ order: null, loading: false });
      } finally {
        request.inFlight = false;
      }
    };
    const focused = () => {
      if (document.visibilityState === 'visible') void load();
    };
    void load();
    // Revalidate records outside the recent snapshot and detect removed bills.
    // Single-flight prevents a slow read from starving an earlier result.
    const timer = window.setInterval(focused, 15000);
    window.addEventListener('focus', focused);
    document.addEventListener('visibilitychange', focused);
    return () => {
      request.active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', focused);
      document.removeEventListener('visibilitychange', focused);
    };
  }, [getOrder, id, attempt]);
  const retry = () => {
    lease.current.active = false;
    setResult({ order: null, loading: true });
    setAttempt((current) => current + 1);
  };
  const mutate: SharedOrderMutation = async (path, options) => {
    const request = lease.current;
    if (!request.active) return null;
    ++request.read;
    try {
      const updated = await commerceRequest<{ order: Order }>(path, options);
      if (!request.active) return null;
      if (!validDetailOrder(updated.order, id))
        throw new Error('The order response is incomplete.');
      ++request.read;
      setResult((current) => ({
        order:
          current.order && Number(current.order.version) > Number(updated.order.version)
            ? current.order
            : updated.order,
        loading: false,
      }));
      void shared.refreshAdmin();
      return updated.order;
    } catch (cause) {
      if (!request.active) return null;
      // A removed/unavailable bill must never reappear from the recent snapshot.
      if (cause instanceof CommerceError && [404, 410].includes(cause.status)) {
        request.active = false;
        setResult({ order: null, loading: false });
      } else retry();
      throw cause;
    }
  };
  if (result.loading)
    return (
      <p role="status" className="empty-state">
        Loading order…
      </p>
    );
  if (!result.order || snapshot?.testVoid) return <OrderUnavailable retry={retry} />;
  const order =
    snapshot && Number(snapshot.version) > Number(result.order.version) ? snapshot : result.order;
  return <OrderDetailPanel order={order} mutate={mutate} />;
}

/** The same bill/workflow presentation is used for recent and historical orders. */
export function OrderDetailPanel({
  order,
  mutate,
}: {
  order: Order;
  mutate?: SharedOrderMutation;
}) {
  const { branches, updateOrderStatus, updatePaymentStatus, shared } = useAdminStore();
  const [collectCash, setCollectCash] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [target, setTarget] = useState<OrderStatus | null>(null);
  const transitions = order.paymentReviewRequired ? [] : nextStatuses(order);
  const branch = getOrderBranchDetails(order, branches);
  const paymentMethod = getPaymentMethodDetails(order);
  const refunded = hasProcessedRefund(order);
  const cancellationRefund =
    paymentMethod.provider === 'razorpay' &&
    ['cancelled', 'rejected'].includes(order.status) &&
    order.paymentStatus === 'paid';
  return (
    <>
      <Link href="/admin/orders" className="admin-back-link">
        <ArrowLeft size={15} /> All orders
      </Link>
      <PageHeading
        eyebrow="ORDER DETAILS"
        title={`Order #${order.number}`}
        description={`Placed ${dateTime(order.createdAt)} · ${branch.name} · ${shared.enabled ? 'Shared order' : 'Demonstration order'}`}
      >
        <StatusPill status={order.status} />
      </PageHeading>
      <div className="admin-detail-grid">
        <div>
          <section className="admin-card">
            <div className="admin-card-heading">
              <h2>Order items</h2>
              <span className="muted">
                {order.items.reduce((sum, item) => sum + item.quantity, 0)} items
              </span>
            </div>
            <div className="admin-order-items">
              {order.items.map((item) => (
                <div className="admin-order-item" key={item.id}>
                  <img src={item.image} alt="" />
                  <div>
                    <strong>{item.name}</strong>
                    <p>{item.options.join(' · ') || 'Standard'}</p>
                    {item.notes && <small>Note: {item.notes}</small>}
                    <small>
                      {money(item.unitPrice)} × {item.quantity}
                    </small>
                  </div>
                  <strong>{money(item.unitPrice * item.quantity)}</strong>
                </div>
              ))}
            </div>
            <dl className="admin-totals">
              <div>
                <dt>Subtotal</dt>
                <dd>{money(order.subtotal)}</dd>
              </div>
              <div>
                <dt>Delivery fee</dt>
                <dd>{money(order.deliveryFee)}</dd>
              </div>
              <div>
                <dt>Discount {order.coupon && `(${order.coupon})`}</dt>
                <dd>−{money(order.discount)}</dd>
              </div>
              {order.tax && (
                <>
                  <div>
                    <dt>Taxable value</dt>
                    <dd>{money(order.tax.taxableValue)}</dd>
                  </div>
                  <div>
                    <dt>{order.tax.version === 2 ? 'Total CGST' : 'CGST (2.5%)'}</dt>
                    <dd>{money(order.tax.cgst)}</dd>
                  </div>
                  <div>
                    <dt>{order.tax.version === 2 ? 'Total SGST' : 'SGST (2.5%)'}</dt>
                    <dd>{money(order.tax.sgst)}</dd>
                  </div>
                  {order.tax.version === 2 && (
                    <div>
                      <dt>GST already included in MRP</dt>
                      <dd>{money(order.tax.includedTotal ?? 0)}</dd>
                    </div>
                  )}
                </>
              )}
              <div className="admin-total">
                <dt>Total</dt>
                <dd>{money(order.total)}</dd>
              </div>
            </dl>
          </section>
          <section className="admin-card admin-section-gap">
            <div className="admin-card-heading">
              <h2>
                <CreditCard size={18} /> Payment details
              </h2>
              <PaymentPill order={order} />
            </div>
            <div className="admin-info-grid">
              <div>
                <span>{paymentMethod.provider ? 'Payment provider' : 'Payment method'}</span>
                <strong>
                  {paymentMethod.provider
                    ? 'Razorpay'
                    : order.paymentMethod === 'cash'
                      ? order.channel === 'counter'
                        ? 'Counter cash'
                        : 'Cash on fulfillment'
                      : paymentMethodLabels[order.paymentMethod]}
                </strong>
              </div>
              {paymentMethod.requestedPaymentMethod && (
                <div>
                  <span>Checkout selection</span>
                  <strong>{paymentMethodLabels[order.paymentMethod]}</strong>
                </div>
              )}
              <div>
                <span>
                  {refunded || order.refundSyncPending ? 'Original capture state' : 'Payment state'}
                </span>
                <strong>{order.paymentStatus.replaceAll('_', ' ')}</strong>
              </div>
              {(refunded || order.refundSyncPending) && (
                <>
                  {refunded && (
                    <div>
                      <span>
                        {order.refundSyncPending ? 'Confirmed processed refunds' : 'Refunded'}
                      </span>
                      <strong>{money(order.refund!.amount)}</strong>
                    </div>
                  )}
                  <div>
                    <span>Net payment retained</span>
                    <strong>
                      {order.refundSyncPending
                        ? 'Awaiting reconciliation'
                        : money(Math.max(0, order.total - order.refund!.amount))}
                    </strong>
                  </div>
                </>
              )}
            </div>
            {(refunded || order.refundSyncPending) && (
              <p className="admin-inline-note">
                {order.refundSyncPending
                  ? 'Refund details need reconciliation.'
                  : 'Refund processed.'}{' '}
                Fulfillment is paused for restaurant review. The original capture and bill remain
                unchanged; do not collect payment again for this order.
              </p>
            )}
            <p className="admin-inline-note">
              {order.channel === 'counter'
                ? 'Staff confirms cash or direct merchant UPI received. Pay-later bills remain unpaid until settled at the counter.'
                : order.paymentMode?.startsWith('phonepe_')
                  ? 'PhonePe payment status is verified on the server with PhonePe’s Order Status API. Checkout selection is the original preference; the final payment method is not recorded. A refund made in the PhonePe dashboard pauses this order for review; reconcile it there. Test payments do not transfer real money.'
                  : order.paymentMode?.startsWith('razorpay_')
                    ? 'Razorpay payment status is verified on the server. Checkout selection is the original preference; the final payment method is not recorded. Authorized or failed payments are not captured payments. Test captures do not transfer real money.'
                    : 'Demo payment state is independent of fulfillment. Cash collection in development is simulated.'}
            </p>
            {shared.enabled &&
              ((paymentMethod.provider === 'razorpay' && order.paymentStatus === 'paid') ||
                (paymentMethod.provider === 'phonepe' &&
                  ['initiated', 'failed', 'paid'].includes(order.paymentStatus))) && (
                <div className="admin-card-padding">
                  <button
                    type="button"
                    className="btn btn-outline"
                    disabled={reconciling}
                    onClick={async () => {
                      setReconciling(true);
                      try {
                        const updated = await mutate?.(
                          `admin/orders/${encodeURIComponent(order.id)}/payment/reconcile`,
                          { method: 'POST', body: {} },
                        );
                        if (!updated) return;
                        if (updated.refundSyncPending)
                          toast('Refund details still need reconciliation. Check the gateway before retrying.');
                        else if (paymentMethod.provider === 'phonepe')
                          toast.success('PhonePe status checked. Nothing was charged or refunded.');
                        else
                          toast.success(
                            cancellationRefund
                              ? 'Cancellation refund checked. Gateway status refreshed.'
                              : 'Refund status checked. No new refund was issued.',
                          );
                      } catch (error) {
                        toast.error(
                          error instanceof Error ? error.message : 'Unable to check refund status',
                        );
                      } finally {
                        setReconciling(false);
                      }
                    }}
                  >
                    {reconciling
                      ? paymentMethod.provider === 'phonepe'
                        ? 'Checking payment status…'
                        : 'Checking refund status…'
                      : paymentMethod.provider === 'phonepe'
                        ? 'Check PhonePe status'
                        : cancellationRefund
                          ? 'Retry / check cancellation refund'
                          : 'Refresh refund status'}
                  </button>
                  <p className="admin-inline-note">
                    {paymentMethod.provider === 'phonepe'
                      ? 'Asks PhonePe for this order’s payment status; this never charges or refunds.'
                      : cancellationRefund
                        ? 'Retries the full cancellation refund when none exists, or checks the existing refund. Pending refunds are not yet completed.'
                        : 'Checks Razorpay records; this does not issue a refund.'}
                  </p>
                </div>
              )}
            {order.channel === 'counter' && (
              <div className="admin-card-padding">
                <Link className="btn btn-outline" href="/admin/counter">
                  Open counter · payment and bill
                </Link>
              </div>
            )}
            {order.channel !== 'counter' &&
              order.paymentMethod === 'cash' &&
              (!shared.enabled || shared.allowSimulatedPayments) &&
              order.paymentStatus !== 'simulated_paid' &&
              !refunded &&
              !order.refundSyncPending &&
              !['cancelled', 'rejected'].includes(order.status) && (
                <div className="admin-card-padding">
                  <button className="btn btn-outline" onClick={() => setCollectCash(true)}>
                    Simulate cash collection
                  </button>
                </div>
              )}
          </section>
        </div>
        <div>
          <section className="admin-card">
            <div className="admin-card-heading">
              <h2>Customer</h2>
              <span className="admin-avatar">{order.customer.name.charAt(0)}</span>
            </div>
            <div className="admin-contact">
              <strong>{order.customer.name}</strong>
              <span>
                <Phone size={15} />
                {order.customer.phone}
              </span>
            </div>
            <hr />
            <h3 className="admin-small-heading">
              <MapPin size={16} />
              {order.fulfillment === 'dine_in'
                ? 'Dine-in at restaurant'
                : order.fulfillment === 'delivery'
                  ? 'Delivery address'
                  : 'Pickup from restaurant'}
            </h3>
            <p className="admin-address">
              {order.fulfillment === 'delivery'
                ? [order.customer.address, order.customer.locality, order.customer.postalCode]
                    .filter(Boolean)
                    .join(', ')
                : branch.address || 'Pickup address unavailable. Contact the restaurant.'}
            </p>
            {order.counter?.tableLabel && (
              <p className="admin-inline-note">Table / reference: {order.counter.tableLabel}</p>
            )}
            {order.fulfillment === 'pickup' && branch.phone && (
              <a href={`tel:${branch.phone.replace(/[^+\d]/g, '')}`} className="admin-inline-link">
                Call restaurant · {branch.phone}
              </a>
            )}
            {order.customer.landmark && order.fulfillment === 'delivery' && (
              <p className="muted">Landmark: {order.customer.landmark}</p>
            )}
            {order.customer.instructions && (
              <div className="admin-inline-note">
                <strong>Customer instructions</strong>
                <p>{order.customer.instructions}</p>
              </div>
            )}
          </section>
          <section className="admin-card admin-section-gap">
            <div className="admin-card-heading">
              <h2>
                <Clock size={17} /> Order workflow
              </h2>
            </div>
            <div className="admin-workflow">
              <span className="muted">Current status</span>
              <StatusPill status={order.status} />
              {transitions.length ? (
                <>
                  <p>Choose the next step for this {order.fulfillment} order.</p>
                  <div className="admin-workflow-actions">
                    {transitions.map((status) => (
                      <button
                        key={status}
                        className={`btn ${['cancelled', 'rejected'].includes(status) ? 'btn-outline admin-danger-text' : 'btn-dark'}`}
                        onClick={() => setTarget(status)}
                      >
                        {statusLabels[status]}
                      </button>
                    ))}
                  </div>
                </>
              ) : refunded || order.paymentReviewRequired ? (
                <p>Fulfillment is paused for payment review.</p>
              ) : (
                <p>This order has reached its final state.</p>
              )}
            </div>
          </section>
        </div>
      </div>
      <OrderBill order={order} />
      <ConfirmAction
        open={collectCash}
        onOpenChange={setCollectCash}
        title="Simulate cash collection?"
        description="This marks the demo payment as simulated-paid. No actual money is collected. Revenue becomes eligible only when the order is also delivered or picked up."
        label="Simulate collection"
        onConfirm={async () => {
          try {
            if (shared.enabled) {
              const updated = await mutate?.(`orders/${encodeURIComponent(order.id)}/payment`, {
                method: 'POST',
                body: { outcome: 'cash_collected', expectedVersion: order.version },
              });
              if (!updated) return;
            } else updatePaymentStatus(order.id, 'simulated_paid');
            toast.success('Cash collection simulated · no actual payment');
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Unable to update payment');
          }
        }}
      />
      <ConfirmAction
        open={Boolean(target)}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
        title={`Mark order ${target ? statusLabels[target].toLowerCase() : ''}?`}
        description={`This updates order #${order.number} in ${shared.enabled ? 'the shared database' : 'the local demo'} and its customer tracking screen. Payment status will stay unchanged.`}
        destructive={target === 'cancelled' || target === 'rejected'}
        label="Update order"
        onConfirm={async () => {
          if (target) {
            try {
              if (shared.enabled) {
                const updated = await mutate?.(`orders/${encodeURIComponent(order.id)}`, {
                  method: 'PATCH',
                  body: { status: target, expectedVersion: order.version },
                });
                if (!updated) return;
              } else updateOrderStatus(order.id, target);
              toast.success(`Order ${statusLabels[target].toLowerCase()}`);
            } catch (error) {
              toast.error(error instanceof Error ? error.message : 'Unable to update the order');
            }
          }
        }}
      />
    </>
  );
}
