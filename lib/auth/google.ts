const customerDestinations = new Set([
  '/account/profile',
  '/account/orders',
  '/account/addresses',
  '/checkout',
]);

export function safeCustomerNext(value: unknown): string {
  return typeof value === 'string' && customerDestinations.has(value) ? value : '/account/profile';
}

const adminDestinations = new Set([
  '/admin/dashboard',
  '/admin/orders',
  '/admin/kitchen',
  '/admin/counter',
  '/admin/dine-in-qr',
  '/admin/products',
  '/admin/categories',
  '/admin/customers',
  '/admin/branches',
  '/admin/settings',
]);

export function safeAdminNext(value: unknown): string {
  return typeof value === 'string' && adminDestinations.has(value) ? value : '/admin/dashboard';
}

/** A return destination is navigation only; server membership checks authorize every admin action. */
export function safeAuthNext(value: unknown): string {
  return typeof value === 'string' &&
    (adminDestinations.has(value) || value === '/auth/reset-password')
    ? value
    : safeCustomerNext(value);
}

export function authLoginPath(next: string): string {
  return adminDestinations.has(next) || next === '/auth/reset-password'
    ? '/admin/login'
    : '/account/login';
}

type OriginEnvironment = { APP_BASE_URL?: string; RENDER_EXTERNAL_URL?: string };

function validatedOrigin(value: string): string {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Configure an HTTPS application origin without a path or credentials.');
  return url.origin;
}

/** Hosted redirects use deployment config; local wildcard listeners accept only loopback hosts. */
export function getRequestOrigin(
  request: Request,
  environment: OriginEnvironment = {
    APP_BASE_URL: process.env.APP_BASE_URL,
    RENDER_EXTERNAL_URL: process.env.RENDER_EXTERNAL_URL,
  },
): string {
  const configured = environment.APP_BASE_URL?.trim() || environment.RENDER_EXTERNAL_URL?.trim();
  if (configured) return validatedOrigin(configured);
  const requestUrl = new URL(request.url);
  // Next's wildcard listener builds route URLs using 0.0.0.0. Only a loopback Host
  // with the same listening port may normalize this local-development address.
  if (requestUrl.hostname === '0.0.0.0' || requestUrl.hostname === '[::]') {
    const host = request.headers.get('host');
    if (host) {
      const candidate = new URL(`${requestUrl.protocol}//${host}`);
      if (
        ['localhost', '127.0.0.1', '[::1]'].includes(candidate.hostname) &&
        candidate.port === requestUrl.port &&
        !candidate.username &&
        !candidate.password &&
        !candidate.search &&
        !candidate.hash &&
        candidate.pathname === '/'
      )
        return validatedOrigin(candidate.origin);
    }
  }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(requestUrl.hostname))
    throw new Error('Configure the canonical application URL before enabling hosted sign-in.');
  return validatedOrigin(requestUrl.origin);
}

export function getAuthFailureMessage(code: string | null): string {
  if (!code) return '';
  if (code === 'access_denied')
    return 'Google sign-in was cancelled. You can try again when you’re ready.';
  if (code === 'provider_unavailable')
    return 'Google sign-in is not available yet. Please try again after the restaurant completes its Google account setup.';
  return 'We couldn’t complete your sign-in. Please start again from this page.';
}
