import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import {
  changeCounterStatus,
  parseCounterOrderRequest,
  parseCounterStatusRequest,
  priceCounterOrder,
} from '../counter';
import { localBusinessDate } from './business-day';
import { LocalPosError } from './errors';
import type { LocalUser } from './database';
import { openLocalPosDatabase } from './database';
import { listLocalPosCatalog } from './products';
import type { Customer, Order } from '../../types';

export type LocalPayment = {
  id: string;
  method: 'cash' | 'upi';
  amount: number;
  receivedAt: string;
  receivedBy: string;
  reference?: string;
  cashTendered?: number;
  change?: number;
};

export type LocalPosOrder = Order & {
  localPos: {
    businessDate: string;
    cart: import('../../types').CartItem[];
    payments: LocalPayment[];
    changeRevision: number;
    acknowledgedRevision: number;
    paidAmount: number;
  };
};

export type LocalCustomerAddress = Pick<
  Customer,
  'name' | 'phone' | 'address' | 'locality' | 'postalCode' | 'landmark' | 'instructions'
>;

type StoredOrder = {
  id: string;
  order_number: string;
  status: string;
  version: number;
  created_at: string;
  business_date: string;
  data_json: string;
};

function parseOrder(row: StoredOrder): LocalPosOrder {
  const order = JSON.parse(row.data_json) as LocalPosOrder;
  if (!order.localPos || !Array.isArray(order.localPos.payments))
    throw new LocalPosError(
      'A saved order needs review before it can be changed.',
      500,
      'invalid_saved_order',
    );
  return order;
}

function saveOrder(order: LocalPosOrder, database: DatabaseSync): void {
  database
    .prepare(
      `UPDATE local_orders
       SET status = ?, version = ?, data_json = ?
       WHERE id = ?`,
    )
    .run(order.status, order.version ?? 1, JSON.stringify(order), order.id);
}

function auditOrder(
  orderId: string,
  actorId: string,
  eventType: string,
  data: unknown,
  database: DatabaseSync,
  now: string,
): void {
  database
    .prepare(
      `INSERT INTO local_order_events(id, order_id, actor_id, event_type, created_at, data_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(randomUUID(), orderId, actorId, eventType, now, JSON.stringify(data));
}

function withTransaction<T>(database: DatabaseSync, callback: () => T): T {
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function listLocalOrders(
  businessDate?: string,
  database = openLocalPosDatabase(),
): LocalPosOrder[] {
  const rows = businessDate
    ? (database
        .prepare(
          `SELECT id, order_number, status, version, created_at, business_date, data_json
           FROM local_orders WHERE business_date = ? ORDER BY created_at DESC`,
        )
        .all(businessDate) as StoredOrder[])
    : (database
        .prepare(
          `SELECT id, order_number, status, version, created_at, business_date, data_json
           FROM local_orders ORDER BY created_at DESC LIMIT 200`,
        )
        .all() as StoredOrder[]);
  return rows.map(parseOrder);
}

export function findLocalCustomerAddress(
  phone: string,
  database = openLocalPosDatabase(),
): LocalCustomerAddress | null {
  if (!/^[6-9]\d{9}$/.test(phone))
    throw new LocalPosError('Enter a valid 10-digit mobile number.', 400, 'invalid_phone');
  const customer = database
    .prepare(
      `SELECT
         json_extract(data_json, '$.customer.name') AS name,
         json_extract(data_json, '$.customer.phone') AS phone,
         json_extract(data_json, '$.customer.address') AS address,
         json_extract(data_json, '$.customer.locality') AS locality,
         json_extract(data_json, '$.customer.postalCode') AS postalCode,
         json_extract(data_json, '$.customer.landmark') AS landmark,
         json_extract(data_json, '$.customer.instructions') AS instructions
       FROM local_orders
       WHERE json_extract(data_json, '$.fulfillment') = 'delivery'
         AND json_extract(data_json, '$.customer.phone') = ?
         AND length(trim(json_extract(data_json, '$.customer.address'))) > 0
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(phone) as LocalCustomerAddress | undefined;
  return customer ? { ...customer } : null;
}

export function getLocalSalesAnalytics(
  from: string,
  to: string,
  database = openLocalPosDatabase(),
) {
  const rows = database
    .prepare(
      `SELECT id, order_number, status, version, created_at, business_date, data_json
       FROM local_orders
       WHERE business_date >= ? AND business_date <= ?
       ORDER BY created_at`,
    )
    .all(from, to) as StoredOrder[];
  const orders = rows.map(parseOrder);
  const daily = new Map<
    string,
    { date: string; orders: number; sales: number; collected: number }
  >();
  const products = new Map<
    string,
    { productId: string; name: string; quantity: number; sales: number }
  >();
  let sales = 0;
  let collected = 0;
  let outstanding = 0;
  let cancelled = 0;
  let cash = 0;
  let upi = 0;
  let activeOrderCount = 0;

  for (const order of orders) {
    const paid = order.localPos.paidAmount;
    for (const payment of order.localPos.payments) {
      if (payment.method === 'cash') cash += payment.amount;
      else upi += payment.amount;
    }
    collected += paid;
    const isCancelled = ['cancelled', 'rejected'].includes(order.status);
    if (isCancelled) {
      cancelled += 1;
      continue;
    }

    activeOrderCount += 1;
    sales += order.total;
    outstanding += Math.max(0, order.total - paid);
    const day = daily.get(order.localPos.businessDate) ?? {
      date: order.localPos.businessDate,
      orders: 0,
      sales: 0,
      collected: 0,
    };
    day.orders += 1;
    day.sales += order.total;
    day.collected += paid;
    daily.set(day.date, day);

    for (const item of order.items) {
      const current = products.get(item.productId) ?? {
        productId: item.productId,
        name: item.name,
        quantity: 0,
        sales: 0,
      };
      current.quantity += item.quantity;
      current.sales += item.unitPrice * item.quantity;
      products.set(current.productId, current);
    }
  }

  return {
    from,
    to,
    orderCount: orders.length,
    activeOrderCount,
    cancelledOrderCount: cancelled,
    sales,
    collected,
    outstanding,
    averageBill: activeOrderCount ? Math.round(sales / activeOrderCount) : 0,
    paymentTotals: { cash, upi },
    daily: [...daily.values()].sort((first, second) => first.date.localeCompare(second.date)),
    bestSellers: [...products.values()]
      .sort((first, second) => second.quantity - first.quantity || second.sales - first.sales)
      .slice(0, 10),
  };
}

export function getLocalOrder(id: string, database = openLocalPosDatabase()): LocalPosOrder {
  const row = database
    .prepare(
      `SELECT id, order_number, status, version, created_at, business_date, data_json
       FROM local_orders WHERE id = ?`,
    )
    .get(id) as StoredOrder | undefined;
  if (!row) throw new LocalPosError('This order could not be found.', 404, 'order_not_found');
  return parseOrder(row);
}

function nextOrderNumber(businessDate: string, database: DatabaseSync): string {
  const row = database
    .prepare('SELECT COUNT(*) AS count FROM local_orders WHERE business_date = ?')
    .get(businessDate) as { count: number };
  const [year, month, day] = businessDate.split('-');
  return `HPA-${day}${month}${year.slice(-2)}-${String(row.count + 1).padStart(4, '0')}`;
}

export function createLocalOrder(
  actor: LocalUser,
  body: unknown,
  database = openLocalPosDatabase(),
  now = new Date().toISOString(),
  entry: 'staff' | 'table_qr' = 'staff',
): LocalPosOrder {
  if (actor.role === 'kitchen')
    throw new LocalPosError('Kitchen accounts cannot create or bill orders.', 403, 'role_denied');
  const input = parseCounterOrderRequest(body);
  const catalog = listLocalPosCatalog(database);
  const businessDate = localBusinessDate(now);
  return withTransaction(database, () => {
    const id = randomUUID();
    const orderNumber = nextOrderNumber(businessDate, database);
    const priced = priceCounterOrder(input, catalog, id, now, actor.id);
    const order: LocalPosOrder = {
      ...priced,
      ...(priced.counter ? { counter: { ...priced.counter, entry } } : {}),
      number: orderNumber,
      localPos: {
        businessDate,
        cart: input.items,
        payments: priced.settlement
          ? [
              {
                id: randomUUID(),
                method: priced.settlement.method,
                amount: priced.settlement.amount,
                receivedAt: priced.settlement.confirmedAt,
                receivedBy: actor.id,
                ...(priced.settlement.upiReference
                  ? { reference: priced.settlement.upiReference }
                  : {}),
                ...(priced.settlement.cashTendered !== undefined
                  ? { cashTendered: priced.settlement.cashTendered }
                  : {}),
                ...(priced.settlement.change !== undefined
                  ? { change: priced.settlement.change }
                  : {}),
              },
            ]
          : [],
        paidAmount: priced.settlement?.amount ?? 0,
        changeRevision: 0,
        acknowledgedRevision: 0,
      },
    };
    database
      .prepare(
        `INSERT INTO local_orders(id, order_number, status, version, created_at, business_date, data_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        order.number,
        order.status,
        order.version ?? 1,
        now,
        businessDate,
        JSON.stringify(order),
      );
    auditOrder(id, actor.id, 'order_created', { order }, database, now);
    return order;
  });
}

function assertVersion(order: LocalPosOrder, expectedVersion: number): void {
  if (order.version !== expectedVersion)
    throw new LocalPosError(
      'This order changed on another screen. Refresh and review it.',
      409,
      'version_conflict',
    );
}

export function updateLocalOrderStatus(
  actor: LocalUser,
  id: string,
  body: unknown,
  database = openLocalPosDatabase(),
  now = new Date().toISOString(),
): LocalPosOrder {
  if (actor.role !== 'kitchen' && actor.role !== 'pos_manager' && actor.role !== 'super_user')
    throw new LocalPosError(
      'Order status updates require a Kitchen, POS Manager or Super User account.',
      403,
      'role_denied',
    );
  const request = parseCounterStatusRequest(body);
  return withTransaction(database, () => {
    const current = getLocalOrder(id, database);
    assertVersion(current, request.expectedVersion);
    const recordedPaymentTotal = current.localPos.payments.reduce(
      (total, payment) => total + payment.amount,
      0,
    );
    const localPaymentComplete =
      current.paymentStatus === 'paid' &&
      current.localPos.paidAmount === current.total &&
      recordedPaymentTotal === current.total &&
      current.localPos.payments.length > 0;
    const statusOrder =
      localPaymentComplete && current.counter
        ? {
            ...current,
            counter: {
              ...current.counter,
              payLater: true,
              payLaterReason: 'Payment verified against the local POS payment records.',
            },
          }
        : current;
    const changed = changeCounterStatus(
      { ...statusOrder, version: current.version ?? 1 },
      request.status,
      now,
    ) as LocalPosOrder;
    if (localPaymentComplete && current.counter && changed.counter) {
      changed.counter = { ...changed.counter, payLater: current.counter.payLater };
      if (current.counter.payLaterReason === undefined) delete changed.counter.payLaterReason;
      else changed.counter.payLaterReason = current.counter.payLaterReason;
    }
    changed.localPos = current.localPos;
    changed.version = (current.version ?? 1) + 1;
    saveOrder(changed, database);
    auditOrder(
      id,
      actor.id,
      'order_status_changed',
      { from: current.status, to: changed.status },
      database,
      now,
    );
    return changed;
  });
}

export function managerMayEditOrder(order: LocalPosOrder): boolean {
  return ['confirmed', 'preparing'].includes(order.status);
}

export function editLocalOrder(
  actor: LocalUser,
  id: string,
  body: unknown,
  database = openLocalPosDatabase(),
  now = new Date().toISOString(),
): LocalPosOrder {
  if (actor.role === 'kitchen')
    throw new LocalPosError(
      'Kitchen accounts cannot edit order items or bills.',
      403,
      'role_denied',
    );
  const record = z.record(z.string(), z.unknown()).parse(body);
  const expectedVersion = z.number().int().min(1).parse(record.expectedOrderVersion);
  delete record.expectedOrderVersion;
  const input = parseCounterOrderRequest(record);
  return withTransaction(database, () => {
    const current = getLocalOrder(id, database);
    assertVersion(current, expectedVersion);
    if (!managerMayEditOrder(current))
      throw new LocalPosError(
        'Ready or completed orders are locked and cannot be edited.',
        409,
        'order_locked',
      );
    if (input.payment)
      throw new LocalPosError(
        'Record payment separately from an order edit.',
        400,
        'payment_not_allowed',
      );
    const priced = priceCounterOrder(
      {
        ...input,
        payment: null,
        payLaterReason: input.payLaterReason ?? 'Payment recorded separately.',
      },
      listLocalPosCatalog(database),
      id,
      current.createdAt,
      actor.id,
    );
    if (current.localPos.paidAmount > priced.total)
      throw new LocalPosError(
        'The new bill total cannot be less than the amount already collected.',
        409,
        'paid_amount_exceeds_total',
      );
    const previous = current.total;
    const updated: LocalPosOrder = {
      ...current,
      ...priced,
      id: current.id,
      number: current.number,
      createdAt: current.createdAt,
      status: current.status,
      version: (current.version ?? 1) + 1,
      settlement: current.settlement,
      paymentMode: current.paymentMode,
      paymentMethod: current.paymentMethod,
      paymentStatus: current.localPos.paidAmount >= priced.total ? 'paid' : 'pending',
      localPos: {
        ...current.localPos,
        cart: input.items,
        changeRevision: current.localPos.changeRevision + 1,
      },
    };
    if (updated.counter)
      updated.counter = {
        ...updated.counter,
        payLater: updated.localPos.paidAmount < updated.total,
        ...(updated.localPos.paidAmount < updated.total
          ? { payLaterReason: 'Balance outstanding after a manager-approved order change.' }
          : {}),
      };
    saveOrder(updated, database);
    auditOrder(
      id,
      actor.id,
      'order_edited',
      {
        previousTotal: previous,
        newTotal: updated.total,
        oldItems: current.items,
        newItems: updated.items,
      },
      database,
      now,
    );
    return updated;
  });
}

const paymentSchema = z.discriminatedUnion('method', [
  z
    .object({
      method: z.literal('cash'),
      cashTendered: z.number().int().min(0).max(100_000_000),
    })
    .strict(),
  z
    .object({
      method: z.literal('upi'),
      upiReference: z
        .string()
        .trim()
        .regex(/^(?:[A-Za-z0-9]{6,80})?$/)
        .optional(),
    })
    .strict(),
]);

export function collectLocalPayment(
  actor: LocalUser,
  id: string,
  expectedVersion: number,
  body: unknown,
  database = openLocalPosDatabase(),
  now = new Date().toISOString(),
): LocalPosOrder {
  if (actor.role === 'kitchen')
    throw new LocalPosError('Kitchen accounts cannot collect payment.', 403, 'role_denied');
  const payment = paymentSchema.parse(body);
  return withTransaction(database, () => {
    const order = getLocalOrder(id, database);
    assertVersion(order, expectedVersion);
    if (['cancelled', 'rejected', 'closed'].includes(order.status))
      throw new LocalPosError(
        'This order is closed and cannot accept payment.',
        409,
        'order_not_payable',
      );
    const due = Math.max(0, order.total - order.localPos.paidAmount);
    if (!due)
      throw new LocalPosError('This bill is already fully paid.', 409, 'payment_already_complete');
    if (payment.method === 'cash' && payment.cashTendered < due)
      throw new LocalPosError(
        'Cash received is less than the outstanding amount.',
        400,
        'cash_short',
      );
    const entry: LocalPayment = {
      id: randomUUID(),
      method: payment.method,
      amount: due,
      receivedAt: now,
      receivedBy: actor.id,
      ...(payment.method === 'upi' && payment.upiReference
        ? { reference: payment.upiReference.trim().toUpperCase() }
        : {}),
      ...(payment.method === 'cash'
        ? { cashTendered: payment.cashTendered, change: payment.cashTendered - due }
        : {}),
    };
    order.localPos.payments.push(entry);
    order.localPos.paidAmount += due;
    order.paymentStatus = order.localPos.paidAmount >= order.total ? 'paid' : 'pending';
    order.paymentMethod = payment.method;
    order.version = (order.version ?? 1) + 1;
    if (order.counter) {
      order.counter.payLater = order.paymentStatus !== 'paid';
      if (order.paymentStatus === 'paid') delete order.counter.payLaterReason;
    }
    if (!order.settlement) {
      order.settlement = {
        source: 'staff',
        method: payment.method,
        amount: due,
        confirmedBy: actor.id,
        confirmedAt: now,
        ...(payment.method === 'upi' ? { upiReference: entry.reference } : {}),
        ...(payment.method === 'cash'
          ? { cashTendered: payment.cashTendered, change: payment.cashTendered - due }
          : {}),
      };
    }
    saveOrder(order, database);
    auditOrder(id, actor.id, 'payment_collected', { payment: entry }, database, now);
    return order;
  });
}

export function acknowledgeLocalOrderChange(
  actor: LocalUser,
  id: string,
  expectedVersion: number,
  database = openLocalPosDatabase(),
  now = new Date().toISOString(),
): LocalPosOrder {
  if (actor.role !== 'kitchen' && actor.role !== 'super_user')
    throw new LocalPosError(
      'Only Kitchen Staff or a Super User can acknowledge a kitchen update.',
      403,
      'role_denied',
    );
  return withTransaction(database, () => {
    const order = getLocalOrder(id, database);
    assertVersion(order, expectedVersion);
    order.localPos.acknowledgedRevision = order.localPos.changeRevision;
    order.version = (order.version ?? 1) + 1;
    saveOrder(order, database);
    auditOrder(id, actor.id, 'kitchen_update_acknowledged', {}, database, now);
    return order;
  });
}
