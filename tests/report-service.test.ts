import assert from 'node:assert/strict';
import test from 'node:test';
import { handleSalesReport, ReportError } from '../lib/commerce/reports';

const actor = '11111111-1111-4111-8111-111111111111';
const order = {
  id: '22222222-2222-4222-8222-222222222222',
  number: 'TEST-2',
  branchId: 'barra',
  branchName: 'Barra',
  createdAt: '2026-10-24T01:00:00.000Z',
  completedAt: '2026-10-24T02:00:00.000Z',
  fulfillment: 'dine_in',
  channel: 'counter',
  environment: 'production',
  status: 'closed',
  paymentMethod: 'upi',
  paymentMode: 'counter_manual',
  paymentStatus: 'paid',
  subtotal: 10000,
  discount: 0,
  deliveryFee: 0,
  total: 10500,
  tax: { cgst: 250, sgst: 250, total: 500 },
  counter: { servedAt: '2026-10-24T02:00:00.000Z' },
  settlement: {
    source: 'staff',
    method: 'upi',
    amount: 10500,
    confirmedBy: actor,
    confirmedAt: '2026-10-24T01:15:00.000Z',
  },
};
const request = { branchId: 'barra', from: '2026-10-24', to: '2026-10-24', kind: 'summary' };
function database(extra: Record<string, unknown> = {}, error: { message: string } | null = null) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return {
        data: {
          orders: [order],
          mode: 'production',
          complete: true,
          snapshotAt: '2026-10-24T10:00:00.000Z',
          ...extra,
        },
        error,
      };
    },
  };
}

test('financial reports use one branch-scoped RPC snapshot and server-authoritative mode', async () => {
  const db = database();
  const result = await handleSalesReport(db, actor, request);
  assert.equal(db.calls.length, 1);
  assert.deepEqual(db.calls[0], {
    name: 'hpa_sales_report_snapshot',
    args: {
      p_actor_id: actor,
      p_branch_id: 'barra',
      p_from: '2026-10-23T18:30:00.000Z',
      p_to: '2026-10-24T18:30:00.000Z',
    },
  });
  assert.ok('summary' in result);
  assert.equal(result.summary.totals.salesExGst, 10000);
  assert.equal(result.summary.collections.directUpi, 10500);
  assert.equal(result.summary.mode, 'production');
});

test('sales export is a complete copy with no customer, staff identity or bank reference data', async () => {
  const db = database({
    orders: [
      {
        ...order,
        customer: { name: 'PRIVATE NAME', phone: '9000000000' },
        settlement: { ...order.settlement, upiReference: 'PRIVATE_BANK_REFERENCE' },
      },
    ],
  });
  const result = await handleSalesReport(db, actor, { ...request, kind: 'export' });
  assert.ok('rows' in result);
  assert.equal(result.complete, true);
  assert.equal(result.nextCursor, null);
  assert.equal(result.rows[0].salesExGst, 10000);
  const text = JSON.stringify(result);
  for (const value of ['PRIVATE NAME', '9000000000', 'PRIVATE_BANK_REFERENCE', actor])
    assert.ok(!text.includes(value));
  assert.equal(db.calls.length, 1);
  assert.ok(db.calls.every((call) => call.name === 'hpa_sales_report_snapshot'));
});

test('owner identity, oversized date ranges, client payment modes and unsupported cursors are rejected before SQL', async () => {
  const db = database();
  for (const value of [
    { ...request, to: '2026-11-24' },
    { ...request, mode: 'development' },
    { ...request, kind: 'export', cursor: 'page2' },
    { ...request, kind: 'export', snapshotAt: '2026-10-24T10:00:00.000Z' },
  ])
    await assert.rejects(handleSalesReport(db, actor, value), ReportError);
  await assert.rejects(
    handleSalesReport(db, '', request),
    (cause: unknown) => cause instanceof ReportError && cause.status === 403,
  );
  assert.equal(db.calls.length, 0);
});

test('partial, duplicate, other-branch, invalid-clock and oversized snapshots never return financial totals', async () => {
  for (const extra of [
    { complete: false },
    { orders: [order, order] },
    { mode: 'unknown' },
    { snapshotAt: 'invalid' },
    { orders: [{ ...order, branchId: 'other' }] },
    { orders: [{ ...order, createdAt: 'invalid' }] },
    { orders: [{ ...order, subtotal: -1 }] },
    { orders: Array.from({ length: 10001 }, () => order) },
  ])
    await assert.rejects(handleSalesReport(database(extra), actor, request), ReportError);
});

test('report errors are bounded and redacted; database authorization and size failures retain actionable status', async () => {
  for (const [message, status] of [
    ['report_owner_required', 403],
    ['report_branch_not_found', 404],
    ['report_too_large', 413],
    ['postgres password=PRIVATE_SECRET backend failure', 503],
  ] as const) {
    await assert.rejects(
      handleSalesReport(database({}, { message }), actor, request),
      (cause: unknown) =>
        cause instanceof ReportError &&
        cause.status === status &&
        !cause.message.includes('PRIVATE_SECRET'),
    );
  }
});
