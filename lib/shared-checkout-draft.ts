import type { Customer } from '../types';
import type { CheckoutDraft } from './checkout-draft';
import { emptyCheckoutCustomer } from './checkout-draft';
import { parseSharedSavedAddress, type SharedSavedAddress } from './commerce/addresses';

export type SharedCheckoutScope = { branchId: string; userId: string | null };
export type SharedCheckoutDraft = Omit<CheckoutDraft, 'version' | 'selectedAddressSnapshot'> & {
  version: 1;
  selectedAddressSnapshot: SharedSavedAddress | null;
  selectedAddressRevision: number | null;
  /** An explicit edit or restored draft wins over an address book that loads later. */
  addressTouched: boolean;
};
type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const PREFIX = 'hot-pizza-ace-shared-checkout:v1:';
const CUSTOMER_LIMITS: Record<keyof Customer, number> = {
  name: 80,
  phone: 20,
  address: 300,
  locality: 100,
  postalCode: 6,
  landmark: 150,
  instructions: 300,
};

function identity(scope: SharedCheckoutScope) {
  return scope.userId ?? 'guest';
}

export function sharedCheckoutDraftKey(scope: SharedCheckoutScope): string {
  return `${PREFIX}${encodeURIComponent(identity(scope))}:${encodeURIComponent(scope.branchId)}`;
}

function parseCustomer(value: unknown): Customer | null {
  if (!value || typeof value !== 'object') return null;
  const fields = value as Record<string, unknown>;
  const result = {} as Customer;
  for (const key of Object.keys(CUSTOMER_LIMITS) as (keyof Customer)[]) {
    if (typeof fields[key] !== 'string' || fields[key].length > CUSTOMER_LIMITS[key]) return null;
    result[key] = fields[key];
  }
  return result;
}

function parseSnapshot(value: unknown, selectedId: string): SharedSavedAddress | null {
  if (!selectedId) return null;
  try {
    const address = parseSharedSavedAddress(value);
    return address.id === selectedId ? address : null;
  } catch {
    return null;
  }
}

export function newSharedCheckoutDraft(scope: SharedCheckoutScope): SharedCheckoutDraft {
  return {
    version: 1,
    branchId: scope.branchId,
    identity: identity(scope),
    customer: emptyCheckoutCustomer(),
    fulfillment: 'delivery',
    paymentMethod: 'upi',
    selectedAddressId: '',
    addressLabel: '',
    selectedAddressSnapshot: null,
    selectedAddressRevision: null,
    addressTouched: false,
  };
}

function parseDraft(value: unknown, scope: SharedCheckoutScope): SharedCheckoutDraft | null {
  if (!value || typeof value !== 'object') return null;
  const draft = value as Partial<SharedCheckoutDraft>;
  const customer = parseCustomer(draft.customer);
  if (
    draft.version !== 1 ||
    draft.branchId !== scope.branchId ||
    draft.identity !== identity(scope) ||
    !customer ||
    !['delivery', 'pickup'].includes(draft.fulfillment ?? '') ||
    !['upi', 'card', 'cash'].includes(draft.paymentMethod ?? '') ||
    typeof draft.selectedAddressId !== 'string' ||
    draft.selectedAddressId.length > 100 ||
    typeof draft.addressLabel !== 'string' ||
    draft.addressLabel.length > 40 ||
    typeof draft.addressTouched !== 'boolean' ||
    !(
      draft.selectedAddressRevision === null ||
      (Number.isSafeInteger(draft.selectedAddressRevision) && draft.selectedAddressRevision! >= 0)
    )
  )
    return null;
  return {
    version: 1,
    branchId: scope.branchId,
    identity: identity(scope),
    customer,
    fulfillment: draft.fulfillment!,
    paymentMethod: draft.paymentMethod!,
    selectedAddressId: draft.selectedAddressId,
    addressLabel: draft.addressLabel,
    selectedAddressSnapshot: parseSnapshot(draft.selectedAddressSnapshot, draft.selectedAddressId),
    selectedAddressRevision: draft.selectedAddressRevision!,
    addressTouched: draft.addressTouched,
  };
}

/** UID-scoped, tab-only storage; a contact phone never establishes address ownership. */
export function loadSharedCheckoutDraft(
  storage: DraftStorage | undefined,
  scope: SharedCheckoutScope,
): SharedCheckoutDraft | null {
  try {
    const text = storage?.getItem(sharedCheckoutDraftKey(scope));
    return text ? parseDraft(JSON.parse(text), scope) : null;
  } catch {
    return null;
  }
}

export function saveSharedCheckoutDraft(
  storage: DraftStorage | undefined,
  scope: SharedCheckoutScope,
  draft: SharedCheckoutDraft,
): boolean {
  try {
    const parsed = parseDraft(draft, scope);
    if (!parsed || !storage) return false;
    storage.setItem(sharedCheckoutDraftKey(scope), JSON.stringify(parsed));
    return true;
  } catch {
    return false;
  }
}

export function clearSharedCheckoutDraft(
  storage: DraftStorage | undefined,
  scope: SharedCheckoutScope,
) {
  try {
    storage?.removeItem(sharedCheckoutDraftKey(scope));
    storage?.removeItem(`${sharedCheckoutDraftKey(scope)}:attempt`);
  } catch {
    // A completed order remains usable when browser storage is unavailable.
  }
}

/** Clear the previous account across branches when the shared identity changes. */
export function clearSharedCheckoutIdentityDrafts(
  storage: Pick<Storage, 'length' | 'key' | 'removeItem'> | undefined,
  userId: string | null,
) {
  try {
    if (!storage) return;
    const prefix = `${PREFIX}${encodeURIComponent(userId ?? 'guest')}:`;
    const legacyPrefix = userId ? `shared:${userId}:hot-pizza-ace-checkout-draft:v1:` : null;
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (key && (key.startsWith(prefix) || (legacyPrefix && key.startsWith(legacyPrefix))))
        storage.removeItem(key);
    }
  } catch {
    // The provider also clears its in-memory view on every identity change.
  }
}

export function sharedCheckoutAddressState(
  selectedId: string,
  snapshot: SharedSavedAddress | null,
  current?: SharedSavedAddress,
): 'new' | 'removed' | 'unverified' | 'changed' | 'current' {
  if (!selectedId) return 'new';
  if (!current) return 'removed';
  if (!snapshot) return 'unverified';
  const fingerprint = (address: SharedSavedAddress) =>
    JSON.stringify([
      address.id,
      address.label,
      address.isDefault,
      ...(Object.keys(CUSTOMER_LIMITS) as (keyof Customer)[]).map((key) => address.customer[key]),
    ]);
  return fingerprint(snapshot) === fingerprint(current) ? 'current' : 'changed';
}

/** A delayed default must never replace a restored, edited, selected or pickup checkout. */
export function applySharedCheckoutDefault(
  draft: SharedCheckoutDraft,
  suggested: SharedSavedAddress | undefined,
  revision: number,
): SharedCheckoutDraft {
  if (
    !suggested ||
    draft.identity === 'guest' ||
    draft.fulfillment === 'pickup' ||
    draft.addressTouched ||
    draft.selectedAddressId ||
    Object.values(draft.customer).some((value) => value.trim())
  )
    return draft;
  return {
    ...draft,
    customer: { ...suggested.customer, instructions: draft.customer.instructions },
    selectedAddressId: suggested.id,
    selectedAddressSnapshot: suggested,
    selectedAddressRevision: revision,
    addressLabel: suggested.label,
  };
}
