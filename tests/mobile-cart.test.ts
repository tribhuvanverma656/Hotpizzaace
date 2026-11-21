import assert from 'node:assert/strict';
import test from 'node:test';
import { initialProducts } from '../lib/data';
import { counterDefaultSelection } from '../lib/counter-cart';
import {
  decodeMobileCart,
  encodeMobileCart,
  parseMobileCart,
  validateMobileCart,
} from '../lib/mobile-cart';
import { addLine, changeQuantity, restoreCart } from '../mobile/src/lib/cart';
const product = initialProducts.find((p) => p.available && !p.archived)!;
const selection = counterDefaultSelection(product);
const proposal = { version: 1 as const, branchId: 'barra', items: [selection] };
test('app cart handoff preserves selections without importing prices or identity', () => {
  const encoded = encodeMobileCart(proposal);
  assert.deepEqual(decodeMobileCart(`#${encoded}`), proposal);
  for (const field of ['total', 'price', 'paymentStatus', 'customer', 'accessToken'])
    assert.throws(() => parseMobileCart({ ...proposal, [field]: 'forged' }));
  assert.throws(() => parseMobileCart({ ...proposal, items: [{ ...selection, unitPrice: 1 }] }));
});
test('handoff revalidates branch and available options against current catalogue', () => {
  assert.deepEqual(validateMobileCart(proposal, [product], ['barra']), proposal);
  assert.throws(() => validateMobileCart(proposal, [product], ['other']));
  assert.throws(() => validateMobileCart(proposal, [], ['barra']));
  assert.throws(() => validateMobileCart(proposal, [{ ...product, available: false }], ['barra']));
  assert.throws(() =>
    validateMobileCart(
      { ...proposal, items: [{ ...selection, sizeId: 'missing-option' }] },
      [product],
      ['barra'],
    ),
  );
});
test('malformed and oversized app links cannot import arbitrary state', () => {
  for (const value of ['', '%broken', '#%7Bbad', 'x'.repeat(14001)])
    assert.throws(() => decodeMobileCart(value));
  for (const items of [
    [],
    Array(31).fill(selection),
    [{ ...selection, quantity: 0 }],
    [{ ...selection, quantity: 21 }],
    [{ ...selection, quantity: 1.1 }],
    [{ ...selection, notes: 'x'.repeat(301) }],
    [{ ...selection, toppingIds: ['duplicate', 'duplicate'] }],
  ])
    assert.throws(() => parseMobileCart({ ...proposal, items }));
});
test('app cart combines equal configurations and enforces maximum quantity before updating', () => {
  const one = addLine([], selection);
  const two = addLine(one, selection);
  assert.equal(two.length, 1);
  assert.equal(two[0].quantity, 2);
  assert.equal(one[0].quantity, 1);
  assert.throws(() => addLine([{ ...one[0], quantity: 20 }], selection));
  const custom = addLine(one, { ...selection, notes: 'Less chilli' });
  assert.equal(custom.length, 2);
});
test('decreasing quantity one removes the final app item and invalid quantities do not alter cart', () => {
  const cart = addLine([], selection);
  assert.deepEqual(changeQuantity(cart, cart[0].id, 0), []);
  for (const n of [-1, 21, 1.5, NaN]) assert.throws(() => changeQuantity(cart, cart[0].id, n));
  assert.equal(cart.length, 1);
  assert.equal(cart[0].quantity, 1);
});
test('saved phone cart is validated and never restores account or payment credentials', () => {
  const cart = addLine([], selection);
  const saved = restoreCart({
    branchId: 'barra',
    cart,
    favourites: [product.id, 7],
    token: 'not-restored',
  });
  assert.equal(saved.cart[0].quantity, 1);
  assert.deepEqual(saved.favourites, [product.id]);
  assert.equal('token' in saved, false);
  assert.throws(() =>
    restoreCart({ branchId: 'barra', cart: [{ ...cart[0], quantity: 200 }], favourites: [] }),
  );
});
