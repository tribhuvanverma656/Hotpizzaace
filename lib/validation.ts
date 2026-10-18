import { z } from 'zod';
import type { CheckoutInput, RestaurantSettings } from '../types';
import { formatCurrency, getDeliveryFee, getMinimumOrderShortfall } from './pricing';

const phoneSchema = z
  .string()
  .trim()
  .regex(/^(?:\+91[ -]?)?[6-9](?:[ -]?\d){9}$/, 'Enter a valid 10-digit Indian mobile number.');
const moneySchema = z.number().int().min(0).max(10000000);
const optionSchema = z.object({
  id: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(100),
  price: moneySchema,
  sizePrices: z.record(z.string().min(1).max(80), moneySchema).optional(),
});
const optionList = z
  .array(optionSchema)
  .max(30)
  .refine(
    (options) => new Set(options.map((option) => option.id)).size === options.length,
    'Option IDs must be unique.',
  );

export const customerSchema = z.object({
  name: z.string().trim().min(2, 'Enter your full name.').max(80),
  phone: phoneSchema,
  address: z.string().trim().max(300),
  locality: z.string().trim().max(100),
  postalCode: z.string().trim().max(6),
  landmark: z.string().trim().max(150),
  instructions: z.string().trim().max(300),
});

export const checkoutSchema = z
  .object({
    customer: customerSchema,
    fulfillment: z.enum(['delivery', 'pickup']),
    paymentMethod: z.enum(['upi', 'card', 'cash']),
    paymentStatus: z.enum(['initiated', 'pending', 'simulated_paid', 'failed']),
    idempotencyKey: z
      .string()
      .trim()
      .min(8, 'Checkout session expired. Please try again.')
      .max(150),
    branchId: z.string().min(1).max(100).optional(),
  })
  .superRefine((input, context) => {
    if (input.paymentMethod === 'cash' && input.paymentStatus === 'simulated_paid')
      context.addIssue({
        code: 'custom',
        path: ['paymentStatus'],
        message: 'Cash is collected when your order is handed over.',
      });
    if (input.fulfillment !== 'delivery') return;
    if (input.customer.address.length < 8)
      context.addIssue({
        code: 'custom',
        path: ['customer', 'address'],
        message: 'Enter your complete delivery address.',
      });
    if (input.customer.locality.length < 2)
      context.addIssue({
        code: 'custom',
        path: ['customer', 'locality'],
        message: 'Enter your locality.',
      });
    if (!/^\d{6}$/.test(input.customer.postalCode))
      context.addIssue({
        code: 'custom',
        path: ['customer', 'postalCode'],
        message: 'Enter a valid 6-digit postal code.',
      });
  });

export function validateCheckout(
  input: CheckoutInput,
  settings: RestaurantSettings,
  subtotal: number,
  total = subtotal + getDeliveryFee(subtotal, settings, input.fulfillment),
): CheckoutInput {
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  if (settings.temporarilyClosed || !settings.acceptingOrders)
    throw new Error('We are not accepting orders right now. Please check back soon.');
  if (input.fulfillment === 'delivery' && !settings.deliveryEnabled)
    throw new Error('Delivery is currently unavailable. Please choose pickup.');
  if (input.fulfillment === 'pickup' && !settings.pickupEnabled)
    throw new Error('Pickup is currently unavailable. Please choose delivery.');
  if (
    input.fulfillment === 'delivery' &&
    !settings.servicePostalCodes.includes(parsed.data.customer.postalCode)
  )
    throw new Error(
      'This postal code is outside our delivery area. You can choose pickup instead.',
    );
  const shortfall = getMinimumOrderShortfall(total, settings, input.fulfillment);
  if (shortfall)
    throw new Error(
      `The minimum order total for delivery is ${formatCurrency(settings.minimumOrder)}, including delivery and after discounts. Add ${formatCurrency(shortfall)} more or choose pickup with no minimum.`,
    );
  if (!settings.paymentMethods.includes(parsed.data.paymentMethod))
    throw new Error('This payment method is currently unavailable. Please choose another.');
  if (parsed.data.paymentMethod === 'cash' && parsed.data.paymentStatus !== 'pending')
    throw new Error('Cash orders must await collection.');
  return parsed.data;
}

export const productSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    name: z.string().trim().min(2).max(100),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use a lowercase slug with hyphens.'),
    description: z.string().trim().min(10).max(1000),
    image: z
      .string()
      .min(1)
      .max(3000000)
      .refine(
        (image) =>
          /^\/(?!\/)/.test(image) ||
          /^https:\/\//.test(image) ||
          /^data:image\/(?:jpeg|png|webp|gif);base64,/.test(image),
        'Choose a local image, HTTPS image URL or image upload.',
      ),
    categoryId: z.string().min(1),
    vegetarian: z.boolean(),
    price: moneySchema,
    available: z.boolean(),
    archived: z.boolean().optional(),
    featured: z.boolean(),
    bestseller: z.boolean(),
    sizes: optionList,
    crusts: optionList,
    toppings: optionList,
    badge: z.string().trim().max(40).optional(),
  })
  .superRefine((product, context) => {
    for (const group of ['crusts', 'toppings'] as const) {
      product[group].forEach((option, index) => {
        if (
          Object.keys(option.sizePrices ?? {}).some(
            (id) => !product.sizes.some((size) => size.id === id),
          )
        )
          context.addIssue({
            code: 'custom',
            path: [group, index, 'sizePrices'],
            message: 'Add-on prices must refer to an existing size ID.',
          });
      });
    }
  });

export const categorySchema = z.object({
  id: z.string().trim().min(1).max(100),
  name: z.string().trim().min(2).max(80),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  archived: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1000),
});

export const settingsSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    address: z.string().trim().min(8).max(300),
    phone: phoneSchema,
    openingHours: z.string().trim().min(3).max(200),
    temporarilyClosed: z.boolean(),
    acceptingOrders: z.boolean(),
    deliveryEnabled: z.boolean(),
    pickupEnabled: z.boolean(),
    deliveryFee: moneySchema,
    freeDeliveryThreshold: moneySchema.nullable(),
    minimumOrder: moneySchema,
    servicePostalCodes: z
      .array(z.string().regex(/^\d{6}$/, 'Service postal codes must contain 6 digits.'))
      .max(100),
    preparationMinutes: z.number().int().min(5).max(240),
    paymentMethods: z
      .array(z.enum(['upi', 'card', 'cash']))
      .min(1)
      .max(3),
    couponCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(
        /^(?:[A-Z0-9]{3,20})?$/,
        'Coupon code must contain 3–20 letters or numbers, or be empty to disable.',
      ),
    couponPercent: z.number().min(0).max(100),
    couponMinimum: moneySchema,
    couponMaximum: moneySchema,
  })
  .superRefine((settings, context) => {
    if (settings.deliveryEnabled && settings.servicePostalCodes.length === 0)
      context.addIssue({
        code: 'custom',
        path: ['servicePostalCodes'],
        message: 'Add at least one delivery postal code.',
      });
    if (!settings.deliveryEnabled && !settings.pickupEnabled && settings.acceptingOrders)
      context.addIssue({
        code: 'custom',
        path: ['acceptingOrders'],
        message: 'Enable delivery or pickup before accepting orders.',
      });
  });

export function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new Error(result.error.issues[0].message);
  return result.data;
}

export const branchSchema = z.object({
  id: z.string().min(1).max(100),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().trim().min(2).max(80),
  settings: settingsSchema,
});
