import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { initialBranches, initialCategories, initialProducts } from '../lib/data';
import { encodeCounterPaymentCursor, parseCounterPaymentCursor } from '../lib/counter';
import { parseCreateOrderRequest } from '../lib/commerce/domain';

const userId = '11111111-1111-4111-8111-111111111111';
const otherUserId = '22222222-2222-4222-8222-222222222222';
const orderId = '33333333-3333-4333-8333-333333333333';
const userToken = 'a'.repeat(64);
const otherToken = 'b'.repeat(64);
const tracking = 'c'.repeat(64);
const nonce = (value: number) => value.toString(16).padStart(64, '0');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

const bundledEdge = build({
  entryPoints: [resolve('supabase/functions/hpa-commerce/index.ts')],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  plugins: [
    {
      name: 'commerce-security-imports',
      setup(plugin) {
        plugin.onResolve({ filter: /^npm:@supabase\/supabase-js@/ }, () => ({
          path: '@supabase/supabase-js',
          external: true,
        }));
        plugin.onResolve(
          {
            filter:
              /^\.\/(domain|addresses|razorpay|payments|phonepe|phonepe-payments|counter|kitchen|reports|table-qr)\.js$/,
          },
          (args) => ({
            path: ['phonepe.js', 'phonepe-payments.js'].includes(args.path.slice(2))
              ? resolve(
                  'lib/payments',
                  args.path.includes('payments') ? 'phonepe-service.ts' : 'phonepe.ts',
                )
              : ['razorpay.js', 'payments.js'].includes(args.path.slice(2))
                ? resolve(
                    'lib/payments',
                    args.path.includes('payments') ? 'service.ts' : 'razorpay.ts',
                  )
                : ['counter.js', 'kitchen.js'].includes(args.path.slice(2))
                  ? resolve('lib', args.path.slice(2).replace('.js', '.ts'))
                  : resolve('lib/commerce', args.path.replace('.js', '.ts')),
          }),
        );
      },
    },
  ],
});

/** Exercise the real public Edge handler/SDK without contacting Auth or a database. */
async function fixture(owner = false) {
  const originalFetch = globalThis.fetch;
  const runtime = globalThis as typeof globalThis & { Deno?: unknown };
  const originalDeno = runtime.Deno;
  let handler: ((request: Request) => Promise<Response>) | undefined;
  const rateKeys: string[] = [];
  const commits: Record<string, unknown>[] = [];
  const createdRows = new Map<string, Record<string, unknown>>();
  const counterRows: Record<string, unknown>[] = [];
  const counterQueries: URL[] = [];
  const customerQueries: URL[] = [];
  const order = {
    id: orderId,
    version: 1,
    status: 'pending',
    customer: { name: 'Private QA name' },
  };
  const row = {
    id: orderId,
    data: order,
    version: 1,
    user_id: userId as string | null,
    guest_session_hash: hash(nonce(0)),
    tracking_token_hash: hash(tracking),
    idempotency_key: 'synthetic-idempotency-key',
  };
  runtime.Deno = {
    env: {
      get: (name: string) =>
        ({
          SUPABASE_URL: 'https://commerce-unit.invalid',
          SUPABASE_SERVICE_ROLE_KEY: 'unit-only-service-key',
        })[name],
      toObject: () => ({}),
    },
    serve: (value: typeof handler) => {
      handler = value;
    },
  };
  globalThis.fetch = async (input, options) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const headers = new Headers(options?.headers);
    if (url.pathname === '/auth/v1/user') {
      const token = headers.get('authorization')?.replace(/^Bearer /, '');
      if (![userToken, otherToken].includes(token || ''))
        return Response.json({ code: 'bad_jwt', message: 'Rejected' }, { status: 401 });
      return Response.json({
        id: token === userToken ? userId : otherUserId,
        email: owner ? 'hotpizzaace@gmail.com' : 'synthetic@unit.invalid',
        email_confirmed_at: '2026-01-01T00:00:00Z',
        is_anonymous: false,
        role: 'authenticated',
        aud: 'authenticated',
        user_metadata: { admin: true }, // Editable claims must never grant membership.
      });
    }
    if (url.pathname === '/rest/v1/hpa_admin_memberships')
      return Response.json(owner ? [{ role: 'owner' }] : []);
    const name = url.pathname.split('/').at(-1);
    const body = JSON.parse(String(options?.body || '{}')) as Record<string, unknown>;
    if (name === 'hpa_consume_rate_limit') {
      rateKeys.push(String(body.p_key));
      return Response.json(true);
    }
    if (name === 'hpa_orders') {
      if (url.searchParams.get('data->>channel') === 'eq.counter') {
        counterQueries.push(url);
        return Response.json(counterRows);
      }
      if (url.searchParams.has('idempotency_scope')) {
        const stored = createdRows.get(url.searchParams.get('idempotency_scope')!);
        return Response.json(stored ? [stored] : []);
      }
      if (url.searchParams.has('id')) return Response.json([row]);
      customerQueries.push(url);
      const ownUser =
        row.user_id !== null && url.searchParams.get('user_id') === `eq.${row.user_id}`;
      const ownGuest =
        row.user_id === null &&
        url.searchParams.get('user_id') === 'is.null' &&
        url.searchParams.get('guest_session_hash') === `eq.${row.guest_session_hash}`;
      return Response.json(ownUser || ownGuest ? [row] : []);
    }
    if (name === 'hpa_catalog_snapshot') {
      const branches = structuredClone(initialBranches);
      branches[0].settings = {
        ...branches[0].settings,
        acceptingOrders: true,
        temporarilyClosed: false,
        paymentMethods: ['cash'],
      };
      return Response.json({
        products: initialProducts,
        categories: initialCategories,
        branches,
        revision: 1,
      });
    }
    if (name === 'hpa_cancel_unpaid_order') {
      commits.push(body);
      return Response.json({ ...row.data, status: 'cancelled', version: row.version + 1 });
    }
    if (name === 'hpa_create_order') {
      commits.push(body);
      createdRows.set(`eq.${body.p_scope}`, {
        ...row,
        id: (body.p_data as Record<string, unknown>).id,
        data: body.p_data,
        request_hash: body.p_request_hash,
        tracking_token_hash: body.p_tracking_token_hash,
      });
      return Response.json({ order: body.p_data, created: true });
    }
    throw new Error(`Unexpected isolated RPC: ${name}`);
  };
  try {
    const bundle = await bundledEdge;
    const edgeModule = { exports: {} };
    new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(
      createRequire(import.meta.url),
      edgeModule,
      edgeModule.exports,
    );
    assert.ok(handler);
    return {
      row,
      rateKeys,
      commits,
      createdRows,
      counterRows,
      counterQueries,
      customerQueries,
      async request(
        method: string,
        path: string[],
        guestSession = nonce(0),
        token?: string,
        access?: string,
        body: unknown = null,
      ) {
        const response = await handler!(
          new Request('https://commerce-unit.invalid/functions/v1/hpa-commerce', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              method,
              path,
              guestSession,
              query: access ? { access } : {},
              body,
            }),
          }),
        );
        return { status: response.status, data: await response.json() };
      },
      close() {
        globalThis.fetch = originalFetch;
        runtime.Deno = originalDeno;
      },
    };
  } catch (error) {
    globalThis.fetch = originalFetch;
    runtime.Deno = originalDeno;
    throw error;
  }
}

test('actual Edge authorization ignores editable roles and denies customer/admin and tracking mutations', async () => {
  const edge = await fixture();
  try {
    const cases: [string, string[], string | undefined, string | undefined, number][] = [
      ['GET', ['admin', 'snapshot'], undefined, undefined, 403],
      ['GET', ['admin', 'snapshot'], userToken, undefined, 403],
      ['POST', ['admin', 'mutate'], userToken, undefined, 403],
      [
        'GET',
        ['admin', 'counter', 'barra', 'awaiting-payment', 'start'],
        undefined,
        undefined,
        403,
      ],
      [
        'GET',
        ['admin', 'counter', 'barra', 'awaiting-payment', 'start'],
        userToken,
        undefined,
        403,
      ],
      ['POST', ['admin', 'orders', orderId, 'payment', 'reconcile'], undefined, undefined, 403],
      ['POST', ['admin', 'orders', orderId, 'payment', 'reconcile'], userToken, undefined, 403],
      ['POST', ['admin', 'orders', orderId, 'payment', 'reconcile'], undefined, tracking, 403],
      ['GET', ['orders', orderId], 'd'.repeat(64), undefined, 401],
      ['GET', ['orders', orderId], undefined, undefined, 404],
      ['GET', ['orders', orderId], otherToken, undefined, 404],
      ['GET', ['orders', orderId], userToken, undefined, 200],
      ['GET', ['orders', orderId], undefined, tracking, 200],
      ['POST', ['orders', orderId, 'payment'], undefined, tracking, 404],
      ['POST', ['orders', orderId, 'payment', 'status'], undefined, tracking, 404],
      ['POST', ['orders', orderId, 'payment', 'status'], otherToken, undefined, 404],
      ['PATCH', ['orders', orderId], userToken, undefined, 403],
    ];
    for (const [method, path, token, access, status] of cases) {
      const result = await edge.request(
        method,
        path,
        nonce(0),
        token,
        access,
        method === 'GET' ? null : { expectedVersion: 1, status: 'confirmed', outcome: 'success' },
      );
      assert.equal(result.status, status, `${method} ${path.join('/')} ${token || 'guest'}`);
      if (status !== 200)
        assert.doesNotMatch(JSON.stringify(result.data), /Private QA name|unit-only-service-key/);
    }
    assert.deepEqual(edge.commits, []);
  } finally {
    edge.close();
  }
});

test('signed-in customers never inherit same-browser guest lists or payment access', async () => {
  const edge = await fixture();
  try {
    edge.row.user_id = null;
    const anonymous = await edge.request('GET', ['orders'], nonce(0));
    assert.equal(anonymous.status, 200);
    assert.equal(anonymous.data.orders.length, 1);
    for (const token of [userToken, otherToken]) {
      const list = await edge.request('GET', ['orders'], nonce(0), token);
      assert.equal(list.status, 200);
      assert.deepEqual(list.data.orders, []);
      const query = edge.customerQueries.at(-1)!;
      assert.equal(
        query.searchParams.get('user_id'),
        `eq.${token === userToken ? userId : otherUserId}`,
      );
      assert.equal(query.searchParams.has('or'), false);
      assert.equal(query.searchParams.has('guest_session_hash'), false);
      for (const [method, path] of [
        ['GET', ['orders', orderId]],
        ['POST', ['orders', orderId, 'payment', 'checkout']],
        ['POST', ['orders', orderId, 'payment', 'verify']],
        ['POST', ['orders', orderId, 'payment', 'status']],
      ] as const) {
        const denied = await edge.request(method, [...path], nonce(0), token);
        assert.equal(denied.status, 404);
        assert.doesNotMatch(JSON.stringify(denied.data), /Private QA name|trackingUrl|accessToken/);
      }
      // A deliberately shared private tracking link remains read-only.
      assert.equal(
        (await edge.request('GET', ['orders', orderId], nonce(0), token, tracking)).status,
        200,
      );
      assert.equal(
        (
          await edge.request(
            'POST',
            ['orders', orderId, 'payment', 'checkout'],
            nonce(0),
            token,
            tracking,
          )
        ).status,
        404,
      );
    }
    assert.equal((await edge.request('GET', ['orders', orderId], nonce(0))).status, 200);
    assert.equal((await edge.request('GET', ['orders', orderId], nonce(1))).status, 404);
    edge.row.user_id = userId;
    assert.equal(
      (await edge.request('GET', ['orders'], nonce(0), userToken)).data.orders.length,
      1,
    );
    assert.deepEqual((await edge.request('GET', ['orders'], nonce(0), otherToken)).data.orders, []);
    assert.deepEqual((await edge.request('GET', ['orders'], nonce(0))).data.orders, []);
    assert.deepEqual(edge.commits, []);
  } finally {
    edge.close();
  }
});

test('owner unpaid list filters by branch and payment state before paging, with a stable seek cursor', async () => {
  const edge = await fixture(true);
  try {
    const createdAt = '2026-10-30T12:30:00.123456+00:00';
    for (let index = 1; index <= 101; index++) {
      const id = `${index.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
      edge.counterRows.push({
        id,
        data: { id, number: `QA-${index}`, status: 'served' },
        version: 1,
        created_at: createdAt,
      });
    }
    const first = await edge.request(
      'GET',
      ['admin', 'counter', 'barra', 'awaiting-payment', 'start'],
      nonce(0),
      userToken,
    );
    assert.equal(first.status, 200);
    assert.equal(first.data.orders.length, 100);
    assert.equal(first.data.hasMore, true);
    assert.deepEqual(parseCounterPaymentCursor(first.data.nextCursor), {
      createdAt,
      id: edge.counterRows[99].id,
    });
    const query = edge.counterQueries[0].searchParams;
    assert.equal(query.get('branch_id'), 'eq.barra');
    assert.equal(query.get('data->>paymentStatus'), 'eq.pending');
    assert.equal(query.get('data->settlement'), 'is.null');
    assert.equal(query.get('data->testVoid'), 'is.null');
    assert.equal(query.get('data->>paymentMode'), 'eq.counter_manual');
    assert.equal(query.get('data'), 'not.cs.{"paymentReviewRequired":true}');
    assert.equal(query.get('status'), 'in.(confirmed,preparing,ready,served)');
    assert.equal(query.get('order'), 'created_at.asc,id.asc');
    assert.equal(query.get('limit'), '101');
    edge.counterRows.splice(0, 100);
    const next = await edge.request(
      'GET',
      ['admin', 'counter', 'barra', 'awaiting-payment', first.data.nextCursor],
      nonce(0),
      userToken,
    );
    assert.equal(next.status, 200);
    assert.equal(next.data.orders.length, 1);
    assert.equal(next.data.nextCursor, null);
    assert.equal(next.data.hasMore, false);
    assert.equal(
      edge.counterQueries[1].searchParams.get('or'),
      `(created_at.gt.${createdAt},and(created_at.eq.${createdAt},id.gt.00000064-1111-4111-8111-111111111111))`,
    );
    for (const cursor of [
      'invalid',
      encodeCounterPaymentCursor('2026-10-30T12:30:00Z,or(id.gt.0)', orderId),
    ]) {
      const result = await edge.request(
        'GET',
        ['admin', 'counter', 'barra', 'awaiting-payment', cursor],
        nonce(0),
        userToken,
      );
      assert.equal(result.status, 400);
      assert.equal(result.data.code, 'invalid_cursor');
    }
    assert.equal(edge.counterQueries.length, 2);
    assert.equal(
      (
        await edge.request(
          'GET',
          ['admin', 'counter', 'unknown', 'awaiting-payment', 'start'],
          nonce(0),
          userToken,
        )
      ).status,
      404,
    );
  } finally {
    edge.close();
  }
});

test('rotating guest nonces uses a bounded rate-key namespace while signed-in users retain their own rate scope', async () => {
  const edge = await fixture();
  try {
    for (let index = 0; index < 4097; index++)
      assert.equal((await edge.request('GET', ['orders'], nonce(index))).status, 200);
    assert.ok(new Set(edge.rateKeys).size <= 4096);
    assert.ok(edge.rateKeys.every((key) => /^orders:guest-bucket:[a-f0-9]{3}$/.test(key)));
    await edge.request('GET', ['orders'], nonce(0), userToken);
    assert.equal(edge.rateKeys.at(-1), `orders:user:${userId}`);
  } finally {
    edge.close();
  }
});

test('website creation rejects missing or stale displayed quotes and preserves an older accepted checkout replay', async () => {
  const edge = await fixture();
  try {
    const product = initialProducts.find((item) => item.slug === 'french-fries')!;
    const legacy = {
      branchId: 'barra',
      items: [{ id: 'qa-fries', productId: product.id, quantity: 1, toppingIds: [], notes: '' }],
      customer: {
        name: 'Synthetic QA',
        phone: '9000000001',
        address: '',
        locality: '',
        postalCode: '',
        landmark: '',
        instructions: '',
      },
      fulfillment: 'pickup',
      paymentMethod: 'cash',
      coupon: '',
      idempotencyKey: 'quote-checkout-key',
    };
    for (const quote of [{}, { expectedTotal: 7900, expectedRoundOffPolicy: 'nearest_rupee' }]) {
      const rejected = await edge.request('POST', ['orders'], nonce(0), undefined, undefined, {
        ...legacy,
        ...quote,
      });
      assert.equal(rejected.status, 409);
      assert.equal(rejected.data.code, 'quote_changed');
      assert.match(rejected.data.error, /Reload this page/);
      assert.equal(edge.commits.length, 0);
    }
    const accepted = await edge.request('POST', ['orders'], nonce(0), undefined, undefined, {
      ...legacy,
      expectedTotal: 8000,
      expectedRoundOffPolicy: 'nearest_rupee',
    });
    assert.equal(accepted.status, 201);
    const row = edge.createdRows.get(`eq.guest:${hash(nonce(0))}`)!;
    row.request_hash = hash(JSON.stringify(parseCreateOrderRequest(legacy)));
    delete (row.data as Record<string, unknown>).roundOffPolicy;
    const original = JSON.stringify(row.data);
    const replay = await edge.request('POST', ['orders'], nonce(0), undefined, undefined, legacy);
    assert.equal(replay.status, 200);
    assert.equal(replay.data.replayed, true);
    assert.equal(replay.data.order.total, 8000);
    assert.equal(edge.commits.length, 1);
    assert.equal(JSON.stringify(row.data), original);
  } finally {
    edge.close();
  }
});

test('rate-bucket collisions grant neither guest order ownership nor checkout idempotency scope', async () => {
  const seen = new Map<string, string>();
  let collision: [string, string] | undefined;
  for (let index = 0; !collision; index++) {
    const candidate = nonce(index);
    const bucket = hash(candidate).slice(0, 3);
    const previous = seen.get(bucket);
    if (previous) collision = [previous, candidate];
    else seen.set(bucket, candidate);
  }
  const [first, second] = collision;
  const edge = await fixture();
  try {
    edge.row.user_id = null;
    edge.row.guest_session_hash = hash(first);
    assert.equal((await edge.request('GET', ['orders', orderId], first)).status, 200);
    assert.equal((await edge.request('GET', ['orders', orderId], second)).status, 404);
    assert.equal(edge.rateKeys[0], edge.rateKeys[1]);
    const product = initialProducts.find((item) => item.slug === 'french-fries')!;
    const body = {
      branchId: 'barra',
      items: [{ id: 'qa-fries', productId: product.id, quantity: 1, toppingIds: [], notes: '' }],
      customer: {
        name: 'Synthetic QA',
        phone: '9000000001',
        address: '',
        locality: '',
        postalCode: '',
        landmark: '',
        instructions: '',
      },
      fulfillment: 'pickup',
      paymentMethod: 'cash',
      coupon: '',
      idempotencyKey: 'same-checkout-key',
      expectedTotal: 8000,
      expectedRoundOffPolicy: 'nearest_rupee',
    };
    assert.equal(
      (await edge.request('POST', ['orders'], first, undefined, undefined, body)).status,
      201,
    );
    assert.equal(
      (await edge.request('POST', ['orders'], second, undefined, undefined, body)).status,
      201,
    );
    assert.deepEqual(
      edge.commits.map((commit) => commit.p_scope),
      [`guest:${hash(first)}`, `guest:${hash(second)}`],
    );
    assert.notEqual(edge.commits[0].p_guest_session_hash, edge.commits[1].p_guest_session_hash);
  } finally {
    edge.close();
  }
});

test('a removed website checkout remains an idempotency tombstone instead of exposing or recreating its order', async () => {
  const edge = await fixture();
  try {
    const product = initialProducts.find((item) => item.slug === 'french-fries')!;
    const body = {
      branchId: 'barra',
      items: [{ id: 'qa-fries', productId: product.id, quantity: 1, toppingIds: [], notes: '' }],
      customer: {
        name: 'Synthetic QA',
        phone: '9000000001',
        address: '',
        locality: '',
        postalCode: '',
        landmark: '',
        instructions: '',
      },
      fulfillment: 'pickup',
      paymentMethod: 'cash',
      coupon: '',
      idempotencyKey: 'removed-checkout-key',
      expectedTotal: 8000,
      expectedRoundOffPolicy: 'nearest_rupee',
    };
    assert.equal(
      (await edge.request('POST', ['orders'], nonce(0), undefined, undefined, body)).status,
      201,
    );
    const stored = edge.createdRows.get(`eq.guest:${hash(nonce(0))}`)!;
    (stored.data as Record<string, unknown>).testVoid = {
      kind: 'no_money_software_test',
      recordedAt: '2026-10-27T01:00:00Z',
      reason: 'Owner confirmed this was a software test',
    };
    const replay = await edge.request('POST', ['orders'], nonce(0), undefined, undefined, body);
    assert.equal(replay.status, 410);
    assert.equal(replay.data.code, 'order_removed');
    assert.equal(edge.commits.length, 1);
    assert.doesNotMatch(JSON.stringify(replay.data), /trackingUrl|accessToken|Synthetic QA/);
  } finally {
    edge.close();
  }
});

test('customer cancellation verifies ownership and eligibility before the atomic commit', async () => {
  const edge = await fixture();
  try {
    Object.assign(edge.row.data, {
      paymentMethod: 'upi',
      paymentStatus: 'pending',
      paymentMode: 'razorpay_live',
    });
    const path = ['orders', orderId, 'cancel'];
    const body = { expectedVersion: 1 };
    for (const [token, access] of [
      [otherToken, undefined],
      [undefined, tracking],
    ] as const) {
      const denied = await edge.request('POST', path, nonce(0), token, access, body);
      assert.equal(denied.status, 404);
    }
    assert.equal(edge.commits.length, 0);
    assert.equal(
      (await edge.request('POST', path, nonce(0), userToken, undefined, { expectedVersion: 0 }))
        .status,
      409,
    );
    assert.equal(
      (await edge.request('POST', path, nonce(0), userToken, undefined, { expectedVersion: 2 }))
        .status,
      409,
    );
    assert.equal(
      (
        await edge.request('POST', path, nonce(0), userToken, undefined, {
          ...body,
          status: 'confirmed',
        })
      ).status,
      400,
    );
    Object.assign(edge.row.data, { paymentStatus: 'paid' });
    assert.equal(
      (await edge.request('POST', path, nonce(0), userToken, undefined, body)).status,
      409,
    );
    Object.assign(edge.row.data, { paymentStatus: 'pending' });
    const result = await edge.request('POST', path, nonce(0), userToken, undefined, body);
    assert.equal(result.status, 200);
    assert.equal(result.data.order.status, 'cancelled');
    assert.deepEqual(edge.commits[0], {
      p_id: orderId,
      p_expected_version: 1,
      p_user_id: userId,
      p_guest_session_hash: hash(`hpa-account-guest:v1:${userId}:${nonce(0)}`),
    });
    edge.row.user_id = null;
    assert.equal(
      (await edge.request('POST', path, nonce(1), undefined, tracking, body)).status,
      404,
    );
    const guest = await edge.request('POST', path, nonce(0), undefined, undefined, body);
    assert.equal(guest.status, 200);
    assert.equal(edge.commits[1].p_user_id, null);
  } finally {
    edge.close();
  }
});
