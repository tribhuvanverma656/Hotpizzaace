import assert from 'node:assert/strict';
import test from 'node:test';
import type { Order } from '../types';
import { calculateOrderGst } from '../lib/billing';
import {
  buildSalesReport,
  csvCell,
  istDate,
  parseReportRequest,
  salesCsv,
  salesExportFilename,
  toSalesExportRow,
} from '../lib/analytics';

const range = {
  branchId: 'barra',
  from: '2026-10-24',
  to: '2026-10-24',
  mode: 'production' as const,
};
function counter(extra: Record<string, unknown> = {}): Order {
  return {
    id: 'counter-1',
    number: 'HPA-C001',
    branchId: 'barra',
    branchName: 'Barra',
    channel: 'counter',
    fulfillment: 'dine_in',
    environment: 'production',
    createdAt: '2026-10-24T04:00:00Z',
    completedAt: '2026-10-24T05:00:00Z',
    status: 'closed',
    paymentStatus: 'paid',
    paymentMode: 'counter_manual',
    paymentMethod: 'cash',
    subtotal: 10000,
    discount: 1000,
    deliveryFee: 0,
    total: 9450,
    tax: { taxableValue: 9000, cgst: 225, sgst: 225, total: 450 },
    items: [],
    counter: { servedAt: '2026-10-24T05:00:00Z' },
    settlement: {
      source: 'staff',
      method: 'cash',
      amount: 9450,
      confirmedBy: 'verified-staff-id',
      confirmedAt: '2026-10-24T04:10:00Z',
    },
    ...extra,
  } as unknown as Order;
}
function website(extra: Record<string, unknown> = {}): Order {
  const value = counter({
    channel: 'website',
    fulfillment: 'delivery',
    paymentMode: 'razorpay_live',
    paymentMethod: 'upi',
    status: 'delivered',
    ...extra,
  });
  delete (value as unknown as Record<string, unknown>).settlement;
  delete (value as unknown as Record<string, unknown>).counter;
  return value;
}

test('rounded bills reconcile separately from unchanged tax and original legacy receipts', () => {
  const legacy = counter();
  const rounded = counter({
    id: 'rounded',
    total: 9400,
    roundOff: -50,
    settlement: { ...legacy.settlement!, amount: 9400 },
  });
  const original = structuredClone(legacy);
  const report = buildSalesReport([rounded, legacy], range);
  assert.equal(report.totals.roundOff, -50);
  assert.equal(report.totals.cgst, 450);
  assert.equal(report.totals.sgst, 450);
  assert.equal(report.totals.foodSubtotal, 20000);
  assert.equal(report.totals.salesInclGst, 18850);
  assert.equal(report.totals.salesExGst, 17950);
  assert.equal(report.collections.cash, 18850);
  const row = toSalesExportRow(rounded, 'production', range);
  assert.equal(row.roundOff, -50);
  assert.match(salesCsv([row]), /roundOffINR/);
  assert.match(salesCsv([row]), /"-0.5"/);
  assert.deepEqual(legacy, original);
  for (const bad of [50, -49, -150, -50.5, '50', null]) {
    assert.throws(() => buildSalesReport([{ ...rounded, roundOff: bad } as Order], range));
  }
});

test('Razorpay CSV separates checkout selection from unknown actual method without changing saved receipts', () => {
  for (const mode of ['test', 'live'] as const) {
    for (const selected of ['upi', 'card'] as const) {
      const receipt = website({ paymentMode: `razorpay_${mode}`, paymentMethod: selected });
      const original = structuredClone(receipt);
      const row = toSalesExportRow(receipt, mode === 'test' ? 'development' : 'production');
      assert.equal(row.paymentMethod, '');
      assert.equal(row.requestedPaymentMethod, selected);
      assert.equal(row.paymentMode, `razorpay_${mode}`);
      assert.equal(row.total, receipt.total);
      assert.deepEqual(receipt, original);

      // These fixtures have no embedded commas: inspect the actual exported columns.
      const [header, data] = salesCsv([row])
        .replace(/^\ufeff/, '')
        .trimEnd()
        .split('\r\n');
      const columns: string[] = header.split(',').map((cell) => JSON.parse(cell));
      const values: string[] = data.split(',').map((cell) => JSON.parse(cell));
      assert.ok(columns.includes('requestedPaymentMethod'));
      assert.equal(values[columns.indexOf('paymentMethod')], '');
      assert.equal(values[columns.indexOf('requestedPaymentMethod')], selected);

      // The frontend can safely download an older Edge response during a rolling release.
      const legacy = { ...row, paymentMethod: selected };
      delete (legacy as Partial<typeof legacy>).requestedPaymentMethod;
      const [, legacyData] = salesCsv([legacy])
        .replace(/^\ufeff/, '')
        .trimEnd()
        .split('\r\n');
      const legacyValues: string[] = legacyData.split(',').map((cell) => JSON.parse(cell));
      assert.equal(legacyValues[columns.indexOf('paymentMethod')], '');
      assert.equal(legacyValues[columns.indexOf('requestedPaymentMethod')], selected);
      assert.doesNotMatch(legacyData, /undefined/);
    }
  }
});

test('manual and simulated payment methods retain their existing CSV classification and collections', () => {
  const cash = counter();
  const directUpi = counter({
    id: 'counter-upi',
    paymentMethod: 'upi',
    settlement: { ...cash.settlement!, method: 'upi' },
  });
  const simulation = website({ paymentMode: 'simulation', paymentStatus: 'simulated_paid' });
  for (const receipt of [cash, directUpi, simulation]) {
    const row = toSalesExportRow(receipt, 'production');
    assert.equal(row.paymentMethod, receipt.paymentMethod);
    assert.equal(row.requestedPaymentMethod, '');
  }
  const report = buildSalesReport([cash, directUpi], range);
  assert.equal(report.collections.cash, 9450);
  assert.equal(report.collections.directUpi, 9450);
  assert.equal(report.gatewayCohort.grossCaptured, 0);
  assert.equal(report.gatewayRefunds.amount, 0);
});

function processedRefund(
  amount: number,
  processedAt = '2026-10-24T05:00:00Z',
  timestampSource: 'provider_event' | 'verified_at' = 'provider_event',
) {
  return {
    amount,
    status: amount === 9450 ? 'full' : 'partial',
    entries: [{ id: 'rfnd_1', amount, processedAt, timestampSource }],
  };
}

test('gateway balances retain gross capture and original invoice while partial and full refunds stay out of fulfilled sales', () => {
  for (const refunded of [2000, 9450]) {
    const receipt = website({
      refund: processedRefund(refunded),
      // A refund remains protected even if an old projection lacks the review flag.
      paymentReviewRequired: false,
      invoice: { number: 'HPA/26-27/000001', kind: 'tax_invoice' },
    });
    const original = structuredClone(receipt);
    const report = buildSalesReport([receipt, receipt], range);
    assert.deepEqual(report.gatewayCohort, {
      scope: 'orders_placed_in_range',
      grossCaptured: 9450,
      refunded,
      netRetained: 9450 - refunded,
      orders: 1,
      unreconciledOrders: 0,
    });
    assert.equal(report.totals.salesExGst, 0);
    assert.equal(report.gatewayRefunds.amount, refunded);
    assert.equal(report.gatewayRefunds.entries, 1);
    assert.equal(report.gatewayRefunds.orders, 1);
    const row = toSalesExportRow(receipt, 'production', range);
    assert.equal(row.total, 9450);
    assert.equal(row.paymentStatus, 'paid');
    assert.equal(row.invoiceNumber, 'HPA/26-27/000001');
    assert.equal(row.gatewayGrossCaptured, 9450);
    assert.equal(row.gatewayRefunded, refunded);
    assert.equal(row.gatewayNetRetained, 9450 - refunded);
    assert.equal(row.refundAmount, refunded);
    assert.equal(row.refundStatus, refunded === 9450 ? 'full' : 'partial');
    assert.equal(row.salesExGst, 0);
    assert.deepEqual(receipt, original);
  }
});

test('dated refunds from older orders appear on the refund clock without inventing a capture or daily net settlement date', () => {
  const receipt = website({
    createdAt: '2026-10-20T04:00:00Z',
    completedAt: '2026-10-20T05:00:00Z',
    paymentReviewRequired: true,
    refund: {
      amount: 3000,
      status: 'partial',
      entries: [
        {
          id: 'rfnd_old',
          amount: 1000,
          processedAt: '2026-10-23T18:29:59.999Z',
          timestampSource: 'provider_event',
        },
        {
          id: 'rfnd_today',
          amount: 2000,
          processedAt: '2026-10-23T18:30:00Z',
          timestampSource: 'verified_at',
        },
      ],
    },
  });
  const report = buildSalesReport([receipt], range);
  assert.equal(report.totals.placedOrders, 0);
  assert.equal(report.gatewayCohort.grossCaptured, 0);
  assert.equal(report.gatewayCohort.netRetained, 0);
  assert.deepEqual(report.gatewayRefunds, {
    dateBasis: 'refund_entry_processed_at',
    amount: 2000,
    entries: 1,
    orders: 1,
    verifiedAtAmount: 2000,
  });
  assert.equal(report.days[0].refunds, 2000);
  assert.equal(report.days[0].collections, 0);
  assert.equal(report.days[0].salesExGst, 0);
  const row = toSalesExportRow(receipt, 'production', range);
  assert.equal(row.gatewayFinancialScope, '');
  assert.equal(row.gatewayGrossCaptured, 0);
  assert.equal(row.gatewayRefunded, 0);
  assert.equal(row.refundAmount, 3000);
  assert.equal(row.periodRefundAmount, 2000);
  assert.equal(row.refundInRange, true);
  assert.deepEqual(JSON.parse(row.refundEntriesJsonPaise), receipt.refund?.entries);
});

test('a placed-order cohort is cumulative at snapshot and never subtracts a later refund from an earlier daily collection', () => {
  const receipt = website({
    paymentReviewRequired: true,
    refund: processedRefund(2000, '2026-10-25T05:00:00Z'),
  });
  const report = buildSalesReport([receipt], range);
  assert.equal(report.gatewayCohort.grossCaptured, 9450);
  assert.equal(report.gatewayCohort.refunded, 2000);
  assert.equal(report.gatewayCohort.netRetained, 7450);
  assert.equal(report.gatewayRefunds.amount, 0);
  assert.equal(report.days[0].refunds, 0);
  assert.equal(toSalesExportRow(receipt, 'production', range).periodRefundAmount, 0);
});

test('provider-confirmed refunds with unresolved history make net retained unknown without inventing refund amounts or dates', () => {
  const pending = website({ refundSyncPending: true, paymentReviewRequired: true });
  const report = buildSalesReport([pending], range);
  assert.deepEqual(report.gatewayCohort, {
    scope: 'orders_placed_in_range',
    grossCaptured: 9450,
    refunded: 0,
    netRetained: null,
    orders: 1,
    unreconciledOrders: 1,
  });
  assert.equal(report.totals.salesExGst, 0);
  assert.equal(report.gatewayRefunds.amount, 0);
  assert.equal(report.gatewayRefunds.entries, 0);
  assert.equal(report.days[0].refunds, 0);
  const row = toSalesExportRow(pending, 'production', range);
  assert.equal(row.gatewayGrossCaptured, 9450);
  assert.equal(row.gatewayNetRetained, null);
  assert.equal(row.refundSyncPending, true);
  assert.equal(row.refundEntriesJsonPaise, '[]');
  assert.equal(row.periodRefundAmount, 0);
  const [header, data] = salesCsv([row])
    .replace(/^\ufeff/, '')
    .trimEnd()
    .split('\r\n');
  const columns = header.split(',').map((cell) => JSON.parse(cell) as string);
  const values = data.split(',').map((cell) => JSON.parse(cell) as string);
  assert.equal(values[columns.indexOf('gatewayNetRetainedINR')], '');
  assert.equal(values[columns.indexOf('refundSyncPending')], 'true');
  assert.equal(values[columns.indexOf('gatewayGrossCapturedINR')], '94.50');
  // Pending history cannot be bypassed by a missing legacy review flag.
  assert.equal(
    buildSalesReport([{ ...pending, paymentReviewRequired: false }], range).totals.salesExGst,
    0,
  );
});

test('unknown net balances remain unknown in any result order while dated totals include only reconciled refund entries', () => {
  const pending = website({
    id: 'pending-history',
    refundSyncPending: true,
    paymentReviewRequired: true,
    refund: processedRefund(1000),
  });
  const known = website({
    id: 'known-refund',
    paymentReviewRequired: true,
    refund: processedRefund(2000),
  });
  for (const orders of [
    [pending, known],
    [known, pending],
  ]) {
    const report = buildSalesReport(orders, range);
    assert.equal(report.gatewayCohort.grossCaptured, 18900);
    assert.equal(report.gatewayCohort.refunded, 3000);
    assert.equal(report.gatewayCohort.netRetained, null);
    assert.equal(report.gatewayCohort.unreconciledOrders, 1);
    assert.equal(report.gatewayRefunds.amount, 3000);
    assert.equal(report.days[0].refunds, 3000);
  }
  const reconciled = buildSalesReport([{ ...pending, refundSyncPending: undefined }, known], range);
  assert.equal(reconciled.gatewayCohort.unreconciledOrders, 0);
  assert.equal(reconciled.gatewayCohort.netRetained, 15900);
  const outsideCohort = toSalesExportRow(
    { ...pending, createdAt: '2026-10-20T04:00:00Z' },
    'production',
    range,
  );
  assert.equal(outsideCohort.refundSyncPending, true);
  assert.equal(outsideCohort.gatewayFinancialScope, '');
  assert.equal(outsideCohort.gatewayNetRetained, 0);
  assert.equal(outsideCohort.periodRefundAmount, 1000);
});

test('refunded test, archived and other-branch receipts cannot inflate production balances or dated refunds', () => {
  const refund = processedRefund(2000);
  const testReceipt = website({ paymentMode: 'razorpay_test', refund });
  const archived = website({
    id: 'archived-refund',
    refund,
    testVoid: { kind: 'no_money_software_test', recordedAt: '2026-10-24T05:00:00Z' },
  });
  const elsewhere = website({ id: 'other-refund', branchId: 'other', refund });
  const report = buildSalesReport([testReceipt, archived, elsewhere], range);
  assert.equal(report.gatewayCohort.grossCaptured, 0);
  assert.equal(report.gatewayRefunds.amount, 0);
  assert.equal(report.days[0].refunds, 0);
  assert.equal(toSalesExportRow(testReceipt, 'production', range).periodRefundAmount, 0);
  assert.equal(toSalesExportRow(archived, 'production', range).periodRefundAmount, 0);
  assert.equal(
    buildSalesReport([testReceipt], { ...range, mode: 'development' }).gatewayRefunds.amount,
    2000,
  );
});

test('refund CSV balances reconcile with summary scopes and include dated audit entries without customer data', () => {
  const firstRefund = processedRefund(2000);
  const receipts = [
    website({
      refund: {
        ...firstRefund,
        entries: [{ ...firstRefund.entries[0], customer: 'Private refund metadata' }],
      },
      paymentReviewRequired: true,
    }),
    website({
      id: 'other-day-refund',
      createdAt: '2026-10-20T04:00:00Z',
      refund: processedRefund(1000),
      paymentReviewRequired: true,
    }),
  ];
  const report = buildSalesReport(receipts, range);
  const rows = receipts.map((receipt) => toSalesExportRow(receipt, 'production', range));
  assert.equal(
    rows.reduce((sum, row) => sum + row.gatewayGrossCaptured, 0),
    report.gatewayCohort.grossCaptured,
  );
  assert.equal(
    rows.reduce((sum, row) => sum + row.gatewayRefunded, 0),
    report.gatewayCohort.refunded,
  );
  assert.equal(
    rows.reduce((sum, row) => sum + (row.gatewayNetRetained ?? NaN), 0),
    report.gatewayCohort.netRetained,
  );
  assert.equal(
    rows.reduce((sum, row) => sum + row.periodRefundAmount, 0),
    report.gatewayRefunds.amount,
  );
  const csv = salesCsv(rows);
  assert.match(
    csv,
    /"gatewayGrossCapturedINR","gatewayRefundedINR","gatewayNetRetainedINR","refundAmountINR"/,
  );
  assert.match(csv, /"refundEntriesJsonPaise","periodRefundAmountINR","refundInRange"/);
  assert.ok(csv.includes('rfnd_1'));
  assert.ok(csv.includes('2026-10-24T05:00:00Z'));
  assert.ok(!csv.includes('customer'));
  assert.ok(!csv.includes('Private refund metadata'));
  // Missing fields in an older Edge response remain unknown, rather than invented zero refunds.
  const legacy = { ...rows[0] };
  delete (legacy as Partial<typeof legacy>).periodRefundAmount;
  assert.doesNotThrow(() => salesCsv([legacy]));
  assert.doesNotMatch(salesCsv([legacy]), /undefined/);
});

test('inconsistent, duplicated or unsupported refund snapshots fail closed before financial reporting', () => {
  const valid = processedRefund(2000);
  for (const refund of [
    { ...valid, amount: 2001 },
    { ...valid, status: 'full' },
    processedRefund(9451),
    { ...valid, entries: [...valid.entries, ...valid.entries] },
    { ...valid, entries: [{ ...valid.entries[0], amount: -1 }] },
    { ...valid, entries: [{ ...valid.entries[0], processedAt: 'invalid' }] },
    { ...valid, entries: [{ ...valid.entries[0], timestampSource: 'placed_at' }] },
  ]) {
    const receipt = website({ refund });
    assert.throws(() => buildSalesReport([receipt], range), /refund/);
    assert.throws(() => toSalesExportRow(receipt, 'production', range), /refund/);
  }
  assert.throws(() => buildSalesReport([counter({ refund: valid })], range), /refund/);
});

test('counter home delivery reports delivery sales and manual collections without dine-in or online double counts', () => {
  const delivery = counter({
    fulfillment: 'delivery',
    status: 'delivered',
    subtotal: 10000,
    discount: 0,
    deliveryFee: 4900,
    total: 15646,
    tax: { taxableValue: 14900, cgst: 373, sgst: 373, total: 746 },
    settlement: {
      source: 'staff',
      method: 'cash',
      amount: 15646,
      confirmedBy: 'verified-staff-id',
      confirmedAt: '2026-10-24T04:10:00Z',
    },
  });
  const report = buildSalesReport([delivery], range);
  assert.equal(report.channels.delivery.completedOrders, 1);
  assert.equal(report.channels.delivery.deliveryFees, 4900);
  assert.equal(report.channels.delivery.salesInclGst, 15646);
  assert.equal(report.channels.dine_in.placedOrders, 0);
  assert.equal(report.collections.cash, 15646);
  assert.equal(report.undatedOnlinePaidOrders, 0);
  const row = toSalesExportRow(delivery, 'production', range);
  assert.equal(row.channel, 'delivery');
  assert.equal(row.salesExGst, 14900);
  assert.equal(row.collectionAmount, 15646);
  const unpaid = { ...delivery, paymentStatus: 'pending' as const, settlement: undefined };
  const unpaidReport = buildSalesReport([unpaid], range);
  assert.equal(unpaidReport.totals.completedOrders, 0);
  assert.equal(unpaidReport.collections.total, 0);
  assert.equal(unpaidReport.channels.delivery.unpaidCounterOrders, 1);
  assert.equal(unpaidReport.channels.delivery.unpaidCounterAmount, 15646);
  assert.equal(toSalesExportRow(unpaid, 'production', range).unpaidAmount, 15646);
});

test('report dates validate calendar days and use exact inclusive IST day boundaries', () => {
  const parsed = parseReportRequest({
    branchId: 'barra',
    from: '2026-10-24',
    to: '2026-10-24',
    kind: 'summary',
  });
  assert.equal(parsed.fromUtc, '2026-10-23T18:30:00.000Z');
  assert.equal(parsed.toUtc, '2026-10-24T18:30:00.000Z');
  assert.equal(istDate('2026-10-23T18:29:59.999Z'), '2026-10-23');
  assert.equal(istDate('2026-10-23T18:30:00Z'), '2026-10-24');
  assert.equal(istDate('invalid'), '');
  for (const extra of [
    { from: '2026-02-30' },
    { to: '2026-10-23' },
    { to: '2026-11-24' },
    { branchId: '../barra' },
    { kind: 'delete' },
    { deleteAfterExport: true },
    { cursor: '<script>' },
    { snapshotAt: 'not-a-date' },
  ])
    assert.throws(() =>
      parseReportRequest({
        branchId: 'barra',
        from: '2026-10-24',
        to: '2026-10-24',
        kind: 'summary',
        ...extra,
      }),
    );
  assert.doesNotThrow(() =>
    parseReportRequest({ branchId: 'barra', from: '2026-10-01', to: '2026-10-31', kind: 'export' }),
  );
});

test('production sales split dine-in, delivery and pickup and keep food, discount and GST separate', () => {
  const dine = counter();
  const delivery = website({
    id: 'website-1',
    subtotal: 10000,
    discount: 1000,
    deliveryFee: 4900,
    total: 14596,
    tax: { cgst: 348, sgst: 348, total: 696 },
  });
  const pickup = website({ id: 'website-2', fulfillment: 'pickup', status: 'picked_up' });
  const report = buildSalesReport([dine, delivery, pickup], range);
  assert.equal(report.totals.placedOrders, 3);
  assert.equal(report.totals.completedOrders, 3);
  assert.equal(report.channels.dine_in.completedOrders, 1);
  assert.equal(report.channels.delivery.completedOrders, 1);
  assert.equal(report.channels.pickup.completedOrders, 1);
  assert.equal(report.totals.foodSubtotal, 30000);
  assert.equal(report.totals.discounts, 3000);
  assert.equal(report.totals.foodSales, 27000);
  assert.equal(report.totals.deliveryFees, 4900);
  assert.equal(report.totals.salesExGst, 31900);
  assert.equal(report.totals.cgst, 798);
  assert.equal(report.totals.sgst, 798);
  assert.equal(report.totals.salesInclGst, 33496);
  assert.equal(report.totals.averageOrderValue, 10633);
  assert.equal(report.collections.cash, 9450);
  assert.equal(report.collections.directUpi, 0);
  assert.equal(report.collections.total, 9450);
  assert.equal(report.undatedOnlinePaidOrders, 2);
});

test('completion date and payment receipt date are independent of placement and each other', () => {
  const yesterdayPlaced = counter({ createdAt: '2026-10-23T01:00:00Z' });
  const yesterdayServedTodayPaid = counter({
    id: 'counter-2',
    createdAt: '2026-10-23T01:00:00Z',
    completedAt: '2026-10-23T05:00:00Z',
    counter: { servedAt: '2026-10-23T05:00:00Z' },
    paymentMethod: 'upi',
    settlement: {
      source: 'staff',
      method: 'upi',
      amount: 9450,
      confirmedBy: 'staff',
      confirmedAt: '2026-10-24T12:00:00Z',
    },
  });
  const nextDay = counter({
    id: 'next',
    createdAt: '2026-10-24T18:30:00Z',
    completedAt: '2026-10-24T18:30:00Z',
    settlement: {
      source: 'staff',
      method: 'cash',
      amount: 9450,
      confirmedBy: 'staff',
      confirmedAt: '2026-10-24T18:30:00Z',
    },
  });
  const report = buildSalesReport([yesterdayPlaced, yesterdayServedTodayPaid, nextDay], range);
  assert.equal(report.totals.placedOrders, 0);
  assert.equal(report.totals.completedOrders, 1);
  assert.equal(report.totals.salesExGst, 9000);
  assert.equal(report.collections.cash, 9450);
  assert.equal(report.collections.directUpi, 9450);
  assert.equal(report.days[0].collections, 18900);
});

test('legacy paid website receipts without completion clocks are disclosed separately, never assigned an invented sales date', () => {
  const legacy = website({ completedAt: undefined });
  const report = buildSalesReport([legacy], range);
  assert.equal(report.totals.completedOrders, 0);
  assert.equal(report.totals.salesExGst, 0);
  assert.equal(report.legacyPlacedSales.completedOrders, 1);
  assert.equal(report.legacyPlacedSales.salesExGst, 9000);
  const row = toSalesExportRow(legacy, 'production');
  assert.equal(row.salesDateIst, '');
  assert.equal(row.salesExGst, 0);
  assert.equal(row.legacySalesExGst, 9000);
});

test('cancelled, unpaid, review-required, wrong branch and test orders never inflate real sales', () => {
  const unpaid = counter({
    id: 'unpaid',
    paymentStatus: 'pending',
    settlement: undefined,
    status: 'served',
  });
  const cancelled = counter({ id: 'cancelled', status: 'cancelled' });
  const review = counter({ id: 'review', paymentReviewRequired: true });
  const testCounter = counter({ id: 'test', environment: 'development' });
  const malformedManual = counter({
    id: 'bad',
    channel: 'website',
    fulfillment: 'delivery',
    status: 'delivered',
  });
  const report = buildSalesReport(
    [
      unpaid,
      cancelled,
      review,
      testCounter,
      malformedManual,
      website({ id: 'test-capture', paymentMode: 'razorpay_test' }),
      counter({ id: 'elsewhere', branchId: 'other' }),
    ],
    range,
  );
  assert.equal(report.totals.completedOrders, 0);
  assert.equal(report.totals.salesExGst, 0);
  assert.equal(report.totals.unpaidCounterOrders, 1);
  assert.equal(report.totals.unpaidCounterAmount, 9450);
  assert.equal(report.excludedTestOrders, 2);
  assert.equal(report.reviewOrders, 1);
  assert.equal(report.collections.total, 0);
  assert.equal(report.collections.reviewAmount, 18900);
  assert.equal(report.collections.reviewOrders, 2);
  const row = toSalesExportRow(cancelled, 'production');
  assert.equal(row.collectionAmount, 0);
  assert.equal(row.collectionReviewAmount, 9450);
});

test('development cash and UPI receipts remain test figures and duplicate result rows do not double count', () => {
  const order = counter({ environment: 'development' });
  const report = buildSalesReport([order, order, website({ id: 'real-website' })], {
    ...range,
    mode: 'development',
  });
  assert.equal(report.mode, 'development');
  assert.equal(report.totals.completedOrders, 1);
  assert.equal(report.collections.total, 9450);
  assert.equal(report.excludedTestOrders, 1);
  assert.equal(toSalesExportRow(order, 'development').recordKind, 'test');
  assert.equal(
    buildSalesReport([counter({ environment: undefined })], range).totals.completedOrders,
    0,
  );
});

test('archived no-money software tests contribute nothing to either environment, including pending and legacy cohorts', () => {
  const testVoid = {
    kind: 'no_money_software_test' as const,
    recordedAt: '2026-10-27T04:00:00.000Z',
    reason: 'Owner confirmed these were software tests; no money was received.',
  };
  for (const mode of ['production', 'development'] as const) {
    const live = counter({ id: 'ordinary-sale', environment: mode });
    const archived = [
      counter({ id: 'archived-paid', status: 'closed' }),
      counter({ id: 'archived-preparing', status: 'preparing', completedAt: undefined }),
      counter({ id: 'archived-cancelled', status: 'cancelled', paymentReviewRequired: true }),
      counter({ id: 'archived-legacy', completedAt: undefined, counter: {} }),
      counter({
        id: 'archived-unpaid',
        status: 'served',
        paymentStatus: 'pending',
        settlement: undefined,
      }),
      website({ id: 'archived-website', completedAt: undefined }),
    ].map((order) => ({ ...order, environment: mode, testVoid }));
    const reportRange = { ...range, mode };
    assert.deepEqual(buildSalesReport(archived, reportRange), buildSalesReport([], reportRange));
    assert.deepEqual(
      buildSalesReport([live, ...archived, ...archived], reportRange),
      buildSalesReport([live], reportRange),
    );
    assert.deepEqual(
      buildSalesReport(archived, {
        ...reportRange,
        mode: mode === 'production' ? 'development' : 'production',
      }),
      buildSalesReport([], {
        ...reportRange,
        mode: mode === 'production' ? 'development' : 'production',
      }),
    );
  }
});

test('an archived software-test CSV row preserves bill provenance but never asserts a collection, sale or debt', () => {
  for (const mode of ['production', 'development'] as const) {
    for (const extra of [
      {},
      { status: 'cancelled', paymentReviewRequired: true },
      { completedAt: undefined, counter: {} },
      { paymentStatus: 'pending', settlement: undefined, status: 'served' },
    ]) {
      const order = counter({
        ...extra,
        environment: mode,
        invoice: {
          number: 'HPA/26-27/000001',
          kind: 'tax_invoice',
          issuedAt: '2026-10-24T04:00:00Z',
        },
        testVoid: {
          kind: 'no_money_software_test',
          recordedAt: '2026-10-27T04:00:00.000Z',
          reason: 'Private correction note is not a CSV field',
        },
      });
      const row = toSalesExportRow(order, mode, range);
      assert.equal(row.voided, true);
      assert.equal(row.voidKind, 'no_money_software_test');
      assert.equal(row.voidedAt, '2026-10-27T04:00:00.000Z');
      assert.equal(row.recordKind, mode === 'production' ? 'real' : 'test');
      assert.equal(row.orderNumber, order.number);
      assert.equal(row.invoiceNumber, 'HPA/26-27/000001');
      assert.equal(row.paymentStatus, order.paymentStatus);
      assert.equal(row.total, order.total);
      assert.equal(row.cgst, order.tax?.cgst);
      assert.equal(row.sgst, order.tax?.sgst);
      for (const field of [
        'salesExGst',
        'legacySalesExGst',
        'collectionAmount',
        'collectionReviewAmount',
        'unpaidAmount',
      ] as const)
        assert.equal(row[field], 0, field);
      assert.equal(row.collectionAt, '');
      const csv = salesCsv([row]);
      assert.ok(csv.includes('"voided","voidKind","voidedAt"'));
      assert.ok(csv.includes('"true","no_money_software_test","2026-10-27T04:00:00.000Z"'));
      assert.ok(!csv.includes('Private correction note'));
    }
    const ordinary = toSalesExportRow(counter({ environment: mode }), mode, range);
    assert.equal(ordinary.voided, false);
    assert.equal(ordinary.voidKind, '');
    assert.equal(ordinary.voidedAt, '');
    assert.equal(ordinary.collectionAmount, 9450);
  }
});

test('CSV copies no customer or transaction-reference PII, quotes Unicode and blocks spreadsheet formulas', () => {
  const row = toSalesExportRow(
    counter({
      branchName: '=HYPERLINK("https://malicious.example")',
      customer: { name: 'Private Customer', phone: '9000000001', address: 'Private address' },
    }),
    'production',
  );
  const csv = salesCsv([row]);
  assert.ok(csv.startsWith('\ufeff'));
  assert.ok(csv.includes('"subtotalINR"'));
  assert.ok(csv.includes('"100.00"'));
  assert.ok(csv.includes('"\'=HYPERLINK('));
  for (const privateValue of [
    'Private Customer',
    '9000000001',
    'Private address',
    'confirmedBy',
    'upiReference',
  ])
    assert.ok(!csv.includes(privateValue));
  assert.equal(csvCell('  \t+SUM(1,2)'), '"\'  \t+SUM(1,2)"');
  assert.equal(csvCell('Pizza, "Paneer"\nBarra'), '"Pizza, ""Paneer""\nBarra"');
  assert.equal(
    salesExportFilename('../../barra', '2026-10-24', '2026-10-24'),
    'hot-pizza-ace-sales-barra-2026-10-24-2026-10-24.csv',
  );
});

test('CSV period amounts follow their event clocks rather than summing all bill face values', () => {
  const order = counter({
    completedAt: '2026-10-23T05:00:00Z',
    settlement: {
      source: 'staff',
      method: 'cash',
      amount: 9450,
      confirmedBy: 'staff',
      confirmedAt: '2026-10-24T05:00:00Z',
    },
  });
  const row = toSalesExportRow(order, 'production', range);
  assert.equal(row.total, 9450);
  assert.equal(row.completedInRange, false);
  assert.equal(row.collectionInRange, true);
  assert.equal(row.salesExGst, 0);
  assert.equal(row.collectionAmount, 9450);
  const anotherDate = toSalesExportRow(order, 'production', {
    from: '2026-10-25',
    to: '2026-10-25',
  });
  assert.equal(anotherDate.collectionAmount, 0);
  assert.equal(anotherDate.unpaidAmount, 0);
});

test('payment provenance rejects a simulated success on a provider capture and live cash masquerading as a gateway payment', () => {
  assert.equal(
    buildSalesReport([website({ paymentMode: 'razorpay_test', paymentStatus: 'simulated_paid' })], {
      ...range,
      mode: 'development',
    }).totals.completedOrders,
    0,
  );
  assert.equal(
    buildSalesReport([website({ paymentMethod: 'cash' })], range).totals.completedOrders,
    0,
  );
});

test('prepaid unserved meals are collections only, while served pay-later meals remain unpaid until actual receipt', () => {
  const prepaid = counter({
    status: 'confirmed',
    completedAt: undefined,
    counter: { tableLabel: 'A1', payLater: false },
  });
  const deferred = counter({
    id: 'deferred',
    status: 'served',
    paymentStatus: 'pending',
    settlement: undefined,
  });
  const report = buildSalesReport([prepaid, deferred], range);
  assert.equal(report.totals.salesExGst, 0);
  assert.equal(report.totals.completedOrders, 0);
  assert.equal(report.collections.cash, 9450);
  assert.equal(report.totals.unpaidCounterAmount, 9450);
});

test('a paid-and-served bill is counted once when closing later and does not gain a second sale', () => {
  const served = counter({ status: 'served', counter: { servedAt: '2026-10-24T05:00:00Z' } });
  const closedLater = counter({
    status: 'closed',
    counter: { servedAt: '2026-10-24T05:00:00Z', closedAt: '2026-10-25T05:00:00Z' },
  });
  assert.equal(buildSalesReport([served], range).totals.salesExGst, 9000);
  assert.equal(buildSalesReport([closedLater], range).totals.salesExGst, 9000);
  assert.equal(
    buildSalesReport([closedLater], { ...range, from: '2026-10-25', to: '2026-10-25' }).totals
      .salesExGst,
    0,
  );
});

test('inconsistent bill snapshots fail closed rather than publishing contradictory sales or GST totals', () => {
  for (const extra of [
    { total: 9999 },
    { discount: 20000 },
    { tax: { cgst: 225, sgst: 225, total: 449 } },
  ]) {
    const order = counter(extra);
    assert.throws(() => buildSalesReport([order], range), /reconcile/);
    assert.throws(() => toSalesExportRow(order, 'production', range), /reconcile/);
  }
});

test('completed and collection date totals reconcile with the corresponding CSV period columns', () => {
  const orders = [
    counter(),
    counter({ id: 'earlier-served', completedAt: '2026-10-23T05:00:00Z' }),
    counter({
      id: 'earlier-collected',
      settlement: {
        source: 'staff',
        method: 'cash',
        amount: 9450,
        confirmedBy: 'staff',
        confirmedAt: '2026-10-23T05:00:00Z',
      },
    }),
  ];
  const report = buildSalesReport(orders, range);
  const rows = orders.map((order) => toSalesExportRow(order, 'production', range));
  assert.equal(
    rows.reduce((sum, row) => sum + row.salesExGst, 0),
    report.totals.salesExGst,
  );
  assert.equal(
    rows.reduce((sum, row) => sum + row.collectionAmount, 0),
    report.collections.total,
  );
  assert.equal(
    rows.reduce((sum, row) => sum + row.unpaidAmount, 0),
    report.totals.unpaidCounterAmount,
  );
});

test('MRP sales exclude all included GST and reconcile with cash collections and CSV amounts', () => {
  const tax = calculateOrderGst(
    [
      { unitPrice: 10000, quantity: 1 },
      { unitPrice: 2000, quantity: 1, gstInclusive: { rateBps: 500, code: '2201' } },
    ],
    0,
    0,
    {
      businessName: 'HOT PIZZA ACE',
      address: 'ME346 Barra 2, Kanpur',
      gstin: '09ANCPV1491R1Z3',
      fssaiNumber: '12721045000614',
      stateName: 'Uttar Pradesh',
      stateCode: '09',
      sac: '996331',
      cgstRate: 2.5,
      sgstRate: 2.5,
    },
  );
  const order = counter({
    subtotal: 12000,
    discount: 0,
    total: 12500,
    tax,
    settlement: {
      source: 'staff',
      method: 'cash',
      amount: 12500,
      confirmedBy: 'staff',
      confirmedAt: '2026-10-24T04:10:00Z',
    },
  });
  const report = buildSalesReport([order], range);
  const row = toSalesExportRow(order, 'production', range);
  assert.equal(report.totals.salesInclGst, 12500);
  assert.equal(report.totals.salesExGst, 11904);
  assert.equal(report.totals.foodSales, 11904);
  assert.equal(report.totals.cgst, 298);
  assert.equal(report.totals.sgst, 298);
  assert.equal(report.collections.total, 12500);
  assert.equal(row.salesExGst, 11904);
  assert.equal(row.collectionAmount, 12500);
  for (const changed of [
    { ...tax, includedTotal: 0 },
    { ...tax, version: undefined },
    { ...tax, groups: [...tax.groups!].reverse() },
    {
      ...tax,
      groups: tax.groups!.map((group, index) =>
        index ? { ...group, cgst: group.cgst + 1 } : group,
      ),
    },
  ]) {
    assert.throws(() => buildSalesReport([counter({ ...order, tax: changed })], range));
    assert.throws(() => toSalesExportRow(counter({ ...order, tax: changed }), 'production', range));
  }
});

test('nearest bills and historical floor/paise receipts reconcile together without rewriting saved amounts', () => {
  const legacy = counter({ id: 'legacy' });
  const floor = counter({
    id: 'historical-floor',
    total: 9400,
    roundOff: -50,
    settlement: { ...legacy.settlement!, amount: 9400 },
  });
  const nearest = counter({
    id: 'new-nearest',
    total: 9500,
    roundOff: 50,
    roundOffPolicy: 'nearest_rupee',
    settlement: { ...legacy.settlement!, amount: 9500 },
  });
  const originals = structuredClone([legacy, floor, nearest]);
  const report = buildSalesReport([legacy, floor, nearest], range);
  assert.equal(report.totals.salesInclGst, 28350);
  assert.equal(report.totals.salesExGst, 27000);
  assert.equal(report.totals.roundOff, 0);
  assert.equal(report.collections.total, 28350);
  assert.equal(report.totals.cgst, 675);
  const row = toSalesExportRow(nearest, 'production', range);
  assert.equal(row.roundOff, 50);
  assert.equal(row.collectionAmount, 9500);
  assert.match(salesCsv([row]), /"0.5"/);
  assert.deepEqual([legacy, floor, nearest], originals);
  for (const invalid of [
    { roundOffPolicy: 'unknown' },
    { roundOffPolicy: null },
    { roundOff: undefined },
    { roundOff: '50' },
    { roundOff: 50.5 },
    { total: 9400, roundOff: -50 },
  ]) {
    assert.throws(() => buildSalesReport([{ ...nearest, ...invalid } as Order], range));
  }
});

test('nearest MRP reports enforce the subtotal ceiling while mixed and delivery bills round normally', () => {
  const supplier = {
    businessName: 'HOT PIZZA ACE',
    address: 'ME346 Barra 2 Kanpur',
    gstin: '09ANCPV1491R1Z3',
    fssaiNumber: '12721045000614',
    stateName: 'Uttar Pradesh',
    stateCode: '09',
    sac: '996331',
    cgstRate: 2.5,
    sgstRate: 2.5,
  } as const;
  for (const [price, discount, total, adjustment] of [
    [2050, 0, 2000, -50],
    [2099, 0, 2000, -99],
    [2050, 70, 2000, 20],
  ]) {
    const tax = calculateOrderGst(
      [{ unitPrice: price, quantity: 1, gstInclusive: { rateBps: 500, code: '2201' } }],
      0,
      discount,
      supplier,
    );
    const original = counter();
    const receipt = counter({
      subtotal: price,
      discount,
      total,
      tax,
      roundOff: adjustment,
      roundOffPolicy: 'nearest_rupee',
      settlement: { ...original.settlement!, amount: total },
    });
    const saved = structuredClone(receipt);
    assert.equal(buildSalesReport([receipt], range).collections.total, total);
    assert.equal(toSalesExportRow(receipt, 'production', range).roundOff, adjustment);
    assert.deepEqual(receipt, saved);
    assert.throws(
      () =>
        buildSalesReport(
          [
            {
              ...receipt,
              total: 2100,
              roundOff: 2100 - (price - discount),
              settlement: { ...original.settlement!, amount: 2100 },
            },
          ],
          range,
        ),
      'rounding cannot collect more than the MRP-only subtotal',
    );
  }
  const tax = calculateOrderGst(
    [
      { unitPrice: 10000, quantity: 1 },
      { unitPrice: 2050, quantity: 1, gstInclusive: { rateBps: 500, code: '2201' } },
    ],
    0,
    0,
    supplier,
  );
  const mixed = counter({
    subtotal: 12050,
    discount: 0,
    total: 12600,
    tax,
    roundOff: 50,
    roundOffPolicy: 'nearest_rupee',
    settlement: { ...counter().settlement!, amount: 12600 },
  });
  assert.equal(buildSalesReport([mixed], range).collections.total, 12600);
  assert.equal(toSalesExportRow(mixed, 'production', range).cgst, 299);
  for (const [foodPrice, discount, total, adjustment] of [
    [0, 0, 2100, 50],
    [1, 1026, 1000, -25],
  ]) {
    const groups = calculateOrderGst(
      [
        { unitPrice: foodPrice, quantity: 1 },
        { unitPrice: 2050, quantity: 1, gstInclusive: { rateBps: 500, code: '2201' } },
      ],
      0,
      discount,
      supplier,
    );
    assert.ok(
      groups.groups?.some((group) => group.pricing === 'exclusive' && group.taxableValue === 0),
    );
    const receipt = counter({
      subtotal: foodPrice + 2050,
      discount,
      total,
      tax: groups,
      roundOff: adjustment,
      roundOffPolicy: 'nearest_rupee',
      settlement: { ...counter().settlement!, amount: total },
    });
    assert.equal(buildSalesReport([receipt], range).collections.total, total);
  }
});
