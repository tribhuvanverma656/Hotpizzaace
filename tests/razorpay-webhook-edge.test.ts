import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const webhookSecret = 'synthetic-webhook-secret-123';
const bundled = build({
  entryPoints: [resolve('supabase/functions/hpa-razorpay-webhook/index.ts')],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  plugins: [
    {
      name: 'webhook-test-imports',
      setup(plugin) {
        plugin.onResolve({ filter: /^npm:@supabase\/supabase-js@/ }, () => ({
          path: '@supabase/supabase-js',
          external: true,
        }));
        plugin.onResolve({ filter: /^\.\/(razorpay|payments)\.js$/ }, (args) => ({
          path: resolve(
            'lib/payments',
            args.path.includes('payments') ? 'service.ts' : 'razorpay.ts',
          ),
        }));
      },
    },
  ],
});

async function fixture() {
  const runtime = globalThis as typeof globalThis & { Deno?: unknown };
  const originalDeno = runtime.Deno;
  const originalFetch = globalThis.fetch;
  let handler: ((request: Request) => Promise<Response>) | undefined;
  const environment: Record<string, string> = {
    SUPABASE_URL: 'https://webhook-unit.invalid',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-only',
    RAZORPAY_ENABLED: 'true',
    RAZORPAY_MODE: 'test',
    RAZORPAY_KEY_ID: 'rzp_test_fixture123',
    RAZORPAY_KEY_SECRET: 'synthetic-key-secret-123',
    RAZORPAY_WEBHOOK_SECRET: webhookSecret,
  };
  const state = {
    catalogMode: 'development',
    attemptMode: 'test',
    missing: false,
    dbError: false,
    providerError: false,
    refundListError: false,
    commitError: false,
    payment: {
      entity: 'payment',
      id: 'pay_fixture123',
      order_id: 'order_fixture123',
      amount: 22996,
      currency: 'INR',
      status: 'captured',
      captured: true,
      amount_refunded: 0,
    },
    refund: {
      entity: 'refund',
      id: 'rfnd_fixture123',
      payment_id: 'pay_fixture123',
      amount: 1000,
      currency: 'INR',
      status: 'processed',
      created_at: 1793289600,
    },
    refundItems: undefined as unknown[] | undefined,
    calls: [] as string[],
    commits: [] as Record<string, unknown>[],
  };
  runtime.Deno = {
    env: { toObject: () => environment },
    serve: (value: typeof handler) => {
      handler = value;
    },
  };
  globalThis.fetch = async (input, options) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const name = url.pathname.split('/').at(-1)!;
    state.calls.push(name);
    if (url.hostname === 'api.razorpay.com') {
      if (url.pathname.endsWith('/refunds/rfnd_fixture123')) return Response.json(state.refund);
      if (url.pathname.endsWith('/refunds')) {
        if (state.refundListError)
          return Response.json({ message: 'PRIVATE_PROVIDER_ERROR' }, { status: 503 });
        const items = state.refundItems ?? [state.refund];
        return Response.json({ entity: 'collection', count: items.length, items });
      }
      assert.equal(url.pathname, '/v1/payments/pay_fixture123');
      return state.providerError
        ? Response.json({ message: 'PRIVATE_PROVIDER_ERROR' }, { status: 503 })
        : Response.json(state.payment);
    }
    assert.equal(url.hostname, 'webhook-unit.invalid');
    if (name === 'hpa_catalog_snapshot') return Response.json({ mode: state.catalogMode });
    if (name === 'hpa_payment_find') {
      if (state.dbError)
        return Response.json({ message: 'PRIVATE_DATABASE_ERROR' }, { status: 503 });
      return Response.json(
        state.missing
          ? null
          : {
              id: '11111111-1111-4111-8111-111111111111',
              order_id: '22222222-2222-4222-8222-222222222222',
              mode: state.attemptMode,
              provider_order_id: 'order_fixture123',
              amount: 22996,
              currency: 'INR',
              state: 'ready',
            },
      );
    }
    if (
      name === 'hpa_payment_apply' ||
      name === 'hpa_payment_sync_refunds' ||
      name === 'hpa_payment_flag_refund_review'
    ) {
      if (state.commitError)
        return Response.json({ message: 'PRIVATE_COMMIT_ERROR' }, { status: 503 });
      state.commits.push(JSON.parse(String(options?.body)));
      return Response.json({
        paymentStatus: state.payment.status === 'captured' ? 'paid' : 'initiated',
      });
    }
    throw new Error(`Unexpected request ${name}`);
  };
  try {
    const result = await bundled;
    const edgeModule = { exports: {} };
    new Function('require', 'module', 'exports', result.outputFiles[0].text)(
      createRequire(import.meta.url),
      edgeModule,
      edgeModule.exports,
    );
    assert.ok(handler);
    return {
      state,
      environment,
      event(status = 'captured') {
        return {
          entity: 'event',
          account_id: 'acc_fixture123',
          event: `payment.${status}`,
          payload: {
            payment: { entity: { ...state.payment, status, captured: status === 'captured' } },
          },
        };
      },
      async send(
        value: unknown,
        options: {
          signature?: string | null;
          method?: string;
          type?: string;
          eventId?: string;
        } = {},
      ) {
        const raw = typeof value === 'string' ? value : JSON.stringify(value);
        const signature =
          options.signature === undefined
            ? createHmac('sha256', webhookSecret).update(raw).digest('hex')
            : options.signature;
        const response = await handler!(
          new Request('https://webhook-unit.invalid/functions/v1/hpa-razorpay-webhook', {
            method: options.method ?? 'POST',
            headers: {
              'Content-Type': options.type ?? 'application/json',
              ...(signature === null ? {} : { 'x-razorpay-signature': signature }),
              'x-razorpay-event-id': options.eventId ?? 'untrusted-header',
            },
            ...((options.method ?? 'POST') === 'GET' ? {} : { body: raw }),
          }),
        );
        return { status: response.status, data: await response.json(), raw };
      },
      close() {
        runtime.Deno = originalDeno;
        globalThis.fetch = originalFetch;
      },
    };
  } catch (error) {
    runtime.Deno = originalDeno;
    globalThis.fetch = originalFetch;
    throw error;
  }
}

test('actual webhook rejects bad signatures, changed bytes, large bodies and unsupported methods before database access', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.send(f.event(), { method: 'GET' })).status, 405);
    assert.equal((await f.send(f.event(), { signature: null })).status, 401);
    assert.equal((await f.send(f.event(), { signature: '0'.repeat(64) })).status, 401);
    const raw = JSON.stringify(f.event());
    const original = createHmac('sha256', webhookSecret).update(raw).digest('hex');
    assert.equal((await f.send(raw + ' ', { signature: original })).status, 401);
    assert.equal((await f.send('x'.repeat(262145))).status, 413);
    assert.equal((await f.send(f.event(), { type: 'text/plain' })).status, 400);
    assert.equal(f.state.calls.length, 0);
    assert.deepEqual(f.state.commits, []);
  } finally {
    f.close();
  }
});

test('disabled configuration and crossed environments fail closed', async () => {
  const f = await fixture();
  try {
    f.environment.RAZORPAY_ENABLED = 'false';
    assert.equal((await f.send(f.event())).status, 503);
    assert.equal(f.state.calls.length, 0);
    f.environment.RAZORPAY_ENABLED = 'true';
    f.state.catalogMode = 'production';
    assert.equal((await f.send(f.event())).status, 503);
    f.state.catalogMode = 'development';
    f.state.attemptMode = 'live';
    assert.equal((await f.send(f.event())).status, 409);
    assert.equal(f.state.calls.includes('pay_fixture123'), false);
    assert.deepEqual(f.state.commits, []);
  } finally {
    f.close();
  }
});

test('authenticated unrelated events and unknown merchant orders are acknowledged without creating payment records', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.send({ entity: 'event', event: 'payment_link.paid' })).status, 200);
    assert.equal(f.state.calls.length, 0);
    f.state.missing = true;
    const response = await f.send(f.event());
    assert.equal(response.status, 200);
    assert.equal(response.data.ignored, true);
    assert.equal(f.state.calls.includes('pay_fixture123'), false);
    assert.deepEqual(f.state.commits, []);
  } finally {
    f.close();
  }
});

test('actual signed refund handler re-fetches provider payment and refund then commits only verified processed facts', async () => {
  const f = await fixture();
  try {
    f.state.payment.amount_refunded = 1000;
    const event = {
      entity: 'event',
      account_id: 'acc_fixture123',
      event: 'refund.processed',
      created_at: 1793293200,
      payload: { payment: { entity: f.state.payment }, refund: { entity: f.state.refund } },
    };
    assert.equal((await f.send(event, { signature: '0'.repeat(64) })).status, 401);
    assert.equal(f.state.calls.length, 0);
    const result = await f.send(event);
    assert.equal(result.status, 200);
    assert.equal(f.state.commits.length, 1);
    const commit = f.state.commits[0];
    assert.equal(commit.p_mode, 'test');
    assert.equal(commit.p_amount, 22996);
    assert.equal((commit.p_refunds as Record<string, unknown>[])[0].amount, 1000);
    assert.equal(
      (commit.p_refunds as Record<string, unknown>[])[0].timestampSource,
      'provider_event',
    );
    assert.equal(f.state.calls.at(-1), 'hpa_payment_sync_refunds');
  } finally {
    f.close();
  }
});

test('created/failed refunds are audited without reducing collection and refunded-provider gaps remain retriable', async () => {
  for (const status of ['pending', 'failed']) {
    const f = await fixture();
    try {
      f.state.refund.status = status;
      const event = {
        entity: 'event',
        account_id: 'acc_fixture123',
        event: status === 'pending' ? 'refund.created' : 'refund.failed',
        created_at: 1793293200,
        payload: { payment: { entity: f.state.payment }, refund: { entity: f.state.refund } },
      };
      assert.equal((await f.send(event)).status, 200);
      const refund = (f.state.commits[0].p_refunds as Record<string, unknown>[])[0];
      assert.equal(refund.status, status);
      assert.equal(refund.processedAt, null);
    } finally {
      f.close();
    }
  }
  const f = await fixture();
  try {
    f.state.payment.status = 'refunded';
    f.state.payment.amount_refunded = 22996;
    f.state.refund.amount = 22996;
    const event = {
      entity: 'event',
      account_id: 'acc_fixture123',
      event: 'refund.processed',
      created_at: 1793293200,
      payload: { payment: { entity: f.state.payment }, refund: { entity: f.state.refund } },
    };
    f.state.refundItems = [];
    assert.equal((await f.send(event)).status, 503);
    assert.equal(f.state.commits.length, 1);
    assert.equal(f.state.commits[0].p_evidence_amount, 22996);
    assert.equal(f.state.calls.at(-1), 'hpa_payment_flag_refund_review');
    f.state.refundItems = undefined;
    assert.equal((await f.send(event)).status, 200);
    assert.equal((f.state.commits.at(-1)!.p_refunds as Record<string, unknown>[])[0].amount, 22996);
  } finally {
    f.close();
  }
});

test('signed pending refund with zero refunded total persists only a review hold during history outage and retries safely', async () => {
  const f = await fixture();
  try {
    f.state.refund.status = 'pending';
    f.state.refundListError = true;
    const event = {
      entity: 'event',
      account_id: 'acc_fixture123',
      event: 'refund.created',
      created_at: 1793293200,
      payload: { payment: { entity: f.state.payment }, refund: { entity: f.state.refund } },
    };
    const result = await f.send(event);
    assert.equal(result.status, 502);
    assert.notEqual(result.data.received, true);
    assert.equal(f.state.payment.amount_refunded, 0);
    assert.equal(f.state.commits.length, 1);
    assert.equal(f.state.calls.at(-1), 'hpa_payment_flag_refund_review');
    assert.equal(f.state.commits[0].p_evidence_amount, 1000);
    assert.equal(f.state.commits[0].p_payment_id, 'pay_fixture123');
    assert.equal('p_refunds' in f.state.commits[0], false);
    assert.equal(f.state.calls.includes('hpa_payment_sync_refunds'), false);
    assert.equal(f.state.calls.includes('hpa_payment_apply'), false);
    assert.doesNotMatch(JSON.stringify(result.data), /PRIVATE_|synthetic-|fixture123/);

    f.state.refundListError = false;
    assert.equal((await f.send(event)).status, 200);
    assert.equal(f.state.calls.at(-1), 'hpa_payment_sync_refunds');
    const pending = (f.state.commits.at(-1)!.p_refunds as Record<string, unknown>[])[0];
    assert.equal(pending.status, 'pending');
    assert.equal(pending.processedAt, null);
    assert.equal(pending.timestampSource, null);
  } finally {
    f.close();
  }
});

test('webhook fetches the exact provider payment, checks stored amount and hashes authenticated raw bytes for replay deduplication', async () => {
  const f = await fixture();
  try {
    const response = await f.send(f.event());
    assert.equal(response.status, 200);
    assert.equal(f.state.commits.length, 1);
    assert.equal(f.state.commits[0].p_status, 'captured');
    assert.equal(f.state.commits[0].p_amount, 22996);
    assert.equal(
      f.state.commits[0].p_event_hash,
      createHash('sha256').update(response.raw).digest('hex'),
    );
    await f.send(f.event(), { eventId: 'changed-untrusted-header' });
    assert.equal(f.state.commits[0].p_event_hash, f.state.commits[1].p_event_hash);
    f.state.payment.amount = 100;
    assert.equal((await f.send(f.event())).status, 409);
    assert.equal(f.state.commits.length, 2);
  } finally {
    f.close();
  }
});

test('a failed durable commit is not acknowledged and the exact signed event can recover on retry', async () => {
  const f = await fixture();
  try {
    const event = f.event();
    f.state.commitError = true;
    const failed = await f.send(event);
    assert.equal(failed.status, 503);
    assert.notEqual(failed.data.received, true);
    assert.equal(f.state.commits.length, 0);
    assert.equal(f.state.calls.at(-1), 'hpa_payment_apply');
    assert.doesNotMatch(JSON.stringify(failed.data), /PRIVATE_|synthetic-|fixture123/);

    f.state.commitError = false;
    const retried = await f.send(event);
    assert.equal(retried.status, 200);
    assert.equal(retried.data.received, true);
    assert.equal(retried.raw, failed.raw);
    assert.equal(f.state.commits.length, 1);
    assert.equal(
      f.state.commits[0].p_event_hash,
      createHash('sha256').update(failed.raw).digest('hex'),
    );
  } finally {
    f.close();
  }
});

test('authorization stays distinct from capture and infrastructure failures remain retriable and redacted', async () => {
  const f = await fixture();
  try {
    f.state.payment.status = 'authorized';
    f.state.payment.captured = false;
    assert.equal((await f.send(f.event('authorized'))).status, 200);
    assert.equal(f.state.commits[0].p_status, 'authorized');
    for (const key of ['dbError', 'providerError', 'commitError'] as const) {
      f.state[key] = true;
      const response = await f.send(f.event('authorized'));
      assert.ok(response.status >= 500);
      assert.doesNotMatch(
        JSON.stringify(response.data),
        /PRIVATE_|synthetic-service|synthetic-key/,
      );
      f.state[key] = false;
    }
    assert.equal(f.state.commits.length, 1);
  } finally {
    f.close();
  }
});
