import type { CartSelection } from '../../../types';
import { parseMobileCart } from '../../../lib/mobile-cart';
export type Line = CartSelection & { id: string };
const key = (item: CartSelection) =>
  JSON.stringify([
    item.productId,
    item.sizeId,
    item.crustId,
    [...item.toppingIds].sort(),
    item.notes.trim(),
  ]);
export function addLine(cart: Line[], selection: CartSelection): Line[] {
  parseMobileCart({ version: 1, branchId: 'validation', items: [selection] });
  const same = cart.find((item) => key(item) === key(selection));
  if (same && same.quantity + selection.quantity > 20)
    throw new Error('You can add up to 20 of the same item.');
  if (!same && cart.length >= 30) throw new Error('Your cart can hold up to 30 different items.');
  return same
    ? cart.map((item) =>
        item.id === same.id ? { ...item, quantity: item.quantity + selection.quantity } : item,
      )
    : [
        ...cart,
        {
          ...selection,
          notes: selection.notes.trim(),
          id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        },
      ];
}
export function changeQuantity(cart: Line[], id: string, quantity: number): Line[] {
  if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 20)
    throw new Error('Choose a quantity from 0 to 20.');
  return quantity === 0
    ? cart.filter((item) => item.id !== id)
    : cart.map((item) => (item.id === id ? { ...item, quantity } : item));
}
export function restoreCart(raw: unknown): {
  branchId: string;
  cart: Line[];
  favourites: string[];
} {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid saved cart.');
  const value = raw as Record<string, unknown>;
  if (
    typeof value.branchId !== 'string' ||
    !Array.isArray(value.cart) ||
    !Array.isArray(value.favourites)
  )
    throw new Error('Invalid saved cart.');
  const items = value.cart.length
    ? parseMobileCart({
        version: 1,
        branchId: value.branchId,
        items: value.cart.map((item) => {
          const { id: _id, ...selection } = item;
          return selection;
        }),
      }).items
    : [];
  return {
    branchId: value.branchId,
    cart: items.map((item, i) => ({ ...item, id: `restored-${i}` })),
    favourites: value.favourites
      .filter((v): v is string => typeof v === 'string' && v.length <= 100)
      .slice(0, 200),
  };
}
