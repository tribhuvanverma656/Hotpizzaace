import { z } from 'zod';
import type { CounterSettlement, Order, OrderStatus } from '../types';
import type { CommerceCatalog, SharedOrder } from './commerce/domain';
import {
  formatCurrency,
  getCartTotals,
  getItemOptions,
  getMinimumOrderShortfall,
  getUnitPrice,
  validateCoupon,
} from './pricing';
import { isStaffCounterPaymentComplete } from './payments/counter';
import { BILL_QUOTE_CHANGED_MESSAGE, payableQuoteMatches } from './rounding';

export class CounterError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = 'invalid_request',
  ) {
    super(message);
    this.name = 'CounterError';
  }
}

/** Opaque seek cursor: collecting an earlier bill must not skip the next unpaid bill. */
export function parseCounterPaymentCursor(
  cursor: string,
): { createdAt: string; id: string } | null {
  if (cursor === 'start') return null;
  try {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(cursor)) throw new Error();
    const decoded = atob(cursor.replaceAll('-', '+').replaceAll('_', '/'));
    const [createdAt, id, extra] = decoded.split('~');
    if (
      extra !== undefined ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(createdAt) ||
      !Number.isFinite(Date.parse(createdAt)) ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id) ||
      encodeCounterPaymentCursor(createdAt, id) !== cursor
    )
      throw new Error();
    return { createdAt, id };
  } catch {
    throw new CounterError('Refresh the awaiting-payment list to continue.', 400, 'invalid_cursor');
  }
}

export function encodeCounterPaymentCursor(createdAt: string, id: string): string {
  return btoa(`${createdAt}~${id}`).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

const id = z.string().trim().min(1).max(100);
const paymentSchema = z.discriminatedUnion('method', [
  z
    .object({
      method: z.literal('cash'),
      confirmedReceived: z.literal(true),
      cashTendered: z.number().int().min(0).max(100_000_000),
    })
    .strict(),
  z
    .object({
      method: z.literal('upi'),
      confirmedReceived: z.literal(true),
      upiReference: z
        .string()
        .trim()
        .toUpperCase()
        .regex(
          /^(?:[A-Z0-9]{6,80})?$/,
          'Enter the full UPI transaction reference (6–80 letters or digits).',
        )
        .transform(value => value || undefined)
        .optional(),
    })
    .strict(),
]);
export type CounterPayment = z.infer<typeof paymentSchema>;
const counterSchema = z
  .object({
    branchId: id,
    fulfillment: z.enum(['dine_in', 'delivery']).default('dine_in'),
    items: z
      .array(
        z
          .object({
            id,
            productId: id,
            sizeId: z.string().min(1).max(80).optional(),
            crustId: z.string().min(1).max(80).optional(),
            toppingIds: z.array(id).max(30),
            quantity: z.number().int().min(1).max(20),
            notes: z.string().max(300),
          })
          .strict(),
      )
      .min(1)
      .max(50),
    customerName: z.string().trim().max(80).optional(),
    customerPhone: z
      .string()
      .trim()
      .regex(/^(?:[6-9][0-9]{9})?$/, 'Enter a valid 10-digit mobile or leave it blank.')
      .optional(),
    tableLabel: z.string().trim().max(40).optional(),
    deliveryAddress: z
      .object({
        address: z.string().trim().min(8, 'Enter the complete delivery address.').max(200),
        locality: z.string().trim().min(2, 'Enter the delivery locality.').max(100),
        postalCode: z
          .string()
          .trim()
          .regex(/^\d{6}$/, 'Enter a valid 6-digit delivery PIN code.'),
        landmark: z.string().trim().max(120).optional(),
        instructions: z.string().trim().max(300).optional(),
      })
      .strict()
      .optional(),
    coupon: z.string().trim().toUpperCase().max(20).default(''),
    expectedRevision: z.number().int().min(1),
    expectedTotal: z.number().int().min(1).max(100_000_000).optional(),
    expectedRoundOffPolicy: z.literal('nearest_rupee').optional(),
    idempotencyKey: z.string().uuid(),
    payment: paymentSchema.nullable(),
    payLaterReason: z.string().trim().max(200).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.fulfillment === 'delivery') {
      if (!value.customerName || value.customerName.length < 2)
        ctx.addIssue({
          code: 'custom',
          path: ['customerName'],
          message: 'Enter the delivery customer’s name.',
        });
      if (!value.customerPhone || !/^[6-9]\d{9}$/.test(value.customerPhone))
        ctx.addIssue({
          code: 'custom',
          path: ['customerPhone'],
          message: 'Enter a valid 10-digit delivery mobile number.',
        });
      if (!value.deliveryAddress)
        ctx.addIssue({
          code: 'custom',
          path: ['deliveryAddress'],
          message: 'Enter the delivery address and PIN code.',
        });
    } else if (value.deliveryAddress) {
      ctx.addIssue({
        code: 'custom',
        path: ['deliveryAddress'],
        message: 'Delivery details are only used for Home delivery.',
      });
    }
    if (new Set(value.items.map((item) => item.id)).size !== value.items.length)
      ctx.addIssue({ code: 'custom', path: ['items'], message: 'Cart line IDs must be unique.' });
    if (!value.payment && (!value.payLaterReason || value.payLaterReason.length < 3))
      ctx.addIssue({
        code: 'custom',
        path: ['payLaterReason'],
        message: 'Give a reason before sending an unpaid order to the kitchen.',
      });
    if (value.payment && value.payLaterReason)
      ctx.addIssue({
        code: 'custom',
        path: ['payLaterReason'],
        message: 'Choose payment received or the pay-later exception.',
      });
  });
export type CounterOrderRequest = z.infer<typeof counterSchema>;
const settlementSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    idempotencyKey: z.string().uuid(),
    payment: paymentSchema,
  })
  .strict();
export type CounterSettlementRequest = z.infer<typeof settlementSchema>;
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new CounterError(parsed.error.issues[0].message);
  return parsed.data;
}
export const parseCounterOrderRequest = (value: unknown) => parse(counterSchema, value);
export const parseCounterSettlementRequest = (value: unknown) => parse(settlementSchema, value);
export const parseCounterStatusRequest = (value: unknown) =>
  parse(
    z
      .object({
        expectedVersion: z.number().int().min(1),
        status: z.enum([
          'preparing',
          'ready',
          'served',
          'closed',
          'cancelled',
          'out_for_delivery',
          'delivered',
        ]),
      })
      .strict(),
    value,
  );

export function isCounterOrder(
  order: Pick<Order, 'channel' | 'fulfillment' | 'paymentMode'>,
): boolean {
  return (
    order.channel === 'counter' &&
    ['dine_in', 'delivery'].includes(order.fulfillment) &&
    order.paymentMode === 'counter_manual'
  );
}
export function isCounterPaymentComplete(order: Order): boolean {
  return isStaffCounterPaymentComplete(order);
}

function receipt(
  total: number,
  payment: CounterPayment,
  actorId: string,
  now: string,
): CounterSettlement {
  if (!Number.isSafeInteger(total) || total <= 0)
    throw new CounterError('The counter total must be greater than zero.');
  if (payment.method === 'cash') {
    if (payment.cashTendered < total)
      throw new CounterError('Cash received is less than the bill total.');
    return {
      source: 'staff',
      method: 'cash',
      amount: total,
      cashTendered: payment.cashTendered,
      change: payment.cashTendered - total,
      confirmedBy: actorId,
      confirmedAt: now,
    };
  }
  return {
    source: 'staff',
    method: 'upi',
    amount: total,
    upiReference: payment.upiReference,
    confirmedBy: actorId,
    confirmedAt: now,
  };
}

/** All prices, tax, staff identity and environment are authored on the trusted server. */
export function priceCounterOrder(
  input: CounterOrderRequest,
  catalog: CommerceCatalog,
  orderId: string,
  now: string,
  actorId: string,
  requirePayableQuote = false,
): SharedOrder {
  const branch = catalog.branches.find((b) => b.id === input.branchId);
  if (!branch) throw new CounterError('This branch is unavailable.');
  if (catalog.revision !== input.expectedRevision)
    throw new CounterError(
      'The menu changed. Refresh and review the bill before collecting payment.',
      409,
      'revision_conflict',
    );
  if (branch.settings.counterAcceptingOrders !== true || branch.settings.temporarilyClosed)
    throw new CounterError('Counter ordering is paused for this branch.', 409, 'counter_closed');
  if (!branch.settings.billing)
    throw new CounterError(
      'Complete this branch’s GST and FSSAI billing profile before taking counter orders.',
      409,
      'billing_required',
    );
  if (!['development', 'production'].includes(catalog.mode ?? ''))
    throw new CounterError(
      'The counter environment could not be verified.',
      503,
      'counter_unavailable',
    );
  if (input.fulfillment === 'delivery') {
    if (!branch.settings.deliveryEnabled)
      throw new CounterError(
        'Home delivery is paused for this branch.',
        409,
        'delivery_unavailable',
      );
    if (
      !input.deliveryAddress ||
      !branch.settings.servicePostalCodes.includes(input.deliveryAddress.postalCode)
    )
      throw new CounterError(
        'This PIN code is outside this branch’s delivery area.',
        400,
        'delivery_area_unavailable',
      );
  }
  const products = catalog.products.filter((p) =>
    catalog.categories.some((c) => c.id === p.categoryId && !c.archived),
  );
  let totals: ReturnType<typeof getCartTotals>;
  try {
    totals = getCartTotals(input.items, products, branch.settings, input.coupon, input.fulfillment);
    if (input.coupon) validateCoupon(input.coupon, branch.settings, totals.subtotal);
  } catch (error) {
    throw new CounterError(
      error instanceof Error ? error.message : 'Review the selected menu items.',
    );
  }
  if (!Number.isSafeInteger(totals.total) || totals.total <= 0)
    throw new CounterError('The bill total must be greater than zero.');
  if (
    input.fulfillment === 'delivery' &&
    getMinimumOrderShortfall(totals.total, branch.settings, 'delivery')
  )
    throw new CounterError(
      `The minimum delivery total is ${formatCurrency(branch.settings.minimumOrder)}, including delivery and after discounts.`,
      400,
      'delivery_minimum',
    );
  if (totals.total >= 5_000_000)
    throw new CounterError(
      'Orders of ₹50,000 or more need additional invoice details. Contact the owner.',
    );
  if (requirePayableQuote && !payableQuoteMatches(input, totals))
    throw new CounterError(BILL_QUOTE_CHANGED_MESSAGE, 409, 'quote_changed');
  const settlement = input.payment ? receipt(totals.total, input.payment, actorId, now) : undefined;
  return {
    id: orderId,
    number: `HPA-${now.replace(/\D/g, '').slice(2, 14)}-${orderId.replaceAll('-', '').slice(0, 8).toUpperCase()}`,
    createdAt: now,
    branchId: branch.id,
    branchName: branch.name,
    branchAddress: branch.settings.address,
    branchPhone: branch.settings.phone,
    channel: 'counter',
    environment: catalog.mode as 'development' | 'production',
    fulfillment: input.fulfillment,
    paymentMode: 'counter_manual',
    customer: {
      name: input.customerName || 'Walk-in customer',
      phone: input.customerPhone || '',
      address: input.deliveryAddress?.address ?? '',
      locality: input.deliveryAddress?.locality ?? '',
      postalCode: input.deliveryAddress?.postalCode ?? '',
      landmark: input.deliveryAddress?.landmark ?? '',
      instructions: input.deliveryAddress?.instructions ?? '',
    },
    counter: {
      tableLabel: input.fulfillment === 'dine_in' ? (input.tableLabel ?? '') : '',
      payLater: !input.payment,
      ...(!input.payment ? { payLaterReason: input.payLaterReason } : {}),
      createdBy: actorId,
    },
    items: input.items.map((item) => {
      const product = products.find((p) => p.id === item.productId)!;
      return {
        id: item.id,
        productId: product.id,
        name: product.name,
        image: product.image,
        quantity: item.quantity,
        notes: item.notes,
        options: getItemOptions(product, item),
        unitPrice: getUnitPrice(product, item),
        ...(product.gstInclusive ? { gstInclusive: structuredClone(product.gstInclusive) } : {}),
      };
    }),
    ...totals,
    coupon: input.coupon,
    paymentMethod: input.payment?.method ?? 'cash',
    paymentStatus: settlement ? 'paid' : 'pending',
    ...(settlement ? { settlement } : {}),
    status: 'confirmed',
    version: 1,
  };
}

export function settleCounterOrder(
  order: SharedOrder,
  payment: CounterPayment,
  actorId: string,
  now: string,
): SharedOrder {
  if (!isCounterOrder(order) || !order.counter)
    throw new CounterError('This is not a dine-in counter order.', 404, 'not_found');
  if (order.testVoid)
    throw new CounterError('This software test order was removed.', 410, 'order_removed');
  if (order.paymentStatus === 'paid' || order.settlement)
    throw new CounterError(
      'Payment is already recorded. Reload the bill.',
      409,
      'payment_already_complete',
    );
  if (['cancelled', 'rejected', 'closed'].includes(order.status) || order.paymentReviewRequired)
    throw new CounterError('This bill cannot accept another payment.', 409, 'order_not_payable');
  return {
    ...order,
    settlement: receipt(order.total, payment, actorId, now),
    paymentMethod: payment.method,
    paymentStatus: 'paid',
    version: order.version + 1,
  };
}

export function changeCounterStatus(
  order: SharedOrder,
  status: unknown,
  now = new Date().toISOString(),
): SharedOrder {
  if (!isCounterOrder(order) || !order.counter)
    throw new CounterError('This is not a dine-in counter order.', 404, 'not_found');
  if (order.testVoid)
    throw new CounterError('This software test order was removed.', 410, 'order_removed');
  const allowed: Partial<Record<OrderStatus, OrderStatus[]>> = {
    confirmed: ['preparing', 'cancelled'],
    preparing: ['ready', 'cancelled'],
    ...(order.fulfillment === 'delivery'
      ? {
          ready: ['out_for_delivery', 'cancelled'] as OrderStatus[],
          out_for_delivery: ['delivered'] as OrderStatus[],
        }
      : { ready: ['served', 'cancelled'] as OrderStatus[], served: ['closed'] as OrderStatus[] }),
  };
  if (typeof status !== 'string' || !allowed[order.status]?.includes(status as OrderStatus))
    throw new CounterError(
      'This dine-in status change is not allowed.',
      409,
      'invalid_status_transition',
    );
  if (order.paymentReviewRequired)
    throw new CounterError('Review the payment before continuing.', 409, 'payment_review_required');
  if (
    !isCounterPaymentComplete(order) &&
    !(order.counter.payLater && !!order.counter.payLaterReason)
  )
    throw new CounterError(
      'Collect payment or explicitly authorize pay later before preparing food.',
      409,
      'payment_not_complete',
    );
  if (
    ['closed', 'out_for_delivery', 'delivered'].includes(status as string) &&
    !isCounterPaymentComplete(order)
  )
    throw new CounterError(
      'Collect the outstanding payment before closing or dispatching this order.',
      409,
      'payment_not_complete',
    );
  if (status === 'cancelled' && isCounterPaymentComplete(order))
    throw new CounterError(
      'A paid bill requires a recorded refund/reversal. Contact the owner.',
      409,
      'refund_required',
    );
  return {
    ...order,
    status: status as OrderStatus,
    version: order.version + 1,
    counter: {
      ...order.counter,
      ...(status === 'served' ? { servedAt: now } : {}),
      ...(status === 'closed' ? { closedAt: now } : {}),
    },
    ...(['served', 'delivered'].includes(status as string) ? { completedAt: now } : {}),
  };
}

export function counterKitchenEligible(order: Order): boolean {
  return (
    isCounterOrder(order) &&
    !order.testVoid &&
    ['confirmed', 'preparing'].includes(order.status) &&
    !order.paymentReviewRequired &&
    (isCounterPaymentComplete(order) ||
      (order.paymentStatus === 'pending' &&
        order.counter?.payLater === true &&
        !!order.counter.payLaterReason?.trim()))
  );
}
