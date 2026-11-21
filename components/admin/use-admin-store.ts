'use client';

import { useRef, useState } from 'react';
import { useDemoStore } from '@/lib/store';
import { useSharedCommerce } from '@/components/shared-commerce-provider';
import type { Branch, Category, Product, RestaurantSettings } from '@/types';

/** Public menu rendering may use the hydrated catalog; private orders never fall back locally. */
export function useAdminStore() {
  const local = useDemoStore();
  const shared = useSharedCommerce();
  const inFlight = useRef(false);
  const [saving, setSaving] = useState(false);
  const mutate = async (
    action: string,
    args: unknown[],
    fallback: () => void,
    expectedRevision = shared.revision,
  ) => {
    if (!shared.enabled) return fallback();
    if (!shared.admin) throw new Error('Sign in with an authorized restaurant account.');
    if (inFlight.current) throw new Error('Please wait for the current change to finish saving.');
    inFlight.current = true;
    setSaving(true);
    try {
      await shared.mutateCatalog(action, args, expectedRevision);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };
  return {
    ...local,
    orders: shared.enabled ? shared.adminOrders : local.orders,
    shared,
    saving,
    saveProduct: (product: Product, expectedRevision?: number) =>
      mutate('saveProduct', [product], () => local.saveProduct(product), expectedRevision),
    archiveProduct: (id: string) => mutate('archiveProduct', [id], () => local.archiveProduct(id)),
    saveCategory: (category: Category, expectedRevision?: number) =>
      mutate('saveCategory', [category], () => local.saveCategory(category), expectedRevision),
    archiveCategory: (id: string) =>
      mutate('archiveCategory', [id], () => local.archiveCategory(id)),
    deleteCategory: (id: string) => mutate('deleteCategory', [id], () => local.deleteCategory(id)),
    reorderCategory: (id: string, direction: 'up' | 'down') =>
      mutate('reorderCategory', [id, direction], () => local.reorderCategory(id, direction)),
    saveBranch: (branch: Branch, expectedRevision?: number) =>
      mutate('saveBranch', [branch], () => local.saveBranch(branch), expectedRevision),
    updateSettings: (
      settings: RestaurantSettings,
      expected: { branchId: string; settings: RestaurantSettings },
    ) =>
      mutate('updateSettings', [settings, expected], () =>
        local.updateSettings(settings, expected),
      ),
    setPaymentMethodEnabled: (
      method: RestaurantSettings['paymentMethods'][number],
      enabled: boolean,
      branchId: string,
    ) =>
      mutate('setPaymentMethodEnabled', [method, enabled, branchId], () =>
        local.setPaymentMethodEnabled(method, enabled, branchId),
      ),
  };
}
