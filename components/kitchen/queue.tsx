'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChefHat, Check, Clock3, Flame, LogOut, RefreshCw } from 'lucide-react';
import type { KitchenProfile, KitchenTicket } from '@/lib/kitchen-staff';
import { startVisiblePolling } from '@/lib/visible-polling';
import { KitchenApiError, kitchenAccessEnded, kitchenRequest } from './client';
import { KitchenAccessMessage } from './login';
import { useKitchen } from './provider';
import { OrderSoundToggle, useOrderChime } from '@/components/order-sound';
import styles from './kitchen.module.css';

type QueueResponse = {
  profile: KitchenProfile;
  tickets: KitchenTicket[];
  complete: boolean;
  ready?: KitchenTicket[];
};
const timeOfDay = (value: string) =>
  new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value));

/** Read-only list of orders this branch's kitchen finished today, newest first. */
export function ChefReadyToday({ tickets }: { tickets: KitchenTicket[] }) {
  return (
    <section className={styles.readySection} aria-label="Ready today">
      <h2>
        Ready today <span>{tickets.length}</span>
      </h2>
      {!tickets.length ? (
        <p className={styles.help}>Orders marked ready today will be listed here.</p>
      ) : (
        <div className={styles.readyList}>
          {tickets.map((ticket) => (
            <article key={ticket.id} className={styles.readyCard}>
              <header>
                <strong>{ticket.number}</strong>
                <span>
                  {ticket.readyAt ? `Ready ${timeOfDay(ticket.readyAt)}` : 'Ready'} · ordered{' '}
                  {timeOfDay(ticket.createdAt)}
                </span>
              </header>
              <p className={styles.readyMeta}>
                {ticket.fulfillment === 'dine_in'
                  ? 'Dine-in'
                  : ticket.fulfillment === 'pickup'
                    ? 'Pickup'
                    : ticket.channel === 'counter'
                      ? 'Counter delivery'
                      : 'Delivery'}
              </p>
              <ul>
                {ticket.items.map((item, index) => (
                  <li key={index}>
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
const oldestFirst = (tickets: KitchenTicket[]) =>
  [...tickets].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id),
  );
export function validKitchenTicket(ticket: KitchenTicket, branchId: string): boolean {
  return (
    !!ticket &&
    typeof ticket.id === 'string' &&
    typeof ticket.number === 'string' &&
    ticket.branchId === branchId &&
    typeof ticket.branchName === 'string' &&
    Number.isFinite(Date.parse(ticket.createdAt)) &&
    Number.isSafeInteger(ticket.version) &&
    ticket.version > 0 &&
    ['confirmed', 'preparing', 'ready'].includes(ticket.status) &&
    ['delivery', 'pickup', 'dine_in'].includes(ticket.fulfillment) &&
    ['website', 'counter'].includes(ticket.channel) &&
    typeof ticket.payLater === 'boolean' &&
    typeof ticket.testOrder === 'boolean' &&
    Array.isArray(ticket.items) &&
    ticket.items.length > 0 &&
    ticket.items.every(
      (item) =>
        typeof item.name === 'string' &&
        Number.isSafeInteger(item.quantity) &&
        item.quantity > 0 &&
        Array.isArray(item.options) &&
        item.options.every((option) => typeof option === 'string') &&
        typeof item.notes === 'string',
    )
  );
}
export function ChefTicketBoard({
  tickets,
  busy,
  blocked,
  now,
  onUpdate,
}: {
  tickets: KitchenTicket[];
  busy: string | null;
  blocked: boolean;
  now: number;
  onUpdate: (ticket: KitchenTicket) => void;
}) {
  return (
    <div className={styles.grid}>
      {tickets.map((ticket) => (
        <article className={styles.ticket} key={ticket.id} aria-label={`Prepare ${ticket.number}`}>
          <header className={styles.ticketHeading}>
            <div>
              <p className={styles.eyebrow}>
                {ticket.fulfillment === 'dine_in'
                  ? 'Dine-in'
                  : ticket.fulfillment === 'pickup'
                    ? 'Pickup'
                    : ticket.channel === 'counter'
                      ? 'Counter delivery'
                      : 'Delivery'}
              </p>
              <h2>{ticket.number}</h2>
            </div>
            <span className={styles.elapsed}>
              <Clock3 size={16} />{' '}
              {Math.max(0, Math.floor((now - Date.parse(ticket.createdAt)) / 60000))} min
            </span>
          </header>
          <p className={styles.status}>
            {ticket.status === 'preparing' ? <Flame size={17} /> : <ChefHat size={17} />}
            {ticket.status === 'preparing' ? 'Preparing' : 'Ready to start'}
          </p>
          {ticket.payLater && <p className={styles.warning}>Pay later · Payment still due</p>}
          <ul className={styles.items}>
            {ticket.items.map((item, index) => (
              <li key={index}>
                <b className={styles.quantity}>{item.quantity}×</b>
                <div>
                  <h3>{item.name}</h3>
                  {item.options.length > 0 && <p>{item.options.join(' · ')}</p>}
                  {item.notes && (
                    <p className={styles.note}>
                      <strong>Preparation note</strong>
                      {item.notes}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {ticket.testOrder && <p className={styles.test}>TEST ORDER · Do not prepare real food</p>}
          <button
            className={styles.primary}
            disabled={blocked || busy !== null}
            onClick={() => onUpdate(ticket)}
          >
            {ticket.status === 'preparing' ? <Check size={19} /> : <Flame size={19} />}
            {busy === ticket.id
              ? 'Saving…'
              : ticket.status === 'preparing'
                ? 'Mark ready'
                : 'Start preparing'}
          </button>
        </article>
      ))}
    </div>
  );
}
export function ChefKitchen() {
  const kitchen = useKitchen();
  const { profile, status, acceptProfile, endSession } = kitchen;
  const router = useRouter();
  const [tickets, setTickets] = useState<KitchenTicket[]>([]);
  const [readyToday, setReadyToday] = useState<KitchenTicket[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [complete, setComplete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const mounted = useRef(true);
  const mutation = useRef(false);
  const readVersion = useRef(0);
  const readController = useRef<AbortController | null>(null);
  const branchId = profile?.branchId;
  const handleAccessError = useCallback(
    (cause: unknown) => {
      if (
        kitchenAccessEnded(cause) ||
        (cause instanceof KitchenApiError && cause.code === 'kitchen_disabled')
      ) {
        setTickets([]);
        setComplete(false);
        endSession(cause instanceof KitchenApiError && cause.code === 'kitchen_disabled');
        return true;
      }
      return false;
    },
    [endSession],
  );
  const refresh = useCallback(async () => {
    if (!branchId) return;
    readController.current?.abort();
    const controller = new AbortController();
    readController.current = controller;
    const version = ++readVersion.current;
    setLoading(true);
    try {
      const result = await kitchenRequest<QueueResponse>('queue', { signal: controller.signal });
      if (!mounted.current || controller.signal.aborted || version !== readVersion.current) return;
      acceptProfile(result.profile);
      if (
        !Array.isArray(result.tickets) ||
        typeof result.complete !== 'boolean' ||
        result.tickets.some(
          (ticket) =>
            !validKitchenTicket(ticket, branchId) ||
            !['confirmed', 'preparing'].includes(ticket.status),
        ) ||
        new Set(result.tickets.map((ticket) => ticket.id)).size !== result.tickets.length
      )
        throw new KitchenApiError(502, 'invalid_response');
      setTickets(oldestFirst(result.tickets));
      setReadyToday(
        Array.isArray(result.ready)
          ? result.ready.filter(
              (ticket) => validKitchenTicket(ticket, branchId) && ticket.status === 'ready',
            )
          : [],
      );
      setLoaded(true);
      setComplete(result.complete);
      setError(result.complete ? '' : 'The queue is incomplete. Refresh before updating tickets.');
      setNow(Date.now());
    } catch (cause) {
      if (!mounted.current || controller.signal.aborted || version !== readVersion.current) return;
      setComplete(false);
      if (!handleAccessError(cause))
        setError(
          'The kitchen queue could not be refreshed. Displayed tickets may be stale. Refresh before updating them.',
        );
    } finally {
      if (readController.current === controller) readController.current = null;
      if (mounted.current && version === readVersion.current) setLoading(false);
    }
  }, [acceptProfile, branchId, handleAccessError]);
  useEffect(() => {
    if (status === 'signed_out') router.replace('/kitchen/login');
  }, [status, router]);
  useEffect(() => {
    mounted.current = true;
    setTickets([]);
    setReadyToday([]);
    setLoaded(false);
    setComplete(false);
    setError('');
    setNotice('');
    if (status !== 'ready' || !branchId) return;
    const stopPolling = startVisiblePolling({
      refresh: () => {
        setNow(Date.now());
        return refresh();
      },
      intervalMs: 10_000,
      canRefresh: () =>
        !mutation.current && (!readController.current || readController.current.signal.aborted),
    });
    return () => {
      mounted.current = false;
      stopPolling();
      // This is a request generation, not a DOM ref; invalidate its latest value.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ++readVersion.current;
      readController.current?.abort();
    };
  }, [branchId, profile?.id, profile?.version, refresh, status]);
  const update = async (ticket: KitchenTicket) => {
    if (
      mutation.current ||
      !complete ||
      loading ||
      error ||
      status !== 'ready' ||
      !branchId ||
      ticket.branchId !== branchId ||
      !['confirmed', 'preparing'].includes(ticket.status)
    )
      return;
    mutation.current = true;
    ++readVersion.current;
    readController.current?.abort();
    setBusy(ticket.id);
    setNotice('');
    try {
      const result = await kitchenRequest<{ profile: KitchenProfile; ticket: KitchenTicket }>(
        `orders/${encodeURIComponent(ticket.id)}`,
        {
          method: 'PATCH',
          body: {
            expectedVersion: ticket.version,
            status: ticket.status === 'confirmed' ? 'preparing' : 'ready',
          },
        },
      );
      if (!mounted.current) return;
      acceptProfile(result.profile);
      if (
        !validKitchenTicket(result.ticket, branchId) ||
        result.ticket.id !== ticket.id ||
        result.ticket.status !== (ticket.status === 'confirmed' ? 'preparing' : 'ready')
      )
        throw new KitchenApiError(502, 'invalid_response');
      setTickets((current) =>
        oldestFirst([
          ...current.filter((item) => item.id !== ticket.id),
          ...(result.ticket.status === 'ready' ? [] : [result.ticket]),
        ]),
      );
      setNotice(
        `${ticket.number} · ${result.ticket.status === 'ready' ? 'Ready' : 'Preparation started'}.`,
      );
      await refresh();
    } catch (cause) {
      if (!mounted.current || handleAccessError(cause)) return;
      setComplete(false);
      setNotice(
        cause instanceof KitchenApiError && cause.code === 'version_conflict'
          ? 'This ticket changed in another kitchen session. The queue has been refreshed; review its current state.'
          : 'The update could not be confirmed. Check the refreshed ticket before taking another action.',
      );
      await refresh();
    } finally {
      mutation.current = false;
      if (mounted.current) setBusy(null);
    }
  };
  const chime = useOrderChime(loaded ? tickets.map((ticket) => ticket.id) : null);
  if (status !== 'ready' || !profile) return <KitchenAccessMessage />;
  return (
    <section className={styles.workspace} aria-label="Assigned branch kitchen">
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>HOT PIZZA ACE · KITCHEN</p>
          <h1>{profile.branchName}</h1>
          <p>
            Signed in as <strong>{profile.displayName}</strong>
          </p>
        </div>
        <div className={styles.actions}>
          <OrderSoundToggle
            className={styles.secondary}
            soundOn={chime.soundOn}
            needsTap={chime.needsTap}
            onToggle={chime.toggle}
          />
          <button
            className={styles.secondary}
            disabled={loading || busy !== null}
            onClick={() => void refresh()}
          >
            <RefreshCw size={18} /> Refresh
          </button>
          <button
            className={styles.secondary}
            disabled={busy !== null}
            onClick={() => void kitchen.signOut()}
          >
            <LogOut size={18} /> Sign out
          </button>
        </div>
      </header>
      {profile.environment === 'development' && (
        <p className={styles.test}>TEST KITCHEN · Do not prepare real food.</p>
      )}
      <div className={styles.queueHeading}>
        <h2>Preparation queue</h2>
        <span>{tickets.length} active tickets · oldest first</span>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {loading && (
        <p className={styles.help} role="status">
          Refreshing the kitchen queue…
        </p>
      )}
      {!loading && complete && !tickets.length && (
        <div className={styles.empty}>
          <ChefHat size={45} />
          <h2>The kitchen is clear.</h2>
          <p>Accepted preparation tickets will appear here.</p>
        </div>
      )}
      <ChefTicketBoard
        tickets={tickets}
        busy={busy}
        blocked={!complete || loading || !!error}
        now={now}
        onUpdate={(ticket) => void update(ticket)}
      />
      <ChefReadyToday tickets={readyToday} />
    </section>
  );
}
