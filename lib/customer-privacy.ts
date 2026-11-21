/** Display/cache isolation only. This digest is never an authorization capability. */
export type CustomerPrivacyContext = { contextId: string; userId: string | null };
type PrivacyStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
const CONTEXT_KEY = 'hpa-customer-privacy-context:v1';
const CHECKOUT_PREFIX = 'hot-pizza-ace-shared-checkout:v1:';
const QR_PREFIX = 'hpa-table-request:';

export function parseCustomerPrivacyContext(
  configured: unknown,
  contextId: unknown,
  userId: string | null,
): CustomerPrivacyContext | null {
  if (configured === false && contextId === null && userId === null) return null;
  if (configured !== true || typeof contextId !== 'string' || !/^[a-f0-9]{64}$/.test(contextId))
    throw new Error('Invalid browser session response.');
  return { contextId, userId };
}

/** Clear private drafts only; public carts, menu data and branch choices stay intact. */
export function clearCustomerPrivateDrafts(storage: PrivacyStorage | undefined): void {
  try {
    if (!storage) return;
    for (let index = storage.length - 1; index >= 0; index--) {
      const key = storage.key(index);
      if (
        key &&
        (key.startsWith(CHECKOUT_PREFIX) ||
          key.startsWith(QR_PREFIX) ||
          /^shared:[^:]+:hot-pizza-ace-checkout-draft:v1:/.test(key))
      )
        storage.removeItem(key);
    }
  } catch {
    // Context-scoped UI and requests remain isolated when storage is blocked.
  }
}

/** Repeated verification of the same guest context preserves its checkout/payment retry. */
export function reconcileCustomerPrivacyStorage(
  storage: PrivacyStorage | undefined,
  next: CustomerPrivacyContext,
): boolean {
  try {
    if (!storage) return false;
    const saved = storage.getItem(CONTEXT_KEY);
    let previous: CustomerPrivacyContext | null = null;
    if (saved !== null) {
      try {
        const value = JSON.parse(saved);
        previous = parseCustomerPrivacyContext(true, value?.contextId, value?.userId);
        if (!(previous?.userId === null || typeof previous?.userId === 'string')) previous = null;
      } catch {
        // An invalid cache marker must never restore an earlier person's draft.
      }
    }
    const changed =
      previous !== null
        ? previous.contextId !== next.contextId || previous.userId !== next.userId
        : saved !== null || next.userId !== null;
    if (changed) clearCustomerPrivateDrafts(storage);
    storage.setItem(CONTEXT_KEY, JSON.stringify(next));
    return changed;
  } catch {
    return false;
  }
}

export function branchQrDraftKey(contextId: string, token: string, generation: number): string {
  if (!/^[a-f0-9]{64}$/.test(contextId)) throw new Error('Verify this browser session first.');
  return `${QR_PREFIX}v2:${contextId}:${token}:${generation}`;
}
