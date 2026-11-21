'use client';
import { isTestGatewayMode } from '@/lib/payments/method';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { startVisiblePolling } from '@/lib/visible-polling';
import { ChefHat, Check, Clock3, Flame, RefreshCw } from 'lucide-react';
import { useAdminStore } from './use-admin-store';
import { commerceRequest } from '@/lib/commerce/client';
import { kitchenOrders } from '@/lib/kitchen';
import { getOrderBranchId } from '@/lib/branches';
import type { Order } from '@/types';
import { OrderSoundToggle, useOrderChime } from '@/components/order-sound';
import styles from './kitchen.module.css';

type ReadyOrder = Order & { readyAt?: string };
const timeOfDay = (value: string) =>
  new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value));

/** Read-only list of this branch's orders that passed the kitchen today, newest first. */
export function KitchenReadyToday({ orders }: { orders: ReadyOrder[] }) {
  return (
    <section className={styles.readySection} aria-label="Ready today">
      <h2>
        Ready today <span>{orders.length}</span>
      </h2>
      {!orders.length ? (
        <p className={styles.readyEmpty}>Orders marked ready today will be listed here.</p>
      ) : (
        <div className={styles.readyList}>
          {orders.map((order) => (
            <article key={order.id} className={styles.readyCard}>
              <header>
                <strong>{order.number}</strong>
                <span>
                  {order.readyAt ? `Ready ${timeOfDay(order.readyAt)}` : 'Ready'} · ordered{' '}
                  {timeOfDay(order.createdAt)}
                </span>
              </header>
              <p className={styles.readyMeta}>
                {order.fulfillment === 'dine_in'
                  ? 'Dine-in'
                  : order.fulfillment === 'pickup'
                    ? 'Pickup'
                    : 'Delivery'}
                {order.counter?.tableLabel ? ` · ${order.counter.tableLabel}` : ''}
              </p>
              <ul>
                {order.items.map((item) => (
                  <li key={item.id}>
                    <b>{item.quantity}×</b> {item.name}
                    {item.options.length > 0 && <small> · {item.options.join(' · ')}</small>}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function KitchenBoard({
  orders,
  busy,
  error,
  now,
  onUpdate,
}: {
  orders: Order[];
  busy: string | null;
  error: string;
  now: number;
  onUpdate: (order: Order) => void;
}) {
  return (
    <>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {!orders.length ? (
        <div className={styles.empty}>
          <ChefHat size={56} />
          <h2>The kitchen is clear.</h2>
          <p>
            Confirmed orders appear here. Pay-later dine-in orders carry an unpaid warning.
            Cancelled, ready and completed orders stay out of this queue.
          </p>
          <Link className="btn btn-outline" href="/admin/orders">
            Review incoming orders
          </Link>
        </div>
      ) : (
        <div className={styles.grid}>
          {orders.map((order) => (
            <article
              key={order.id}
              className={styles.ticket}
              aria-label={`Prepare ${order.number}`}
            >
              <div className={styles.ticketTop}>
                <div>
                  <span className={styles.mode}>
                    {order.fulfillment === 'dine_in'
                      ? 'DINE-IN'
                      : order.fulfillment === 'pickup'
                        ? 'PICKUP'
                        : order.channel === 'counter'
                          ? 'COUNTER DELIVERY'
                          : 'DELIVERY'}{' '}
                    · {order.branchName}
                  </span>
                  <h2>{order.number}</h2>
                  {order.counter?.tableLabel && <strong>{order.counter.tableLabel}</strong>}
                </div>
                <span className={styles.elapsed}>
                  <Clock3 size={16} />
                  {Math.max(0, Math.floor((now - Date.parse(order.createdAt)) / 60000))} min
                </span>
              </div>
              <div className={styles.state}>
                {order.status === 'preparing' ? (
                  <>
                    <Flame size={16} /> Preparing
                  </>
                ) : (
                  <>
                    <ChefHat size={16} /> Ready to start
                  </>
                )}
              </div>
              {order.channel === 'counter' && order.paymentStatus !== 'paid' && (
                <p className={styles.unpaid}>PAY LATER · Payment still due</p>
              )}
              {order.channel === 'counter' && order.customer.instructions && (
                <p className={styles.unpaid}>
                  <strong>ORDER NOTE</strong> · {order.customer.instructions}
                </p>
              )}
              <ul className={styles.items}>
                {order.items.map((item) => (
                  <li key={item.id}>
                    <span className={styles.quantity}>{item.quantity}×</span>
                    <div>
                      <h3>{item.name}</h3>
                      {item.options.length > 0 && (
                        <p className={styles.options}>{item.options.join(' · ')}</p>
                      )}
                      {item.notes && (
                        <p className={styles.note}>
                          <strong>KITCHEN NOTE</strong>
                          {item.notes}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {order.environment === 'development' ||
              isTestGatewayMode(order.paymentMode) ||
              order.paymentMode === 'simulation' ? (
                <p className={styles.test}>TEST ORDER · Do not prepare real food</p>
              ) : null}
              <button
                className={styles.action}
                disabled={busy !== null || Boolean(error)}
                onClick={() => onUpdate(order)}
              >
                {order.status === 'preparing' ? <Check size={20} /> : <Flame size={20} />}
                {busy === order.id
                  ? 'Saving…'
                  : order.status === 'preparing'
                    ? 'Mark ready'
                    : 'Start preparing'}
              </button>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

export function KitchenPage() {
  const store = useAdminStore();
  return (
    <KitchenWorkspace
      key={`${store.shared.user?.id ?? 'local'}:${store.adminBranchId}`}
      branchId={store.adminBranchId}
    />
  );
}

function KitchenWorkspace({ branchId }: { branchId: string }) {
  const store = useAdminStore();
  const { enabled, admin, ready } = store.shared;
  const [tickets, setTickets] = useState<Order[]>([]);
  const [readyToday, setReadyToday] = useState<ReadyOrder[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const readController = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (
        !enabled ||
        !admin ||
        !ready ||
        (readController.current && !readController.current.signal.aborted)
      )
        return;
      const controller = new AbortController();
      readController.current = controller;
      const cancel = () => controller.abort();
      if (signal?.aborted) cancel();
      else signal?.addEventListener('abort', cancel, { once: true });
      const request = ++sequence.current;
      setLoading(true);
      try {
        const result = await commerceRequest<{
          orders: Order[];
          hasMore: boolean;
          ready?: ReadyOrder[];
        }>(`admin/kitchen/${branchId}`, { signal: controller.signal });
        if (request !== sequence.current || controller.signal.aborted) return;
        if (
          !Array.isArray(result.orders) ||
          typeof result.hasMore !== 'boolean' ||
          result.orders.some((order) => getOrderBranchId(order) !== branchId)
        )
          throw new Error('The kitchen returned an incomplete queue. Refresh before preparing.');
        setTickets(result.orders);
        setReadyToday(
          Array.isArray(result.ready)
            ? result.ready.filter(
                (order) => getOrderBranchId(order) === branchId && Array.isArray(order.items),
              )
            : [],
        );
        setLoaded(true);
        setHasMore(result.hasMore);
        setError('');
      } catch (cause) {
        if (request === sequence.current && !controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'Unable to refresh the kitchen.');
      } finally {
        signal?.removeEventListener('abort', cancel);
        if (readController.current === controller) readController.current = null;
        if (request === sequence.current && !controller.signal.aborted) setLoading(false);
      }
    },
    [enabled, admin, ready, branchId],
  );
  useEffect(() => {
    const controller = new AbortController();
    const stopPolling = startVisiblePolling({
      refresh: () => load(controller.signal),
      intervalMs: 10000,
      canRefresh: () => !inFlight.current,
    });
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => {
      stopPolling();
      controller.abort();
      readController.current?.abort();
      sequence.current += 1;
      clearInterval(timer);
    };
  }, [load]);
  const orders = kitchenOrders(enabled ? (admin && ready ? tickets : []) : store.orders, branchId);
  const chime = useOrderChime(enabled ? (loaded ? orders.map((order) => order.id) : null) : null);
  const branch = store.branches.find((item) => item.id === branchId);
  const update = async (order: Order) => {
    if (
      inFlight.current ||
      error ||
      getOrderBranchId(order) !== branchId ||
      (enabled && (!admin || !ready))
    )
      return;
    inFlight.current = true;
    sequence.current += 1;
    readController.current?.abort();
    setLoading(false);
    setBusy(order.id);
    try {
      const status = order.status === 'confirmed' ? 'preparing' : 'ready';
      if (enabled) {
        const result = await commerceRequest<{ order: Order }>(`orders/${order.id}`, {
          method: 'PATCH',
          body: { status, expectedVersion: order.version },
        });
        if (getOrderBranchId(result.order) !== branchId)
          throw new Error('The order branch changed. Refresh the kitchen.');
        setTickets((current) =>
          current.map((item) => (item.id === order.id ? result.order : item)),
        );
        await load();
      } else store.updateOrderStatus(order.id, status);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not update the order. Refresh and try again.',
      );
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };
  return (
    <section className={styles.screen}>
      <header className={styles.heading}>
        <div>
          <p>KITCHEN</p>
          <h1>Let’s get cooking.</h1>
          <span>
            {orders.length} {orders.length === 1 ? 'order' : 'orders'} to prepare · oldest first
          </span>
        </div>
        <div className={styles.headingActions}>
          <OrderSoundToggle
            soundOn={chime.soundOn}
            needsTap={chime.needsTap}
            onToggle={chime.toggle}
          />
          <button
            className="btn btn-outline"
            onClick={() => void load()}
            disabled={loading || busy !== null}
          >
            <RefreshCw size={20} /> {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>
      <div className={styles.branch}>
        <label htmlFor="kitchen-branch">
          Kitchen branch
          <select
            id="kitchen-branch"
            value={branchId}
            disabled={busy !== null}
            onChange={(event) => store.selectAdminBranch(event.target.value)}
          >
            {store.branches.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <div>
          <strong>Only {branch?.name ?? 'this branch'} orders appear here.</strong>
          <p>{branch?.settings.address}</p>
        </div>
      </div>
      <details className={styles.hint}>
        <summary>How this queue works</summary>
        Confirmed website orders and staff-accepted dine-in orders share this branch’s queue. Mark
        ready only when every item is prepared. Ready orders move to “Ready today” below, with what
        was ordered. A sound plays when a new ticket arrives.
      </details>
      {hasMore && (
        <p role="alert" className={styles.error}>
          More than 1,000 active tickets exist. This queue is incomplete; contact the owner before
          preparing missing orders.
        </p>
      )}
      <KitchenBoard
        orders={orders}
        busy={busy}
        error={error}
        now={now}
        onUpdate={(order) => void update(order)}
      />
      {enabled && <KitchenReadyToday orders={readyToday} />}
    </section>
  );
}
