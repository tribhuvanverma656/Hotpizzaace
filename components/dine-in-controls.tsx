'use client';
import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Banknote, Check, Minus, Plus, X } from 'lucide-react';
import { getCartTotals, getOptionPrice, getUnitPrice } from '@/lib/pricing';
import { money } from '@/lib/utils';
import type { CartItem, CartSelection, Product } from '@/types';
import styles from './admin/counter.module.css';
import { GstBreakup } from './order-bill';
const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : 'Please review this item.';
export type CounterPayment = {
  method: 'cash' | 'upi';
  confirmedReceived: true;
  cashTendered?: number;
  upiReference?: string;
};
export function AmountRows({ totals }: { totals: ReturnType<typeof getCartTotals> }) {
  return (
    <div className={styles.totals}>
      <div>
        <span>Items subtotal</span>
        <b>{money(totals.subtotal)}</b>
      </div>
      {totals.discount > 0 && (
        <div>
          <span>Discount</span>
          <b>−{money(totals.discount)}</b>
        </div>
      )}
      {totals.deliveryFee > 0 && (
        <div>
          <span>Delivery fee</span>
          <b>{money(totals.deliveryFee)}</b>
        </div>
      )}
      {totals.tax?.version === 2 ? (
        <GstBreakup tax={totals.tax} />
      ) : (
        <>
          <div>
            <span>CGST (2.5%)</span>
            <b>{money(totals.tax?.cgst ?? 0)}</b>
          </div>
          <div>
            <span>SGST (2.5%)</span>
            <b>{money(totals.tax?.sgst ?? 0)}</b>
          </div>
        </>
      )}
      {totals.roundOff !== undefined && (
        <div>
          <span>Round off</span>
          <b>{`${totals.roundOff > 0 ? '+' : ''}${money(totals.roundOff)}`}</b>
        </div>
      )}
      <div className={styles.grandTotal}>
        <span>Total including GST</span>
        <strong>{money(totals.total)}</strong>
      </div>
    </div>
  );
}

export function PaymentFields({
  total,
  disabled,
  onPayment,
  label,
}: {
  total: number;
  disabled: boolean;
  onPayment: (payment: CounterPayment) => void;
  label: string;
}) {
  const [method, setMethod] = useState<'cash' | 'upi'>('cash');
  const [tendered, setTendered] = useState<string | null>(null);
  const cashValue = tendered ?? (total / 100).toFixed(2);
  const [reference, setReference] = useState('');
  const cashPaise = /^\d+(?:\.\d{1,2})?$/.test(cashValue.trim())
    ? Math.round(Number(cashValue) * 100)
    : NaN;
  const valid =
    total > 0 &&
    (method === 'cash'
      ? Number.isSafeInteger(cashPaise) && cashPaise >= total
      : !reference.trim() || /^[A-Za-z0-9]{6,80}$/.test(reference.trim()));
  return (
    <fieldset className={styles.payment} disabled={disabled}>
      <legend>Payment</legend>
      <div className={styles.segmented}>
        <button
          type="button"
          aria-pressed={method === 'cash'}
          onClick={() => {
            setMethod('cash');
          }}
        >
          <Banknote size={17} />
          Cash
        </button>
        <button
          type="button"
          aria-pressed={method === 'upi'}
          onClick={() => {
            setMethod('upi');
          }}
        >
          UPI · merchant QR
        </button>
      </div>
      {method === 'cash' ? (
        <label className={styles.field}>
          Cash received (₹)
          <input
            aria-label="Cash received (₹)"
            inputMode="decimal"
            placeholder={(total / 100).toFixed(2)}
            value={cashValue}
            onChange={(event) => {
              setTendered(event.target.value);
            }}
          />
          {Number.isSafeInteger(cashPaise) && cashPaise >= total && (
            <small className={styles.change}>
              Change to return: <b>{money(cashPaise - total)}</b>
            </small>
          )}
        </label>
      ) : (
        <label className={styles.field}>
          UPI transaction reference
          <input
            aria-label="UPI transaction reference"
            value={reference}
            maxLength={80}
            autoComplete="off"
            placeholder="Optional · enter UTR if available"
            onChange={(event) => {
              setReference(event.target.value);
            }}
          />
          <small>Optional. Verify the credit in your merchant app before confirming payment.</small>
        </label>
      )}
      <button
        className={styles.primary}
        disabled={!valid || disabled}
        onClick={() =>
          onPayment({
            method,
            confirmedReceived: true,
            ...(method === 'cash'
              ? { cashTendered: cashPaise }
              : reference.trim()
                ? { upiReference: reference.trim() }
                : {}),
          })
        }
      >
        <Check size={18} />
        {method === 'cash' ? 'Cash received' : 'UPI verified'} · {label} · {money(total)}
      </button>
    </fieldset>
  );
}

export function CustomizeItem({
  product,
  item,
  onSave,
  onClose,
}: {
  product: Product;
  item?: CartItem;
  onSave: (selection: CartSelection) => void;
  onClose: () => void;
}) {
  const [sizeId, setSizeId] = useState(item?.sizeId ?? product.sizes[0]?.id);
  const [crustId, setCrustId] = useState(item?.crustId ?? product.crusts[0]?.id);
  const [toppingIds, setToppingIds] = useState(item?.toppingIds ?? []);
  const [quantity, setQuantity] = useState(item?.quantity ?? 1);
  const [notes, setNotes] = useState(item?.notes ?? '');
  const selection = { productId: product.id, sizeId, crustId, toppingIds, quantity, notes };
  let price = 0;
  let invalid = '';
  try {
    price = getUnitPrice(product, selection);
  } catch (cause) {
    invalid = errorMessage(cause);
  }
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.dialog}>
          <Dialog.Title>
            {item ? 'Edit' : 'Add'} {product.name}
          </Dialog.Title>
          <Dialog.Description>
            Choose the options and preparation notes for this dine-in order.
          </Dialog.Description>
          <Dialog.Close className={styles.close} aria-label="Close item">
            <X size={21} />
          </Dialog.Close>
          {product.sizes.length > 0 && (
            <label className={styles.field}>
              Size
              <select value={sizeId} onChange={(event) => setSizeId(event.target.value)}>
                {product.sizes.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name} · {money(option.price)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {product.crusts.length > 0 && (
            <label className={styles.field}>
              Crust
              <select value={crustId} onChange={(event) => setCrustId(event.target.value)}>
                {product.crusts.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name} · +{money(getOptionPrice(option, sizeId))}
                  </option>
                ))}
              </select>
            </label>
          )}
          {product.toppings.length > 0 && (
            <fieldset className={styles.toppings}>
              <legend>Extra toppings</legend>
              {product.toppings.map((option) => (
                <label key={option.id} className={styles.check}>
                  <input
                    type="checkbox"
                    checked={toppingIds.includes(option.id)}
                    onChange={(event) =>
                      setToppingIds(
                        event.target.checked
                          ? [...toppingIds, option.id]
                          : toppingIds.filter((id) => id !== option.id),
                      )
                    }
                  />
                  <span>
                    {option.name} · +{money(getOptionPrice(option, sizeId))}
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <label className={styles.field}>
            Kitchen note <span>Optional</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={300}
              rows={2}
              placeholder="Less spicy, no onion…"
            />
          </label>
          <div className={styles.customizerFooter}>
            <div className={styles.quantity}>
              <button
                aria-label="Decrease quantity"
                disabled={quantity <= 1}
                onClick={() => setQuantity(quantity - 1)}
              >
                <Minus size={17} />
              </button>
              <b>{quantity}</b>
              <button
                aria-label="Increase quantity"
                disabled={quantity >= 20}
                onClick={() => setQuantity(quantity + 1)}
              >
                <Plus size={17} />
              </button>
            </div>
            <strong>{money(price * quantity)}</strong>
          </div>
          {invalid && (
            <p className={styles.error} role="alert">
              {invalid}
            </p>
          )}
          <button
            className={styles.primary}
            disabled={!!invalid}
            onClick={() => {
              onSave(selection);
              onClose();
            }}
          >
            {item ? 'Save changes' : 'Add to order'}
          </button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
