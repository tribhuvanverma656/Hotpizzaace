import type { RestaurantSettings } from '../types';

export type SettingsSaveSnapshot = {
  branchId: string;
  settings: RestaurantSettings;
};

const settingsKeys = [
  'name',
  'address',
  'phone',
  'openingHours',
  'temporarilyClosed',
  'acceptingOrders',
  'deliveryEnabled',
  'pickupEnabled',
  'deliveryFee',
  'freeDeliveryThreshold',
  'minimumOrder',
  'servicePostalCodes',
  'preparationMinutes',
  'paymentMethods',
  'couponCode',
  'couponPercent',
  'couponMinimum',
  'couponMaximum',
] as const satisfies readonly (keyof RestaurantSettings)[];

/** Compare saved settings independently of object property insertion order. */
export function settingsFingerprint(settings: RestaurantSettings): string {
  return JSON.stringify(settingsKeys.map((key) => settings[key]));
}

export function sameRestaurantSettings(
  first: RestaurantSettings,
  second: RestaurantSettings,
): boolean {
  return settingsFingerprint(first) === settingsFingerprint(second);
}
