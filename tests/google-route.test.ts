import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';
import { build } from 'esbuild';

const origin = 'http://localhost:3001';
let previousBase: string | undefined;
let previousRender: string | undefined;

// Render supplies canonical deployment origins during npm test. Each isolated
// route fixture must use its own trusted origin and restore the inherited values.
beforeEach(() => {
  previousBase = process.env.APP_BASE_URL;
  previousRender = process.env.RENDER_EXTERNAL_URL;
  process.env.APP_BASE_URL = origin;
  delete process.env.RENDER_EXTERNAL_URL;
});

afterEach(() => {
  if (previousBase === undefined) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = previousBase;
  if (previousRender === undefined) delete process.env.RENDER_EXTERNAL_URL;
  else process.env.RENDER_EXTERNAL_URL = previousRender;
});

type RouteState = {
  providerChecks: number;
  clientCreations: number;
  oauth: unknown[];
};

/** Run the actual route and body reader with isolated provider/Auth dependencies. */
const bundledRoute = build({
  entryPoints: [resolve('app/api/auth/google/route.ts')],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  external: ['next/server'],
  plugins: [
    {
      name: 'google-route-isolated-auth',
      setup(plugin) {
        plugin.onResolve(
          { filter: /^@\/lib\/(auth\/provider|supabase\/(config|server))$/ },
          (args) => ({ path: args.path, namespace: 'isolated-auth' }),
        );
        plugin.onLoad({ filter: /.*/, namespace: 'isolated-auth' }, (args) => ({
          contents: args.path.endsWith('/provider')
            ? `export async function getGoogleProviderStatus() {
                __googleRouteState.providerChecks++;
                return 'enabled';
              }`
            : args.path.endsWith('/server')
              ? `export async function createSupabaseServerClient() {
                  __googleRouteState.clientCreations++;
                  return { auth: { signInWithOAuth: async (options) => {
                    __googleRouteState.oauth.push(options);
                    return { data: { url: 'https://unit.invalid/auth/authorize' }, error: null };
                  } } };
                }`
              : `export function getSupabasePublicConfig() {
                  return {url: 'https://unit.invalid', publishableKey: 'sb_publishable_unit'};
                }`,
          loader: 'js',
        }));
      },
    },
  ],
});

async function fixture() {
  const state: RouteState = { providerChecks: 0, clientCreations: 0, oauth: [] };
  const routeModule = { exports: {} as { POST: (request: Request) => Promise<Response> } };
  const bundle = await bundledRoute;
  new Function('require', 'module', 'exports', '__googleRouteState', bundle.outputFiles[0].text)(
    createRequire(import.meta.url),
    routeModule,
    routeModule.exports,
    state,
  );
  return { state, post: routeModule.exports.POST };
}

function form(body: BodyInit | null = 'next=%2Fcheckout', headers: HeadersInit = {}) {
  return new Request(`${origin}/api/auth/google`, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...Object.fromEntries(new Headers(headers)),
    },
    body,
  });
}

test('Google route rejects oversized, malformed, duplicate and multipart forms before provider access', async () => {
  for (const request of [
    form('next=' + 'x'.repeat(8192)),
    form('next=%2Fcheckout', { 'Content-Length': '8193' }),
    form('next=%2Fcheckout&next=%2Fadmin%2Fdashboard'),
    form('next=%2Fcheckout&extra=unexpected'),
    form('unrecognized=value'),
    form(''),
    form(null),
    form(new Uint8Array([0xff])),
    form('next=%2Fcheckout', { 'Content-Type': 'multipart/form-data; boundary=unit' }),
    form('next=%2Fcheckout', { 'Content-Type': 'application/json' }),
  ]) {
    const { state, post } = await fixture();
    const response = await post(request);
    assert.equal(response.status, 400);
    assert.match(response.headers.get('cache-control') || '', /private.*no-store/);
    assert.equal(state.providerChecks, 0);
    assert.equal(state.clientCreations, 0);
    assert.deepEqual(state.oauth, []);
  }
});

test('Google route cancels a chunked body above the byte limit without relying on Content-Length', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('next='));
      controller.enqueue(new Uint8Array(8192).fill(120));
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request(`${origin}/api/auth/google`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: stream,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  const { state, post } = await fixture();
  const response = await post(request);
  assert.equal(response.status, 400);
  assert.equal(cancelled, true);
  assert.deepEqual(state, { providerChecks: 0, clientCreations: 0, oauth: [] });
});

test('valid customer/admin Google forms keep bounded destinations and browser-bound OAuth', async () => {
  for (const next of ['/checkout', '/admin/settings', 'https://evil.invalid', '//evil.invalid']) {
    const { state, post } = await fixture();
    const response = await post(form(new URLSearchParams({ next })));
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), 'https://unit.invalid/auth/authorize');
    assert.equal(state.providerChecks, 1);
    assert.equal(state.clientCreations, 1);
    const expected = next.startsWith('/admin/')
      ? '/admin/settings'
      : next === '/checkout'
        ? next
        : '/account/profile';
    assert.deepEqual(state.oauth, [
      {
        provider: 'google',
        options: {
          scopes: 'openid email profile',
          redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(expected)}`,
          skipBrowserRedirect: true,
          ...(expected.startsWith('/admin/') ? { queryParams: { prompt: 'select_account' } } : {}),
        },
      },
    ]);
  }
});

test('Google route continues to reject absent and cross-site origins before provider access', async () => {
  const cases: HeadersInit[] = [
    { Origin: '' },
    { Origin: 'https://evil.invalid' },
    { 'Sec-Fetch-Site': 'cross-site' },
  ];
  for (const headers of cases) {
    const { state, post } = await fixture();
    assert.equal((await post(form('next=%2Fcheckout', headers))).status, 403);
    assert.deepEqual(state, { providerChecks: 0, clientCreations: 0, oauth: [] });
  }
});
