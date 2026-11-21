import type { CartItem, CartSelection, Product } from '../types';
import { getUnitPrice } from './pricing';

export function counterDefaultSelection(product: Product): CartSelection {
  const selection = {
    productId: product.id,
    sizeId: product.sizes[0]?.id,
    crustId: product.crusts[0]?.id,
    toppingIds: [],
    quantity: 1,
    notes: '',
  };
  getUnitPrice(product, selection);
  return selection;
}
export function counterQuickPrice(product: Product): number | null {
  try {
    return getUnitPrice(product, counterDefaultSelection(product));
  } catch {
    return null;
  }
}
export function counterDefaultQuantity(cart: CartItem[], product: Product): number {
  return (
    cart.find(
      (item) =>
        item.productId === product.id &&
        item.sizeId === product.sizes[0]?.id &&
        item.crustId === product.crusts[0]?.id &&
        item.toppingIds.length === 0 &&
        item.notes === '',
    )?.quantity ?? 0
  );
}
/** Quick taps merge only the default selection; custom options and notes stay separate. */
export function addCounterDefault(cart: CartItem[], product: Product, id: string): CartItem[] {
  const selection = counterDefaultSelection(product);
  const existing = cart.find(
    (item) =>
      item.productId === selection.productId &&
      item.sizeId === selection.sizeId &&
      item.crustId === selection.crustId &&
      item.toppingIds.length === 0 &&
      item.notes === '',
  );
  if (existing)
    return existing.quantity >= 20
      ? cart
      : cart.map((item) =>
          item.id === existing.id ? { ...item, quantity: item.quantity + 1 } : item,
        );
  if (cart.length >= 50) return cart;
  return [...cart, { ...selection, id }];
}
/** Remove one quick-tap item; customized lines and notes are never touched here. */
export function removeCounterDefault(cart: CartItem[], product: Product): CartItem[] {
  const existing = cart.find(
    (item) =>
      item.productId === product.id &&
      item.sizeId === product.sizes[0]?.id &&
      item.crustId === product.crusts[0]?.id &&
      item.toppingIds.length === 0 &&
      item.notes === '',
  );
  if (!existing) return cart;
  return existing.quantity > 1
    ? cart.map((item) =>
        item.id === existing.id ? { ...item, quantity: item.quantity - 1 } : item,
      )
    : cart.filter((item) => item.id !== existing.id);
}
