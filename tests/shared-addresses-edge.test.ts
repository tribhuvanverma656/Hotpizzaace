import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import type { SharedAddressBook, SharedSavedAddress } from '../lib/commerce/addresses';

const firstUser = '11111111-1111-4111-8111-111111111111';
const secondUser = '22222222-2222-4222-8222-222222222222';
const firstToken = 'a'.repeat(64);
const secondToken = 'b'.repeat(64);
const address: SharedSavedAddress = {
  id: '33333333-3333-4333-8333-333333333333',
  label: 'QA home',
  isDefault: true,
  customer: {
    name: 'Fictional Customer',
    phone: '9000000001',
    address: '12 Fictional Test Road',
    locality: 'Barra',
    postalCode: '208027',
    landmark: '',
    instructions: '',
  },
};

/** Execute the actual Edge entrypoint/SDK against an isolated Auth and database transport. */
async function edgeFixture() {
  const originalFetch = globalThis.fetch;
  const runtime = globalThis as typeof globalThis & { Deno?: unknown };
  const originalDeno = runtime.Deno;
  let handler: ((request: Request) => Promise<Response>) | undefined;
  const books = new Map<string, SharedAddressBook>([
    [firstUser, { revision: 1, addresses: [structuredClone(address)] }],
    [secondUser, { revision: 0, addresses: [] }],
  ]);
  const calls: { name: string; body: Record<string, unknown> }[] = [];
  let mode: 'normal' | 'conflict' | 'unavailable' = 'normal';
  runtime.Deno = {
    env: {
      get: (name: string) =>
        ({
          SUPABASE_URL: 'https://address-unit.invalid',
          SUPABASE_SERVICE_ROLE_KEY: 'unit-only-service-key',
        })[name],
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
      if (![firstToken, secondToken].includes(token || ''))
        return Response.json({ message: 'Invalid JWT', code: 'bad_jwt' }, { status: 401 });
      return Response.json({
        id: token === firstToken ? firstUser : secondUser,
        email: token === firstToken ? 'owner@unit.invalid' : 'customer@unit.invalid',
        email_confirmed_at: '2026-01-01T00:00:00Z',
        is_anonymous: false,
        aud: 'authenticated',
        role: 'authenticated',
        user_metadata: {},
        app_metadata: {},
      });
    }
    if (url.pathname === '/rest/v1/hpa_admin_memberships')
      return Response.json(
        url.searchParams.get('user_id') === `eq.${firstUser}` ? [{ role: 'owner' }] : [],
      );
    const name = url.pathname.split('/').at(-1)!;
    const body = JSON.parse(String(options?.body || '{}')) as Record<string, unknown>;
    calls.push({ name, body });
    if (name === 'hpa_consume_rate_limit') return Response.json(true);
    if (name === 'hpa_get_address_book') {
      if (mode === 'unavailable')
        return Response.json(
          { code: 'XX000', message: 'private database diagnostic' },
          { status: 500 },
        );
      return Response.json(books.get(String(body.p_user_id)) || { revision: 0, addresses: [] });
    }
    if (name === 'hpa_replace_address_book') {
      const current = books.get(String(body.p_user_id))!;
      if (mode === 'conflict' || body.p_expected_revision !== current.revision)
        return Response.json(
          { code: 'P0001', message: 'address_revision_conflict' },
          { status: 400 },
        );
      const next = {
        revision: current.revision + 1,
        addresses: body.p_addresses as SharedSavedAddress[],
      };
      books.set(String(body.p_user_id), structuredClone(next));
      return Response.json(next);
    }
    throw new Error(`Unexpected isolated request: ${url.pathname}`);
  };
  try {
    const bundle = await build({
      entryPoints: [resolve('supabase/functions/hpa-commerce/index.ts')],
      bundle: true,
      write: false,
      platform: 'node',
      format: 'cjs',
      plugins: [
        {
          name: 'edge-unit-imports',
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
    const edgeModule = { exports: {} };
    new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(
      createRequire(import.meta.url),
      edgeModule,
      edgeModule.exports,
    );
    assert.ok(handler, 'The real Edge entrypoint must register its handler.');
    return {
      books,
      calls,
      setMode: (next: typeof mode) => {
        mode = next;
      },
      request: async (method: string, body?: unknown, token?: string) => {
        const response = await handler!(
          new Request('https://address-unit.invalid/functions/v1/hpa-commerce', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              method,
              path: ['addresses'],
              query: {},
              guestSession: '0'.repeat(64),
              body: body ?? null,
            }),
          }),
        );
        assert.match(response.headers.get('cache-control') || '', /private.*no-store/);
        return { status: response.status, data: await response.json() };
      },
      close: () => {
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

test('Edge address reads require verified Auth and derive ownership even for an administrator', async () => {
  const edge = await edgeFixture();
  try {
    assert.equal((await edge.request('GET')).status, 401);
    assert.equal((await edge.request('GET', null, 'c'.repeat(64))).status, 401);
    assert.equal(edge.calls.filter((call) => call.name === 'hpa_get_address_book').length, 0);
    assert.deepEqual((await edge.request('GET', null, firstToken)).data, edge.books.get(firstUser));
    assert.deepEqual((await edge.request('GET', null, secondToken)).data, {
      revision: 0,
      addresses: [],
    });
    assert.deepEqual(
      edge.calls
        .filter((call) => call.name === 'hpa_get_address_book')
        .map((call) => call.body.p_user_id),
      [firstUser, secondUser],
    );
  } finally {
    edge.close();
  }
});

test('Edge rejects owner injection and cannot update or delete another customer address', async () => {
  const edge = await edgeFixture();
  try {
    const remove = { action: 'remove', id: address.id, expectedRevision: 0 };
    assert.equal((await edge.request('POST', remove)).status, 401);
    assert.equal(
      (await edge.request('POST', { ...remove, user_id: firstUser }, secondToken)).status,
      400,
    );
    assert.equal((await edge.request('POST', remove, secondToken)).status, 404);
    assert.equal(edge.calls.filter((call) => call.name === 'hpa_replace_address_book').length, 0);
    assert.equal(edge.books.get(firstUser)?.addresses.length, 1);
  } finally {
    edge.close();
  }
});

test('Edge commits a customer address to that user only and exposes the updated revision', async () => {
  const edge = await edgeFixture();
  try {
    const result = await edge.request(
      'POST',
      { action: 'create', expectedRevision: 0, address },
      secondToken,
    );
    assert.equal(result.status, 200);
    assert.equal(result.data.revision, 1);
    const commit = edge.calls.find((call) => call.name === 'hpa_replace_address_book')!;
    assert.equal(commit.body.p_user_id, secondUser);
    assert.deepEqual((await edge.request('GET', null, secondToken)).data, result.data);
    assert.equal(edge.books.get(firstUser)?.revision, 1);
  } finally {
    edge.close();
  }
});

test('Edge rejects stale writes and maps a database race without retry or private diagnostics', async () => {
  const edge = await edgeFixture();
  try {
    const mutation = { action: 'remove', id: address.id, expectedRevision: 0 };
    const stale = await edge.request('POST', mutation, firstToken);
    assert.equal(stale.status, 409);
    assert.equal(stale.data.code, 'address_revision_conflict');
    assert.equal(edge.calls.filter((call) => call.name === 'hpa_replace_address_book').length, 0);
    edge.setMode('conflict');
    const race = await edge.request('POST', { ...mutation, expectedRevision: 1 }, firstToken);
    assert.equal(race.status, 409);
    assert.equal(race.data.code, 'address_revision_conflict');
    assert.equal(edge.calls.filter((call) => call.name === 'hpa_replace_address_book').length, 1);
    edge.setMode('unavailable');
    const outage = await edge.request('GET', null, firstToken);
    assert.equal(outage.status, 503);
    assert.doesNotMatch(
      JSON.stringify(outage.data),
      /private database diagnostic|unit-only-service-key|9000000001/,
    );
    assert.equal(edge.books.get(firstUser)?.addresses.length, 1);
  } finally {
    edge.close();
  }
});
