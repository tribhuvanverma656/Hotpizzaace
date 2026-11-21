'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { Check, Minus, Plus, Search, ShoppingBag, Trash2 } from 'lucide-react';
import { CustomizeItem } from '@/components/dine-in-controls';
import { getCartTotals, getUnitPrice } from '@/lib/pricing';
import { createClientUuid } from '@/lib/client-uuid';
import { money } from '@/lib/utils';
import type { CartItem, Product } from '@/types';
import type { LocalQrMenu } from '@/lib/local-pos/qr-ordering';
import styles from './qr-order.module.css';

type SubmittedOrder = { number: string; total: number };

async function request<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? 'The local ordering request failed.');
  return result;
}

export function LocalQrOrder({ token }: { token: string }) {
  const [menu, setMenu] = useState<LocalQrMenu | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customizing, setCustomizing] = useState<Product | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [tableLabel, setTableLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [submitted, setSubmitted] = useState<SubmittedOrder | null>(null);

  useEffect(() => {
    let active = true;
    void request<LocalQrMenu>(`/api/local-pos/qr/${encodeURIComponent(token)}`)
      .then((result) => {
        if (active) setMenu(result);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Menu could not be loaded.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  const visibleProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (menu?.products ?? []).filter((product) => {
      const categoryMatches = categoryId === 'all' || product.categoryId === categoryId;
      const searchMatches =
        !query || `${product.name} ${product.description}`.toLowerCase().includes(query);
      return categoryMatches && searchMatches;
    });
  }, [categoryId, menu, search]);

  const quote = useMemo(() => {
    if (!menu || !cart.length) return { totals: null, error: '' };
    try {
      return {
        totals: getCartTotals(cart, menu.products, menu.settings, '', 'dine_in'),
        error: '',
      };
    } catch (cause) {
      return {
        totals: null,
        error: cause instanceof Error ? cause.message : 'Review the selected menu items.',
      };
    }
  }, [cart, menu]);
  const totals = quote.totals;

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

  async function placeOrder() {
    if (!menu || !totals || busy || !menu.acceptingOrders) return;
    setBusy(true);
    setError('');
    const key = idempotencyKey || createClientUuid();
    setIdempotencyKey(key);
    try {
      const result = await request<{ order: { number: string; total: number } }>(
        `/api/local-pos/qr/${encodeURIComponent(token)}`,
        'POST',
        {
          items: cart,
          customerName: customerName.trim(),
          tableLabel: tableLabel.trim(),
          expectedRevision: menu.revision,
          idempotencyKey: key,
        },
      );
      setSubmitted({ number: result.order.number, total: result.order.total });
      setCart([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The order could not be sent.');
    } finally {
      setBusy(false);
    }
  }

  function placeAnotherOrder() {
    setSubmitted(null);
    setCustomerName('');
    setTableLabel('');
    setIdempotencyKey('');
    setError('');
  }

  if (loading)
    return (
      <main className={styles.statePage}>
        <div className={styles.spinner} />
        Opening restaurant menu…
      </main>
    );
  if (error && !menu)
    return (
      <main className={styles.statePage}>
        <h1>Ordering unavailable</h1>
        <p role="alert">{error}</p>
      </main>
    );
  if (!menu)
    return (
      <main className={styles.statePage}>
        <h1>Ordering unavailable</h1>
        <p>Please ask staff for help.</p>
      </main>
    );
  if (submitted)
    return (
      <main className={styles.successPage}>
        <div className={styles.successIcon}>
          <Check size={28} />
        </div>
        <p>ORDER SENT TO KITCHEN</p>
        <h1>Thank you, {customerName.trim()}.</h1>
        <section>
          <span>Order number</span>
          <strong>{submitted.number}</strong>
          <span>Table</span>
          <strong>{tableLabel.trim()}</strong>
          <span>Amount due at the counter</span>
          <strong>{money(submitted.total)}</strong>
        </section>
        <p>Show your order number at the counter and pay there.</p>
        <button type="button" onClick={placeAnotherOrder}>
          Place another order
        </button>
      </main>
    );

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Image src="/brand/hot-pizza-ace.gif" alt="" width={1806} height={1440} unoptimized />
        <div>
          <strong>HOT PIZZA ACE</strong>
          <span>{menu.branchName} · LOCAL ORDERING</span>
        </div>
        <span className={styles.localBadge}>Restaurant Wi-Fi</span>
      </header>
      <div className={styles.content}>
        <section className={styles.intro}>
          <p>ORDER FROM YOUR TABLE</p>
          <h1>Choose your favourites</h1>
          <span>Send your order to the kitchen. Pay at the counter.</span>
        </section>
        {!menu.acceptingOrders && (
          <p className={styles.closed} role="status">
            The restaurant is not accepting orders right now. Please speak to staff.
          </p>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {quote.error && (
          <p className={styles.error} role="alert">
            {quote.error}
          </p>
        )}
        <label className={styles.search}>
          <Search size={17} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search menu"
            aria-label="Search menu"
          />
        </label>
        <nav className={styles.categories} aria-label="Menu categories">
          <button
            type="button"
            className={categoryId === 'all' ? styles.categoryActive : ''}
            onClick={() => setCategoryId('all')}
          >
            All
          </button>
          {menu.categories.map((category) => (
            <button
              type="button"
              key={category.id}
              className={categoryId === category.id ? styles.categoryActive : ''}
              onClick={() => setCategoryId(category.id)}
            >
              {category.name}
            </button>
          ))}
        </nav>
        <div className={styles.productGrid}>
          {visibleProducts.map((product) => (
            <button
              type="button"
              className={styles.productCard}
              key={product.id}
              onClick={() => setCustomizing(product)}
            >
              <span className={styles.productImage}>
                {product.image && (
                  <Image src={product.image} alt="" fill sizes="(max-width: 600px) 45vw, 260px" />
                )}
                {product.vegetarian && <i aria-label="Vegetarian" />}
              </span>
              <strong>{product.name}</strong>
              <span>From {money(product.price)}</span>
              <b>
                <Plus size={15} /> Add
              </b>
            </button>
          ))}
          {!visibleProducts.length && (
            <p className={styles.empty}>No available items in this category.</p>
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
        <section className={styles.cart} aria-label="Your order">
          <h2>
            <ShoppingBag size={18} /> Your order{' '}
            <span>{cart.reduce((sum, item) => sum + item.quantity, 0)}</span>
          </h2>
          {!cart.length ? (
            <p className={styles.emptyCart}>Add items from the menu to get started.</p>
          ) : (
            <>
              <div className={styles.cartLines}>
                {cart.map((item) => {
                  const product = menu.products.find(
                    (candidate) => candidate.id === item.productId,
                  );
                  if (!product) return null;
                  return (
                    <div className={styles.cartLine} key={item.id}>
                      <div>
                        <strong>{product.name}</strong>
                        <span>{money(getUnitPrice(product, item))} each</span>
                      </div>
                      <div className={styles.quantity}>
                        <button
                          type="button"
                          aria-label={`Remove one ${product.name}`}
                          onClick={() => changeQuantity(item.id, -1)}
                        >
                          <Minus size={14} />
                        </button>
                        <b>{item.quantity}</b>
                        <button
                          type="button"
                          aria-label={`Add one ${product.name}`}
                          onClick={() => changeQuantity(item.id, 1)}
                        >
                          <Plus size={14} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove ${product.name}`}
                          onClick={() =>
                            setCart((current) => current.filter((entry) => entry.id !== item.id))
                          }
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {totals && (
                <div className={styles.total}>
                  <span>Items</span>
                  <b>{money(totals.subtotal)}</b>
                  <span>GST included in bill</span>
                  <b>{money((totals.tax?.total ?? 0) - (totals.tax?.includedTotal ?? 0))}</b>
                  {totals.roundOff !== undefined && (
                    <>
                      <span>Round off</span>
                      <b>{money(totals.roundOff)}</b>
                    </>
                  )}
                  <strong>Total</strong>
                  <strong>{money(totals.total)}</strong>
                </div>
              )}
              <label className={styles.field}>
                Your name
                <input
                  value={customerName}
                  onChange={(event) => setCustomerName(event.target.value)}
                  maxLength={80}
                  autoComplete="name"
                />
              </label>
              <label className={styles.field}>
                Table number
                <input
                  value={tableLabel}
                  onChange={(event) => setTableLabel(event.target.value)}
                  maxLength={40}
                  placeholder="For example, Table 4"
                />
              </label>
              <button
                type="button"
                className={styles.submit}
                disabled={
                  busy ||
                  !menu.acceptingOrders ||
                  !customerName.trim() ||
                  !tableLabel.trim() ||
                  !totals
                }
                onClick={() => void placeOrder()}
              >
                {busy ? 'Sending order…' : 'Send order to kitchen'}{' '}
                <strong>{totals ? money(totals.total) : ''}</strong>
              </button>
              <small>Payment is collected by staff at the counter.</small>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
