import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateOrderGst, calculateRestaurantGst } from '../lib/billing';
import { initialBranches, initialCategories, initialProducts, initialSettings } from '../lib/data';
import { getCartTotals, getUnitPrice } from '../lib/pricing';
import { productSchema } from '../lib/validation';
import {
  parseCreateOrderRequest,
  priceSharedOrder,
  type CommerceCatalog,
} from '../lib/commerce/domain';
import { parseCounterOrderRequest, priceCounterOrder } from '../lib/counter';
import type { BillingProfile, CartItem, Product } from '../types';

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
const settings = {
  ...initialSettings,
  billing,
  deliveryFee: 4900,
  freeDeliveryThreshold: null,
  couponCode: 'TEN',
  couponPercent: 10,
  couponMinimum: 0,
  couponMaximum: 100_000_000,
};
function product(id: string, price: number, gstInclusive?: Product['gstInclusive']): Product {
  return {
    ...structuredClone(initialProducts[0]),
    id,
    price,
    sizes: [],
    crusts: [],
    toppings: [],
    ...(gstInclusive ? { gstInclusive } : {}),
  };
}
function line(p: Product, quantity = 1): CartItem {
  return { id: `line-${p.id}`, productId: p.id, quantity, toppingIds: [], notes: '' };
}
const water = () => product('water', 2000, { rateBps: 1800, code: '2201' });

test('packaged cold-drink MRP also stays unchanged at its explicitly configured rate', () => {
  const drink = product('packaged-cold-drink', 4000, { rateBps: 4000, code: '2202' });
  const totals = getCartTotals([line(drink, 2)], [drink], settings, '', 'pickup');
  assert.equal(totals.total, 8000);
  assert.equal(totals.tax?.includedTotal, totals.tax?.total);
  const food = product('food', 10000);
  assert.equal(
    getCartTotals([line(food), line(drink)], [food, drink], settings, '', 'pickup').total,
    14500,
  );
});

test('configured MRP water keeps the selling price and extracts its included GST, without exemption', () => {
  const p = water();
  const totals = getCartTotals([line(p)], [p], settings, '', 'pickup');
  assert.equal(totals.subtotal, 2000);
  assert.equal(totals.total, 2000);
  assert.equal(totals.tax?.version, 2);
  assert.equal(totals.tax?.includedTotal, 306);
  assert.equal(totals.tax?.cgst, 153);
  assert.equal(totals.tax?.sgst, 153);
  assert.equal(totals.tax?.taxableValue, 1694);
  assert.deepEqual(totals.tax?.groups, [
    {
      pricing: 'inclusive',
      rateBps: 1800,
      code: '2201',
      grossValue: 2000,
      deliveryFee: 0,
      discount: 0,
      taxableValue: 1694,
      cgst: 153,
      sgst: 153,
      total: 306,
    },
  ]);
  assert.equal(getCartTotals([line(p, 3)], [p], settings, '', 'pickup').total, 6000);
});

test('mixed cart adds restaurant GST only on exclusive food and delivery, with included GST reconciled', () => {
  const products = [product('pizza', 10_000), water()];
  const cart = products.map((p) => line(p));
  const pickup = getCartTotals(cart, products, settings, '', 'pickup');
  assert.equal(pickup.total, 12_500);
  assert.equal(pickup.tax?.total, 806);
  assert.equal(pickup.tax?.includedTotal, 306);
  const delivery = getCartTotals(cart, products, settings, '', 'delivery');
  assert.equal(delivery.total, 17_600);
  assert.equal(delivery.tax?.groups?.[0].deliveryFee, 4900);
  assert.equal(delivery.tax?.groups?.[1].deliveryFee, 0);
  assert.ok(delivery.tax);
  assert.equal(
    delivery.tax.taxableValue + delivery.tax.total + (delivery.roundOff ?? 0),
    delivery.total,
  );
  const waterOnlyDelivery = getCartTotals([line(products[1])], products, settings, '', 'delivery');
  assert.equal(waterOnlyDelivery.total, 7100);
  assert.deepEqual(
    waterOnlyDelivery.tax?.groups?.map((g) => [g.pricing, g.grossValue, g.deliveryFee]),
    [
      ['exclusive', 0, 4900],
      ['inclusive', 2000, 0],
    ],
  );
});

test('mixed coupons allocate proportionally to item prices and exclude delivery from allocation', () => {
  const products = [product('pizza', 10_000), water()];
  const totals = getCartTotals(
    products.map((p) => line(p)),
    products,
    settings,
    'TEN',
    'delivery',
  );
  assert.equal(totals.discount, 1200);
  assert.equal(totals.total, 16_400);
  assert.deepEqual(
    totals.tax?.groups?.map((g) => g.discount),
    [1000, 200],
  );
  assert.equal(totals.tax?.includedTotal, 274);
  assert.throws(
    () =>
      getCartTotals(
        products.map((p) => line(p)),
        products,
        { ...settings, couponPercent: 100 },
        'TEN',
        'pickup',
      ),
    /at least ₹1 after round off/,
  );
});

test('largest-remainder discount and GST groups are deterministic across cart order and multiple rates', () => {
  const items = [
    { unitPrice: 100, quantity: 1, gstInclusive: { rateBps: 500, code: '2202' } },
    { unitPrice: 100, quantity: 1, gstInclusive: { rateBps: 1800, code: '2201' } },
    { unitPrice: 100, quantity: 1, gstInclusive: { rateBps: 1800, code: '2202' } },
  ];
  const tax = calculateOrderGst(items, 0, 1, billing);
  assert.deepEqual(tax, calculateOrderGst([...items].reverse(), 0, 1, billing));
  assert.deepEqual(
    tax.groups?.map((g) => `${g.pricing}:${g.rateBps}:${g.code}`),
    ['inclusive:1800:2201', 'inclusive:1800:2202', 'inclusive:500:2202'],
  );
  assert.deepEqual(
    tax.groups?.map((g) => g.discount),
    [1, 0, 0],
  );
  assert.equal(
    tax.groups?.reduce((sum, g) => sum + g.discount, 0),
    1,
  );
  for (const group of tax.groups!)
    assert.equal(group.taxableValue + group.total, group.grossValue - group.discount);
});

test('inclusive rounding preserves paise gross and safely allocates discounts at the maximum amount', () => {
  for (const rateBps of [2, 100, 500, 1200, 1800, 2800, 4000]) {
    for (const unitPrice of [0, 1, 2, 3, 19, 20, 21, 101, 99999]) {
      const tax = calculateOrderGst(
        [{ unitPrice, quantity: 1, gstInclusive: { rateBps, code: '2201' } }],
        0,
        0,
        billing,
      );
      const group = tax.groups![0];
      const component = Math.floor(
        (unitPrice * rateBps + 10_000 + rateBps) / (2 * (10_000 + rateBps)),
      );
      assert.equal(group.cgst, component);
      assert.equal(group.sgst, component);
      assert.equal(group.taxableValue + group.total, unitPrice);
      assert.equal(group.taxableValue >= 0, true);
    }
  }
  const tax = calculateOrderGst(
    [
      { unitPrice: 99_999_999, quantity: 1, gstInclusive: { rateBps: 1800, code: '2201' } },
      { unitPrice: 1, quantity: 1, gstInclusive: { rateBps: 1800, code: '2202' } },
    ],
    0,
    99_999_999,
    billing,
  );
  assert.deepEqual(
    tax.groups?.map((g) => g.discount),
    [99_999_998, 1],
  );
  assert.equal(tax.taxableValue + tax.total, 1);
});

test('all-exclusive carts preserve the legacy tax shape, half-paise rounding and absent-billing behavior', () => {
  const p = product('food', 21900);
  const totals = getCartTotals([line(p)], [p], settings, '', 'pickup');
  assert.deepEqual(totals.tax, calculateRestaurantGst(21900, billing));
  assert.equal(Object.hasOwn(totals.tax!, 'version'), false);
  assert.equal(totals.total, 23000);
  const unconfigured = { ...settings, billing: undefined };
  assert.equal(getCartTotals([line(p)], [p], unconfigured, '', 'pickup').total, 21900);
  assert.equal(getCartTotals([], [], settings).tax, undefined);
  assert.throws(
    () => getCartTotals([line(water())], [water()], unconfigured, '', 'pickup'),
    /GST billing profile/,
  );
});

test('MRP classification is explicit, validated and cannot use add-ons; variant prices remain inclusive', () => {
  const p = water();
  assert.equal(productSchema.safeParse(p).success, true);
  for (const invalid of [
    null,
    {},
    { rateBps: 0, code: '2201' },
    { rateBps: 1801, code: '2201' },
    { rateBps: 4002, code: '2201' },
    { rateBps: 1800.1, code: '2201' },
    { rateBps: 1800, code: '22A1' },
    { rateBps: 1800, code: '22011' },
    { rateBps: 1800, code: '2201', exempt: true },
  ]) {
    assert.equal(productSchema.safeParse({ ...p, gstInclusive: invalid }).success, false);
  }
  for (const field of ['crusts', 'toppings'] as const) {
    const changed = { ...p, [field]: [{ id: 'extra', name: 'Extra', price: 100 }] };
    assert.equal(productSchema.safeParse(changed).success, false);
    assert.throws(() => getUnitPrice(changed, line(p)), /cannot have crust or topping/);
  }
  const sized = { ...p, sizes: [{ id: 'large', name: 'Large MRP', price: 3000 }] };
  assert.equal(productSchema.safeParse(sized).success, true);
  assert.equal(
    getCartTotals(
      [{ ...line(sized), sizeId: 'large', quantity: 2 }],
      [sized],
      settings,
      '',
      'pickup',
    ).total,
    6000,
  );
  const untouched = product('ordinary-water', 2000);
  assert.equal(getCartTotals([line(untouched)], [untouched], settings, '', 'pickup').total, 2100);
});

test('malformed inclusive catalog and out-of-bounds amount inputs fail closed', () => {
  for (const classification of [
    null,
    { rateBps: 0, code: '2201' },
    { rateBps: 1800, code: 'bad' },
  ]) {
    const p = { ...water(), gstInclusive: classification } as Product;
    assert.throws(() => getCartTotals([line(p)], [p], settings, '', 'pickup'));
  }
  for (const invalid of [-1, 1.1, NaN, Infinity, 100_000_001])
    assert.throws(() =>
      calculateOrderGst(
        [{ unitPrice: invalid, quantity: 1, gstInclusive: water().gstInclusive }],
        0,
        0,
        billing,
      ),
    );
  assert.throws(() =>
    calculateOrderGst(
      [{ unitPrice: 100, quantity: 1, gstInclusive: water().gstInclusive }],
      0,
      101,
      billing,
    ),
  );
  assert.throws(() =>
    calculateOrderGst(
      [{ unitPrice: 100, quantity: 21, gstInclusive: water().gstInclusive }],
      0,
      0,
      billing,
    ),
  );
});

function source(): CommerceCatalog {
  const branches = structuredClone(initialBranches);
  branches[0].settings = {
    ...settings,
    billing: structuredClone(billing),
    acceptingOrders: true,
    temporarilyClosed: false,
    pickupEnabled: true,
    counterAcceptingOrders: true,
    paymentMethods: ['cash'],
  };
  return {
    branches,
    products: [water()],
    categories: structuredClone(initialCategories),
    revision: 1,
    mode: 'development',
  };
}
test('website and counter receipts snapshot trusted inclusive classification and reject client tax flags', () => {
  const catalog = source();
  const items = [line(catalog.products[0])];
  const raw = {
    branchId: 'barra',
    items,
    customer: {
      name: 'Test guest',
      phone: '9876543210',
      address: '',
      locality: '',
      postalCode: '',
      landmark: '',
      instructions: '',
    },
    fulfillment: 'pickup',
    paymentMethod: 'cash',
    coupon: '',
    idempotencyKey: 'mrp-snapshot-test',
  };
  const counter = {
    branchId: 'barra',
    items,
    coupon: '',
    expectedRevision: 1,
    idempotencyKey: '22222222-2222-4222-8222-222222222222',
    payment: { method: 'cash', confirmedReceived: true, cashTendered: 2000 },
  };
  const online = priceSharedOrder(
    parseCreateOrderRequest(raw),
    catalog,
    'mrp-online',
    '2026-10-25T12:00:00.000Z',
  );
  const staff = priceCounterOrder(
    parseCounterOrderRequest(counter),
    catalog,
    'mrp-staff',
    '2026-10-25T12:00:00.000Z',
    'owner',
  );
  for (const receipt of [online, staff]) {
    assert.equal(receipt.total, 2000);
    assert.deepEqual(receipt.items[0].gstInclusive, { rateBps: 1800, code: '2201' });
  }
  for (const gstInclusive of [
    { rateBps: 0, code: '2201' },
    { rateBps: 500, code: '2201' },
  ]) {
    assert.throws(() =>
      parseCreateOrderRequest({ ...raw, items: [{ ...items[0], gstInclusive }] }),
    );
    assert.throws(() =>
      parseCounterOrderRequest({ ...counter, items: [{ ...items[0], gstInclusive }] }),
    );
  }
  catalog.products[0].gstInclusive!.rateBps = 500;
  catalog.branches[0].settings.billing!.businessName = 'Changed later';
  assert.equal(online.items[0].gstInclusive?.rateBps, 1800);
  assert.equal(staff.items[0].gstInclusive?.rateBps, 1800);
  assert.equal(online.tax?.supplier.businessName, 'HOT PIZZA ACE');
});
