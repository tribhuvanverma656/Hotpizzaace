import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { Product, RestaurantSettings } from '@/types';
import { parseCounterOrderRequest } from '../counter';
import { createLocalOrder, getLocalOrder } from './orders';
import { listLocalPosCatalog } from './products';
import { listLocalUsers, openLocalPosDatabase, type LocalUser } from './database';
import { LocalPosError } from './errors';

const QR_TOKEN_KEY = 'local_ordering_qr_token';
const QR_ENABLED_KEY = 'local_ordering_qr_enabled';
const qrOrderRequestSchema = z
  .object({
    items: z.array(z.unknown()).min(1).max(50),
    customerName: z.string().trim().min(2).max(80),
    tableLabel: z.string().trim().min(1).max(40),
    expectedRevision: z.number().int().min(1),
    idempotencyKey: z.string().uuid(),
  })
  .strict();

export type LocalQrMenu = {
  branchName: string;
  acceptingOrders: boolean;
  revision: number;
  products: Product[];
  categories: { id: string; name: string; sortOrder: number }[];
  settings: Pick<
    RestaurantSettings,
    | 'deliveryFee'
    | 'freeDeliveryThreshold'
    | 'couponMaximum'
    | 'couponMinimum'
    | 'couponPercent'
    | 'couponCode'
    | 'billing'
  >;
};

function readMeta(key: string, database: DatabaseSync): string | undefined {
  const row = database.prepare('SELECT value FROM local_meta WHERE key = ?').get(key) as
    { value: string } | undefined;
  return row?.value;
}

function writeMeta(key: string, value: string, database: DatabaseSync): void {
  database.prepare('INSERT OR REPLACE INTO local_meta(key, value) VALUES (?, ?)').run(key, value);
}

export function getLocalQrState(database = openLocalPosDatabase()): {
  enabled: boolean;
  token: string | null;
} {
  const token = readMeta(QR_TOKEN_KEY, database);
  const enabled = readMeta(QR_ENABLED_KEY, database) === '1';
  if (enabled && (!token || !/^[a-f0-9]{64}$/.test(token)))
    throw new LocalPosError('Local QR ordering needs to be set up again.', 500, 'invalid_qr_state');
  return { enabled, token: enabled ? token! : null };
}

export function setLocalQrState(
  action: 'enable' | 'rotate' | 'disable',
  database = openLocalPosDatabase(),
): { enabled: boolean; token: string | null } {
  const current = getLocalQrState(database);
  if (action === 'disable') {
    if (!current.enabled)
      throw new LocalPosError('QR ordering is already disabled.', 409, 'qr_already_disabled');
    writeMeta(QR_ENABLED_KEY, '0', database);
    return { enabled: false, token: null };
  }
  if (action === 'enable' && current.enabled)
    throw new LocalPosError(
      'QR ordering is already enabled. Replace its QR instead.',
      409,
      'qr_already_enabled',
    );

  const token = randomBytes(32).toString('hex');
  writeMeta(QR_TOKEN_KEY, token, database);
  writeMeta(QR_ENABLED_KEY, '1', database);
  return { enabled: true, token };
}

function requireLocalQrToken(token: string, database: DatabaseSync): void {
  const state = getLocalQrState(database);
  if (!state.enabled || state.token !== token)
    throw new LocalPosError(
      'This restaurant QR is unavailable. Ask staff for the current QR.',
      404,
      'qr_not_found',
    );
}

export function getLocalQrMenu(token: string, database = openLocalPosDatabase()): LocalQrMenu {
  requireLocalQrToken(token, database);
  const catalog = listLocalPosCatalog(database);
  const branch = catalog.branches[0];
  const visibleCategories = catalog.categories.filter((category) => !category.archived);
  const visibleCategoryIds = new Set(visibleCategories.map((category) => category.id));
  const settings = branch.settings;
  return {
    branchName: branch.name,
    acceptingOrders: settings.counterAcceptingOrders === true && !settings.temporarilyClosed,
    revision: catalog.revision,
    products: catalog.products.filter(
      (product) =>
        product.available && !product.archived && visibleCategoryIds.has(product.categoryId),
    ),
    categories: visibleCategories.map(({ id, name, sortOrder }) => ({ id, name, sortOrder })),
    settings: {
      deliveryFee: settings.deliveryFee,
      freeDeliveryThreshold: settings.freeDeliveryThreshold,
      couponMaximum: settings.couponMaximum,
      couponMinimum: settings.couponMinimum,
      couponPercent: settings.couponPercent,
      couponCode: settings.couponCode,
      billing: settings.billing,
    },
  };
}

export function createLocalQrOrder(
  token: string,
  body: unknown,
  database = openLocalPosDatabase(),
  now = new Date().toISOString(),
) {
  requireLocalQrToken(token, database);
  const request = qrOrderRequestSchema.parse(body);
  const previous = database
    .prepare('SELECT order_id AS orderId FROM local_qr_submissions WHERE idempotency_key = ?')
    .get(request.idempotencyKey) as { orderId: string } | undefined;
  if (previous) return getLocalOrder(previous.orderId, database);

  const actor = listLocalUsers(database).find(
    (user): user is LocalUser =>
      user.enabled && (user.role === 'super_user' || user.role === 'pos_manager'),
  );
  if (!actor)
    throw new LocalPosError(
      'Restaurant staff accounts must be enabled before QR orders can be placed.',
      503,
      'qr_staff_unavailable',
    );

  const orderInput = parseCounterOrderRequest({
    branchId: 'barra',
    fulfillment: 'dine_in',
    items: request.items,
    customerName: request.customerName,
    tableLabel: request.tableLabel,
    coupon: '',
    expectedRevision: request.expectedRevision,
    idempotencyKey: request.idempotencyKey,
    payment: null,
    payLaterReason: 'Customer QR order; payment is due at the counter.',
  });
  const order = createLocalOrder(actor, orderInput, database, now, 'table_qr');
  database
    .prepare('INSERT INTO local_qr_submissions(idempotency_key, order_id) VALUES (?, ?)')
    .run(request.idempotencyKey, order.id);
  return order;
}
