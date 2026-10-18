import type { Branch, RestaurantSettings } from '../types';
import { initialSettings as legacySettings } from './legacy-demo-data';
export {
  menuCategories as initialCategories,
  menuProducts as initialProducts,
} from './menu/catalog';
// Historical receipts retain their original item and price snapshots.
export { initialOrders } from './legacy-demo-data';

export const initialSettings: RestaurantSettings = {
  ...legacySettings,
  address:
    'ME 346, near Ram Janki Mandir, Hemat Vihar, Barra 2, Barra World Bank, Barra, Kanpur, Uttar Pradesh 208027',
  phone: '+91 70815 55055',
  openingHours: 'Every day · 11:00 AM – 12:00 midnight',
  deliveryFee: 4900,
  freeDeliveryThreshold: 25000,
  servicePostalCodes: ['208027'],
};

export const initialBranches: Branch[] = [
  {
    id: 'barra',
    slug: 'barra',
    name: 'Barra · Kanpur',
    settings: structuredClone(initialSettings),
  },
];
