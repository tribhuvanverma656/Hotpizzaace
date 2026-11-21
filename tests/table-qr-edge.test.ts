import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { build, transform } from 'esbuild';
import { initialBranches, initialCategories, initialProducts } from '../lib/data';
import { getCartTotals } from '../lib/pricing';
import { parseCounterOrderRequest } from '../lib/counter';

const actorId = '11111111-1111-4111-8111-111111111111';
const tableId = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const tableToken = 'a'.repeat(64);
const session = 'b'.repeat(64);
const authToken = 'c'.repeat(64);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const bundle = build({
  entryPoints: [resolve('supabase/functions/hpa-commerce/index.ts')],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  plugins: [
    {
      name: 'table-qr-edge-test-imports',
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
            if (['razorpay', 'payments'].includes(name))
              return {
                path: resolve('lib/payments', name === 'payments' ? 'service.ts' : 'razorpay.ts'),
              };
            return {
              path: resolve(
                ['counter', 'kitchen', 'analytics'].includes(name) ? 'lib' : 'lib/commerce',
                `${name}.ts`,
              ),
            };
          },
        );
      },
    },
  ],
});

/** Keep each deployment module separate so constructor identity matches real Edge packaging. */
async function splitDeployment() {
  const entries: Record<string, string> = {
    'domain.js': 'lib/commerce/domain.ts',
    'addresses.js': 'lib/commerce/addresses.ts',
    'razorpay.js': 'lib/payments/razorpay.ts',
    'payments.js': 'lib/payments/service.ts',
    'phonepe.js': 'lib/payments/phonepe.ts',
    'phonepe-payments.js': 'lib/payments/phonepe-service.ts',
    'counter.js': 'lib/counter.ts',
    'kitchen.js': 'lib/kitchen.ts',
    'reports.js': 'lib/commerce/reports.ts',
    'table-qr.js': 'lib/commerce/table-qr.ts',
  };
  const sources = new Map<string, string>();
  await Promise.all(
    Object.entries(entries).map(async ([name, path]) => {
      const compiled = await build({
        entryPoints: [resolve(path)],
        bundle: true,
        write: false,
        platform: 'neutral',
        format: 'esm',
        target: 'es2022',
        minify: true,
      });
      const commonjs = await transform(compiled.outputFiles[0].text, {
        format: 'cjs',
        target: 'es2022',
      });
      sources.set(name, commonjs.code);
    }),
  );
  const index = await transform(
    await readFile(resolve('supabase/functions/hpa-commerce/index.ts'), 'utf8'),
    { loader: 'ts', format: 'cjs', target: 'es2022' },
  );
  const nodeRequire = createRequire(import.meta.url);
  const cache = new Map<string, { exports: unknown }>();
  const requireModule = (name: string): unknown => {
    if (name.startsWith('npm:@supabase/')) return nodeRequire('@supabase/supabase-js');
    const file = name.replace(/^\.\//, '');
    if (cache.has(file)) return cache.get(file)!.exports;
    const source = sources.get(file);
    if (!source) throw new Error(`Unexpected deployment module: ${name}`);
    const edgeModule = { exports: {} };
    cache.set(file, edgeModule);
    new Function('require', 'module', 'exports', source)(
      requireModule,
      edgeModule,
      edgeModule.exports,
    );
    return edgeModule.exports;
  };
  return { code: index.code, requireModule };
}

async function fixture(separateModules = false, online = false) {
  const onlineOrders: Record<string, Record<string, unknown>> = {};
  const products = structuredClone(initialProducts);
  const originalFetch = globalThis.fetch;
  const runtime = globalThis as typeof globalThis & { Deno?: unknown };
  const originalDeno = runtime.Deno;
  let handler: ((request: Request) => Promise<Response>) | undefined;
  const identity = { id: actorId, owner: true, email: 'hotpizzaace@gmail.com', verified: true };
  const calls: { name: string; body: Record<string, unknown> }[] = [];
  const queries: URL[] = [];
  const rateKeys: string[] = [];
  const product = products.find((product) => product.slug === 'french-fries')!;
  const selection = {
    id: 'qa-fries',
    productId: product.id,
    quantity: 1,
    toppingIds: [],
    notes: '',
  };
  const record = {
    id: requestId,
    request_hash: '',
    table_id: tableId,
    branch_id: 'barra',
    generation: 1,
    status: 'pending',
    version: 1,
    guest_session_hash: hash(session),
    data: {
      selections: [selection],
      customerName: 'Fictional table guest',
      customerPhone: '9876543210',
      notes: 'QA request note',
      items: [],
      subtotal: product.price,
      total: product.price + 2 * Math.floor((product.price + 20) / 40),
      testVoid: undefined as { kind: string; recordedAt: string; reason: string } | undefined,
    },
  };
  let created = false;
  const responseDocument = () => ({
    id: requestId,
    number: 'QR-QA',
    branchId: 'barra',
    tableLabel: 'QA table',
    generation: 1,
    status: record.status,
    version: record.version,
    createdAt: '2026-10-24T00:00:00Z',
    expiresAt: '2026-10-24T00:30:00Z',
    customerName: record.data.customerName,
    customerPhone: record.data.customerPhone,
    notes: record.data.notes,
    items: record.data.items,
    total: record.data.total,
  });
  runtime.Deno = {
    env: {
      get: (name: string) =>
        ({
          SUPABASE_URL: 'https://table-qr-unit.invalid',
          SUPABASE_SERVICE_ROLE_KEY: 'unit-only-server-secret',
        })[name],
      toObject: () =>
        online
          ? {
              RAZORPAY_ENABLED: 'true',
              RAZORPAY_MODE: 'test',
              RAZORPAY_KEY_ID: 'rzp_test_UnitOnly123',
              RAZORPAY_KEY_SECRET: 'unit-only-fake-secret-123',
              RAZORPAY_WEBHOOK_SECRET: 'unit-only-fake-webhook-123',
            }
          : {},
    },
    serve: (value: typeof handler) => {
      handler = value;
    },
  };
  globalThis.fetch = async (input, options) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const name = url.pathname.split('/').at(-1)!;
    const body = JSON.parse(String(options?.body ?? '{}')) as Record<string, unknown>;
    if (url.pathname === '/auth/v1/user')
      return Response.json({
        id: identity.id,
        email: identity.email,
        email_confirmed_at: identity.verified ? '2026-01-01T00:00:00Z' : null,
        is_anonymous: false,
        aud: 'authenticated',
        role: 'authenticated',
      });
    if (name === 'hpa_admin_memberships')
      return Response.json(identity.owner ? [{ role: 'owner' }] : []);
    if (name === 'hpa_consume_rate_limit') {
      rateKeys.push(String(body.p_key));
      return Response.json(true);
    }
    if (name === 'hpa_catalog_snapshot') {
      const branches = structuredClone(initialBranches);
      branches[0].settings = {
        ...branches[0].settings,
        counterAcceptingOrders: true,
        temporarilyClosed: false,
        acceptingOrders: false,
        paymentMethods: [],
        billing: {
          businessName: 'HOT PIZZA ACE',
          address: 'Fictional QA address',
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
    if (name === 'hpa_orders') {
      const key = `${url.searchParams.get('idempotency_scope')?.slice(3)}:${url.searchParams.get('idempotency_key')?.slice(3)}`;
      return Response.json(onlineOrders[key] ? [onlineOrders[key]] : []);
    }
    if (name === 'hpa_create_qr_online_order') {
      calls.push({ name, body });
      assert.equal(body.p_token_hash, hash(tableToken));
      assert.equal(body.p_generation, 1);
      const data = body.p_data as Record<string, unknown>;
      assert.equal(data.status, 'pending');
      assert.equal(data.paymentStatus, 'initiated');
      assert.equal(data.settlement, undefined);
      const row = {
        id: data.id,
        data,
        version: 1,
        tracking_token_hash: body.p_tracking_token_hash,
        request_hash: body.p_request_hash,
      };
      onlineOrders[`${body.p_scope}:${body.p_idempotency_key}`] = row;
      return Response.json({
        order: data,
        created: true,
        trackingTokenHash: body.p_tracking_token_hash,
      });
    }
    if (name === 'hpa_table_qr') {
      queries.push(url);
      if (
        url.searchParams.has('token_hash') &&
        url.searchParams.get('token_hash') !== `eq.${hash(tableToken)}`
      )
        return Response.json([]);
      return Response.json([
        {
          id: tableId,
          branch_id: 'barra',
          table_label: 'QA table',
          generation: 1,
          active: true,
          version: 1,
          ordering_scope: 'branch',
        },
      ]);
    }
    if (name === 'hpa_table_requests') {
      queries.push(url);
      return Response.json(
        url.searchParams.has('id') || url.searchParams.has('branch_id') || created ? [record] : [],
      );
    }
    if (name === 'hpa_list_table_requests')
      return Response.json({ requests: [responseDocument()], hasMore: false });
    if (name === 'hpa_create_table_request') {
      calls.push({ name, body });
      created = true;
      record.request_hash = String(body.p_request_hash);
      return Response.json({ request: responseDocument(), replayed: false });
    }
    if (name === 'hpa_manage_table_qr') {
      calls.push({ name, body });
      return Response.json({
        id: tableId,
        branchId: 'barra',
        tableLabel: 'Branch ordering QR',
        active: true,
        generation: 1,
        version: 1,
        token: tableToken,
      });
    }
    if (name === 'hpa_get_table_request') {
      calls.push({ name, body });
      return Response.json(
        body.p_guest_hash === record.guest_session_hash ? responseDocument() : null,
      );
    }
    if (name === 'hpa_decide_table_request') {
      calls.push({ name, body });
      if (body.p_action === 'reject')
        return Response.json({ request: { ...responseDocument(), status: 'rejected' } });
      return Response.json({
        order: body.p_order_data ?? { id: 'replayed-order' },
        replayed: !body.p_order_data,
      });
    }
    throw new Error(`Unexpected table QR test call: ${url.pathname}`);
  };
  try {
    const compiled = separateModules
      ? await splitDeployment()
      : { code: (await bundle).outputFiles[0].text, requireModule: createRequire(import.meta.url) };
    const edgeModule = { exports: {} };
    new Function('require', 'module', 'exports', compiled.code)(
      compiled.requireModule,
      edgeModule,
      edgeModule.exports,
    );
    assert.ok(handler);
    return {
      products,
      identity,
      calls,
      queries,
      rateKeys,
      selection,
      record,
      async request(
        method: string,
        path: string[],
        body: unknown = null,
        signedIn = false,
        nonce = session,
      ) {
        const response = await handler!(
          new Request('https://table-qr-unit.invalid/functions/v1/hpa-commerce', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(signedIn ? { Authorization: `Bearer ${authToken}` } : {}),
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

test('a removed QR test request is hidden from its owner queue and returns gone only to its original guest', async () => {
  const edge = await fixture();
  try {
    const visible = await edge.request('GET', ['admin', 'table-requests', 'barra'], null, true);
    assert.equal(visible.status, 200);
    assert.equal(visible.body.requests.length, 1);
    edge.record.data.testVoid = {
      kind: 'no_money_software_test',
      recordedAt: '2026-10-27T01:00:00Z',
      reason: 'Owner confirmed this was a software test',
    };
    const queue = await edge.request('GET', ['admin', 'table-requests', 'barra'], null, true);
    assert.equal(queue.status, 200);
    assert.deepEqual(queue.body.requests, []);
    const original = await edge.request('GET', ['table', tableToken, 'requests', requestId]);
    assert.equal(original.status, 410);
    assert.equal(original.body.code, 'request_removed');
    assert.doesNotMatch(JSON.stringify(original.body), /Fictional|9876543210|testVoid/);
    const stranger = await edge.request(
      'GET',
      ['table', tableToken, 'requests', requestId],
      null,
      false,
      'd'.repeat(64),
    );
    assert.equal(stranger.status, 404);
    assert.equal((await edge.request('GET', ['admin', 'table-requests', 'barra'])).status, 403);
  } finally {
    edge.close();
  }
});

test('removed QR creation/acceptance retries and rejection never recreate an order or change its record', async () => {
  const edge = await fixture();
  try {
    const body = {
      items: [edge.selection],
      customerName: 'Fictional table guest',
      customerPhone: '9876543210',
      expectedRevision: 1,
      expectedTotal: 8400,
      expectedRoundOffPolicy: 'nearest_rupee',
      idempotencyKey: '44444444-4444-4444-8444-444444444444',
    };
    assert.equal((await edge.request('POST', ['table', tableToken, 'requests'], body)).status, 201);
    edge.record.data.testVoid = {
      kind: 'no_money_software_test',
      recordedAt: '2026-10-27T01:00:00Z',
      reason: 'Owner confirmed this was a software test',
    };
    const replay = await edge.request('POST', ['table', tableToken, 'requests'], body);
    assert.equal(replay.status, 410);
    assert.equal(replay.body.code, 'request_removed');
    const acceptBody = {
      expectedRequestVersion: 1,
      expectedRevision: 1,
      expectedTotal: 8400,
      expectedRoundOffPolicy: 'nearest_rupee',
      idempotencyKey: '55555555-5555-4555-8555-555555555555',
      payment: null,
      payLaterReason: 'Owner approves payment after meal',
    };
    for (const status of ['pending', 'accepted']) {
      edge.record.status = status;
      const result = await edge.request(
        'POST',
        ['admin', 'table-requests', requestId, 'accept'],
        acceptBody,
        true,
      );
      assert.equal(result.status, 410);
    }
    const reject = await edge.request(
      'POST',
      ['admin', 'table-requests', requestId, 'reject'],
      { expectedRequestVersion: 1 },
      true,
    );
    assert.equal(reject.status, 410);
    assert.equal(edge.calls.filter((call) => call.name === 'hpa_create_table_request').length, 1);
    assert.equal(edge.calls.filter((call) => call.name === 'hpa_decide_table_request').length, 0);
  } finally {
    edge.close();
  }
});

test('a branch QR exposes only its branch menu, requires contact and never creates a kitchen order or settlement', async () => {
  const edge = await fixture();
  try {
    const context = await edge.request('GET', ['table', tableToken]);
    assert.equal(context.status, 200);
    assert.equal(context.body.table.tableLabel, 'QA table');
    assert.equal(context.body.catalog.branches.length, 1);
    assert.doesNotMatch(
      JSON.stringify(context.body),
      /token_hash|unit-only-server-secret|guest_session_hash/,
    );
    assert.ok(edge.queries[0].searchParams.get('select')?.includes('table_label'));
    assert.ok(!edge.queries[0].searchParams.get('select')?.split(',').includes('token'));
    assert.equal(edge.queries[0].searchParams.get('ordering_scope'), 'eq.branch');
    const body = {
      items: [edge.selection],
      customerName: 'Fictional table guest',
      customerPhone: '9876543210',
      notes: 'QA request note',
      expectedRevision: 1,
      expectedTotal: 8400,
      expectedRoundOffPolicy: 'nearest_rupee',
      idempotencyKey: '44444444-4444-4444-8444-444444444444',
    };
    assert.equal(
      (
        await edge.request('POST', ['table', tableToken, 'requests'], {
          ...body,
          paymentStatus: 'paid',
          total: 1,
        })
      ).status,
      400,
    );
    const created = await edge.request('POST', ['table', tableToken, 'requests'], body);
    assert.equal(created.status, 201);
    assert.equal(created.body.request.status, 'pending');
    const commit = edge.calls.find((call) => call.name === 'hpa_create_table_request')!;
    const data = commit.body.p_data as Record<string, unknown>;
    assert.equal(commit.body.p_guest_hash, hash(session));
    assert.equal(data.branchId, 'barra');
    assert.equal(data.tableLabel, 'QA table');
    assert.equal(data.customerPhone, '9876543210');
    assert.equal(data.roundOffPolicy, 'nearest_rupee');
    assert.equal(Number(data.total) % 100, 0);
    assert.ok(Number(data.total) > Number(data.subtotal));
    assert.ok(!('paymentStatus' in data));
    assert.ok(!('counter' in data));
    assert.ok(
      edge.calls.every(
        (call) =>
          call.name !== 'hpa_create_counter_order' && call.name !== 'hpa_settle_counter_order',
      ),
    );
    assert.ok(edge.rateKeys.includes('table:create:global'));
    assert.ok(edge.rateKeys.some((key) => key === 'table:create:branch:barra'));
  } finally {
    edge.close();
  }
});

test('separate production-style bundles preserve QR validation errors instead of returning a generic service failure', async () => {
  const edge = await fixture(true);
  try {
    const invalid = await edge.request('POST', ['table', tableToken, 'requests'], {
      items: [],
      expectedRevision: 1,
      expectedTotal: 8400,
      expectedRoundOffPolicy: 'nearest_rupee',
      idempotencyKey: '44444444-4444-4444-8444-444444444444',
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.code, 'invalid_request');
    assert.equal(
      (
        await edge.request(
          'GET',
          ['table', tableToken, 'requests', requestId],
          null,
          false,
          'd'.repeat(64),
        )
      ).status,
      404,
    );
  } finally {
    edge.close();
  }
});

test('branch QR rejects missing or malformed contact before saving a request', async () => {
  const edge = await fixture();
  try {
    const body = {
      items: [edge.selection],
      customerName: 'Fictional guest',
      customerPhone: '9876543210',
      expectedRevision: 1,
      expectedTotal: 8400,
      expectedRoundOffPolicy: 'nearest_rupee',
      idempotencyKey: '44444444-4444-4444-8444-444444444444',
    };
    for (const contact of [
      { customerName: undefined },
      { customerName: '' },
      { customerName: ' A ' },
      { customerName: ' '.repeat(3) },
      { customerName: 'A'.repeat(81) },
      { customerPhone: undefined },
      { customerPhone: '' },
      { customerPhone: '1234567890' },
      { customerPhone: '+919876543210' },
      { customerPhone: '987654321' },
      { customerPhone: '98765432100' },
      { customerPhone: '98765abcde' },
    ]) {
      const response = await edge.request('POST', ['table', tableToken, 'requests'], {
        ...body,
        ...contact,
      });
      assert.equal(response.status, 400, JSON.stringify(contact));
    }
    assert.equal(edge.calls.filter((call) => call.name === 'hpa_create_table_request').length, 0);
    const valid = await edge.request('POST', ['table', tableToken, 'requests'], {
      ...body,
      customerName: '  Fictional guest  ',
      customerPhone: ' 9876543210 ',
    });
    assert.equal(valid.status, 201);
    const saved = edge.calls.find((call) => call.name === 'hpa_create_table_request')!.body
      .p_data as Record<string, unknown>;
    assert.equal(saved.customerName, 'Fictional guest');
    assert.equal(saved.customerPhone, '9876543210');
  } finally {
    edge.close();
  }
});

test('guest QR and staff approval reject stale quotes before creating a request or recording payment', async () => {
  const edge = await fixture();
  try {
    edge.products.find((product) => product.id === edge.selection.productId)!.price = 21000;
    const guest = {
      items: [edge.selection],
      customerName: 'Fictional guest',
      customerPhone: '9876543210',
      expectedRevision: 1,
      idempotencyKey: '44444444-4444-4444-8444-444444444444',
    };
    const staff = {
      expectedRequestVersion: 1,
      expectedRevision: 1,
      idempotencyKey: '55555555-5555-4555-8555-555555555555',
      payment: { method: 'upi', confirmedReceived: true, upiReference: '123456789012' },
    };
    for (const quote of [{}, { expectedTotal: 22000, expectedRoundOffPolicy: 'nearest_rupee' }]) {
      const request = await edge.request('POST', ['table', tableToken, 'requests'], {
        ...guest,
        ...quote,
      });
      assert.equal(request.status, 409);
      assert.equal(request.body.code, 'quote_changed');
      assert.match(request.body.error, /Reload this page/);
      const approval = await edge.request(
        'POST',
        ['admin', 'table-requests', requestId, 'accept'],
        { ...staff, ...quote },
        true,
      );
      assert.equal(approval.status, 409);
      assert.equal(approval.body.code, 'quote_changed');
      assert.equal(
        edge.calls.filter((call) =>
          ['hpa_create_table_request', 'hpa_decide_table_request'].includes(call.name),
        ).length,
        0,
      );
    }
    const accepted = await edge.request(
      'POST',
      ['admin', 'table-requests', requestId, 'accept'],
      {
        ...staff,
        expectedTotal: 22100,
        expectedRoundOffPolicy: 'nearest_rupee',
      },
      true,
    );
    assert.equal(accepted.status, 201);
    assert.equal(accepted.body.order.total, 22100);
    assert.equal(accepted.body.order.settlement.amount, 22100);
    // Already accepted legacy decisions must reach SQL idempotency without
    // repricing or requiring the new fields from an old retry payload.
    edge.record.status = 'accepted';
    const replay = await edge.request(
      'POST',
      ['admin', 'table-requests', requestId, 'accept'],
      staff,
      true,
    );
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal(edge.calls.at(-1)!.body.p_order_data, undefined);
  } finally {
    edge.close();
  }
});

test('an existing guest QR request replays its old hash and frozen total without a new pricing assertion', async () => {
  const edge = await fixture();
  try {
    const legacy = {
      items: [edge.selection],
      customerName: 'Fictional guest',
      customerPhone: '9876543210',
      expectedRevision: 1,
      idempotencyKey: '44444444-4444-4444-8444-444444444444',
    };
    const created = await edge.request('POST', ['table', tableToken, 'requests'], {
      ...legacy,
      expectedTotal: 8400,
      expectedRoundOffPolicy: 'nearest_rupee',
    });
    assert.equal(created.status, 201);
    const normalized = parseCounterOrderRequest({
      branchId: 'barra',
      ...legacy,
      coupon: '',
      payment: null,
      payLaterReason: 'QR request awaiting staff payment confirmation',
    });
    edge.record.request_hash = hash(JSON.stringify({ ...legacy, items: normalized.items }));
    const original = JSON.stringify(edge.record.data);
    edge.products.find((product) => product.id === edge.selection.productId)!.price = 21000;
    const replay = await edge.request('POST', ['table', tableToken, 'requests'], legacy);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal(replay.body.request.total, 8400);
    assert.equal(edge.calls.filter((call) => call.name === 'hpa_create_table_request').length, 1);
    assert.equal(JSON.stringify(edge.record.data), original);
  } finally {
    edge.close();
  }
});

test('branch QR management uses the owner-only canonical branch RPC without table names', async () => {
  const edge = await fixture();
  try {
    assert.equal(
      (
        await edge.request('POST', ['admin', 'table-qr'], {
          action: 'create',
          branchId: 'barra',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await edge.request(
          'POST',
          ['admin', 'table-qr'],
          { action: 'create', branchId: 'barra', tableLabel: 'Table 2' },
          true,
        )
      ).status,
      400,
    );
    const response = await edge.request(
      'POST',
      ['admin', 'table-qr'],
      { action: 'create', branchId: 'barra' },
      true,
    );
    assert.equal(response.status, 201);
    assert.equal(response.body.table.id, tableId);
    const commit = edge.calls.find((call) => call.name === 'hpa_manage_table_qr')!;
    assert.deepEqual(commit.body, {
      p_actor_id: actorId,
      p_action: 'create',
      p_branch_id: 'barra',
    });
    const listed = await edge.request('GET', ['admin', 'table-qr', 'barra'], null, true);
    assert.equal(listed.status, 200);
    assert.equal(listed.body.tables.length, 1);
    const query = edge.queries.at(-1)!;
    assert.equal(query.searchParams.get('ordering_scope'), 'eq.branch');
    assert.equal(query.searchParams.get('branch_id'), 'eq.barra');
  } finally {
    edge.close();
  }
});

test('QR contact and request status do not cross guest or signed-in accounts sharing the same browser nonce', async () => {
  const edge = await fixture();
  try {
    edge.identity.owner = false;
    const path = ['table', tableToken, 'requests', requestId];
    assert.equal((await edge.request('GET', path)).status, 200);
    assert.equal((await edge.request('GET', path, null, true)).status, 404);
    edge.record.guest_session_hash = hash(`hpa-account-guest:v1:${actorId}:${session}`);
    assert.equal((await edge.request('GET', path, null, true)).status, 200);
    assert.equal((await edge.request('GET', path)).status, 404);
    edge.identity.id = '22222222-2222-4222-8222-222222222222';
    const stranger = await edge.request('GET', path, null, true);
    assert.equal(stranger.status, 404);
    assert.doesNotMatch(
      JSON.stringify(stranger.body),
      /Fictional table guest|9876543210|QA request note/,
    );
    edge.identity.id = actorId;
    assert.equal((await edge.request('GET', path, null, true)).status, 200);
  } finally {
    edge.close();
  }
});

test('table request status is bound to the original guest nonce and table management requires the verified owner', async () => {
  const edge = await fixture();
  try {
    assert.equal(
      (await edge.request('GET', ['table', tableToken, 'requests', requestId])).status,
      200,
    );
    assert.equal(
      (
        await edge.request(
          'GET',
          ['table', tableToken, 'requests', requestId],
          null,
          false,
          'd'.repeat(64),
        )
      ).status,
      404,
    );
    assert.equal((await edge.request('GET', ['table', 'e'.repeat(64)])).status, 404);
    assert.equal((await edge.request('GET', ['admin', 'table-qr', 'barra'])).status, 403);
    edge.identity.owner = false;
    assert.equal(
      (
        await edge.request(
          'POST',
          ['admin', 'table-qr'],
          { action: 'create', branchId: 'barra', tableLabel: 'X' },
          true,
        )
      ).status,
      403,
    );
    assert.equal(
      (await edge.request('POST', ['admin', 'table-requests', requestId, 'accept'], {}, true))
        .status,
      403,
    );
    edge.identity.owner = true;
    edge.identity.email = 'other@unit.invalid';
    assert.equal(
      (await edge.request('GET', ['admin', 'table-qr', 'barra'], null, true)).status,
      403,
    );
  } finally {
    edge.close();
  }
});

test('staff acceptance reuses stored selections and authors the table source; payment or an explicit pay-later reason is mandatory', async () => {
  const edge = await fixture();
  try {
    const body = {
      expectedRequestVersion: 1,
      expectedRevision: 1,
      expectedTotal: 8400,
      expectedRoundOffPolicy: 'nearest_rupee',
      idempotencyKey: '55555555-5555-4555-8555-555555555555',
      payment: null,
    };
    assert.equal(
      (await edge.request('POST', ['admin', 'table-requests', requestId, 'accept'], body, true))
        .status,
      400,
    );
    assert.equal(
      (
        await edge.request(
          'POST',
          ['admin', 'table-requests', requestId, 'accept'],
          { ...body, items: [] },
          true,
        )
      ).status,
      400,
    );
    const accepted = await edge.request(
      'POST',
      ['admin', 'table-requests', requestId, 'accept'],
      { ...body, payLaterReason: 'Owner approves payment after meal' },
      true,
    );
    assert.equal(accepted.status, 201);
    assert.equal(accepted.body.order.status, 'confirmed');
    assert.equal(accepted.body.order.paymentStatus, 'pending');
    const commit = edge.calls.find((call) => call.name === 'hpa_decide_table_request')!;
    const order = commit.body.p_order_data as Record<string, unknown>;
    assert.equal(commit.body.p_actor_id, actorId);
    assert.equal(commit.body.p_request_id, requestId);
    assert.deepEqual(
      (order.items as { productId: string }[]).map((item) => item.productId),
      [edge.selection.productId],
    );
    assert.equal((order.counter as Record<string, unknown>).entry, 'table_qr');
    assert.equal((order.counter as Record<string, unknown>).sourceRequestId, requestId);
    assert.equal((order.customer as Record<string, unknown>).instructions, 'QA request note');
    assert.equal((order.customer as Record<string, unknown>).name, 'Fictional table guest');
    assert.equal((order.customer as Record<string, unknown>).phone, '9876543210');
    assert.equal((order.counter as Record<string, unknown>).tableLabel, '');
    assert.equal(commit.body.p_payment, null);
  } finally {
    edge.close();
  }
});

test('QR gateway checkout is idempotent, guest-scoped and cannot forge a paid order', async () => {
  const edge = await fixture(true, true);
  try {
    const context = await edge.request('GET', ['table', tableToken]);
    const snapshot = context.body.catalog;
    const total = getCartTotals(
      [edge.selection],
      snapshot.products,
      snapshot.branches[0].settings,
      '',
      'dine_in',
    ).total;
    const input = {
      items: [edge.selection],
      customerName: 'QA guest',
      customerPhone: '9876543210',
      expectedRevision: 1,
      expectedTotal: total,
      expectedRoundOffPolicy: 'nearest_rupee',
      idempotencyKey: requestId,
      paymentMethod: 'upi',
    };
    const first = await edge.request('POST', ['table', tableToken, 'online-order'], input);
    assert.equal(first.status, 201);
    assert.equal(first.body.order.paymentMode, 'razorpay_test');
    assert.equal(first.body.order.fulfillment, 'dine_in');
    assert.match(first.body.order.trackingUrl, /^\/track-order\?order=/);
    const retry = await edge.request('POST', ['table', tableToken, 'online-order'], input);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.order.id, first.body.order.id);
    assert.equal(edge.calls.filter((c) => c.name === 'hpa_create_qr_online_order').length, 1);
    const changed = await edge.request('POST', ['table', tableToken, 'online-order'], {
      ...input,
      paymentMethod: 'card',
    });
    assert.equal(changed.status, 409);
    const forged = await edge.request('POST', ['table', tableToken, 'online-order'], {
      ...input,
      paymentStatus: 'paid',
    });
    assert.equal(forged.status, 400);
    const anotherGuest = await edge.request(
      'POST',
      ['table', tableToken, 'online-order'],
      input,
      false,
      'd'.repeat(64),
    );
    assert.equal(anotherGuest.status, 201);
    assert.notEqual(anotherGuest.body.order.id, first.body.order.id);
  } finally {
    edge.close();
  }
});
