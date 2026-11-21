import { isGatewayMode, isLiveGatewayMode, isTestGatewayMode } from './payments/method';
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
import { calculateOrderGst, validateGstInclusive } from './billing';
import { isStaffCounterPaymentComplete } from './payments/counter';
import { NEAREST_RUPEE_POLICY, nearestRupeeAdjustment } from './rounding';

const MAX_QUANTITY = 20;

export function formatCurrency(paise: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: paise % 100 === 0 ? 0 : 2,
  }).format(paise / 100);
}

function checkMoney(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 100_000_000)
    throw new Error(`${label} must be a non-negative amount of at most ₹10,00,000 in paise.`);
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
  if (product.gstInclusive !== undefined) {
    validateGstInclusive(product.gstInclusive);
    if (product.crusts.length || product.toppings.length)
      throw new Error(
        'GST-inclusive items cannot have crust or topping add-ons. Use size variants for each MRP.',
      );
  }
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
  const unitPrice =
    sizePrice +
    crustPrice +
    product.toppings
      .filter((option) => selection.toppingIds.includes(option.id))
      .reduce((sum, option) => sum + getOptionPrice(option, selection.sizeId), 0);
  checkMoney(unitPrice, 'Item price');
  return unitPrice;
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
  settings: Pick<
    RestaurantSettings,
    | 'deliveryFee'
    | 'freeDeliveryThreshold'
    | 'couponMaximum'
    | 'couponMinimum'
    | 'couponPercent'
    | 'couponCode'
    | 'billing'
  >,
  coupon = '',
  fulfillment: Fulfillment = 'delivery',
) {
  const pricedItems = cart.map((item) => {
    const product = products.find((candidate) => candidate.id === item.productId);
    if (!product)
      throw new Error('An item in your cart is no longer on the menu. Please remove it.');
    return {
      unitPrice: getUnitPrice(product, item),
      quantity: item.quantity,
      ...(product.gstInclusive ? { gstInclusive: structuredClone(product.gstInclusive) } : {}),
    };
  });
  const subtotal = pricedItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  checkMoney(subtotal, 'Item subtotal');
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
  const taxableValue = subtotal + deliveryFee - discount;
  checkMoney(taxableValue, 'Order amount');
  if (!settings.billing && pricedItems.some((item) => item.gstInclusive))
    throw new Error(
      'Complete this branch’s GST billing profile before selling GST-inclusive items.',
    );
  const tax =
    settings.billing && cart.length
      ? calculateOrderGst(pricedItems, deliveryFee, discount, settings.billing)
      : undefined;
  const unroundedTotal = taxableValue + (tax?.total ?? 0) - (tax?.includedTotal ?? 0);
  // Round new payable bills to the nearest rupee without changing item/GST paise.
  const roundOff = cart.length
    ? nearestRupeeAdjustment(unroundedTotal, subtotal, deliveryFee, tax)
    : undefined;
  const total = unroundedTotal + (roundOff ?? 0);
  if (cart.length && total <= 0)
    throw new Error('The bill total must be at least ₹1 after round off.');
  return {
    subtotal,
    deliveryFee,
    discount,
    ...(tax ? { tax } : {}),
    ...(roundOff !== undefined ? { roundOff, roundOffPolicy: NEAREST_RUPEE_POLICY } : {}),
    total,
  };
}

/** Captured online payments and development simulations have different provenance. */
export function isOnlinePaymentComplete(
  order: Pick<
    Order,
    'paymentMethod' | 'paymentStatus' | 'paymentMode' | 'paymentReviewRequired' | 'refund'
  >,
): boolean {
  if (order.paymentMethod === 'cash' || order.paymentReviewRequired || hasProcessedRefund(order))
    return false;
  if (isGatewayMode(order.paymentMode)) return order.paymentStatus === 'paid';
  // Older browser-local demo receipts predate the explicit simulation field.
  return (
    (order.paymentMode === undefined || order.paymentMode === 'simulation') &&
    order.paymentStatus === 'simulated_paid'
  );
}

/** Refunds are separate from the immutable original capture and invoice. */
export function hasProcessedRefund(order: Pick<Order, 'refund'>): boolean {
  return (order.refund?.amount ?? 0) > 0;
}

/** Real completed sales only; test captures and pending cash collection are excluded. */
export function isRevenueEligible(order: Order): boolean {
  if (order.testVoid || hasProcessedRefund(order)) return false;
  if (order.channel === 'counter')
    return (
      order.environment === 'production' &&
      (order.fulfillment === 'delivery'
        ? order.status === 'delivered'
        : order.status === 'served' || order.status === 'closed') &&
      isStaffCounterPaymentComplete(order)
    );
  return (
    (order.status === 'delivered' ||
      order.status === 'picked_up' ||
      (order.fulfillment === 'dine_in' && ['served', 'closed'].includes(order.status))) &&
    order.paymentStatus === 'paid' &&
    isLiveGatewayMode(order.paymentMode) &&
    order.paymentMethod !== 'cash' &&
    !order.paymentReviewRequired
  );
}

/** Development/demo totals are kept separate from real captured revenue. */
export function isSimulatedRevenueEligible(order: Order): boolean {
  if (order.testVoid || hasProcessedRefund(order)) return false;
  if (order.channel === 'counter')
    return (
      order.environment === 'development' &&
      (order.fulfillment === 'delivery'
        ? order.status === 'delivered'
        : order.status === 'served' || order.status === 'closed') &&
      isStaffCounterPaymentComplete(order)
    );
  return (
    (order.status === 'delivered' ||
      order.status === 'picked_up' ||
      (order.fulfillment === 'dine_in' && ['served', 'closed'].includes(order.status))) &&
    !order.paymentReviewRequired &&
    ((isTestGatewayMode(order.paymentMode) && order.paymentStatus === 'paid') ||
      ((order.paymentMode === undefined || order.paymentMode === 'simulation') &&
        order.paymentStatus === 'simulated_paid'))
  );
}

export function getAllowedOrderStatuses(
  order: Pick<Order, 'status' | 'fulfillment'> &
    Partial<
      Pick<Order, 'paymentStatus' | 'testVoid' | 'channel' | 'paymentReviewRequired' | 'refund'>
    >,
): OrderStatus[] {
  if (order.testVoid || hasProcessedRefund(order)) return [];
  if (
    order.channel === 'counter' &&
    order.fulfillment === 'delivery' &&
    order.paymentStatus !== 'paid' &&
    ['ready', 'out_for_delivery'].includes(order.status)
  )
    return [];
  if (order.fulfillment === 'dine_in') {
    const next: Partial<Record<OrderStatus, OrderStatus[]>> = {
      pending: order.channel !== 'counter' ? ['confirmed', 'rejected', 'cancelled'] : [],
      confirmed: ['preparing'],
      preparing: ['ready'],
      ready: ['served'],
      served: order.paymentStatus === 'paid' ? ['closed'] : [],
    };
    return [
      ...(next[order.status] ?? []),
      ...(['confirmed', 'preparing', 'ready'].includes(order.status) &&
      (order.paymentStatus !== 'paid' || order.channel === 'website')
        ? ['cancelled' as const]
        : []),
    ];
  }
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
