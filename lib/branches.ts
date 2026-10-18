import type { Branch, Order } from '../types';

/** Orders created before branch support belong to the original Barra restaurant. */
export const DEFAULT_BRANCH_ID = 'barra';

export function isBranchOpen(branch: Branch): boolean {
  const settings = branch.settings;
  return (
    settings.acceptingOrders &&
    !settings.temporarilyClosed &&
    (settings.deliveryEnabled || settings.pickupEnabled)
  );
}

/** Include paused kitchens so the selector can explain coverage separately from availability. */
export function branchesForPostalCode(branches: Branch[], postalCode: string): Branch[] {
  if (!/^\d{6}$/.test(postalCode)) return [];
  return branches.filter(
    (branch) =>
      branch.settings.deliveryEnabled && branch.settings.servicePostalCodes.includes(postalCode),
  );
}

export function getOrderBranchId(order: Pick<Order, 'branchId'>): string {
  return order.branchId || DEFAULT_BRANCH_ID;
}

/** Receipts resolve their own branch, independently of customer or admin navigation. */
export function getOrderBranchDetails(
  order: Pick<Order, 'branchId' | 'branchName' | 'branchAddress' | 'branchPhone'>,
  branches: Branch[],
) {
  const id = getOrderBranchId(order);
  const branch = branches.find((candidate) => candidate.id === id);
  return {
    id,
    name: order.branchName || branch?.name || 'Hot Pizza Ace',
    address: order.branchAddress || branch?.settings.address || null,
    phone: order.branchPhone || branch?.settings.phone || null,
    preparationMinutes: branch?.settings.preparationMinutes ?? null,
  };
}
