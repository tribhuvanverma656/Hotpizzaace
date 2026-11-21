'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Banknote,
  ChefHat,
  Minus,
  Plus,
  RefreshCw,
  Search,
  Truck,
  Utensils,
  X,
} from 'lucide-react';
import {
  AmountRows,
  PaymentFields,
  CustomizeItem,
  type CounterPayment,
} from '@/components/dine-in-controls';
import { TableRequestQueue } from './table-request-queue';
import { useAdminStore } from './use-admin-store';
import { OrderBill } from '@/components/order-bill';
import { CommerceError, commerceRequest } from '@/lib/commerce/client';
import {
  getCartTotals,
  getItemOptions,
  getMinimumOrderShortfall,
  getUnitPrice,
} from '@/lib/pricing';
import { isStaffCounterPaymentComplete } from '@/lib/payments/counter';
import { money } from '@/lib/utils';
import { readCounterDraft, writeCounterDraft } from '@/lib/counter-draft';
import { startVisiblePolling } from '@/lib/visible-polling';
import {
  addCounterDefault,
  counterDefaultQuantity,
  counterDefaultSelection,
  counterQuickPrice,
} from '@/lib/counter-cart';
import type { Branch, CartItem, Order, Product } from '@/types';
import styles from './counter.module.css';

type CounterFulfillment = 'dine_in' | 'delivery';
type DeliveryAddress = {
  address: string;
  locality: string;
  postalCode: string;
  landmark?: string;
  instructions?: string;
};
type CreateRequest = {
  branchId: string;
  fulfillment: CounterFulfillment;
  items: CartItem[];
  customerName?: string;
  customerPhone?: string;
  tableLabel?: string;
  deliveryAddress?: DeliveryAddress;
  coupon: '';
  expectedRevision: number;
  expectedTotal: number;
  expectedRoundOffPolicy: 'nearest_rupee';
  idempotencyKey: string;
  payment: CounterPayment | null;
  payLaterReason?: string;
};
type CounterResult = { order: Order; replayed?: boolean };
type OutstandingResult = { orders: Order[]; hasMore: boolean; nextCursor: string | null };
type SettlementAttempt = {
  orderId: string;
  expectedVersion: number;
  idempotencyKey: string;
  payment: CounterPayment;
};
type CounterDraft = {
  cart: CartItem[];
  fulfillment: CounterFulfillment;
  deliveryAddress: DeliveryAddress;
  customerName: string;
  customerPhone: string;
  tableLabel: string;
  selected: Order | null;
  collecting: boolean;
  showPayLater: boolean;
  payLaterReason: string;
  createAttempt: CreateRequest | null;
  settleAttempt: SettlementAttempt | null;
};
const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : 'The counter could not connect. Please try again.';
const labels: Record<string, string> = {
  confirmed: 'In kitchen queue',
  preparing: 'Preparing',
  ready: 'Ready to serve',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  served: 'Served',
  closed: 'Closed',
  cancelled: 'Cancelled',
};
const isBranchCounterOrder = (order: Order, branchId: string) =>
  order.branchId === branchId &&
  order.channel === 'counter' &&
  order.paymentMode === 'counter_manual' &&
  !order.testVoid &&
  (order.fulfillment === 'dine_in' || order.fulfillment === 'delivery');
const orderStatusLabel = (order: Order) =>
  order.fulfillment === 'delivery' && order.status === 'ready'
    ? 'Ready for delivery'
    : (labels[order.status] ?? order.status);
const emptyDeliveryAddress = (): DeliveryAddress => ({ address: '', locality: '', postalCode: '' });
const completedStatuses = ['cancelled', 'closed', 'delivered'];
const automaticPaymentPages = 3;
const latestCounterOrders = (...groups: Order[][]) => {
  const latest = new Map<string, Order>();
  for (const order of groups.flat()) {
    const current = latest.get(order.id);
    if (!current || (order.version ?? 0) >= (current.version ?? 0)) latest.set(order.id, order);
  }
  return [...latest.values()];
};
const canCollectCounterPayment = (order: Order) =>
  order.channel === 'counter' &&
  order.paymentMode === 'counter_manual' &&
  (order.fulfillment === 'dine_in' || order.fulfillment === 'delivery') &&
  order.paymentStatus === 'pending' &&
  !order.settlement &&
  !order.testVoid &&
  !order.paymentReviewRequired &&
  ['confirmed', 'preparing', 'ready', 'served'].includes(order.status);

export function CounterOrderCards({
  orders,
  disabled,
  onOpen,
}: {
  orders: Order[];
  disabled: boolean;
  onOpen: (order: Order, collectPayment: boolean) => void;
}) {
  return (
    <div className={styles.orderGrid}>
      {orders.map((order) => (
        <article key={order.id} className={styles.orderCard}>
          <button
            className={styles.orderSummary}
            disabled={disabled}
            aria-label={`View bill for ${order.number}`}
            onClick={() => onOpen(order, false)}
          >
            <div>
              <strong>{order.number}</strong>
              <span className={order.paymentStatus === 'paid' ? styles.paid : styles.unpaid}>
                {order.paymentStatus === 'paid' ? 'PAID' : 'UNPAID'}
              </span>
            </div>
            <p>
              {order.counter?.tableLabel ? `${order.counter.tableLabel} · ` : ''}
              {order.customer.name}
            </p>
            <div>
              <span>{orderStatusLabel(order)}</span>
              <b>{money(order.total)}</b>
            </div>
            <small>
              {order.fulfillment === 'delivery' ? 'Home delivery' : 'Dine-in'} ·{' '}
              {new Date(order.createdAt).toLocaleString('en-IN', {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'Asia/Kolkata',
              })}{' '}
              · {order.items.reduce((sum, item) => sum + item.quantity, 0)} items
            </small>
          </button>
          {canCollectCounterPayment(order) && (
            <button
              className={`${styles.primary} ${styles.collectPayment}`}
              disabled={disabled}
              onClick={() => onOpen(order, true)}
              aria-label={`Collect payment for ${order.number}`}
            >
              <Banknote size={17} /> Collect payment · {money(order.total)}
            </button>
          )}
        </article>
      ))}
    </div>
  );
}

/** Kept outside the customer cart; remounting on account/branch changes clears all private state. */
function CounterWorkspace({ branch, ownerId }: { branch: Branch; ownerId: string }) {
  const store = useAdminStore();
  const draftKey = `${ownerId}:${branch.id}`;
  const [initial] = useState(() => readCounterDraft<CounterDraft>(draftKey));
  const [search, setSearch] = useState('');
  const [orderFilter, setOrderFilter] = useState<'all' | 'unpaid'>('all');
  const [orderSearch, setOrderSearch] = useState('');
  const orderList = useRef<HTMLElement | null>(null);
  const [category, setCategory] = useState('all');
  const [cart, setCart] = useState<CartItem[]>(initial?.cart ?? []);
  const [fulfillment, setFulfillment] = useState<CounterFulfillment>(
    initial?.fulfillment === 'delivery' ? 'delivery' : 'dine_in',
  );
  const [deliveryAddress, setDeliveryAddress] = useState<DeliveryAddress>(
    initial?.deliveryAddress ?? emptyDeliveryAddress(),
  );
  const [customerName, setCustomerName] = useState(initial?.customerName ?? '');
  const [customerPhone, setCustomerPhone] = useState(initial?.customerPhone ?? '');
  const [tableLabel, setTableLabel] = useState(initial?.tableLabel ?? '');
  const [editing, setEditing] = useState<{ product: Product; item?: CartItem } | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [outstandingOrders, setOutstandingOrders] = useState<Order[]>([]);
  const [outstandingCursor, setOutstandingCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const outstandingPages = useRef(1);
  const [outstandingPageCount, setOutstandingPageCount] = useState(1);
  const readingMore = useRef(false);
  const [ordersError, setOrdersError] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Order | null>(initial?.selected ?? null);
  const [collecting, setCollecting] = useState(initial?.collecting ?? false);
  const [showPayLater, setShowPayLater] = useState(initial?.showPayLater ?? false);
  const [payLaterReason, setPayLaterReason] = useState(initial?.payLaterReason ?? '');
  const [notice, setNotice] = useState('');
  const [lastPlacedId, setLastPlacedId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [createAttempt, setCreateAttempt] = useState<CreateRequest | null>(
    initial?.createAttempt ?? null,
  );
  const [settleAttempt, setSettleAttempt] = useState<SettlementAttempt | null>(
    initial?.settleAttempt ?? null,
  );
  /** Phones show the bill as a sheet over the menu; wider screens keep the side column. */
  const [billOpen, setBillOpen] = useState(false);
  const draft = {
    cart,
    fulfillment,
    deliveryAddress,
    customerName,
    customerPhone,
    tableLabel,
    selected,
    collecting,
    showPayLater,
    payLaterReason,
    createAttempt,
    settleAttempt,
  };
  useEffect(() => {
    writeCounterDraft(draftKey, {
      cart,
      fulfillment,
      deliveryAddress,
      customerName,
      customerPhone,
      tableLabel,
      selected,
      collecting,
      showPayLater,
      payLaterReason,
      createAttempt,
      settleAttempt,
    });
  }, [
    draftKey,
    cart,
    fulfillment,
    deliveryAddress,
    customerName,
    customerPhone,
    tableLabel,
    selected,
    collecting,
    showPayLater,
    payLaterReason,
    createAttempt,
    settleAttempt,
  ]);
  const active = useRef(true);
  const mutation = useRef(false);
  const readVersion = useRef(0);
  const refreshController = useRef<AbortController | null>(null);
  const refresh = useCallback(
    async (signal?: AbortSignal, resetPages = false) => {
      refreshController.current?.abort();
      const controller = new AbortController();
      refreshController.current = controller;
      const cancel = () => controller.abort();
      if (signal?.aborted) cancel();
      else signal?.addEventListener('abort', cancel, { once: true });
      const readSignal = controller.signal;
      const version = ++readVersion.current;
      try {
        const pageCount = resetPages ? 1 : outstandingPages.current;
        const [result, firstOutstanding] = await Promise.all([
          commerceRequest<{ orders: Order[]; hasMore: boolean }>(
            `admin/counter/${encodeURIComponent(branch.id)}`,
            { signal: readSignal },
          ),
          commerceRequest<OutstandingResult>(
            `admin/counter/${encodeURIComponent(branch.id)}/awaiting-payment/start`,
            { signal: readSignal },
          ),
        ]);
        if (!active.current || version !== readVersion.current || readSignal.aborted) return;
        let outstanding = firstOutstanding;
        let loadedPages = 1;
        const outstandingRows = [...outstanding.orders];
        for (let page = 1; page < pageCount && outstanding.nextCursor; page += 1) {
          if (!active.current || version !== readVersion.current || readSignal.aborted) return;
          outstanding = await commerceRequest<OutstandingResult>(
            `admin/counter/${encodeURIComponent(branch.id)}/awaiting-payment/${encodeURIComponent(outstanding.nextCursor)}`,
            { signal: readSignal },
          );
          if (!active.current || version !== readVersion.current || readSignal.aborted) return;
          outstandingRows.push(...outstanding.orders);
          loadedPages += 1;
        }
        if (!active.current || version !== readVersion.current) return;
        if (
          !Array.isArray(result.orders) ||
          result.orders.some((order) => !isBranchCounterOrder(order, branch.id)) ||
          outstandingRows.some(
            (order) => !isBranchCounterOrder(order, branch.id) || !canCollectCounterPayment(order),
          )
        )
          throw new Error('The counter returned an unexpected branch. Refresh before continuing.');
        setOrders(result.orders);
        setOutstandingOrders([
          ...new Map(outstandingRows.map((order) => [order.id, order])).values(),
        ]);
        setOutstandingCursor(outstanding.hasMore ? outstanding.nextCursor : null);
        outstandingPages.current = loadedPages;
        setOutstandingPageCount(loadedPages);
        setHasMore(result.hasMore === true);
        setOrdersError('');
        setSelected((current) =>
          current
            ? (latestCounterOrders([current], outstandingRows, result.orders).find(
                (order) => order.id === current.id,
              ) ?? current)
            : null,
        );
      } catch (cause) {
        if (active.current && version === readVersion.current && !readSignal.aborted)
          setOrdersError(errorMessage(cause));
      } finally {
        signal?.removeEventListener('abort', cancel);
        if (refreshController.current === controller) refreshController.current = null;
        if (active.current && version === readVersion.current) setLoading(false);
      }
    },
    [branch.id],
  );
  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    const stopPolling = startVisiblePolling({
      refresh: () => refresh(controller.signal),
      intervalMs: 10000,
      canRefresh: () =>
        !mutation.current &&
        !readingMore.current &&
        (!refreshController.current || refreshController.current.signal.aborted) &&
        outstandingPages.current <= automaticPaymentPages,
    });
    return () => {
      active.current = false;
      stopPolling();
      controller.abort();
      refreshController.current?.abort();
    };
  }, [refresh]);

  const available = store.products.filter(
    (product) =>
      product.available &&
      !product.archived &&
      !store.categories.some((item) => item.id === product.categoryId && item.archived),
  );
  const visible = available.filter(
    (product) =>
      (category === 'all' || product.categoryId === category) &&
      `${product.name} ${product.description}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  let totals: ReturnType<typeof getCartTotals> | null = null;
  let cartError = '';
  try {
    totals = getCartTotals(cart, store.products, branch.settings, '', fulfillment);
  } catch (cause) {
    cartError = errorMessage(cause);
  }
  const counterOpen =
    branch.settings.counterAcceptingOrders === true && !branch.settings.temporarilyClosed;
  let deliveryIssue = '';
  if (fulfillment === 'delivery') {
    if (!branch.settings.deliveryEnabled)
      deliveryIssue = 'Home delivery is disabled for this branch.';
    else if (customerName.trim().length < 2)
      deliveryIssue = 'Enter the customer’s name for delivery.';
    else if (!/^[6-9]\d{9}$/.test(customerPhone.trim()))
      deliveryIssue = 'Enter a valid 10-digit Indian mobile number for delivery.';
    else if (deliveryAddress.address.trim().length < 8)
      deliveryIssue = 'Enter the complete delivery address (at least 8 characters).';
    else if (deliveryAddress.locality.trim().length < 2)
      deliveryIssue = 'Enter the delivery locality.';
    else if (!/^[1-9]\d{5}$/.test(deliveryAddress.postalCode))
      deliveryIssue = 'Enter a valid 6-digit delivery PIN code.';
    else if (!branch.settings.servicePostalCodes.includes(deliveryAddress.postalCode))
      deliveryIssue = 'This PIN code is outside this branch’s delivery area.';
    else if (
      cart.length &&
      totals &&
      getMinimumOrderShortfall(totals.total, branch.settings, 'delivery') > 0
    )
      deliveryIssue = `Add ${money(getMinimumOrderShortfall(totals.total, branch.settings, 'delivery'))} to meet the ${money(branch.settings.minimumOrder)} delivery minimum, including delivery and GST.`;
  }
  const canCreate =
    counterOpen &&
    !!branch.settings.billing &&
    cart.length > 0 &&
    !!totals &&
    !cartError &&
    !deliveryIssue &&
    totals.total > 0 &&
    totals.total < 5_000_000 &&
    !busy &&
    !createAttempt &&
    store.shared.ready &&
    !store.shared.error;
  const allOrders = latestCounterOrders(orders, outstandingOrders);
  const outstandingIds = new Set(outstandingOrders.map((order) => order.id));
  const unpaid = allOrders.filter(
    (order) => outstandingIds.has(order.id) && canCollectCounterPayment(order),
  );
  const filteredOrders = (orderFilter === 'unpaid' ? unpaid : allOrders)
    .filter((order) =>
      `${order.number} ${order.counter?.tableLabel ?? ''} ${order.customer.name} ${order.customer.phone}`
        .toLowerCase()
        .includes(orderSearch.trim().toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(canCollectCounterPayment(b)) - Number(canCollectCounterPayment(a)) ||
        (canCollectCounterPayment(a)
          ? Date.parse(a.createdAt) - Date.parse(b.createdAt)
          : Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    );
  const openOrder = (order: Order, collectPayment = false) => {
    setSelected(order);
    setCollecting(collectPayment && canCollectCounterPayment(order));
    setError('');
  };
  const showOutstanding = () => {
    setOrderFilter('unpaid');
    setOrderSearch('');
    orderList.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    orderList.current?.focus({ preventScroll: true });
  };
  const loadMoreOutstanding = async () => {
    if (!outstandingCursor || readingMore.current || mutation.current) return;
    refreshController.current?.abort();
    readingMore.current = true;
    setLoadingMore(true);
    const version = ++readVersion.current;
    try {
      const result = await commerceRequest<OutstandingResult>(
        `admin/counter/${encodeURIComponent(branch.id)}/awaiting-payment/${encodeURIComponent(outstandingCursor)}`,
      );
      if (!active.current || version !== readVersion.current) return;
      if (
        !Array.isArray(result.orders) ||
        result.orders.some(
          (order) => !isBranchCounterOrder(order, branch.id) || !canCollectCounterPayment(order),
        )
      )
        throw new Error('The counter returned an unexpected bill. Refresh before continuing.');
      setOutstandingOrders((current) => [
        ...new Map([...current, ...result.orders].map((order) => [order.id, order])).values(),
      ]);
      setOutstandingCursor(result.hasMore ? result.nextCursor : null);
      outstandingPages.current += 1;
      setOutstandingPageCount(outstandingPages.current);
      setOrdersError('');
    } catch (cause) {
      if (active.current && version === readVersion.current) setOrdersError(errorMessage(cause));
    } finally {
      readingMore.current = false;
      if (active.current) setLoadingMore(false);
    }
  };
  const openOrders = allOrders.filter((order) => !completedStatuses.includes(order.status));
  const remember = (order: Order, openBill = true) => {
    if (!isBranchCounterOrder(order, branch.id))
      throw new Error('The counter returned an unexpected order. Refresh before continuing.');
    ++readVersion.current;
    refreshController.current?.abort();
    setOrders((current) => [order, ...current.filter((item) => item.id !== order.id)]);
    setOutstandingOrders((current) => [
      ...(canCollectCounterPayment(order) ? [order] : []),
      ...current.filter((item) => item.id !== order.id),
    ]);
    if (openBill) setSelected(order);
  };
  const create = async (payment: CounterPayment | null, retry?: CreateRequest) => {
    if (mutation.current || (!retry && !canCreate)) return;
    const request = retry ?? {
      branchId: branch.id,
      fulfillment,
      items: structuredClone(cart),
      ...(customerName.trim() ? { customerName: customerName.trim() } : {}),
      ...(customerPhone.trim() ? { customerPhone: customerPhone.trim() } : {}),
      ...(fulfillment === 'dine_in' && tableLabel.trim() ? { tableLabel: tableLabel.trim() } : {}),
      ...(fulfillment === 'delivery'
        ? {
            deliveryAddress: {
              address: deliveryAddress.address.trim(),
              locality: deliveryAddress.locality.trim(),
              postalCode: deliveryAddress.postalCode,
              ...(deliveryAddress.landmark?.trim()
                ? { landmark: deliveryAddress.landmark.trim() }
                : {}),
              ...(deliveryAddress.instructions?.trim()
                ? { instructions: deliveryAddress.instructions.trim() }
                : {}),
            },
          }
        : {}),
      coupon: '' as const,
      expectedRevision: store.shared.revision,
      expectedTotal: totals!.total,
      expectedRoundOffPolicy: 'nearest_rupee' as const,
      idempotencyKey: crypto.randomUUID(),
      payment,
      ...(payment === null ? { payLaterReason: payLaterReason.trim() } : {}),
    };
    if (request.customerPhone && !/^[6-9]\d{9}$/.test(request.customerPhone)) {
      setError('Enter a valid 10-digit Indian mobile number, or leave it empty.');
      return;
    }
    if (!request.payment && (request.payLaterReason?.length ?? 0) < 5) {
      setError('Give a short reason for sending an unpaid order to the kitchen.');
      return;
    }
    mutation.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    setCreateAttempt(request);
    writeCounterDraft(draftKey, { ...draft, createAttempt: request });
    try {
      const result = await commerceRequest<CounterResult>('admin/counter/orders', {
        method: 'POST',
        body: request,
      });
      if (!active.current) return;
      remember(result.order, false);
      setLastPlacedId(result.order.id);
      setCart([]);
      setBillOpen(false);
      setCustomerName('');
      setCustomerPhone('');
      setTableLabel('');
      setDeliveryAddress(emptyDeliveryAddress());
      setPayLaterReason('');
      setShowPayLater(false);
      setCreateAttempt(null);
      setNotice(
        `${result.order.number} is in ${branch.name}’s kitchen queue${result.order.paymentStatus === 'paid' ? ' · payment recorded.' : ' · payment still due.'}`,
      );
      void store.shared.refreshAdmin();
      void refresh(undefined, true);
    } catch (cause) {
      if (!active.current) return;
      setError(errorMessage(cause));
      // Only explicit pre-commit validation responses allow a replacement request.
      if (
        cause instanceof CommerceError &&
        [
          'invalid_request',
          'quote_changed',
          'revision_conflict',
          'delivery_unavailable',
          'delivery_area_unavailable',
          'delivery_minimum',
          'counter_closed',
          'billing_required',
        ].includes(cause.code ?? '')
      ) {
        setCreateAttempt(null);
        void store.shared.refresh();
      }
    } finally {
      mutation.current = false;
      if (active.current) setBusy(false);
    }
  };
  const settle = async (payment: CounterPayment, retry?: typeof settleAttempt) => {
    if (mutation.current || (!retry && (!selected || !canCollectCounterPayment(selected)))) return;
    const request = retry ?? {
      orderId: selected!.id,
      expectedVersion: selected!.version ?? 0,
      idempotencyKey: crypto.randomUUID(),
      payment,
    };
    mutation.current = true;
    setBusy(true);
    setError('');
    setSettleAttempt(request);
    writeCounterDraft(draftKey, { ...draft, settleAttempt: request });
    try {
      const result = await commerceRequest<CounterResult>(
        `admin/counter/orders/${encodeURIComponent(request.orderId)}/settle`,
        {
          method: 'POST',
          body: {
            expectedVersion: request.expectedVersion,
            idempotencyKey: request.idempotencyKey,
            payment: request.payment,
          },
        },
      );
      if (!active.current) return;
      if (result.order.id !== request.orderId || !isStaffCounterPaymentComplete(result.order))
        throw new Error(
          'Payment could not be verified. Retry the same confirmation before collecting again.',
        );
      remember(result.order);
      setSettleAttempt(null);
      setCollecting(false);
      setNotice(`Payment recorded for ${result.order.number}.`);
      void store.shared.refreshAdmin();
      void refresh(undefined, true);
    } catch (cause) {
      if (!active.current) return;
      setError(errorMessage(cause));
      try {
        const recovered = await commerceRequest<{ order: Order }>(
          `admin/counter/orders/${encodeURIComponent(request.orderId)}`,
        );
        if (!active.current) return;
        if (
          recovered.order.id !== request.orderId ||
          !isBranchCounterOrder(recovered.order, branch.id)
        )
          throw new Error('The counter returned an unexpected branch.');
        remember(recovered.order);
        if (isStaffCounterPaymentComplete(recovered.order)) {
          setSettleAttempt(null);
          setCollecting(false);
          setError('');
          setNotice(
            `Payment is already recorded for ${recovered.order.number}. Do not collect it again.`,
          );
        } else if (
          cause instanceof CommerceError &&
          [
            'version_conflict',
            'invalid_request',
            'counter_invalid',
            'counter_cash_insufficient',
            'duplicate_upi_reference',
            'order_not_payable',
            'payment_review_required',
          ].includes(cause.code ?? '')
        ) {
          // These responses prove this attempt did not commit. A fresh confirmation
          // must use the reloaded order version; uncertain network attempts keep their key.
          setSettleAttempt(null);
          setCollecting(canCollectCounterPayment(recovered.order));
          if (cause.code === 'version_conflict')
            setError(
              'This order changed while payment was being recorded. Review the latest bill and confirm the payment received again. Do not collect a second payment.',
            );
        }
      } catch {
        // Keep the original confirmation until the server proves whether it was saved.
      }
    } finally {
      mutation.current = false;
      if (active.current) setBusy(false);
    }
  };
  const changeStatus = async (
    order: Order,
    status: 'served' | 'closed' | 'cancelled' | 'out_for_delivery' | 'delivered',
  ) => {
    if (mutation.current) return;
    mutation.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await commerceRequest<CounterResult>(
        `admin/counter/orders/${encodeURIComponent(order.id)}/status`,
        { method: 'POST', body: { expectedVersion: order.version ?? 0, status } },
      );
      if (!active.current) return;
      remember(result.order);
      setNotice(`${order.number} · ${labels[status]}.`);
      void store.shared.refreshAdmin();
      void refresh(undefined, true);
    } catch (cause) {
      if (active.current) {
        setError(errorMessage(cause));
        void refresh();
      }
    } finally {
      mutation.current = false;
      if (active.current) setBusy(false);
    }
  };
  return (
    <section className={styles.screen} aria-label="Restaurant counter">
      <header className={styles.heading}>
        <div>
          <p>STAFF COUNTER</p>
          <h1>Counter orders</h1>
          <span>
            {branch.name} · {openOrders.length} open ·{' '}
            <button className={styles.paymentShortcut} onClick={showOutstanding}>
              <Banknote size={15} />
              {loading
                ? 'Loading payment queue…'
                : `${unpaid.length}${outstandingCursor ? '+' : ''} awaiting payment · Collect payment`}
            </button>
          </span>
        </div>
        <Link className="btn btn-outline" href="/admin/kitchen">
          <ChefHat size={18} />
          Open kitchen
        </Link>
      </header>
      {store.shared.mode === 'development' && (
        <p className={styles.warning}>
          <strong>TEST COUNTER</strong> · Practice orders only. Do not collect real payments or
          prepare real food.
        </p>
      )}
      <div className={styles.branchBar}>
        <label>
          Counter branch
          <select
            value={branch.id}
            disabled={busy || !!createAttempt || !!settleAttempt}
            onChange={(event) => store.selectAdminBranch(event.target.value)}
          >
            {store.branches.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <span>
          <Utensils size={19} />
          Cash / direct UPI · dine-in or home delivery
        </span>
      </div>
      {!counterOpen && (
        <p className={styles.warning}>
          New counter orders are paused for this branch. Existing orders and payment collection
          remain available.
        </p>
      )}
      {!branch.settings.billing && (
        <p className={styles.error} role="alert">
          This branch needs its GST and FSSAI billing profile before counter orders can be taken.
        </p>
      )}
      {notice && (
        <p role="status" className={styles.success}>
          {notice}
          {lastPlacedId && orders.some((order) => order.id === lastPlacedId) && (
            <button
              className={styles.textButton}
              onClick={() => openOrder(orders.find((order) => order.id === lastPlacedId)!)}
            >
              View / print bill
            </button>
          )}
          {lastPlacedId &&
            orders.some(
              (order) => order.id === lastPlacedId && canCollectCounterPayment(order),
            ) && (
              <button
                className={styles.textButton}
                onClick={() =>
                  openOrder(
                    orders.find((order) => order.id === lastPlacedId)!,
                    true,
                  )
                }
              >
                Collect payment for this order
              </button>
            )}
        </p>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {createAttempt && (
        <div className={styles.warning}>
          <strong>{busy ? 'Saving this order…' : 'Order confirmation is incomplete.'}</strong>
          <p>
            Keep this page open. Retry checks the same order request; do not enter it again on
            another screen.
          </p>
          <button
            className="btn btn-outline"
            disabled={busy}
            onClick={() => void create(createAttempt.payment, createAttempt)}
          >
            Retry same order
          </button>
        </div>
      )}
      {totals && totals.total >= 5_000_000 && (
        <p className={styles.error} role="alert">
          Counter bills of ₹50,000 or more need additional invoice details. Please contact the
          owner.
        </p>
      )}
      <TableRequestQueue
        branch={branch}
        onAccepted={(order) => {
          remember(order, false);
          setLastPlacedId(order.id);
          setNotice(`${order.number} sent to ${branch.name}’s kitchen.`);
          void refresh();
        }}
      />
      <div className={styles.workspace}>
        <div className={styles.menu}>
          <div className={styles.menuTools}>
            <label className={styles.search}>
              <Search size={19} />
              <input
                aria-label="Search counter menu"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Find pizza, pasta or a side…"
              />
            </label>
            <div className={styles.categories} aria-label="Counter menu categories">
              <button aria-pressed={category === 'all'} onClick={() => setCategory('all')}>
                All items
              </button>
              {store.categories
                .filter((item) => !item.archived)
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((item) => (
                  <button
                    key={item.id}
                    aria-pressed={category === item.id}
                    onClick={() => setCategory(item.id)}
                  >
                    {item.name}
                  </button>
                ))}
            </div>
          </div>
          <div className={styles.products}>
            {visible.map((product) => (
              <article key={product.id} className={styles.product}>
                <button
                  className={styles.quickAdd}
                  aria-label={`Add ${product.name}`}
                  disabled={
                    busy ||
                    !!createAttempt ||
                    !counterOpen ||
                    counterDefaultQuantity(cart, product) >= 20 ||
                    (cart.length >= 50 && !counterDefaultQuantity(cart, product))
                  }
                  onClick={() => {
                    try {
                      counterDefaultSelection(product);
                      const lineId = crypto.randomUUID();
                      setCart((current) => addCounterDefault(current, product, lineId));
                      setError('');
                    } catch {
                      setEditing({ product });
                    }
                  }}
                >
                  <span className={styles.productName}>{product.name}</span>
                  <small>
                    {product.sizes[0]?.name ? `${product.sizes[0].name} · ` : ''}
                    {counterQuickPrice(product) === null
                      ? 'Choose options'
                      : `${money(counterQuickPrice(product)!)} · ${product.gstInclusive ? 'GST included' : 'before GST'}`}
                  </small>
                  <span className={styles.add}>
                    <Plus size={17} />
                    Add
                    {counterDefaultQuantity(cart, product)
                      ? ` · ${counterDefaultQuantity(cart, product)}`
                      : ''}
                  </span>
                </button>
                <button
                  className={styles.customizeQuick}
                  disabled={busy || !!createAttempt || !counterOpen}
                  onClick={() => setEditing({ product })}
                  aria-label={`Customize ${product.name}`}
                >
                  Customize
                </button>
              </article>
            ))}
          </div>
          {!visible.length && <p className={styles.empty}>No matching menu items.</p>}
        </div>
        <aside
          className={`${styles.draft} ${billOpen || createAttempt ? styles.billOpen : ''}`}
          aria-label="New counter order"
        >
          <h2>
            New order <span>{cart.reduce((sum, item) => sum + item.quantity, 0)} items</span>
            <button
              type="button"
              className={styles.billClose}
              aria-label="Back to menu"
              onClick={() => setBillOpen(false)}
            >
              <X size={20} />
            </button>
          </h2>
          {createAttempt && (
            <div className={styles.warning} role="status">
              <strong>{busy ? 'Saving this order…' : 'Order confirmation is incomplete.'}</strong>
              {error && <p role="alert">{error}</p>}
              <p>Retry the same request to check this order. Do not create it again.</p>
              <button
                type="button"
                className="btn btn-outline"
                disabled={busy}
                onClick={() => void create(createAttempt.payment, createAttempt)}
              >
                Retry this order
              </button>
            </div>
          )}
          <fieldset className={styles.details} disabled={busy || !!createAttempt}>
            <div className={styles.fulfillment} role="group" aria-label="Counter order type">
              <button
                type="button"
                aria-pressed={fulfillment === 'dine_in'}
                onClick={() => {
                  setFulfillment('dine_in');
                  setError('');
                }}
              >
                <Utensils size={17} /> Dine-in
              </button>
              <button
                type="button"
                aria-pressed={fulfillment === 'delivery'}
                onClick={() => {
                  setFulfillment('delivery');
                  setError('');
                }}
              >
                <Truck size={17} /> Home delivery
              </button>
            </div>
            {fulfillment === 'delivery' ? (
              <div className={styles.deliveryDetails}>
                <h3>Delivery details</h3>
                <label className={styles.field}>
                  Customer name
                  <input
                    value={customerName}
                    onChange={(event) => setCustomerName(event.target.value)}
                    minLength={2}
                    maxLength={80}
                    autoComplete="off"
                    required
                  />
                </label>
                <label className={styles.field}>
                  Mobile number
                  <input
                    type="tel"
                    inputMode="numeric"
                    value={customerPhone}
                    onChange={(event) => {
                      const digits = event.target.value.replace(/\D/g, '');
                      setCustomerPhone(
                        digits.length === 12 && digits.startsWith('91')
                          ? digits.slice(2)
                          : digits.slice(0, 10),
                      );
                    }}
                    maxLength={16}
                    autoComplete="off"
                    required
                    placeholder="10-digit Indian mobile"
                  />
                </label>
                <label className={styles.field}>
                  Complete address
                  <textarea
                    value={deliveryAddress.address}
                    onChange={(event) =>
                      setDeliveryAddress((current) => ({ ...current, address: event.target.value }))
                    }
                    minLength={8}
                    maxLength={200}
                    rows={2}
                    required
                    autoComplete="off"
                    placeholder="House / flat, building and street"
                  />
                </label>
                <div className={styles.addressGrid}>
                  <label className={styles.field}>
                    Locality
                    <input
                      value={deliveryAddress.locality}
                      onChange={(event) =>
                        setDeliveryAddress((current) => ({
                          ...current,
                          locality: event.target.value,
                        }))
                      }
                      minLength={2}
                      maxLength={100}
                      required
                      autoComplete="off"
                    />
                  </label>
                  <label className={styles.field}>
                    PIN code
                    <input
                      inputMode="numeric"
                      value={deliveryAddress.postalCode}
                      onChange={(event) =>
                        setDeliveryAddress((current) => ({
                          ...current,
                          postalCode: event.target.value.replace(/\D/g, '').slice(0, 6),
                        }))
                      }
                      maxLength={6}
                      required
                      autoComplete="off"
                    />
                  </label>
                </div>
                <label className={styles.field}>
                  Landmark <span>Optional</span>
                  <input
                    value={deliveryAddress.landmark ?? ''}
                    onChange={(event) =>
                      setDeliveryAddress((current) => ({
                        ...current,
                        landmark: event.target.value,
                      }))
                    }
                    maxLength={120}
                    autoComplete="off"
                  />
                </label>
                <details>
                  <summary>Delivery instructions · optional</summary>
                  <label className={styles.field}>
                    Instructions for the driver
                    <textarea
                      value={deliveryAddress.instructions ?? ''}
                      onChange={(event) =>
                        setDeliveryAddress((current) => ({
                          ...current,
                          instructions: event.target.value,
                        }))
                      }
                      maxLength={300}
                      rows={2}
                    />
                  </label>
                </details>
                <p className={styles.small}>
                  Delivery PIN codes:{' '}
                  {branch.settings.servicePostalCodes.join(', ') || 'None configured'}.
                  {branch.settings.minimumOrder > 0 &&
                    ` Minimum payable total: ${money(branch.settings.minimumOrder)}, including delivery and GST.`}
                </p>
              </div>
            ) : (
              <>
                <label className={styles.field}>
                  Order reference <span>Optional</span>
                  <input
                    value={tableLabel}
                    onChange={(event) => setTableLabel(event.target.value)}
                    maxLength={40}
                    placeholder="Token 12"
                  />
                </label>
                <details>
                  <summary>Customer details · optional</summary>
                  <label className={styles.field}>
                    Customer name
                    <input
                      value={customerName}
                      onChange={(event) => setCustomerName(event.target.value)}
                      maxLength={80}
                      autoComplete="off"
                    />
                  </label>
                  <label className={styles.field}>
                    Mobile number
                    <input
                      type="tel"
                      inputMode="numeric"
                      value={customerPhone}
                      onChange={(event) => setCustomerPhone(event.target.value)}
                      maxLength={10}
                      autoComplete="off"
                    />
                  </label>
                </details>
              </>
            )}
          </fieldset>
          {!cart.length ? (
            <div className={styles.empty}>
              <Utensils size={28} />
              <p>Tap a menu item to begin.</p>
            </div>
          ) : (
            <ul className={styles.cart}>
              {cart.map((item) => {
                const product = store.products.find((candidate) => candidate.id === item.productId);
                let options = '';
                let unitPrice = 0;
                try {
                  if (product) {
                    options = getItemOptions(product, item).join(' · ');
                    unitPrice = getUnitPrice(product, item);
                  }
                } catch {}
                return (
                  <li key={item.id}>
                    <div className={styles.cartTop}>
                      <button
                        className={styles.editItem}
                        disabled={
                          busy || !!createAttempt || !product?.available || product?.archived
                        }
                        onClick={() => {
                          if (product) setEditing({ product, item });
                        }}
                      >
                        <strong>{product?.name ?? 'Unavailable item'}</strong>
                        <small>{options}</small>
                        {item.notes && <small>Note: {item.notes}</small>}
                      </button>
                      <b>{money(unitPrice * item.quantity)}</b>
                    </div>
                    <div className={styles.cartBottom}>
                      <div className={styles.quantity}>
                        <button
                          aria-label={`Decrease ${product?.name ?? 'item'} quantity`}
                          disabled={busy || !!createAttempt}
                          onClick={() =>
                            setCart((current) =>
                              item.quantity === 1
                                ? current.filter((entry) => entry.id !== item.id)
                                : current.map((entry) =>
                                    entry.id === item.id
                                      ? { ...entry, quantity: entry.quantity - 1 }
                                      : entry,
                                  ),
                            )
                          }
                        >
                          <Minus size={15} />
                        </button>
                        <b>{item.quantity}</b>
                        <button
                          aria-label={`Increase ${product?.name ?? 'item'} quantity`}
                          disabled={busy || !!createAttempt || item.quantity >= 20}
                          onClick={() =>
                            setCart((current) =>
                              current.map((entry) =>
                                entry.id === item.id
                                  ? { ...entry, quantity: entry.quantity + 1 }
                                  : entry,
                              ),
                            )
                          }
                        >
                          <Plus size={15} />
                        </button>
                      </div>
                      <button
                        className={styles.textButton}
                        disabled={busy || !!createAttempt}
                        onClick={() =>
                          setCart((current) => current.filter((entry) => entry.id !== item.id))
                        }
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {cartError && (
            <p className={styles.error} role="alert">
              {cartError}
            </p>
          )}
          {deliveryIssue && (
            <p className={styles.warning} role="status">
              {deliveryIssue}
            </p>
          )}
          {totals && <AmountRows totals={totals} />}
          <p className={styles.small}>
            MRP items include GST. Additional CGST and SGST are shown separately before payment.
          </p>
          {totals && (
            <PaymentFields
              key={`new-${notice}`}
              total={totals.total}
              disabled={!canCreate}
              onPayment={(payment) => void create(payment)}
              label={busy ? 'Saving…' : 'Send to kitchen'}
            />
          )}
          <div className={styles.payLater}>
            <button
              className={styles.textButton}
              disabled={!canCreate}
              aria-expanded={showPayLater}
              onClick={() => setShowPayLater(!showPayLater)}
            >
              Send to kitchen · collect payment later
            </button>
            {showPayLater && (
              <div>
                <p className={styles.warning}>
                  Exception: this order goes to the kitchen unpaid. Collect payment before{' '}
                  {fulfillment === 'delivery' ? 'sending it out for delivery' : 'closing it'}.
                </p>
                <label className={styles.field}>
                  Reason for pay later
                  <textarea
                    maxLength={300}
                    rows={2}
                    value={payLaterReason}
                    onChange={(event) => setPayLaterReason(event.target.value)}
                    placeholder={
                      fulfillment === 'delivery'
                        ? 'Why is payment being collected before dispatch?'
                        : 'Customer will pay after the meal…'
                    }
                  />
                </label>
                <button
                  className="btn btn-outline"
                  disabled={!canCreate || payLaterReason.trim().length < 5}
                  onClick={() => void create(null)}
                >
                  Confirm unpaid order · send to kitchen
                </button>
              </div>
            )}
          </div>
        </aside>
      </div>
      {(billOpen || createAttempt) && (
        <button
          type="button"
          className={styles.billBackdrop}
          aria-label="Close bill"
          onClick={() => setBillOpen(false)}
        />
      )}
      {cart.length > 0 && !billOpen && !createAttempt && (
        <button type="button" className={styles.billBar} onClick={() => setBillOpen(true)}>
          <span>
            {(() => {
              const count = cart.reduce((sum, item) => sum + item.quantity, 0);
              return `${count} ${count === 1 ? 'item' : 'items'}`;
            })()}
            {totals ? ` · ${money(totals.total)}` : ''}
          </span>
          <strong>Bill &amp; payment →</strong>
        </button>
      )}
      <section ref={orderList} className={styles.recent} aria-label="Counter bills" tabIndex={-1}>
        <header>
          <div>
            <h2>Counter orders</h2>
            <p>
              Collect cash or verify a merchant UPI credit at any stage, including after serving.
            </p>
          </div>
          <button
            className="btn btn-outline"
            disabled={busy || loading || loadingMore}
            onClick={() => void refresh()}
          >
            <RefreshCw size={17} />
            Refresh
          </button>
        </header>
        <div className={styles.orderTools}>
          <div className={styles.orderFilters} role="group" aria-label="Filter counter bills">
            <button
              aria-pressed={orderFilter === 'unpaid'}
              onClick={() => setOrderFilter('unpaid')}
            >
              <Banknote size={16} /> Awaiting payment ({unpaid.length}
              {outstandingCursor ? '+' : ''})
            </button>
            <button aria-pressed={orderFilter === 'all'} onClick={() => setOrderFilter('all')}>
              All counter orders ({allOrders.length})
            </button>
          </div>
          <label className={styles.search}>
            <Search size={18} />
            <input
              aria-label="Search counter bills"
              value={orderSearch}
              onChange={(event) => setOrderSearch(event.target.value)}
              placeholder="Order number, table, customer or phone…"
            />
          </label>
        </div>
        {outstandingPageCount > automaticPaymentPages && (
          <p className={styles.warning} role="status">
            Automatic updates are paused while older unpaid bills are loaded. Use Refresh to update
            this list.
          </p>
        )}
        {ordersError && (
          <p role="alert" className={styles.error}>
            These orders may be stale: {ordersError}
          </p>
        )}
        {loading && <p>Loading counter orders…</p>}
        {!loading && !filteredOrders.length && (
          <p className={styles.empty}>
            {orderSearch
              ? 'No bills match this search.'
              : orderFilter === 'unpaid'
                ? 'No payments are awaiting collection for this branch.'
                : 'No counter orders for this branch yet.'}
          </p>
        )}
        <CounterOrderCards
          orders={filteredOrders}
          disabled={busy || !!settleAttempt}
          onOpen={openOrder}
        />
        {outstandingCursor && (
          <button
            className={`btn btn-outline ${styles.loadMore}`}
            disabled={busy || loading || loadingMore}
            onClick={() => void loadMoreOutstanding()}
          >
            {loadingMore ? 'Loading unpaid bills…' : 'Load more awaiting payment'}
          </button>
        )}
        {hasMore && (
          <p className={styles.small}>
            Showing recent orders and outstanding bills. Use Orders to review the full branch
            history.
          </p>
        )}
      </section>
      {editing && (
        <CustomizeItem
          product={editing.product}
          item={editing.item}
          onClose={() => setEditing(null)}
          onSave={(selection) => {
            if (editing.item)
              setCart((current) =>
                current.map((item) =>
                  item.id === editing.item?.id ? { ...selection, id: item.id } : item,
                ),
              );
            else setCart((current) => [...current, { ...selection, id: crypto.randomUUID() }]);
            setError('');
            setNotice('');
          }}
        />
      )}
      {selected && (
        <Dialog.Root
          open
          onOpenChange={(open) => {
            if (!open && !busy && !settleAttempt) {
              setSelected(null);
              setCollecting(false);
            }
          }}
        >
          <Dialog.Portal>
            <Dialog.Overlay className={styles.overlay} />
            <Dialog.Content className={`${styles.dialog} ${styles.orderDialog}`}>
              <Dialog.Title>{selected.number}</Dialog.Title>
              <Dialog.Description>
                {selected.fulfillment === 'delivery' ? 'Home delivery' : 'Dine-in'} · {branch.name}
                {selected.counter?.tableLabel ? ` · ${selected.counter.tableLabel}` : ''}
              </Dialog.Description>
              <Dialog.Close
                disabled={busy || !!settleAttempt}
                className={styles.close}
                aria-label="Close order"
              >
                <X size={21} />
              </Dialog.Close>
              <div className={styles.orderState}>
                <span>{orderStatusLabel(selected)}</span>
                <b className={selected.paymentStatus === 'paid' ? styles.paid : styles.unpaid}>
                  {selected.paymentStatus === 'paid'
                    ? 'PAID'
                    : `UNPAID · ${money(selected.total)} due`}
                </b>
              </div>
              {selected.fulfillment === 'delivery' && (
                <section className={styles.deliveryContact} aria-label="Order delivery address">
                  <h3>Deliver to {selected.customer.name}</h3>
                  <a href={`tel:+91${selected.customer.phone}`}>{selected.customer.phone}</a>
                  <p>
                    {selected.customer.address}
                    <br />
                    {selected.customer.locality} · {selected.customer.postalCode}
                  </p>
                  {selected.customer.landmark && <p>Landmark: {selected.customer.landmark}</p>}
                  {selected.customer.instructions && (
                    <p>Delivery note: {selected.customer.instructions}</p>
                  )}
                </section>
              )}
              {selected.counter?.payLaterReason && (
                <p className={styles.warning}>Pay later: {selected.counter.payLaterReason}</p>
              )}
              {error && (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              )}
              <div className={styles.orderActions}>
                {canCollectCounterPayment(selected) && (
                  <button
                    className={styles.primary}
                    disabled={busy || !!settleAttempt}
                    onClick={() => setCollecting(!collecting)}
                  >
                    <Banknote size={18} />
                    {collecting
                      ? 'Hide payment controls'
                      : `Collect payment · ${money(selected.total)}`}
                  </button>
                )}
                {selected.fulfillment === 'dine_in' && selected.status === 'ready' && (
                  <button
                    className="btn btn-outline"
                    disabled={busy || !!settleAttempt}
                    onClick={() => void changeStatus(selected, 'served')}
                  >
                    Mark served
                  </button>
                )}
                {selected.fulfillment === 'dine_in' && selected.status === 'served' && (
                  <button
                    className="btn btn-dark"
                    disabled={busy || !!settleAttempt || !isStaffCounterPaymentComplete(selected)}
                    onClick={() => void changeStatus(selected, 'closed')}
                  >
                    Close paid order
                  </button>
                )}
                {selected.fulfillment === 'delivery' && selected.status === 'ready' && (
                  <button
                    className="btn btn-outline"
                    disabled={busy || !!settleAttempt || !isStaffCounterPaymentComplete(selected)}
                    onClick={() => void changeStatus(selected, 'out_for_delivery')}
                  >
                    <Truck size={18} /> Mark out for delivery
                  </button>
                )}
                {selected.fulfillment === 'delivery' && selected.status === 'out_for_delivery' && (
                  <button
                    className="btn btn-dark"
                    disabled={busy || !!settleAttempt || !isStaffCounterPaymentComplete(selected)}
                    onClick={() => void changeStatus(selected, 'delivered')}
                  >
                    Mark delivered
                  </button>
                )}
              </div>
              {selected.status === 'served' && selected.paymentStatus !== 'paid' && (
                <p className={styles.small}>Collect the outstanding payment to close this order.</p>
              )}
              {selected.fulfillment === 'delivery' &&
                ['ready', 'out_for_delivery'].includes(selected.status) &&
                !isStaffCounterPaymentComplete(selected) && (
                  <p className={styles.warning}>
                    Record and verify the full payment before dispatching or completing delivery.
                  </p>
                )}
              {collecting && canCollectCounterPayment(selected) && !settleAttempt && (
                <PaymentFields
                  key={`settle-${selected.id}`}
                  total={selected.total}
                  disabled={busy}
                  onPayment={(payment) => void settle(payment)}
                  label="Save payment"
                />
              )}
              {settleAttempt && (
                <div className={styles.warning}>
                  <strong>
                    {busy ? 'Recording payment…' : 'Payment confirmation is incomplete.'}
                  </strong>
                  <p>Retry this same confirmation. Do not collect a second payment.</p>
                  <button
                    className="btn btn-outline"
                    disabled={busy}
                    onClick={() => void settle(settleAttempt.payment, settleAttempt)}
                  >
                    Retry same payment confirmation
                  </button>
                </div>
              )}
              <OrderBill order={selected} />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </section>
  );
}

export function CounterPage() {
  const store = useAdminStore();
  const branch = store.branches.find((item) => item.id === store.adminBranchId);
  if (!store.shared.enabled)
    return (
      <section className={styles.empty}>
        <h1>Connect the counter</h1>
        <p>
          Counter orders require a connected restaurant account and shared database. Browser-only
          demo orders cannot be sent to the kitchen.
        </p>
      </section>
    );
  if (!store.shared.ready || !store.shared.admin || !store.shared.user || !branch)
    return <p>Checking counter access…</p>;
  return (
    <CounterWorkspace
      key={`${store.shared.user.id}:${branch.id}`}
      branch={branch}
      ownerId={store.shared.user.id}
    />
  );
}
