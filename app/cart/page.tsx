'use client';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  ShoppingBag,
  Trash2,
  Minus,
  Plus,
  Clock,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { useDemoStore } from '@/lib/store';
import { getCartTotals, getUnitPrice, getItemOptions } from '@/lib/pricing';
import { money } from '@/lib/utils';
import { OrderSummary } from '@/components/order-summary';
import { OrderTrackingShortcut } from '@/components/order-tracking-shortcut';
import styles from './cart.module.css';
export default function CartPage() {
  const { cart, products, settings, coupon, hydrated, updateQuantity, removeFromCart } =
    useDemoStore();
  const itemCount = cart.reduce((count, item) => count + item.quantity, 0);
  let total: number | null = null;
  try {
    total = getCartTotals(cart, products, settings, coupon).total;
  } catch {
    // The summary and item rows explain pricing errors; keep checkout unavailable.
  }
  const invalid = total === null;
  const update = (id: string, q: number) => {
    try {
      updateQuantity(id, q);
      if (q === 0) toast('Item removed');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update cart');
    }
  };
  if (!hydrated)
    return (
      <div className="container empty-state" role="status">
        Opening your saved cart…
      </div>
    );
  if (!cart.length)
    return (
      <>
        <div className="container cart-tracking-shortcut">
          <OrderTrackingShortcut />
        </div>
        <div className="container empty-state cart-empty">
          <span className="empty-icon">
            <ShoppingBag size={45} />
          </span>
          <span className="eyebrow">LET’S FIX THAT EMPTY FEELING</span>
          <h1>
            Your next great slice
            <br />
            is waiting.
          </h1>
          <p>Your cart is empty. A little cheesy happiness is just a click away.</p>
          <Link href="/menu" className="btn btn-primary">
            Explore the menu <ArrowUpRightIcon />
          </Link>
        </div>
      </>
    );
  return (
    <div className={`container journey-page cart-page ${styles.page}`}>
      <Link href="/menu" className="back-link">
        <ArrowLeft size={16} />
        Continue browsing
      </Link>
      <div className="page-heading">
        <span className="eyebrow">YOU HAVE EXCELLENT TASTE</span>
        <h1>
          Your <em>cart.</em>
        </h1>
        <p>
          {itemCount} {itemCount === 1 ? 'item' : 'items'} · Review your choices before checkout.
        </p>
      </div>
      <div className="checkout-grid">
        <div className="cart-items">
          {cart.map((item) => {
            const product = products.find((p) => p.id === item.productId);
            let price = 0;
            let options: string[] = [];
            let error = '';
            try {
              if (!product) throw new Error('This product is no longer on the menu.');
              price = getUnitPrice(product, item);
              options = getItemOptions(product, item);
            } catch (e) {
              error = e instanceof Error ? e.message : 'Unavailable configuration';
            }
            return (
              <article className="cart-item" key={item.id}>
                <img
                  src={product?.image || '/images/margherita.jpg'}
                  alt={product?.name || 'Unavailable item'}
                />
                <div className="cart-item-content">
                  <span className={`diet-mark inline ${product?.vegetarian ? 'veg' : 'nonveg'}`}>
                    <i />
                  </span>
                  <h3>{product?.name || 'Unavailable item'}</h3>
                  <p>{options.join(' · ')}</p>
                  {item.notes && <small>Kitchen note: {item.notes}</small>}
                  {error && (
                    <p className="error-message">
                      <AlertCircle size={14} />
                      {error}
                    </p>
                  )}
                  <button
                    className="remove-item"
                    onClick={() => {
                      removeFromCart(item.id);
                      toast('Item removed');
                    }}
                  >
                    <Trash2 size={13} />
                    Remove
                  </button>
                </div>
                <div className="cart-item-end">
                  <strong>{money(price * item.quantity)}</strong>
                  <div className="quantity-control">
                    <button
                      disabled={item.quantity > 1 && !!error}
                      aria-label={
                        item.quantity === 1
                          ? `Remove ${product?.name || 'item'} from cart`
                          : `Decrease ${product?.name} quantity`
                      }
                      onClick={() => update(item.id, item.quantity - 1)}
                    >
                      <Minus size={14} />
                    </button>
                    <span>{item.quantity}</span>
                    <button
                      disabled={item.quantity >= 20 || !!error}
                      aria-label={`Increase ${product?.name} quantity`}
                      onClick={() => update(item.id, item.quantity + 1)}
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
          <div className="cart-info">
            <Clock size={19} />
            <div>
              <strong>Made fresh for your order.</strong>
              <p>
                Freshly prepared in about {settings.preparationMinutes} minutes. Choose delivery or
                free pickup at checkout.
              </p>
            </div>
          </div>
          <Link href="/menu" className="text-link">
            Add more items <Plus size={16} />
          </Link>
        </div>
        <OrderSummary>
          <div className={styles.checkoutAction}>
            <div className={styles.mobileTotal} aria-live="polite" aria-atomic="true">
              <span>
                {itemCount} {itemCount === 1 ? 'item' : 'items'} · Total
              </span>
              <strong>{total === null ? 'Check cart' : money(total)}</strong>
            </div>
            <Link
              href={invalid ? '#' : '/checkout'}
              aria-disabled={invalid}
              className={`btn btn-primary summary-checkout ${styles.checkoutLink} ${invalid ? 'disabled' : ''}`}
              onClick={(e) => {
                if (invalid) {
                  e.preventDefault();
                  toast.error('Please check your cart before checkout.');
                }
              }}
            >
              Continue to checkout <ArrowRight size={18} />
            </Link>
          </div>
        </OrderSummary>
      </div>
      <OrderTrackingShortcut />
    </div>
  );
}
function ArrowUpRightIcon() {
  return <ArrowRight size={18} />;
}
