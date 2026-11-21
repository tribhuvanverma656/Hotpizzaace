import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateRestaurantGst } from '../lib/billing';
import { getCartTotals } from '../lib/pricing';
import { initialSettings, initialProducts } from '../lib/data';
import type { BillingProfile } from '../types';

const profile: BillingProfile = {
  businessName: 'HOT PIZZA ACE',
  address: 'ME 346, Barra 2, Kanpur 208027',
  gstin: '09ANCPV1491R1Z3',
  fssaiNumber: '12721045000614',
  stateName: 'Uttar Pradesh',
  stateCode: '09',
  sac: '996331',
  cgstRate: 2.5,
  sgstRate: 2.5,
};

test('GST is added on top of base prices, with separately rounded CGST and SGST in paise', () => {
  assert.deepEqual(calculateRestaurantGst(10000, profile), {
    supplier: profile,
    taxableValue: 10000,
    cgst: 250,
    sgst: 250,
    total: 500,
  });
  assert.equal(calculateRestaurantGst(21900, profile).total, 1096);
  for (const taxable of [0, 1, 19, 20, 21, 101, 99999]) {
    const tax = calculateRestaurantGst(taxable, profile);
    assert.equal(tax.cgst, tax.sgst);
    assert.equal(tax.cgst, Math.round(taxable / 40));
    assert.equal(tax.total, tax.cgst + tax.sgst);
  }
  for (const value of [-1, NaN, Infinity, 1.5, 100000001])
    assert.throws(() => calculateRestaurantGst(value, profile));
});
test('discounts reduce taxable food, supplier delivery is included, pickup/free delivery stay zero', () => {
  const product = { ...initialProducts[0], price: 10000, sizes: [], crusts: [], toppings: [] };
  const line = { id: 'test-line', productId: product.id, toppingIds: [], notes: '', quantity: 1 };
  const settings = {
    ...initialSettings,
    billing: profile,
    couponCode: 'TEST10',
    couponPercent: 10,
    couponMinimum: 0,
    couponMaximum: 99999,
  };
  const totals = getCartTotals([line], [product], settings, 'TEST10', 'delivery');
  assert.equal(totals.subtotal, 10000);
  assert.equal(totals.discount, 1000);
  assert.equal(totals.deliveryFee, 4900);
  assert.equal(totals.tax?.taxableValue, 13900);
  assert.equal(totals.total, 14600);
  const pickup = getCartTotals([line], [product], settings, 'TEST10', 'pickup');
  assert.equal(pickup.deliveryFee, 0);
  assert.equal(pickup.total, 9500);
  const free = getCartTotals([{ ...line, quantity: 3 }], [product], settings, '', 'delivery');
  assert.equal(free.deliveryFee, 0);
  assert.equal(free.total, 31500);
  assert.equal(getCartTotals([], [], settings).total, 0);
});
test('order tax profiles are snapshots and unconfigured/old receipts are not retroactively taxed', () => {
  const original = structuredClone(profile);
  const tax = calculateRestaurantGst(10000, original);
  original.businessName = 'Changed';
  assert.equal(tax.supplier.businessName, 'HOT PIZZA ACE');
  assert.throws(() => calculateRestaurantGst(10000, { ...profile, stateCode: '10' as '09' }));
  assert.throws(() => calculateRestaurantGst(10000, { ...profile, cgstRate: 5 as 2.5 }));
});
