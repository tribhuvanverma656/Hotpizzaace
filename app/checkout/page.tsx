'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
import { useSharedCommerce } from '@/components/shared-commerce-provider';
import { useCustomerAuth } from '@/components/customer-auth-provider';
import { useCustomerAddresses } from '@/components/customer-addresses-provider';
import {
  cartMatchesPlacedOrder,
  CommerceError,
  orderConfirmationHref,
} from '@/lib/commerce/client';
import type { SharedSavedAddress } from '@/lib/commerce/addresses';
import {
  applySharedCheckoutDefault,
  clearSharedCheckoutDraft,
  loadSharedCheckoutDraft,
  newSharedCheckoutDraft,
  saveSharedCheckoutDraft,
  sharedCheckoutAddressState,
  sharedCheckoutDraftKey,
  type SharedCheckoutDraft,
} from '@/lib/shared-checkout-draft';
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
import { Customer, Fulfillment, PaymentStatus, SavedAddress } from '@/types';
import { OrderSummary } from '@/components/order-summary';
import { OnlinePayment } from '@/components/payments/online-payment';
import { gatewayLabels, isGatewayMode, isTestGatewayMode } from '@/lib/payments/method';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import '@/components/checkout-ux.css';
type CheckoutAddress = SavedAddress | SharedSavedAddress;
type CurrentCheckoutDraft = Omit<CheckoutDraft, 'selectedAddressSnapshot'> & {
  selectedAddressSnapshot: CheckoutAddress | null;
  selectedAddressRevision?: number | null;
  addressTouched?: boolean;
};
function draftStorage() {
  try {
    return typeof window === 'undefined' ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}
export default function CheckoutPage() {
  const { selectedBranchId, customerSession } = useDemoStore();
  const shared = useSharedCommerce();
  const auth = useCustomerAuth();
  const identity = shared.enabled ? auth.contextId : null;
  const currentIdentity = useRef({ identity, loading: auth.loading, error: auth.error });
  useLayoutEffect(() => {
    currentIdentity.current = { identity, loading: auth.loading, error: auth.error };
  }, [identity, auth.loading, auth.error]);
  return (
    <CheckoutForm
      identityIsCurrent={() =>
        !shared.enabled ||
        (!!identity &&
          !currentIdentity.current.loading &&
          !currentIdentity.current.error &&
          currentIdentity.current.identity === identity)
      }
      key={
        shared.enabled
          ? `shared:${selectedBranchId}:${auth.contextId ?? 'unverified'}`
          : checkoutDraftKey({ branchId: selectedBranchId, phone: customerSession?.phone })
      }
    />
  );
}
function CheckoutForm({ identityIsCurrent }: { identityIsCurrent: () => boolean }) {
  const router = useRouter();
  const shared = useSharedCommerce();
  const auth = useCustomerAuth();
  const addressBook = useCustomerAddresses();
  const sharedIdentity = shared.enabled ? (auth.user?.id ?? null) : null;
  const storage = useCallback(() => draftStorage(), []);
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
  const sessionPhone = shared.enabled ? undefined : customerSession?.phone;
  const [draftReady, setDraftReady] = useState(false);
  const [selectedAddressId, setSelectedAddressId] = useState('');
  const [selectedAddressSnapshot, setSelectedAddressSnapshot] = useState<CheckoutAddress | null>(
    null,
  );
  const [addressLabel, setAddressLabel] = useState('');
  const [addressMessage, setAddressMessage] = useState('');
  const [addressError, setAddressError] = useState('');
  const [addressConflict, setAddressConflict] = useState(false);
  const [addressRevision, setAddressRevision] = useState<number | null>(null);
  const [addressSaving, setAddressSaving] = useState(false);
  const addressSaveInFlight = useRef(false);
  const pendingAddressId = useRef<string | null>(null);
  const draftRef = useRef<CurrentCheckoutDraft | null>(null);
  const draftCompleted = useRef(false);
  const initializedScope = useRef('');
  const checkoutActive = useRef(true);
  const scope = { branchId: selectedBranchId, phone: sessionPhone };
  const sharedScope = { branchId: selectedBranchId, userId: sharedIdentity };
  const scopeKey = shared.enabled ? sharedCheckoutDraftKey(sharedScope) : checkoutDraftKey(scope);
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
      identityIsCurrent() &&
      isCheckoutScopeCurrent(scope, {
        branchId: state.selectedBranchId,
        phone: shared.enabled ? undefined : state.customerSession?.phone,
      })
    );
  };
  useEffect(() => {
    if (!hydrated || (shared.enabled && auth.loading)) return;
    const currentScope = { branchId: selectedBranchId, phone: sessionPhone };
    const currentSharedScope = { branchId: selectedBranchId, userId: sharedIdentity };
    const key = shared.enabled
      ? sharedCheckoutDraftKey(currentSharedScope)
      : checkoutDraftKey(currentScope);
    if (initializedScope.current === key) return;
    const target = storage();
    const saved = shared.enabled ? null : loadCheckoutDraft(target, currentScope);
    const sharedSaved = shared.enabled ? loadSharedCheckoutDraft(target, currentSharedScope) : null;
    const defaultAddress = sessionPhone
      ? getDefaultCustomerAddress(useDemoStore.getState().savedAddresses, sessionPhone)
      : undefined;
    const guestDraft = sessionPhone
      ? loadCheckoutDraft(target, { branchId: selectedBranchId })
      : null;
    const restored: CurrentCheckoutDraft = shared.enabled
      ? sharedSaved
        ? { ...sharedSaved, addressTouched: true }
        : newSharedCheckoutDraft(currentSharedScope)
      : initializeCheckoutDraft(currentScope, saved, defaultAddress, guestDraft);
    initializedScope.current = key;
    draftRef.current = restored;
    setCustomer(restored.customer);
    setFulfillment(restored.fulfillment);
    setMethod(restored.paymentMethod);
    setSelectedAddressId(restored.selectedAddressId);
    setSelectedAddressSnapshot(restored.selectedAddressSnapshot);
    setAddressLabel(restored.addressLabel);
    setAddressRevision(restored.selectedAddressRevision ?? null);
    const restoredSaved = shared.enabled
      ? saveSharedCheckoutDraft(target, currentSharedScope, restored as SharedCheckoutDraft)
      : saveCheckoutDraft(target, currentScope, restored as CheckoutDraft);
    if (restoredSaved && !saved && !defaultAddress && guestDraft)
      clearMatchingGuestCheckoutDraft(target, currentScope);
    setDraftReady(true);
  }, [
    hydrated,
    selectedBranchId,
    sessionPhone,
    storage,
    shared.enabled,
    sharedIdentity,
    auth.loading,
  ]);
  useEffect(() => {
    if (
      !shared.enabled ||
      !settings.deliveryEnabled ||
      (fulfillmentChoice === 'pickup' && settings.pickupEnabled) ||
      !sharedIdentity ||
      !draftReady ||
      addressBook.loading ||
      addressBook.error ||
      addressBook.revision === null ||
      !draftRef.current ||
      !identityIsCurrent()
    )
      return;
    const current = draftRef.current as SharedCheckoutDraft;
    const next = applySharedCheckoutDefault(
      current,
      addressBook.addresses.find((address) => address.isDefault),
      addressBook.revision,
    );
    if (next === current) return;
    draftRef.current = next;
    setCustomer(next.customer);
    setSelectedAddressId(next.selectedAddressId);
    setSelectedAddressSnapshot(next.selectedAddressSnapshot);
    setAddressLabel(next.addressLabel);
    setAddressRevision(next.selectedAddressRevision);
    saveSharedCheckoutDraft(
      storage(),
      { branchId: selectedBranchId, userId: sharedIdentity },
      next,
    );
  }, [
    shared.enabled,
    sharedIdentity,
    draftReady,
    addressBook.addresses,
    addressBook.loading,
    addressBook.error,
    addressBook.revision,
    selectedBranchId,
    storage,
    identityIsCurrent,
    fulfillmentChoice,
    settings.deliveryEnabled,
    settings.pickupEnabled,
  ]);
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
  const simulatorAvailable = !shared.enabled || shared.allowSimulatedPayments;
  const availablePaymentMethods = settings.paymentMethods.filter(
    (paymentMethod) => paymentMethod === 'cash' || !!shared.onlinePayment || simulatorAvailable,
  );
  const method = availablePaymentMethods.includes(methodChoice)
    ? methodChoice
    : (availablePaymentMethods[0] ?? 'upi');
  const paymentOrder =
    (shared.enabled ? shared.customerOrders : orders).find(
      (order) => order.id === paymentOrderId,
    ) ?? null;
  const stage: PaymentStatus = busy
    ? 'pending'
    : paymentOrder?.paymentStatus === 'failed' && retryReady
      ? 'initiated'
      : (paymentOrder?.paymentStatus ?? 'initiated');
  const fulfillmentAvailable =
    fulfillment === 'delivery' ? settings.deliveryEnabled : settings.pickupEnabled;
  const checkoutAvailable =
    (!shared.enabled || (shared.ready && !auth.loading && !auth.error)) &&
    fulfillmentAvailable &&
    availablePaymentMethods.includes(method) &&
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
  const canSaveAddress = shared.enabled
    ? !!sharedIdentity && !auth.loading && !auth.error
    : !!sessionPhone;
  const cloudAddressesAvailable =
    !addressBook.loading &&
    addressBook.revision !== null &&
    (!addressBook.error ||
      ['address_revision_conflict', 'address_not_found', 'address_duplicate'].includes(
        addressBook.errorCode ?? '',
      ));
  const localAddresses = sessionPhone ? getCustomerAddresses(savedAddresses, sessionPhone) : [];
  const customerAddresses: CheckoutAddress[] = shared.enabled
    ? addressBook.addresses
    : localAddresses;
  const selectedSavedAddress = customerAddresses.find(
    (address) => address.id === selectedAddressId,
  );
  const selectedAddressState = shared.enabled
    ? !cloudAddressesAvailable && selectedAddressId
      ? 'unverified'
      : sharedCheckoutAddressState(
          selectedAddressId,
          selectedAddressSnapshot && !('ownerPhone' in selectedAddressSnapshot)
            ? selectedAddressSnapshot
            : null,
          addressBook.addresses.find((address) => address.id === selectedAddressId),
        )
    : getSelectedCheckoutAddressState(
        selectedAddressId,
        selectedAddressSnapshot && 'ownerPhone' in selectedAddressSnapshot
          ? selectedAddressSnapshot
          : null,
        localAddresses.find((address) => address.id === selectedAddressId),
      );
  const selectedAddressStale =
    addressConflict || !['new', 'current'].includes(selectedAddressState);
  const outsideDeliveryArea =
    fulfillment === 'delivery' &&
    /^\d{6}$/.test(customer.postalCode) &&
    !settings.servicePostalCodes.includes(customer.postalCode);
  const persistDraft = (changes: Partial<CurrentCheckoutDraft>) => {
    if (!draftRef.current || draftCompleted.current || !checkoutIsCurrent()) return;
    const next = { ...draftRef.current, ...changes };
    draftRef.current = next;
    if (shared.enabled)
      saveSharedCheckoutDraft(storage(), sharedScope, next as SharedCheckoutDraft);
    else saveCheckoutDraft(storage(), scope, next as CheckoutDraft);
  };
  const finishDraft = () => {
    if (!checkoutIsCurrent()) return;
    draftCompleted.current = true;
    if (shared.enabled) clearSharedCheckoutDraft(storage(), sharedScope);
    else {
      clearCheckoutDraft(storage(), scope);
      clearMatchingGuestCheckoutDraft(storage(), scope);
    }
    try {
      storage()?.removeItem(attemptStorageKey);
    } catch {
      /* Order completion remains usable without storage. */
    }
    request.current = null;
  };
  const saveAttempt = (attempt: CheckoutAttempt) => {
    request.current = attempt;
    try {
      storage()?.setItem(attemptStorageKey, JSON.stringify(attempt));
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
    persistDraft({ customer: next, addressTouched: true });
  };
  const chooseFulfillment = (choice: Fulfillment) => {
    setFulfillment(choice);
    setError('');
    persistDraft({ fulfillment: choice, ...(choice === 'pickup' ? { addressTouched: true } : {}) });
  };
  const chooseAddress = (id: string) => {
    const saved = customerAddresses.find((address) => address.id === id);
    const next = saved
      ? {
          ...saved.customer,
          ...(sessionPhone ? { phone: sessionPhone } : {}),
          instructions: customer.instructions,
        }
      : {
          ...emptyCheckoutCustomer(sessionPhone),
          name: customer.name,
          instructions: customer.instructions,
        };
    setCustomer(next);
    setSelectedAddressId(saved?.id ?? '');
    setSelectedAddressSnapshot(saved ?? null);
    setAddressLabel(saved?.label ?? '');
    setAddressRevision(shared.enabled ? addressBook.revision : null);
    setAddressConflict(false);
    setAddressMessage('');
    setAddressError('');
    setError('');
    pendingAddressId.current = null;
    persistDraft({
      customer: next,
      selectedAddressId: saved?.id ?? '',
      addressLabel: saved?.label ?? '',
      selectedAddressSnapshot: saved ?? null,
      selectedAddressRevision: shared.enabled ? addressBook.revision : null,
      addressTouched: true,
    });
  };
  const saveAddress = async () => {
    if (
      !checkoutIsCurrent() ||
      fulfillment !== 'delivery' ||
      !canSaveAddress ||
      addressSaveInFlight.current
    )
      return;
    if (selectedAddressStale) {
      setAddressError(
        'Review the current saved version before updating it, or save these details as a new address.',
      );
      return;
    }
    addressSaveInFlight.current = true;
    setAddressSaving(true);
    setAddressError('');
    setAddressMessage('');
    const selectedId = selectedAddressId;
    const label = addressLabel.trim() || 'Home';
    try {
      const id = selectedId || pendingAddressId.current || crypto.randomUUID();
      pendingAddressId.current = id;
      const input = {
        id,
        label,
        customer: { ...customer, instructions: '' },
        isDefault: selectedAddressSnapshot?.isDefault ?? false,
      };
      let saved: CheckoutAddress | undefined;
      let savedRevision: number | null = null;
      if (shared.enabled) {
        if (!cloudAddressesAvailable || addressBook.revision === null)
          throw new Error(
            'Reconnect to your saved addresses before saving. Your checkout details are kept.',
          );
        const expectedRevision = selectedId ? addressRevision : addressBook.revision;
        if (expectedRevision === null)
          throw new Error('Review the saved address before updating it.');
        const result = selectedId
          ? await addressBook.update(selectedId, input, expectedRevision)
          : await addressBook.create(input, expectedRevision);
        if (!checkoutIsCurrent()) return;
        saved = result.addresses.find((address) => address.id === id);
        savedRevision = result.revision;
      } else {
        if (!sessionPhone) return;
        if (selectedId) {
          if (!selectedAddressSnapshot || !('ownerPhone' in selectedAddressSnapshot))
            throw new Error('Review the saved address before updating it.');
          saveCustomerAddress(input, {
            mode: 'update',
            expectedOwnerPhone: sessionPhone,
            expected: selectedAddressSnapshot,
          });
        } else saveCustomerAddress(input, { mode: 'create', expectedOwnerPhone: sessionPhone });
        saved = getCustomerAddresses(useDemoStore.getState().savedAddresses, sessionPhone).find(
          (address) => address.id === id,
        );
      }
      if (!saved)
        throw new Error('Refresh your address book to confirm whether this address was saved.');
      if (!checkoutIsCurrent()) return;
      pendingAddressId.current = null;
      setSelectedAddressId(saved.id);
      setSelectedAddressSnapshot(saved);
      setAddressRevision(savedRevision);
      // An edit made while the request was pending remains in this checkout.
      const sameLabel = draftRef.current?.addressLabel === addressLabel;
      if (sameLabel) setAddressLabel(label);
      persistDraft({
        selectedAddressId: saved.id,
        selectedAddressSnapshot: saved,
        selectedAddressRevision: savedRevision,
        addressTouched: true,
        ...(sameLabel ? { addressLabel: label } : {}),
      });
      setAddressMessage(
        selectedId ? 'Saved address updated.' : 'Address saved for your next order.',
      );
    } catch (cause) {
      if (!checkoutIsCurrent()) return;
      if (cause instanceof CommerceError && (cause.status === 409 || cause.status === 404))
        setAddressConflict(true);
      setAddressError(
        cause instanceof CommerceError && cause.code === 'address_duplicate'
          ? cause.message
          : cause instanceof CommerceError && (cause.status === 409 || cause.status === 404)
            ? 'Your saved addresses changed. Your entered details are kept. Review the current saved version or keep these details as a new address before saving again.'
            : cause instanceof Error
              ? cause.message
              : 'Unable to save this address. Your checkout details are kept.',
      );
    } finally {
      addressSaveInFlight.current = false;
      if (checkoutIsCurrent()) setAddressSaving(false);
    }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current || busy || !checkoutIsCurrent()) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    setPaymentError('');
    try {
      if (!loadedAttempt.current) {
        loadedAttempt.current = true;
        try {
          const saved = JSON.parse(storage()?.getItem(attemptStorageKey) || 'null');
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
      if (shared.enabled) {
        const nextAttempt =
          attempt?.fingerprint === fingerprint
            ? attempt
            : { key: crypto.randomUUID(), fingerprint };
        saveAttempt(nextAttempt);
        const order = await shared.createOrder({
          branchId: selectedBranchId,
          customer: validated.customer,
          fulfillment,
          paymentMethod: method,
          items: cart,
          coupon,
          idempotencyKey: nextAttempt.key,
          expectedTotal: totals.total,
          expectedRoundOffPolicy: 'nearest_rupee',
        });
        if (!checkoutIsCurrent()) return;
        saveAttempt({ ...nextAttempt, orderId: order.id });
        if (isCompletedCheckout(order)) {
          finishDraft();
          const current = useDemoStore.getState();
          if (cartMatchesPlacedOrder(current.cart, order, current.selectedBranchId))
            current.clearCart();
          router.push(orderConfirmationHref(order));
          return;
        }
        setPaymentOrderId(order.id);
        setRetryReady(false);
        return;
      }
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
        finishDraft();
        router.push(`/order-success?id=${order.id}`);
        return;
      }
      setPaymentOrderId(order.id);
      setRetryReady(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to continue. Please check your details.',
      );
    } finally {
      submitting.current = false;
      if (checkoutIsCurrent()) setBusy(false);
    }
  };
  const simulate = async (success: boolean) => {
    if (
      !paymentOrder ||
      busy ||
      !checkoutIsCurrent() ||
      !simulatorAvailable ||
      isGatewayMode(paymentOrder.paymentMode)
    )
      return;
    setBusy(true);
    setPaymentError('');
    try {
      let updatedOrder = paymentOrder;
      if (shared.enabled) {
        updatedOrder = await shared.simulatePayment(
          paymentOrder.id,
          success ? 'success' : 'failed',
        );
      } else {
        updatePaymentStatus(paymentOrder.id, 'pending');
        await new Promise((resolve) => setTimeout(resolve, 650));
        if (!checkoutIsCurrent()) return;
        const status = success ? 'simulated_paid' : 'failed';
        updatePaymentStatus(paymentOrder.id, status);
      }
      if (!checkoutIsCurrent()) return;
      setRetryReady(false);
      if (success) {
        finishDraft();
        toast.success('Demo payment simulated. No money was charged.');
        if (shared.enabled) {
          const current = useDemoStore.getState();
          if (cartMatchesPlacedOrder(current.cart, updatedOrder, current.selectedBranchId))
            current.clearCart();
        }
        router.push(orderConfirmationHref(paymentOrder));
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
      if (!shared.enabled) updatePaymentStatus(paymentOrder.id, 'pending');
      router.push(orderConfirmationHref(paymentOrder));
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : 'Unable to update this payment.');
    }
  };
  if (!hydrated || !draftReady || (shared.enabled && !shared.ready && !shared.error))
    return (
      <div className="container empty-state" role="status">
        Opening your saved checkout…
      </div>
    );
  if (shared.enabled && shared.error)
    return (
      <div className="container empty-state">
        <h1>Let’s reconnect to the kitchen.</h1>
        <p role="alert">{shared.error}</p>
        <button className="btn btn-primary" onClick={() => void shared.refresh()}>
          Try again
        </button>
      </div>
    );
  if (paymentOrder && isGatewayMode(paymentOrder.paymentMode))
    return (
      <div className="container journey-page checkout-experience">
        <button type="button" className="back-link" onClick={() => setPaymentOrderId(null)}>
          <ArrowLeft size={16} /> Back to checkout
        </button>
        <div className="page-heading">
          <div>
            <span className="eyebrow">
              {isTestGatewayMode(paymentOrder.paymentMode) ? 'TEST PAYMENT' : 'SECURE PAYMENT'}
            </span>
            <h1>One last step.</h1>
            <p>Order {paymentOrder.number} is saved. Complete payment for this order below.</p>
          </div>
        </div>
        <OnlinePayment
          order={paymentOrder}
          onConfirmed={(updated) => {
            if (!checkoutIsCurrent()) return;
            if (!['cancelled', 'rejected'].includes(updated.status)) {
              finishDraft();
              const current = useDemoStore.getState();
              if (cartMatchesPlacedOrder(current.cart, updated, current.selectedBranchId))
                current.clearCart();
            }
            router.push(
              orderConfirmationHref({
                ...updated,
                trackingUrl: updated.trackingUrl ?? paymentOrder.trackingUrl,
              }),
            );
          }}
        />
        <Link className="text-link" href={orderConfirmationHref(paymentOrder)}>
          View this order and payment status <ArrowRight size={16} />
        </Link>
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
      {(shared.enabled ? !auth.user : !customerSession) && (
        <p className="checkout-account-note">
          Continue as a guest, or{' '}
          <Link href="/account/login?next=/checkout">
            sign in to save addresses and see your orders together
          </Link>
          .
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
            {canSaveAddress && shared.enabled && fulfillment === 'delivery' && (
              <div className="checkout-address-feedback" role="status">
                {addressBook.loading ? (
                  'Loading your saved addresses…'
                ) : addressBook.error ? (
                  <>
                    <p>{addressBook.error} You can still enter delivery details for this order.</p>
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => void addressBook.refresh()}
                    >
                      Retry saved addresses
                    </button>
                  </>
                ) : addressBook.addresses.length ? (
                  'Choose an address saved to your account, or enter a new one.'
                ) : (
                  'Save a delivery address to use it on your next order.'
                )}
              </div>
            )}
            {canSaveAddress && fulfillment === 'delivery' && (
              <div className="checkout-address-picker">
                <label className="field">
                  Saved address
                  <select
                    aria-label="Choose a saved delivery address"
                    disabled={addressSaving || (shared.enabled && !cloudAddressesAvailable)}
                    value={selectedAddressId}
                    onChange={(event) => chooseAddress(event.target.value)}
                  >
                    <option value="">Use a new address</option>
                    {(selectedAddressState === 'removed' ||
                      (selectedAddressId && !selectedSavedAddress)) && (
                      <option value={selectedAddressId}>
                        Previously selected address ·{' '}
                        {selectedAddressState === 'removed' ? 'Removed' : 'Checking'}
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
            {canSaveAddress && fulfillment === 'delivery' && selectedAddressStale && (
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
                  {selectedSavedAddress && (!shared.enabled || cloudAddressesAvailable) && (
                    <button
                      type="button"
                      className="btn btn-outline"
                      disabled={addressSaving}
                      onClick={() => chooseAddress(selectedAddressId)}
                    >
                      Use current saved version
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-outline"
                    disabled={addressSaving}
                    onClick={() => {
                      pendingAddressId.current = null;
                      setSelectedAddressId('');
                      setSelectedAddressSnapshot(null);
                      setAddressError('');
                      setAddressConflict(false);
                      setAddressMessage('Your entered details are ready to save as a new address.');
                      setAddressRevision(shared.enabled ? addressBook.revision : null);
                      persistDraft({
                        selectedAddressId: '',
                        selectedAddressSnapshot: null,
                        selectedAddressRevision: shared.enabled ? addressBook.revision : null,
                        addressTouched: true,
                      });
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
                  readOnly={!!sessionPhone}
                  maxLength={20}
                  value={customer.phone}
                  onChange={(e) => update('phone', e.target.value)}
                  placeholder="10-digit mobile number"
                />
                {sessionPhone && (
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
            {canSaveAddress && fulfillment === 'delivery' && (
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
                      persistDraft({ addressLabel: event.target.value, addressTouched: true });
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-outline"
                  disabled={
                    selectedAddressStale ||
                    addressSaving ||
                    addressBook.saving ||
                    (shared.enabled && !cloudAddressesAvailable)
                  }
                  onClick={() => void saveAddress()}
                >
                  {addressSaving
                    ? 'Saving address…'
                    : selectedAddressId
                      ? 'Update saved address'
                      : 'Save this address'}
                </button>
                <p className="field-help">
                  Addresses are saved only when you choose to save. Delivery instructions apply to
                  this order.
                  {shared.enabled
                    ? ' Saved addresses are available on your other devices after sign-in.'
                    : ''}
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
                <strong>
                  {shared.onlinePayment
                    ? shared.onlinePayment.mode === 'test'
                      ? `${gatewayLabels[shared.onlinePayment.provider]} test mode · No real money charged`
                      : `Secure payment with ${gatewayLabels[shared.onlinePayment.provider]}`
                    : simulatorAvailable
                      ? 'Demo checkout · No money collected'
                      : 'Online payments are currently unavailable'}
                </strong>
                <p>
                  {shared.onlinePayment
                    ? `Payment details are entered only on ${gatewayLabels[shared.onlinePayment.provider]}’s secure payment page. Never share payment credentials with the restaurant.`
                    : 'Never enter card details, bank information or a UPI PIN on this website.'}
                </p>
              </div>
            </div>
            {!fulfillmentAvailable && (
              <p role="alert" className="error-message">
                Delivery and pickup are currently unavailable. Please try again later.
              </p>
            )}
            {!availablePaymentMethods.length && (
              <p role="alert" className="error-message">
                No payment method is currently available. Please try again later.
              </p>
            )}
            {availablePaymentMethods.length > 0 && !availablePaymentMethods.includes('cash') && (
              <p className="muted" role="status">
                {fulfillment === 'pickup' ? 'Cash at pickup' : 'Cash on delivery'} is currently
                unavailable. Choose another payment method below.
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
                .filter(([value]) => availablePaymentMethods.includes(value))
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
                    <small>
                      {value === 'cash'
                        ? 'On collection'
                        : shared.onlinePayment
                          ? `${gatewayLabels[shared.onlinePayment.provider]} checkout`
                          : 'Demo payment'}
                    </small>
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
            {busy
              ? 'Sending order…'
              : method === 'cash'
                ? shared.enabled
                  ? 'Place order'
                  : 'Place demo order'
                : shared.onlinePayment
                  ? 'Continue to secure payment'
                  : 'Continue to demo payment'}
            <ArrowRight size={17} />
          </button>
          <p className="checkout-terms">
            {shared.enabled
              ? shared.onlinePayment
                ? shared.onlinePayment.mode === 'test'
                  ? `Your test order is saved online. ${gatewayLabels[shared.onlinePayment.provider]} test payments do not charge real money.`
                  : 'Your order is saved before payment. Payment is confirmed only after verification by our server.'
                : simulatorAvailable
                  ? 'Your order is sent to the restaurant. Online payments are simulated; no money is charged.'
                  : 'Your order is sent to the restaurant. Only the payment methods shown here are available.'
              : 'Local demo only. Nothing is sent to the restaurant.'}
          </p>
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
            {busy
              ? 'Sending…'
              : method === 'cash'
                ? shared.enabled
                  ? 'Place order'
                  : 'Place demo order'
                : shared.onlinePayment
                  ? 'Secure payment'
                  : 'Demo payment'}
            <ArrowRight size={17} />
          </button>
        </div>
      )}
      <Dialog
        open={!!paymentOrder && simulatorAvailable && !isGatewayMode(paymentOrder.paymentMode)}
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
                onClick={() => router.push(orderConfirmationHref(paymentOrder))}
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
                onClick={() => paymentOrder && router.push(orderConfirmationHref(paymentOrder))}
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
                onClick={() => paymentOrder && router.push(orderConfirmationHref(paymentOrder))}
              >
                View unpaid order
              </button>
            </>
          ) : (
            <div className="simulation-actions">
              <button type="button" className="btn btn-primary" onClick={() => simulate(true)}>
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
          <small className="muted">
            This simulator does not connect to any payment gateway or bank.
          </small>
        </DialogContent>
      </Dialog>
    </div>
  );
}
