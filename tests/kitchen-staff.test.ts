import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  handleKitchenRequest,
  kitchenTicket,
  kitchenUsername,
  parseKitchenStaffMutation,
  type KitchenProfile,
} from '../lib/kitchen-staff';
import { initialOrders } from '../lib/data';
import type { Order } from '../types';

const now = Date.parse('2026-10-30T16:00:00Z');
const uid = '11111111-1111-4111-8111-111111111111',
  sid = '22222222-2222-4222-8222-222222222222';
const ownerId = '33333333-3333-4333-8333-333333333333';
const ticketId = '44444444-4444-4444-8444-444444444444';
const alias = `${uid.replaceAll('-', '')}@staff.hotpizzaace.com`;
const token = (id = uid) =>
  `eyJhbGciOiJFUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: id, role: 'authenticated', session_id: sid, exp: now / 1000 + 3600 })).toString('base64url')}.verified-by-auth-fixture`;
const profile: KitchenProfile = {
  id: uid,
  username: 'chef-one',
  displayName: 'Chef',
  branchId: 'barra',
  branchName: 'Barra',
  version: 2,
  environment: 'development',
  expiresAt: new Date(now + 12 * 3600_000).toISOString(),
};
const order = {
  ...initialOrders[0],
  id: ticketId,
  number: 'HPA-301026-0001',
  branchId: 'barra',
  branchName: 'Barra',
  version: 1,
  status: 'confirmed',
  paymentMethod: 'card',
  paymentMode: 'razorpay_test',
  paymentStatus: 'paid',
  customer: {
    ...initialOrders[0].customer,
    name: 'PRIVATE CUSTOMER',
    phone: '9876543210',
    address: 'PRIVATE ADDRESS',
    instructions: 'PRIVATE INSTRUCTIONS',
  },
  accessToken: 'PRIVATE_TRACKING_TOKEN',
  items: [
    {
      ...initialOrders[0].items[0],
      id: 'line',
      productId: 'pizza',
      name: 'Paneer pizza',
      unitPrice: 10000,
      quantity: 1,
      options: ['Small', 'Thin crust', 'Call 9876543210'],
      notes: 'PRIVATE ITEM NOTES',
    },
  ],
} as Order;
type RpcResult = { data: unknown; error: { message: string } | null };
function fixture(
  options: {
    owner?: boolean;
    verifyFails?: boolean;
    rpc?: (name: string, args: Record<string, unknown>) => RpcResult | undefined;
    failAuthUpdate?: boolean;
    failLogin?: boolean;
    failReauth?: boolean;
  } = {},
) {
  const user = {
    id: options.owner ? ownerId : uid,
    email: options.owner ? 'hotpizzaace@gmail.com' : alias,
    email_confirmed_at: '2026-10-30T00:00:00Z',
    is_anonymous: false,
    user_metadata: { role: 'owner', branchId: 'forged' },
  };
  const calls: { name: string; value: unknown }[] = [];
  const session = {
    access_token: token(user.id),
    refresh_token: 'PRIVATE_REFRESH_TOKEN',
    expires_at: now / 1000 + 3600,
  };
  const staff = {
    ...profile,
    enabled: true,
    state: 'ready',
    lastSignInAt: null,
    createdAt: '2026-10-30T00:00:00Z',
  };
  const db = {
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      calls.push({ name, value: args });
      const custom = options.rpc?.(name, args);
      if (custom) return custom;
      const values: Record<string, unknown> = {
        hpa_consume_rate_limit: true,
        hpa_kitchen_require_enabled: null,
        hpa_kitchen_lookup: { id: uid, version: 2, authAlias: alias },
        hpa_kitchen_register: profile,
        hpa_kitchen_session: profile,
        hpa_kitchen_queue: { profile, orders: [order], ready: [], complete: true },
        hpa_kitchen_transition: { profile, order: { ...order, version: 2, status: 'preparing' } },
        hpa_kitchen_staff_list: { staff: [staff], branches: [{ id: 'barra', name: 'Barra' }] },
        hpa_kitchen_staff_begin: { ...staff, version: 3, enabled: false, state: 'reset_pending' },
        hpa_kitchen_staff_finish: { ...staff, version: 4 },
      };
      return { data: values[name], error: null };
    },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { role: 'owner' }, error: null }) }),
      }),
    }),
    auth: {
      getUser: async () => {
        calls.push({ name: 'getUser', value: null });
        return options.verifyFails
          ? { data: { user: null }, error: { message: 'UNTRUSTED_AUTH_DETAIL' } }
          : { data: { user }, error: null };
      },
      admin: {
        signOut: async () => {
          calls.push({ name: 'signOut', value: null });
          return { error: null };
        },
        createUser: async (value: Record<string, unknown>) => {
          calls.push({ name: 'createUser', value });
          return { data: { user: { id: value.id } }, error: null };
        },
        deleteUser: async (value: string) => {
          calls.push({ name: 'deleteUser', value });
          return { error: null };
        },
        updateUserById: async (id: string, value: unknown) => {
          calls.push({ name: 'updateUser', value: { id, value } });
          return { error: options.failAuthUpdate ? { message: 'UNTRUSTED_AUTH_DETAIL' } : null };
        },
      },
    },
  } as unknown as SupabaseClient;
  const auth = () =>
    ({
      auth: {
        signInWithPassword: async (value: { email: string; password: string }) => {
          calls.push({ name: 'signIn', value });
          return options.failLogin || (options.owner && options.failReauth)
            ? { data: { user: null, session: null }, error: { message: 'UNTRUSTED_AUTH_DETAIL' } }
            : { data: { user, session }, error: null };
        },
        refreshSession: async (value: unknown) => {
          calls.push({ name: 'refresh', value });
          return { data: { user, session }, error: null };
        },
      },
    }) as unknown as SupabaseClient;
  const request = (path: string, method = 'GET', body?: unknown, authenticated = true) =>
    new Request(`https://project.example.invalid/functions/v1/hpa-kitchen/${path}`, {
      method,
      headers: {
        ...(authenticated ? { Authorization: `Bearer ${token(user.id)}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { calls, staff, request, deps: { db, auth, now: () => now } };
}
async function result(response: Response, status: number) {
  assert.equal(response.status, status);
  assert.match(response.headers.get('cache-control') ?? '', /private.*no-store/);
  const body = await response.text();
  for (const forbidden of [
    'PRIVATE CUSTOMER',
    '9876543210',
    'PRIVATE ADDRESS',
    'PRIVATE INSTRUCTIONS',
    'PRIVATE ITEM NOTES',
    'PRIVATE_TRACKING_TOKEN',
    'UNTRUSTED_AUTH_DETAIL',
    '@staff.hotpizzaace.com',
  ])
    assert.equal(body.includes(forbidden), false, forbidden);
  return JSON.parse(body);
}
test('staff validation normalizes usernames, reserves owner names and rejects extra privilege fields', () => {
  assert.equal(kitchenUsername('  Chef.One  '), 'chef.one');
  for (const value of ['admin', 'root', 'owner', '12chef', 'a', 'chef@gmail.com'])
    assert.throws(() => kitchenUsername(value));
  const body = {
    username: 'chef-one',
    displayName: 'Chef',
    branchId: 'barra',
    password: 'Offline Chef Password!',
    confirmPassword: 'Offline Chef Password!',
    ownerPassword: 'Offline Owner Password!',
  };
  assert.equal(
    (parseKitchenStaffMutation(body, true) as { username: string }).username,
    'chef-one',
  );
  for (const change of [
    { role: 'owner' },
    { password: ' '.repeat(12), confirmPassword: ' '.repeat(12) },
    { confirmPassword: 'different password' },
  ])
    assert.throws(() => parseKitchenStaffMutation({ ...body, ...change }, true));
});
test('kitchen projection excludes contact, amounts, tracking tokens, free notes and unsafe options', () => {
  const view = kitchenTicket(order, profile);
  assert.equal(view.number, 'HPA-301026-0001');
  assert.deepEqual(view.items[0].options, ['Small', 'Thin crust']);
  assert.equal(view.items[0].notes, '');
  for (const key of [
    'customer',
    'total',
    'subtotal',
    'tax',
    'invoice',
    'settlement',
    'accessToken',
    'paymentStatus',
    'counter',
  ])
    assert.equal(key in view, false);
  assert.throws(() => kitchenTicket({ ...order, branchId: 'another' }, profile));
});
test('server-verified identity is required even with forged owner metadata and a decodable JWT', async () => {
  const f = fixture({ verifyFails: true });
  await result(await handleKitchenRequest(f.request('queue'), f.deps), 401);
  assert.equal(
    f.calls.some((c) => c.name === 'hpa_kitchen_queue'),
    false,
  );
  const chef = fixture();
  await result(await handleKitchenRequest(chef.request('admin/staff'), chef.deps), 403);
  assert.equal(
    chef.calls.some((c) => c.name === 'hpa_kitchen_staff_list'),
    false,
  );
});
test('queue repeats session authorization and returns only preparation DTOs', async () => {
  const f = fixture();
  const value = await result(await handleKitchenRequest(f.request('queue'), f.deps), 200);
  assert.deepEqual(Object.keys(value).sort(), ['complete', 'profile', 'ready', 'tickets']);
  assert.deepEqual(value.ready, []);
  assert.equal(value.tickets.length, 1);
  assert.equal(value.tickets[0].id, ticketId);
  const call = f.calls.find((c) => c.name === 'hpa_kitchen_queue')!;
  assert.deepEqual(call.value, { p_user_id: uid, p_session_id: sid });
});
test('payment review, incomplete refund, voided, wrong-branch and unpaid online rows never leave Edge', async () => {
  const blocked = [
    { ...order, id: 'review', paymentReviewRequired: true },
    { ...order, id: 'incomplete', refundSyncPending: true },
    { ...order, id: 'void', testVoid: {} },
    { ...order, id: 'other', branchId: 'other' },
    { ...order, id: 'unpaid', paymentStatus: 'pending' },
    { ...order, id: 'refund', refund: { amount: 1, status: 'partial', entries: [] } },
  ];
  const f = fixture({
    rpc: (name) =>
      name === 'hpa_kitchen_queue'
        ? { data: { profile, orders: blocked, ready: [], complete: true }, error: null }
        : undefined,
  });
  assert.deepEqual(
    (await result(await handleKitchenRequest(f.request('queue'), f.deps), 200)).tickets,
    [],
  );
});
test('registered session revocation fails queue/refresh and never creates a new registration', async () => {
  const f = fixture({
    rpc: (name) =>
      ['hpa_kitchen_queue', 'hpa_kitchen_session'].includes(name)
        ? { data: null, error: { message: 'kitchen_session_revoked' } }
        : undefined,
  });
  await result(await handleKitchenRequest(f.request('queue'), f.deps), 401);
  await result(
    await handleKitchenRequest(
      f.request('auth/refresh', 'POST', { refreshToken: 'PRIVATE_REFRESH_TOKEN' }, false),
      f.deps,
    ),
    401,
  );
  assert.equal(
    f.calls.some((c) => c.name === 'hpa_kitchen_register'),
    false,
  );
  assert.equal(
    f.calls.some((c) => c.name === 'signOut'),
    true,
  );
});
test('only successful private password verification can register a chef login', async () => {
  const f = fixture();
  const response = await handleKitchenRequest(
    f.request(
      'auth/login',
      'POST',
      { username: 'Chef-One', password: 'Offline Chef Password!' },
      false,
    ),
    f.deps,
  );
  assert.equal(response.status, 200);
  const value = await response.json();
  assert.equal(value.profile.id, uid);
  assert.equal(value.session.accessToken, token());
  assert.deepEqual(f.calls.find((c) => c.name === 'hpa_kitchen_register')?.value, {
    p_user_id: uid,
    p_session_id: sid,
    p_expected_version: 2,
  });
  const failure = fixture({ failLogin: true });
  await result(
    await handleKitchenRequest(
      failure.request('auth/login', 'POST', { username: 'chef-one', password: 'wrong' }, false),
      failure.deps,
    ),
    401,
  );
  assert.equal(
    failure.calls.some((c) => c.name === 'hpa_kitchen_register'),
    false,
  );
});
test('anonymous session check exposes a disabled feature without accepting credentials', async () => {
  const f = fixture({
    rpc: (name) =>
      name === 'hpa_kitchen_require_enabled'
        ? { data: null, error: { message: 'kitchen_disabled' } }
        : undefined,
  });
  assert.equal(
    (
      await result(
        await handleKitchenRequest(f.request('session', 'GET', undefined, false), f.deps),
        503,
      )
    ).code,
    'kitchen_disabled',
  );
  assert.equal(
    f.calls.some((c) => c.name === 'getUser' || c.name === 'signIn'),
    false,
  );
});
test('preparation mutation rejects extra fields and invalid status before its transaction', async () => {
  for (const body of [
    { status: 'served', expectedVersion: 1 },
    { status: 'preparing', expectedVersion: 1, branchId: 'other' },
    { status: 'ready', expectedVersion: 0 },
  ]) {
    const f = fixture();
    const response = await handleKitchenRequest(
      f.request(`orders/${ticketId}`, 'PATCH', body),
      f.deps,
    );
    assert.ok([400, 409].includes(response.status));
    assert.equal(
      f.calls.some((c) => c.name === 'hpa_kitchen_transition'),
      false,
    );
  }
  const f = fixture();
  const value = await result(
    await handleKitchenRequest(
      f.request(`orders/${ticketId}`, 'PATCH', { status: 'preparing', expectedVersion: 1 }),
      f.deps,
    ),
    200,
  );
  assert.equal(value.ticket.status, 'preparing');
  assert.deepEqual(f.calls.find((c) => c.name === 'hpa_kitchen_transition')?.value, {
    p_user_id: uid,
    p_session_id: sid,
    p_order_id: ticketId,
    p_expected_version: 1,
    p_status: 'preparing',
  });
});
test('password reset revokes membership before the Auth update and leaves failure blocked', async () => {
  const f = fixture({ owner: true, failAuthUpdate: true });
  const body = {
    action: 'reset-password',
    expectedVersion: 2,
    password: 'Offline new staff password!',
    confirmPassword: 'Offline new staff password!',
    ownerPassword: 'Offline owner password!',
  };
  const value = await result(
    await handleKitchenRequest(f.request(`admin/staff/${uid}`, 'PATCH', body), f.deps),
    503,
  );
  assert.equal(value.code, 'staff_reset_failed');
  const operations = f.calls.map((c) => c.name);
  assert.ok(operations.indexOf('hpa_kitchen_staff_begin') < operations.indexOf('updateUser'));
  assert.deepEqual(f.calls.find((c) => c.name === 'hpa_kitchen_staff_finish')?.value, {
    p_actor_id: ownerId,
    p_actor_session_id: sid,
    p_staff_id: uid,
    p_expected_version: 3,
    p_success: false,
  });
});
test('failed owner reauthentication does not provision or mutate staff', async () => {
  const f = fixture({ owner: true, failReauth: true });
  await result(
    await handleKitchenRequest(
      f.request('admin/staff', 'POST', {
        username: 'chef-one',
        displayName: 'Chef',
        branchId: 'barra',
        password: 'Offline staff password!',
        confirmPassword: 'Offline staff password!',
        ownerPassword: 'wrong',
      }),
      f.deps,
    ),
    403,
  );
  assert.equal(
    f.calls.some((c) => ['createUser', 'hpa_kitchen_staff_begin', 'updateUser'].includes(c.name)),
    false,
  );
});
test('Ready today returns finished orders as private, read-only tickets for this branch only', async () => {
  const readyAt = '2026-10-30T15:30:00Z';
  const f = fixture({
    rpc: (name) =>
      name === 'hpa_kitchen_queue'
        ? {
            data: {
              profile,
              orders: [],
              complete: true,
              ready: [
                { ...order, id: 'served', status: 'served', readyAt },
                { ...order, id: 'ready', status: 'ready' },
                { ...order, id: 'cancelled', status: 'cancelled' },
                { ...order, id: 'other', status: 'ready', branchId: 'other' },
                { ...order, id: 'void', status: 'ready', testVoid: {} },
              ],
            },
            error: null,
          }
        : undefined,
  });
  const value = await result(await handleKitchenRequest(f.request('queue'), f.deps), 200);
  assert.deepEqual(
    value.ready.map((ticket: { id: string }) => ticket.id),
    ['served', 'ready'],
  );
  assert.equal(value.ready[0].status, 'ready');
  assert.equal(value.ready[0].readyAt, new Date(readyAt).toISOString());
  assert.equal('readyAt' in value.ready[1], false);
  assert.equal(value.ready[0].items[0].notes, '');
  assert.equal(value.tickets.length, 0);
});

test('legacy queue uses the branch-scoped ready RPC and strips private fields', async () => {
  const f = fixture({
    rpc: (name, args) => {
      if (name === 'hpa_kitchen_queue')
        return { data: { profile, orders: [order], complete: true }, error: null };
      if (name === 'hpa_kitchen_ready_today') {
        assert.deepEqual(args, { p_branch_id: profile.branchId });
        return {
          data: [
            { ...order, status: 'ready' },
            { ...order, id: 'other', branchId: 'other', status: 'ready' },
          ],
          error: null,
        };
      }
    },
  });
  const value = await result(await handleKitchenRequest(f.request('queue'), f.deps), 200);
  assert.equal(value.ready.length, 1);
  assert.equal('settlement' in value.ready[0], false);
  assert.equal('accessToken' in value.ready[0], false);
});
test('unavailable legacy ready feed reports an error rather than an empty successful queue', async () => {
  const f = fixture({
    rpc: (name) => {
      if (name === 'hpa_kitchen_queue')
        return { data: { profile, orders: [order], complete: true }, error: null };
      if (name === 'hpa_kitchen_ready_today')
        return { data: null, error: { message: 'missing function' } };
    },
  });
  await result(await handleKitchenRequest(f.request('queue'), f.deps), 503);
});
