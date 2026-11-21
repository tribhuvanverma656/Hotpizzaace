'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  Banknote,
  Check,
  ChefHat,
  CircleAlert,
  Clock3,
  CreditCard,
  RefreshCw,
  Utensils,
} from 'lucide-react';
import { money } from '@/lib/utils';
import type { Order } from '@/types';
import type { LocalUser } from '@/lib/local-pos/database';
import { LocalPosSidebar } from '@/components/local-pos/sidebar';
import { LocalPosAccountMenu } from '@/components/local-pos/account-menu';
import styles from './kitchen.module.css';

type KitchenOrder = Order & {
  localPos: {
    businessDate: string;
    cart: import('@/types').CartItem[];
    payments: { id: string; method: 'cash' | 'upi'; amount: number }[];
    changeRevision: number;
    acknowledgedRevision: number;
    paidAmount: number;
  };
};
type PaymentInput =
  { method: 'cash'; cashTendered: number } | { method: 'upi'; upiReference: string };
type KitchenMode = 'loading' | 'ready' | 'unauthorized' | 'error';

async function request<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? 'The kitchen request failed.');
  return result;
}

export function LocalKitchen({ orderDashboard = false }: { orderDashboard?: boolean }) {
  const [mode, setMode] = useState<KitchenMode>('loading');
  const [user, setUser] = useState<LocalUser | null>(null);
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [notice, setNotice] = useState('');

  const loadOrders = useCallback(async () => {
    const result = await request<{ orders: KitchenOrder[] }>('/api/local-pos/orders');
    if (!Array.isArray(result.orders))
      throw new Error('The local POS returned an invalid order list.');
    setOrders(result.orders);
  }, []);

  const load = useCallback(async () => {
    try {
      const session = await request<{ user: LocalUser | null }>('/api/local-pos/session');
      if (!session.user) {
        setMode('unauthorized');
        return;
      }
      setUser(session.user);
      await loadOrders();
      setMode('ready');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Kitchen display could not load.');
      setMode('error');
    }
  }, [loadOrders]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (mode !== 'ready') return;
    const interval = window.setInterval(() => {
      void loadOrders().catch((cause) =>
        setError(cause instanceof Error ? cause.message : 'Orders could not be refreshed.'),
      );
    }, 2500);
    return () => window.clearInterval(interval);
  }, [loadOrders, mode]);

  async function update(order: KitchenOrder, action: 'preparing' | 'ready' | 'acknowledge') {
    if (busyId) return;
    setBusyId(order.id);
    setError('');
    setNotice('');
    try {
      const body =
        action === 'acknowledge'
          ? { action, expectedVersion: order.version }
          : { action: 'status', status: action, expectedVersion: order.version };
      await request(`/api/local-pos/orders/${encodeURIComponent(order.id)}`, 'PATCH', body);
      setNotice(
        action === 'acknowledge'
          ? `${order.number} update acknowledged.`
          : `${order.number} marked ${action}.`,
      );
      await loadOrders();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The order update failed.');
      await loadOrders().catch((refreshError) =>
        setError(
          `${cause instanceof Error ? cause.message : 'The order update failed.'} ${
            refreshError instanceof Error ? refreshError.message : ''
          }`.trim(),
        ),
      );
    } finally {
      setBusyId('');
    }
  }

  async function collectPayment(order: KitchenOrder, payment: PaymentInput) {
    if (busyId) return;
    setBusyId(order.id);
    setError('');
    setNotice('');
    try {
      await request(`/api/local-pos/orders/${encodeURIComponent(order.id)}`, 'PATCH', {
        action: 'payment',
        expectedVersion: order.version,
        payment,
      });
      setNotice(`Payment recorded for ${order.number}.`);
      await loadOrders();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Payment could not be recorded.');
    } finally {
      setBusyId('');
    }
  }

  if (mode === 'loading')
    return (
      <main className={styles.statePage}>
        <div className={styles.spinner} />
        Connecting to POS…
      </main>
    );
  if (mode === 'unauthorized')
    return (
      <main className={styles.statePage}>
        <h1>Kitchen sign-in required</h1>
        <p>Sign in with a Kitchen, POS Manager, or Super User account to view this workspace.</p>
        <Link href="/local-pos">Go to POS sign in</Link>
      </main>
    );
  if (mode === 'error')
    return (
      <main className={styles.statePage}>
        <h1>Kitchen display unavailable</h1>
        <p role="alert">{error}</p>
        <button onClick={() => void load()}>Retry connection</button>
        <Link href="/local-pos">Account access</Link>
      </main>
    );

  const cooking = orders.filter(
    (order) => order.status === 'confirmed' || order.status === 'preparing',
  );
  const ready = orders.filter((order) => order.status === 'ready');
  const canUpdateOrders =
    user?.role === 'kitchen' || user?.role === 'pos_manager' || user?.role === 'super_user';
  const canAcknowledgeChanges = user?.role === 'kitchen' || user?.role === 'super_user';
  const canCollectPayment =
    orderDashboard && (user?.role === 'pos_manager' || user?.role === 'super_user');

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <Link href="/local-pos" aria-label="Back to local POS">
            <Image src="/brand/hot-pizza-ace.gif" alt="" width={1806} height={1440} unoptimized />
          </Link>
          <div>
            <strong>HOT PIZZA ACE</strong>
            <span>{orderDashboard ? 'ORDER DASHBOARD · BARRA' : 'KITCHEN DISPLAY · BARRA'}</span>
          </div>
        </div>
        <div className={styles.topActions}>
          <span className={styles.connection}>
            <i /> Connected to local POS
          </span>
          {user && <LocalPosAccountMenu user={user} />}
          <button onClick={() => void loadOrders()} aria-label="Refresh orders">
            <RefreshCw size={17} />
          </button>
        </div>
      </header>
      <div className={styles.workArea}>
        <LocalPosSidebar
          role={user?.role ?? 'kitchen'}
          active={orderDashboard ? 'orders' : 'kitchen'}
        />
        <div className={styles.mainContent}>
          <section className={styles.heading}>
            <div>
              <p>{canUpdateOrders ? 'LIVE ORDER QUEUE' : 'LIVE ORDER VIEW'}</p>
              <h1>{orderDashboard ? 'Order Dashboard' : 'Kitchen'}</h1>
              <span>
                {canUpdateOrders
                  ? 'Update order status · local network'
                  : 'View-only · Kitchen Staff, POS Managers and Super Users can update status'}
              </span>
            </div>
            <div className={styles.summary}>
              <span>
                <i className={styles.cookingDot} /> Preparing <b>{cooking.length}</b>
              </span>
              <span>
                <i className={styles.readyDot} /> Ready <b>{ready.length}</b>
              </span>
              <span>
                <Clock3 size={15} /> 3 AM business-day reset
              </span>
            </div>
          </section>
          {error && (
            <p className={styles.error} role="alert">
              <CircleAlert size={16} />
              {error}
            </p>
          )}
          {notice && (
            <p className={styles.notice} role="status">
              <Check size={16} />
              {notice}
            </p>
          )}
          <div className={styles.columns}>
            <section>
              <div className={styles.columnHeading}>
                <h2>
                  <ChefHat size={20} /> To prepare
                </h2>
                <span>{cooking.length} orders</span>
              </div>
              <div className={styles.cards}>
                {cooking.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    busy={busyId === order.id}
                    canUpdate={canUpdateOrders}
                    canAcknowledge={canAcknowledgeChanges}
                    onAction={(action) => void update(order, action)}
                    canCollectPayment={canCollectPayment}
                    onCollectPayment={(payment) => void collectPayment(order, payment)}
                  />
                ))}
                {!cooking.length && (
                  <div className={styles.empty}>
                    <Utensils size={23} />
                    <strong>All caught up</strong>
                    <span>New orders appear here automatically.</span>
                  </div>
                )}
              </div>
            </section>
            <section>
              <div className={styles.columnHeading}>
                <h2>
                  <Check size={19} /> Ready for service
                </h2>
                <span>{ready.length} orders</span>
              </div>
              <div className={styles.cards}>
                {ready.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    busy={busyId === order.id}
                    canUpdate={canUpdateOrders}
                    canAcknowledge={canAcknowledgeChanges}
                    onAction={(action) => void update(order, action)}
                    canCollectPayment={canCollectPayment}
                    onCollectPayment={(payment) => void collectPayment(order, payment)}
                  />
                ))}
                {!ready.length && (
                  <div className={styles.empty}>
                    <Clock3 size={23} />
                    <strong>Nothing ready yet</strong>
                    <span>
                      Orders move here when Kitchen Staff or POS Manager marks them Ready.
                    </span>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
      <footer className={styles.footer}>
        <span className={styles.pulse} /> Auto-refreshing every 2.5 seconds · {orders.length} active
        orders
      </footer>
    </main>
  );
}

function OrderCard({
  order,
  canUpdate,
  canAcknowledge,
  onAction,
  canCollectPayment,
  onCollectPayment,
  busy,
}: {
  order: KitchenOrder;
  canUpdate: boolean;
  canAcknowledge: boolean;
  onAction: (action: 'preparing' | 'ready' | 'acknowledge') => void;
  canCollectPayment: boolean;
  onCollectPayment: (payment: PaymentInput) => void;
  busy: boolean;
}) {
  const needsAck = order.localPos.changeRevision > order.localPos.acknowledgedRevision;
  const due = Math.max(0, order.total - order.localPos.paidAmount);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'upi'>('cash');
  const [cashTendered, setCashTendered] = useState('');
  const [upiReference, setUpiReference] = useState('');
  const [showPaymentForm, setShowPaymentForm] = useState(false);

  function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (due <= 0) return;
    if (paymentMethod === 'cash') {
      onCollectPayment({
        method: 'cash',
        cashTendered: Math.round(Number(cashTendered || (due / 100).toFixed(2)) * 100),
      });
      return;
    }
    onCollectPayment({ method: 'upi', upiReference: upiReference.trim().toUpperCase() });
  }

  return (
    <article className={`${styles.card} ${needsAck ? styles.changed : ''}`}>
      <header className={styles.cardHeader}>
        <div>
          <strong>{order.number}</strong>
          <span>
            {order.fulfillment === 'delivery'
              ? `PHONE DELIVERY · ${order.customer.name}`
              : order.counter?.tableLabel || order.customer.name}
          </span>
        </div>
        <span className={`${styles.status} ${order.status === 'ready' ? styles.statusReady : ''}`}>
          {order.status === 'confirmed' ? 'NEW' : order.status.toUpperCase()}
        </span>
      </header>
      {needsAck && (
        <div className={styles.changeNotice}>
          <CircleAlert size={16} />
          <span>Order changed by POS. Review the items below.</span>
          {canAcknowledge ? (
            <button disabled={busy} onClick={() => onAction('acknowledge')}>
              Acknowledge
            </button>
          ) : (
            <span>Kitchen Staff or Super User acknowledgement required</span>
          )}
        </div>
      )}
      {order.fulfillment === 'delivery' && (
        <div className={styles.deliveryTicket}>
          <strong>Delivery details</strong>
          <span>
            {order.customer.address}, {order.customer.locality}, {order.customer.postalCode}
          </span>
          {order.customer.landmark && <span>Landmark: {order.customer.landmark}</span>}
          {order.customer.phone && (
            <a href={`tel:${order.customer.phone}`}>{order.customer.phone}</a>
          )}
        </div>
      )}
      <ul className={styles.items}>
        {order.items.map((item) => (
          <li key={item.id}>
            <span className={styles.itemQuantity}>{item.quantity}×</span>
            <div className={styles.itemDetails}>
              <strong>{item.name}</strong>
              {item.options.length > 0 && <span>{item.options.join(' · ')}</span>}
              {item.notes && <em>Note: {item.notes}</em>}
            </div>
          </li>
        ))}
      </ul>
      <div className={styles.cardFooter}>
        <span>
          {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{' '}
          · {order.items.reduce((sum, item) => sum + item.quantity, 0)} items
        </span>
        <strong>{money(order.total)}</strong>
      </div>
      {canCollectPayment && (
        <div className={styles.paymentSection}>
          {due > 0 ? (
            <>
              <div className={styles.paymentSummary}>
                <span>Paid {money(order.localPos.paidAmount)}</span>
                <strong>Due {money(due)}</strong>
              </div>
              {!showPaymentForm ? (
                <button
                  className={styles.paymentButton}
                  disabled={busy}
                  onClick={() => {
                    if (!cashTendered) setCashTendered((due / 100).toFixed(2));
                    setShowPaymentForm(true);
                  }}
                >
                  <Banknote size={16} /> Record payment
                </button>
              ) : (
                <form className={styles.paymentForm} onSubmit={submitPayment}>
                  <label>
                    Payment method
                    <select
                      value={paymentMethod}
                      onChange={(event) =>
                        setPaymentMethod(event.target.value === 'upi' ? 'upi' : 'cash')
                      }
                      disabled={busy}
                    >
                      <option value="cash">Cash</option>
                      <option value="upi">UPI</option>
                    </select>
                  </label>
                  {paymentMethod === 'cash' ? (
                    <label>
                      Cash received (₹)
                      <input
                        type="number"
                        min={(due / 100).toFixed(2)}
                        step="0.01"
                        value={cashTendered}
                        placeholder={(due / 100).toFixed(2)}
                        onChange={(event) => setCashTendered(event.target.value)}
                        required
                        disabled={busy}
                      />
                    </label>
                  ) : (
                    <label>
                      UPI reference (optional)
                      <input
                        type="text"
                        minLength={6}
                        maxLength={80}
                        pattern="[A-Za-z0-9]{6,80}"
                        value={upiReference}
                        onChange={(event) => setUpiReference(event.target.value)}
                        disabled={busy}
                      />
                    </label>
                  )}
                  <div className={styles.paymentActions}>
                    <button type="button" disabled={busy} onClick={() => setShowPaymentForm(false)}>
                      Cancel
                    </button>
                    <button type="submit" disabled={busy}>
                      <CreditCard size={15} /> {busy ? 'Recording…' : `Receive ${money(due)}`}
                    </button>
                  </div>
                </form>
              )}
            </>
          ) : (
            <p className={styles.paidSummary}>
              <Check size={15} /> Paid in full
            </p>
          )}
        </div>
      )}
      {canUpdate && order.status === 'confirmed' && (
        <button
          className={styles.prepareButton}
          disabled={busy || needsAck}
          onClick={() => onAction('preparing')}
        >
          <ChefHat size={17} />{' '}
          {needsAck ? 'Acknowledge changes first' : busy ? 'Updating…' : 'Start preparing'}
        </button>
      )}
      {canUpdate && order.status === 'preparing' && (
        <button
          className={styles.readyButton}
          disabled={busy || needsAck}
          onClick={() => onAction('ready')}
        >
          <Check size={17} />{' '}
          {needsAck ? 'Acknowledge changes first' : busy ? 'Updating…' : 'Mark ready'}
        </button>
      )}
      {order.status === 'ready' && (
        <p className={styles.locked}>
          <Check size={15} /> Ready · locked against POS changes
        </p>
      )}
      {!canUpdate && order.status !== 'ready' && (
        <p className={styles.locked}>
          Kitchen Staff, POS Manager or Super User account required to update status.
        </p>
      )}
    </article>
  );
}
