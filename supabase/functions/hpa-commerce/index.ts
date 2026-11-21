import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import type { Branch, Category, Order as BaseOrder, Product } from './types.ts';
import {
  changeOrderStatus,
  cancelUnpaidOrder,
  changeSimulatedPayment,
  CommerceError,
  canAccessSharedOrder,
  equalCapability as safeEqual,
  mutateCatalog,
  parseCreateOrderRequest,
  priceSharedOrder,
} from './domain.js';
import {
  SharedAddressError,
  mutateSharedAddressBook,
  parseSharedAddressBook,
  parseSharedAddressMutation,
} from './addresses.js';
import { readRazorpayConfig, RazorpayError } from './razorpay.js';
import { readPhonePeConfig, PhonePeError } from './phonepe.js';
import {
  confirmPhonePeCheckout,
  preparePhonePeCheckout,
  readPhonePeCheckoutStatus,
  reconcilePhonePeOrder,
} from './phonepe-payments.js';
import {
  prepareRazorpayCheckout,
  confirmRazorpayCheckout,
  readRazorpayCheckoutStatus,
  reconcileRazorpayOrderRefunds,
  refundCancelledRazorpayOrder,
} from './payments.js';
import {
  CounterError,
  changeCounterStatus,
  parseCounterOrderRequest,
  parseCounterSettlementRequest,
  priceCounterOrder,
  settleCounterOrder,
  parseCounterPaymentCursor,
  encodeCounterPaymentCursor,
} from './counter.js';
import { kitchenOrders } from './kitchen.js';
import { handleSalesReport, ReportError } from './reports.js';
import { handleTableQr, priceQrOnlineOrder, TableQrError } from './table-qr.js';

type User = {
  id: string;
  email?: string;
  email_confirmed_at?: string;
  is_anonymous?: boolean;
  identities?: { provider?: string }[];
  user_metadata?: Record<string, unknown>;
};
type Catalog = {
  products: Product[];
  categories: Category[];
  branches: Branch[];
  revision: number;
  mode?: string;
  allowSimulatedPayments?: boolean;
  payments?: { provider: 'razorpay' | 'phonepe'; mode: 'test' | 'live'; enabled: boolean };
};
type Order = BaseOrder & { version: number; accessToken?: string; trackingUrl?: string };
type StoredOrder = {
  id: string;
  data: Order;
  version: number;
  user_id: string | null;
  guest_session_hash: string | null;
  tracking_token_hash: string;
  idempotency_key: string;
};
type Envelope = {
  method: string;
  path: string[];
  query: { access?: string };
  body: unknown;
  guestSession: string;
};

const headers = {
  'Content-Type': 'application/json',
  'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};
const columns = 'id,data,version,user_id,guest_session_hash,tracking_token_hash,idempotency_key';
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers });
}
function notFound(): never {
  throw new CommerceError('This order could not be found.', 404, 'not_found');
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new CommerceError('Invalid request.');
  return value as Record<string, unknown>;
}
function version(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw new CommerceError('Reload the order before saving.', 409, 'version_conflict');
  return Number(value);
}
async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function publicOrder(row: StoredOrder): Order {
  // RPC/row metadata never reaches the browser. Payload fields are server-authored at creation.
  requireActiveOrder(row.data);
  return { ...row.data, version: row.version };
}
function requireActiveOrder(order: Order): void {
  if (order.testVoid)
    throw new CommerceError(
      'This software test order was removed and can no longer be used.',
      410,
      'order_removed',
    );
}
function dbError(error: { message?: string; code?: string } | null): void {
  if (!error) return;
  const message = error.message?.toLowerCase() ?? '';
  if (
    message.includes('idempotency') &&
    (message.includes('conflict') || message.includes('different'))
  )
    throw new CommerceError(
      'This checkout changed. Start a new checkout before placing it.',
      409,
      'idempotency_conflict',
    );
  if (message.includes('revision') || message.includes('catalog changed'))
    throw new CommerceError(
      'The menu or restaurant settings changed. Refresh and review your order.',
      409,
      'revision_conflict',
    );
  if (message.includes('version') || message.includes('order changed'))
    throw new CommerceError(
      'This order changed in another session. Reload it before saving.',
      409,
      'version_conflict',
    );
  if (message.includes('forbidden') || message.includes('admin_required'))
    throw new CommerceError('Administrator access is required.', 403, 'forbidden');
  throw new CommerceError(
    'Ordering is temporarily unavailable. Please try again.',
    503,
    'commerce_unavailable',
  );
}
function addressDbError(error: { message?: string; code?: string } | null): void {
  if (!error) return;
  if (error.message?.includes('address_revision_conflict'))
    throw new SharedAddressError(
      'Your saved addresses changed. Refresh and review them before saving.',
      409,
      'address_revision_conflict',
    );
  if (error.message?.includes('address_invalid'))
    throw new SharedAddressError('Check the saved-address details and try again.');
  throw new SharedAddressError(
    'Saved addresses are temporarily unavailable. Please try again.',
    503,
    'address_unavailable',
  );
}
function counterDbError(error: { message?: string; code?: string } | null): void {
  if (!error) return;
  const message = error.message?.toLowerCase() ?? '';
  if (message.includes('counter_owner_required'))
    throw new CommerceError(
      'Sign in with the nominated restaurant owner account.',
      403,
      'forbidden',
    );
  if (message.includes('counter_order_not_found')) notFound();
  if (message.includes('counter_order_removed'))
    throw new CommerceError('This software test order was removed.', 410, 'order_removed');
  if (message.includes('counter_delivery_unavailable'))
    throw new CommerceError(
      'Home delivery is paused for this branch.',
      409,
      'delivery_unavailable',
    );
  if (message.includes('counter_delivery_area_unavailable'))
    throw new CommerceError(
      'This PIN code is outside the branch delivery area.',
      400,
      'delivery_area_unavailable',
    );
  if (message.includes('counter_delivery_fee_changed'))
    throw new CommerceError(
      'Delivery charges changed. Refresh and review the total before collecting payment.',
      409,
      'revision_conflict',
    );
  if (message.includes('counter_delivery_minimum'))
    throw new CommerceError(
      'This order is below the branch minimum delivery total.',
      400,
      'delivery_minimum',
    );
  if (message.includes('counter_unavailable'))
    throw new CommerceError(
      'Counter ordering is paused for this branch.',
      409,
      'counter_unavailable',
    );
  if (message.includes('hpa_counter_upi_reference_unique'))
    throw new CommerceError(
      'This UPI reference is already recorded. Check the merchant receipt before collecting again.',
      409,
      'duplicate_upi_reference',
    );
  if (message.includes('hpa_counter_settlements_actor_id_idempotency_key_key'))
    throw new CommerceError(
      'This payment attempt already belongs to another receipt. Refresh before continuing.',
      409,
      'idempotency_conflict',
    );
  if (message.includes('counter_cash_insufficient'))
    throw new CommerceError(
      'Cash received must cover the bill total.',
      400,
      'counter_cash_insufficient',
    );
  if (message.includes('counter_paid_cancellation_requires_refund'))
    throw new CommerceError(
      'A paid bill needs a recorded refund or adjustment. It cannot be cancelled here.',
      409,
      'refund_required',
    );
  if (message.includes('counter_payment_required'))
    throw new CommerceError(
      'Record the outstanding payment before closing this table.',
      409,
      'payment_required',
    );
  if (message.includes('counter_payment_already_received'))
    throw new CommerceError(
      'Payment has already been recorded. Refresh this bill.',
      409,
      'payment_already_complete',
    );
  if (message.includes('counter_order_not_payable'))
    throw new CommerceError('This bill cannot accept another payment.', 409, 'order_not_payable');
  if (message.includes('counter_status_invalid'))
    throw new CommerceError(
      'This order status change is not allowed. Refresh the kitchen or counter.',
      409,
      'invalid_status_transition',
    );
  if (
    message.includes('counter_payment_invalid') ||
    message.includes('counter_pay_later_reason_required') ||
    message.includes('counter_order_invalid')
  )
    throw new CommerceError(
      'Review the counter items, payment and pay-later details before saving.',
      400,
      'counter_invalid',
    );
  dbError(error);
}
function defaultKey(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const values = JSON.parse(raw);
    return typeof values?.default === 'string' ? values.default : undefined;
  } catch {
    return undefined;
  }
}
function domain<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof CommerceError || error instanceof CounterError) throw error;
    if (error instanceof Error && error.constructor === Error)
      throw new CommerceError(error.message.slice(0, 300));
    throw new CommerceError('Invalid order or menu details. Review them before saving.');
  }
}

Deno.serve(async (request: Request) => {
  try {
    if (request.method !== 'POST')
      return json({ error: 'Method not allowed.', code: 'method_not_allowed' }, 405);
    if (Number(request.headers.get('content-length')) > 70_000)
      throw new CommerceError('This request is too large.', 413);
    // A streaming limit also covers requests without Content-Length.
    const reader = request.body?.getReader();
    if (!reader) throw new CommerceError('Send a valid JSON request.');
    const decoder = new TextDecoder();
    let text = '';
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 70_000) {
          await reader.cancel();
          throw new CommerceError('This request is too large.', 413);
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    let input: Record<string, unknown>;
    try {
      input = object(JSON.parse(text));
    } catch {
      throw new CommerceError('Send a valid JSON request.');
    }
    if (
      !['GET', 'POST', 'PATCH'].includes(String(input.method)) ||
      !Array.isArray(input.path) ||
      input.path.length > 5 ||
      input.path.some((part) => typeof part !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(part)) ||
      typeof input.guestSession !== 'string' ||
      !/^[a-f0-9]{64}$/.test(input.guestSession)
    )
      throw new CommerceError('Invalid request.');
    const envelope = input as unknown as Envelope;
    const query = object(envelope.query ?? {});
    if (
      query.access != null &&
      (typeof query.access !== 'string' || !/^[a-f0-9]{64}$/.test(query.access))
    )
      notFound();
    const path = envelope.path.join('/');
    const secret =
      defaultKey(Deno.env.get('SUPABASE_SECRET_KEYS')) ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    if (!supabaseUrl || !secret)
      throw new CommerceError('Ordering is not configured.', 503, 'commerce_unavailable');
    const db = createClient(supabaseUrl, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    let user: User | null = null;
    const authorization = request.headers.get('authorization');
    if (authorization) {
      if (!/^Bearer [A-Za-z0-9._-]{20,10000}$/.test(authorization))
        throw new CommerceError('Please sign in again.', 401, 'auth_required');
      const { data, error } = await db.auth.getUser(authorization.slice(7));
      if (error || !data.user)
        throw new CommerceError('Please sign in again.', 401, 'auth_required');
      user = data.user;
    }
    let admin = false;
    if (user?.email_confirmed_at) {
      const membership = await db
        .from('hpa_admin_memberships')
        .select('role')
        .eq('user_id', user.id)
        .maybeSingle();
      dbError(membership.error);
      admin = membership.data?.role === 'owner';
    }
    const requireAdmin = () => {
      if (!admin || !user)
        throw new CommerceError(
          'Sign in with an authorized restaurant administrator account.',
          403,
          'forbidden',
        );
    };
    const requireCounterOwner = (): User => {
      requireAdmin();
      // Membership comes from the protected table; verified identity comes from Auth.getUser.
      // Editable user_metadata, a customer's token, or an arbitrary owner email is insufficient.
      if (
        !user?.email_confirmed_at ||
        user.is_anonymous !== false ||
        user.email?.toLowerCase() !== 'hotpizzaace@gmail.com'
      )
        throw new CommerceError(
          'Sign in with the nominated restaurant owner account.',
          403,
          'forbidden',
        );
      return user;
    };
    // QR requests use browser capabilities too. Partition authenticated callers
    // by verified UID so an old cookie cannot carry a different account's QR
    // contact/request history across an upgrade or a missed browser notification.
    const guestHash = await hash(
      user ? `hpa-account-guest:v1:${user.id}:${envelope.guestSession}` : envelope.guestSession,
    );
    const scope = user ? `user:${user.id}` : `guest:${guestHash}`;
    // Guest nonces are caller-controlled on this public endpoint. Keep rate-limit
    // storage bounded to 4,096 guest buckets per operation even when a bot rotates
    // nonces. Full hashes still identify order ownership and checkout idempotency.
    // Buckets limit storage growth; they are not an ingress or bot-abuse defense.
    const rateScope = user ? scope : `guest-bucket:${guestHash.slice(0, 3)}`;
    const consume = async (key: string, limit: number, window: number) => {
      const { data, error } = await db.rpc('hpa_consume_rate_limit', {
        p_key: key,
        p_limit: limit,
        p_window_seconds: window,
      });
      dbError(error);
      if (data !== true)
        throw new CommerceError(
          'Too many requests. Please wait a minute and try again.',
          429,
          'rate_limited',
        );
    };
    const catalog = async (): Promise<Catalog> => {
      const { data, error } = await db.rpc('hpa_catalog_snapshot');
      dbError(error);
      if (
        !data ||
        !Array.isArray(data.products) ||
        !Array.isArray(data.categories) ||
        !Array.isArray(data.branches)
      )
        throw new CommerceError('The menu is temporarily unavailable.', 503);
      const snapshot = data as Catalog;
      // A bad gateway configuration disables online payment without taking the menu offline.
      // PhonePe is the website's online provider when configured; Razorpay stays only for
      // environments that still enable it explicitly.
      try {
        const phonepe = readPhonePeConfig(Deno.env.toObject(), snapshot.mode);
        if (phonepe) snapshot.payments = { provider: 'phonepe', mode: phonepe.mode, enabled: true };
      } catch {
        /* fail closed */
      }
      if (!snapshot.payments)
        try {
          const config = readRazorpayConfig(Deno.env.toObject(), snapshot.mode);
          if (config)
            snapshot.payments = { provider: 'razorpay', mode: config.mode, enabled: true };
        } catch {
          /* fail closed */
        }
      return snapshot;
    };
    const readOrder = async (id: string, allowAccess: boolean): Promise<StoredOrder> => {
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) notFound();
      const { data, error } = await db
        .from('hpa_orders')
        .select(columns)
        .eq('id', id)
        .is('data->testVoid', null)
        .maybeSingle();
      dbError(error);
      if (!data) notFound();
      const row = data as StoredOrder;
      const accessHash = typeof query.access === 'string' ? await hash(query.access) : undefined;
      if (
        !canAccessSharedOrder(
          row,
          { userId: user?.id ?? null, admin, guestHash, accessHash },
          allowAccess,
        )
      )
        notFound();
      requireActiveOrder(row.data);
      return row;
    };
    const responseWithAccess = async (
      order: Order,
      storedHash: string | undefined,
      key: string,
    ) => {
      requireActiveOrder(order);
      const accessToken = await hash(`${envelope.guestSession}:${key}:${order.id}`);
      if (safeEqual(storedHash, await hash(accessToken)))
        return {
          ...order,
          accessToken,
          trackingUrl: `/track-order?order=${encodeURIComponent(order.id)}&access=${accessToken}`,
        };
      return order;
    };
    const decoratedOrder = async (row: StoredOrder): Promise<Order> => {
      const order = publicOrder(row);
      const derived = await hash(`${envelope.guestSession}:${row.idempotency_key}:${order.id}`);
      const token = safeEqual(row.tracking_token_hash, await hash(derived))
        ? derived
        : typeof query.access === 'string' &&
            safeEqual(row.tracking_token_hash, await hash(query.access))
          ? query.access
          : null;
      return token
        ? {
            ...order,
            accessToken: token,
            trackingUrl: `/track-order?order=${encodeURIComponent(order.id)}&access=${token}`,
          }
        : order;
    };

    if (envelope.method === 'POST' && path === 'admin/reports') {
      const actor = requireCounterOwner();
      await consume(`reports:user:${actor.id}`, 30, 60);
      return json(await handleSalesReport(db, actor.id, envelope.body));
    }
    const qrReply = await handleTableQr(envelope, {
      db,
      guestHash,
      rateScope,
      catalog,
      consume,
      requireOwner: requireCounterOwner,
      createOnlineOrder: async (input, table, tokenHash) => {
        const key = `qr:${table.id}:${input.idempotencyKey}`;
        const requestHash = await hash(
          JSON.stringify({ ...input, tableId: table.id, generation: table.generation }),
        );
        const existing = await db
          .from('hpa_orders')
          .select(`${columns},request_hash`)
          .eq('idempotency_scope', scope)
          .eq('idempotency_key', key)
          .maybeSingle();
        dbError(existing.error);
        if (existing.data) {
          if (existing.data.request_hash !== requestHash)
            throw new CommerceError(
              'This checkout changed. Start a new checkout.',
              409,
              'idempotency_conflict',
            );
          const saved = publicOrder(existing.data as StoredOrder);
          if (saved.testVoid)
            throw new CommerceError('This test order was removed.', 410, 'request_removed');
          return {
            body: {
              order: await responseWithAccess(saved, existing.data.tracking_token_hash, key),
              replayed: true,
            },
          };
        }
        const snapshot = await catalog();
        const order = priceQrOnlineOrder(
          input,
          snapshot,
          table,
          crypto.randomUUID(),
          new Date().toISOString(),
        );
        const accessToken = await hash(`${envelope.guestSession}:${key}:${order.id}`);
        const created = await db.rpc('hpa_create_qr_online_order', {
          p_token_hash: tokenHash,
          p_generation: table.generation,
          p_data: order,
          p_user_id: user?.id ?? null,
          p_guest_session_hash: user ? null : guestHash,
          p_tracking_token_hash: await hash(accessToken),
          p_scope: scope,
          p_idempotency_key: key,
          p_request_hash: requestHash,
          p_expected_catalog_revision: snapshot.revision,
        });
        dbError(created.error);
        if (!created.data?.order)
          throw new CommerceError('Unable to confirm checkout. Retry the same order.', 503);
        return {
          body: {
            order: await responseWithAccess(
              created.data.order,
              created.data.trackingTokenHash,
              key,
            ),
            replayed: !created.data.created,
          },
          status: created.data.created ? 201 : 200,
        };
      },
    });
    if (qrReply) return json(qrReply.body, qrReply.status ?? 200);

    if (envelope.path[0] === 'admin' && envelope.path[1] === 'counter') {
      const actor = requireCounterOwner();
      await consume(
        `counter:${envelope.method.toLowerCase()}:user:${actor.id}`,
        envelope.method === 'GET' ? 180 : 60,
        60,
      );
      if (envelope.method === 'POST' && path === 'admin/counter/orders') {
        await consume('counter:create:global', 500, 300);
        const parsed = domain(() => parseCounterOrderRequest(envelope.body));
        // Dine-in existed before fulfillment was selectable. Preserve its stored
        // hash format so an in-flight older counter request can still retry safely.
        const { fulfillment, ...legacyFields } = parsed;
        const requestHash = await hash(
          JSON.stringify(fulfillment === 'dine_in' ? legacyFields : parsed),
        );
        const existing = await db
          .from('hpa_orders')
          .select(`${columns},request_hash`)
          .eq('idempotency_scope', `counter:user:${actor.id}`)
          .eq('idempotency_key', parsed.idempotencyKey)
          .maybeSingle();
        counterDbError(existing.error);
        if (existing.data) {
          if (!safeEqual(existing.data.request_hash, requestHash))
            throw new CommerceError(
              'This counter order changed. Start a new order attempt.',
              409,
              'idempotency_conflict',
            );
          return json({ order: publicOrder(existing.data as StoredOrder), replayed: true });
        }
        const snapshot = await catalog();
        const order = domain(() =>
          priceCounterOrder(
            parsed,
            snapshot,
            crypto.randomUUID(),
            new Date().toISOString(),
            actor.id,
            true,
          ),
        );
        const committed = await db.rpc('hpa_create_counter_order', {
          p_data: order,
          p_actor_id: actor.id,
          p_idempotency_key: parsed.idempotencyKey,
          p_request_hash: requestHash,
          p_expected_catalog_revision: parsed.expectedRevision,
          p_payment: parsed.payment,
        });
        counterDbError(committed.error);
        if (!committed.data?.order)
          throw new CommerceError(
            'We could not confirm this counter order. Retry the same order attempt.',
            503,
            'commerce_unavailable',
          );
        requireActiveOrder(committed.data.order);
        return json(committed.data, committed.data.replayed ? 200 : 201);
      }
      if (envelope.path[2] === 'orders' && envelope.path.length >= 4) {
        const row = await readOrder(envelope.path[3], false);
        const current = publicOrder(row);
        if (current.channel !== 'counter') notFound();
        if (envelope.method === 'GET' && envelope.path.length === 4)
          return json({ order: current });
        if (
          envelope.method === 'POST' &&
          envelope.path.length === 5 &&
          envelope.path[4] === 'settle'
        ) {
          const parsed = domain(() => parseCounterSettlementRequest(envelope.body));
          // SQL checks the idempotency receipt before the version. A successful retry remains
          // successful even after the table was served/closed in another tab.
          if (parsed.expectedVersion === current.version && current.paymentStatus !== 'paid')
            domain(() =>
              settleCounterOrder(current, parsed.payment, actor.id, new Date().toISOString()),
            );
          const committed = await db.rpc('hpa_settle_counter_order', {
            p_id: row.id,
            p_expected_version: parsed.expectedVersion,
            p_actor_id: actor.id,
            p_idempotency_key: parsed.idempotencyKey,
            p_request_hash: await hash(JSON.stringify(parsed)),
            p_payment: parsed.payment,
          });
          counterDbError(committed.error);
          requireActiveOrder(committed.data.order);
          return json(committed.data);
        }
        if (
          envelope.method === 'POST' &&
          envelope.path.length === 5 &&
          envelope.path[4] === 'status'
        ) {
          const input = object(envelope.body);
          if (Object.keys(input).some((key) => !['expectedVersion', 'status'].includes(key)))
            throw new CommerceError('Send only the order status and current version.');
          const expectedVersion = version(input.expectedVersion);
          if (expectedVersion !== current.version)
            throw new CommerceError(
              'This order changed. Reload it before saving.',
              409,
              'version_conflict',
            );
          domain(() => changeCounterStatus(current, input.status));
          const changed = await db.rpc('hpa_update_counter_status', {
            p_id: row.id,
            p_expected_version: expectedVersion,
            p_actor_id: actor.id,
            p_status: input.status,
          });
          counterDbError(changed.error);
          requireActiveOrder(changed.data);
          return json({ order: changed.data });
        }
      }
      if (
        envelope.method === 'GET' &&
        envelope.path.length === 5 &&
        envelope.path[3] === 'awaiting-payment'
      ) {
        const branchId = envelope.path[2];
        const snapshot = await catalog();
        if (!snapshot.branches.some((branch) => branch.id === branchId)) notFound();
        const cursor = domain(() => parseCounterPaymentCursor(envelope.path[4]));
        let query = db
          .from('hpa_orders')
          .select(`${columns},created_at`)
          .eq('branch_id', branchId)
          .is('data->testVoid', null)
          .eq('data->>channel', 'counter')
          .eq('data->>paymentMode', 'counter_manual')
          .eq('data->>paymentStatus', 'pending')
          .is('data->settlement', null)
          .not('data', 'cs', '{"paymentReviewRequired":true}')
          .in('status', ['confirmed', 'preparing', 'ready', 'served'])
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .limit(101);
        // Cursor fields are strictly validated before interpolation into PostgREST syntax.
        if (cursor)
          query = query.or(
            `created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.gt.${cursor.id})`,
          );
        const result = await query;
        counterDbError(result.error);
        const rows = (result.data ?? []).slice(0, 100);
        const hasMore = (result.data?.length ?? 0) > 100;
        const last = rows.at(-1);
        return json({
          orders: rows.map((row) => publicOrder(row as StoredOrder)),
          hasMore,
          nextCursor: hasMore && last ? encodeCounterPaymentCursor(last.created_at, last.id) : null,
        });
      }
      if (envelope.method === 'GET' && envelope.path.length === 3) {
        const branchId = envelope.path[2];
        const snapshot = await catalog();
        if (!snapshot.branches.some((branch) => branch.id === branchId)) notFound();
        // Open bills are queried independently so recent closed bills cannot hide a table
        // awaiting payment. Limits are explicit; the UI must show hasMore when reached.
        const [open, recent] = await Promise.all([
          db
            .from('hpa_orders')
            .select(columns)
            .eq('branch_id', branchId)
            .is('data->testVoid', null)
            .eq('data->>channel', 'counter')
            .in('status', ['confirmed', 'preparing', 'ready', 'served', 'out_for_delivery'])
            .order('created_at', { ascending: false })
            .limit(501),
          db
            .from('hpa_orders')
            .select(columns)
            .eq('branch_id', branchId)
            .is('data->testVoid', null)
            .eq('data->>channel', 'counter')
            .in('status', ['closed', 'cancelled', 'delivered'])
            .order('created_at', { ascending: false })
            .limit(51),
        ]);
        counterDbError(open.error);
        counterDbError(recent.error);
        return json({
          orders: [...(open.data ?? []).slice(0, 500), ...(recent.data ?? []).slice(0, 50)].map(
            (row) => publicOrder(row as StoredOrder),
          ),
          hasMore: (open.data?.length ?? 0) > 500 || (recent.data?.length ?? 0) > 50,
        });
      }
      return json({ error: 'This counter page could not be found.', code: 'not_found' }, 404);
    }
    if (
      envelope.method === 'GET' &&
      envelope.path.length === 3 &&
      envelope.path[0] === 'admin' &&
      envelope.path[1] === 'kitchen'
    ) {
      const actor = requireCounterOwner();
      await consume(`kitchen:user:${actor.id}`, 180, 60);
      const branchId = envelope.path[2];
      const snapshot = await catalog();
      if (!snapshot.branches.some((branch) => branch.id === branchId)) notFound();
      // Filter active work in SQL before the limit; old customer receipts cannot evict
      // a ticket from the kitchen merely because the historical snapshot grew.
      const active = await db
        .from('hpa_orders')
        .select(columns)
        .eq('branch_id', branchId)
        .is('data->testVoid', null)
        .in('status', ['confirmed', 'preparing'])
        .order('created_at', { ascending: true })
        .limit(1001);
      counterDbError(active.error);
      // Surface a failed ready feed so staff can retry instead of seeing a false empty list.
      const readyToday = await db.rpc('hpa_kitchen_ready_today', { p_branch_id: branchId });
      dbError(readyToday.error);
      const ready = (
        !readyToday.error && Array.isArray(readyToday.data) ? (readyToday.data as Order[]) : []
      )
        .filter((order) => order.branchId === branchId && !order.testVoid)
        .slice(0, 100);
      return json({
        orders: kitchenOrders(
          (active.data ?? []).slice(0, 1000).map((row) => publicOrder(row as StoredOrder)),
          branchId,
        ),
        hasMore: (active.data?.length ?? 0) > 1000,
        ready,
      });
    }

    if (
      envelope.method === 'POST' &&
      envelope.path.length === 5 &&
      envelope.path[0] === 'admin' &&
      envelope.path[1] === 'orders' &&
      envelope.path[3] === 'payment' &&
      envelope.path[4] === 'reconcile'
    ) {
      const actor = requireCounterOwner();
      await consume(`payment-reconcile:user:${actor.id}`, 10, 60);
      const row = await readOrder(envelope.path[2], false);
      const snapshot = await catalog();
      if (row.data.paymentMode === 'phonepe_test' || row.data.paymentMode === 'phonepe_live') {
        const phonepe = readPhonePeConfig(Deno.env.toObject(), snapshot.mode);
        if (!phonepe || row.data.paymentMode !== phonepe.paymentMode)
          throw new RazorpayError(
            'Online payment reconciliation is unavailable.',
            503,
            'payment_unavailable',
          );
        await reconcilePhonePeOrder(db, phonepe, row.id);
        return json({ order: publicOrder(await readOrder(row.id, false)) });
      }
      const config = readRazorpayConfig(Deno.env.toObject(), snapshot.mode);
      if (!config || row.data.paymentMode !== config.paymentMode)
        throw new RazorpayError(
          'Online payment reconciliation is unavailable.',
          503,
          'payment_unavailable',
        );
      if (['cancelled', 'rejected'].includes(row.data.status) && row.data.paymentStatus === 'paid')
        await refundCancelledRazorpayOrder(db, config, publicOrder(row));
      await reconcileRazorpayOrderRefunds(db, config, row.id);
      const updated = await readOrder(row.id, false);
      return json({ order: publicOrder(updated) });
    }
    if (
      envelope.method === 'POST' &&
      envelope.path.length === 4 &&
      envelope.path[0] === 'orders' &&
      envelope.path[2] === 'payment' &&
      ['checkout', 'verify', 'status'].includes(envelope.path[3])
    ) {
      const row = await readOrder(envelope.path[1], false);
      // Administrator/tracking privileges do not permit paying another customer's order.
      if (!canAccessSharedOrder(row, { userId: user?.id ?? null, admin: false, guestHash }, false))
        notFound();
      await consume(`razorpay:${rateScope}`, 30, 60);
      const snapshot = await catalog();
      if (row.data.paymentMode === 'phonepe_test' || row.data.paymentMode === 'phonepe_live') {
        const phonepe = readPhonePeConfig(Deno.env.toObject(), snapshot.mode);
        if (!phonepe || row.data.paymentMode !== phonepe.paymentMode)
          throw new RazorpayError(
            'Online payment is not available for this order.',
            503,
            'payment_unavailable',
          );
        if (envelope.path[3] === 'checkout')
          return json(await preparePhonePeCheckout(db, phonepe, row.id, envelope.body));
        if (envelope.path[3] === 'status')
          return json(await readPhonePeCheckoutStatus(db, phonepe, row.data, envelope.body));
        await confirmPhonePeCheckout(db, phonepe, row.id, envelope.body);
        return json({ order: publicOrder(await readOrder(row.id, false)) });
      }
      const config = readRazorpayConfig(Deno.env.toObject(), snapshot.mode);
      if (!config || row.data.paymentMode !== config.paymentMode)
        throw new RazorpayError(
          'Online payment is not available for this order.',
          503,
          'payment_unavailable',
        );
      if (envelope.path[3] === 'checkout')
        return json(await prepareRazorpayCheckout(db, config, row.id, envelope.body));
      if (envelope.path[3] === 'status')
        return json(await readRazorpayCheckoutStatus(db, config, row.data, envelope.body));
      const order = await confirmRazorpayCheckout(db, config, row.id, envelope.body);
      return json({ order });
    }
    if (envelope.method === 'GET' && path === 'session') {
      const name = user?.user_metadata?.full_name ?? user?.user_metadata?.name;
      return json({
        shared: true,
        user: user
          ? {
              id: user.id,
              email: user.email ?? null,
              name: typeof name === 'string' ? name.slice(0, 120) : null,
            }
          : null,
        admin,
      });
    }
    if (envelope.method === 'GET' && path === 'catalog') {
      const snapshot = await catalog();
      return json(snapshot);
    }
    if (path === 'addresses' && (envelope.method === 'GET' || envelope.method === 'POST')) {
      // A guest nonce, tracking capability or administrator role never owns another account's book.
      if (!user || user.is_anonymous !== false)
        throw new CommerceError('Sign in to manage your saved addresses.', 401, 'auth_required');
      await consume(
        `addresses:${envelope.method.toLowerCase()}:user:${user.id}`,
        envelope.method === 'GET' ? 120 : 30,
        60,
      );
      const mutation =
        envelope.method === 'POST' ? parseSharedAddressMutation(envelope.body) : null;
      const previous = await db.rpc('hpa_get_address_book', { p_user_id: user.id });
      addressDbError(previous.error);
      let book;
      try {
        book = parseSharedAddressBook(previous.data);
      } catch {
        throw new SharedAddressError(
          'Saved addresses are temporarily unavailable. Please try again.',
          503,
          'address_unavailable',
        );
      }
      if (!mutation) return json(book);
      const changed = mutateSharedAddressBook(book, mutation);
      const committed = await db.rpc('hpa_replace_address_book', {
        p_user_id: user.id,
        p_expected_revision: mutation.expectedRevision,
        p_addresses: changed.addresses,
      });
      addressDbError(committed.error);
      try {
        return json(parseSharedAddressBook(committed.data));
      } catch {
        throw new SharedAddressError(
          'Saved addresses are temporarily unavailable. Refresh before trying again.',
          503,
          'address_unavailable',
        );
      }
    }
    if (envelope.method === 'GET' && path === 'orders') {
      await consume(`orders:${rateScope}`, 120, 60);
      let search = db
        .from('hpa_orders')
        .select(columns)
        .is('data->testVoid', null)
        .order('created_at', { ascending: false })
        .limit(200);
      search = user
        ? search.eq('user_id', user.id)
        : search.is('user_id', null).eq('guest_session_hash', guestHash);
      const { data, error } = await search;
      dbError(error);
      return json({
        orders: await Promise.all((data ?? []).map((row) => decoratedOrder(row as StoredOrder))),
      });
    }
    if (envelope.method === 'POST' && path === 'orders') {
      await consume('create:global', 500, 300);
      await consume(`create:${rateScope}`, 10, 60);
      const parsed = domain(() => parseCreateOrderRequest(envelope.body));
      const requestHash = await hash(JSON.stringify(parsed));
      const existing = await db
        .from('hpa_orders')
        .select(`${columns},request_hash`)
        .eq('idempotency_scope', scope)
        .eq('idempotency_key', parsed.idempotencyKey)
        .maybeSingle();
      dbError(existing.error);
      if (existing.data) {
        if (!safeEqual(existing.data.request_hash, requestHash))
          throw new CommerceError(
            'This checkout changed. Start a new checkout.',
            409,
            'idempotency_conflict',
          );
        return json({
          order: await responseWithAccess(
            publicOrder(existing.data as StoredOrder),
            existing.data.tracking_token_hash,
            parsed.idempotencyKey,
          ),
          replayed: true,
        });
      }
      const snapshot = await catalog();
      const order = domain(() =>
        priceSharedOrder(parsed, snapshot, crypto.randomUUID(), new Date().toISOString(), true),
      );
      const accessToken = await hash(
        `${envelope.guestSession}:${parsed.idempotencyKey}:${order.id}`,
      );
      const { data, error } = await db.rpc('hpa_create_order', {
        p_data: order,
        p_user_id: user?.id ?? null,
        p_guest_session_hash: user ? null : guestHash,
        p_tracking_token_hash: await hash(accessToken),
        p_scope: scope,
        p_idempotency_key: parsed.idempotencyKey,
        p_request_hash: requestHash,
        p_expected_catalog_revision: snapshot.revision,
      });
      dbError(error);
      if (!data?.order)
        throw new CommerceError(
          'We could not place the order. Please retry the same checkout.',
          503,
        );
      return json(
        {
          order: await responseWithAccess(
            data.order as Order,
            data.trackingTokenHash,
            parsed.idempotencyKey,
          ),
          replayed: data.created === false,
        },
        data.created ? 201 : 200,
      );
    }
    if (
      envelope.method === 'POST' &&
      envelope.path.length === 3 &&
      envelope.path[0] === 'orders' &&
      envelope.path[2] === 'cancel'
    ) {
      await consume(`mutate:${rateScope}`, 120, 60);
      const input = object(envelope.body);
      if (Object.keys(input).some((key) => key !== 'expectedVersion'))
        throw new CommerceError('Send only the order version.');
      const row = await readOrder(envelope.path[1], false);
      // Tracking links and staff access do not grant customer mutation rights.
      if (!canAccessSharedOrder(row, { userId: user?.id ?? null, admin: false, guestHash }, false))
        throw new CommerceError('This order could not be found.', 404, 'not_found');
      const current = publicOrder(row);
      const expectedVersion = version(input.expectedVersion);
      if (expectedVersion !== current.version)
        throw new CommerceError(
          'This order changed. Refresh it before cancelling.',
          409,
          'version_conflict',
        );
      domain(() => cancelUnpaidOrder(current));
      const { data, error } = await db.rpc('hpa_cancel_unpaid_order', {
        p_id: row.id,
        p_expected_version: expectedVersion,
        p_user_id: user?.id ?? null,
        p_guest_session_hash: guestHash,
      });
      if (error?.message?.includes('order_not_cancellable'))
        throw new CommerceError(
          'This order can no longer be cancelled. Refresh it or contact the restaurant.',
          409,
          'order_not_cancellable',
        );
      dbError(error);
      requireActiveOrder(data);
      return json({ order: data });
    }
    if (envelope.method === 'GET' && envelope.path.length === 2 && envelope.path[0] === 'orders') {
      await consume(`track:${rateScope}`, 180, 60);
      return json({ order: await decoratedOrder(await readOrder(envelope.path[1], true)) });
    }
    if (
      (envelope.method === 'PATCH' &&
        envelope.path.length === 2 &&
        envelope.path[0] === 'orders') ||
      (envelope.method === 'POST' &&
        envelope.path.length === 3 &&
        envelope.path[0] === 'orders' &&
        envelope.path[2] === 'payment')
    ) {
      const statusChange = envelope.method === 'PATCH';
      if (statusChange) requireAdmin();
      await consume(`mutate:${rateScope}`, 120, 60);
      const input = object(envelope.body);
      const row = await readOrder(envelope.path[1], false);
      const current = publicOrder(row);
      const expectedVersion = version(
        input.expectedVersion ?? (!statusChange ? current.version : undefined),
      );
      if (expectedVersion !== current.version)
        throw new CommerceError(
          'This order changed. Reload it before saving.',
          409,
          'version_conflict',
        );
      let changed: Order;
      if (statusChange && current.channel === 'counter') {
        const actor = requireCounterOwner();
        domain(() => changeCounterStatus(current, input.status));
        const committed = await db.rpc('hpa_update_counter_status', {
          p_id: row.id,
          p_expected_version: expectedVersion,
          p_actor_id: actor.id,
          p_status: input.status,
        });
        counterDbError(committed.error);
        requireActiveOrder(committed.data);
        return json({ order: committed.data });
      }
      if (current.channel === 'counter')
        throw new CommerceError(
          'Counter payments must be recorded by the restaurant staff.',
          403,
          'forbidden',
        );
      if (statusChange) changed = domain(() => changeOrderStatus(current, input.status));
      else {
        const snapshot = await catalog();
        if (snapshot.mode !== 'development' || snapshot.allowSimulatedPayments !== true)
          throw new CommerceError('Demo payments are not enabled.', 403, 'forbidden');
        changed = domain(() => changeSimulatedPayment(current, input.outcome, admin));
      }
      if (changed.version === current.version) return json({ order: current });
      const { data, error } = await db.rpc('hpa_update_order', {
        p_id: row.id,
        p_expected_version: expectedVersion,
        p_data: changed,
        p_actor_id: user?.id ?? null,
        p_kind: statusChange
          ? 'status'
          : input.outcome === 'cash_collected'
            ? 'cash_collected'
            : 'payment',
      });
      dbError(error);
      requireActiveOrder(data);
      if (
        statusChange &&
        ['cancelled', 'rejected'].includes(data.status) &&
        data.paymentStatus === 'paid' &&
        ['razorpay_test', 'razorpay_live'].includes(data.paymentMode)
      ) {
        const config = readRazorpayConfig(Deno.env.toObject(), (await catalog()).mode);
        if (!config || config.paymentMode !== data.paymentMode)
          throw new RazorpayError(
            'Order cancelled; refund configuration needs attention. Use payment reconciliation to retry.',
            503,
            'refund_pending',
          );
        try {
          await refundCancelledRazorpayOrder(db, config, data);
        } catch {
          throw new RazorpayError(
            'Order cancelled, but refund is not confirmed. Refresh and use Reconcile payment to retry safely.',
            503,
            'refund_pending',
          );
        }
        return json({ order: publicOrder(await readOrder(row.id, false)) });
      }
      return json({ order: data });
    }
    if (envelope.method === 'GET' && path === 'admin/snapshot') {
      requireAdmin();
      const snapshot = await catalog();
      const { data, error } = await db
        .from('hpa_orders')
        .select(columns)
        .is('data->testVoid', null)
        .order('created_at', { ascending: false })
        .limit(1000);
      dbError(error);
      return json({
        ...snapshot,
        orders: (data ?? []).map((row) => publicOrder(row as StoredOrder)),
      });
    }
    if (envelope.method === 'POST' && path === 'admin/mutate') {
      requireAdmin();
      await consume(`admin:${scope}`, 120, 60);
      const input = object(envelope.body);
      if (!Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 1)
        throw new CommerceError(
          'Reload the latest restaurant data before saving.',
          409,
          'revision_conflict',
        );
      const previous = await catalog();
      if (previous.revision !== input.expectedRevision)
        throw new CommerceError(
          'Restaurant data changed. Reload it before saving.',
          409,
          'revision_conflict',
        );
      const changed = domain(() => mutateCatalog(previous, input.action, input.args));
      const { data, error } = await db.rpc('hpa_replace_catalog', {
        p_expected_revision: input.expectedRevision,
        p_products: changed.products,
        p_categories: changed.categories,
        p_branches: changed.branches,
      });
      dbError(error);
      return json(data);
    }
    return json({ error: 'This page could not be found.', code: 'not_found' }, 404);
  } catch (error) {
    if (error instanceof TableQrError)
      return json({ error: error.message, code: error.code }, error.status);
    if (error instanceof ReportError)
      return json({ error: error.message, code: error.code }, error.status);
    if (error instanceof CounterError)
      return json({ error: error.message, code: error.code }, error.status);
    if (error instanceof RazorpayError || error instanceof PhonePeError)
      return json({ error: error.message, code: error.code }, error.status);
    if (error instanceof SharedAddressError)
      return json({ error: error.message, code: error.code }, error.status);
    if (error instanceof CommerceError)
      return json({ error: error.message, code: error.code }, error.status);
    return json(
      {
        error: 'Ordering is temporarily unavailable. Please try again.',
        code: 'commerce_unavailable',
      },
      503,
    );
  }
});
