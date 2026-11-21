import assert from 'node:assert/strict';
import test from 'node:test';
import { initialProducts } from '../lib/data';
import {
  addCounterDefault,
  counterDefaultSelection,
  counterQuickPrice,
  removeCounterDefault,
} from '../lib/counter-cart';
import { getUnitPrice } from '../lib/pricing';

test('counter quick-add merges repeated default taps without changing customized lines or notes', () => {
  const product = initialProducts.find((p) => p.sizes.length > 1)!;
  const selected = counterDefaultSelection(product);
  const custom = { ...selected, id: 'custom', notes: 'No onion', quantity: 2 };
  let cart = addCounterDefault([custom], product, 'quick');
  cart = addCounterDefault(cart, product, 'unused');
  assert.equal(cart.length, 2);
  assert.deepEqual(cart[0], custom);
  assert.equal(cart[1].id, 'quick');
  assert.equal(cart[1].quantity, 2);
  assert.equal(cart[1].sizeId, product.sizes[0].id);
  assert.equal(cart[1].crustId, product.crusts[0]?.id);
});
test('quick-add price includes the selected default crust and quantity cannot exceed the server limit', () => {
  const original = initialProducts.find((p) => p.crusts.length)!;
  const product = structuredClone(original);
  product.crusts[0].price = 2500;
  delete product.crusts[0].sizePrices;
  const selection = counterDefaultSelection(product);
  assert.equal(counterQuickPrice(product), getUnitPrice(product, selection));
  const cart = [{ ...selection, id: 'full', quantity: 20 }];
  assert.equal(addCounterDefault(cart, product, 'another'), cart);
});
test('quick-add respects the line limit while allowing quantity changes to an existing default line', () => {
  const product = initialProducts.find((p) => p.available)!;
  const selection = counterDefaultSelection(product);
  const full = Array.from({ length: 50 }, (_, i) => ({
    ...selection,
    id: `custom-${i}`,
    notes: `Note ${i}`,
  }));
  assert.equal(addCounterDefault(full, product, 'extra'), full);
  full[0] = { ...selection, id: 'default', notes: '' };
  const next = addCounterDefault(full, product, 'extra');
  assert.equal(next.length, 50);
  assert.equal(next[0].quantity, 2);
});
test('quick-remove reduces only the default line and drops it at zero', () => {
  const product = initialProducts.find((p) => p.sizes.length > 1)!;
  const selected = counterDefaultSelection(product);
  const custom = { ...selected, id: 'custom', notes: 'No onion', quantity: 2 };
  let cart = addCounterDefault([custom], product, 'quick');
  cart = addCounterDefault(cart, product, 'unused');
  cart = removeCounterDefault(cart, product);
  assert.equal(cart.find((item) => item.id === 'quick')?.quantity, 1);
  cart = removeCounterDefault(cart, product);
  assert.deepEqual(cart, [custom]);
  assert.equal(removeCounterDefault(cart, product), cart);
});
