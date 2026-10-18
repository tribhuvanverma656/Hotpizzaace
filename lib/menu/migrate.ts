import type { Category, Product, RestaurantSettings } from '../../types';
import { initialSettings } from '../data';
import {
  initialProducts as legacyProducts,
  initialSettings as legacySettings,
} from '../legacy-demo-data';
import { MENU_REVISION, menuCategories, menuProducts } from './catalog';

type SavedState = {
  products?: Product[];
  categories?: Category[];
  settings?: RestaurantSettings;
  [key: string]: unknown;
};

/** Import the supplied menu once, keeping receipts, custom items, carts and sessions. */
export function migrateMenuState(value: unknown, version: number): SavedState {
  const state = (value && typeof value === 'object' ? value : {}) as SavedState;
  if (version >= MENU_REVISION) return state;
  if (version >= 2) {
    const sourceById = new Map(menuProducts.map((product) => [product.id, product]));
    // Refresh only import-provided images; preserve admin-uploaded or custom URLs.
    const importImages = new Set([
      '/images/margherita.jpg',
      '/images/farmhouse.jpg',
      '/images/paneer-tikka.jpg',
      '/images/veggie-supreme.jpg',
      '/images/fries.jpg',
      '/images/garlic-bread.jpg',
      '/images/veggie-burger.jpg',
      '/images/choco-lava.jpg',
      '/images/combo.jpg',
      '/images/lemonade.jpg',
      '/images/menu-pasta-red.jpg',
      '/images/menu-pasta-white.jpg',
      '/images/menu-pizza-puff.jpg',
      '/images/menu-rice.jpg',
      '/images/menu-pav-bhaji.jpg',
      '/images/menu-wrap.jpg',
      '/images/menu-milkshake.jpg',
      '/images/menu-dips.svg',
    ]);
    return {
      ...state,
      products: state.products?.map((product) => {
        const source = sourceById.get(product.id);
        if (!source) return product;
        return {
          ...product,
          image:
            importImages.has(product.image) ||
            product.image === `/images/menu/${source.slug}.jpg` ||
            product.image === '/images/menu/photo-coming-soon.svg'
              ? source.image
              : product.image,
          ...(product.slug === 'onion-paneer' && product.price === 11900 ? { price: 10900 } : {}),
          ...(product.slug === 'spicy-veg-wonder' &&
          product.description ===
            'Crispy capsicum, red pepper, onion, baby corn, jalapeño, black olives and mushroom.'
            ? { description: source.description }
            : {}),
        };
      }),
    };
  }
  const sourceIds = new Set(menuProducts.map((product) => product.id));
  const legacyIds = new Set(legacyProducts.map((product) => product.id));
  const retainedProducts = (state.products ?? [])
    .filter((product) => !sourceIds.has(product.id))
    .map((product) =>
      legacyIds.has(product.id) ? { ...product, archived: true, available: false } : product,
    );
  const categoryIds = new Set(menuCategories.map((category) => category.id));
  const retainedCategories = (state.categories ?? [])
    .filter((category) => !categoryIds.has(category.id))
    .map((category, index) => ({
      ...category,
      archived: !retainedProducts.some(
        (product) => product.categoryId === category.id && !product.archived,
      ),
      sortOrder: menuCategories.length + index,
    }));
  const settings = state.settings ?? initialSettings;
  return {
    ...state,
    products: [...structuredClone(menuProducts), ...retainedProducts],
    categories: [...structuredClone(menuCategories), ...retainedCategories],
    settings: {
      ...settings,
      address: initialSettings.address,
      phone: initialSettings.phone,
      openingHours: initialSettings.openingHours,
      deliveryFee:
        settings.deliveryFee === legacySettings.deliveryFee
          ? initialSettings.deliveryFee
          : settings.deliveryFee,
      servicePostalCodes:
        JSON.stringify(settings.servicePostalCodes) ===
        JSON.stringify(legacySettings.servicePostalCodes)
          ? initialSettings.servicePostalCodes
          : settings.servicePostalCodes,
    },
  };
}
