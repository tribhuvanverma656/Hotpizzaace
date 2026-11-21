import test from 'node:test';
import assert from 'node:assert/strict';
import { initialSettings } from '../lib/data';
import { sameRestaurantSettings, settingsFingerprint } from '../lib/restaurant-settings';
import type { RestaurantSettings } from '../types';

test('settings comparison accepts equivalent snapshots with different object key order', () => {
  const snapshot = structuredClone(initialSettings);
  const reordered = Object.fromEntries(Object.entries(snapshot).reverse()) as RestaurantSettings;
  assert.equal(sameRestaurantSettings(snapshot, reordered), true);
  assert.equal(settingsFingerprint(snapshot), settingsFingerprint(reordered));
  assert.equal(sameRestaurantSettings(snapshot, structuredClone(snapshot)), true);
});

test('settings comparison detects changes to every saved restaurant field', () => {
  const snapshot = structuredClone(initialSettings);
  const changes: RestaurantSettings = {
    name: `${snapshot.name} updated`,
    address: `${snapshot.address} updated`,
    phone: snapshot.phone === '9876543210' ? '9876543211' : '9876543210',
    openingHours: `${snapshot.openingHours} updated`,
    temporarilyClosed: !snapshot.temporarilyClosed,
    acceptingOrders: !snapshot.acceptingOrders,
    deliveryEnabled: !snapshot.deliveryEnabled,
    pickupEnabled: !snapshot.pickupEnabled,
    deliveryFee: snapshot.deliveryFee + 1,
    freeDeliveryThreshold:
      snapshot.freeDeliveryThreshold === null ? 25000 : snapshot.freeDeliveryThreshold + 1,
    minimumOrder: snapshot.minimumOrder + 1,
    servicePostalCodes: [...snapshot.servicePostalCodes, '208001'],
    preparationMinutes: snapshot.preparationMinutes + 1,
    paymentMethods: snapshot.paymentMethods.includes('cash')
      ? snapshot.paymentMethods.filter((method) => method !== 'cash')
      : [...snapshot.paymentMethods, 'cash'],
    couponCode: snapshot.couponCode === 'UPDATED' ? 'NEWCODE' : 'UPDATED',
    couponPercent: snapshot.couponPercent + 1,
    couponMinimum: snapshot.couponMinimum + 1,
    couponMaximum: snapshot.couponMaximum + 1,
  };
  for (const key of Object.keys(changes) as (keyof RestaurantSettings)[]) {
    const changed = { ...snapshot, [key]: changes[key] };
    assert.equal(sameRestaurantSettings(snapshot, changed), false, `${key} changed`);
    assert.equal(sameRestaurantSettings(changed, snapshot), false, `${key} changed in reverse`);
  }
});

test('settings comparison preserves payment priority and postal code array changes', () => {
  const snapshot: RestaurantSettings = {
    ...initialSettings,
    paymentMethods: ['upi', 'card', 'cash'],
    servicePostalCodes: ['208027', '208001'],
  };
  assert.equal(
    sameRestaurantSettings(snapshot, { ...snapshot, paymentMethods: ['card', 'upi', 'cash'] }),
    false,
  );
  assert.equal(
    sameRestaurantSettings(snapshot, { ...snapshot, servicePostalCodes: ['208001', '208027'] }),
    false,
  );
  assert.equal(
    sameRestaurantSettings(snapshot, { ...snapshot, freeDeliveryThreshold: null }),
    snapshot.freeDeliveryThreshold === null,
  );
});
