'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Clock3,
  ImageOff,
  Minus,
  Plus,
  RefreshCw,
  ShoppingBag,
  X,
} from 'lucide-react';
import { commerceRequest, CommerceError } from '@/lib/commerce/client';
import { getCartTotals, getItemOptions, getUnitPrice } from '@/lib/pricing';
import { money } from '@/lib/utils';
import {
  addCounterDefault,
  counterDefaultQuantity,
  counterQuickPrice,
  removeCounterDefault,
} from '@/lib/counter-cart';
import Image from 'next/image';
import type { CartItem, Product, Order } from '@/types';
import type { TableContext, TableRequest } from '@/lib/table-ordering';
import { AmountRows, CustomizeItem } from './dine-in-controls';
import { RestaurantLogo } from './restaurant-logo';
import { useCustomerAuth } from './customer-auth-provider';
import { branchQrDraftKey } from '@/lib/customer-privacy';
import { startVisiblePolling } from '@/lib/visible-polling';
import styles from './dine-in-qr.module.css';

type Attempt = {
  paymentMethod?: 'upi' | 'card';
  items: CartItem[];
  customerName: string;
  customerPhone: string;
  notes?: string;
  expectedRevision: number;
  expectedTotal: number;
  expectedRoundOffPolicy: 'nearest_rupee';
  idempotencyKey: string;
};
const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : 'Could not connect. Please try again.';
const qrUnavailable = (cause: unknown) =>
  cause instanceof CommerceError && cause.status === 404 && cause.code === 'not_found';
const requestRemoved = (cause: unknown) =>
  cause instanceof CommerceError && cause.status === 410 && cause.code === 'request_removed';
const removedRequestMessage =
  'Your earlier software test request was removed. No payment is due for it. You can choose food and send a new order.';
const unavailableMessage =
  'This QR has been paused or replaced, or this request is no longer available. Ask staff to check your earlier request and show you the current QR before paying or ordering again.';

function QrFoodPhoto({ image, name }: Pick<Product, 'image' | 'name'>) {
  const [failed, setFailed] = useState(false);
  if (!image || failed)
    return (
      <div
        className={`${styles.productPhoto} ${styles.photoPlaceholder}`}
        role="img"
        aria-label={`${name} photo unavailable`}
      >
        <ImageOff size={24} aria-hidden="true" />
        <span>Photo unavailable</span>
      </div>
    );
  return (
    <div className={styles.productPhoto}>
      {image.startsWith('/') && !image.startsWith('//') ? (
        <Image
          src={image}
          alt={name}
          fill
          sizes="(max-width: 430px) 80px, 300px"
          unoptimized={image.endsWith('.svg')}
          onError={() => setFailed(true)}
        />
      ) : (
        <img
          src={image}
          alt={name}
          width={400}
          height={300}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

export function DineInQrPage({ token }: { token: string }) {
  const auth = useCustomerAuth();
  const [context, setContext] = useState<TableContext | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    if (!/^[a-f0-9]{64}$/.test(token)) {
      setError('This ordering link is invalid. Ask the counter for the current QR.');
      return;
    }
    void commerceRequest<TableContext>(`table/${token}`, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (
          !result.table ||
          !Array.isArray(result.catalog?.products) ||
          result.catalog.branches.length !== 1 ||
          result.catalog.branches[0].id !== result.table.branchId
        )
          throw new Error('This branch menu is incomplete. Please speak to the counter.');
        setContext(result);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(qrUnavailable(cause) ? unavailableMessage : message(cause));
      });
    return () => controller.abort();
  }, [token]);
  if (!context)
    return (
      <main className={styles.page}>
        <RestaurantLogo />
        <h1>Scan, order & pay at the counter</h1>
        <p role={error ? 'alert' : 'status'}>{error || 'Opening the branch menu…'}</p>
        {error && (
          <button className="btn btn-outline" onClick={() => window.location.reload()}>
            Try again
          </button>
        )}
      </main>
    );
  if (!auth.contextId)
    return (
      <main className={styles.page}>
        <RestaurantLogo />
        <p role={auth.error ? 'alert' : 'status'}>
          {auth.error || 'Checking this browser’s ordering session…'}
        </p>
        {auth.error && (
          <button className="btn btn-outline" onClick={() => void auth.refresh()}>
            Try again
          </button>
        )}
      </main>
    );
  return (
    <BranchQrMenu
      key={`${token}:${context.table.generation}:${auth.contextId}`}
      token={token}
      context={context}
      privacyContext={auth.contextId}
      privacyReady={!auth.loading && !auth.error}
      privacyError={auth.error}
      recheckPrivacy={auth.refresh}
    />
  );
}

function BranchQrMenu({
  token,
  context,
  privacyContext,
  privacyReady,
  privacyError,
  recheckPrivacy,
}: {
  token: string;
  context: TableContext;
  privacyContext: string;
  privacyReady: boolean;
  privacyError: string | null;
  recheckPrivacy: () => Promise<void>;
}) {
  const { table, catalog } = context;
  const branch = catalog.branches[0];
  const storageKey = branchQrDraftKey(privacyContext, token, table.generation);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [editing, setEditing] = useState<Product | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentChoice, setPaymentChoice] = useState<'counter' | 'upi' | 'card'>('counter');
  const onlineAvailable =
    catalog.payments?.enabled === true &&
    ((catalog.mode === 'development' && catalog.payments.mode === 'test') ||
      (catalog.mode === 'production' && catalog.payments.mode === 'live'));
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [request, setRequest] = useState<TableRequest | null>(null);
  const [onlineOrder, setOnlineOrder] = useState<Order | null>(null);
  const [loadingOnlineOrder, setLoadingOnlineOrder] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [restored, setRestored] = useState(false);
  const [recoveryId, setRecoveryId] = useState<string | null>(null);
  const [linkUnavailable, setLinkUnavailable] = useState(false);
  const [summaryElement, setSummaryElement] = useState<HTMLFormElement | null>(null);
  const [summaryVisible, setSummaryVisible] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  useEffect(() => {
    if (!sheetOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [sheetOpen]);
  const active = useRef(true);
  const saving = useRef(false);
  useEffect(() => {
    if (!summaryElement || typeof IntersectionObserver === 'undefined') return;
    let watching = true;
    const observer = new IntersectionObserver(([entry]) => {
      if (watching) setSummaryVisible(entry.isIntersecting);
    });
    observer.observe(summaryElement);
    return () => {
      watching = false;
      observer.disconnect();
    };
  }, [summaryElement]);
  const remember = (
    value: { requestId?: string; onlineOrderId?: string; attempt?: Attempt } | null,
  ) => {
    try {
      if (value) sessionStorage.setItem(storageKey, JSON.stringify(value));
      else sessionStorage.removeItem(storageKey);
    } catch {
      /* The in-memory retry remains available when browser storage is restricted. */
    }
  };
  const recoverRemovedRequest = useCallback(() => {
    // This component and its cache key belong only to the current branch QR
    // generation. The website cart and other branch QR attempts stay untouched.
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* In-memory recovery must also work when browser storage is restricted. */
    }
    setRequest(null);
    setRecoveryId(null);
    setAttempt(null);
    setCart([]);
    setEditing(null);
    setNotes('');
    setError(removedRequestMessage);
    toast.info(removedRequestMessage, { id: `removed-request:${storageKey}` });
  }, [storageKey]);
  useEffect(() => {
    if (!privacyReady) return;
    active.current = true;
    setBusy(saving.current);
    const controller = new AbortController();
    try {
      const legacyKey = `hpa-table-request:${token}:${table.generation}`;
      const scoped = sessionStorage.getItem(storageKey);
      const legacy = scoped === null ? sessionStorage.getItem(legacyKey) : null;
      const saved = JSON.parse(scoped ?? legacy ?? 'null');
      if (saved?.onlineOrderId && /^[a-f0-9-]{36}$/.test(saved.onlineOrderId)) {
        setLoadingOnlineOrder(true);
        void commerceRequest<{ order: Order }>(`orders/${saved.onlineOrderId}`, {
          signal: controller.signal,
        })
          .then((result) => {
            if (!active.current || controller.signal.aborted) return;
            setOnlineOrder(result.order);
            setLoadingOnlineOrder(false);
          })
          .catch((cause) => {
            if (active.current && !controller.signal.aborted) setError(message(cause));
          });
      } else if (saved?.requestId && /^[a-f0-9-]{36}$/.test(saved.requestId)) {
        setRecoveryId(saved.requestId);
        void commerceRequest<{ request: TableRequest }>(
          `table/${token}/requests/${saved.requestId}`,
          { signal: controller.signal },
        )
          .then((result) => {
            if (active.current && !controller.signal.aborted) {
              setRequest(result.request);
              setRecoveryId(null);
              if (legacy !== null) {
                // A legacy request ID is migrated only after the current browser
                // capability independently authorizes its server-side receipt.
                try {
                  sessionStorage.setItem(
                    storageKey,
                    JSON.stringify({ requestId: result.request.id }),
                  );
                  sessionStorage.removeItem(legacyKey);
                } catch {
                  // The verified in-memory receipt remains usable without storage.
                }
              }
            }
          })
          .catch((cause) => {
            if (active.current && !controller.signal.aborted) {
              if (requestRemoved(cause)) {
                recoverRemovedRequest();
              } else if (qrUnavailable(cause)) {
                setLinkUnavailable(true);
                setRecoveryId(null);
                setError(unavailableMessage);
              } else setError(message(cause));
            }
          });
      } else if (
        legacy === null &&
        saved?.attempt &&
        typeof saved.attempt.idempotencyKey === 'string' &&
        Array.isArray(saved.attempt.items)
      )
        setAttempt(saved.attempt);
      else if (legacy !== null && saved?.attempt) {
        // An unsent legacy draft cannot establish who now owns this browser.
        sessionStorage.removeItem(legacyKey);
        setError(
          'Your earlier ordering session changed. Ask the counter to check for an existing request before ordering again.',
        );
      }
    } catch {
      /* An invalid local cache never grants order or payment access. */
    }
    setRestored(true);
    return () => {
      active.current = false;
      controller.abort();
    };
  }, [storageKey, token, table.generation, recoverRemovedRequest, privacyReady]);
  const requestId = request?.id;
  const requestStatus = request?.status;
  useEffect(() => {
    if (!privacyReady || !requestId || requestStatus !== 'pending' || linkUnavailable) return;
    const controller = new AbortController();
    let reading = false;
    const refresh = async () => {
      if (reading) return;
      reading = true;
      try {
        const result = await commerceRequest<{ request: TableRequest }>(
          `table/${token}/requests/${requestId}`,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) {
          setRequest(result.request);
          setError('');
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          if (requestRemoved(cause)) {
            controller.abort();
            recoverRemovedRequest();
          } else if (qrUnavailable(cause)) {
            setLinkUnavailable(true);
            setEditing(null);
            setRequest((current) =>
              current?.status === 'pending' ? { ...current, status: 'expired' } : current,
            );
            setError(unavailableMessage);
          } else setError(message(cause));
        }
      } finally {
        reading = false;
      }
    };
    const stopPolling = startVisiblePolling({
      refresh,
      intervalMs: 10000,
      immediate: false,
      canRefresh: () => !controller.signal.aborted,
    });
    return () => {
      stopPolling();
      controller.abort();
    };
  }, [token, requestId, requestStatus, linkUnavailable, recoverRemovedRequest, privacyReady]);
  let totals: ReturnType<typeof getCartTotals> | null = null;
  let priceError = '';
  try {
    totals = getCartTotals(cart, catalog.products, branch.settings, '', 'dine_in');
  } catch (cause) {
    priceError = message(cause);
  }
  const open =
    privacyReady &&
    !linkUnavailable &&
    branch.settings.counterAcceptingOrders === true &&
    !branch.settings.temporarilyClosed &&
    !!branch.settings.billing;
  const products = catalog.products.filter(
    (product) =>
      product.available &&
      !product.archived &&
      !catalog.categories.some((c) => c.id === product.categoryId && c.archived) &&
      (category === 'all' || category === product.categoryId) &&
      product.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const submit = async (retry?: Attempt) => {
    if (
      saving.current ||
      !privacyReady ||
      linkUnavailable ||
      (!retry && (!open || !cart.length || priceError || !restored))
    )
      return;
    if (!retry && (name.trim().length < 2 || !/^[6-9]\d{9}$/.test(phone))) {
      setError(
        'Enter your name and a valid 10-digit mobile number so staff can identify your order.',
      );
      return;
    }
    saving.current = true;
    setBusy(true);
    setError('');
    const body = retry ?? {
      ...(paymentChoice === 'counter' ? {} : { paymentMethod: paymentChoice }),
      items: structuredClone(cart),
      customerName: name.trim(),
      customerPhone: phone,
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      expectedRevision: catalog.revision,
      expectedTotal: totals!.total,
      expectedRoundOffPolicy: 'nearest_rupee' as const,
      idempotencyKey: crypto.randomUUID(),
    };
    setAttempt(body);
    remember({ attempt: body });
    try {
      if (body.paymentMethod) {
        const result = await commerceRequest<{ order: Order }>(`table/${token}/online-order`, {
          method: 'POST',
          body,
        });
        if (!active.current) return;
        setOnlineOrder(result.order);
        setAttempt(null);
        setCart([]);
        remember({ onlineOrderId: result.order.id });
        // Keep the private order ID for back-navigation without duplicating checkout.
        window.location.assign(
          result.order.trackingUrl ?? `/track-order?order=${encodeURIComponent(result.order.id)}`,
        );
        return;
      }
      const result = await commerceRequest<{ request: TableRequest }>(`table/${token}/requests`, {
        method: 'POST',
        body,
      });
      if (!active.current) return;
      setRequest(result.request);
      setAttempt(null);
      setCart([]);
      remember({ requestId: result.request.id });
    } catch (cause) {
      if (!active.current) return;
      if (requestRemoved(cause)) {
        recoverRemovedRequest();
        return;
      }
      if (qrUnavailable(cause)) {
        setLinkUnavailable(true);
        setEditing(null);
        setError(unavailableMessage);
        return;
      }
      setError(message(cause));
      if (
        cause instanceof CommerceError &&
        ['invalid_request', 'quote_changed', 'revision_conflict', 'counter_closed'].includes(
          cause.code ?? '',
        )
      ) {
        setAttempt(null);
        remember(null);
      }
    } finally {
      saving.current = false;
      if (active.current) setBusy(false);
    }
  };
  const startAnother = async () => {
    if (saving.current || !privacyReady || linkUnavailable) return;
    saving.current = true;
    setBusy(true);
    try {
      const current = await commerceRequest<TableContext>(`table/${token}`);
      if (!active.current) return;
      if (
        current.table?.branchId !== table.branchId ||
        current.table.generation !== table.generation
      )
        throw new CommerceError('This ordering QR has changed.', 404, 'not_found');
      remember(null);
      // Reopen against the current menu and branch state, retaining this receipt on any failure.
      window.location.reload();
    } catch (cause) {
      if (!active.current) return;
      if (qrUnavailable(cause)) {
        setLinkUnavailable(true);
        setError(unavailableMessage);
      } else setError(message(cause));
    } finally {
      saving.current = false;
      if (active.current) setBusy(false);
    }
  };
  if (!privacyReady)
    return (
      <main className={styles.page}>
        <RestaurantLogo />
        <p role={privacyError ? 'alert' : 'status'}>
          {privacyError || 'Checking this browser’s ordering session…'}
        </p>
        {privacyError && (
          <button className="btn btn-outline" onClick={() => void recheckPrivacy()}>
            Try again
          </button>
        )}
      </main>
    );
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <RestaurantLogo />
        <div>
          <span>ORDER AT THE RESTAURANT · {table.branchName}</span>
          <h1>Choose your food</h1>
          <p>Choose your food, add your name and mobile number, then choose how to pay.</p>
        </div>
      </header>
      {catalog.mode === 'development' && (
        <p className={styles.warning}>TEST ORDERING · No real food or payment.</p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {loadingOnlineOrder ? (
        <section className={styles.receipt}>
          <h2>Checking your earlier online order</h2>
          <p>Keep this order while we check its status to avoid duplicate payment.</p>
          {error && (
            <button className="btn btn-outline" onClick={() => window.location.reload()}>
              Retry status check
            </button>
          )}
        </section>
      ) : onlineOrder ? (
        <section className={styles.receipt}>
          <h2>Order #{onlineOrder.number}</h2>
          <p>Open your secure order page to pay or check payment and preparation status.</p>
          <a
            className="btn btn-primary"
            href={
              onlineOrder.trackingUrl ?? `/track-order?order=${encodeURIComponent(onlineOrder.id)}`
            }
          >
            Payment &amp; order status
          </a>
          {['paid', 'simulated_paid'].includes(onlineOrder.paymentStatus) ||
          ['cancelled', 'rejected', 'closed', 'served'].includes(onlineOrder.status) ? (
            <button
              className="btn btn-outline"
              onClick={() => {
                setOnlineOrder(null);
                setAttempt(null);
                remember(null);
              }}
            >
              Start another order
            </button>
          ) : (
            <p>Complete or cancel this payment attempt before starting another order.</p>
          )}
        </section>
      ) : linkUnavailable && !request ? (
        <section className={styles.receipt}>
          <h2>Ask the counter for the current QR</h2>
          <p>
            This page can no longer confirm your request. Show staff your name and mobile number so
            they can check it before you pay or send another order.
          </p>
        </section>
      ) : recoveryId && !request ? (
        <section className={styles.receipt}>
          <h2>Checking your earlier request</h2>
          <p>
            Keep this page open. Please refresh to recover its status before placing another
            request.
          </p>
          <button className="btn btn-outline" onClick={() => window.location.reload()}>
            Refresh request status
          </button>
        </section>
      ) : request ? (
        <section className={styles.receipt}>
          {request.status === 'accepted' ? <CheckCircle2 size={36} /> : <Clock3 size={36} />}
          <h2>
            {request.status === 'accepted'
              ? 'Your order is accepted'
              : request.status === 'pending'
                ? 'Request sent · pay at the counter'
                : request.status === 'rejected'
                  ? 'Staff declined this request'
                  : linkUnavailable
                    ? 'This request is no longer available'
                    : 'This request has expired'}
          </h2>
          <strong>{request.number}</strong>
          <p>
            {request.acceptedOrderNumber
              ? `Order ${request.acceptedOrderNumber}`
              : request.status === 'pending'
                ? 'Show this request number at the counter. Your food enters the kitchen after staff confirms payment.'
                : linkUnavailable
                  ? 'This page can no longer confirm this request. Ask staff to check it before you pay or place another order.'
                  : 'This request has not entered the kitchen. Speak to the counter before placing another order.'}
          </p>
          <ul className={styles.list}>
            {request.items.map((item) => (
              <li key={item.id}>
                <span>
                  {item.quantity} × {item.name}
                  <small>{item.options.join(' · ')}</small>
                </span>
                <b>{money(item.unitPrice * item.quantity)}</b>
              </li>
            ))}
          </ul>
          <AmountRows totals={{ ...request, deliveryFee: 0, discount: 0 }} />
          <p>
            {request.status === 'accepted'
              ? 'Keep your order number for collection. Restaurant staff can confirm your payment and preparation status.'
              : request.status === 'pending'
                ? 'Pay at the counter with cash or the restaurant’s merchant UPI QR. Staff confirm payment before your food is prepared.'
                : 'Do not pay against this request. Staff can help you place a new order.'}
          </p>
          {request.status === 'pending' ? (
            <p>Requests expire after 30 minutes. Keep this page to see the result.</p>
          ) : !linkUnavailable ? (
            <button className="btn btn-outline" disabled={busy} onClick={() => void startAnother()}>
              {busy ? 'Checking current QR…' : 'Start another request'}
            </button>
          ) : null}
        </section>
      ) : attempt ? (
        <section className={styles.receipt}>
          <h2>Checking your request</h2>
          <p>Keep this page open. Retry the same request to avoid submitting your items twice.</p>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit(attempt)}>
            <RefreshCw size={18} />
            {busy ? 'Sending…' : 'Retry same request'}
          </button>
        </section>
      ) : (
        <>
          {!open && (
            <p className={styles.warning}>QR ordering is paused. Please order with staff.</p>
          )}
          <div className={styles.layout}>
            <section>
              <div className={styles.tools}>
                <label>
                  <span className={styles.visuallyHidden}>Search menu</span>
                  <input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Pizza, pasta, sides…"
                  />
                </label>
                <nav className={styles.categories} aria-label="Menu categories">
                  <button aria-pressed={category === 'all'} onClick={() => setCategory('all')}>
                    All
                  </button>
                  {catalog.categories
                    .filter((c) => !c.archived)
                    .sort((a, b) => a.sortOrder - b.sortOrder)
                    .map((c) => (
                      <button
                        key={c.id}
                        aria-pressed={category === c.id}
                        onClick={() => setCategory(c.id)}
                      >
                        {c.name}
                      </button>
                    ))}
                </nav>
              </div>
              <div className={styles.products}>
                {products.map((product) => {
                  const price = counterQuickPrice(product);
                  const quantity = counterDefaultQuantity(cart, product);
                  return (
                    <article key={product.id}>
                      <div className={styles.productOverview}>
                        <QrFoodPhoto
                          key={product.image}
                          image={product.image}
                          name={product.name}
                        />
                        <div className={styles.productDetails}>
                          <strong>{product.name}</strong>
                          <small>{product.description}</small>
                          <span className={styles.productPrice}>
                            {price === null ? 'Choose options' : money(price)}
                          </span>
                        </div>
                      </div>
                      <div className={styles.productActions}>
                        {quantity > 0 ? (
                          <div
                            className={styles.stepper}
                            role="group"
                            aria-label={`${product.name} quantity`}
                          >
                            <button
                              type="button"
                              aria-label={`Remove one ${product.name}`}
                              disabled={busy}
                              onClick={() =>
                                setCart((current) => removeCounterDefault(current, product))
                              }
                            >
                              <Minus size={17} />
                            </button>
                            <output aria-live="polite">{quantity}</output>
                            <button
                              type="button"
                              aria-label={`Add one more ${product.name}`}
                              disabled={!open || busy || quantity >= 20}
                              onClick={() => {
                                const id = crypto.randomUUID();
                                setCart((current) => addCounterDefault(current, product, id));
                              }}
                            >
                              <Plus size={17} />
                            </button>
                          </div>
                        ) : (
                          <button
                            className={styles.add}
                            disabled={!open || busy || price === null || cart.length >= 50}
                            aria-label={`Add ${product.name}`}
                            onClick={() => {
                              const id = crypto.randomUUID();
                              setCart((current) => addCounterDefault(current, product, id));
                            }}
                          >
                            <Plus size={17} /> Add
                          </button>
                        )}
                        <button
                          className={styles.customize}
                          aria-label={`Customize ${product.name}`}
                          disabled={!open || busy || cart.length >= 50}
                          onClick={() => setEditing(product)}
                        >
                          Customize
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
              {!products.length && <p>No matching items.</p>}
            </section>
            <form
              id="qr-order-details"
              ref={setSummaryElement}
              className={`${styles.summary} ${sheetOpen ? styles.sheetOpen : ''}`}
              aria-label="Your order"
              onKeyDown={(event) => {
                if (event.key === 'Escape') setSheetOpen(false);
              }}
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <h2>
                <ShoppingBag size={21} /> Your order
                <button
                  type="button"
                  className={styles.sheetClose}
                  aria-label="Back to menu"
                  onClick={() => setSheetOpen(false)}
                >
                  <X size={20} />
                </button>
              </h2>
              {!cart.length && <p>Add your food from the menu. Customize only if you need to.</p>}
              <ul className={styles.list}>
                {cart.map((item) => {
                  const product = catalog.products.find((p) => p.id === item.productId)!;
                  return (
                    <li key={item.id}>
                      <span>
                        <strong>
                          {item.quantity} × {product.name}
                        </strong>
                        <small>{getItemOptions(product, item).join(' · ')}</small>
                        {item.notes && <small>Note: {item.notes}</small>}
                        <div className={styles.quantity}>
                          <button
                            type="button"
                            aria-label={`Reduce ${product.name} quantity`}
                            disabled={busy}
                            onClick={() =>
                              setCart((current) =>
                                current.flatMap((line) =>
                                  line.id !== item.id
                                    ? [line]
                                    : line.quantity > 1
                                      ? [{ ...line, quantity: line.quantity - 1 }]
                                      : [],
                                ),
                              )
                            }
                          >
                            <Minus size={14} />
                          </button>
                          <output aria-label={`${product.name} quantity`}>{item.quantity}</output>
                          <button
                            type="button"
                            aria-label={`Increase ${product.name} quantity`}
                            disabled={busy || item.quantity >= 20}
                            onClick={() =>
                              setCart((current) =>
                                current.map((line) =>
                                  line.id === item.id
                                    ? { ...line, quantity: Math.min(20, line.quantity + 1) }
                                    : line,
                                ),
                              )
                            }
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                      </span>
                      <b>{money(getUnitPrice(product, item) * item.quantity)}</b>
                    </li>
                  );
                })}
              </ul>
              <label>
                Your name
                <input
                  name="customerName"
                  autoComplete="name"
                  value={name}
                  minLength={2}
                  maxLength={80}
                  required
                  placeholder="Name for your order"
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label>
                Mobile number
                <div className={styles.phone}>
                  <span>+91</span>
                  <input
                    name="customerPhone"
                    aria-label="Mobile number"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    value={phone}
                    pattern="[6-9][0-9]{9}"
                    maxLength={16}
                    required
                    placeholder="10-digit mobile number"
                    onChange={(event) => {
                      const digits = event.target.value.replace(/\D/g, '');
                      setPhone(
                        digits.length === 12 && digits.startsWith('91')
                          ? digits.slice(2)
                          : digits.slice(0, 10),
                      );
                    }}
                  />
                </div>
              </label>
              <p className={styles.small}>
                We use your name and mobile number to identify this order at the counter.
              </p>
              <label>
                Preparation note · optional
                <textarea
                  value={notes}
                  maxLength={300}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={2}
                />
              </label>
              {priceError && (
                <p role="alert" className={styles.error}>
                  {priceError}
                </p>
              )}
              {totals && <AmountRows totals={totals} />}
              <label>
                Payment option
                <select
                  aria-label="Payment option"
                  value={paymentChoice}
                  disabled={busy}
                  onChange={(event) =>
                    setPaymentChoice(event.target.value as 'counter' | 'upi' | 'card')
                  }
                >
                  <option value="counter">Pay at counter</option>
                  {onlineAvailable && <option value="upi">Pay online · UPI</option>}
                  {onlineAvailable && <option value="card">Pay online · Card</option>}
                </select>
              </label>
              {!onlineAvailable && (
                <p className={styles.small}>
                  Online payment is currently unavailable. You can pay at the counter.
                </p>
              )}

              <button
                className="btn btn-primary"
                disabled={!open || !cart.length || busy || !!priceError || !restored}
                type="submit"
              >
                {busy
                  ? 'Sending…'
                  : paymentChoice === 'counter'
                    ? 'Send order · pay at counter'
                    : 'Continue to secure payment'}
              </button>
              <p className={styles.small}>
                Online payments are verified securely before the counter accepts your order.
                Pay-at-counter requests are confirmed by staff. No delivery fee or minimum order.
              </p>
            </form>
          </div>
          {sheetOpen && (
            <button
              type="button"
              className={styles.sheetBackdrop}
              aria-label="Close order review"
              onClick={() => setSheetOpen(false)}
            />
          )}
          {cart.length > 0 && totals && !summaryVisible && !sheetOpen && (
            <button
              type="button"
              className={styles.mobileReview}
              onClick={() => setSheetOpen(true)}
            >
              <span>
                {(() => {
                  const count = cart.reduce((sum, item) => sum + item.quantity, 0);
                  return `${count} ${count === 1 ? 'item' : 'items'} · ${money(totals.total)}`;
                })()}
              </span>
              Review order →
            </button>
          )}
        </>
      )}
      {editing && (
        <CustomizeItem
          product={editing}
          onClose={() => setEditing(null)}
          onSave={(selection) =>
            setCart((current) => [...current, { ...selection, id: crypto.randomUUID() }])
          }
        />
      )}
      <footer className={styles.footer}>
        <a href="/privacy-policy">Privacy</a>
        <a href="/terms-and-conditions">Terms</a>
        <span>HOT PIZZA ACE · Scan & order</span>
      </footer>
    </main>
  );
}
