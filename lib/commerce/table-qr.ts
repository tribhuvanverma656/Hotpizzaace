import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { CartItem, Order, PaymentMode } from '../../types';
import type { CommerceCatalog } from './domain';
import {
  CounterError,
  parseCounterOrderRequest,
  parseCounterSettlementRequest,
  priceCounterOrder,
} from '../counter';
// Each deployable bundle owns its own error constructor; the Edge imports this exact alias.
export const TableQrError = CounterError;

type Database = Pick<SupabaseClient, 'from' | 'rpc'>;
type Envelope = { method: string; path: string[]; body: unknown };
type Context = {
  db: Database;
  guestHash: string;
  rateScope: string;
  catalog: () => Promise<CommerceCatalog>;
  consume: (key: string, limit: number, window: number) => Promise<void>;
  requireOwner: () => { id: string };
  createOnlineOrder?: (input: QrOnlineInput, table: Table, tokenHash: string) => Promise<Reply>;
};
type Table = {
  id: string;
  branch_id: string;
  table_label: string;
  generation: number;
  active: boolean;
  version: number;
  ordering_scope: 'legacy_table' | 'branch';
};
type StoredRequest = {
  id: string;
  table_id: string;
  branch_id: string;
  generation: number;
  status: 'pending' | 'accepted' | 'rejected';
  version: number;
  guest_session_hash: string;
  data: {
    selections: CartItem[];
    customerName?: string;
    customerPhone?: string;
    notes?: string;
    testVoid?: unknown;
  };
};
type Reply = { body: unknown; status?: number };
const uuid = z.string().uuid();
const managerSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('create'),
      branchId: z.string().min(1).max(100),
    })
    .strict(),
  z
    .object({
      action: z.enum(['rotate', 'disable']),
      tableId: uuid,
      expectedVersion: z.number().int().positive(),
    })
    .strict(),
]);
const requestSchema = z
  .object({
    items: z.array(z.unknown()).min(1).max(50),
    customerName: z.string().trim().min(2, 'Enter your name (at least 2 characters).').max(80),
    customerPhone: z
      .string()
      .trim()
      .regex(/^[6-9][0-9]{9}$/, 'Enter a valid 10-digit Indian mobile number.'),
    notes: z.string().trim().max(300).optional(),
    expectedRevision: z.number().int().positive(),
    expectedTotal: z.number().int().min(1).max(100_000_000).optional(),
    expectedRoundOffPolicy: z.literal('nearest_rupee').optional(),
    idempotencyKey: uuid,
  })
  .strict();
const onlineSchema = requestSchema.extend({ paymentMethod: z.enum(['upi', 'card']) }).strict();
export type QrOnlineInput = z.infer<typeof onlineSchema>;

/** QR-only pricing: retains counter totals and billing, but never authors a staff settlement. */
export function priceQrOnlineOrder(
  input: QrOnlineInput,
  snapshot: CommerceCatalog,
  table: Pick<Table, 'id' | 'branch_id' | 'table_label' | 'generation'>,
  orderId: string,
  now: string,
): Order {
  const gateway = snapshot.payments;
  const expectedMode =
    snapshot.mode === 'production' ? 'live' : snapshot.mode === 'development' ? 'test' : null;
  if (
    !gateway?.enabled ||
    !expectedMode ||
    gateway.mode !== expectedMode ||
    !['razorpay', 'phonepe'].includes(gateway.provider)
  )
    throw new CounterError(
      'Online payment is currently unavailable. Choose pay at counter.',
      503,
      'payment_unavailable',
    );
  const parsed = parseCounterOrderRequest({
    branchId: table.branch_id,
    items: input.items,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    tableLabel: table.table_label,
    coupon: '',
    expectedRevision: input.expectedRevision,
    expectedTotal: input.expectedTotal,
    expectedRoundOffPolicy: input.expectedRoundOffPolicy,
    idempotencyKey: input.idempotencyKey,
    payment: null,
    payLaterReason: 'Awaiting verified online payment',
  });
  const quote = priceCounterOrder(
    parsed,
    snapshot,
    orderId,
    now,
    '00000000-0000-4000-8000-000000000000',
    true,
  );
  if (quote.total < 100) throw new CounterError('Online payment requires a total of at least ₹1.');
  const result: Order = {
    ...quote,
    channel: 'website',
    status: 'pending',
    paymentStatus: 'initiated',
    paymentMethod: input.paymentMethod,
    paymentMode: `${gateway.provider}_${gateway.mode}` as PaymentMode,
    qr: { tableId: table.id, tableLabel: table.table_label, generation: table.generation },
    customer: { ...quote.customer, instructions: input.notes ?? '' },
  };
  delete result.counter;
  delete result.settlement;
  return result;
}

const decisionSchema = z
  .object({
    expectedRequestVersion: z.number().int().positive(),
    expectedRevision: z.number().int().positive(),
    expectedTotal: z.number().int().min(1).max(100_000_000).optional(),
    expectedRoundOffPolicy: z.literal('nearest_rupee').optional(),
    idempotencyKey: uuid,
    payment: z.unknown().nullable(),
    payLaterReason: z.string().trim().max(200).optional(),
  })
  .strict();
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new CounterError(parsed.error.issues[0].message);
  return parsed.data;
}
function missing(): never {
  throw new CounterError('This ordering link or request is no longer available.', 404, 'not_found');
}
function requireActiveRequest(data: { testVoid?: unknown }): void {
  if (data.testVoid)
    throw new CounterError(
      'This software test request was removed. Start a new order if you want to order food.',
      410,
      'request_removed',
    );
}
function requireActiveReply(reply: { order?: { testVoid?: unknown } } | null): void {
  if (reply?.order?.testVoid)
    throw new CounterError('This software test order was removed.', 410, 'order_removed');
}
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function databaseError(error: { message?: string; code?: string } | null): void {
  if (!error) return;
  const message = error.message?.toLowerCase() ?? '';
  if (message.includes('idempotency_conflict'))
    throw new CounterError(
      'This request changed. Refresh it before trying again.',
      409,
      'idempotency_conflict',
    );
  if (message.includes('version_conflict'))
    throw new CounterError(
      'This request changed in another session. Refresh it before saving.',
      409,
      'version_conflict',
    );
  if (message.includes('revision_conflict'))
    throw new CounterError(
      'The menu changed. Refresh and review the prices.',
      409,
      'revision_conflict',
    );
  if (
    message.includes('table_not_found') ||
    message.includes('table_request_not_found') ||
    message.includes('table_branch_not_found')
  )
    missing();
  if (message.includes('counter_owner_required'))
    throw new CounterError('Sign in with the restaurant owner account.', 403, 'forbidden');
  if (message.includes('table_request_expired'))
    throw new CounterError(
      'This request expired or its branch QR was replaced. Ask the guest to submit a new request.',
      409,
      'request_expired',
    );
  if (message.includes('table_request_decided'))
    throw new CounterError(
      'This request has already been accepted or declined. Refresh the queue.',
      409,
      'request_decided',
    );
  if (
    message.includes('hpa_branch_ordering_qr_unique') ||
    message.includes('hpa_branch_active_ordering_qr_unique') ||
    message.includes('hpa_table_qr_label_unique')
  )
    throw new CounterError(
      'This branch already has an ordering QR. Reprint or replace its existing QR.',
      409,
      'duplicate_branch_qr',
    );
  if (message.includes('hpa_counter_upi_reference_unique'))
    throw new CounterError(
      'This UPI reference is already recorded. Check the merchant receipt.',
      409,
      'duplicate_upi_reference',
    );
  if (message.includes('counter_unavailable'))
    throw new CounterError(
      'QR ordering is paused for this branch. Please speak to the counter.',
      409,
      'counter_closed',
    );
  if (message.includes('branch_qr_contact_required'))
    throw new CounterError('Enter your name and a valid 10-digit Indian mobile number.');
  if (message.includes('counter_cash_insufficient'))
    throw new CounterError(
      'Cash received must cover the bill total.',
      400,
      'counter_cash_insufficient',
    );
  if (
    message.includes('table_request_mismatch') ||
    message.includes('table_request_invalid') ||
    message.includes('table_invalid')
  )
    throw new CounterError(
      'Review the branch, items and payment before trying again.',
      400,
      'invalid_request',
    );
  throw new CounterError(
    'QR ordering is temporarily unavailable. Try again shortly.',
    503,
    'commerce_unavailable',
  );
}
function managerTable(row: Record<string, unknown>) {
  return {
    id: row.id,
    branchId: row.branch_id,
    tableLabel: row.table_label,
    active: row.active,
    generation: row.generation,
    version: row.version,
    token: row.token,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** A customer can propose items; only the verified owner can turn that request into a kitchen order. */
export async function handleTableQr(envelope: Envelope, context: Context): Promise<Reply | null> {
  const { db, guestHash, rateScope, catalog, consume, requireOwner } = context;
  const path = envelope.path;
  const publicRoute = path[0] === 'table';
  const ownerRoute = path[0] === 'admin' && ['table-qr', 'table-requests'].includes(path[1]);
  if (!publicRoute && !ownerRoute) return null;

  if (publicRoute) {
    const token = path[1];
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) missing();
    const tokenHash = await sha256(token);
    await consume('table:public:global', 3000, 300);
    // Every guest now shares one branch token. Allow its ten-second status
    // polling during a rush without weakening the bounded global/guest limits.
    await consume(`table:public:bucket:${tokenHash.slice(0, 3)}`, 600, 60);
    const tableResult = await db
      .from('hpa_table_qr')
      .select('id,branch_id,table_label,generation,active,version,ordering_scope')
      .eq('token_hash', tokenHash)
      .eq('active', true)
      .eq('ordering_scope', 'branch')
      .maybeSingle();
    databaseError(tableResult.error);
    if (!tableResult.data) missing();
    const table = tableResult.data as Table;
    const requireActiveGuestRequest = async (requestId: string) => {
      // The public document RPC deliberately omits internal correction metadata.
      // Keep this lookup bound to exactly the same branch QR and original guest.
      const stored = await db
        .from('hpa_table_requests')
        .select('id,data')
        .eq('id', requestId)
        .eq('table_id', table.id)
        .eq('generation', table.generation)
        .eq('guest_session_hash', guestHash)
        .maybeSingle();
      databaseError(stored.error);
      if (!stored.data) missing();
      requireActiveRequest(stored.data.data);
    };
    if (envelope.method === 'GET' && path.length === 2) {
      const snapshot = await catalog();
      const branch = snapshot.branches.find((branch) => branch.id === table.branch_id);
      if (!branch) missing();
      return {
        body: {
          table: {
            branchId: branch.id,
            branchName: branch.name,
            tableLabel: table.table_label,
            generation: table.generation,
          },
          catalog: { ...snapshot, branches: [branch] },
        },
      };
    }
    if (envelope.method === 'GET' && path.length === 4 && path[2] === 'requests') {
      const requestId = parse(uuid, path[3]);
      await consume(`table:status:${rateScope}`, 120, 60);
      const found = await db.rpc('hpa_get_table_request', {
        p_request_id: requestId,
        p_table_id: table.id,
        p_generation: table.generation,
        p_guest_hash: guestHash,
      });
      databaseError(found.error);
      if (!found.data) missing();
      await requireActiveGuestRequest(requestId);
      return { body: { request: found.data } };
    }
    if (envelope.method === 'POST' && path.length === 3 && path[2] === 'online-order') {
      await consume('table:online:global', 500, 300);
      await consume(`table:online:${rateScope}`, 10, 60);
      const input = parse(onlineSchema, envelope.body);
      if (!context.createOnlineOrder)
        throw new CounterError('Online payment is unavailable.', 503, 'payment_unavailable');
      return context.createOnlineOrder(input, table, tokenHash);
    }
    if (envelope.method === 'POST' && path.length === 3 && path[2] === 'requests') {
      await consume('table:create:global', 500, 300);
      await consume(`table:create:branch:${table.branch_id}`, 600, 3600);
      await consume(`table:create:${rateScope}`, 10, 1800);
      const input = parse(requestSchema, envelope.body);
      // Reuse the counter's exact strict menu selection validation, without creating an order.
      const counterInput = parseCounterOrderRequest({
        branchId: table.branch_id,
        items: input.items,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        coupon: '',
        expectedRevision: input.expectedRevision,
        expectedTotal: input.expectedTotal,
        expectedRoundOffPolicy: input.expectedRoundOffPolicy,
        idempotencyKey: input.idempotencyKey,
        payment: null,
        payLaterReason: 'QR request awaiting staff payment confirmation',
      });
      const requestHash = await sha256(JSON.stringify({ ...input, items: counterInput.items }));
      const existing = await db
        .from('hpa_table_requests')
        .select('id,request_hash,data')
        .eq('table_id', table.id)
        .eq('generation', table.generation)
        .eq('guest_session_hash', guestHash)
        .eq('idempotency_key', input.idempotencyKey.toLowerCase())
        .maybeSingle();
      databaseError(existing.error);
      if (existing.data) {
        // Do not hide the idempotency tombstone from this lookup: the same key
        // must never recreate an order that was removed after a software test.
        requireActiveRequest(existing.data.data);
        if (existing.data.request_hash !== requestHash)
          throw new CounterError(
            'This order request changed. Start a new request.',
            409,
            'idempotency_conflict',
          );
        const found = await db.rpc('hpa_get_table_request', {
          p_request_id: existing.data.id,
          p_table_id: table.id,
          p_generation: table.generation,
          p_guest_hash: guestHash,
        });
        databaseError(found.error);
        if (!found.data) missing();
        await requireActiveGuestRequest(existing.data.id);
        return { body: { request: found.data, replayed: true } };
      }
      const snapshot = await catalog();
      const requestId = crypto.randomUUID();
      const quote = priceCounterOrder(
        counterInput,
        snapshot,
        requestId,
        new Date().toISOString(),
        '00000000-0000-4000-8000-000000000000',
        true,
      );
      const created = await db.rpc('hpa_create_table_request', {
        p_token_hash: tokenHash,
        p_guest_hash: guestHash,
        p_idempotency_key: input.idempotencyKey,
        p_request_hash: requestHash,
        p_expected_revision: input.expectedRevision,
        p_request_id: requestId,
        p_data: {
          branchId: table.branch_id,
          tableLabel: table.table_label,
          selections: counterInput.items,
          items: quote.items,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          notes: input.notes ?? '',
          subtotal: quote.subtotal,
          tax: quote.tax,
          roundOff: quote.roundOff,
          roundOffPolicy: quote.roundOffPolicy,
          total: quote.total,
        },
      });
      databaseError(created.error);
      if (!created.data?.request)
        throw new CounterError(
          'The order request could not be confirmed. Retry the same request.',
          503,
          'commerce_unavailable',
        );
      await requireActiveGuestRequest(created.data.request.id);
      return { body: created.data, status: created.data.replayed ? 200 : 201 };
    }
    missing();
  }

  const actor = requireOwner();
  await consume(`table:admin:user:${actor.id}`, 180, 60);
  if (path[1] === 'table-qr') {
    if (envelope.method === 'POST' && path.length === 2) {
      const input = parse(managerSchema, envelope.body);
      const managed = await db.rpc('hpa_manage_table_qr', {
        p_actor_id: actor.id,
        p_action: input.action,
        ...(input.action === 'create'
          ? { p_branch_id: input.branchId }
          : { p_table_id: input.tableId, p_expected_version: input.expectedVersion }),
      });
      databaseError(managed.error);
      return { body: { table: managed.data }, status: input.action === 'create' ? 201 : 200 };
    }
    if (envelope.method === 'GET' && path.length === 3) {
      const snapshot = await catalog();
      if (!snapshot.branches.some((branch) => branch.id === path[2])) missing();
      const found = await db
        .from('hpa_table_qr')
        .select('id,branch_id,table_label,active,generation,version,token,created_at,updated_at')
        .eq('branch_id', path[2])
        .eq('ordering_scope', 'branch')
        .order('table_label', { ascending: true })
        .limit(201);
      databaseError(found.error);
      return {
        body: {
          tables: (found.data ?? []).slice(0, 200).map(managerTable),
          hasMore: (found.data?.length ?? 0) > 200,
        },
      };
    }
    missing();
  }
  if (envelope.method === 'GET' && path.length === 3) {
    const found = await db.rpc('hpa_list_table_requests', {
      p_actor_id: actor.id,
      p_branch_id: path[2],
    });
    databaseError(found.error);
    const queue = found.data as { requests: { id: string }[]; hasMore: boolean };
    if (!queue?.requests?.length) return { body: found.data };
    // The queue RPC is owner-authorized and returns at most 200 requests. Read
    // only those IDs here; correction metadata never leaves the server.
    const stored = await db
      .from('hpa_table_requests')
      .select('id,data')
      .eq('branch_id', path[2])
      .in(
        'id',
        queue.requests.map((request) => request.id),
      );
    databaseError(stored.error);
    const activeIds = new Set(
      (stored.data ?? []).filter((request) => !request.data.testVoid).map((request) => request.id),
    );
    return {
      body: { ...queue, requests: queue.requests.filter((request) => activeIds.has(request.id)) },
    };
  }
  if (envelope.method === 'POST' && path.length === 4 && ['accept', 'reject'].includes(path[3])) {
    const requestId = parse(uuid, path[2]);
    const found = await db
      .from('hpa_table_requests')
      .select('id,table_id,branch_id,generation,status,version,guest_session_hash,data')
      .eq('id', requestId)
      .maybeSingle();
    databaseError(found.error);
    if (!found.data) missing();
    const stored = found.data as StoredRequest;
    requireActiveRequest(stored.data);
    if (path[3] === 'reject') {
      const input = parse(
        z.object({ expectedRequestVersion: z.number().int().positive() }).strict(),
        envelope.body,
      );
      const rejected = await db.rpc('hpa_decide_table_request', {
        p_request_id: requestId,
        p_expected_request_version: input.expectedRequestVersion,
        p_actor_id: actor.id,
        p_action: 'reject',
      });
      databaseError(rejected.error);
      return { body: rejected.data };
    }
    const input = parse(decisionSchema, envelope.body);
    // Reuse the strict tender parser: a screenshot or customer assertion never marks UPI paid.
    if (input.payment !== null)
      parseCounterSettlementRequest({
        expectedVersion: 1,
        idempotencyKey: input.idempotencyKey,
        payment: input.payment,
      });
    if (!input.payment && (!input.payLaterReason || input.payLaterReason.length < 3))
      throw new CounterError('Give a reason before sending an unpaid request to the kitchen.');
    if (input.payment && input.payLaterReason)
      throw new CounterError('Choose payment received or the pay-later exception.');
    const requestHash = await sha256(JSON.stringify(input));
    const common = {
      p_request_id: requestId,
      p_expected_request_version: input.expectedRequestVersion,
      p_actor_id: actor.id,
      p_action: 'accept',
      p_idempotency_key: input.idempotencyKey,
      p_request_hash: requestHash,
      p_expected_revision: input.expectedRevision,
      p_payment: input.payment,
    };
    if (stored.status === 'accepted') {
      const replayed = await db.rpc('hpa_decide_table_request', common);
      databaseError(replayed.error);
      requireActiveReply(replayed.data);
      return { body: replayed.data };
    }
    const tableResult = await db
      .from('hpa_table_qr')
      .select('id,branch_id,table_label,generation,active,version,ordering_scope')
      .eq('id', stored.table_id)
      .maybeSingle();
    databaseError(tableResult.error);
    if (!tableResult.data) missing();
    const table = tableResult.data as Table;
    const counterInput = parseCounterOrderRequest({
      branchId: stored.branch_id,
      items: stored.data.selections,
      customerName: stored.data.customerName,
      customerPhone: stored.data.customerPhone,
      // Legacy accepted receipts retain their original table label. New branch
      // requests use their order number/customer details as the collection reference.
      ...(table.ordering_scope === 'legacy_table' ? { tableLabel: table.table_label } : {}),
      coupon: '',
      expectedRevision: input.expectedRevision,
      expectedTotal: input.expectedTotal,
      expectedRoundOffPolicy: input.expectedRoundOffPolicy,
      idempotencyKey: input.idempotencyKey,
      payment: input.payment,
      payLaterReason: input.payLaterReason,
    });
    const snapshot = await catalog();
    const order = priceCounterOrder(
      counterInput,
      snapshot,
      crypto.randomUUID(),
      new Date().toISOString(),
      actor.id,
      true,
    );
    order.counter = { ...order.counter!, entry: 'table_qr', sourceRequestId: stored.id };
    order.customer.instructions = stored.data.notes ?? '';
    const accepted = await db.rpc('hpa_decide_table_request', { ...common, p_order_data: order });
    databaseError(accepted.error);
    requireActiveReply(accepted.data);
    return { body: accepted.data, status: accepted.data?.replayed ? 200 : 201 };
  }
  missing();
}
