'use client';

import { useDemoStore } from '../store';
import type { MenuRepository, OrderRepository, SettingsRepository } from './contracts';

/** Local-only adapters. Production must replace these with authenticated server operations. */
export const mockMenuRepository: MenuRepository = {
  async listProducts() {
    return structuredClone(useDemoStore.getState().products);
  },
  async findProduct(idOrSlug) {
    return structuredClone(
      useDemoStore
        .getState()
        .products.find((product) => product.id === idOrSlug || product.slug === idOrSlug) ?? null,
    );
  },
  async saveProduct(product) {
    useDemoStore.getState().saveProduct(product);
  },
  async archiveProduct(id) {
    useDemoStore.getState().archiveProduct(id);
  },
  async listCategories() {
    return structuredClone(useDemoStore.getState().categories);
  },
  async saveCategory(category) {
    useDemoStore.getState().saveCategory(category);
  },
  async archiveCategory(id) {
    useDemoStore.getState().archiveCategory(id);
  },
};
export const mockOrderRepository: OrderRepository = {
  async listOrders() {
    return structuredClone(useDemoStore.getState().orders);
  },
  async findOrder(id) {
    return structuredClone(useDemoStore.getState().orders.find((order) => order.id === id) ?? null);
  },
  async createOrder(input) {
    return useDemoStore.getState().createOrder(input);
  },
  async updateStatus(id, status) {
    useDemoStore.getState().updateOrderStatus(id, status);
  },
  async updatePaymentStatus(id, status) {
    useDemoStore.getState().updatePaymentStatus(id, status);
  },
};
export const mockSettingsRepository: SettingsRepository = {
  async getSettings() {
    return structuredClone(useDemoStore.getState().settings);
  },
  async saveSettings(settings) {
    useDemoStore.getState().updateSettings(settings);
  },
};
