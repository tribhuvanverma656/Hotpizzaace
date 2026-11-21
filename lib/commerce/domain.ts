import { canCancelUnpaidOrder } from '../order-cancellation';
import { BILL_QUOTE_CHANGED_MESSAGE, payableQuoteMatches } from '../rounding';
import { z } from 'zod';
import { changeCounterStatus } from '../counter';
import type { Branch, Category, Order, OrderStatus, PaymentMode, Product } from '../../types';
import {
  getAllowedOrderStatuses,
  getCartTotals,
  getItemOptions,
  getUnitPrice,
  isOnlinePaymentComplete,
  validateCoupon,
} from '../pricing';
import {
  branchSchema,
  categorySchema,
  customerSchema,
  parseOrThrow,
  productSchema,
  settingsSchema,
  validateCheckout,
} from '../validation';

export type CommerceCatalog = {
  products: Product[];
  categories: Category[];
  branches: Branch[];
  revision: number;
  mode?: string;
  allowSimulatedPayments?: boolean;
  payments?: { provider: 'razorpay' | 'phonepe'; mode: 'test' | 'live'; enabled: boolean };
};
export type SharedOrder = Order & {
  version: number;
  accessToken?: string;
};

export class CommerceError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = 'invalid_request',
  ) {
    super(message);
  }
}

export function equalCapability(
  first: string | null | undefined,
  second: string | null | undefined,
): boolean {
  if (!first || !second || first.length !== second.length) return false;
  let difference = 0;
  for (let index = 0; index < first.length; index++)
    difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
  return difference === 0;
}

/** A shared browser nonce never grants access to another signed-in customer's orders. */
export function canAccessSharedOrder(
  order: { user_id: string | null; guest_session_hash: string | null; tracking_token_hash: string },
  viewer: { userId: string | null; admin: boolean; guestHash: string; accessHash?: string },
  allowTracking: boolean,
): boolean {
  return (
    viewer.admin ||
    (!!viewer.userId && order.user_id === viewer.userId) ||
    (!viewer.userId &&
      order.user_id === null &&
      equalCapability(order.guest_session_hash, viewer.guestHash)) ||
    (allowTracking && equalCapability(order.tracking_token_hash, viewer.accessHash))
  );
}

const id = z.string().trim().min(1).max(100);
const itemSchema = z
  .object({
    id,
    productId: id,
    sizeId: z.string().min(1).max(80).optional(),
    crustId: z.string().min(1).max(80).optional(),
    toppingIds: z.array(z.string().min(1).max(80)).max(30),
    quantity: z.number().int().min(1).max(20),
    notes: z.string().max(300),
  })
  .strict();
export const createOrderSchema = z
  .object({
    branchId: id,
    items: z.array(itemSchema).min(1).max(50),
    customer: customerSchema,
    fulfillment: z.enum(['delivery', 'pickup']),
    paymentMethod: z.enum(['upi', 'card', 'cash']),
    coupon: z
      .string()
      .trim()
      .max(20)
      .transform((value) => value.toUpperCase())
      .default(''),
    idempotencyKey: z.string().trim().min(8).max(150),
    expectedTotal: z.number().int().min(1).max(100_000_000).optional(),
    expectedRoundOffPolicy: z.literal('nearest_rupee').optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (new Set(input.items.map((item) => item.id)).size !== input.items.length)
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'Cart line IDs must be unique.',
      });
  });
export type CreateOrderRequest = z.infer<typeof createOrderSchema>;

export function parseCreateOrderRequest(input: unknown): CreateOrderRequest {
  return parseOrThrow(createOrderSchema, input);
}

/** Prices, descriptions, kitchen settings, and payment state come only from the current catalog. */
export function priceSharedOrder(
  input: CreateOrderRequest,
  catalog: CommerceCatalog,
  orderId: string,
  now: string,
  requirePayableQuote = false,
): SharedOrder {
  const branch = catalog.branches.find((candidate) => candidate.id === input.branchId);
  if (!branch) throw new CommerceError('This branch is no longer available. Review your cart.');
  const products = catalog.products.filter((product) =>
    catalog.categories.some((category) => category.id === product.categoryId && !category.archived),
  );
  const totals = getCartTotals(
    input.items,
    products,
    branch.settings,
    input.coupon,
    input.fulfillment,
  );
  if (requirePayableQuote && !payableQuoteMatches(input, totals))
    throw new CommerceError(BILL_QUOTE_CHANGED_MESSAGE, 409, 'quote_changed');
  if (input.coupon) validateCoupon(input.coupon, branch.settings, totals.subtotal);
  const validated = validateCheckout(
    {
      customer: input.customer,
      fulfillment: input.fulfillment,
      paymentMethod: input.paymentMethod,
      paymentStatus: input.paymentMethod === 'cash' ? 'pending' : 'initiated',
      idempotencyKey: input.idempotencyKey,
      branchId: branch.id,
    },
    branch.settings,
    totals.subtotal,
    totals.total,
  );
  if (!Number.isSafeInteger(totals.total) || totals.total > 100_000_000)
    throw new CommerceError('This order is too large. Please contact the restaurant.');
  if (totals.tax && totals.total >= 5_000_000)
    throw new CommerceError(
      'For orders of ₹50,000 or more, contact the restaurant to provide the additional invoice details.',
    );
  let paymentMode: PaymentMode | undefined;
  if (validated.paymentMethod !== 'cash') {
    const gateway = catalog.payments;
    if (
      gateway?.enabled === true &&
      (gateway.provider === 'razorpay' || gateway.provider === 'phonepe') &&
      ((catalog.mode === 'development' && gateway.mode === 'test') ||
        (catalog.mode === 'production' && gateway.mode === 'live'))
    ) {
      if (totals.total < 100)
        throw new CommerceError(
          'Online payment requires a total of at least ₹1. Choose cash or review your coupon.',
        );
      paymentMode =
        gateway.provider === 'phonepe'
          ? gateway.mode === 'test'
            ? 'phonepe_test'
            : 'phonepe_live'
          : gateway.mode === 'test'
            ? 'razorpay_test'
            : 'razorpay_live';
    } else if (
      gateway?.enabled === true ||
      catalog.mode === 'production' ||
      (catalog.mode === 'development' && catalog.allowSimulatedPayments !== true)
    )
      throw new CommerceError(
        'Online payment is currently unavailable.',
        503,
        'payment_unavailable',
      );
    else paymentMode = 'simulation';
  } else if (catalog.mode !== 'production') paymentMode = 'simulation';
  return {
    id: orderId,
    number: `HPA-${now.replace(/\D/g, '').slice(2, 14)}-${orderId.replaceAll('-', '').slice(0, 8).toUpperCase()}`,
    createdAt: now,
    branchId: branch.id,
    branchName: branch.name,
    branchAddress: branch.settings.address,
    branchPhone: branch.settings.phone,
    customer: structuredClone(validated.customer),
    fulfillment: validated.fulfillment,
    items: input.items.map((item) => {
      const product = products.find((candidate) => candidate.id === item.productId)!;
      return {
        id: item.id,
        productId: product.id,
        name: product.name,
        image: product.image,
        options: getItemOptions(product, item),
        notes: item.notes,
        quantity: item.quantity,
        unitPrice: getUnitPrice(product, item),
        ...(product.gstInclusive ? { gstInclusive: structuredClone(product.gstInclusive) } : {}),
      };
    }),
    ...totals,
    coupon: input.coupon,
    paymentMethod: validated.paymentMethod,
    paymentStatus: validated.paymentStatus,
    status: 'pending',
    version: 1,
    ...(paymentMode ? { paymentMode } : {}),
  };
}

export function cancelUnpaidOrder(order: SharedOrder): SharedOrder {
  if (!canCancelUnpaidOrder(order))
    throw new CommerceError(
      'Only unpaid orders awaiting confirmation can be cancelled here. Refresh the order or contact the restaurant.',
      409,
      'order_not_cancellable',
    );
  return { ...order, status: 'cancelled', version: order.version + 1 };
}

export function changeOrderStatus(
  order: SharedOrder,
  status: unknown,
  now = new Date().toISOString(),
): SharedOrder {
  if (order.channel === 'counter') return changeCounterStatus(order, status, now);
  if (typeof status !== 'string' || !getAllowedOrderStatuses(order).includes(status as OrderStatus))
    throw new CommerceError('This order status change is not allowed. Reload the order.');
  if (
    order.paymentMethod !== 'cash' &&
    !isOnlinePaymentComplete(order) &&
    !['cancelled', 'rejected'].includes(status)
  )
    throw new CommerceError('Complete payment before accepting this order.');
  return {
    ...order,
    status: status as OrderStatus,
    version: order.version + 1,
    ...(['delivered', 'picked_up', 'served', 'closed'].includes(status)
      ? { completedAt: order.completedAt ?? now }
      : {}),
  };
}

export function changeSimulatedPayment(
  order: SharedOrder,
  outcome: unknown,
  admin: boolean,
): SharedOrder {
  if (
    (order.paymentMode !== undefined && order.paymentMode !== 'simulation') ||
    order.paymentStatus === 'paid'
  )
    throw new CommerceError(
      'Provider payments cannot be changed through demo payment controls.',
      403,
      'forbidden',
    );
  if (order.status === 'cancelled' || order.status === 'rejected')
    throw new CommerceError('Payment cannot be changed for a cancelled or rejected order.');
  if (!['success', 'failed', 'cash_collected'].includes(String(outcome)))
    throw new CommerceError('Choose a valid demo payment outcome.');
  if (order.paymentMethod === 'cash') {
    if (!admin || outcome !== 'cash_collected')
      throw new CommerceError(
        'Only an administrator can record cash collection.',
        403,
        'forbidden',
      );
    if (!['delivered', 'picked_up'].includes(order.status))
      throw new CommerceError('Record cash collection after the order is handed over.');
  } else if (outcome === 'cash_collected')
    throw new CommerceError('This order is not a cash order.');
  if (order.paymentStatus === 'simulated_paid') {
    if (outcome === 'failed')
      throw new CommerceError('A completed demo payment cannot be changed to failed.');
    return order;
  }
  return {
    ...order,
    paymentStatus: outcome === 'failed' ? 'failed' : 'simulated_paid',
    paymentMode: 'simulation',
    version: order.version + 1,
  };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new CommerceError('Invalid change details.');
  return value as Record<string, unknown>;
}
function requiredId(value: unknown): string {
  return parseOrThrow(id, value);
}

/** Catalog edits are validated here, then committed with a database revision compare-and-swap. */
export function mutateCatalog(
  previous: CommerceCatalog,
  action: unknown,
  args: unknown,
): CommerceCatalog {
  const catalog = structuredClone(previous);
  const positional = Array.isArray(args) ? args : null;
  const input: Record<string, unknown> = positional
    ? action === 'saveProduct'
      ? { product: positional[0] }
      : action === 'saveCategory'
        ? { category: positional[0] }
        : action === 'saveBranch'
          ? { branch: positional[0] }
          : action === 'updateSettings'
            ? { settings: positional[0], branchId: object(positional[1]).branchId }
            : action === 'setPaymentMethodEnabled'
              ? { method: positional[0], enabled: positional[1], branchId: positional[2] }
              : { id: positional[0], direction: positional[1] }
    : object(args);
  if (action === 'saveProduct') {
    const product = parseOrThrow(productSchema, input.product ?? args);
    const existing = catalog.products.find((item) => item.id === product.id);
    if (product.sizes.length && product.sizes[0].price !== product.price) {
      const baseChanged = existing && existing.price !== product.price;
      const firstSizeChanged = !existing || existing.sizes[0]?.price !== product.sizes[0].price;
      if (baseChanged && !firstSizeChanged)
        product.sizes[0] = { ...product.sizes[0], price: product.price };
      else if (!baseChanged && firstSizeChanged && existing) product.price = product.sizes[0].price;
      else throw new CommerceError('The base price must match the first size’s full price.');
    }
    if (
      !catalog.categories.some(
        (category) => category.id === product.categoryId && !category.archived,
      )
    )
      throw new CommerceError('Choose an active category.');
    if (catalog.products.some((item) => item.id !== product.id && item.slug === product.slug))
      throw new CommerceError('Another product already uses that slug.');
    catalog.products = existing
      ? catalog.products.map((item) => (item.id === product.id ? product : item))
      : [...catalog.products, product];
  } else if (['archiveProduct', 'deleteProduct', 'restoreProduct'].includes(String(action))) {
    const productId = requiredId(input.id);
    const product = catalog.products.find((item) => item.id === productId);
    if (!product) throw new CommerceError('This product could not be found.');
    // Keep order history independent from current product existence. Delete is a reversible archive.
    if (
      action === 'restoreProduct' &&
      !catalog.categories.some(
        (category) => category.id === product.categoryId && !category.archived,
      )
    )
      throw new CommerceError('Restore or change this product’s category first.');
    catalog.products = catalog.products.map((item) =>
      item.id === productId
        ? { ...item, archived: action !== 'restoreProduct', available: action === 'restoreProduct' }
        : item,
    );
  } else if (action === 'saveCategory') {
    const category = parseOrThrow(categorySchema, input.category ?? args);
    if (catalog.categories.some((item) => item.id !== category.id && item.slug === category.slug))
      throw new CommerceError('Another category already uses that slug.');
    if (
      category.archived &&
      catalog.products.some((product) => product.categoryId === category.id && !product.archived)
    )
      throw new CommerceError('Move or archive this category’s products first.');
    catalog.categories = catalog.categories.some((item) => item.id === category.id)
      ? catalog.categories.map((item) => (item.id === category.id ? category : item))
      : [...catalog.categories, category];
  } else if (['archiveCategory', 'restoreCategory', 'deleteCategory'].includes(String(action))) {
    const categoryId = requiredId(input.id);
    const category = catalog.categories.find((item) => item.id === categoryId);
    if (!category) throw new CommerceError('This category could not be found.');
    if (action === 'deleteCategory') {
      if (!category.archived)
        throw new CommerceError('Archive this category before deleting it permanently.');
      if (catalog.products.some((product) => product.categoryId === categoryId))
        throw new CommerceError(
          'Move all linked products, including archived products, before deleting this category.',
        );
      catalog.categories = catalog.categories.filter((item) => item.id !== categoryId);
    } else {
      if (
        action === 'archiveCategory' &&
        catalog.products.some((product) => product.categoryId === categoryId && !product.archived)
      )
        throw new CommerceError('Move or archive this category’s products first.');
      catalog.categories = catalog.categories.map((item) =>
        item.id === categoryId ? { ...item, archived: action === 'archiveCategory' } : item,
      );
    }
  } else if (action === 'moveCategory' || action === 'reorderCategory') {
    const categoryId = requiredId(input.id);
    if (input.direction !== 'up' && input.direction !== 'down')
      throw new CommerceError('Choose a valid category direction.');
    const active = catalog.categories
      .filter((category) => !category.archived)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const index = active.findIndex((category) => category.id === categoryId);
    if (index < 0) throw new CommerceError('This category could not be found.');
    const next = input.direction === 'up' ? index - 1 : index + 1;
    if (next >= 0 && next < active.length)
      [active[index], active[next]] = [active[next], active[index]];
    const order = new Map(active.map((category, index) => [category.id, index]));
    catalog.categories = catalog.categories.map((category) => ({
      ...category,
      sortOrder: order.get(category.id) ?? category.sortOrder,
    }));
  } else if (
    action === 'updateSettings' ||
    action === 'updatePaymentMethods' ||
    action === 'setPaymentMethodEnabled'
  ) {
    const branchId = requiredId(input.branchId);
    const branch = catalog.branches.find((item) => item.id === branchId);
    if (!branch) throw new CommerceError('Choose an existing branch.');
    let settings = input.settings;
    if (action === 'updatePaymentMethods')
      settings = { ...branch.settings, paymentMethods: input.paymentMethods };
    if (action === 'setPaymentMethodEnabled') {
      const method = parseOrThrow(z.enum(['upi', 'card', 'cash']), input.method);
      const enabled = parseOrThrow(z.boolean(), input.enabled);
      settings = {
        ...branch.settings,
        paymentMethods: enabled
          ? [...new Set([...branch.settings.paymentMethods, method])]
          : branch.settings.paymentMethods.filter((item) => item !== method),
      };
    }
    const validated = parseOrThrow(settingsSchema, settings);
    catalog.branches = catalog.branches.map((item) =>
      item.id === branchId ? { ...item, settings: validated } : item,
    );
  } else if (action === 'saveBranch') {
    const branch = parseOrThrow(branchSchema, input.branch ?? args);
    if (catalog.branches.some((item) => item.id !== branch.id && item.slug === branch.slug))
      throw new CommerceError('Another branch already uses that URL name.');
    branch.settings.servicePostalCodes = [...new Set(branch.settings.servicePostalCodes)];
    catalog.branches = catalog.branches.some((item) => item.id === branch.id)
      ? catalog.branches.map((item) => (item.id === branch.id ? branch : item))
      : [...catalog.branches, branch];
  } else throw new CommerceError('This catalog action is not supported.');
  if (
    catalog.products.length > 1000 ||
    catalog.categories.length > 100 ||
    catalog.branches.length > 100
  )
    throw new CommerceError('Catalog capacity reached. Contact support before adding more.');
  return { ...catalog, revision: previous.revision + 1 };
}
