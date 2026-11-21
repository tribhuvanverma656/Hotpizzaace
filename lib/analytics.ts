import type { Order } from '../types';
import {
  getPaymentMethodDetails,
  isGatewayMode,
  isLiveGatewayMode,
  isTestGatewayMode,
} from './payments/method';
import { NEAREST_RUPEE_POLICY, nearestRupeeAdjustment } from './rounding';

export type SalesChannel = 'dine_in' | 'delivery' | 'pickup';
export type ReportMode = 'development' | 'production';
export type ReportRange = { branchId: string; from: string; to: string; mode: ReportMode };
export type SalesReportRequest = {
  branchId: string;
  from: string;
  to: string;
  kind: 'summary' | 'export';
  cursor?: string;
  snapshotAt?: string;
};
export type ParsedReportRequest = SalesReportRequest & { fromUtc: string; toUtc: string };
export type SalesMetrics = {
  placedOrders: number;
  completedOrders: number;
  foodSubtotal: number;
  discounts: number;
  foodSales: number;
  deliveryFees: number;
  salesExGst: number;
  cgst: number;
  sgst: number;
  roundOff: number;
  salesInclGst: number;
  averageOrderValue: number;
  unpaidCounterOrders: number;
  unpaidCounterAmount: number;
};
export type CollectionMetrics = {
  cash: number;
  directUpi: number;
  total: number;
  orders: number;
  reviewAmount: number;
  reviewOrders: number;
};
export type GatewayCohortMetrics = {
  /** Cumulative receipt balances for orders placed in the selected dates, not dated captures. */
  scope: 'orders_placed_in_range';
  grossCaptured: number;
  refunded: number;
  /** Unknown while a provider-confirmed refund still needs its detail history reconciled. */
  netRetained: number | null;
  orders: number;
  unreconciledOrders: number;
};
export type GatewayRefundMetrics = {
  dateBasis: 'refund_entry_processed_at';
  amount: number;
  entries: number;
  orders: number;
  /** Fallback clocks are disclosed separately from provider-event timestamps. */
  verifiedAtAmount: number;
};
export type SalesReport = {
  branchId: string;
  from: string;
  to: string;
  mode: ReportMode;
  timezone: 'Asia/Kolkata';
  salesDateBasis: 'completed';
  collectionsDateBasis: 'staff_confirmed';
  totals: SalesMetrics;
  channels: Record<SalesChannel, SalesMetrics>;
  days: Array<{
    date: string;
    salesExGst: number;
    completedOrders: number;
    collections: number;
    refunds: number;
  }>;
  collections: CollectionMetrics;
  gatewayCohort: GatewayCohortMetrics;
  gatewayRefunds: GatewayRefundMetrics;
  excludedTestOrders: number;
  reviewOrders: number;
  undatedOnlinePaidOrders: number;
  legacyPlacedSales: SalesMetrics;
};
export type SalesExportRow = {
  branchId: string;
  branchName: string;
  orderNumber: string;
  invoiceNumber: string;
  placedAt: string;
  placedDateIst: string;
  completedAt: string;
  salesDateIst: string;
  legacySalesExGst: number;
  channel: SalesChannel;
  status: string;
  paymentStatus: string;
  paymentMode: string;
  /** Empty for hosted gateway payments whose actual method was not recorded. */
  paymentMethod: string;
  requestedPaymentMethod: string;
  collectionAt: string;
  servedAt: string;
  subtotal: number;
  discount: number;
  deliveryFee: number;
  cgst: number;
  sgst: number;
  roundOff: number;
  total: number;
  salesExGst: number;
  collectionAmount: number;
  collectionReviewAmount: number;
  unpaidAmount: number;
  paymentReviewRequired: boolean;
  recordKind: 'real' | 'test' | 'unverified';
  /** Preserves original bill figures without treating an archived software test as money received. */
  voided: boolean;
  voidKind: string;
  voidedAt: string;
  placedInRange: boolean;
  completedInRange: boolean;
  collectionInRange: boolean;
  gatewayFinancialScope: 'orders_placed_in_range' | '';
  gatewayGrossCaptured: number;
  gatewayRefunded: number;
  gatewayNetRetained: number | null;
  refundSyncPending: boolean;
  /** Cumulative processed refund total at the report snapshot, independent of report dates. */
  refundAmount: number;
  refundStatus: 'partial' | 'full' | '';
  /** An audit JSON value; entry amounts are integer paise, dates are explicit ISO timestamps. */
  refundEntriesJsonPaise: string;
  periodRefundAmount: number;
  refundInRange: boolean;
};
export type SalesSummaryResponse = { summary: SalesReport; complete: true; snapshotAt: string };
export type SalesExportResponse = {
  rows: SalesExportRow[];
  nextCursor: string | null;
  snapshotAt: string;
  complete: boolean;
};

type ReportOrder = Order & {
  channel?: string;
  environment?: ReportMode;
  completedAt?: string;
  counter?: { servedAt?: string; closedAt?: string };
  settlement?: {
    source: 'staff';
    confirmedAt: string;
    confirmedBy: string;
    method: 'cash' | 'upi';
    amount: number;
  };
};
const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 19_800_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function dateValue(value: unknown): number {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value))
    throw new Error('Choose a valid report date.');
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value)
    throw new Error('Choose a valid report date.');
  return time;
}

/** India business days are explicit; the server/browser host timezone is irrelevant. */
export function istDate(value: string | Date): string {
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(time)) return '';
  return new Date(time + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function parseReportRequest(raw: unknown): ParsedReportRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Choose a report date range.');
  const value = raw as Record<string, unknown>;
  const allowed = ['branchId', 'from', 'to', 'kind', 'cursor', 'snapshotAt'];
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error('The report request contains unsupported fields.');
  if (
    typeof value.branchId !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(value.branchId)
  )
    throw new Error('Choose a valid branch.');
  const from = dateValue(value.from);
  const to = dateValue(value.to);
  if (to < from) throw new Error('The report end date must be on or after the start date.');
  if (to - from >= 31 * DAY_MS) throw new Error('Download at most 31 days at a time.');
  if (value.kind !== 'summary' && value.kind !== 'export')
    throw new Error('Choose a supported report.');
  if (
    value.cursor !== undefined &&
    (typeof value.cursor !== 'string' || !/^[a-zA-Z0-9_.:-]{1,1000}$/.test(value.cursor))
  )
    throw new Error('The report page is invalid. Start a new download.');
  if (
    value.snapshotAt !== undefined &&
    (typeof value.snapshotAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.snapshotAt) ||
      !Number.isFinite(Date.parse(value.snapshotAt)))
  )
    throw new Error('The report snapshot is invalid. Start a new download.');
  if (value.kind === 'summary' && (value.cursor !== undefined || value.snapshotAt !== undefined))
    throw new Error('Summary reports do not accept export pages.');
  return {
    branchId: value.branchId,
    from: value.from as string,
    to: value.to as string,
    kind: value.kind,
    ...(value.cursor ? { cursor: value.cursor as string } : {}),
    ...(value.snapshotAt ? { snapshotAt: value.snapshotAt as string } : {}),
    fromUtc: new Date(from - IST_OFFSET_MS).toISOString(),
    toUtc: new Date(to + DAY_MS - IST_OFFSET_MS).toISOString(),
  };
}

export function salesChannel(order: Order): SalesChannel {
  const value = order as ReportOrder;
  return String(value.fulfillment) === 'dine_in'
    ? 'dine_in'
    : value.fulfillment === 'delivery'
      ? 'delivery'
      : 'pickup';
}

function inRange(date: string, range: Pick<ReportRange, 'from' | 'to'>): boolean {
  const day = istDate(date);
  return !!day && day >= range.from && day <= range.to;
}
function amount(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new Error('This report contains an invalid amount. Contact the owner before using it.');
  return value as number;
}
function signedAmount(value: unknown): number {
  if (!Number.isSafeInteger(value))
    throw new Error(
      'This report contains an invalid adjustment. Contact the owner before using it.',
    );
  return value as number;
}
/** The report projection contains tax groups, without customer or line-item data. */
function includedTax(order: ReportOrder): number {
  const tax = order.tax;
  if (!tax) return 0;
  if (tax.version === undefined) {
    if (tax.includedTotal !== undefined || tax.groups !== undefined)
      throw new Error('This report contains an unversioned tax breakdown.');
    return 0;
  }
  if (
    tax.version !== 2 ||
    !Array.isArray(tax.groups) ||
    !tax.groups.length ||
    tax.groups.length > 101
  )
    throw new Error('This report contains an invalid tax breakdown.');
  const included = amount(tax.includedTotal);
  const groups = tax.groups;
  let previousKey = '';
  let inclusiveCount = 0;
  const totals = { gross: 0, delivery: 0, discount: 0, taxable: 0, cgst: 0, sgst: 0, included: 0 };
  const allocations: Array<{ key: string; discount: number; floor: bigint; remainder: bigint }> =
    [];
  const divisor = BigInt(order.subtotal || 1);
  for (const group of groups) {
    if (!group || typeof group !== 'object')
      throw new Error('This report contains an invalid tax group.');
    if (
      (group.pricing !== 'exclusive' && group.pricing !== 'inclusive') ||
      !Number.isSafeInteger(group.rateBps) ||
      group.rateBps < 2 ||
      group.rateBps > 4000 ||
      group.rateBps % 2 !== 0 ||
      typeof group.code !== 'string' ||
      !/^(?:\d{4}|\d{6}|\d{8})$/.test(group.code) ||
      (group.pricing === 'exclusive' && (group.rateBps !== 500 || group.code !== '996331'))
    )
      throw new Error('This report contains an invalid tax classification.');
    const key = `${group.pricing}:${group.rateBps}:${group.code}`;
    if (key <= previousKey)
      throw new Error('This report contains duplicate or unordered tax groups.');
    previousKey = key;
    const gross = amount(group.grossValue);
    const delivery = amount(group.deliveryFee);
    const discount = amount(group.discount);
    const taxable = amount(group.taxableValue);
    const cgst = amount(group.cgst);
    const sgst = amount(group.sgst);
    const total = amount(group.total);
    if (discount > gross || delivery !== (group.pricing === 'exclusive' ? order.deliveryFee : 0))
      throw new Error('This report contains an invalid group discount or delivery fee.');
    const netGross = gross - discount;
    // BigInt keeps multiplication exact even for large report values.
    const expectedCgst =
      group.pricing === 'inclusive'
        ? Number(
            (BigInt(netGross) * BigInt(group.rateBps) + BigInt(10000 + group.rateBps)) /
              BigInt(2 * (10000 + group.rateBps)),
          )
        : Number(
            (BigInt(sum(netGross, delivery)) * BigInt(group.rateBps) + BigInt(10000)) /
              BigInt(20000),
          );
    const expectedTaxable =
      group.pricing === 'inclusive' ? netGross - total : sum(netGross, delivery);
    if (
      cgst !== expectedCgst ||
      sgst !== cgst ||
      total !== sum(cgst, sgst) ||
      taxable !== expectedTaxable
    )
      throw new Error('This report contains a tax group that does not reconcile.');
    totals.gross = sum(totals.gross, gross);
    totals.delivery = sum(totals.delivery, delivery);
    totals.discount = sum(totals.discount, discount);
    totals.taxable = sum(totals.taxable, taxable);
    totals.cgst = sum(totals.cgst, cgst);
    totals.sgst = sum(totals.sgst, sgst);
    if (group.pricing === 'inclusive') {
      inclusiveCount++;
      totals.included = sum(totals.included, total);
    }
    const numerator = BigInt(order.discount) * BigInt(gross);
    allocations.push({ key, discount, floor: numerator / divisor, remainder: numerator % divisor });
  }
  if (
    !inclusiveCount ||
    totals.gross !== order.subtotal ||
    totals.delivery !== order.deliveryFee ||
    totals.discount !== order.discount ||
    totals.taxable !== amount(tax.taxableValue) ||
    totals.cgst !== tax.cgst ||
    totals.sgst !== tax.sgst ||
    totals.included !== included
  )
    throw new Error('This report contains a tax breakdown that does not reconcile.');
  allocations.sort((first, second) =>
    first.remainder > second.remainder
      ? -1
      : first.remainder < second.remainder
        ? 1
        : first.key < second.key
          ? -1
          : first.key > second.key
            ? 1
            : 0,
  );
  const extraPaise =
    BigInt(order.discount) - allocations.reduce((total, group) => total + group.floor, BigInt(0));
  for (const [index, group] of allocations.entries())
    if (
      BigInt(group.discount) !==
      group.floor + (BigInt(index) < extraPaise ? BigInt(1) : BigInt(0))
    )
      throw new Error('This report contains an inconsistent coupon allocation.');
  return included;
}
/** Financial snapshots must reconcile before they can contribute to any report. */
function assertOrderAmounts(order: ReportOrder): void {
  const subtotal = amount(order.subtotal);
  const discount = amount(order.discount);
  const deliveryFee = amount(order.deliveryFee);
  const total = amount(order.total);
  const cgst = amount(order.tax?.cgst ?? 0);
  const sgst = amount(order.tax?.sgst ?? 0);
  const tax = amount(order.tax?.total ?? 0);
  const included = includedTax(order);
  const roundOff = signedAmount(order.roundOff === undefined ? 0 : order.roundOff);
  const unroundedTotal = sum(sum(subtotal - discount, deliveryFee), tax - included);
  const expectedRoundOff =
    order.roundOffPolicy === undefined
      ? -(unroundedTotal % 100) || 0
      : order.roundOffPolicy === NEAREST_RUPEE_POLICY
        ? nearestRupeeAdjustment(unroundedTotal, subtotal, deliveryFee, order.tax)
        : Number.NaN;
  if (
    discount > subtotal ||
    tax !== sum(cgst, sgst) ||
    included > tax ||
    total !== sum(unroundedTotal, roundOff) ||
    (order.roundOffPolicy !== undefined && order.roundOff === undefined) ||
    (order.roundOff !== undefined && (total <= 0 || roundOff !== expectedRoundOff))
  )
    throw new Error(
      'This report contains a bill that does not reconcile. Contact the owner before using it.',
    );
  const refund = order.refund;
  if (refund !== undefined) {
    const fail = () => {
      throw new Error('This report contains a refund that does not reconcile.');
    };
    if (
      !refund ||
      !isGatewayMode(order.paymentMode) ||
      order.paymentStatus !== 'paid' ||
      order.paymentMethod === 'cash' ||
      !Array.isArray(refund.entries) ||
      !refund.entries.length ||
      !Number.isSafeInteger(refund.amount) ||
      refund.amount <= 0 ||
      refund.amount > total ||
      refund.status !== (refund.amount === total ? 'full' : 'partial')
    )
      fail();
    let refunded = 0;
    const ids = new Set<string>();
    for (const entry of refund.entries) {
      if (
        !entry ||
        typeof entry.id !== 'string' ||
        !entry.id ||
        ids.has(entry.id) ||
        !Number.isSafeInteger(entry.amount) ||
        entry.amount <= 0 ||
        typeof entry.processedAt !== 'string' ||
        !Number.isFinite(Date.parse(entry.processedAt)) ||
        !['provider_event', 'verified_at'].includes(entry.timestampSource)
      )
        fail();
      ids.add(entry.id);
      refunded = sum(refunded, entry.amount);
    }
    if (refunded !== refund.amount) fail();
  }
}
function sum(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result))
    throw new Error('The report amount is too large. Download a shorter range.');
  return result;
}
function sourceKind(order: ReportOrder): SalesExportRow['recordKind'] {
  if (
    isTestGatewayMode(order.paymentMode) ||
    order.paymentMode === 'simulation' ||
    order.paymentStatus === 'simulated_paid'
  )
    return 'test';
  if (isLiveGatewayMode(order.paymentMode)) return 'real';
  if (String(order.paymentMode) === 'counter_manual')
    return order.environment === 'production'
      ? 'real'
      : order.environment === 'development'
        ? 'test'
        : 'unverified';
  return 'unverified';
}
function paid(order: ReportOrder, mode: ReportMode): boolean {
  if (order.testVoid) return false;
  const kind = sourceKind(order);
  if (mode === 'production' ? kind !== 'real' : kind !== 'test') return false;
  if (String(order.paymentMode) === 'counter_manual') {
    return (
      order.channel === 'counter' &&
      ['dine_in', 'delivery'].includes(String(order.fulfillment)) &&
      order.paymentStatus === 'paid' &&
      !!order.settlement &&
      order.settlement.source === 'staff' &&
      !!order.settlement.confirmedBy &&
      order.settlement.amount === order.total &&
      (order.settlement.method === 'cash' || order.settlement.method === 'upi') &&
      order.settlement.method === order.paymentMethod &&
      !!istDate(order.settlement.confirmedAt)
    );
  }
  if (isGatewayMode(order.paymentMode))
    return order.paymentStatus === 'paid' && order.paymentMethod !== 'cash';
  return (
    (order.paymentMode === undefined || order.paymentMode === 'simulation') &&
    order.paymentStatus === 'simulated_paid'
  );
}
function cancelled(order: ReportOrder): boolean {
  return order.status === 'cancelled' || order.status === 'rejected';
}
function completedSale(order: ReportOrder, mode: ReportMode): boolean {
  const status = String(order.status);
  return (
    !order.paymentReviewRequired &&
    !order.refund?.amount &&
    !order.refundSyncPending &&
    paid(order, mode) &&
    (salesChannel(order) === 'dine_in'
      ? status === 'served' || status === 'closed'
      : status === 'delivered' || status === 'picked_up')
  );
}
function emptyMetrics(): SalesMetrics {
  return {
    placedOrders: 0,
    completedOrders: 0,
    foodSubtotal: 0,
    discounts: 0,
    foodSales: 0,
    deliveryFees: 0,
    salesExGst: 0,
    cgst: 0,
    sgst: 0,
    roundOff: 0,
    salesInclGst: 0,
    averageOrderValue: 0,
    unpaidCounterOrders: 0,
    unpaidCounterAmount: 0,
  };
}
function addSale(metrics: SalesMetrics, order: ReportOrder): void {
  metrics.completedOrders++;
  metrics.foodSubtotal = sum(metrics.foodSubtotal, amount(order.subtotal));
  metrics.discounts = sum(metrics.discounts, amount(order.discount));
  metrics.foodSales = sum(
    metrics.foodSales,
    amount(order.subtotal - order.discount - (order.tax?.includedTotal ?? 0)),
  );
  metrics.deliveryFees = sum(metrics.deliveryFees, amount(order.deliveryFee));
  metrics.cgst = sum(metrics.cgst, amount(order.tax?.cgst ?? 0));
  metrics.sgst = sum(metrics.sgst, amount(order.tax?.sgst ?? 0));
  metrics.roundOff = sum(metrics.roundOff, signedAmount(order.roundOff ?? 0));
  metrics.salesInclGst = sum(metrics.salesInclGst, amount(order.total));
  metrics.salesExGst = sum(metrics.salesExGst, amount(order.total - (order.tax?.total ?? 0)));
  metrics.averageOrderValue = Math.round(metrics.salesExGst / metrics.completedOrders);
}

function completionTime(order: ReportOrder): string {
  return order.completedAt ?? order.counter?.servedAt ?? '';
}

function isGatewayReceipt(order: ReportOrder, mode: ReportMode): boolean {
  return isGatewayMode(order.paymentMode) && paid(order, mode);
}

function refundEntriesInRange(
  order: ReportOrder,
  range?: Pick<ReportRange, 'from' | 'to'>,
): NonNullable<ReportOrder['refund']>['entries'] {
  return (order.refund?.entries ?? []).filter(
    (entry) => !range || inRange(entry.processedAt, range),
  );
}

/** Sales use completion time; legacy undated sales are disclosed as a separate placed cohort. */
export function buildSalesReport(orders: Order[], range: ReportRange): SalesReport {
  parseReportRequest({ branchId: range.branchId, from: range.from, to: range.to, kind: 'summary' });
  if (range.mode !== 'development' && range.mode !== 'production')
    throw new Error('Choose a valid report environment.');
  const from = dateValue(range.from);
  const to = dateValue(range.to);
  const report: SalesReport = {
    branchId: range.branchId,
    from: range.from,
    to: range.to,
    mode: range.mode,
    timezone: 'Asia/Kolkata',
    salesDateBasis: 'completed',
    collectionsDateBasis: 'staff_confirmed',
    totals: emptyMetrics(),
    channels: { dine_in: emptyMetrics(), delivery: emptyMetrics(), pickup: emptyMetrics() },
    days: Array.from({ length: (to - from) / DAY_MS + 1 }, (_, i) => ({
      date: new Date(from + i * DAY_MS).toISOString().slice(0, 10),
      salesExGst: 0,
      completedOrders: 0,
      collections: 0,
      refunds: 0,
    })),
    collections: { cash: 0, directUpi: 0, total: 0, orders: 0, reviewAmount: 0, reviewOrders: 0 },
    gatewayCohort: {
      scope: 'orders_placed_in_range',
      grossCaptured: 0,
      refunded: 0,
      netRetained: 0,
      orders: 0,
      unreconciledOrders: 0,
    },
    gatewayRefunds: {
      dateBasis: 'refund_entry_processed_at',
      amount: 0,
      entries: 0,
      orders: 0,
      verifiedAtAmount: 0,
    },
    excludedTestOrders: 0,
    reviewOrders: 0,
    undatedOnlinePaidOrders: 0,
    legacyPlacedSales: emptyMetrics(),
  };
  const seen = new Set<string>();
  for (const raw of orders) {
    const order = raw as ReportOrder;
    if (order.testVoid || order.branchId !== range.branchId || seen.has(order.id)) continue;
    seen.add(order.id);
    const placedInRange = inRange(order.createdAt, range);
    const collectionInRange = !!order.settlement && inRange(order.settlement.confirmedAt, range);
    const completedInRange = inRange(completionTime(order), range);
    const periodRefunds = refundEntriesInRange(order, range);
    if (!placedInRange && !collectionInRange && !completedInRange && !periodRefunds.length)
      continue;
    assertOrderAmounts(order);
    const kind = sourceKind(order);
    const matchesMode = range.mode === 'production' ? kind !== 'test' : kind !== 'real';
    if (!matchesMode) {
      if (placedInRange) report.excludedTestOrders++;
      continue;
    }
    const channel = salesChannel(order);
    if (isGatewayReceipt(order, range.mode)) {
      if (placedInRange) {
        report.gatewayCohort.grossCaptured = sum(report.gatewayCohort.grossCaptured, order.total);
        report.gatewayCohort.refunded = sum(
          report.gatewayCohort.refunded,
          order.refund?.amount ?? 0,
        );
        if (order.refundSyncPending) {
          report.gatewayCohort.unreconciledOrders++;
          report.gatewayCohort.netRetained = null;
        } else if (report.gatewayCohort.netRetained !== null) {
          report.gatewayCohort.netRetained = sum(
            report.gatewayCohort.netRetained,
            order.total - (order.refund?.amount ?? 0),
          );
        }
        report.gatewayCohort.orders++;
      }
      if (periodRefunds.length) report.gatewayRefunds.orders++;
      for (const entry of periodRefunds) {
        report.gatewayRefunds.amount = sum(report.gatewayRefunds.amount, entry.amount);
        report.gatewayRefunds.entries++;
        if (entry.timestampSource === 'verified_at')
          report.gatewayRefunds.verifiedAtAmount = sum(
            report.gatewayRefunds.verifiedAtAmount,
            entry.amount,
          );
        const day = report.days.find((candidate) => candidate.date === istDate(entry.processedAt))!;
        day.refunds = sum(day.refunds, entry.amount);
      }
    }
    if (placedInRange) {
      report.totals.placedOrders++;
      report.channels[channel].placedOrders++;
      if (order.paymentReviewRequired) report.reviewOrders++;
      if (completedSale(order, range.mode) && !istDate(completionTime(order))) {
        addSale(report.legacyPlacedSales, order);
      }
      if (order.channel === 'counter' && !cancelled(order) && !paid(order, range.mode)) {
        report.totals.unpaidCounterOrders++;
        report.channels[channel].unpaidCounterOrders++;
        report.totals.unpaidCounterAmount = sum(
          report.totals.unpaidCounterAmount,
          amount(order.total),
        );
        report.channels[channel].unpaidCounterAmount = sum(
          report.channels[channel].unpaidCounterAmount,
          amount(order.total),
        );
      }
      if (order.channel !== 'counter' && channel !== 'dine_in' && paid(order, range.mode))
        report.undatedOnlinePaidOrders++;
    }
    if (completedInRange && completedSale(order, range.mode)) {
      addSale(report.totals, order);
      addSale(report.channels[channel], order);
      const day = report.days.find(
        (candidate) => candidate.date === istDate(completionTime(order)),
      )!;
      day.salesExGst = sum(day.salesExGst, amount(order.total - (order.tax?.total ?? 0)));
      day.completedOrders++;
    }
    if (
      collectionInRange &&
      String(order.paymentMode) === 'counter_manual' &&
      paid(order, range.mode)
    ) {
      const collected = amount(order.settlement!.amount);
      if (order.paymentReviewRequired || cancelled(order)) {
        report.collections.reviewAmount = sum(report.collections.reviewAmount, collected);
        report.collections.reviewOrders++;
      } else {
        const tender = order.settlement!.method === 'cash' ? 'cash' : 'directUpi';
        report.collections[tender] = sum(report.collections[tender], collected);
        report.collections.total = sum(report.collections.total, collected);
        report.collections.orders++;
        const day = report.days.find(
          (candidate) => candidate.date === istDate(order.settlement!.confirmedAt),
        )!;
        day.collections = sum(day.collections, collected);
      }
    }
  }
  return report;
}

export function toSalesExportRow(
  raw: Order,
  mode: ReportMode,
  range?: Pick<ReportRange, 'from' | 'to'>,
): SalesExportRow {
  const order = raw as ReportOrder;
  assertOrderAmounts(order);
  const voided = !!order.testVoid;
  const eligible = completedSale(order, mode);
  const kind = sourceKind(order);
  const matchesReportMode = mode === 'production' ? kind !== 'test' : kind !== 'real';
  const placedInRange = !range || inRange(order.createdAt, range);
  const completedInRange =
    !!istDate(completionTime(order)) && (!range || inRange(completionTime(order), range));
  const collectionInRange =
    !!order.settlement && (!range || inRange(order.settlement.confirmedAt, range));
  const settlement =
    String(order.paymentMode) === 'counter_manual' && paid(order, mode)
      ? order.settlement
      : undefined;
  const gateway = isGatewayReceipt(order, mode);
  const periodRefunds = gateway ? refundEntriesInRange(order, range) : [];
  const periodRefundAmount = periodRefunds.reduce((total, entry) => sum(total, entry.amount), 0);
  const paymentMethod = getPaymentMethodDetails(order);
  return {
    branchId: order.branchId ?? '',
    branchName: order.branchName ?? '',
    orderNumber: order.number,
    invoiceNumber: order.invoice?.number ?? '',
    placedAt: order.createdAt,
    placedDateIst: istDate(order.createdAt),
    completedAt: completionTime(order),
    salesDateIst: istDate(completionTime(order)),
    legacySalesExGst:
      eligible && placedInRange && !istDate(completionTime(order))
        ? amount(order.total - (order.tax?.total ?? 0))
        : 0,
    channel: salesChannel(order),
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMode: order.paymentMode ?? 'legacy',
    paymentMethod: paymentMethod.paymentMethod ?? '',
    requestedPaymentMethod: paymentMethod.requestedPaymentMethod ?? '',
    collectionAt: settlement?.confirmedAt ?? '',
    servedAt: order.counter?.servedAt ?? '',
    subtotal: amount(order.subtotal),
    discount: amount(order.discount),
    deliveryFee: amount(order.deliveryFee),
    cgst: amount(order.tax?.cgst ?? 0),
    sgst: amount(order.tax?.sgst ?? 0),
    roundOff: signedAmount(order.roundOff ?? 0),
    total: amount(order.total),
    salesExGst: eligible && completedInRange ? amount(order.total - (order.tax?.total ?? 0)) : 0,
    collectionAmount:
      settlement && collectionInRange && !order.paymentReviewRequired && !cancelled(order)
        ? amount(settlement.amount)
        : 0,
    collectionReviewAmount:
      settlement && collectionInRange && (order.paymentReviewRequired || cancelled(order))
        ? amount(settlement.amount)
        : 0,
    unpaidAmount:
      !voided &&
      matchesReportMode &&
      placedInRange &&
      order.channel === 'counter' &&
      !cancelled(order) &&
      !paid(order, mode)
        ? amount(order.total)
        : 0,
    paymentReviewRequired: !!order.paymentReviewRequired,
    recordKind: sourceKind(order),
    voided,
    voidKind: order.testVoid?.kind ?? '',
    voidedAt: order.testVoid?.recordedAt ?? '',
    placedInRange,
    completedInRange,
    collectionInRange,
    gatewayFinancialScope: gateway && placedInRange ? 'orders_placed_in_range' : '',
    gatewayGrossCaptured: gateway && placedInRange ? amount(order.total) : 0,
    gatewayRefunded: gateway && placedInRange ? (order.refund?.amount ?? 0) : 0,
    gatewayNetRetained:
      gateway && placedInRange
        ? order.refundSyncPending
          ? null
          : amount(order.total - (order.refund?.amount ?? 0))
        : 0,
    refundSyncPending: !!order.refundSyncPending,
    refundAmount: order.refund?.amount ?? 0,
    refundStatus: order.refund?.status ?? '',
    refundEntriesJsonPaise: JSON.stringify(
      (order.refund?.entries ?? []).map(({ id, amount, processedAt, timestampSource }) => ({
        id,
        amount,
        processedAt,
        timestampSource,
      })),
    ),
    periodRefundAmount,
    refundInRange: periodRefunds.length > 0,
  };
}

/** An exported cell must never be interpreted as a spreadsheet formula. */
export function csvCell(value: string | number | boolean): string {
  const text = String(value);
  const safe =
    typeof value === 'string' && /^[\s\u0000-\u001f]*[=+@-]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
const moneyColumns = new Set([
  'subtotal',
  'discount',
  'deliveryFee',
  'cgst',
  'sgst',
  'roundOff',
  'total',
  'salesExGst',
  'collectionAmount',
  'collectionReviewAmount',
  'unpaidAmount',
  'legacySalesExGst',
  'gatewayGrossCaptured',
  'gatewayRefunded',
  'gatewayNetRetained',
  'refundAmount',
  'periodRefundAmount',
]);
const refundExportColumns = new Set([
  'gatewayFinancialScope',
  'gatewayGrossCaptured',
  'gatewayRefunded',
  'gatewayNetRetained',
  'refundAmount',
  'refundStatus',
  'refundEntriesJsonPaise',
  'periodRefundAmount',
  'refundInRange',
  'refundSyncPending',
]);
export function salesCsv(rows: SalesExportRow[]): string {
  const columns: Array<keyof SalesExportRow> = [
    'branchId',
    'branchName',
    'orderNumber',
    'invoiceNumber',
    'placedAt',
    'placedDateIst',
    'completedAt',
    'salesDateIst',
    'legacySalesExGst',
    'channel',
    'status',
    'paymentStatus',
    'paymentMode',
    'paymentMethod',
    'collectionAt',
    'servedAt',
    'subtotal',
    'discount',
    'deliveryFee',
    'cgst',
    'sgst',
    'roundOff',
    'total',
    'salesExGst',
    'collectionAmount',
    'collectionReviewAmount',
    'unpaidAmount',
    'paymentReviewRequired',
    'recordKind',
    'voided',
    'voidKind',
    'voidedAt',
    'placedInRange',
    'completedInRange',
    'collectionInRange',
    'requestedPaymentMethod',
    'gatewayFinancialScope',
    'gatewayGrossCaptured',
    'gatewayRefunded',
    'gatewayNetRetained',
    'refundAmount',
    'refundStatus',
    'refundEntriesJsonPaise',
    'periodRefundAmount',
    'refundInRange',
    'refundSyncPending',
  ];
  const header = columns
    .map((column) => csvCell(moneyColumns.has(column) ? `${column}INR` : column))
    .join(',');
  return (
    '\ufeff' +
    [
      header,
      ...rows.map((row) => {
        // An older Edge export may still return the checkout selection as paymentMethod.
        const method = getPaymentMethodDetails(row);
        return columns
          .map((column) =>
            csvCell(
              column === 'paymentMethod'
                ? (method.paymentMethod ?? '')
                : column === 'requestedPaymentMethod'
                  ? (row.requestedPaymentMethod ?? method.requestedPaymentMethod ?? '')
                  : row[column] === undefined && refundExportColumns.has(column)
                    ? ''
                    : column === 'gatewayNetRetained' && row[column] === null
                      ? ''
                      : column === 'roundOff'
                        ? signedAmount(row[column] ?? 0) / 100
                        : moneyColumns.has(column)
                          ? (amount(row[column]) / 100).toFixed(2)
                          : (row[column] ?? ''),
            ),
          )
          .join(',');
      }),
    ].join('\r\n') +
    '\r\n'
  );
}
export function salesExportFilename(branchId: string, from: string, to: string): string {
  return `hot-pizza-ace-sales-${branchId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100) || 'branch'}-${from.replace(/[^0-9-]/g, '')}-${to.replace(/[^0-9-]/g, '')}.csv`;
}
