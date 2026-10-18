'use client';
import { Check, ChevronDown, Info, Tag, Truck, X } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { useDemoStore } from '@/lib/store';
import { getCartTotals, isCouponActive } from '@/lib/pricing';
import { money } from '@/lib/utils';
import { Fulfillment } from '@/types';
import './order-summary-ux.css';
export function OrderSummary({
  fulfillment = 'delivery',
  children,
}: {
  fulfillment?: Fulfillment;
  children?: React.ReactNode;
}) {
  const { cart, products, settings, coupon, applyCoupon, clearCoupon } = useDemoStore();
  const [code, setCode] = useState('');
  const [couponError, setCouponError] = useState('');
  const couponFieldId = useId();
  const itemCount = cart.reduce((count, item) => count + item.quantity, 0);
  let totals = { subtotal: 0, deliveryFee: 0, discount: 0, total: 0 };
  let error = '';
  try {
    totals = getCartTotals(cart, products, settings, coupon, fulfillment);
  } catch (e) {
    error = e instanceof Error ? e.message : 'Please check your cart.';
  }
  const showDeliveryOffer =
    fulfillment === 'delivery' &&
    cart.length > 0 &&
    settings.deliveryFee > 0 &&
    settings.freeDeliveryThreshold !== null;
  const remainingForFreeDelivery = Math.max(
    (settings.freeDeliveryThreshold ?? 0) - totals.subtotal,
    0,
  );
  const apply = () => {
    setCouponError('');
    try {
      applyCoupon(code);
      toast.success('Coupon applied');
    } catch (err) {
      setCouponError(err instanceof Error ? err.message : 'Please check your coupon code.');
    }
  };
  return (
    <aside className="order-summary order-summary-polished" aria-label="Order summary">
      <div className="summary-heading">
        <h3>Order summary</h3>
        <span>
          {itemCount} {itemCount === 1 ? 'item' : 'items'}
        </span>
      </div>
      {error ? (
        <p className="error-message" role="alert">
          {error}
        </p>
      ) : (
        <>
          <div className="summary-row">
            <span>Food subtotal</span>
            <b>{money(totals.subtotal)}</b>
          </div>
          <div className="summary-row">
            <span>{fulfillment === 'delivery' ? 'Delivery fee' : 'Pickup'}</span>
            <b>
              {fulfillment === 'pickup' || (cart.length > 0 && totals.deliveryFee === 0) ? (
                <span className="green-text">Free</span>
              ) : (
                money(totals.deliveryFee)
              )}
            </b>
          </div>
          {totals.discount > 0 && (
            <div className="summary-row green-text">
              <span>Coupon savings</span>
              <b>−{money(totals.discount)}</b>
            </div>
          )}
          <div className="summary-total">
            <span>Total</span>
            <strong>{money(totals.total)}</strong>
          </div>
          {showDeliveryOffer && (
            <div
              className="summary-delivery-progress"
              data-qualified={remainingForFreeDelivery === 0}
            >
              <div>
                {remainingForFreeDelivery === 0 ? <Check size={16} /> : <Truck size={16} />}
                <strong>
                  {remainingForFreeDelivery === 0
                    ? 'Free delivery unlocked'
                    : `Add ${money(remainingForFreeDelivery)} for free delivery`}
                </strong>
              </div>
              <progress
                value={
                  remainingForFreeDelivery === 0
                    ? 1
                    : totals.subtotal / (settings.freeDeliveryThreshold || 1)
                }
                max={1}
                aria-label="Progress toward free delivery"
              />
              <p>
                On food orders {money(settings.freeDeliveryThreshold ?? 0)} or more, before coupons.
              </p>
            </div>
          )}
        </>
      )}
      {coupon ? (
        <div className="coupon-input-area">
          <div className="applied-coupon">
            <Tag size={16} />
            <span>{coupon} applied</span>
            <button
              type="button"
              onClick={() => {
                clearCoupon();
                setCouponError('');
                toast('Coupon removed');
              }}
              aria-label="Remove coupon"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      ) : (
        <details className="coupon-input-area summary-coupon-disclosure">
          <summary>
            <Tag size={17} />
            <span>Have a coupon?</span>
            <ChevronDown size={17} className="summary-coupon-chevron" />
          </summary>
          <label className="summary-coupon-label" htmlFor={couponFieldId}>
            Coupon code
          </label>
          <div className="coupon-entry">
            <input
              id={couponFieldId}
              value={code}
              onChange={(e) => {
                setCode(e.target.value.toUpperCase());
                setCouponError('');
              }}
              placeholder="Enter code"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={20}
              aria-invalid={!!couponError}
              aria-describedby={couponError ? `${couponFieldId}-error` : undefined}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  apply();
                }
              }}
            />
            <button
              type="button"
              aria-label="Apply coupon"
              onClick={apply}
              className="summary-coupon-apply"
            >
              Apply
            </button>
          </div>
          {couponError && (
            <p className="summary-coupon-error" role="alert" id={`${couponFieldId}-error`}>
              {couponError}
            </p>
          )}
          <p className="summary-coupon-offer">
            {isCouponActive(settings) ? (
              <>
                <strong>{settings.couponCode}</strong> · {settings.couponPercent}% off food orders{' '}
                {money(settings.couponMinimum)}+ · Up to {money(settings.couponMaximum)} off
              </>
            ) : (
              'No offers are available right now.'
            )}
          </p>
        </details>
      )}
      {children}
      <div className="summary-disclosure">
        <Info size={14} />
        <span>Demo checkout · no payment is collected.</span>
      </div>
    </aside>
  );
}
