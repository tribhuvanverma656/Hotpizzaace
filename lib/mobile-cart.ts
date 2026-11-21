import type { CartSelection, Product } from '../types';
import { validateSelection } from './pricing';

export type MobileCart = { version: 1; branchId: string; items: CartSelection[] };
const id = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** A cart proposal only. Prices, customer identity and payment state are never imported. */
export function parseMobileCart(value: unknown): MobileCart {
  if (
    !record(value) ||
    Object.keys(value).some((k) => !['version', 'branchId', 'items'].includes(k)) ||
    value.version !== 1 ||
    !id(value.branchId) ||
    !Array.isArray(value.items) ||
    !value.items.length ||
    value.items.length > 30
  )
    throw new Error('This app cart is invalid. Open your cart in the app and try again.');
  const items = value.items.map((item): CartSelection => {
    if (
      !record(item) ||
      Object.keys(item).some(
        (k) => !['productId', 'sizeId', 'crustId', 'toppingIds', 'quantity', 'notes'].includes(k),
      ) ||
      !id(item.productId) ||
      (item.sizeId !== undefined && !id(item.sizeId)) ||
      (item.crustId !== undefined && !id(item.crustId)) ||
      !Array.isArray(item.toppingIds) ||
      item.toppingIds.length > 30 ||
      item.toppingIds.some((t) => !id(t)) ||
      new Set(item.toppingIds).size !== item.toppingIds.length ||
      !Number.isSafeInteger(item.quantity) ||
      Number(item.quantity) < 1 ||
      Number(item.quantity) > 20 ||
      typeof item.notes !== 'string' ||
      item.notes.length > 300
    )
      throw new Error('One of the app cart items is invalid. Please review your cart.');
    return {
      productId: item.productId,
      ...(item.sizeId ? { sizeId: String(item.sizeId) } : {}),
      ...(item.crustId ? { crustId: String(item.crustId) } : {}),
      toppingIds: item.toppingIds as string[],
      quantity: Number(item.quantity),
      notes: item.notes.trim(),
    };
  });
  return { version: 1, branchId: value.branchId, items };
}
export function validateMobileCart(
  value: unknown,
  products: Product[],
  branchIds: string[],
): MobileCart {
  const cart = parseMobileCart(value);
  if (!branchIds.includes(cart.branchId))
    throw new Error('This restaurant branch is no longer available.');
  for (const selection of cart.items) {
    const product = products.find((p) => p.id === selection.productId);
    if (!product) throw new Error('An item is no longer on the menu. Please update your app cart.');
    validateSelection(product, selection);
  }
  return cart;
}
export function encodeMobileCart(cart: MobileCart): string {
  const encoded = encodeURIComponent(JSON.stringify(parseMobileCart(cart)));
  if (encoded.length > 14000)
    throw new Error('This cart is too large to transfer. Please reduce the number of items.');
  return encoded;
}
export function decodeMobileCart(fragment: string): MobileCart {
  if (!fragment || fragment.length > 14000) throw new Error('Open checkout from your app cart.');
  try {
    return parseMobileCart(JSON.parse(decodeURIComponent(fragment.replace(/^#/, ''))));
  } catch {
    throw new Error('This app cart link is invalid. Return to the app and try again.');
  }
}
