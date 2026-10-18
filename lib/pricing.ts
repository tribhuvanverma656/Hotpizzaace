import type {
  CartItem,
  CartSelection,
  Fulfillment,
  Order,
  OrderStatus,
  Option,
  Product,
  RestaurantSettings,
} from '../types';

const MAX_QUANTITY = 20;

export function formatCurrency(paise: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: paise % 100 === 0 ? 0 : 2,
  }).format(paise / 100);
}

function checkMoney(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label} must be a non-negative amount in paise.`);
}

export function getOptionPrice(option: Option, sizeId?: string): number {
  return (sizeId ? option.sizePrices?.[sizeId] : undefined) ?? option.price;
}

/** Always check selected IDs against current catalogue options before using a price. */
export function validateSelection(product: Product, selection: CartSelection): void {
  if (!product || product.id !== selection.productId)
    throw new Error('This menu item no longer exists.');
  if (!product.available || product.archived)
    throw new Error(`${product.name} is currently unavailable. Please remove it from your cart.`);
  if (
    !Number.isSafeInteger(selection.quantity) ||
    selection.quantity < 1 ||
    selection.quantity > MAX_QUANTITY
  )
    throw new Error(`Choose a quantity between 1 and ${MAX_QUANTITY}.`);
  if (typeof selection.notes !== 'string' || selection.notes.length > 300)
    throw new Error('Preparation notes must be 300 characters or fewer.');
  if (
    !Array.isArray(selection.toppingIds) ||
    selection.toppingIds.length > product.toppings.length ||
    new Set(selection.toppingIds).size !== selection.toppingIds.length
  )
    throw new Error('Select each topping only once.');
  for (const [key, options, label] of [
    ['sizeId', product.sizes, 'size'],
    ['crustId', product.crusts, 'crust'],
  ] as const) {
    const id = selection[key];
    if (options.length ? !id || !options.some((option) => option.id === id) : !!id)
      throw new Error(`Choose a valid ${label} for ${product.name}.`);
  }
  if (selection.toppingIds.some((id) => !product.toppings.some((option) => option.id === id)))
    throw new Error('One or more toppings are no longer available.');
  checkMoney(product.price, 'Base price');
  for (const option of [...product.sizes, ...product.crusts, ...product.toppings]) {
    checkMoney(option.price, 'Option price');
    for (const [sizeId, price] of Object.entries(option.sizePrices ?? {})) {
      if (!product.sizes.some((size) => size.id === sizeId))
        throw new Error('An add-on refers to a size that is no longer available.');
      checkMoney(price, 'Size-specific option price');
    }
  }
}

export function getUnitPrice(product: Product, selection: CartSelection): number {
  validateSelection(product, selection);
  const sizePrice =
    product.sizes.find((option) => option.id === selection.sizeId)?.price ?? product.price;
  const crust = product.crusts.find((option) => option.id === selection.crustId);
  const crustPrice = crust ? getOptionPrice(crust, selection.sizeId) : 0;
  return (
    sizePrice +
    crustPrice +
    product.toppings
      .filter((option) => selection.toppingIds.includes(option.id))
      .reduce((sum, option) => sum + getOptionPrice(option, selection.sizeId), 0)
  );
}

export function getItemOptions(product: Product, selection: CartSelection): string[] {
  validateSelection(product, selection);
  return [
    product.sizes.find((option) => option.id === selection.sizeId)?.name,
    product.crusts.find((option) => option.id === selection.crustId)?.name,
    ...product.toppings
      .filter((option) => selection.toppingIds.includes(option.id))
      .map((option) => option.name),
  ].filter((name): name is string => !!name);
}

export function isCouponActive(
  settings: Pick<RestaurantSettings, 'couponCode' | 'couponPercent' | 'couponMaximum'>,
): boolean {
  return !!settings.couponCode.trim() && settings.couponPercent > 0 && settings.couponMaximum > 0;
}

export function validateCoupon(
  code: string,
  settings: RestaurantSettings,
  subtotal: number,
): string {
  const normalized = code.trim().toUpperCase();
  if (!isCouponActive(settings)) throw new Error('No coupon offer is available right now.');
  if (!normalized || normalized !== settings.couponCode.trim().toUpperCase())
    throw new Error(
      `That coupon is not valid. Try the current code ${settings.couponCode.trim().toUpperCase()}.`,
    );
  if (subtotal < settings.couponMinimum)
    throw new Error(
      `Add ${formatCurrency(settings.couponMinimum - subtotal)} more to use ${normalized}.`,
    );
  return normalized;
}

export function getDeliveryFee(
  subtotal: number,
  settings: Pick<RestaurantSettings, 'deliveryFee' | 'freeDeliveryThreshold'>,
  fulfillment: Fulfillment = 'delivery',
): number {
  checkMoney(subtotal, 'Food subtotal');
  checkMoney(settings.deliveryFee, 'Delivery fee');
  if (settings.freeDeliveryThreshold != null)
    checkMoney(settings.freeDeliveryThreshold, 'Free delivery threshold');
  const free = settings.freeDeliveryThreshold != null && subtotal >= settings.freeDeliveryThreshold;
  return fulfillment === 'delivery' && !free ? settings.deliveryFee : 0;
}

/** The delivery minimum uses the payable total; pickup has no minimum. */
export function getMinimumOrderShortfall(
  total: number,
  settings: Pick<RestaurantSettings, 'minimumOrder'>,
  fulfillment: Fulfillment,
): number {
  checkMoney(total, 'Order total');
  checkMoney(settings.minimumOrder, 'Minimum delivery total');
  return fulfillment === 'pickup' ? 0 : Math.max(0, settings.minimumOrder - total);
}

export function getCartTotals(
  cart: CartItem[],
  products: Product[],
  settings: RestaurantSettings,
  coupon = '',
  fulfillment: Fulfillment = 'delivery',
) {
  const subtotal = cart.reduce((sum, item) => {
    const product = products.find((candidate) => candidate.id === item.productId);
    if (!product)
      throw new Error('An item in your cart is no longer on the menu. Please remove it.');
    return sum + getUnitPrice(product, item) * item.quantity;
  }, 0);
  checkMoney(settings.deliveryFee, 'Delivery fee');
  if (settings.freeDeliveryThreshold != null)
    checkMoney(settings.freeDeliveryThreshold, 'Free delivery threshold');
  checkMoney(settings.couponMaximum, 'Maximum discount');
  checkMoney(settings.couponMinimum, 'Minimum coupon subtotal');
  if (
    !Number.isFinite(settings.couponPercent) ||
    settings.couponPercent < 0 ||
    settings.couponPercent > 100
  )
    throw new Error('Coupon discount must be between 0% and 100%.');
  let discount = 0;
  if (
    coupon &&
    isCouponActive(settings) &&
    subtotal >= settings.couponMinimum &&
    coupon.trim().toUpperCase() === settings.couponCode.trim().toUpperCase()
  ) {
    discount = Math.min(
      Math.round((subtotal * settings.couponPercent) / 100),
      settings.couponMaximum,
      subtotal,
    );
  }
  const deliveryFee = cart.length ? getDeliveryFee(subtotal, settings, fulfillment) : 0;
  return { subtotal, deliveryFee, discount, total: subtotal + deliveryFee - discount };
}

/** Completed, paid sales only. A pending cash collection is never revenue. */
export function isRevenueEligible(order: Order): boolean {
  return (
    (order.status === 'delivered' || order.status === 'picked_up') &&
    order.paymentStatus === 'simulated_paid'
  );
}

export function getAllowedOrderStatuses(
  order: Pick<Order, 'status' | 'fulfillment'>,
): OrderStatus[] {
  const common: Partial<Record<OrderStatus, OrderStatus[]>> = {
    pending: ['confirmed', 'rejected', 'cancelled'],
    confirmed: ['preparing', 'cancelled'],
    preparing: ['ready', 'cancelled'],
    ready:
      order.fulfillment === 'delivery'
        ? ['out_for_delivery', 'cancelled']
        : ['picked_up', 'cancelled'],
    out_for_delivery: ['delivered'],
  };
  return common[order.status] ?? [];
}
