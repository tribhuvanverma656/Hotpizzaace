'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { commerceRequest, CommerceError } from '@/lib/commerce/client';
import { getCartTotals } from '@/lib/pricing';
import { money } from '@/lib/utils';
import { startVisiblePolling } from '@/lib/visible-polling';
import type { Branch, Order } from '@/types';
import type { TableRequest } from '@/lib/table-ordering';
import { AmountRows, PaymentFields, type CounterPayment } from '@/components/dine-in-controls';
import { useAdminStore } from './use-admin-store';
import styles from './dine-in-qr.module.css';
import counterStyles from './counter.module.css';

type Decision = {
  expectedRequestVersion: number;
  expectedRevision: number;
  expectedTotal: number;
  expectedRoundOffPolicy: 'nearest_rupee';
  idempotencyKey: string;
  payment: CounterPayment | null;
  payLaterReason?: string;
};
const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : 'Unable to review QR requests.';
export function TableRequestQueue({
  branch,
  onAccepted,
}: {
  branch: Branch;
  onAccepted: (order: Order) => void;
}) {
  const [requests, setRequests] = useState<TableRequest[]>([]);
  const [selected, setSelected] = useState<TableRequest | null>(null);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [query, setQuery] = useState('');
  const active = useRef(true);
  const readController = useRef<AbortController | null>(null);
  const readVersion = useRef(0);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (readController.current && !readController.current.signal.aborted) return;
      const controller = new AbortController();
      readController.current = controller;
      const cancel = () => controller.abort();
      if (signal?.aborted) cancel();
      else signal?.addEventListener('abort', cancel, { once: true });
      const version = ++readVersion.current;
      try {
        const result = await commerceRequest<{ requests: TableRequest[]; hasMore: boolean }>(
          `admin/table-requests/${branch.id}`,
          { signal: controller.signal },
        );
        if (!active.current || controller.signal.aborted || version !== readVersion.current) return;
        if (
          !Array.isArray(result.requests) ||
          result.requests.some((r) => r.branchId !== branch.id)
        )
          throw new Error('The request queue returned an unexpected branch.');
        setRequests(result.requests);
        setHasMore(result.hasMore === true);
        setError('');
      } catch (cause) {
        if (active.current && !controller.signal.aborted && version === readVersion.current)
          setError(message(cause));
      } finally {
        signal?.removeEventListener('abort', cancel);
        if (readController.current === controller) readController.current = null;
      }
    },
    [branch.id],
  );
  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    const stopPolling = startVisiblePolling({
      refresh: () => load(controller.signal),
      intervalMs: 10000,
    });
    return () => {
      active.current = false;
      stopPolling();
      controller.abort();
      readController.current?.abort();
    };
  }, [load]);
  return (
    <section id="qr-requests" className={styles.queue} style={{ scrollMarginTop: 100 }}>
      <div className={styles.heading}>
        <div>
          <h2>QR orders · {requests.length}</h2>
          <p>Pay at counter · waiting for payment confirmation</p>
        </div>
        <Link href="/admin/dine-in-qr" className="btn btn-outline">
          Manage branch QR
        </Link>
        <button className="btn btn-outline" onClick={() => void load()}>
          Refresh requests
        </button>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {hasMore && (
        <p className={styles.warning}>
          More requests are waiting. Finish the oldest requests and refresh.
        </p>
      )}
      <label className={styles.requestSearch}>
        Find a QR order
        <input
          type="search"
          value={query}
          placeholder="Name, mobile number or request number"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className={styles.requests}>
        {requests
          .filter((request) =>
            `${request.number} ${request.customerName ?? ''} ${request.customerPhone ?? ''}`
              .toLowerCase()
              .includes(query.trim().toLowerCase()),
          )
          .map((r) => (
            <button
              key={r.id}
              className={styles.request}
              disabled={!!error}
              onClick={() => setSelected(r)}
            >
              <strong>{r.number}</strong>
              <span>
                {r.items.reduce((n, item) => n + item.quantity, 0)} items · {money(r.total)}
              </span>
              <small>
                {r.customerName || 'Guest'}
                {r.customerPhone && ` · ${r.customerPhone}`}
              </small>
              <small>Review & collect payment</small>
            </button>
          ))}
      </div>
      {!requests.length && !error && <p>No QR orders are waiting.</p>}
      {requests.length > 0 &&
        query.trim() &&
        !requests.some((request) =>
          `${request.number} ${request.customerName ?? ''} ${request.customerPhone ?? ''}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
        ) && <p>No matching QR orders. Check the name, mobile or request number.</p>}
      {selected && (
        <RequestReview
          key={`${selected.id}:${selected.version}`}
          request={selected}
          branch={branch}
          onClose={() => setSelected(null)}
          onDecided={(order) => {
            ++readVersion.current;
            readController.current?.abort();
            setSelected(null);
            setRequests((current) => current.filter((r) => r.id !== selected.id));
            if (order) onAccepted(order);
            void load();
          }}
        />
      )}
    </section>
  );
}
function RequestReview({
  request,
  branch,
  onClose,
  onDecided,
}: {
  request: TableRequest;
  branch: Branch;
  onClose: () => void;
  onDecided: (order?: Order) => void;
}) {
  const store = useAdminStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [later, setLater] = useState(false);
  const [decline, setDecline] = useState(false);
  const [attempt, setAttempt] = useState<Decision | null>(null);
  const saving = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  let totals: ReturnType<typeof getCartTotals> | null = null;
  let quoteError = '';
  try {
    if (!request.selections?.length)
      throw new Error('Refresh the request queue to review current item selections.');
    totals = getCartTotals(request.selections, store.products, branch.settings, '', 'dine_in');
    if (totals.total <= 0 || totals.total >= 5_000_000)
      throw new Error('This bill needs additional invoice details. Please speak to the owner.');
    if (
      request.selections.some((item) => {
        const product = store.products.find((p) => p.id === item.productId);
        return (
          !product ||
          product.archived ||
          !product.available ||
          store.categories.some((c) => c.id === product.categoryId && c.archived)
        );
      })
    )
      throw new Error(
        'An item is unavailable. Decline this request and ask the guest to choose again.',
      );
  } catch (cause) {
    quoteError = message(cause);
  }
  const paused =
    branch.settings.counterAcceptingOrders !== true ||
    branch.settings.temporarilyClosed ||
    !branch.settings.billing;
  const accept = async (payment: CounterPayment | null, retry?: Decision) => {
    if (saving.current || (!retry && (paused || quoteError || !totals))) return;
    const body = retry ?? {
      expectedRequestVersion: request.version,
      expectedRevision: store.shared.revision,
      expectedTotal: totals!.total,
      expectedRoundOffPolicy: 'nearest_rupee' as const,
      idempotencyKey: crypto.randomUUID(),
      payment,
      ...(payment === null ? { payLaterReason: reason.trim() } : {}),
    };
    if (!body.payment && (body.payLaterReason?.length ?? 0) < 3) {
      setError('Give a reason for the pay-later exception.');
      return;
    }
    saving.current = true;
    setBusy(true);
    setError('');
    setAttempt(body);
    try {
      const result = await commerceRequest<{ order: Order }>(
        `admin/table-requests/${request.id}/accept`,
        { method: 'POST', body },
      );
      if (!active.current) return;
      if (
        result.order.branchId !== branch.id ||
        result.order.counter?.sourceRequestId !== request.id
      )
        throw new Error('The saved order did not match this request. Refresh before continuing.');
      setAttempt(null);
      onDecided(result.order);
    } catch (cause) {
      if (active.current) {
        setError(message(cause));
        if (
          cause instanceof CommerceError &&
          [
            'invalid_request',
            'quote_changed',
            'revision_conflict',
            'request_expired',
            'request_decided',
            'counter_closed',
            'duplicate_upi_reference',
            'counter_cash_insufficient',
          ].includes(cause.code ?? '')
        ) {
          setAttempt(null);
          void store.shared.refresh();
        }
      }
    } finally {
      saving.current = false;
      if (active.current) setBusy(false);
    }
  };
  const reject = async () => {
    if (saving.current || attempt) return;
    saving.current = true;
    setBusy(true);
    try {
      await commerceRequest(`admin/table-requests/${request.id}/reject`, {
        method: 'POST',
        body: { expectedRequestVersion: request.version },
      });
      if (active.current) onDecided();
    } catch (cause) {
      if (active.current) setError(message(cause));
    } finally {
      saving.current = false;
      if (active.current) setBusy(false);
    }
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy && !attempt) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={counterStyles.overlay} />
        <Dialog.Content className={counterStyles.dialog}>
          <Dialog.Title>QR order · collect payment</Dialog.Title>
          <Dialog.Description>
            Confirm the items and current bill with the guest. Record actual payment, or use the
            explicit pay-later exception.
          </Dialog.Description>
          <button
            className={counterStyles.close}
            disabled={busy || !!attempt}
            aria-label="Close request"
            onClick={onClose}
          >
            <X size={20} />
          </button>
          <p>
            <b>{request.number}</b> · {request.customerName || 'Guest'}
          </p>
          {request.customerPhone && (
            <p>
              Mobile: <a href={`tel:+91${request.customerPhone}`}>{request.customerPhone}</a>
            </p>
          )}
          <ul>
            {request.items.map((item) => (
              <li key={item.id}>
                {item.quantity} × <strong>{item.name}</strong>
                <p>
                  {item.options.join(' · ')}
                  {item.notes && ` · Note: ${item.notes}`}
                </p>
              </li>
            ))}
          </ul>
          {request.notes && <p className={counterStyles.warning}>ORDER NOTE · {request.notes}</p>}
          {quoteError && (
            <p role="alert" className={counterStyles.error}>
              {quoteError}
            </p>
          )}
          {totals && (
            <>
              <AmountRows totals={totals} />
              {totals.total !== request.total && (
                <p className={counterStyles.warning}>
                  The menu price has changed from {money(request.total)}. Confirm the new total with
                  the guest before collecting payment.
                </p>
              )}
            </>
          )}
          {error && (
            <p role="alert" className={counterStyles.error}>
              {error}
            </p>
          )}
          {paused && (
            <p className={counterStyles.warning}>New dine-in orders are paused for this branch.</p>
          )}
          {attempt ? (
            <div className={counterStyles.warning}>
              <p>
                Confirmation is incomplete. Retry the same decision; do not collect or enter this
                payment again.
              </p>
              <button
                className="btn btn-dark"
                disabled={busy}
                onClick={() => void accept(attempt.payment, attempt)}
              >
                Retry same confirmation
              </button>
            </div>
          ) : (
            <>
              <PaymentFields
                key={`${store.shared.revision}:${totals?.total}`}
                total={totals?.total ?? 0}
                disabled={busy || paused || !!quoteError || !totals}
                label="Accept & send to kitchen"
                onPayment={(payment) => void accept(payment)}
              />
              <button
                className={counterStyles.textButton}
                disabled={busy || paused || !!quoteError}
                onClick={() => setLater(!later)}
              >
                Exception: send to Kitchen and pay later
              </button>
              {later && (
                <div className={counterStyles.warning}>
                  <label className={counterStyles.field}>
                    Reason for pay later
                    <textarea
                      value={reason}
                      maxLength={200}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                  <button
                    className="btn btn-dark"
                    disabled={busy || reason.trim().length < 3 || paused || !!quoteError}
                    onClick={() => void accept(null)}
                  >
                    Send unpaid order to Kitchen
                  </button>
                </div>
              )}
              <hr />
              {decline ? (
                <div className={counterStyles.warning}>
                  <p>Decline this request? It will not enter Kitchen.</p>
                  <button className="btn btn-outline" disabled={busy} onClick={() => void reject()}>
                    Confirm decline
                  </button>
                  <button className={counterStyles.textButton} onClick={() => setDecline(false)}>
                    Keep request
                  </button>
                </div>
              ) : (
                <button
                  className="btn btn-outline"
                  disabled={busy}
                  onClick={() => setDecline(true)}
                >
                  Decline request
                </button>
              )}
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
