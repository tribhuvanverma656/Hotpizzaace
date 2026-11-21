import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { build } from 'esbuild';

const origin = 'https://privacy-test.invalid';
const guestCookie = 'hpa_guest_session';
const originalNonce = 'a'.repeat(64);
const user = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'hotpizzaace@gmail.com',
  email_confirmed_at: '2026-11-01T00:00:00Z',
};
type Result = { data: unknown; error: unknown };

const routeBundles = new Map<string, ReturnType<typeof build>>();
function compiledRoute(file: string) {
  if (!routeBundles.has(file))
    routeBundles.set(
      file,
      build({
        entryPoints: [resolve(file)],
        bundle: true,
        write: false,
        platform: 'node',
        format: 'cjs',
        plugins: [
          {
            name: 'isolated-auth-context',
            setup(plugin) {
              plugin.onResolve(
                { filter: /^(server-only|next\/headers|next\/server)$/ },
                ({ path }) => ({ path, external: true }),
              );
              plugin.onResolve({ filter: /^@\/lib\/supabase\/server$/ }, () => ({
                path: 'hpa:test-auth',
                external: true,
              }));
              plugin.onResolve({ filter: /^@\// }, ({ path }) => ({
                path: resolve(`${path.slice(2)}.ts`),
              }));
            },
          },
        ],
      }),
    );
  return routeBundles.get(file)!;
}

async function fixture(context: TestContext) {
  const env = {
    APP_BASE_URL: origin,
    NEXT_PUBLIC_SUPABASE_URL: 'https://privacy-test.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  };
  for (const [name, value] of Object.entries(env)) {
    const previous = process.env[name];
    process.env[name] = value;
    context.after(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
  }
  const values = new Map([[guestCookie, originalNonce]]);
  const writes: { name: string; value: string; options: Record<string, unknown> }[] = [];
  const state = {
    user: user as typeof user | null,
    userError: null as unknown,
    exchangeError: null as unknown,
    passwordError: null as unknown,
    signoutError: null as unknown,
    signoutThrows: false,
    signouts: 0,
  };
  const auth = {
    getUser: async (): Promise<Result> => ({ data: { user: state.user }, error: state.userError }),
    exchangeCodeForSession: async () => ({
      data: { user: state.user, redirectType: null },
      error: state.exchangeError,
    }),
    signInWithPassword: async () => ({ data: { user: state.user }, error: state.passwordError }),
    signOut: async () => {
      ++state.signouts;
      // Mirrors the SDK's local-cookie clearing even on an unexpected remote error.
      state.user = null;
      if (state.signoutThrows) throw new Error('simulated remote outage');
      return { error: state.signoutError };
    },
  };
  const cookieStore = {
    get: (name: string) => (values.has(name) ? { name, value: values.get(name) } : undefined),
    getAll: () => Array.from(values, ([name, value]) => ({ name, value })),
    set: (name: string, value: string, options: Record<string, unknown>) => {
      values.set(name, value);
      writes.push({ name, value, options });
    },
  };
  const originalRequire = createRequire(import.meta.url);
  async function route(file: string) {
    const routeModule = { exports: {} };
    new Function('require', 'module', 'exports', (await compiledRoute(file)).outputFiles![0].text)(
      (name: string) =>
        name === 'server-only'
          ? {}
          : name === 'next/headers'
            ? { cookies: async () => cookieStore }
            : name === 'hpa:test-auth'
              ? { createSupabaseServerClient: async () => ({ auth }) }
              : originalRequire(name),
      routeModule,
      routeModule.exports,
    );
    return routeModule.exports as {
      GET: (request: Request) => Promise<Response>;
      POST: (request: Request) => Promise<Response>;
    };
  }
  const request = (path: string, method = 'GET', requestOrigin = origin) =>
    new Request(`${origin}${path}`, {
      method,
      headers: {
        origin: requestOrigin,
        accept: 'application/json',
        ...(method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      },
      ...(method === 'POST'
        ? {
            body: new URLSearchParams({
              action: 'signin',
              email: user.email,
              password: 'fictional-test-only',
              next: '/admin/dashboard',
            }),
          }
        : {}),
    });
  function assertRotated() {
    assert.equal(writes.length, 1);
    assert.equal(writes[0].name, guestCookie);
    assert.match(writes[0].value, /^[a-f0-9]{64}$/);
    assert.notEqual(writes[0].value, originalNonce);
    assert.deepEqual(writes[0].options, {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/',
      maxAge: 7776000,
    });
  }
  return { state, values, writes, route, request, assertRotated };
}

test('real Google callback rotates guest capability only after successful verified sign-in', async (context) => {
  const f = await fixture(context);
  const route = await f.route('app/auth/callback/route.ts');
  const success = await route.GET(f.request('/auth/callback?code=fictional&next=/checkout'));
  assert.equal(new URL(success.headers.get('location')!).pathname, '/checkout');
  f.assertRotated();
});

test('cancelled, rejected and unverified callbacks preserve the current anonymous checkout', async (context) => {
  for (const failure of ['cancel', 'exchange', 'identity']) {
    const f = await fixture(context);
    const route = await f.route('app/auth/callback/route.ts');
    if (failure === 'exchange') f.state.exchangeError = { name: 'AuthApiError' };
    if (failure === 'identity') f.state.user = null;
    const response = await route.GET(
      f.request(
        `/auth/callback?code=fictional&next=/checkout${failure === 'cancel' ? '&error=access_denied' : ''}`,
      ),
    );
    assert.match(response.headers.get('location')!, /auth_error=/);
    assert.equal(f.values.get(guestCookie), originalNonce);
    assert.deepEqual(f.writes, []);
  }
});

test('real password sign-in rotates only verified credentials, never failed attempts or cross-origin requests', async (context) => {
  const f = await fixture(context);
  const route = await f.route('app/api/auth/password/route.ts');
  f.state.passwordError = { code: 'invalid_credentials' };
  assert.match(
    (await route.POST(f.request('/api/auth/password', 'POST'))).headers.get('location')!,
    /invalid_credentials/,
  );
  assert.deepEqual(f.writes, []);
  f.state.passwordError = null;
  assert.equal(
    (await route.POST(f.request('/api/auth/password', 'POST', 'https://attacker.invalid'))).status,
    403,
  );
  assert.deepEqual(f.writes, []);
  assert.equal(
    new URL((await route.POST(f.request('/api/auth/password', 'POST'))).headers.get('location')!)
      .pathname,
    '/admin/dashboard',
  );
  f.assertRotated();
});

test('same-origin sign-out always discards guest capability even if SDK cleared auth then returned an error', async (context) => {
  for (const failure of ['none', 'returned', 'thrown']) {
    const f = await fixture(context);
    const route = await f.route('app/auth/signout/route.ts');
    f.state.signoutError = failure === 'returned' ? { code: 'unexpected_failure' } : null;
    f.state.signoutThrows = failure === 'thrown';
    const response = await route.POST(f.request('/auth/signout', 'POST'));
    assert.equal(response.status, failure === 'none' ? 200 : 503);
    f.assertRotated();
  }
  const f = await fixture(context);
  const route = await f.route('app/auth/signout/route.ts');
  assert.equal(
    (await route.POST(f.request('/auth/signout', 'POST', 'https://attacker.invalid'))).status,
    403,
  );
  assert.deepEqual(f.writes, []);
  assert.equal(f.state.signouts, 0);
});

test('session context partitions account switches and anonymous cycles without exposing or rotating the bearer nonce', async (context) => {
  const f = await fixture(context);
  const route = await f.route('app/api/auth/session/route.ts');
  const read = async () => {
    const response = await route.GET(f.request('/api/auth/session'));
    assert.equal(response.headers.get('vary'), 'Cookie');
    assert.match(response.headers.get('cache-control')!, /private.*no-store/);
    return { response, data: await response.json() };
  };
  f.state.user = null;
  const firstGuest = (await read()).data;
  assert.match(firstGuest.contextId, /^[a-f0-9]{64}$/);
  assert.notEqual(firstGuest.contextId, originalNonce);
  assert.equal((await read()).data.contextId, firstGuest.contextId);
  f.state.user = user;
  const signedIn = (await read()).data;
  assert.notEqual(signedIn.contextId, firstGuest.contextId);
  f.state.user = { ...user, id: '22222222-2222-4222-8222-222222222222' };
  assert.notEqual((await read()).data.contextId, signedIn.contextId);
  assert.deepEqual(f.writes, []);
  f.state.user = null;
  f.values.set(guestCookie, 'b'.repeat(64));
  assert.notEqual((await read()).data.contextId, firstGuest.contextId);
  f.values.delete(guestCookie);
  const bootstrapped = (await read()).data;
  assert.match(bootstrapped.contextId, /^[a-f0-9]{64}$/);
  f.assertRotated();
  f.state.userError = { name: 'AuthRetryableFetchError' };
  const failed = await read();
  assert.equal(failed.response.status, 503);
  assert.equal(failed.data.contextId, null);
  assert.equal(f.writes.length, 1);
});
