import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { build } from 'esbuild';

const compiled = build({
  entryPoints: [resolve('lib/commerce/server.ts')],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  plugins: [
    {
      name: 'isolate-next-request-context',
      setup(plugin) {
        plugin.onResolve({ filter: /^(server-only|next\/headers)$/ }, (args) => ({
          path: args.path,
          external: true,
        }));
        plugin.onResolve({ filter: /\.\.\/supabase\/server$/ }, () => ({
          path: 'hpa:test-server-auth',
          external: true,
        }));
      },
    },
  ],
});
async function fixture(context: TestContext) {
  const env = {
    COMMERCE_ENABLED: 'true',
    APP_BASE_URL: 'https://counter.invalid',
    NEXT_PUBLIC_SUPABASE_URL: 'https://proxy-test.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  };
  for (const [key, value] of Object.entries(env)) {
    const previous = process.env[key];
    process.env[key] = value;
    context.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
  const cookies = new Map<string, string>();
  const cookieStore = {
    get: (name: string) => (cookies.has(name) ? { value: cookies.get(name) } : undefined),
    set: (name: string, value: string) => cookies.set(name, value),
  };
  const auth = { getUser: async () => ({ data: { user: null }, error: null }) };
  const output = { exports: {} };
  const originalRequire = createRequire(import.meta.url);
  new Function('require', 'module', 'exports', (await compiled).outputFiles[0].text)(
    (name: string) =>
      name === 'server-only'
        ? {}
        : name === 'next/headers'
          ? { cookies: async () => cookieStore }
          : name === 'hpa:test-server-auth'
            ? { createSupabaseServerClient: async () => ({ auth }) }
            : originalRequire(name),
    output,
    output.exports,
  );
  const proxy = (
    output.exports as { proxyCommerce: (request: Request, path: string[]) => Promise<Response> }
  ).proxyCommerce;
  const calls: Record<string, unknown>[] = [];
  context.mock.method(
    globalThis,
    'fetch',
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      return Response.json({ ok: true });
    },
  );
  const request = (path: string, origin = 'https://counter.invalid') =>
    new Request(`https://counter.invalid/api/commerce/${path}`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ fictional: true }),
    });
  return { proxy, cookies, calls, request };
}

test('same-origin commerce proxy forwards a five-segment counter settlement but rejects longer and cross-origin mutations', async (context) => {
  const { proxy, cookies, calls, request } = await fixture(context);
  cookies.set('hpa_guest_session', 'a'.repeat(64));
  const path = ['admin', 'counter', 'orders', '33333333-3333-4333-8333-333333333333', 'settle'];
  assert.equal((await proxy(request(path.join('/')), path)).status, 200);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].path, path);
  assert.equal(
    (await proxy(request([...path, 'extra'].join('/')), [...path, 'extra'])).status,
    404,
  );
  assert.equal(
    (await proxy(request(path.join('/'), 'https://attacker.invalid'), path)).status,
    403,
  );
  assert.equal(calls.length, 1);
});

test('first table request initializes one stable HttpOnly guest nonce before any Edge mutation', async (context) => {
  const { proxy, cookies, calls, request } = await fixture(context);
  const path = ['table', 'b'.repeat(64), 'requests'];
  const first = await proxy(request(path.join('/')), path);
  assert.equal(first.status, 409);
  assert.equal((await first.json()).code, 'guest_session_initialized');
  assert.equal(calls.length, 0);
  const nonce = cookies.get('hpa_guest_session');
  assert.match(nonce ?? '', /^[a-f0-9]{64}$/);
  assert.equal((await proxy(request(path.join('/')), path)).status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].guestSession, nonce);
  assert.equal((await proxy(request(path.join('/')), path)).status, 200);
  assert.equal(calls[1].guestSession, nonce);
});
