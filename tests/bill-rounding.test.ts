import assert from 'node:assert/strict';
import test from 'node:test';
import { initialProducts, initialSettings } from '../lib/data';
import { getCartTotals, getMinimumOrderShortfall } from '../lib/pricing';
import type { BillingProfile } from '../types';

const billing: BillingProfile = {
  businessName: 'HOT PIZZA ACE',
  address: 'ME346 Barra2 Kanpur 208027',
  gstin: '09ANCPV1491R1Z3',
  fssaiNumber: '12721045000614',
  stateName: 'Uttar Pradesh',
  stateCode: '09',
  sac: '996331',
  cgstRate: 2.5,
  sgstRate: 2.5,
};

const line = (id: string) => ({ id, productId: id, quantity: 1, toppingIds: [], notes: '' });
const plain = (price: number) => ({
  ...initialProducts[0],
  price,
  sizes: [],
  crusts: [],
  toppings: [],
});

test('every fulfillment rounds new bills to the nearest rupee, with 50 paise rounding up', () => {
  const settings = { ...initialSettings, billing: undefined, deliveryFee: 0 };
  for (const fulfillment of ['dine_in', 'delivery', 'pickup'] as const) {
    for (const [paise, payable, adjustment] of [
      [0, 22000, 0],
      [1, 22000, -1],
      [49, 22000, -49],
      [50, 22100, 50],
      [51, 22100, 49],
      [90, 22100, 10],
      [99, 22100, 1],
    ]) {
      const product = plain(22000 + paise);
      const totals = getCartTotals([line(product.id)], [product], settings, '', fulfillment);
      assert.equal(totals.subtotal, 22000 + paise);
      assert.equal(totals.total, payable);
      assert.equal(totals.roundOff, adjustment);
      assert.equal(totals.roundOffPolicy, 'nearest_rupee');
      assert.equal(
        getMinimumOrderShortfall(totals.total, { minimumOrder: 22050 }, fulfillment),
        fulfillment === 'pickup' || payable >= 22050 ? 0 : 50,
      );
    }
  }
  const empty = getCartTotals([], [], settings);
  assert.equal(empty.roundOff, undefined);
  assert.equal(empty.roundOffPolicy, undefined);
  for (const [price, payable] of [
    [49, 0],
    [50, 100],
    [99, 100],
  ]) {
    const product = plain(price);
    const calculate = () => getCartTotals([line(product.id)], [product], settings, '', 'pickup');
    if (!payable) assert.throws(calculate, /at least ₹1/);
    else assert.equal(calculate().total, payable);
  }
});

test('food GST and delivery stay in paise while only the new payable total is rounded', () => {
  const product = plain(21000);
  const settings = { ...initialSettings, billing, deliveryFee: 0 };
  const totals = getCartTotals([line(product.id)], [product], settings, '', 'pickup');
  assert.equal(totals.tax?.taxableValue, 21000);
  assert.equal(totals.tax?.cgst, 525);
  assert.equal(totals.tax?.sgst, 525);
  assert.equal(totals.total, 22100);
  assert.equal(totals.roundOff, 50);
  assert.equal(totals.roundOffPolicy, 'nearest_rupee');
});

test('MRP-only bills stay within the listed subtotal, including after discounts', () => {
  const settings = {
    ...initialSettings,
    billing,
    deliveryFee: 0,
    couponCode: 'TEST',
    couponPercent: 100,
    couponMinimum: 0,
    couponMaximum: 70,
  };
  for (const [price, payable, adjustment] of [
    [1000, 1000, 0],
    [2000, 2000, 0],
    [2049, 2000, -49],
    [2050, 2000, -50],
    [2099, 2000, -99],
  ]) {
    const product = { ...plain(price), gstInclusive: { rateBps: 500, code: '2201' } };
    const totals = getCartTotals([line(product.id)], [product], settings, '', 'pickup');
    assert.equal(totals.total, payable);
    assert.equal(totals.roundOff, adjustment);
    assert.equal(totals.roundOffPolicy, 'nearest_rupee');
    assert.ok(totals.total <= totals.subtotal);
  }
  const mrp = { ...plain(2050), gstInclusive: { rateBps: 500, code: '2201' } };
  const discounted = getCartTotals([line(mrp.id)], [mrp], settings, 'TEST', 'pickup');
  assert.equal(discounted.discount, 70);
  assert.equal(discounted.total, 2000);
  assert.equal(discounted.roundOff, 20, 'a discounted MRP can round up within its subtotal');
  assert.ok(discounted.total <= discounted.subtotal);

  const tooSmall = { ...mrp, price: 99 };
  assert.throws(
    () => getCartTotals([line(tooSmall.id)], [tooSmall], settings, '', 'pickup'),
    /at least ₹1/,
    'a fractional MRP cannot be rounded above its ceiling merely to reach ₹1',
  );
});

test('mixed food/MRP and delivery bills use standard rounding without changing included GST', () => {
  const food = { ...plain(10000), id: 'food' };
  const mrp = { ...plain(2050), id: 'mrp', gstInclusive: { rateBps: 500, code: '2201' } };
  const settings = { ...initialSettings, billing, deliveryFee: 4900, freeDeliveryThreshold: null };
  const mixed = getCartTotals([line(food.id), line(mrp.id)], [food, mrp], settings, '', 'pickup');
  assert.equal(mixed.subtotal, 12050);
  assert.equal(mixed.tax?.includedTotal, 98);
  assert.equal(mixed.tax?.total, 598);
  assert.equal(mixed.total, 12600);
  assert.equal(mixed.roundOff, 50);
  const delivery = getCartTotals([line(mrp.id)], [mrp], settings, '', 'delivery');
  assert.equal(delivery.deliveryFee, 4900);
  assert.equal(delivery.tax?.includedTotal, 98);
  assert.equal(delivery.tax?.total, 344);
  assert.equal(delivery.total, 7200);
  assert.equal(delivery.roundOff, 4);
});

test('zero-value or fully discounted food remains an exclusive group in mixed MRP baskets', () => {
  const food = { ...plain(0), id: 'food' };
  const mrp = { ...plain(2050), id: 'mrp', gstInclusive: { rateBps: 500, code: '2201' } };
  const settings = { ...initialSettings, billing, deliveryFee: 0 };
  const freeFood = getCartTotals(
    [line(food.id), line(mrp.id)],
    [food, mrp],
    settings,
    '',
    'pickup',
  );
  assert.equal(freeFood.tax?.groups?.length, 2);
  assert.equal(freeFood.tax?.groups?.find((group) => group.pricing === 'exclusive')?.grossValue, 0);
  assert.equal(freeFood.total, 2100);
  assert.equal(
    freeFood.roundOff,
    50,
    'this is a mixed basket in both pricing and database classification',
  );
  const discounted = getCartTotals(
    [line(food.id), line(mrp.id)],
    [{ ...food, price: 1 }, mrp],
    { ...settings, couponCode: 'CUT', couponPercent: 100, couponMaximum: 1026, couponMinimum: 0 },
    'CUT',
    'pickup',
  );
  const exclusive = discounted.tax?.groups?.find((group) => group.pricing === 'exclusive');
  assert.equal(exclusive?.grossValue, 1);
  assert.equal(exclusive?.discount, 1);
  assert.equal(exclusive?.taxableValue, 0);
  assert.equal(
    discounted.tax?.groups?.length,
    2,
    'zero taxable value must not remove its classification',
  );
  assert.equal(discounted.total, 1000);
  assert.equal(discounted.roundOff, -25);
});
