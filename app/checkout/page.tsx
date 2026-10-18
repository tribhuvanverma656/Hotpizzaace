'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bike,
  ShoppingBag,
  MapPin,
  Clock,
  CreditCard,
  Smartphone,
  Banknote,
  CheckCircle2,
  XCircle,
  LoaderCircle,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { useDemoStore } from '@/lib/store';
import { getCartTotals, getMinimumOrderShortfall } from '@/lib/pricing';
import { validateCheckout } from '@/lib/validation';
import { resolveCheckoutAttempt, type CheckoutAttempt } from '@/lib/checkout-attempt';
import {
  checkoutDraftKey,
  clearCheckoutDraft,
  clearMatchingGuestCheckoutDraft,
  emptyCheckoutCustomer,
  initializeCheckoutDraft,
  isCheckoutScopeCurrent,
  isCompletedCheckout,
  getSelectedCheckoutAddressState,
  loadCheckoutDraft,
  saveCheckoutDraft,
  type CheckoutDraft,
} from '@/lib/checkout-draft';
import { getCustomerAddresses, getDefaultCustomerAddress } from '@/lib/customer-addresses';
import { money } from '@/lib/utils';
import { Customer, Fulfillment, Order, PaymentStatus, SavedAddress } from '@/types';
import { OrderSummary } from '@/components/order-summary';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { openRazorpayCheckout } from '@/lib/razorpay-checkout';
import '@/components/checkout-ux.css';
function draftStorage() {
  try {
    return typeof window === 'undefined' ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}
export default function CheckoutPage() {
  const { selectedBranchId, customerSession } = useDemoStore();
  return (
    <CheckoutForm
      key={checkoutDraftKey({ branchId: selectedBranchId, phone: customerSession?.phone })}
    />
  );
}
function CheckoutForm() {
  const router = useRouter();
  const {
    cart,
    products,
    orders,
    settings,
    coupon,
    hydrated,
    customerSession,
    createOrder,
    updateOrderStatus,
    updatePaymentStatus,
    selectedBranchId,
    savedAddresses,
    saveCustomerAddress,
  } = useDemoStore();
  const [fulfillmentChoice, setFulfillment] = useState<Fulfillment>('delivery');
  const [customer, setCustomer] = useState<Customer>(() => emptyCheckoutCustomer());
  const [methodChoice, setMethod] = useState<'upi' | 'card' | 'cash'>('upi');
  const sessionPhone = customerSession?.phone;
  const [draftReady, setDraftReady] = useState(false);
  const [selectedAddressId, setSelectedAddressId] = useState('');
  const [selectedAddressSnapshot, setSelectedAddressSnapshot] = useState<SavedAddress | null>(null);
  const [addressLabel, setAddressLabel] = useState('');
  const [addressMessage, setAddressMessage] = useState('');
  const [addressError, setAddressError] = useState('');
  const draftRef = useRef<CheckoutDraft | null>(null);
  const draftCompleted = useRef(false);
  const initializedScope = useRef('');
  const checkoutActive = useRef(true);
  const scope = { branchId: selectedBranchId, phone: sessionPhone };
  const scopeKey = checkoutDraftKey(scope);
  const attemptStorageKey = `${scopeKey}:attempt`;
  useEffect(() => {
    checkoutActive.current = true;
    return () => {
      checkoutActive.current = false;
    };
  }, []);
  const checkoutIsCurrent = () => {
    const state = useDemoStore.getState();
    return (
      checkoutActive.current &&
      isCheckoutScopeCurrent(scope, {
        branchId: state.selectedBranchId,
        phone: state.customerSession?.phone,
      })
    );
  };
  useEffect(() => {
    if (!hydrated) return;
    const currentScope = { branchId: selectedBranchId, phone: sessionPhone };
    const key = checkoutDraftKey(currentScope);
    if (initializedScope.current === key) return;
    const storage = draftStorage();
    const saved = loadCheckoutDraft(storage, currentScope);
    const defaultAddress = sessionPhone
      ? getDefaultCustomerAddress(useDemoStore.getState().savedAddresses, sessionPhone)
      : undefined;
    const guestDraft = sessionPhone
      ? loadCheckoutDraft(storage, { branchId: selectedBranchId })
      : null;
    const restored = initializeCheckoutDraft(currentScope, saved, defaultAddress, guestDraft);
    initializedScope.current = key;
    draftRef.current = restored;
    setCustomer(restored.customer);
    setFulfillment(restored.fulfillment);
    setMethod(restored.paymentMethod);
    setSelectedAddressId(restored.selectedAddressId);
    setSelectedAddressSnapshot(restored.selectedAddressSnapshot);
    setAddressLabel(restored.addressLabel);
    const restoredSaved = saveCheckoutDraft(storage, currentScope, restored);
    if (restoredSaved && !saved && !defaultAddress && guestDraft)
      clearMatchingGuestCheckoutDraft(storage, currentScope);
    setDraftReady(true);
  }, [hydrated, selectedBranchId, sessionPhone]);
  const [error, setError] = useState('');
  const [paymentError, setPaymentError] = useState('');
  const [paymentOrderId, setPaymentOrderId] = useState<string | null>(null);
  const [retryReady, setRetryReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const errorMessage = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorMessage.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [error]);
  const request = useRef<CheckoutAttempt | null>(null);
  const loadedAttempt = useRef(false);
  const submitting = useRef(false);
  const fulfillment: Fulfillment =
    fulfillmentChoice === 'delivery'
      ? settings.deliveryEnabled
        ? 'delivery'
        : settings.pickupEnabled
          ? 'pickup'
          : 'delivery'
      : settings.pickupEnabled
        ? 'pickup'
        : settings.deliveryEnabled
          ? 'delivery'
          : 'pickup';
  const method = settings.paymentMethods.includes(methodChoice)
    ? methodChoice
    : (settings.paymentMethods[0] ?? 'upi');
  const paymentOrder = orders.find((order) => order.id === paymentOrderId) ?? null;
  const stage: PaymentStatus = busy
    ? 'pending'
    : paymentOrder?.paymentStatus === 'failed' && retryReady
      ? 'initiated'
      : (paymentOrder?.paymentStatus ?? 'initiated');
  const fulfillmentAvailable =
    fulfillment === 'delivery' ? settings.deliveryEnabled : settings.pickupEnabled;
  const checkoutAvailable =
    fulfillmentAvailable &&
    settings.paymentMethods.includes(method) &&
    settings.acceptingOrders &&
    !settings.temporarilyClosed;
  let currentDeliveryFee: number | null = null;
  let checkoutTotal: number | null = null;
  try {
    checkoutTotal = getCartTotals(cart, products, settings, coupon, fulfillment).total;
    currentDeliveryFee = getCartTotals(cart, products, settings, coupon, 'delivery').deliveryFee;
  } catch {
    // The order summary explains any cart item that needs attention.
  }
  const minimumShortfall =
    checkoutTotal === null ? 0 : getMinimumOrderShortfall(checkoutTotal, settings, fulfillment);
  const customerAddresses = sessionPhone ? getCustomerAddresses(savedAddresses, sessionPhone) : [];
  const selectedSavedAddress = customerAddresses.find(
    (address) => address.id === selectedAddressId,
  );
  const selectedAddressState = getSelectedCheckoutAddressState(
    selectedAddressId,
    selectedAddressSnapshot,
    selectedSavedAddress,
  );
  const selectedAddressStale = !['new', 'current'].includes(selectedAddressState);
  const outsideDeliveryArea =
    fulfillment === 'delivery' &&
    /^\d{6}$/.test(customer.postalCode) &&
    !settings.servicePostalCodes.includes(customer.postalCode);
  const persistDraft = (changes: Partial<CheckoutDraft>) => {
    if (!draftRef.current || draftCompleted.current || !checkoutIsCurrent()) return;
    const next = { ...draftRef.current, ...changes };
    draftRef.current = next;
    saveCheckoutDraft(draftStorage(), scope, next);
  };
  const finishDraft = () => {
    if (!checkoutIsCurrent()) return;
    draftCompleted.current = true;
    clearCheckoutDraft(draftStorage(), scope);
    clearMatchingGuestCheckoutDraft(draftStorage(), scope);
    try {
      draftStorage()?.removeItem(attemptStorageKey);
    } catch {
      /* Order completion remains usable without storage. */
    }
    request.current = null;
  };
  const saveAttempt = (attempt: CheckoutAttempt) => {
    request.current = attempt;
    try {
      window.sessionStorage.setItem(attemptStorageKey, JSON.stringify(attempt));
    } catch {
      /* The in-memory key still prevents repeat submissions in this tab. */
    }
  };
  const update = (key: keyof Customer, value: string) => {
    const next = { ...(draftRef.current?.customer ?? customer), [key]: value };
    setCustomer(next);
    setAddressMessage('');
    setAddressError('');
    setError('');
    persistDraft({ customer: next });
  };
  const chooseFulfillment = (choice: Fulfillment) => {
    setFulfillment(choice);
    setError('');
    persistDraft({ fulfillment: choice });
  };
  const chooseAddress = (id: string) => {
    const saved = customerAddresses.find((address) => address.id === id);
    const next = saved
      ? { ...saved.customer, phone: sessionPhone!, instructions: customer.instructions }
      : {
          ...emptyCheckoutCustomer(sessionPhone),
          name: customer.name,
          instructions: customer.instructions,
        };
    setCustomer(next);
    setSelectedAddressId(saved?.id ?? '');
    setSelectedAddressSnapshot(saved ?? null);
    setAddressLabel(saved?.label ?? '');
    setAddressMessage('');
    setAddressError('');
    setError('');
    persistDraft({
      customer: next,
      selectedAddressId: saved?.id ?? '',
      addressLabel: saved?.label ?? '',
      selectedAddressSnapshot: saved ?? null,
    });
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current || busy || !checkoutIsCurrent()) return;
    submitting.current = true;
    setError('');
    setPaymentError('');
    try {
      if (!loadedAttempt.current) {
        loadedAttempt.current = true;
        try {
          const saved = JSON.parse(window.sessionStorage.getItem(attemptStorageKey) || 'null');
          if (saved && typeof saved.key === 'string' && typeof saved.fingerprint === 'string')
            request.current = saved;
        } catch {
          /* Browser storage may be unavailable; the current tab remains usable. */
        }
      }
      const totals = getCartTotals(cart, products, settings, coupon, fulfillment);
      const draft = {
        branchId: selectedBranchId,
        customer,
        fulfillment,
        paymentMethod: method,
        paymentStatus: method === 'cash' ? ('pending' as const) : ('initiated' as const),
        idempotencyKey: 'validate-checkout',
      };
      const validated = validateCheckout(draft, settings, totals.subtotal, totals.total);
      const fingerprint = JSON.stringify({
        branchId: selectedBranchId,
        customer: validated.customer,
        fulfillment,
        method,
        cart,
        coupon,
        totals,
      });
      const attempt = request.current;
      const previous = attempt?.orderId
        ? useDemoStore.getState().orders.find((order) => order.id === attempt?.orderId)
        : undefined;
      const decision = resolveCheckoutAttempt(attempt, fingerprint, previous);
      if (decision.cancelOrderId) updateOrderStatus(decision.cancelOrderId, 'cancelled');
      const nextAttempt =
        decision.action === 'reuse' && attempt
          ? attempt
          : { key: crypto.randomUUID(), fingerprint };
      saveAttempt(nextAttempt);
      const order = createOrder({ ...validated, idempotencyKey: nextAttempt.key });
      saveAttempt({ ...nextAttempt, orderId: order.id });
      if (isCompletedCheckout(order)) {
        fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(order),
        }).catch(() => {});
        finishDraft();
        router.push(`/order-success?id=${order.id}`);
        return;
      }
      setRetryReady(false);
      await startRazorpayPayment(order);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to continue. Please check your details.',
      );
    } finally {
      submitting.current = false;
    }
  };
  const startRazorpayPayment = async (targetOrder: Order) => {
    if (!checkoutIsCurrent()) return;
    setBusy(true);
    setPaymentError('');
    try {
      fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(targetOrder),
      }).catch(() => {});

      const res = await fetch('/api/payment/razorpay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: targetOrder.id,
          amount: targetOrder.total,
          receipt: targetOrder.number,
        }),
      });

      if (!res.ok) {
        throw new Error('Payment gateway initialization failed.');
      }

      const data = await res.json();

      if (data.mock || !data.keyId) {
        if (checkoutIsCurrent()) {
          setPaymentOrderId(targetOrder.id);
          setBusy(false);
        }
        return;
      }

      await openRazorpayCheckout({
        keyId: data.keyId,
        amount: data.amount,
        orderId: data.orderId,
        appOrderId: targetOrder.id,
        customerName: targetOrder.customer.name,
        customerPhone: targetOrder.customer.phone,
        onSuccess: async (rzpResponse) => {
          if (!checkoutIsCurrent()) return;
          setBusy(true);
          try {
            const verifyRes = await fetch('/api/payment/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                orderId: targetOrder.id,
                ...rzpResponse,
              }),
            });
            const verifyData = await verifyRes.json();
            if (!verifyRes.ok || !verifyData.success) {
              throw new Error(verifyData.error || 'Payment signature verification failed.');
            }

            updatePaymentStatus(targetOrder.id, 'simulated_paid');
            updateOrderStatus(targetOrder.id, 'confirmed');
            finishDraft();
            toast.success('Payment verified successfully! Order placed.');
            router.push(`/order-success?id=${targetOrder.id}`);
          } catch (verErr: unknown) {
            const message = verErr instanceof Error ? verErr.message : 'Payment verification failed';
            setPaymentError(message);
            updatePaymentStatus(targetOrder.id, 'failed');
            setPaymentOrderId(targetOrder.id);
          } finally {
            if (checkoutIsCurrent()) setBusy(false);
          }
        },
        onDismiss: () => {
          if (checkoutIsCurrent()) {
            setBusy(false);
            setPaymentOrderId(targetOrder.id);
            toast.info('Payment window closed.');
          }
        },
        onError: (err: unknown) => {
          if (checkoutIsCurrent()) {
            setBusy(false);
            const message =
              typeof err === 'object' && err !== null && 'description' in err
                ? String((err as { description?: unknown }).description)
                : err instanceof Error
                  ? err.message
                  : 'Payment failed';
            setPaymentError(message);
            setPaymentOrderId(targetOrder.id);
          }
        },
      });
    } catch {
      if (checkoutIsCurrent()) {
        setBusy(false);
        setPaymentOrderId(targetOrder.id);
      }
    }
  };
  const simulate = async (success: boolean) => {
    if (!paymentOrder || busy || !checkoutIsCurrent()) return;
    setBusy(true);
    setPaymentError('');
    try {
      updatePaymentStatus(paymentOrder.id, 'pending');
      await new Promise((resolve) => setTimeout(resolve, 650));
      if (!checkoutIsCurrent()) return;
      const status = success ? 'simulated_paid' : 'failed';
      updatePaymentStatus(paymentOrder.id, status);
      setRetryReady(false);
      if (success) {
        finishDraft();
        toast.success('Demo payment simulated. No money was charged.');
        router.push(`/order-success?id=${paymentOrder.id}`);
      }
    } catch (err) {
      if (checkoutIsCurrent())
        setPaymentError(
          err instanceof Error ? err.message : 'Simulation failed. Please try again.',
        );
    } finally {
      if (checkoutIsCurrent()) setBusy(false);
    }
  };
  const keepPending = () => {
    if (!paymentOrder || busy || !checkoutIsCurrent()) return;
    setPaymentError('');
    try {
      updatePaymentStatus(paymentOrder.id, 'pending');
      router.push(`/order-success?id=${paymentOrder.id}`);
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : 'Unable to update this payment.');
    }
  };
  if (!hydrated || !draftReady)
    return (
      <div className="container empty-state" role="status">
        Opening your saved checkout…
      </div>
    );
  if (!cart.length && !paymentOrder)
    return (
      <div className="container empty-state">
        <ShoppingBag size={42} />
        <h1>Start with a little something delicious.</h1>
        <p>Your cart is empty. Add your favourites before checking out.</p>
        <Link className="btn btn-primary" href="/menu">
          Explore the menu
        </Link>
      </div>
    );
  return (
    <div className="container journey-page checkout-experience">
      <Link className="back-link" href="/cart">
        <ArrowLeft size={16} />
        Edit your cart
      </Link>
      <nav className="checkout-progress" aria-label="Order progress">
        <ol>
          <li className="complete">
            <Link href="/cart">
              <CheckCircle2 size={17} aria-hidden="true" />
              Cart
            </Link>
          </li>
          <li aria-current="step">
            <span>2</span>Details
          </li>
          <li>
            <span>3</span>Confirmation
          </li>
        </ol>
      </nav>
      <div className="page-heading">
        <span className="eyebrow">ALMOST THERE</span>
        <h1>Checkout</h1>
        <p>Choose delivery or pickup, add your details and review your total.</p>
      </div>
      {!customerSession && (
        <p className="checkout-account-note">
          Continue as a guest, or{' '}
          <Link href="/account/login?next=/checkout">sign in to see your orders together</Link>.
        </p>
      )}
      {(!settings.acceptingOrders || settings.temporarilyClosed) && (
        <p className="error-message checkout-availability" role="status">
          The kitchen is not accepting orders right now. Your cart is saved for later.
        </p>
      )}
      <form id="checkout-form" className="checkout-grid" onSubmit={submit}>
        <div className="checkout-main">
          <section className="checkout-section">
            <h2>
              <span>1</span>Delivery or pickup
            </h2>
            <div className="fulfillment-options">
              <button
                type="button"
                className={fulfillment === 'delivery' ? 'selected' : ''}
                disabled={!settings.deliveryEnabled}
                aria-pressed={fulfillment === 'delivery'}
                onClick={() => chooseFulfillment('delivery')}
              >
                <Bike size={27} />
                <strong>Home delivery</strong>
                <span>
                  {!settings.deliveryEnabled
                    ? 'Currently unavailable'
                    : currentDeliveryFee === null
                      ? 'Delivered to your address'
                      : currentDeliveryFee === 0
                        ? 'Free delivery'
                        : `${money(currentDeliveryFee)} delivery`}
                </span>
              </button>
              <button
                type="button"
                className={fulfillment === 'pickup' ? 'selected' : ''}
                disabled={!settings.pickupEnabled}
                aria-pressed={fulfillment === 'pickup'}
                onClick={() => chooseFulfillment('pickup')}
              >
                <ShoppingBag size={26} />
                <strong>Pickup</strong>
                <span>
                  {settings.pickupEnabled
                    ? 'Collect at the restaurant · Free'
                    : 'Currently unavailable'}
                </span>
              </button>
            </div>
            {fulfillment === 'pickup' ? (
              <div className="checkout-notice">
                <MapPin size={19} />
                <div>
                  <strong>{settings.name}</strong>
                  <p>{settings.address}</p>
                  <p>
                    {settings.openingHours} · Ready in ~{settings.preparationMinutes} minutes
                  </p>
                </div>
              </div>
            ) : (
              <p className="field-help">
                Delivery available in postal codes: {settings.servicePostalCodes.join(', ')}.
              </p>
            )}
          </section>
          <section className="checkout-section">
            <h2>
              <span>2</span>
              {fulfillment === 'delivery' ? 'Your delivery details' : 'Your contact details'}
            </h2>
            {sessionPhone && fulfillment === 'delivery' && (
              <div className="checkout-address-picker">
                <label className="field">
                  Saved address
                  <select
                    aria-label="Choose a saved delivery address"
                    value={selectedAddressId}
                    onChange={(event) => chooseAddress(event.target.value)}
                  >
                    <option value="">Use a new address</option>
                    {selectedAddressState === 'removed' && (
                      <option value={selectedAddressId}>
                        Previously selected address · Removed
                      </option>
                    )}
                    {customerAddresses.map((address) => (
                      <option key={address.id} value={address.id}>
                        {address.label}
                        {address.isDefault ? ' · Default' : ''} · {address.customer.postalCode}
                      </option>
                    ))}
                  </select>
                </label>
                <Link href="/account/addresses">
                  Manage addresses <ArrowRight size={14} />
                </Link>
              </div>
            )}
            {sessionPhone && fulfillment === 'delivery' && selectedAddressStale && (
              <div className="checkout-address-review" role="status">
                <strong>
                  {selectedAddressState === 'removed'
                    ? 'This saved address was removed elsewhere.'
                    : selectedAddressState === 'changed'
                      ? 'This saved address changed elsewhere.'
                      : 'Review this saved address before updating it.'}
                </strong>
                <p>
                  Your entered details are kept for this order. Review the current saved version or
                  keep these details as a new address.
                </p>
                <div>
                  {selectedSavedAddress && (
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => chooseAddress(selectedAddressId)}
                    >
                      Use current saved version
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => {
                      setSelectedAddressId('');
                      setSelectedAddressSnapshot(null);
                      setAddressError('');
                      setAddressMessage('Your entered details are ready to save as a new address.');
                      persistDraft({ selectedAddressId: '', selectedAddressSnapshot: null });
                    }}
                  >
                    Keep details as a new address
                  </button>
                </div>
              </div>
            )}
            <div className="form-grid">
              <label className="field">
                Full name
                <input
                  required
                  name="name"
                  minLength={2}
                  maxLength={80}
                  autoComplete="name"
                  value={customer.name}
                  onChange={(e) => update('name', e.target.value)}
                  placeholder="Your name"
                />
              </label>
              <label className="field">
                Mobile number
                <input
                  required
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  readOnly={!!customerSession}
                  maxLength={20}
                  value={customer.phone}
                  onChange={(e) => update('phone', e.target.value)}
                  placeholder="10-digit mobile number"
                />
                {customerSession && (
                  <small className="signed-in-phone-note">
                    Signed-in mobile · This order will appear in My orders.
                  </small>
                )}
              </label>
              {fulfillment === 'delivery' && (
                <>
                  <label className="field full-width">
                    Complete address
                    <input
                      required
                      name="address"
                      minLength={8}
                      maxLength={300}
                      autoComplete="street-address"
                      value={customer.address}
                      onChange={(e) => update('address', e.target.value)}
                      placeholder="Flat / house number, building and street"
                    />
                  </label>
                  <label className="field">
                    Locality
                    <input
                      required
                      name="locality"
                      minLength={2}
                      maxLength={100}
                      autoComplete="address-level2"
                      value={customer.locality}
                      onChange={(e) => update('locality', e.target.value)}
                      placeholder="e.g. Barra 2"
                    />
                  </label>
                  <label className="field">
                    Postal code
                    <input
                      required
                      name="postalCode"
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      autoComplete="postal-code"
                      value={customer.postalCode}
                      onChange={(e) => update('postalCode', e.target.value)}
                      placeholder="e.g. 208027"
                    />
                  </label>
                </>
              )}
              <details className="checkout-optional full-width">
                <summary>
                  {fulfillment === 'delivery'
                    ? 'Add a landmark or instructions'
                    : 'Add pickup instructions'}
                  <span>Optional</span>
                </summary>
                <div className="checkout-optional-fields">
                  {fulfillment === 'delivery' && (
                    <label className="field">
                      Landmark
                      <input
                        name="landmark"
                        maxLength={150}
                        value={customer.landmark}
                        onChange={(e) => update('landmark', e.target.value)}
                        placeholder="Nearby building or place"
                      />
                    </label>
                  )}
                  <label className="field">
                    {fulfillment === 'delivery' ? 'Delivery' : 'Pickup'} instructions
                    <textarea
                      name="instructions"
                      maxLength={300}
                      value={customer.instructions}
                      onChange={(e) => update('instructions', e.target.value)}
                      rows={2}
                      placeholder={
                        fulfillment === 'delivery'
                          ? 'e.g. Call when you reach the gate'
                          : 'Anything we should know?'
                      }
                    />
                  </label>
                </div>
              </details>
            </div>
            {outsideDeliveryArea && (
              <p className="error-message checkout-address-coverage" role="status">
                This address is outside this branch’s delivery area. Choose another address or
                pickup.
              </p>
            )}
            {sessionPhone && fulfillment === 'delivery' && (
              <div className="checkout-save-address">
                <label className="field">
                  Address label <span className="optional">Optional</span>
                  <input
                    name="addressLabel"
                    value={addressLabel}
                    maxLength={40}
                    placeholder="e.g. Home or Work"
                    onChange={(event) => {
                      setAddressLabel(event.target.value);
                      setAddressMessage('');
                      persistDraft({ addressLabel: event.target.value });
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-outline"
                  disabled={selectedAddressStale}
                  onClick={() => {
                    if (!checkoutIsCurrent()) return;
                    setAddressError('');
                    setAddressMessage('');
                    try {
                      const id = selectedAddressId || crypto.randomUUID();
                      const label = addressLabel.trim() || 'Home';
                      const input = {
                        id,
                        label,
                        customer: { ...customer, instructions: '' },
                        isDefault: selectedAddressSnapshot?.isDefault ?? false,
                      };
                      if (selectedAddressId) {
                        if (!selectedAddressSnapshot)
                          throw new Error('Review the saved address before updating it.');
                        saveCustomerAddress(input, {
                          mode: 'update',
                          expectedOwnerPhone: sessionPhone,
                          expected: selectedAddressSnapshot,
                        });
                      } else
                        saveCustomerAddress(input, {
                          mode: 'create',
                          expectedOwnerPhone: sessionPhone,
                        });
                      const saved = getCustomerAddresses(
                        useDemoStore.getState().savedAddresses,
                        sessionPhone,
                      ).find((address) => address.id === id)!;
                      setSelectedAddressId(id);
                      setSelectedAddressSnapshot(saved);
                      setAddressLabel(label);
                      persistDraft({
                        selectedAddressId: id,
                        addressLabel: label,
                        selectedAddressSnapshot: saved,
                      });
                      setAddressMessage(
                        selectedAddressId
                          ? 'Saved address updated.'
                          : 'Address saved for your next order.',
                      );
                    } catch (cause) {
                      setAddressError(
                        cause instanceof Error ? cause.message : 'Unable to save this address.',
                      );
                    }
                  }}
                >
                  {selectedAddressId ? 'Update saved address' : 'Save this address'}
                </button>
                <p className="field-help">
                  Addresses are saved only when you choose to save. Delivery instructions apply to
                  this order.
                </p>
                {addressMessage && (
                  <p className="checkout-address-feedback" role="status">
                    {addressMessage}
                  </p>
                )}
                {addressError && (
                  <p className="error-message" role="alert">
                    {addressError}
                  </p>
                )}
              </div>
            )}
          </section>
          <section className="checkout-section">
            <h2>
              <span>3</span>Payment method
            </h2>
            <div className="demo-payment-note">
              <ShieldCheck size={20} />
              <div>
                <strong>Demo checkout · No money collected</strong>
                <p>Never enter card details, bank information or a UPI PIN.</p>
              </div>
            </div>
            {!fulfillmentAvailable && (
              <p role="alert" className="error-message">
                Delivery and pickup are currently unavailable. Please try again later.
              </p>
            )}
            {!settings.paymentMethods.length && (
              <p role="alert" className="error-message">
                No payment method is currently available. Please try again later.
              </p>
            )}
            <div className="payment-methods">
              {(
                [
                  ['upi', 'UPI', Smartphone],
                  ['card', 'Debit / credit card', CreditCard],
                  [
                    'cash',
                    fulfillment === 'pickup' ? 'Cash at pickup' : 'Cash on delivery (COD)',
                    Banknote,
                  ],
                ] as const
              )
                .filter(([value]) => settings.paymentMethods.includes(value))
                .map(([value, label, Icon]) => (
                  <label key={value} className={method === value ? 'selected' : ''}>
                    <input
                      type="radio"
                      name="payment"
                      checked={method === value}
                      onChange={() => {
                        setMethod(value);
                        setError('');
                        persistDraft({ paymentMethod: value });
                      }}
                    />
                    <Icon size={21} />
                    <span>{label}</span>
                    <small>{value === 'cash' ? 'On collection' : 'Demo payment'}</small>
                  </label>
                ))}
            </div>
          </section>
        </div>
        <OrderSummary fulfillment={fulfillment}>
          <p className="minimum-note">
            {fulfillment === 'pickup'
              ? 'No minimum order for pickup.'
              : `Minimum delivery total: ${money(settings.minimumOrder)}, including delivery and after discounts.`}
          </p>
          {minimumShortfall > 0 && (
            <div className="checkout-minimum-guidance" role="status">
              <strong>Add {money(minimumShortfall)} more for delivery.</strong>
              <p>Your payable total needs to reach {money(settings.minimumOrder)}.</p>
              <Link href="/menu">
                Add items from the menu <ArrowRight size={15} />
              </Link>
              {settings.pickupEnabled && (
                <button type="button" onClick={() => chooseFulfillment('pickup')}>
                  Or choose pickup with no minimum
                </button>
              )}
            </div>
          )}
          {error && (
            <p
              ref={errorMessage}
              role="alert"
              className="error-message checkout-error"
              id="checkout-error"
            >
              {error}
            </p>
          )}
          <button
            type="submit"
            className="btn btn-primary summary-checkout"
            aria-describedby={error ? 'checkout-error' : undefined}
            disabled={busy || !checkoutAvailable || minimumShortfall > 0}
          >
            {method === 'cash' ? 'Place demo order' : 'Continue to demo payment'}
            <ArrowRight size={17} />
          </button>
          <p className="checkout-terms">Local demo only. Nothing is sent to the restaurant.</p>
        </OrderSummary>
      </form>
      {!paymentOrder && (
        <div className="checkout-mobile-bar">
          {minimumShortfall > 0 && (
            <p className="checkout-mobile-minimum" role="status">
              Add {money(minimumShortfall)} more for delivery. <Link href="/menu">Add items</Link>
            </p>
          )}
          <div className="checkout-mobile-total" aria-live="polite" aria-atomic="true">
            <span>Total</span>
            <strong>{checkoutTotal === null ? 'Check your cart' : money(checkoutTotal)}</strong>
            <small>
              {fulfillment === 'pickup'
                ? 'Free pickup'
                : currentDeliveryFee === null
                  ? 'Delivery calculated in your summary'
                  : currentDeliveryFee === 0
                    ? 'Free delivery included'
                    : `Includes ${money(currentDeliveryFee)} delivery`}
            </small>
          </div>
          <button
            type="submit"
            form="checkout-form"
            className="btn btn-primary"
            aria-describedby={error ? 'checkout-error' : undefined}
            disabled={busy || !checkoutAvailable || checkoutTotal === null || minimumShortfall > 0}
          >
            {method === 'cash' ? 'Place demo order' : 'Demo payment'}
            <ArrowRight size={17} />
          </button>
        </div>
      )}
      <Dialog
        open={!!paymentOrder}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setPaymentOrderId(null);
            setPaymentError('');
            setRetryReady(false);
          }
        }}
      >
        <DialogContent className="payment-dialog">
          <span className="demo-pill">PAYMENT SIMULATOR</span>
          <DialogTitle>
            {stage === 'simulated_paid'
              ? 'Demo payment complete.'
              : stage === 'failed'
                ? 'That one didn’t go through.'
                : stage === 'pending'
                  ? 'Payment pending…'
                  : 'Complete your demo payment'}
          </DialogTitle>
          <DialogDescription>
            No real payment will be made. Choose an outcome to test the checkout experience.
          </DialogDescription>
          <div className="payment-amount">
            {money(paymentOrder?.total || 0)}
            <span>
              {paymentOrder?.number} · {paymentOrder?.paymentMethod.toUpperCase()}
            </span>
          </div>
          {paymentError && (
            <p role="alert" className="error-message">
              {paymentError}
            </p>
          )}
          {paymentOrder && ['cancelled', 'rejected'].includes(paymentOrder.status) ? (
            <>
              <p className="error-message">
                This order was {paymentOrder.status}. Payment can no longer be retried.
              </p>
              <button
                className="btn btn-outline"
                type="button"
                onClick={() => router.push(`/order-success?id=${paymentOrder.id}`)}
              >
                View order
              </button>
            </>
          ) : stage === 'simulated_paid' ? (
            <>
              <p className="green-text">The demo payment is complete. No money was charged.</p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => router.push(`/order-success?id=${paymentOrder?.id}`)}
              >
                View your order <ArrowRight size={17} />
              </button>
            </>
          ) : busy ? (
            <div className="simulation-loading">
              <LoaderCircle className="spin" />
              Simulating a pending payment…
            </div>
          ) : stage === 'failed' ? (
            <>
              <div className="error-message">
                <XCircle size={19} />
                Simulated payment failed. Your order remains unpaid.
              </div>
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => {
                  setRetryReady(true);
                  setPaymentError('');
                }}
              >
                Retry demo payment <ArrowRight size={17} />
              </button>
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => router.push(`/order-success?id=${paymentOrder?.id}`)}
              >
                View unpaid order
              </button>
            </>
          ) : (
            <div className="simulation-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => paymentOrder && startRazorpayPayment(paymentOrder)}
              >
                <CreditCard size={18} />
                Pay with Razorpay (UPI / Card)
              </button>
              <button type="button" className="btn btn-outline" onClick={() => simulate(true)}>
                <CheckCircle2 size={18} />
                Simulate successful payment
              </button>
              <button type="button" className="btn btn-outline" onClick={() => simulate(false)}>
                <XCircle size={18} />
                Simulate failed payment
              </button>
              <button type="button" className="btn btn-ghost" onClick={keepPending}>
                <Clock size={17} />
                Keep pending & view order
              </button>
            </div>
          )}
          <small className="muted">Use Razorpay for real/test payments, or use the simulator for instant local testing.</small>
        </DialogContent>
      </Dialog>
    </div>
  );
}
