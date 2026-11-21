/** Server gateway logic is dependency-injected so cookie isolation and CSRF are testable. */
export const kitchenPrivateHeaders = {
  'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
  Vary: 'Cookie',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

const ACCESS = 'hpa_kitchen_access';
const REFRESH = 'hpa_kitchen_refresh';
const DEADLINE = 'hpa_kitchen_deadline';
const ACCESS_EXPIRY = 'hpa_kitchen_access_expiry';
const CHUNK_LENGTH = 2800;
const MAX_CHUNKS = 6;
const MAX_SESSION_MS = 12 * 60 * 60 * 1000;
const BODY_LIMIT = 8192;
const RESPONSE_LIMIT = 2 * 1024 * 1024;
const TOKEN = /^[A-Za-z0-9._~-]+$/;

export type KitchenCookieOptions = {
  path: '/kitchen';
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  maxAge: number;
};
export type KitchenCookieStore = {
  getAll: () => { name: string; value: string }[];
  set: (name: string, value: string, options: KitchenCookieOptions) => void;
};
export type KitchenGatewayDependencies = {
  config: () => { url: string; publishableKey: string };
  origin: (request: Request) => string;
  cookies: () => Promise<KitchenCookieStore>;
  ownerToken: () => Promise<string | null>;
  fetch: typeof fetch;
  now?: () => number;
};

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
const messages: Record<string, string> = {
  kitchen_disabled: 'Kitchen staff access is not enabled.',
  invalid_credentials: 'Check your username and password, or ask the owner for help.',
  auth_required: 'Please sign in to the kitchen again.',
  session_expired: 'Your kitchen session has ended. Please sign in again.',
  session_revoked: 'Your kitchen access changed. Please sign in again.',
  forbidden: 'This action is not allowed for your account.',
  owner_required: 'Sign in with the authorized owner account.',
  reauth_required: 'Confirm your current owner password to continue.',
  owner_reauth_required: 'Confirm your current owner password to continue.',
  invalid_request: 'Check the entered details and try again.',
  password_requirements: 'Choose a password between 12 and 128 characters.',
  password_mismatch: 'The new passwords do not match.',
  username_unavailable: 'Choose a different username.',
  username_exists: 'Choose a different username.',
  invalid_username:
    'Use 3–32 letters, numbers, dots, underscores or hyphens, starting with a letter.',
  branch_not_found: 'Choose an existing branch.',
  version_conflict: 'This record changed. Refresh it before trying again.',
  order_not_found: 'This preparation ticket is no longer available.',
  order_not_eligible: 'This order is no longer eligible for preparation. Refresh the queue.',
  rate_limited: 'Too many attempts. Wait a moment before trying again.',
  reset_incomplete: 'Password reset is incomplete. Access remains blocked; retry from Admin.',
  provisioning_incomplete: 'Account setup is incomplete. Access remains blocked; retry from Admin.',
  staff_reset_failed: 'Password reset is incomplete. Access remains blocked; retry from Admin.',
  staff_provisioning_failed:
    'Account setup is incomplete. Access remains blocked; retry from Admin.',
  kitchen_operation_pending:
    'A credential update is pending. Retry password reset after 15 minutes.',
};
function failure(code: string, status: number) {
  const safeCode =
    Object.hasOwn(messages, code) || code === 'not_found' ? code : 'kitchen_unavailable';
  return Response.json(
    {
      code: safeCode,
      error: messages[safeCode] ?? 'Kitchen access is temporarily unavailable. Please try again.',
    },
    { status, headers: kitchenPrivateHeaders },
  );
}

async function boundedJson(source: Request | Response, limit: number): Promise<unknown> {
  if (source.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json')
    throw new Error('invalid_json');
  if (Number(source.headers.get('content-length')) > limit) throw new Error('body_limit');
  const reader = source.body?.getReader();
  if (!reader) throw new Error('invalid_json');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error('body_limit');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

function tokenCookie(store: KitchenCookieStore, prefix: string) {
  const parts = store.getAll().filter(({ name }) => name.startsWith(`${prefix}.`));
  if (!parts.length || parts.length > MAX_CHUNKS) return null;
  const values: string[] = [];
  for (let index = 0; index < parts.length; index++) {
    const matches = parts.filter(({ name }) => name === `${prefix}.${index}`);
    if (
      matches.length !== 1 ||
      !TOKEN.test(matches[0].value) ||
      matches[0].value.length > CHUNK_LENGTH
    )
      return null;
    values.push(matches[0].value);
  }
  return values.join('');
}
function metadataCookie(store: KitchenCookieStore, name: string) {
  const matching = store.getAll().filter((cookie) => cookie.name === name);
  return matching.length === 1 && /^\d{13}$/.test(matching[0].value)
    ? Number(matching[0].value)
    : 0;
}
function ourCookie(name: string) {
  return (
    name === DEADLINE ||
    name === ACCESS_EXPIRY ||
    new RegExp(`^(?:${ACCESS}|${REFRESH})\\.[0-5]$`).test(name)
  );
}
function clearSession(store: KitchenCookieStore, options: KitchenCookieOptions) {
  // Never clear, read or replace a Supabase owner/customer session or guest cart cookie.
  for (const { name } of store.getAll())
    if (ourCookie(name)) store.set(name, '', { ...options, maxAge: 0 });
}
function writeToken(
  store: KitchenCookieStore,
  prefix: string,
  value: string,
  options: KitchenCookieOptions,
) {
  for (let index = 0; index * CHUNK_LENGTH < value.length; index++)
    store.set(
      `${prefix}.${index}`,
      value.slice(index * CHUNK_LENGTH, (index + 1) * CHUNK_LENGTH),
      options,
    );
}
function saveSession(
  value: Record<string, unknown>,
  store: KitchenCookieStore,
  options: KitchenCookieOptions,
  now: number,
  previousDeadline?: number,
) {
  if (!record(value.session) || !record(value.profile)) throw new Error('invalid_session');
  const { accessToken, refreshToken, expiresAt } = value.session;
  const deadline = Date.parse(String(value.profile.expiresAt));
  const accessExpiry = Date.parse(String(expiresAt));
  if (
    typeof accessToken !== 'string' ||
    !TOKEN.test(accessToken) ||
    accessToken.length > CHUNK_LENGTH * MAX_CHUNKS ||
    typeof refreshToken !== 'string' ||
    !TOKEN.test(refreshToken) ||
    refreshToken.length > CHUNK_LENGTH * MAX_CHUNKS ||
    !Number.isFinite(deadline) ||
    deadline <= now ||
    deadline > now + MAX_SESSION_MS + 60_000 ||
    !Number.isFinite(accessExpiry) ||
    accessExpiry <= now ||
    accessExpiry > deadline + 1000 ||
    (previousDeadline !== undefined && deadline !== previousDeadline)
  )
    throw new Error('invalid_session');
  clearSession(store, options);
  const settings = { ...options, maxAge: Math.max(1, Math.floor((deadline - now) / 1000)) };
  writeToken(store, ACCESS, accessToken, settings);
  writeToken(store, REFRESH, refreshToken, settings);
  store.set(DEADLINE, String(deadline), settings);
  store.set(ACCESS_EXPIRY, String(accessExpiry), settings);
  return { accessToken, profile: value.profile };
}

function publicResult(path: string[], value: Record<string, unknown>) {
  const route = path.join('/');
  if (route === 'auth/login' || route === 'session') return { profile: value.profile };
  if (route === 'auth/logout') return { ok: true };
  if (route === 'queue')
    return {
      profile: value.profile,
      tickets: value.tickets,
      complete: value.complete,
      // Older backend deployments omit the read-only "Ready today" list.
      ready: Array.isArray(value.ready) ? value.ready : [],
    };
  if (path[0] === 'orders') return { profile: value.profile, ticket: value.ticket };
  if (path[0] === 'admin')
    return { staff: value.staff, ...(value.branches ? { branches: value.branches } : {}) };
  return {};
}

/** Fixed routes prevent the chef gateway from becoming an owner or Auth API proxy. */
export async function handleKitchenGateway(
  request: Request,
  path: string[],
  dependencies: KitchenGatewayDependencies,
  owner = false,
): Promise<Response> {
  const route = path.join('/');
  const allowed = owner
    ? (route === 'admin/staff' && ['GET', 'POST'].includes(request.method)) ||
      (path.length === 3 &&
        path[0] === 'admin' &&
        path[1] === 'staff' &&
        /^[a-f0-9-]{36}$/.test(path[2]) &&
        request.method === 'PATCH')
    : (['session', 'queue'].includes(route) && request.method === 'GET') ||
      (['auth/login', 'auth/logout'].includes(route) && request.method === 'POST') ||
      (path.length === 2 &&
        path[0] === 'orders' &&
        /^[a-f0-9-]{36}$/.test(path[1]) &&
        request.method === 'PATCH');
  if (!allowed) return failure('not_found', 404);
  let origin: string;
  try {
    origin = dependencies.origin(request);
  } catch {
    return failure('kitchen_unavailable', 503);
  }
  if (
    request.method !== 'GET' &&
    (request.headers.get('origin') !== origin ||
      (request.headers.get('sec-fetch-site') !== null &&
        request.headers.get('sec-fetch-site') !== 'same-origin'))
  )
    return failure('forbidden', 403);
  let body: unknown;
  if (request.method !== 'GET') {
    try {
      body = await boundedJson(request, BODY_LIMIT);
      if (!record(body)) return failure('invalid_request', 400);
    } catch (error) {
      return failure(
        'invalid_request',
        error instanceof Error && error.message === 'body_limit' ? 413 : 400,
      );
    }
  }
  const now = (dependencies.now ?? Date.now)();
  const options: KitchenCookieOptions = {
    path: '/kitchen',
    httpOnly: true,
    sameSite: 'lax',
    secure: origin.startsWith('https://'),
    maxAge: 0,
  };
  let store: KitchenCookieStore | undefined;
  try {
    const { url, publishableKey } = dependencies.config();
    const forward = async (
      method: string,
      endpoint: string[],
      token?: string | null,
      payload?: unknown,
    ) => {
      const response = await dependencies.fetch(
        `${url}/functions/v1/hpa-kitchen/${endpoint.join('/')}`,
        {
          method,
          headers: {
            apikey: publishableKey,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
          cache: 'no-store',
          redirect: 'error',
          signal: AbortSignal.timeout(20_000),
        },
      );
      const value = await boundedJson(response, RESPONSE_LIMIT);
      if (!record(value)) throw new Error('invalid_response');
      return { response, value };
    };
    if (owner) {
      const token = await dependencies.ownerToken();
      if (!token) return failure('owner_required', 401);
      const result = await forward(request.method, path, token, body);
      if (!result.response.ok)
        return failure(String(result.value.code ?? 'kitchen_unavailable'), result.response.status);
      return Response.json(publicResult(path, result.value), { headers: kitchenPrivateHeaders });
    }
    store = await dependencies.cookies();
    if (route === 'auth/login') {
      const result = await forward('POST', path, undefined, body);
      if (!result.response.ok) {
        clearSession(store, options);
        return failure(String(result.value.code ?? 'invalid_credentials'), result.response.status);
      }
      const saved = saveSession(result.value, store, options, now);
      return Response.json({ profile: saved.profile }, { headers: kitchenPrivateHeaders });
    }
    let token = tokenCookie(store, ACCESS);
    const refreshToken = tokenCookie(store, REFRESH);
    const deadline = metadataCookie(store, DEADLINE);
    if (
      (token || refreshToken) &&
      (!deadline || deadline <= now || deadline > now + MAX_SESSION_MS + 60_000)
    ) {
      clearSession(store, options);
      return failure('session_expired', 401);
    }
    const refresh = async () => {
      if (!refreshToken || !deadline) return null;
      const result = await forward('POST', ['auth', 'refresh'], undefined, { refreshToken });
      if (!result.response.ok) return result;
      const saved = saveSession(result.value, store!, options, now, deadline);
      token = saved.accessToken;
      return null;
    };
    let refreshed = false;
    if (refreshToken && (!token || metadataCookie(store, ACCESS_EXPIRY) <= now + 15_000)) {
      const error = await refresh();
      refreshed = true;
      if (error) {
        if (
          route === 'auth/logout' ||
          error.response.status === 401 ||
          error.response.status === 403
        )
          clearSession(store, options);
        return failure(String(error.value.code ?? 'auth_required'), error.response.status);
      }
    }
    if (route === 'auth/logout' && !token) {
      clearSession(store, options);
      return Response.json({ ok: true }, { headers: kitchenPrivateHeaders });
    }
    let result = await forward(request.method, path, token, body);
    // A 401 precedes mutations. Retry the identical version-checked request after one refresh only.
    if (result.response.status === 401 && refreshToken && !refreshed) {
      const error = await refresh();
      if (error) result = error;
      else result = await forward(request.method, path, token, body);
    }
    if (route === 'auth/logout' || result.response.status === 401 || result.response.status === 403)
      clearSession(store, options);
    if (!result.response.ok)
      return failure(String(result.value.code ?? 'kitchen_unavailable'), result.response.status);
    return Response.json(publicResult(path, result.value), { headers: kitchenPrivateHeaders });
  } catch {
    if (route === 'auth/logout' && store) clearSession(store, options);
    return failure('kitchen_unavailable', 503);
  }
}
