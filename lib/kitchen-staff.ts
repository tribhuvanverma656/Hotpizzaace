import { isTestGatewayMode } from './payments/method';
import type { SupabaseClient, User, Session } from '@supabase/supabase-js';
import type { Order } from '../types';
import { kitchenOrders } from './kitchen';

export type KitchenProfile = {
  id: string;
  username: string;
  displayName: string;
  branchId: string;
  branchName: string;
  version: number;
  environment: 'development' | 'production';
  /** Fixed registration deadline; refresh never extends this value. */
  expiresAt: string;
};
export type KitchenStaff = {
  id: string;
  username: string;
  displayName: string;
  branchId: string;
  branchName: string;
  enabled: boolean;
  state: 'provisioning' | 'ready' | 'reset_pending' | 'blocked';
  version: number;
  lastSignInAt: string | null;
  createdAt: string;
};
export type KitchenTicket = {
  id: string;
  number: string;
  branchId: string;
  branchName: string;
  createdAt: string;
  version: number;
  status: 'confirmed' | 'preparing' | 'ready';
  fulfillment: 'delivery' | 'pickup' | 'dine_in';
  channel: 'website' | 'counter';
  items: { name: string; quantity: number; options: string[]; notes: string }[];
  payLater: boolean;
  testOrder: boolean;
  /** Ready-today entries only: when the kitchen marked it ready, if recorded. */
  readyAt?: string;
};
export type KitchenAuthResult = {
  session: { accessToken: string; refreshToken: string; expiresAt: string };
  profile: KitchenProfile;
};
export type KitchenStaffCreate = {
  displayName: string;
  username: string;
  branchId: string;
  password: string;
  confirmPassword: string;
  ownerPassword: string;
};
export type KitchenStaffMutation = {
  expectedVersion: number;
  action: 'update' | 'disable' | 'enable' | 'reset-password';
  displayName?: string;
  username?: string;
  branchId?: string;
  password?: string;
  confirmPassword?: string;
  ownerPassword?: string;
};

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const RESERVED = /^(?:admin|administrator|owner|root|system|support|hotpizzaace|hotpizzaaceadmin)$/;
const headers = {
  'Content-Type': 'application/json',
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};
export class KitchenError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = 'invalid_request',
  ) {
    super(message);
  }
}
const fail = (message: string, status = 400, code = 'invalid_request'): never => {
  throw new KitchenError(message, status, code);
};
const unavailable = () =>
  fail('Kitchen access is temporarily unavailable.', 503, 'kitchen_unavailable');
const denied = () => fail('Please sign in to the kitchen again.', 401, 'auth_required');
const invalidLogin = () =>
  fail('Unable to sign in with those credentials.', 401, 'invalid_credentials');
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail('Send a valid JSON object.');
  return value as Record<string, unknown>;
}
function exact(body: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(body).some((key) => !allowed.includes(key)))
    fail('This request contains unsupported fields.');
}
function text(value: unknown, min: number, max: number): string {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max)
    return fail('Review the staff account details.');
  return value.trim();
}
export function kitchenUsername(value: unknown): string {
  const username = text(value, 3, 32).toLowerCase();
  if (!/^[a-z][a-z0-9._-]{2,31}$/.test(username) || RESERVED.test(username))
    return fail(
      'Choose a unique staff username of 3–32 letters, digits, dots, underscores or hyphens.',
    );
  return username;
}
function passwordPair(body: Record<string, unknown>) {
  if (
    typeof body.password !== 'string' ||
    body.password.length < 12 ||
    body.password.length > 128 ||
    !/\S/.test(body.password)
  )
    fail('Use a staff password of 12–128 characters.');
  if (body.password !== body.confirmPassword) fail('The new passwords must match.');
  if (
    typeof body.ownerPassword !== 'string' ||
    !body.ownerPassword ||
    body.ownerPassword.length > 128
  )
    fail('Enter your current owner password.', 400, 'owner_reauth_required');
}
export function parseKitchenStaffMutation(
  value: unknown,
  create: boolean,
): KitchenStaffCreate | KitchenStaffMutation {
  const body = record(value);
  if (create) {
    exact(body, [
      'displayName',
      'username',
      'branchId',
      'password',
      'confirmPassword',
      'ownerPassword',
    ]);
    passwordPair(body);
    return {
      ...body,
      displayName: text(body.displayName, 2, 80),
      username: kitchenUsername(body.username),
      branchId: text(body.branchId, 1, 100),
    } as KitchenStaffCreate;
  }
  const action = body.action;
  if (
    !['update', 'disable', 'enable', 'reset-password'].includes(String(action)) ||
    !Number.isSafeInteger(body.expectedVersion) ||
    Number(body.expectedVersion) < 1
  )
    return fail('Reload the staff list before saving.', 409, 'version_conflict');
  const fields =
    action === 'update'
      ? ['displayName', 'username', 'branchId']
      : action === 'reset-password'
        ? ['password', 'confirmPassword', 'ownerPassword']
        : [];
  exact(body, ['action', 'expectedVersion', ...fields]);
  if (action === 'reset-password') passwordPair(body);
  if (action === 'update')
    return {
      action,
      expectedVersion: Number(body.expectedVersion),
      displayName: text(body.displayName, 2, 80),
      username: kitchenUsername(body.username),
      branchId: text(body.branchId, 1, 100),
    };
  return body as KitchenStaffMutation;
}

/** Catalogue names/options are bounded plain text. Legacy notes/customer instructions are never copied. */
function preparationText(value: unknown, max: number): string {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    /[\r\n<>@]|https?:|www\.|(?:\d[\s+().-]*){7,}/i.test(value)
  )
    return '';
  return value.trim();
}
export function kitchenTicket(order: Order, profile: KitchenProfile): KitchenTicket {
  if (
    order.branchId !== profile.branchId ||
    !['confirmed', 'preparing', 'ready'].includes(order.status) ||
    !['delivery', 'pickup', 'dine_in'].includes(order.fulfillment) ||
    !Array.isArray(order.items) ||
    order.items.length < 1 ||
    order.items.length > 100 ||
    order.items.some(
      (item) =>
        !Number.isSafeInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > 20 ||
        !Array.isArray(item.options),
    ) ||
    !Number.isSafeInteger(order.version) ||
    Number(order.version) < 1
  )
    return unavailable();
  return {
    id: order.id,
    number: /^HPA-[A-Z0-9-]{1,95}$/.test(order.number)
      ? order.number
      : 'Order reference unavailable',
    branchId: profile.branchId,
    branchName: profile.branchName,
    createdAt: order.createdAt,
    version: Number(order.version),
    status: order.status as KitchenTicket['status'],
    fulfillment: order.fulfillment,
    channel: order.channel === 'counter' ? 'counter' : 'website',
    items: order.items.map((item) => ({
      name: preparationText(item.name, 150) || 'Menu item',
      quantity: item.quantity,
      options: item.options
        .map((value) => preparationText(value, 150))
        .filter(Boolean)
        .slice(0, 30),
      notes: '',
    })),
    payLater:
      order.channel === 'counter' &&
      order.paymentStatus === 'pending' &&
      order.counter?.payLater === true,
    testOrder:
      profile.environment === 'development' ||
      order.environment === 'development' ||
      isTestGatewayMode(order.paymentMode) ||
      order.paymentMode === 'simulation' ||
      order.paymentStatus === 'simulated_paid',
  };
}
/** Orders that passed the kitchen today and may have moved on to hand-over statuses. */
const PASSED_KITCHEN = new Set([
  'ready',
  'out_for_delivery',
  'delivered',
  'picked_up',
  'served',
  'closed',
]);
/** A read-only "Ready today" ticket: same privacy rules as active tickets, never actionable. */
export function kitchenReadyTicket(
  order: Order & { readyAt?: unknown },
  profile: KitchenProfile,
): KitchenTicket | null {
  if (!PASSED_KITCHEN.has(order.status) || order.testVoid) return null;
  try {
    const ticket = kitchenTicket({ ...order, status: 'ready' }, profile);
    const readyAt =
      typeof order.readyAt === 'string' && Number.isFinite(Date.parse(order.readyAt))
        ? new Date(order.readyAt).toISOString()
        : undefined;
    return { ...ticket, ...(readyAt ? { readyAt } : {}) };
  } catch {
    return null;
  }
}
function profileResult(value: unknown): KitchenProfile {
  const v = record(value);
  if (
    typeof v.id !== 'string' ||
    !UUID.test(v.id) ||
    typeof v.username !== 'string' ||
    typeof v.displayName !== 'string' ||
    typeof v.branchId !== 'string' ||
    typeof v.branchName !== 'string' ||
    !Number.isSafeInteger(v.version) ||
    Number(v.version) < 1 ||
    !['development', 'production'].includes(String(v.environment)) ||
    typeof v.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(v.expiresAt))
  )
    return unavailable();
  return {
    id: v.id,
    username: v.username,
    displayName: v.displayName,
    branchId: v.branchId,
    branchName: v.branchName,
    version: Number(v.version),
    environment: v.environment as KitchenProfile['environment'],
    expiresAt: v.expiresAt,
  };
}
function staffResult(value: unknown): KitchenStaff {
  const v = record(value);
  if (
    typeof v.id !== 'string' ||
    !UUID.test(v.id) ||
    typeof v.username !== 'string' ||
    typeof v.displayName !== 'string' ||
    typeof v.branchId !== 'string' ||
    typeof v.branchName !== 'string' ||
    typeof v.enabled !== 'boolean' ||
    !['provisioning', 'ready', 'reset_pending', 'blocked'].includes(String(v.state)) ||
    !Number.isSafeInteger(v.version) ||
    typeof v.createdAt !== 'string'
  )
    return unavailable();
  return {
    id: v.id,
    username: v.username,
    displayName: v.displayName,
    branchId: v.branchId,
    branchName: v.branchName,
    enabled: v.enabled,
    state: v.state as KitchenStaff['state'],
    version: Number(v.version),
    createdAt: v.createdAt,
    lastSignInAt: typeof v.lastSignInAt === 'string' ? v.lastSignInAt : null,
  };
}
function rpcError(error: { message?: string }): never {
  const message = error.message ?? '';
  if (message.includes('kitchen_disabled'))
    return fail('Kitchen staff access is not enabled.', 503, 'kitchen_disabled');
  if (/kitchen_(session|auth|staff_disabled)/.test(message)) return denied();
  if (message.includes('kitchen_operation_pending'))
    return fail(
      'A credential update is pending. Retry password reset after 15 minutes.',
      409,
      'kitchen_operation_pending',
    );
  if (message.includes('kitchen_version_conflict'))
    return fail('This record changed. Refresh before saving.', 409, 'version_conflict');
  if (/kitchen_(owner|forbidden)/.test(message))
    return fail('Only the authorized restaurant owner can manage kitchen staff.', 403, 'forbidden');
  if (/(username|unique)/.test(message))
    return fail(
      'That username is already reserved. Choose another username.',
      409,
      'username_unavailable',
    );
  if (/kitchen_(branch|transition|order|state|invalid)/.test(message))
    return fail(
      'This action is unavailable. Refresh and review the current record.',
      409,
      'invalid_request',
    );
  return unavailable();
}
async function rpc(db: SupabaseClient, name: string, args: Record<string, unknown> = {}) {
  const result = await db.rpc(name, args);
  if (result.error) rpcError(result.error);
  return result.data as unknown;
}
async function boundedBody(request: Request): Promise<Record<string, unknown>> {
  if (
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
  )
    return fail('Send a JSON request.');
  if (Number(request.headers.get('content-length')) > 8192)
    return fail('This request is too large.', 413);
  const reader = request.body?.getReader();
  if (!reader) return fail('Send a valid JSON request.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 8192) {
        await reader.cancel();
        return fail('This request is too large.', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch {
    return fail('Send a valid JSON request.');
  }
}
export function kitchenSessionId(token: string, userId: string, now = Date.now()): string {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return denied();
    const p = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (
      p.sub !== userId ||
      p.role !== 'authenticated' ||
      typeof p.session_id !== 'string' ||
      !UUID.test(p.session_id) ||
      !Number.isSafeInteger(p.exp) ||
      p.exp * 1000 <= now
    )
      return denied();
    return p.session_id;
  } catch {
    return denied();
  }
}
type Dependencies = { db: SupabaseClient; auth: () => SupabaseClient; now?: () => number };

async function authenticated(request: Request, dependencies: Dependencies) {
  const token = request.headers
    .get('authorization')
    ?.match(/^Bearer ([A-Za-z0-9._-]{20,16384})$/)?.[1];
  if (!token) return denied();
  const { data, error } = await dependencies.db.auth.getUser(token);
  if (error || !data.user || !data.user.email_confirmed_at || data.user.is_anonymous !== false)
    return denied();
  return {
    token,
    user: data.user,
    sessionId: kitchenSessionId(token, data.user.id, dependencies.now?.()),
  };
}
async function owner(request: Request, deps: Dependencies) {
  const identity = await authenticated(request, deps);
  if (identity.user.email?.toLowerCase() !== 'hotpizzaace@gmail.com')
    return fail('Only the authorized restaurant owner can manage kitchen staff.', 403, 'forbidden');
  const result = await deps.db
    .from('hpa_admin_memberships')
    .select('role')
    .eq('user_id', identity.user.id)
    .maybeSingle();
  if (result.error) return unavailable();
  if (result.data?.role !== 'owner')
    return fail('Only the authorized restaurant owner can manage kitchen staff.', 403, 'forbidden');
  return identity;
}
async function cleanupSession(db: SupabaseClient, token: string) {
  await db.auth.admin.signOut(token, 'local').catch(() => undefined);
}
async function ownerReauthentication(deps: Dependencies, user: User, password: unknown) {
  const auth = deps.auth();
  const { data, error } = await auth.auth.signInWithPassword({
    email: user.email!,
    password: String(password),
  });
  if (data.session) await cleanupSession(deps.db, data.session.access_token);
  if (
    error ||
    !data.session ||
    data.user?.id !== user.id ||
    data.user.email?.toLowerCase() !== 'hotpizzaace@gmail.com' ||
    !data.user.email_confirmed_at ||
    data.user.is_anonymous !== false
  )
    return fail(
      'Verify your current owner password before creating or resetting staff credentials.',
      403,
      'owner_reauth_required',
    );
}
function authResult(session: Session, profile: KitchenProfile, now: number): KitchenAuthResult {
  const deadline = Date.parse(profile.expiresAt),
    expires = Math.min((session.expires_at ?? 0) * 1000, deadline);
  if (!Number.isFinite(expires) || expires <= now || deadline > now + 12 * 60 * 60 * 1000 + 5000)
    return denied();
  return {
    session: {
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      expiresAt: new Date(expires).toISOString(),
    },
    profile,
  };
}
async function consume(db: SupabaseClient, key: string, limit: number, seconds = 60) {
  const result = await rpc(db, 'hpa_consume_rate_limit', {
    p_key: key,
    p_limit: limit,
    p_window_seconds: seconds,
  });
  if (result !== true)
    return fail('Too many requests. Please wait and try again.', 429, 'rate_limited');
}
async function loginBucket(username: string) {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(username)),
  );
  return [...digest.slice(0, 2)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 3);
}

/** Dedicated server boundary; cookies and same-origin protection belong to the Next gateway. */
export async function handleKitchenRequest(
  request: Request,
  deps: Dependencies,
): Promise<Response> {
  const reply = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), { status, headers });
  try {
    const path = new URL(request.url).pathname.split('/hpa-kitchen/')[1]?.replace(/\/$/, '') ?? '';
    const parts = path.split('/');
    if (
      !['GET', 'POST', 'PATCH'].includes(request.method) ||
      !path ||
      parts.some((part) => !/^[A-Za-z0-9_-]{1,100}$/.test(part))
    )
      return reply({ error: 'This kitchen page does not exist.', code: 'not_found' }, 404);
    if (request.method === 'GET' && path === 'session' && !request.headers.has('authorization'))
      await rpc(deps.db, 'hpa_kitchen_require_enabled');
    const body = ['POST', 'PATCH'].includes(request.method) ? await boundedBody(request) : {};
    if (request.method === 'POST' && path === 'auth/login') {
      exact(body, ['username', 'password']);
      await consume(deps.db, 'kitchen:login:global', 120);
      let username = 'invalid';
      try {
        username = kitchenUsername(body.username);
      } catch {
        /* Same credential failure for invalid/unknown names. */
      }
      await consume(deps.db, `kitchen:login:bucket:${await loginBucket(username)}`, 8, 300);
      if (
        typeof body.password !== 'string' ||
        body.password.length < 1 ||
        body.password.length > 128
      )
        return invalidLogin();
      const found = await rpc(deps.db, 'hpa_kitchen_lookup', { p_username: username });
      const staff = found ? record(found) : null;
      const alias =
        typeof staff?.authAlias === 'string'
          ? staff.authAlias
          : '00000000000000000000000000000000@staff.hotpizzaace.com';
      const { data, error } = await deps
        .auth()
        .auth.signInWithPassword({ email: alias, password: body.password });
      if (error || !staff || !data.session || !data.user || data.user.id !== staff.id) {
        if (data.session) await cleanupSession(deps.db, data.session.access_token);
        return invalidLogin();
      }
      const sessionId = kitchenSessionId(data.session.access_token, data.user.id, deps.now?.());
      try {
        const profile = profileResult(
          await rpc(deps.db, 'hpa_kitchen_register', {
            p_user_id: data.user.id,
            p_session_id: sessionId,
            p_expected_version: staff.version,
          }),
        );
        return reply(authResult(data.session, profile, deps.now?.() ?? Date.now()));
      } catch (error) {
        await cleanupSession(deps.db, data.session.access_token);
        throw error;
      }
    }
    if (request.method === 'POST' && path === 'auth/refresh') {
      exact(body, ['refreshToken']);
      await consume(deps.db, 'kitchen:refresh:global', 300);
      if (
        typeof body.refreshToken !== 'string' ||
        !/^[A-Za-z0-9._~-]{10,4096}$/.test(body.refreshToken)
      )
        return denied();
      const { data, error } = await deps
        .auth()
        .auth.refreshSession({ refresh_token: body.refreshToken });
      if (error || !data.session || !data.user) return denied();
      try {
        const profile = profileResult(
          await rpc(deps.db, 'hpa_kitchen_session', {
            p_user_id: data.user.id,
            p_session_id: kitchenSessionId(data.session.access_token, data.user.id, deps.now?.()),
          }),
        );
        return reply(authResult(data.session, profile, deps.now?.() ?? Date.now()));
      } catch (error) {
        await cleanupSession(deps.db, data.session.access_token);
        throw error;
      }
    }
    if (
      path === 'admin/staff' ||
      (parts.length === 3 && parts[0] === 'admin' && parts[1] === 'staff')
    ) {
      const identity = await owner(request, deps);
      await consume(deps.db, `kitchen:manage:${identity.user.id}`, 20);
      if (request.method === 'GET' && parts.length === 2) {
        const list = record(
          await rpc(deps.db, 'hpa_kitchen_staff_list', {
            p_actor_id: identity.user.id,
            p_actor_session_id: identity.sessionId,
          }),
        );
        if (!Array.isArray(list.staff) || !Array.isArray(list.branches)) return unavailable();
        return reply({
          staff: list.staff.map(staffResult),
          branches: list.branches.map((value) => {
            const branch = record(value);
            return { id: text(branch.id, 1, 100), name: text(branch.name, 1, 150) };
          }),
        });
      }
      const create = request.method === 'POST' && parts.length === 2;
      if (!create && !(request.method === 'PATCH' && parts.length === 3 && UUID.test(parts[2])))
        return reply({ error: 'This kitchen page does not exist.', code: 'not_found' }, 404);
      const parsed = parseKitchenStaffMutation(body, create);
      if (create || ('action' in parsed && parsed.action === 'reset-password'))
        await ownerReauthentication(deps, identity.user, parsed.ownerPassword);
      const id = create ? crypto.randomUUID() : parts[2];
      const alias = `${id.replaceAll('-', '')}@staff.hotpizzaace.com`;
      let authCreated = false;
      if (create) {
        const result = await deps.db.auth.admin.createUser({
          id,
          email: alias,
          password: parsed.password,
          email_confirm: true,
          ban_duration: '876000h',
        });
        if (result.error || result.data.user?.id !== id) return unavailable();
        authCreated = true;
      }
      let changed: Record<string, unknown>;
      try {
        changed = record(
          await rpc(deps.db, 'hpa_kitchen_staff_begin', {
            p_actor_id: identity.user.id,
            p_actor_session_id: identity.sessionId,
            p_staff_id: id,
            p_expected_version: create ? null : (parsed as KitchenStaffMutation).expectedVersion,
            p_action: create ? 'create' : (parsed as KitchenStaffMutation).action,
            p_data: create
              ? {
                  username: parsed.username,
                  displayName: parsed.displayName,
                  branchId: parsed.branchId,
                  authAlias: alias,
                }
              : 'action' in parsed && parsed.action === 'update'
                ? {
                    username: parsed.username,
                    displayName: parsed.displayName,
                    branchId: parsed.branchId,
                  }
                : {},
          }),
        );
      } catch (error) {
        if (authCreated) await deps.db.auth.admin.deleteUser(id).catch(() => undefined);
        throw error;
      }
      if (create || ('action' in parsed && parsed.action === 'reset-password')) {
        let success = false;
        try {
          const result = await deps.db.auth.admin.updateUserById(
            id,
            create ? { ban_duration: 'none' } : { password: parsed.password, ban_duration: 'none' },
          );
          success = !result.error;
        } catch {
          /* Registered access was already revoked atomically. */
        }
        const finished = await rpc(deps.db, 'hpa_kitchen_staff_finish', {
          p_actor_id: identity.user.id,
          p_actor_session_id: identity.sessionId,
          p_staff_id: id,
          p_expected_version: changed.version,
          p_success: success,
        });
        if (!success)
          return fail(
            'The credential update could not finish. This staff account remains blocked; retry from the staff list.',
            503,
            create ? 'staff_provisioning_failed' : 'staff_reset_failed',
          );
        return reply({ staff: staffResult(finished) }, create ? 201 : 200);
      }
      return reply({ staff: staffResult(changed) });
    }
    const identity = await authenticated(request, deps);
    const args = { p_user_id: identity.user.id, p_session_id: identity.sessionId };
    if (request.method === 'POST' && path === 'auth/logout') {
      exact(body, []);
      await rpc(deps.db, 'hpa_kitchen_logout', args);
      await cleanupSession(deps.db, identity.token);
      return reply({ success: true });
    }
    // Unknown customer identities cannot allocate unbounded per-user rate records.
    // Queue/transition RPCs repeat this check inside their own transaction.
    const sessionProfile = profileResult(await rpc(deps.db, 'hpa_kitchen_session', args));
    await consume(deps.db, `kitchen:session:${identity.user.id}`, 180);
    if (request.method === 'GET' && path === 'session') return reply({ profile: sessionProfile });
    if (request.method === 'GET' && path === 'queue') {
      const queue = record(await rpc(deps.db, 'hpa_kitchen_queue', args));
      const profile = profileResult(queue.profile);
      if (
        !Array.isArray(queue.orders) ||
        queue.orders.length > 1000 ||
        typeof queue.complete !== 'boolean'
      )
        return unavailable();
      const eligible = kitchenOrders(queue.orders as Order[], profile.branchId).filter(
        (order) => !order.testVoid && !order.refundSyncPending,
      );
      let readyOrders: Order[];
      if (Array.isArray(queue.ready)) {
        readyOrders = (queue.ready as Order[]).slice(0, 100);
      } else {
        // Older queue RPCs can still use the separately migrated, branch-scoped ready feed.
        readyOrders = (await rpc(deps.db, 'hpa_kitchen_ready_today', {
          p_branch_id: profile.branchId,
        })) as Order[];
        if (!Array.isArray(readyOrders)) return unavailable();
        readyOrders = readyOrders.slice(0, 100);
      }
      const ready = readyOrders
        .map((order) => kitchenReadyTicket(order, profile))
        .filter((ticket): ticket is KitchenTicket => ticket !== null);
      return reply({
        profile,
        tickets: eligible.map((order) => kitchenTicket(order, profile)),
        complete: queue.complete,
        ready,
      });
    }
    if (
      request.method === 'PATCH' &&
      parts.length === 2 &&
      parts[0] === 'orders' &&
      UUID.test(parts[1])
    ) {
      exact(body, ['status', 'expectedVersion']);
      if (
        !['preparing', 'ready'].includes(String(body.status)) ||
        !Number.isSafeInteger(body.expectedVersion) ||
        Number(body.expectedVersion) < 1
      )
        return fail('Refresh the queue before changing this ticket.', 409, 'version_conflict');
      await consume(deps.db, `kitchen:transition:${identity.user.id}`, 60);
      const result = record(
        await rpc(deps.db, 'hpa_kitchen_transition', {
          ...args,
          p_order_id: parts[1],
          p_expected_version: body.expectedVersion,
          p_status: body.status,
        }),
      );
      const profile = profileResult(result.profile);
      return reply({ profile, ticket: kitchenTicket(result.order as Order, profile) });
    }
    return reply({ error: 'This kitchen page does not exist.', code: 'not_found' }, 404);
  } catch (error) {
    if (error instanceof KitchenError)
      return reply({ error: error.message, code: error.code }, error.status);
    return reply(
      { error: 'Kitchen access is temporarily unavailable.', code: 'kitchen_unavailable' },
      503,
    );
  }
}
