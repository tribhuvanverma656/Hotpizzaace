import { initialBranches, initialSettings } from './data';
import { migrateMenuState } from './menu/migrate';
import { mrpWaterProducts } from './menu/catalog';

// Versions 1–4 imported the catalogue; 5 added a threshold; 6 applies the confirmed fee.
export const STORE_VERSION = 9;

export function migrateDemoState(value: unknown, version: number) {
  let state = migrateMenuState(value, version);
  if (version < 5) {
    state = {
      ...state,
      settings: {
        ...(state.settings ?? initialSettings),
        freeDeliveryThreshold: initialSettings.freeDeliveryThreshold,
      },
    };
  }
  if (version < 6) {
    state = {
      ...state,
      settings: {
        ...(state.settings ?? initialSettings),
        deliveryFee: initialSettings.deliveryFee,
      },
    };
  }
  if (version < 7) {
    state = {
      ...state,
      branches: [
        { ...initialBranches[0], settings: structuredClone(state.settings ?? initialSettings) },
      ],
      selectedBranchId: 'barra',
      adminBranchId: 'barra',
      cartBranchId: Array.isArray(state.cart) && state.cart.length ? 'barra' : null,
    };
  }
  if (version < 8) {
    state = {
      ...state,
      savedAddresses: Array.isArray(state.savedAddresses) ? state.savedAddresses : [],
    };
  }
  if (version < 9 && Array.isArray(state.products)) {
    const products = state.products;
    state = {
      ...state,
      // Add the requested items once; never overwrite an owner's existing edits.
      products: [
        ...products,
        ...structuredClone(
          mrpWaterProducts.filter(
            (item) =>
              !products.some((product) => product.id === item.id || product.slug === item.slug),
          ),
        ),
      ],
    };
  }
  return state;
}
