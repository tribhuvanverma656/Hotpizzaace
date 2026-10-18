import type { Customer, Fulfillment, Order, SavedAddress } from '../types';
import { normalizeCustomerPhone } from './customer-auth';
import { parseCustomerAddress } from './customer-addresses';

export const CHECKOUT_DRAFT_VERSION = 1;
export type CheckoutDraftScope = { branchId: string; phone?: string | null };
export type CheckoutDraft = {
  version: typeof CHECKOUT_DRAFT_VERSION;
  branchId: string;
  identity: string;
  customer: Customer;
  fulfillment: Fulfillment;
  paymentMethod: 'upi' | 'card' | 'cash';
  selectedAddressId: string;
  addressLabel: string;
  selectedAddressSnapshot: SavedAddress | null;
};
type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type AddressSuggestion = Pick<SavedAddress, 'id' | 'label' | 'customer'> &
  Partial<Pick<SavedAddress, 'ownerPhone' | 'isDefault'>>;

function identity(scope: CheckoutDraftScope) {
  return scope.phone ? normalizeCustomerPhone(scope.phone) : 'guest';
}

export function checkoutDraftKey(scope: CheckoutDraftScope): string {
  return `hot-pizza-ace-checkout-draft:v${CHECKOUT_DRAFT_VERSION}:${encodeURIComponent(scope.branchId)}:${identity(scope)}`;
}

export function isCheckoutScopeCurrent(
  scope: CheckoutDraftScope,
  current: CheckoutDraftScope,
): boolean {
  try {
    return scope.branchId === current.branchId && identity(scope) === identity(current);
  } catch {
    return false;
  }
}

function addressSnapshot(
  value: unknown,
  scope: CheckoutDraftScope,
  selectedId: string,
): SavedAddress | null {
  if (!value || typeof value !== 'object' || !scope.phone) return null;
  try {
    const address = value as SavedAddress;
    if (address.id !== selectedId || normalizeCustomerPhone(address.ownerPhone) !== identity(scope))
      return null;
    return parseCustomerAddress(address, scope.phone);
  } catch {
    return null;
  }
}

function addressFingerprint(address: SavedAddress): string {
  return JSON.stringify([
    address.id,
    address.ownerPhone,
    address.label,
    address.isDefault,
    ...(
      ['name', 'phone', 'address', 'locality', 'postalCode', 'landmark', 'instructions'] as const
    ).map((key) => address.customer[key]),
  ]);
}

export function getSelectedCheckoutAddressState(
  selectedId: string,
  expected: SavedAddress | null,
  current?: SavedAddress,
): 'new' | 'removed' | 'unverified' | 'changed' | 'current' {
  if (!selectedId) return 'new';
  if (!current) return 'removed';
  if (!expected) return 'unverified';
  return addressFingerprint(expected) === addressFingerprint(current) ? 'current' : 'changed';
}

export function emptyCheckoutCustomer(phone = ''): Customer {
  return {
    name: '',
    phone,
    address: '',
    locality: '',
    postalCode: '',
    landmark: '',
    instructions: '',
  };
}

export function hasCheckoutDetails(customer: Customer, phone?: string | null): boolean {
  const fields: (keyof Customer)[] = [
    'name',
    'address',
    'locality',
    'postalCode',
    'landmark',
    'instructions',
  ];
  return (
    fields.some((field) => customer[field].trim().length > 0) ||
    (!phone && customer.phone.trim().length > 0)
  );
}

function parseDraft(value: unknown, scope: CheckoutDraftScope): CheckoutDraft | null {
  if (!value || typeof value !== 'object') return null;
  const draft = value as Partial<CheckoutDraft>;
  if (
    draft.version !== CHECKOUT_DRAFT_VERSION ||
    draft.branchId !== scope.branchId ||
    draft.identity !== identity(scope)
  )
    return null;
  if (
    !['delivery', 'pickup'].includes(draft.fulfillment ?? '') ||
    !['upi', 'card', 'cash'].includes(draft.paymentMethod ?? '')
  )
    return null;
  if (!draft.customer || typeof draft.customer !== 'object') return null;
  const limits: Record<keyof Customer, number> = {
    name: 80,
    phone: 20,
    address: 300,
    locality: 100,
    postalCode: 6,
    landmark: 150,
    instructions: 300,
  };
  for (const [field, limit] of Object.entries(limits)) {
    const text = draft.customer[field as keyof Customer];
    if (typeof text !== 'string' || text.length > limit) return null;
  }
  if (
    typeof draft.selectedAddressId !== 'string' ||
    draft.selectedAddressId.length > 100 ||
    typeof draft.addressLabel !== 'string' ||
    draft.addressLabel.length > 40
  )
    return null;
  return {
    ...(draft as CheckoutDraft),
    customer: {
      ...draft.customer,
      ...(scope.phone ? { phone: normalizeCustomerPhone(scope.phone) } : {}),
    },
    selectedAddressSnapshot: addressSnapshot(
      draft.selectedAddressSnapshot,
      scope,
      draft.selectedAddressId,
    ),
  };
}

export function loadCheckoutDraft(
  storage: DraftStorage | undefined,
  scope: CheckoutDraftScope,
): CheckoutDraft | null {
  try {
    const value = storage?.getItem(checkoutDraftKey(scope));
    return value ? parseDraft(JSON.parse(value), scope) : null;
  } catch {
    return null;
  }
}

/** A customer's edited draft wins over their address book; empty forms may use the default. */
export function initializeCheckoutDraft(
  scope: CheckoutDraftScope,
  saved: CheckoutDraft | null,
  suggested?: AddressSuggestion,
  guestDraft?: CheckoutDraft | null,
): CheckoutDraft {
  const phone = scope.phone ? normalizeCustomerPhone(scope.phone) : '';
  if (phone && !saved && !suggested && guestDraft && hasCheckoutDetails(guestDraft.customer)) {
    try {
      if (
        guestDraft.branchId === scope.branchId &&
        guestDraft.identity === 'guest' &&
        normalizeCustomerPhone(guestDraft.customer.phone) === phone
      )
        return {
          ...guestDraft,
          branchId: scope.branchId,
          identity: phone,
          customer: { ...guestDraft.customer, phone },
          selectedAddressId: '',
          selectedAddressSnapshot: null,
        };
    } catch {
      // A guest draft with an incomplete or different phone cannot identify this customer.
    }
  }
  const draft = (saved && parseDraft(saved, scope)) || {
    version: CHECKOUT_DRAFT_VERSION,
    branchId: scope.branchId,
    identity: identity(scope),
    customer: emptyCheckoutCustomer(phone),
    fulfillment: 'delivery' as const,
    paymentMethod: 'upi' as const,
    selectedAddressId: '',
    addressLabel: '',
    selectedAddressSnapshot: null,
  };
  if (phone && suggested && !hasCheckoutDetails(draft.customer, phone))
    return {
      ...draft,
      customer: { ...suggested.customer, phone, instructions: draft.customer.instructions },
      selectedAddressId: suggested.id,
      addressLabel: suggested.label,
      selectedAddressSnapshot: addressSnapshot(suggested, scope, suggested.id),
    };
  return { ...draft, customer: { ...draft.customer, ...(phone ? { phone } : {}) } };
}

export function saveCheckoutDraft(
  storage: DraftStorage | undefined,
  scope: CheckoutDraftScope,
  draft: CheckoutDraft,
): boolean {
  try {
    const parsed = parseDraft(draft, scope);
    if (!storage || !parsed) return false;
    storage.setItem(checkoutDraftKey(scope), JSON.stringify(parsed));
    return true;
  } catch {
    return false;
  }
}

export function clearCheckoutDraft(
  storage: DraftStorage | undefined,
  scope: CheckoutDraftScope,
): boolean {
  try {
    if (!storage) return false;
    storage.removeItem(checkoutDraftKey(scope));
    return true;
  } catch {
    return false;
  }
}

/** Consume a guest draft only when its contact phone identifies the signed-in customer. */
export function clearMatchingGuestCheckoutDraft(
  storage: DraftStorage | undefined,
  scope: CheckoutDraftScope,
): boolean {
  try {
    if (!scope.phone) return false;
    const guestScope = { branchId: scope.branchId };
    const guest = loadCheckoutDraft(storage, guestScope);
    if (
      !guest ||
      normalizeCustomerPhone(guest.customer.phone) !== normalizeCustomerPhone(scope.phone)
    )
      return false;
    return clearCheckoutDraft(storage, guestScope);
  } catch {
    return false;
  }
}

export function isCompletedCheckout(
  order: Pick<Order, 'paymentMethod' | 'paymentStatus'>,
): boolean {
  return order.paymentMethod === 'cash' || order.paymentStatus === 'simulated_paid';
}
