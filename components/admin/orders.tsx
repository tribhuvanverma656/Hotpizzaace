'use client';
import Link from 'next/link';
import { useState } from 'react';
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
import { useDemoStore } from '@/lib/store';
import { money } from '@/lib/utils';
import type { Order, OrderStatus } from '@/types';
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
      <table className="data-table">
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
              <td>
                <Link className="admin-table-link" href={`/admin/orders/${order.id}`}>
                  #{order.number}
                </Link>
                <small>{dateTime(order.createdAt)}</small>
                <small>{order.branchName || 'Barra · Kanpur'}</small>
              </td>
              <td>
                <strong>{order.customer.name}</strong>
                <small>{order.customer.phone}</small>
              </td>
              <td>
                <span className="admin-fulfillment">
                  {order.fulfillment === 'delivery' ? (
                    <Truck size={14} />
                  ) : (
                    <ShoppingBag size={14} />
                  )}{' '}
                  {order.fulfillment === 'delivery' ? 'Delivery' : 'Pickup'}
                </span>
              </td>
              <td>
                <PaymentPill order={order} />
              </td>
              <td>
                <StatusPill status={order.status} />
              </td>
              <td className="text-right">
                <strong>{money(order.total)}</strong>
              </td>
              <td>
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
  const { orders: allOrders, adminBranchId } = useDemoStore();
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
        <span>All payments shown are simulated</span>
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

export function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const { orders, branches, updateOrderStatus, updatePaymentStatus } = useDemoStore();
  const [collectCash, setCollectCash] = useState(false);
  const [target, setTarget] = useState<OrderStatus | null>(null);
  const order = orders.find((o) => o.id === id);
  if (!order)
    return (
      <div className="empty-state">
        <h1>Order not found</h1>
        <p>This order is not in this browser’s demo data.</p>
        <Link className="btn btn-primary" href="/admin/orders">
          Back to orders
        </Link>
      </div>
    );
  const transitions = nextStatuses(order);
  const branch = getOrderBranchDetails(order, branches);
  return (
    <>
      <Link href="/admin/orders" className="admin-back-link">
        <ArrowLeft size={15} /> All orders
      </Link>
      <PageHeading
        eyebrow="ORDER DETAILS"
        title={`Order #${order.number}`}
        description={`Placed ${dateTime(order.createdAt)} · ${branch.name} · Demonstration order`}
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
                <span>Payment method</span>
                <strong>
                  {order.paymentMethod === 'upi'
                    ? 'UPI'
                    : order.paymentMethod === 'card'
                      ? 'Debit / credit card'
                      : 'Cash on fulfillment'}
                </strong>
              </div>
              <div>
                <span>Payment state</span>
                <strong>{order.paymentStatus.replaceAll('_', ' ')}</strong>
              </div>
            </div>
            <p className="admin-inline-note">
              Demo payment state is independent of order fulfillment. No money has been transferred.
              Cash collection requires an explicit demo action.
            </p>
            {order.paymentMethod === 'cash' &&
              order.paymentStatus !== 'simulated_paid' &&
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
              {order.fulfillment === 'delivery' ? 'Delivery address' : 'Pickup from restaurant'}
            </h3>
            <p className="admin-address">
              {order.fulfillment === 'delivery'
                ? [order.customer.address, order.customer.locality, order.customer.postalCode]
                    .filter(Boolean)
                    .join(', ')
                : branch.address || 'Pickup address unavailable. Contact the restaurant.'}
            </p>
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
              ) : (
                <p>This order has reached its final state.</p>
              )}
            </div>
          </section>
        </div>
      </div>
      <ConfirmAction
        open={collectCash}
        onOpenChange={setCollectCash}
        title="Simulate cash collection?"
        description="This marks the demo payment as simulated-paid. No actual money is collected. Revenue becomes eligible only when the order is also delivered or picked up."
        label="Simulate collection"
        onConfirm={() => {
          try {
            updatePaymentStatus(order.id, 'simulated_paid');
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
        description={`This updates order #${order.number} in the local demo and its customer tracking screen. Payment status will stay unchanged.`}
        destructive={target === 'cancelled' || target === 'rejected'}
        label="Update order"
        onConfirm={() => {
          if (target) {
            try {
              updateOrderStatus(order.id, target);
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
