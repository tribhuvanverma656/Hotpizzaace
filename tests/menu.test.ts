import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { initialProducts, initialCategories, initialSettings } from '../lib/data';
import {
  initialProducts as legacyProducts,
  initialCategories as legacyCategories,
  initialSettings as legacySettings,
  initialOrders,
} from '../lib/legacy-demo-data';
import { MENU_REVISION } from '../lib/menu/catalog';
import { STORE_VERSION } from '../lib/persistence';
import { menuPhotos } from '../lib/menu/photos';
import { migrateMenuState } from '../lib/menu/migrate';
import { getUnitPrice } from '../lib/pricing';
import { productSchema, settingsSchema } from '../lib/validation';
import type { CartSelection } from '../types';
import { useDemoStore } from '../lib/store';

const find = (slug: string) => initialProducts.find((product) => product.slug === slug)!;

test('printed menu contains 111 unique products in 14 categories and valid local images', () => {
  assert.equal(initialProducts.length, 111);
  assert.equal(Object.keys(menuPhotos).length, 71);
  for (const slug of [
    'italian-red-pasta',
    'italian-white-pasta',
    'veg-fried-rice',
    'paneer-fried-rice',
  ]) {
    assert.equal(find(slug).image, '/images/menu/photo-coming-soon.svg');
    assert.equal(existsSync(`public/images/menu/${slug}.jpg`), false);
    const old = { ...find(slug), image: `/images/menu/${slug}.jpg` };
    assert.equal(
      migrateMenuState({ products: [old] }, 3).products?.[0].image,
      '/images/menu/photo-coming-soon.svg',
    );
  }
  assert.equal(initialCategories.length, 14);
  assert.equal(new Set(initialProducts.map((product) => product.id)).size, 111);
  assert.equal(new Set(initialProducts.map((product) => product.slug)).size, 111);
  for (const product of initialProducts) {
    assert.ok(productSchema.safeParse(product).success, product.name);
    assert.ok(initialCategories.some((category) => category.id === product.categoryId));
    assert.equal(product.vegetarian, true);
    assert.ok(existsSync(`public${product.image}`), product.image);
    assert.equal(product.image, menuPhotos[product.slug] ?? '/images/menu/photo-coming-soon.svg');
    assert.ok(Number.isSafeInteger(product.price));
    if (product.sizes.length) assert.equal(product.price, product.sizes[0].price);
  }
  assert.equal(initialProducts.filter((product) => product.categoryId === 'veg-pizza').length, 40);
  assert.equal(initialProducts.filter((product) => product.categoryId === 'combos').length, 10);
  assert.ok(settingsSchema.safeParse(initialSettings).success);
  assert.ok(initialSettings.address.includes('208027'));
  assert.equal(initialSettings.phone, '+91 70815 55055');
  assert.equal(initialSettings.deliveryFee, 4900);
});

test('photo refresh replaces previous import images and preserves custom uploads and prices', () => {
  const product = find('simple-cheese');
  const edited = { ...product, image: 'data:image/png;base64,custom', price: 12300 };
  const refreshed = migrateMenuState(
    { products: [{ ...product, image: '/images/margherita.jpg' }] },
    2,
  );
  assert.equal(refreshed.products?.[0].image, menuPhotos[product.slug]);
  assert.deepEqual(migrateMenuState({ products: [edited] }, 2).products?.[0], edited);
  assert.equal(find('onion-paneer').price, 10900);
});

test('browser migration persists its version once and does not overwrite subsequent admin edits', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let serialized = JSON.stringify({
    state: {
      products: legacyProducts,
      categories: legacyCategories,
      settings: legacySettings,
      orders: initialOrders,
      cart: [],
      adminSession: true,
    },
    version: 1,
  });
  let writes = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: () => serialized,
        setItem: (_key: string, value: string) => {
          serialized = value;
          writes++;
        },
        removeItem: () => {},
      },
    },
  });
  try {
    await useDemoStore.persist.rehydrate();
    assert.equal(JSON.parse(serialized).version, STORE_VERSION);
    assert.equal(writes, 1);
    const product = useDemoStore
      .getState()
      .products.find((product) => product.slug === 'french-fries')!;
    useDemoStore.getState().saveProduct({ ...product, price: 9900 });
    await useDemoStore.persist.rehydrate();
    assert.equal(
      useDemoStore.getState().products.find((candidate) => candidate.id === product.id)?.price,
      9900,
    );
    assert.equal(useDemoStore.getState().orders.length, initialOrders.length);
    assert.equal(writes, 2);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('overlapping menu items use the maximum printed price', () => {
  for (const [slug, price] of [
    ['italian-red-pasta', 109],
    ['italian-white-pasta', 109],
    ['pizza-puff-3-pieces', 129],
    ['french-fries', 80],
    ['masala-french-fries', 90],
  ] as const)
    assert.equal(find(slug).price, price * 100, slug);
});

test('pizza add-ons reprice with the selected size and rice uses half/full prices', () => {
  const product = find('simple-cheese');
  const selection: CartSelection = {
    productId: product.id,
    sizeId: 'small',
    crustId: 'cheese-burst',
    toppingIds: ['extra-cheese', 'paneer'],
    quantity: 1,
    notes: '',
  };
  assert.equal(getUnitPrice(product, selection), (90 + 60 + 30 + 20) * 100);
  assert.equal(
    getUnitPrice(product, { ...selection, sizeId: 'medium' }),
    (210 + 90 + 40 + 30) * 100,
  );
  assert.equal(
    getUnitPrice(product, { ...selection, sizeId: 'large' }),
    (280 + 130 + 60 + 45) * 100,
  );
  assert.throws(
    () =>
      getUnitPrice(
        {
          ...product,
          toppings: [{ id: 'broken', name: 'Broken', price: 0, sizePrices: { large: -1 } }],
        },
        { ...selection, toppingIds: [] },
      ),
    /non-negative/,
  );
  const rice = find('paneer-fried-rice');
  assert.equal(
    getUnitPrice(rice, {
      productId: rice.id,
      sizeId: 'full',
      toppingIds: [],
      quantity: 1,
      notes: '',
    }),
    17000,
  );
  assert.equal(find('corn-paneer').sizes.length, 0);
});

test('menu migration keeps receipts, carts, sessions, custom products and business settings', () => {
  const custom = {
    ...legacyProducts[0],
    id: 'custom-pizza',
    slug: 'custom-pizza',
    categoryId: 'custom-category',
  };
  const cart = [{ id: 'old-cart', productId: legacyProducts[0].id, quantity: 1 }];
  const original = {
    products: [...legacyProducts, custom],
    categories: [
      ...legacyCategories,
      { id: 'custom-category', slug: 'custom-category', name: 'Custom', sortOrder: 8 },
    ],
    orders: initialOrders,
    cart,
    adminSession: true,
    customerSession: { phone: '9876543210' },
    idempotencyKeys: { key: 'order' },
    settings: { ...legacySettings, minimumOrder: 15000, preparationMinutes: 35 },
  };
  const migrated = migrateMenuState(original, 1);
  assert.strictEqual(migrated.orders, original.orders);
  assert.strictEqual(migrated.cart, cart);
  assert.strictEqual(migrated.customerSession, original.customerSession);
  assert.strictEqual(migrated.idempotencyKeys, original.idempotencyKeys);
  assert.equal(migrated.adminSession, true);
  assert.ok(migrated.products?.find((product) => product.id === legacyProducts[0].id)?.archived);
  assert.equal(
    migrated.products?.find((product) => product.id === 'custom-pizza')?.archived,
    undefined,
  );
  assert.equal(migrated.products?.filter((product) => !product.archived).length, 112);
  assert.equal(
    migrated.categories?.find((category) => category.id === 'custom-category')?.archived,
    false,
  );
  assert.equal(migrated.settings?.minimumOrder, 15000);
  assert.equal(migrated.settings?.preparationMinutes, 35);
  assert.deepEqual(migrated.settings?.servicePostalCodes, ['208027']);
  assert.equal(migrated.settings?.deliveryFee, 4900);
  assert.strictEqual(migrateMenuState(migrated, MENU_REVISION), migrated);
  const customSettings = migrateMenuState(
    {
      ...original,
      settings: {
        ...original.settings,
        deliveryFee: 2500,
        servicePostalCodes: ['208022', '208027'],
      },
    },
    1,
  );
  assert.equal(customSettings.settings?.deliveryFee, 2500);
  assert.deepEqual(customSettings.settings?.servicePostalCodes, ['208022', '208027']);
});
