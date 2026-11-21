import assert from 'node:assert/strict';
import test from 'node:test';
import { GET } from '../app/api/health/route';

function configure() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://health-test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_health_test';
}

test('connection readiness stays explicit, uncached and free of customer data', async (context) => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const originalCommerce = process.env.COMMERCE_ENABLED;
  context.after(() => {
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = originalKey;
    if (originalCommerce === undefined) delete process.env.COMMERCE_ENABLED;
    else process.env.COMMERCE_ENABLED = originalCommerce;
  });

  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  delete process.env.COMMERCE_ENABLED;
  let calls = 0;
  const fetchMock = context.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    calls += 1;
    assert.equal(String(input), 'https://health-test.supabase.co/rest/v1/rpc/hpa_healthcheck');
    return new Response('true', { headers: { 'Content-Type': 'application/json' } });
  });
  let response = await GET();
  assert.equal(response.status, 200);
  assert.equal(calls, 0);
  assert.deepEqual(await response.json(), {
    status: 'ok',
    application: 'demo',
    database: 'not_configured',
  });

  configure();
  response = await GET();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Cache-Control') ?? '', /no-store/);
  assert.equal(calls, 1);
  assert.deepEqual(await response.json(), {
    status: 'ok',
    application: 'demo',
    database: 'connected',
  });

  fetchMock.mock.mockImplementation(
    async () =>
      new Response(JSON.stringify({ message: 'PRIVATE_DATABASE_ERROR_DO_NOT_EXPOSE' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  response = await GET();
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    status: 'degraded',
    application: 'demo',
    database: 'unavailable',
  });

  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  response = await GET();
  assert.equal(response.status, 503);
  assert.equal((await response.json()).database, 'unavailable');
});

test('shared readiness requires both database and Edge commerce without revealing payloads', async (context) => {
  const original = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    COMMERCE_ENABLED: process.env.COMMERCE_ENABLED,
  };
  context.after(() => {
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  process.env.COMMERCE_ENABLED = 'true';
  const degraded = {
    status: 'degraded',
    application: 'shared',
    database: 'unavailable',
  };
  let edgeResponse = () =>
    new Response(
      JSON.stringify({
        branches: [{ id: 'qa-health' }],
        mode: 'development',
        allowSimulatedPayments: true,
      }),
    );
  let calls: string[] = [];
  context.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/rest/v1/rpc/hpa_healthcheck'))
      return new Response('true', { headers: { 'Content-Type': 'application/json' } });
    assert.equal(url, 'https://health-test.supabase.co/functions/v1/hpa-commerce');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.cache, 'no-store');
    assert.equal(init?.redirect, 'error');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('apikey'), 'sb_publishable_health_test');
    assert.equal(headers.has('authorization'), false);
    assert.equal(headers.has('cookie'), false);
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(Object.keys(body).sort(), ['body', 'guestSession', 'method', 'path', 'query']);
    assert.equal(body.method, 'GET');
    assert.deepEqual(body.path, ['catalog']);
    assert.deepEqual(body.query, {});
    assert.equal(body.body, null);
    assert.match(body.guestSession, /^[a-f0-9]{64}$/);
    return edgeResponse();
  });

  await context.test(
    'missing or incomplete Supabase configuration fails before any external call',
    async () => {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      let response = await GET();
      assert.equal(response.status, 503);
      assert.match(response.headers.get('cache-control') ?? '', /no-store/);
      assert.deepEqual(await response.json(), degraded);
      assert.equal(calls.length, 0);
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://health-test.supabase.co';
      response = await GET();
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), degraded);
      assert.equal(calls.length, 0);
    },
  );
  configure();
  await context.test(
    'database health alone cannot conceal an unavailable commerce Edge function',
    async () => {
      calls = [];
      edgeResponse = () =>
        new Response(JSON.stringify({ message: 'PRIVATE_EDGE_DATABASE_ERROR' }), { status: 503 });
      const response = await GET();
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), degraded);
      assert.equal(calls.length, 2);
    },
  );
  await context.test(
    'Edge network exceptions and malformed catalog responses remain redacted',
    async () => {
      for (const factory of [
        () => {
          throw new Error('PRIVATE_NETWORK_URL_OR_CREDENTIAL');
        },
        () => new Response(JSON.stringify({ branches: [] })),
        () => new Response(JSON.stringify({ message: 'PRIVATE_CATALOG_PAYLOAD' })),
        () => new Response('null'),
        () => new Response(JSON.stringify({ branches: [{ id: 'qa-health' }] })),
        () =>
          new Response(
            JSON.stringify({
              branches: [{ id: 'qa-health' }],
              mode: 'unknown',
              allowSimulatedPayments: true,
            }),
          ),
        () =>
          new Response(
            JSON.stringify({
              branches: [{ id: 'qa-health' }],
              mode: 'production',
              allowSimulatedPayments: 'false',
            }),
          ),
        () =>
          new Response(
            JSON.stringify({
              branches: [{ id: 'qa-health' }],
              mode: 'development',
              allowSimulatedPayments: null,
            }),
          ),
      ]) {
        edgeResponse = factory;
        const response = await GET();
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), degraded);
      }
    },
  );
  await context.test(
    'healthy shared commerce reports simulation without exposing catalog or credentials',
    async () => {
      calls = [];
      edgeResponse = () =>
        new Response(
          JSON.stringify({
            mode: 'development',
            allowSimulatedPayments: true,
            branches: [{ id: 'qa-health', settings: { phone: 'PRIVATE_PHONE' } }],
            products: [{ id: 'PRIVATE_PRODUCT_PAYLOAD' }],
            customer: 'PRIVATE_CUSTOMER_PAYLOAD',
          }),
        );
      const response = await GET();
      assert.equal(response.status, 200);
      assert.match(response.headers.get('cache-control') ?? '', /no-store/);
      assert.deepEqual(await response.json(), {
        status: 'ok',
        application: 'shared-development',
        database: 'connected',
        commerce: 'connected',
        payments: 'simulation',
      });
      assert.equal(calls.length, 2);
    },
  );
  for (const [mode, gatewayMode, enabled, expected] of [
    ['development', 'test', true, 'razorpay_test'],
    ['production', 'live', true, 'razorpay_live'],
    ['production', 'test', true, 'disabled'],
    ['development', 'live', true, 'disabled'],
    ['production', 'live', false, 'disabled'],
  ] as const) {
    await context.test(
      `configured ${gatewayMode} provider in ${mode} reports ${expected}`,
      async () => {
        edgeResponse = () =>
          new Response(
            JSON.stringify({
              mode,
              allowSimulatedPayments: false,
              branches: [{ id: 'qa-health' }],
              payments: { provider: 'razorpay', mode: gatewayMode, enabled },
              secret: 'PRIVATE_PROVIDER_KEY',
            }),
          );
        const response = await GET();
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.payments, expected);
        assert.equal(body.application, `shared-${mode}`);
        assert.doesNotMatch(JSON.stringify(body), /PRIVATE_PROVIDER_KEY|qa-health/);
      },
    );
  }
  for (const [mode, allowSimulatedPayments] of [
    ['production', false],
    ['production', true],
    ['development', false],
  ] as const) {
    await context.test(
      `${mode} mode with simulation flag ${allowSimulatedPayments} never claims online payment readiness`,
      async () => {
        calls = [];
        edgeResponse = () =>
          new Response(
            JSON.stringify({
              mode,
              allowSimulatedPayments,
              branches: [
                {
                  id: 'qa-health',
                  settings: { paymentMethods: [], acceptingOrders: false, phone: 'PRIVATE_PHONE' },
                },
              ],
              credentials: 'PRIVATE_PROVIDER_KEY',
            }),
          );
        const response = await GET();
        assert.equal(response.status, 200);
        assert.match(response.headers.get('cache-control') ?? '', /no-store/);
        assert.deepEqual(await response.json(), {
          status: 'ok',
          application: `shared-${mode}`,
          database: 'connected',
          commerce: 'connected',
          payments: 'disabled',
        });
        assert.equal(calls.length, 2);
      },
    );
  }
});
