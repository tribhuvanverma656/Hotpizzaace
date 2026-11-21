'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Banknote,
  Check,
  CreditCard,
  Minus,
  Plus,
  Search,
  ShoppingBasket,
  Trash2,
  Utensils,
  X,
} from 'lucide-react';
import { CustomizeItem } from '@/components/dine-in-controls';
import { OrderBill } from '@/components/order-bill';
import { LocalPosSidebar } from '@/components/local-pos/sidebar';
import { LocalPosAccountMenu } from '@/components/local-pos/account-menu';
import { getCartTotals, getMinimumOrderShortfall, getUnitPrice } from '@/lib/pricing';
import { createClientUuid } from '@/lib/client-uuid';
import { localBusinessDate } from '@/lib/local-pos/business-day';
import { money } from '@/lib/utils';
import type { CartItem, Customer, Order, Product } from '@/types';
import type { CommerceCatalog } from '@/lib/commerce/domain';
import type { LocalPayment } from '@/lib/local-pos/orders';
import type { LocalUser } from '@/lib/local-pos/database';
import styles from './register.module.css';

type PosOrder = Order & {
  localPos: {
    businessDate: string;
    cart: CartItem[];
    payments: LocalPayment[];
    changeRevision: number;
    acknowledgedRevision: number;
    paidAmount: number;
  };
};
type CatalogResponse = CommerceCatalog;
type CustomerAddressLookup = Pick<
  Customer,
  'name' | 'phone' | 'address' | 'locality' | 'postalCode' | 'landmark' | 'instructions'
>;
type RegisterMode = 'loading' | 'register' | 'unauthorized' | 'error';
type PaymentChoice = 'cash' | 'upi' | 'unpaid';
type AddressLookupStatus = 'idle' | 'loading' | 'found' | 'not_found' | 'error';

async function request<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? 'The local POS request failed.');
  return result;
}

function isLocalUser(value: unknown): value is LocalUser {
  if (!value || typeof value !== 'object') return false;
  const user = value as Partial<LocalUser>;
  return typeof user.id === 'string' && ['super_user', 'pos_manager'].includes(String(user.role));
}

function isCatalog(value: unknown): value is CatalogResponse {
  if (!value || typeof value !== 'object') return false;
  const catalog = value as Partial<CatalogResponse>;
  return (
    Array.isArray(catalog.products) &&
    Array.isArray(catalog.categories) &&
    Array.isArray(catalog.branches) &&
    Number.isSafeInteger(catalog.revision)
  );
}

function isPosOrder(value: unknown): value is PosOrder {
  if (!value || typeof value !== 'object') return false;
  const order = value as Partial<PosOrder>;
  return typeof order.id === 'string' && typeof order.total === 'number' && !!order.localPos;
}

const emptyProducts: Product[] = [];
const emptyCategories: CommerceCatalog['categories'] = [];

export function LocalRegister() {
  const [mode, setMode] = useState<RegisterMode>('loading');
  const [user, setUser] = useState<LocalUser | null>(null);
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [orders, setOrders] = useState<PosOrder[]>([]);
  const [historyDate, setHistoryDate] = useState(() => localBusinessDate(new Date()));
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [editing, setEditing] = useState<PosOrder | null>(null);
  const [customizing, setCustomizing] = useState<Product | null>(null);
  const [selected, setSelected] = useState<PosOrder | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [coupon, setCoupon] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [addressLookupPhone, setAddressLookupPhone] = useState('');
  const [addressLookupStatus, setAddressLookupStatus] = useState<AddressLookupStatus>('idle');
  const [addressLookupError, setAddressLookupError] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryLocality, setDeliveryLocality] = useState('');
  const [deliveryPostalCode, setDeliveryPostalCode] = useState('');
  const [deliveryLandmark, setDeliveryLandmark] = useState('');
  const [fulfillment, setFulfillment] = useState<'dine_in' | 'delivery'>('dine_in');
  const [tableLabel, setTableLabel] = useState('');
  const [paymentChoice, setPaymentChoice] = useState<PaymentChoice>('cash');
  const [cashTendered, setCashTendered] = useState('');
  const [upiReference, setUpiReference] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const branch = catalog?.branches[0];
  const products = catalog?.products ?? emptyProducts;
  const categories = catalog?.categories ?? emptyCategories;
  const activeProducts = useMemo(
    () =>
      products.filter(
        (product) =>
          product.available &&
          !product.archived &&
          !categories.some((category) => category.id === product.categoryId && category.archived),
      ),
    [categories, products],
  );
  const visibleProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return activeProducts.filter(
      (product) =>
        (categoryId === 'all' || product.categoryId === categoryId) &&
        (!query || `${product.name} ${product.description}`.toLowerCase().includes(query)),
    );
  }, [activeProducts, categoryId, search]);

  let totals: ReturnType<typeof getCartTotals> | null = null;
  let pricingError = '';
  if (branch) {
    try {
      totals = getCartTotals(cart, products, branch.settings, coupon, fulfillment);
    } catch (cause) {
      pricingError = cause instanceof Error ? cause.message : 'Review the current order.';
    }
  }
  const deliveryShortfall =
    fulfillment === 'delivery' && branch && totals
      ? getMinimumOrderShortfall(totals.total, branch.settings, 'delivery')
      : 0;
  const deliveryPinOutsideArea =
    fulfillment === 'delivery' &&
    !!deliveryPostalCode &&
    !!branch &&
    !branch.settings.servicePostalCodes.includes(deliveryPostalCode);

  const loadOrders = useCallback(async () => {
    const result = await request<{ orders: PosOrder[] }>(
      `/api/local-pos/orders?date=${encodeURIComponent(historyDate)}`,
    );
    if (!Array.isArray(result.orders) || result.orders.some((order) => !isPosOrder(order)))
      throw new Error('The local POS returned an invalid order list.');
    setOrders(result.orders);
    setSelected((current) =>
      current ? (result.orders.find((order) => order.id === current.id) ?? current) : null,
    );
  }, [historyDate]);

  const load = useCallback(async () => {
    try {
      const session = await request<{ user: LocalUser | null }>('/api/local-pos/session');
      if (!session.user || !isLocalUser(session.user)) {
        setMode('unauthorized');
        return;
      }
      setUser(session.user);
      const catalogResult = await request<CatalogResponse>('/api/local-pos/catalog');
      if (!isCatalog(catalogResult)) throw new Error('The local menu could not be loaded.');
      setCatalog(catalogResult);
      await loadOrders();
      setMode('register');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The local POS could not be loaded.');
      setMode('error');
    }
  }, [loadOrders]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (mode !== 'register') return;
    const interval = window.setInterval(() => {
      void loadOrders().catch((cause) =>
        setError(cause instanceof Error ? cause.message : 'Orders could not be refreshed.'),
      );
    }, 3500);
    return () => window.clearInterval(interval);
  }, [loadOrders, mode]);

  useEffect(() => {
    if (fulfillment !== 'delivery' || !/^[6-9]\d{9}$/.test(customerPhone)) {
      setAddressLookupStatus('idle');
      setAddressLookupError('');
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setAddressLookupStatus('loading');
      setAddressLookupError('');
      void fetch(`/api/local-pos/customers?phone=${encodeURIComponent(customerPhone)}`, {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
      })
        .then(async (response) => {
          const result = (await response.json()) as {
            customer?: CustomerAddressLookup | null;
            error?: string;
          };
          if (!response.ok) throw new Error(result.error ?? 'Customer address lookup failed.');
          return result.customer ?? null;
        })
        .then((customer) => {
          if (!customer) {
            setAddressLookupPhone('');
            setAddressLookupStatus('not_found');
            return;
          }
          setCustomerName(customer.name);
          setDeliveryAddress(customer.address);
          setDeliveryLocality(customer.locality);
          setDeliveryPostalCode(customer.postalCode);
          setDeliveryLandmark(customer.landmark);
          setAddressLookupPhone(customerPhone);
          setAddressLookupStatus('found');
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          setAddressLookupStatus('error');
          setAddressLookupError(
            cause instanceof Error ? cause.message : 'Customer address lookup failed.',
          );
        });
    }, 300);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [customerPhone, fulfillment]);

  function updateCustomerPhone(phone: string) {
    const nextPhone = phone.replace(/\D/g, '').slice(0, 10);
    setCustomerPhone(nextPhone);
    if (addressLookupPhone && nextPhone !== addressLookupPhone) {
      setAddressLookupPhone('');
      setAddressLookupStatus('idle');
      setCustomerName('');
      setDeliveryAddress('');
      setDeliveryLocality('');
      setDeliveryPostalCode('');
      setDeliveryLandmark('');
    }
  }

  function addSelection(selection: Omit<CartItem, 'id'>) {
    setCart((current) => [...current, { ...selection, id: createClientUuid() }]);
  }

  function changeQuantity(id: string, delta: number) {
    setCart((current) =>
      current.flatMap((item) => {
        if (item.id !== id) return [item];
        const quantity = item.quantity + delta;
        return quantity > 0 && quantity <= 20
          ? [{ ...item, quantity }]
          : quantity <= 0
            ? []
            : [item];
      }),
    );
  }

  function startOrderEdit(order: PosOrder) {
    if (order.status === 'ready') {
      setError('Ready orders are locked and cannot be changed.');
      return;
    }
    setEditing(order);
    setCart(order.localPos.cart.map((item) => ({ ...item })));
    setCustomerName(order.customer.name === 'Walk-in customer' ? '' : order.customer.name);
    setCoupon(order.coupon ?? '');
    setCustomerPhone(order.customer.phone ?? '');
    setDeliveryAddress(order.customer.address ?? '');
    setDeliveryLocality(order.customer.locality ?? '');
    setDeliveryPostalCode(order.customer.postalCode ?? '');
    setDeliveryLandmark(order.customer.landmark ?? '');
    setFulfillment(order.fulfillment === 'delivery' ? 'delivery' : 'dine_in');
    setTableLabel(order.counter?.tableLabel ?? '');
    setPaymentChoice('unpaid');
    setCashTendered('');
    setUpiReference('');
    setSelected(order);
    setError('');
  }

  function newOrder() {
    setEditing(null);
    setCart([]);
    setCustomerName('');
    setCoupon('');
    setCustomerPhone('');
    setDeliveryAddress('');
    setDeliveryLocality('');
    setDeliveryPostalCode('');
    setDeliveryLandmark('');
    setFulfillment('dine_in');
    setTableLabel('');
    setPaymentChoice('cash');
    setCashTendered('');
    setUpiReference('');
    setSelected(null);
    setError('');
  }

  async function submitOrder() {
    if (!catalog || !branch || !totals || !cart.length || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const payment =
        paymentChoice === 'cash'
          ? {
              method: 'cash',
              confirmedReceived: true,
              cashTendered: Math.round(
                Number(cashTendered || (totals.total / 100).toFixed(2)) * 100,
              ),
            }
          : paymentChoice === 'upi'
            ? {
                method: 'upi',
                confirmedReceived: true,
                upiReference: upiReference.trim().toUpperCase(),
              }
            : null;
      const body = {
        branchId: branch.id,
        fulfillment,
        items: cart,
        customerName: customerName.trim(),
        ...(customerPhone.trim() ? { customerPhone: customerPhone.trim() } : {}),
        ...(fulfillment === 'delivery'
          ? {
              deliveryAddress: {
                address: deliveryAddress.trim(),
                locality: deliveryLocality.trim(),
                postalCode: deliveryPostalCode.trim(),
                ...(deliveryLandmark.trim() ? { landmark: deliveryLandmark.trim() } : {}),
              },
            }
          : { tableLabel: tableLabel.trim() }),
        coupon: coupon.trim().toUpperCase(),
        expectedRevision: catalog.revision,
        expectedTotal: totals.total,
        expectedRoundOffPolicy: 'nearest_rupee',
        idempotencyKey: createClientUuid(),
        payment,
        ...(payment ? {} : { payLaterReason: 'Payment due at the counter.' }),
      };
      let updated: PosOrder;
      if (editing) {
        const result = await request<{ order: PosOrder }>(
          `/api/local-pos/orders/${encodeURIComponent(editing.id)}`,
          'PATCH',
          {
            action: 'edit',
            order: {
              ...body,
              payment: null,
              payLaterReason: 'Payment recorded separately.',
              expectedOrderVersion: editing.version,
            },
          },
        );
        updated = result.order;
        setNotice(`${updated.number} updated; kitchen display has been notified.`);
      } else {
        const result = await request<{ order: PosOrder }>('/api/local-pos/orders', 'POST', body);
        updated = result.order;
        setNotice(`${updated.number} sent to the kitchen.`);
      }
      if (!isPosOrder(updated)) throw new Error('The local POS returned an invalid order.');
      setSelected(updated);
      setEditing(null);
      setCart([]);
      setCustomerName('');
      setTableLabel('');
      setPaymentChoice('cash');
      await loadOrders();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The order could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  async function collectPayment(order: PosOrder) {
    const due = order.total - order.localPos.paidAmount;
    setBusy(true);
    setError('');
    try {
      const payment =
        paymentChoice === 'cash'
          ? {
              method: 'cash',
              cashTendered: Math.round(Number(cashTendered || (due / 100).toFixed(2)) * 100),
            }
          : { method: 'upi', upiReference: upiReference.trim().toUpperCase() };
      const result = await request<{ order: PosOrder }>(
        `/api/local-pos/orders/${encodeURIComponent(order.id)}`,
        'PATCH',
        { action: 'payment', expectedVersion: order.version, payment },
      );
      setSelected(result.order);
      setNotice(`Payment recorded for ${order.number}.`);
      setCashTendered('');
      setUpiReference('');
      await loadOrders();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Payment could not be recorded.');
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'loading')
    return (
      <main className={styles.statePage}>
        <div className={styles.spinner} />
        Loading local register…
      </main>
    );
  if (mode === 'unauthorized')
    return (
      <main className={styles.statePage}>
        <h1>POS sign-in required</h1>
        <p>Sign in as the Super User or POS Manager to use billing.</p>
        <Link href="/local-pos">Go to POS sign in</Link>
      </main>
    );
  if (mode === 'error')
    return (
      <main className={styles.statePage}>
        <h1>Register unavailable</h1>
        <p role="alert">{error}</p>
        <button onClick={() => void load()}>Retry</button>
        <Link href="/local-pos">Account access</Link>
      </main>
    );

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <Link href="/local-pos" aria-label="Back to local POS">
            <Image src="/brand/hot-pizza-ace.gif" alt="" width={1806} height={1440} unoptimized />
          </Link>
          <div>
            <strong>HOT PIZZA ACE</strong>
            <span>LOCAL POS · BARRA</span>
          </div>
        </div>
        <div className={styles.topActions}>
          <span className={styles.connection}>
            <i /> Local database
          </span>
          {user && <LocalPosAccountMenu user={user} />}
          {user?.role === 'super_user' && <Link href="/local-pos/analytics">Insights</Link>}
          <Link href="/local-pos">Team access</Link>
        </div>
      </header>

      <div className={styles.shell}>
        <LocalPosSidebar role={user!.role} active="register" />
        <section className={styles.menuPanel}>
          <div className={styles.heading}>
            <div>
              <p>COUNTER SERVICE</p>
              <h1>New order</h1>
            </div>
          </div>
          <label className={styles.search}>
            <Search size={18} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search menu items"
              aria-label="Search menu items"
            />
            {search && (
              <button onClick={() => setSearch('')} aria-label="Clear search">
                <X size={15} />
              </button>
            )}
          </label>
          <nav className={styles.categories} aria-label="Menu categories">
            <button
              className={categoryId === 'all' ? styles.categoryActive : ''}
              onClick={() => setCategoryId('all')}
            >
              All items
            </button>
            {categories
              .filter((category) => !category.archived)
              .map((category) => (
                <button
                  key={category.id}
                  className={categoryId === category.id ? styles.categoryActive : ''}
                  onClick={() => setCategoryId(category.id)}
                >
                  {category.name}
                </button>
              ))}
          </nav>
          <div className={styles.productGrid}>
            {visibleProducts.map((product) => {
              return (
                <button
                  className={styles.productCard}
                  key={product.id}
                  onClick={() => setCustomizing(product)}
                >
                  <div className={styles.productInfo}>
                    <strong>{product.name}</strong>
                    <span>From {money(product.price)}</span>
                  </div>
                  {product.vegetarian && <span className={styles.vegDot} aria-label="Vegetarian" />}
                  <span className={styles.addButton}>
                    <Plus size={16} /> Add
                  </span>
                </button>
              );
            })}
            {!visibleProducts.length && (
              <p className={styles.emptyMenu}>No menu items match this search.</p>
            )}
          </div>
          {customizing && (
            <CustomizeItem
              key={customizing.id}
              product={customizing}
              onSave={(selection) => addSelection(selection)}
              onClose={() => setCustomizing(null)}
            />
          )}
        </section>

        <aside className={styles.billPanel}>
          <div className={styles.orderTabs}>
            <button className={!selected ? styles.tabActive : ''} onClick={newOrder}>
              <Plus size={15} /> New bill
            </button>
            <button className={selected ? styles.tabActive : ''} disabled>
              {selected ? selected.number : 'Select order'}
            </button>
          </div>
          {selected && !editing ? (
            <SelectedOrder
              order={selected}
              busy={busy}
              paymentChoice={paymentChoice}
              setPaymentChoice={setPaymentChoice}
              cashTendered={cashTendered}
              setCashTendered={setCashTendered}
              upiReference={upiReference}
              setUpiReference={setUpiReference}
              onEdit={() => startOrderEdit(selected)}
              onCollect={() => void collectPayment(selected)}
              onBack={() => {
                setSelected(null);
                setPaymentChoice('cash');
                setError('');
              }}
            />
          ) : (
            <div className={styles.currentOrder}>
              <div className={styles.orderTitle}>
                <div className={styles.orderIcon}>
                  <Utensils size={18} />
                </div>
                <div>
                  <h2>{editing ? `Edit ${editing.number}` : 'Counter order'}</h2>
                  <p>
                    {editing ? `Kitchen status: ${editing.status}` : 'Counter and phone orders'}
                  </p>
                </div>
              </div>
              <fieldset className={styles.fulfillmentChoices}>
                <legend>Order type</legend>
                <button
                  type="button"
                  className={fulfillment === 'dine_in' ? styles.fulfillmentActive : ''}
                  onClick={() => setFulfillment('dine_in')}
                >
                  Dine-in / counter
                </button>
                <button
                  type="button"
                  className={fulfillment === 'delivery' ? styles.fulfillmentActive : ''}
                  disabled={!branch?.settings.deliveryEnabled}
                  onClick={() => setFulfillment('delivery')}
                  title={
                    !branch?.settings.deliveryEnabled
                      ? 'Delivery is disabled in restaurant settings'
                      : undefined
                  }
                >
                  Phone delivery
                </button>
              </fieldset>
              <label className={styles.field}>
                Customer name <span>Optional</span>
                <input
                  required={fulfillment === 'delivery'}
                  minLength={fulfillment === 'delivery' ? 2 : undefined}
                  value={customerName}
                  onChange={(event) => setCustomerName(event.target.value)}
                  placeholder={
                    fulfillment === 'delivery' ? 'Name for delivery' : 'Walk-in customer'
                  }
                  maxLength={80}
                />
              </label>
              {fulfillment === 'delivery' ? (
                <div className={styles.deliveryFields}>
                  <p className={styles.deliveryHelp}>
                    Orders must meet the minimum delivery amount and be inside the enabled PIN-code
                    area.
                  </p>
                  <label className={styles.field}>
                    Customer mobile
                    <input
                      required
                      inputMode="numeric"
                      autoComplete="tel-national"
                      pattern="[6-9][0-9]{9}"
                      value={customerPhone}
                      onChange={(event) => updateCustomerPhone(event.target.value)}
                      placeholder="10-digit mobile number"
                    />
                  </label>
                  {addressLookupStatus === 'loading' && (
                    <p className={styles.deliveryHelp} role="status">
                      Looking up saved delivery address…
                    </p>
                  )}
                  {addressLookupStatus === 'found' && (
                    <p className={styles.deliveryHelp} role="status">
                      Saved customer details loaded. Confirm the address before sending.
                    </p>
                  )}
                  {addressLookupStatus === 'not_found' && (
                    <p className={styles.deliveryHelp} role="status">
                      No previous delivery address found. Enter the customer’s address below.
                    </p>
                  )}
                  {addressLookupError && (
                    <p className={styles.deliveryWarning} role="alert">
                      {addressLookupError}
                    </p>
                  )}
                  <label className={styles.field}>
                    Delivery address
                    <textarea
                      required
                      minLength={8}
                      maxLength={200}
                      rows={2}
                      value={deliveryAddress}
                      onChange={(event) => setDeliveryAddress(event.target.value)}
                      placeholder="House, street and area"
                    />
                  </label>
                  <div className={styles.deliveryRow}>
                    <label className={styles.field}>
                      Locality
                      <input
                        required
                        minLength={2}
                        maxLength={100}
                        value={deliveryLocality}
                        onChange={(event) => setDeliveryLocality(event.target.value)}
                        placeholder="Area / locality"
                      />
                    </label>
                    <label className={styles.field}>
                      PIN code
                      <input
                        required
                        inputMode="numeric"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        value={deliveryPostalCode}
                        onChange={(event) =>
                          setDeliveryPostalCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                        }
                        placeholder="6 digits"
                      />
                    </label>
                  </div>
                  <label className={styles.field}>
                    Landmark <span>Optional</span>
                    <input
                      maxLength={120}
                      value={deliveryLandmark}
                      onChange={(event) => setDeliveryLandmark(event.target.value)}
                      placeholder="Nearby landmark"
                    />
                  </label>
                </div>
              ) : (
                <label className={styles.field}>
                  Table / order label <span>Optional</span>
                  <input
                    value={tableLabel}
                    onChange={(event) => setTableLabel(event.target.value)}
                    placeholder="Table 4"
                    maxLength={40}
                  />
                </label>
              )}
              {branch?.settings.couponCode && (
                <label className={styles.field}>
                  Coupon code <span>Optional</span>
                  <input
                    value={coupon}
                    onChange={(event) => setCoupon(event.target.value.toUpperCase())}
                    maxLength={20}
                    placeholder="Enter offer code"
                  />
                </label>
              )}
              <div className={styles.lineItems}>
                {!cart.length ? (
                  <div className={styles.emptyCart}>
                    <ShoppingBasket size={25} />
                    <span>Add items from the menu</span>
                  </div>
                ) : (
                  cart.map((item) => {
                    const product = products.find((entry) => entry.id === item.productId);
                    if (!product) return null;
                    return (
                      <div className={styles.cartLine} key={item.id}>
                        <div className={styles.cartProduct}>
                          <strong>{product.name}</strong>
                          <span>
                            {getUnitPrice(product, item) / 100 > 0
                              ? money(getUnitPrice(product, item))
                              : ''}
                          </span>
                        </div>
                        <div className={styles.quantity}>
                          <button
                            onClick={() => changeQuantity(item.id, -1)}
                            aria-label={`Decrease ${product.name}`}
                          >
                            <Minus size={13} />
                          </button>
                          <b>{item.quantity}</b>
                          <button
                            onClick={() => changeQuantity(item.id, 1)}
                            aria-label={`Increase ${product.name}`}
                          >
                            <Plus size={13} />
                          </button>
                          <button
                            className={styles.remove}
                            onClick={() => changeQuantity(item.id, -item.quantity)}
                            aria-label={`Remove ${product.name}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              {totals && cart.length > 0 && (
                <div className={styles.totalRows}>
                  <div>
                    <span>Menu subtotal</span>
                    <b>{money(totals.subtotal)}</b>
                  </div>
                  {fulfillment === 'delivery' && (
                    <div>
                      <span>Delivery charge</span>
                      <b>{money(totals.deliveryFee)}</b>
                    </div>
                  )}
                  {totals.discount > 0 && (
                    <div>
                      <span>Coupon discount</span>
                      <b>−{money(totals.discount)}</b>
                    </div>
                  )}
                  <div>
                    <span>Taxable value</span>
                    <b>{money(totals.tax?.taxableValue ?? totals.subtotal)}</b>
                  </div>
                  {totals.tax?.groups?.length ? (
                    totals.tax.groups.map((group, index) => {
                      const halfRate = (group.rateBps / 200).toLocaleString('en-IN', {
                        maximumFractionDigits: 2,
                      });
                      const treatment = group.pricing === 'inclusive' ? 'included' : 'added';
                      return [
                        <div key={`${group.code}-${index}-cgst`}>
                          <span>
                            CGST {halfRate}% {treatment}
                          </span>
                          <b>{money(group.cgst)}</b>
                        </div>,
                        <div key={`${group.code}-${index}-sgst`}>
                          <span>
                            SGST {halfRate}% {treatment}
                          </span>
                          <b>{money(group.sgst)}</b>
                        </div>,
                      ];
                    })
                  ) : (
                    <>
                      <div>
                        <span>CGST</span>
                        <b>{money(totals.tax?.cgst ?? 0)}</b>
                      </div>
                      <div>
                        <span>SGST</span>
                        <b>{money(totals.tax?.sgst ?? 0)}</b>
                      </div>
                    </>
                  )}
                  {totals.roundOff !== undefined && totals.roundOff !== 0 && (
                    <div>
                      <span>Round off</span>
                      <b>{money(totals.roundOff)}</b>
                    </div>
                  )}
                  <div className={styles.grandTotal}>
                    <span>Total including GST</span>
                    <strong>{money(totals.total)}</strong>
                  </div>
                  {deliveryShortfall > 0 && (
                    <p className={styles.deliveryWarning}>
                      Minimum delivery order is {money(branch?.settings.minimumOrder ?? 0)}. Add{' '}
                      {money(deliveryShortfall)} more.
                    </p>
                  )}
                  {deliveryPinOutsideArea && (
                    <p className={styles.deliveryWarning}>
                      This PIN code is outside the configured delivery area.
                    </p>
                  )}
                </div>
              )}
              {cart.length > 0 && (
                <>
                  {!editing && (
                    <PaymentSelector
                      value={paymentChoice}
                      onChange={setPaymentChoice}
                      total={totals?.total ?? 0}
                      cashTendered={cashTendered}
                      setCashTendered={setCashTendered}
                      upiReference={upiReference}
                      setUpiReference={setUpiReference}
                    />
                  )}
                  {pricingError && <p className={styles.error}>{pricingError}</p>}
                  {error && (
                    <p className={styles.error} role="alert">
                      {error}
                    </p>
                  )}
                  <button
                    className={styles.sendButton}
                    onClick={() => void submitOrder()}
                    disabled={
                      busy ||
                      !totals ||
                      !!pricingError ||
                      deliveryShortfall > 0 ||
                      deliveryPinOutsideArea
                    }
                  >
                    <Check size={18} />
                    {busy
                      ? 'Saving…'
                      : editing
                        ? 'Save changes & update kitchen'
                        : 'Send order to kitchen'}
                    {!busy && totals && <b>{money(totals.total)}</b>}
                  </button>
                  {editing && (
                    <button className={styles.cancelEdit} onClick={newOrder}>
                      <X size={15} /> Cancel edit
                    </button>
                  )}
                  <small className={styles.offlineHint}>
                    Saved on this POS · available to kitchen over local network
                  </small>
                </>
              )}
            </div>
          )}
          {notice && (
            <p className={styles.notice} role="status">
              {notice}
            </p>
          )}
          {error && !cart.length && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          {!selected && (
            <section className={styles.recent}>
              <div className={styles.recentHeading}>
                <label>
                  Order date
                  <input
                    type="date"
                    value={historyDate}
                    onChange={(event) => {
                      if (!/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) return;
                      newOrder();
                      setHistoryDate(event.target.value);
                    }}
                    aria-label="Order history date"
                  />
                </label>
                <span>{orders.length}</span>
              </div>
              <div className={styles.orderList}>
                {orders.map((order) => (
                  <button
                    key={order.id}
                    className={styles.orderRow}
                    onClick={() => {
                      setSelected(order);
                      setPaymentChoice('cash');
                      setCart([]);
                      setEditing(null);
                      setError('');
                    }}
                  >
                    <span className={styles.orderNumber}>{order.number}</span>
                    <span className={styles.orderMeta}>
                      {order.counter?.tableLabel || order.customer.name} · {order.status}
                    </span>
                    <strong>{money(order.total)}</strong>
                  </button>
                ))}
                {!orders.length && (
                  <p className={styles.emptyRecent}>Your new bills will appear here.</p>
                )}
              </div>
            </section>
          )}
        </aside>
      </div>
      <footer className={styles.footer}>
        <WifiIcon /> Local POS · internet not required
      </footer>
    </main>
  );
}

function PaymentSelector({
  value,
  onChange,
  total,
  cashTendered,
  setCashTendered,
  upiReference,
  setUpiReference,
  allowUnpaid = true,
}: {
  value: PaymentChoice;
  onChange: (choice: PaymentChoice) => void;
  total: number;
  cashTendered: string;
  setCashTendered: (value: string) => void;
  upiReference: string;
  setUpiReference: (value: string) => void;
  allowUnpaid?: boolean;
}) {
  return (
    <section className={styles.paymentSection}>
      <p>Payment</p>
      <div className={styles.paymentChoices}>
        <button
          className={value === 'cash' ? styles.paymentActive : ''}
          onClick={() => onChange('cash')}
        >
          <Banknote size={15} /> Cash
        </button>
        <button
          className={value === 'upi' ? styles.paymentActive : ''}
          onClick={() => onChange('upi')}
        >
          <CreditCard size={15} /> External UPI
        </button>
        {allowUnpaid && (
          <button
            className={value === 'unpaid' ? styles.paymentActive : ''}
            onClick={() => onChange('unpaid')}
          >
            Pay later
          </button>
        )}
      </div>
      {value === 'cash' && (
        <label className={styles.field}>
          Cash tendered
          <input
            inputMode="decimal"
            value={cashTendered || (total / 100).toFixed(2)}
            onChange={(event) => setCashTendered(event.target.value)}
          />
        </label>
      )}
      {value === 'upi' && (
        <label className={styles.field}>
          UPI reference (optional)
          <input
            value={upiReference}
            onChange={(event) => setUpiReference(event.target.value)}
            minLength={6}
            maxLength={80}
            placeholder="Optional — verify payment before recording"
          />
        </label>
      )}
      {value === 'unpaid' && (
        <p className={styles.paymentNote}>
          Bill is saved as unpaid. Staff can record payment later.
        </p>
      )}
    </section>
  );
}

function SelectedOrder({
  order,
  busy,
  paymentChoice,
  setPaymentChoice,
  cashTendered,
  setCashTendered,
  upiReference,
  setUpiReference,
  onEdit,
  onCollect,
  onBack,
}: {
  order: PosOrder;
  busy: boolean;
  paymentChoice: PaymentChoice;
  setPaymentChoice: (choice: PaymentChoice) => void;
  cashTendered: string;
  setCashTendered: (value: string) => void;
  upiReference: string;
  setUpiReference: (value: string) => void;
  onEdit: () => void;
  onCollect: () => void;
  onBack: () => void;
}) {
  const editable = order.status !== 'ready' && ['confirmed', 'preparing'].includes(order.status);
  const due = Math.max(0, order.total - order.localPos.paidAmount);
  return (
    <div className={styles.selectedOrder}>
      <div className={styles.selectedHeading}>
        <button onClick={onBack} aria-label="Back to orders">
          <ArrowLeft size={17} />
        </button>
        <div>
          <h2>{order.number}</h2>
          <p>
            {order.counter?.tableLabel || order.customer.name} ·{' '}
            <span className={styles.status}>{order.status}</span>
          </p>
        </div>
      </div>
      {order.localPos.changeRevision > order.localPos.acknowledgedRevision && (
        <p className={styles.updateWarning}>Kitchen update is awaiting acknowledgement.</p>
      )}
      <div className={styles.billView}>
        <OrderBill order={order} />
      </div>
      {due > 0 && (
        <div className={styles.paymentDue}>
          <strong>Amount due · {money(due)}</strong>
          <PaymentSelector
            value={paymentChoice}
            onChange={setPaymentChoice}
            total={due}
            cashTendered={cashTendered}
            setCashTendered={setCashTendered}
            upiReference={upiReference}
            setUpiReference={setUpiReference}
            allowUnpaid={false}
          />
          <button className={styles.sendButton} disabled={busy} onClick={onCollect}>
            <Check size={17} /> Record payment
          </button>
        </div>
      )}
      {editable ? (
        <button className={styles.editButton} onClick={onEdit}>
          <Utensils size={16} /> Edit order · kitchen will be updated
        </button>
      ) : (
        <p className={styles.locked}>
          <Check size={15} /> {order.status === 'ready' ? 'Ready' : 'Completed'} orders are locked
          against changes.
        </p>
      )}
    </div>
  );
}

function WifiIcon() {
  return <span aria-hidden="true">⌁</span>;
}
