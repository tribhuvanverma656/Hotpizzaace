import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { initialBranches, initialCategories, initialProducts } from '../lib/data';
import { parseCounterOrderRequest } from '../lib/counter';

const actorId = '11111111-1111-4111-8111-111111111111';
const orderId = '33333333-3333-4333-8333-333333333333';
const token = 'a'.repeat(64);
const nonce = 'b'.repeat(64);
const bundle = build({
  entryPoints: [resolve('supabase/functions/hpa-commerce/index.ts')],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  plugins: [
    {
      name: 'counter-edge-test-imports',
      setup(plugin) {
        plugin.onResolve({ filter: /^npm:@supabase\/supabase-js@/ }, () => ({
          path: '@supabase/supabase-js',
          external: true,
        }));
        plugin.onResolve(
          {
            filter:
              /^\.\/(domain|addresses|razorpay|payments|phonepe|phonepe-payments|counter|kitchen|reports|analytics|table-qr)\.js$/,
          },
          (args) => {
            const name = args.path.slice(2).replace('.js', '');
            if (name === 'phonepe' || name === 'phonepe-payments')
              return {
                path: resolve(
                  'lib/payments',
                  name === 'phonepe' ? 'phonepe.ts' : 'phonepe-service.ts',
                ),
              };
            if (name === 'razorpay' || name === 'payments')
              return {
                path: resolve('lib/payments', name === 'payments' ? 'service.ts' : 'razorpay.ts'),
              };
            if (['counter', 'kitchen', 'analytics'].includes(name))
              return { path: resolve('lib', `${name}.ts`) };
            return { path: resolve('lib/commerce', `${name}.ts`) };
          },
        );
      },
    },
  ],
});

/** Real Edge handler and Supabase SDK; only Auth and Data API are isolated fixtures. */
async function fixture() {
  const products = structuredClone(initialProducts);
  const originalFetch = globalThis.fetch;
  const runtime = globalThis as typeof globalThis & { Deno?: unknown };
  const originalDeno = runtime.Deno;
  let handler: ((request: Request) => Promise<Response>) | undefined;
  const identity = {
    email: 'hotpizzaace@gmail.com',
    verified: true,
    anonymous: false,
    membership: 'owner' as string | null,
  };
  const queries: URL[] = [];
  const commits: Record<string, unknown>[] = [];
  let idempotencyRow: Record<string, unknown> | null = null;
  const document = {
    id: orderId,
    version: 4,
    createdAt: '2026-10-24T01:00:00Z',
    number: 'QA-COUNTER-1',
    channel: 'counter',
    environment: 'development',
    branchId: 'barra',
    fulfillment: 'dine_in',
    paymentMode: 'counter_manual',
    paymentMethod: 'upi',
    paymentStatus: 'pending',
    status: 'preparing',
    counter: {
      tableLabel: 'QA-1',
      payLater: true,
      payLaterReason: 'Pay after meal',
      createdBy: actorId,
    },
    customer: {
      name: 'Private fictional counter name',
      phone: '',
      address: '',
      locality: '',
      postalCode: '',
      landmark: '',
      instructions: '',
    },
    items: [],
    subtotal: 10000,
    deliveryFee: 0,
    discount: 0,
    total: 10500,
    coupon: '',
    testVoid: undefined as { kind: string; recordedAt: string; reason: string } | undefined,
  };
  const row = {
    id: orderId,
    data: document,
    version: 4,
    user_id: null,
    guest_session_hash: null,
    tracking_token_hash: 'c'.repeat(64),
    idempotency_key: 'unit-only-counter-key',
  };
  runtime.Deno = {
    env: {
      get: (name: string) =>
        ({
          SUPABASE_URL: 'https://counter-unit.invalid',
          SUPABASE_SERVICE_ROLE_KEY: 'unit-only-server-key',
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
    if (url.pathname === '/auth/v1/user')
      return Response.json({
        id: actorId,
        email: identity.email,
        email_confirmed_at: identity.verified ? '2026-01-01T00:00:00Z' : null,
        is_anonymous: identity.anonymous,
        role: 'authenticated',
        aud: 'authenticated',
        user_metadata: { role: 'owner' },
      });
    if (url.pathname.endsWith('/hpa_admin_memberships'))
      return Response.json(identity.membership ? [{ role: identity.membership }] : []);
    if (url.pathname.endsWith('/hpa_consume_rate_limit')) return Response.json(true);
    if (url.pathname.endsWith('/hpa_catalog_snapshot')) {
      const branches = structuredClone(initialBranches);
      branches[0].settings = {
        ...branches[0].settings,
        counterAcceptingOrders: true,
        temporarilyClosed: false,
        acceptingOrders: false,
        pickupEnabled: false,
        paymentMethods: [],
        billing: {
          businessName: 'HOT PIZZA ACE',
          address: 'QA-only address',
          gstin: '09ANCPV1491R1Z3',
          fssaiNumber: '12721045000614',
          stateName: 'Uttar Pradesh',
          stateCode: '09',
          sac: '996331',
          cgstRate: 2.5,
          sgstRate: 2.5,
        },
      };
      return Response.json({
        products,
        categories: initialCategories,
        branches,
        revision: 1,
        mode: 'development',
      });
    }
    if (url.pathname.endsWith('/hpa_kitchen_ready_today')) return Response.json([]);
    if (url.pathname.endsWith('/hpa_orders')) {
      queries.push(url);
      if (url.searchParams.has('idempotency_scope'))
        return Response.json(idempotencyRow ? [idempotencyRow] : []);
      if (url.searchParams.get('data->testVoid') === 'is.null' && document.testVoid)
        return Response.json([]);
      if (!url.searchParams.has('branch_id') && !url.searchParams.has('id'))
        return Response.json([]);
      return Response.json([row]);
    }
    if (url.pathname.endsWith('/hpa_create_counter_order')) {
      const body = JSON.parse(String(options?.body));
      commits.push(body);
      idempotencyRow = {
        ...row,
        id: body.p_data.id,
        data: body.p_data,
        version: 1,
        request_hash: body.p_request_hash,
      };
      return Response.json({ order: body.p_data, replayed: false });
    }
    if (url.pathname.endsWith('/hpa_update_counter_status')) {
      const body = JSON.parse(String(options?.body));
      commits.push(body);
      return Response.json({ ...document, status: body.p_status, version: 5 });
    }
    if (url.pathname.endsWith('/hpa_settle_counter_order')) {
      const body = JSON.parse(String(options?.body));
      commits.push(body);
      return Response.json({
        order: { ...document, paymentStatus: 'paid', version: 5 },
        replayed: true,
      });
    }
    throw new Error(`Unexpected counter test request: ${url.pathname}`);
  };
  try {
    const compiled = await bundle;
    const edgeModule = { exports: {} };
    new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(
      createRequire(import.meta.url),
      edgeModule,
      edgeModule.exports,
    );
    assert.ok(handler);
    return {
      products,
      identity,
      queries,
      commits,
      document,
      row,
      get idempotencyRow() {
        return idempotencyRow;
      },
      async request(method: string, path: string[], body: unknown = null, signedIn = true) {
        const response = await handler!(
          new Request('https://counter-unit.invalid/functions/v1/hpa-commerce', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(signedIn ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ method, path, guestSession: nonce, query: {}, body }),
          }),
        );
        return { status: response.status, body: await response.json() };
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

test('counter and kitchen routes require verified nominated owner membership before exposing a receipt', async () => {
  const edge = await fixture();
  try {
    const paths: [string, string[]][] = [
      ['GET', ['admin', 'kitchen', 'barra']],
      ['GET', ['admin', 'counter', 'barra']],
      ['GET', ['admin', 'counter', 'orders', orderId]],
      ['POST', ['admin', 'counter', 'orders']],
      ['POST', ['admin', 'counter', 'orders', orderId, 'settle']],
      ['POST', ['admin', 'counter', 'orders', orderId, 'status']],
    ];
    for (const mutate of [
      () => {
        edge.identity.membership = null;
      },
      () => {
        edge.identity.membership = 'staff';
      },
      () => {
        edge.identity.membership = 'owner';
        edge.identity.email = 'other@unit.invalid';
      },
      () => {
        edge.identity.email = 'hotpizzaace@gmail.com';
        edge.identity.anonymous = true;
      },
      () => {
        edge.identity.anonymous = false;
        edge.identity.verified = false;
      },
    ]) {
      mutate();
      for (const [method, path] of paths) {
        const result = await edge.request(method, path, {});
        assert.equal(result.status, 403, `${method} ${path.join('/')}`);
        assert.doesNotMatch(
          JSON.stringify(result.body),
          /Private fictional|unit-only-server-key|tracking_token_hash/,
        );
      }
    }
    assert.equal(
      (await edge.request('GET', ['admin', 'kitchen', 'barra'], null, false)).status,
      403,
    );
    assert.equal(edge.queries.length, 0);
    assert.equal(edge.commits.length, 0);
  } finally {
    edge.close();
  }
});

test('stale counter quotes never record UPI at a different total, while old accepted receipts replay unchanged', async () => {
  const edge = await fixture();
  try {
    const product = edge.products.find((p) => p.slug === 'french-fries')!;
    product.price = 21000;
    const legacy = {
      branchId: 'barra',
      items: [{ id: 'qa-line', productId: product.id, quantity: 1, toppingIds: [], notes: '' }],
      coupon: '',
      expectedRevision: 1,
      idempotencyKey: '55555555-5555-4555-8555-555555555555',
      payment: { method: 'upi', confirmedReceived: true, upiReference: '123456789012' },
    };
    for (const quote of [
      {},
      { expectedTotal: 22000, expectedRoundOffPolicy: 'nearest_rupee' },
      { expectedTotal: 22100 },
    ]) {
      const rejected = await edge.request('POST', ['admin', 'counter', 'orders'], {
        ...legacy,
        ...quote,
      });
      assert.equal(rejected.status, 409);
      assert.equal(rejected.body.code, 'quote_changed');
      assert.match(rejected.body.error, /Reload this page/);
      assert.equal(edge.commits.length, 0);
    }
    const accepted = await edge.request('POST', ['admin', 'counter', 'orders'], {
      ...legacy,
      expectedTotal: 22100,
      expectedRoundOffPolicy: 'nearest_rupee',
    });
    assert.equal(accepted.status, 201);
    assert.equal(accepted.body.order.total, 22100);
    assert.equal(accepted.body.order.settlement.amount, 22100);
    assert.equal(accepted.body.order.roundOff, 50);
    // Model a receipt already committed by the former floor release. Its old
    // request hash and frozen payment must bypass fresh-quote enforcement.
    const { fulfillment, ...oldHashInput } = parseCounterOrderRequest(legacy);
    assert.equal(fulfillment, 'dine_in');
    const row = edge.idempotencyRow!;
    row.request_hash = createHash('sha256').update(JSON.stringify(oldHashInput)).digest('hex');
    const saved = row.data as Record<string, unknown>;
    saved.total = 22000;
    saved.roundOff = -50;
    delete saved.roundOffPolicy;
    (saved.settlement as Record<string, unknown>).amount = 22000;
    const replay = await edge.request('POST', ['admin', 'counter', 'orders'], legacy);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal(replay.body.order.total, 22000);
    assert.equal(replay.body.order.settlement.amount, 22000);
    assert.equal(edge.commits.length, 1);
  } finally {
    edge.close();
  }
});

test('counter creation reprices menu and GST on server, accepts only explicit pay-later and keeps replay private', async () => {
  const edge = await fixture();
  try {
    const product = initialProducts.find((p) => p.slug === 'french-fries')!;
    const body = {
      branchId: 'barra',
      items: [
        { id: 'qa-line', productId: product.id, quantity: 2, toppingIds: [], notes: 'QA only' },
      ],
      tableLabel: 'QA-2',
      coupon: '',
      expectedRevision: 1,
      expectedTotal: 16800,
      expectedRoundOffPolicy: 'nearest_rupee',
      idempotencyKey: '55555555-5555-4555-8555-555555555555',
      payment: null,
      payLaterReason: 'Owner permits payment after meal',
    };
    const forged = await edge.request('POST', ['admin', 'counter', 'orders'], {
      ...body,
      total: 1,
      paymentStatus: 'paid',
    });
    assert.equal(forged.status, 400);
    assert.equal(edge.commits.length, 0);
    const missingReason = await edge.request('POST', ['admin', 'counter', 'orders'], {
      ...body,
      payLaterReason: undefined,
    });
    assert.equal(missingReason.status, 400);
    assert.equal(edge.commits.length, 0);
    const placed = await edge.request('POST', ['admin', 'counter', 'orders'], body);
    assert.equal(placed.status, 201);
    assert.equal(placed.body.order.subtotal, product.price * 2);
    assert.equal(placed.body.order.deliveryFee, 0);
    assert.equal(placed.body.order.tax.cgst, Math.floor((product.price * 2 + 20) / 40));
    assert.equal(placed.body.order.total, placed.body.order.subtotal + placed.body.order.tax.total);
    assert.equal(placed.body.order.status, 'confirmed');
    assert.equal(placed.body.order.paymentStatus, 'pending');
    assert.equal(placed.body.order.counter.payLater, true);
    assert.equal(placed.body.order.counter.createdBy, actorId);
    assert.equal(edge.commits[0].p_actor_id, actorId);
    assert.equal(edge.commits[0].p_payment, null);
    // A newer counter tab explicitly sends the old default; it must keep the
    // existing legacy key/hash binding and never create a second bill.
    const replay = await edge.request('POST', ['admin', 'counter', 'orders'], {
      ...body,
      fulfillment: 'dine_in',
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal(replay.body.order.id, placed.body.order.id);
    assert.equal(edge.commits.length, 1);
    assert.doesNotMatch(
      JSON.stringify(replay.body),
      /tracking_token_hash|trackingUrl|accessToken|unit-only-server-key/,
    );
    const changed = await edge.request('POST', ['admin', 'counter', 'orders'], {
      ...body,
      tableLabel: 'Changed table',
    });
    assert.equal(changed.status, 409);
    assert.equal(edge.commits.length, 1);
  } finally {
    edge.close();
  }
});

test('a customer token or guest nonce cannot read counter history or a counter receipt by ID', async () => {
  const edge = await fixture();
  try {
    edge.identity.membership = null;
    const history = await edge.request('GET', ['orders']);
    assert.equal(history.status, 200);
    assert.deepEqual(history.body.orders, []);
    assert.equal(edge.queries[0].searchParams.get('user_id'), `eq.${actorId}`);
    assert.equal(edge.queries[0].searchParams.has('or'), false);
    assert.equal(edge.queries[0].searchParams.has('guest_session_hash'), false);
    const byId = await edge.request('GET', ['orders', orderId]);
    assert.equal(byId.status, 404);
    const guest = await edge.request('GET', ['orders', orderId], null, false);
    assert.equal(guest.status, 404);
    const create = await edge.request('POST', ['orders'], {
      channel: 'counter',
      fulfillment: 'dine_in',
      paymentMode: 'counter_manual',
      paymentStatus: 'paid',
      counter: { payLater: true },
    });
    assert.equal(create.status, 400);
    assert.equal(edge.commits.length, 0);
  } finally {
    edge.close();
  }
});

test('branch kitchen reads active work before its limit and retains explicit unpaid counter exceptions', async () => {
  const edge = await fixture();
  try {
    const result = await edge.request('GET', ['admin', 'kitchen', 'barra']);
    assert.equal(result.status, 200);
    assert.equal(result.body.orders[0].id, orderId);
    assert.equal(result.body.orders[0].paymentStatus, 'pending');
    assert.equal(result.body.hasMore, false);
    assert.equal(edge.queries.length, 1);
    const query = edge.queries[0].searchParams;
    assert.equal(query.get('branch_id'), 'eq.barra');
    assert.equal(query.get('status'), 'in.(confirmed,preparing)');
    assert.equal(query.get('limit'), '1001');
    assert.doesNotMatch(JSON.stringify(result.body), /tracking_token_hash|unit-only-server-key/);
    assert.equal((await edge.request('GET', ['admin', 'kitchen', 'unknown'])).status, 404);
    assert.equal(edge.queries.length, 1);
  } finally {
    edge.close();
  }
});

test('counter payment retry reaches SQL idempotency even after the stored receipt is paid and closed', async () => {
  const edge = await fixture();
  try {
    edge.document.status = 'closed';
    edge.document.paymentStatus = 'paid';
    const result = await edge.request('POST', ['admin', 'counter', 'orders', orderId, 'settle'], {
      expectedVersion: 1,
      idempotencyKey: '44444444-4444-4444-8444-444444444444',
      payment: { method: 'upi', upiReference: '123456789012', confirmedReceived: true },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.replayed, true);
    assert.equal(edge.commits.length, 1);
    assert.equal(edge.commits[0].p_actor_id, actorId);
    assert.equal(edge.commits[0].p_expected_version, 1);
    assert.match(String(edge.commits[0].p_request_hash), /^[a-f0-9]{64}$/);
  } finally {
    edge.close();
  }
});

test('removed software-test bills disappear from operational reads and cannot be mutated or paid again', async () => {
  const edge = await fixture();
  try {
    edge.document.testVoid = {
      kind: 'no_money_software_test',
      recordedAt: '2026-10-27T01:00:00Z',
      reason: 'Owner confirmed no payment was received',
    };
    for (const path of [
      ['admin', 'kitchen', 'barra'],
      ['admin', 'counter', 'barra'],
      ['admin', 'snapshot'],
      ['orders'],
    ]) {
      const result = await edge.request('GET', path);
      assert.equal(result.status, 200);
      assert.deepEqual(result.body.orders, []);
    }
    for (const [method, path, body] of [
      ['GET', ['admin', 'counter', 'orders', orderId], null],
      ['GET', ['orders', orderId], null],
      ['POST', ['admin', 'counter', 'orders', orderId, 'settle'], {}],
      ['POST', ['admin', 'counter', 'orders', orderId, 'status'], {}],
      ['PATCH', ['orders', orderId], { expectedVersion: 4, status: 'ready' }],
      ['POST', ['orders', orderId, 'payment', 'checkout'], {}],
    ] as const) {
      const result = await edge.request(method, [...path], body);
      assert.equal(result.status, 404, `${method} ${path.join('/')}`);
      assert.doesNotMatch(JSON.stringify(result.body), /Private fictional|QA-COUNTER|testVoid/);
    }
    assert.equal(edge.commits.length, 0);
    assert.ok(
      edge.queries.every((query) => query.searchParams.get('data->testVoid') === 'is.null'),
    );
  } finally {
    edge.close();
  }
});

test('retrying a removed counter creation key returns gone and never creates a replacement bill', async () => {
  const edge = await fixture();
  try {
    const product = initialProducts.find((p) => p.slug === 'french-fries')!;
    const body = {
      branchId: 'barra',
      items: [{ id: 'qa-line', productId: product.id, quantity: 1, toppingIds: [], notes: '' }],
      coupon: '',
      expectedRevision: 1,
      expectedTotal: 8400,
      expectedRoundOffPolicy: 'nearest_rupee',
      idempotencyKey: '55555555-5555-4555-8555-555555555555',
      payment: null,
      payLaterReason: 'Owner permits payment after meal',
    };
    assert.equal((await edge.request('POST', ['admin', 'counter', 'orders'], body)).status, 201);
    (edge.idempotencyRow!.data as Record<string, unknown>).testVoid = {
      kind: 'no_money_software_test',
      recordedAt: '2026-10-27T01:00:00Z',
      reason: 'Owner confirmed this was a software test',
    };
    const replay = await edge.request('POST', ['admin', 'counter', 'orders'], body);
    assert.equal(replay.status, 410);
    assert.equal(replay.body.code, 'order_removed');
    assert.equal(edge.commits.length, 1);
    assert.equal(edge.queries.at(-1)!.searchParams.has('data->testVoid'), false);
  } finally {
    edge.close();
  }
});
