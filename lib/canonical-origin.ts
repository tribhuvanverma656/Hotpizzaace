type CanonicalEnvironment = { APP_BASE_URL?: string; RENDER_EXTERNAL_URL?: string };

function httpsOrigin(value: string | undefined): URL | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      return null;
    return url;
  } catch {
    return null;
  }
}

/** Only configured aliases select a redirect; the destination never comes from request headers. */
export function canonicalPageRedirect(
  request: Request,
  environment: CanonicalEnvironment = {
    APP_BASE_URL: process.env.APP_BASE_URL,
    RENDER_EXTERNAL_URL: process.env.RENDER_EXTERNAL_URL,
  },
): URL | null {
  // Redirecting a POST would replay it on another origin and interfere with CSRF checks.
  if (request.method !== 'GET') return null;
  const canonical = httpsOrigin(environment.APP_BASE_URL);
  if (!canonical) return null;

  const incoming = new URL(request.url);
  if (
    incoming.pathname === '/api' ||
    incoming.pathname.startsWith('/api/') ||
    incoming.pathname.startsWith('/_next/') ||
    /\/[^/]+\.[^/]+$/.test(incoming.pathname)
  )
    return null;

  const aliases = new Set<string>();
  if (!canonical.hostname.startsWith('www.')) aliases.add(`www.${canonical.hostname}`);
  const render = httpsOrigin(environment.RENDER_EXTERNAL_URL);
  if (render?.hostname.endsWith('.onrender.com')) aliases.add(render.hostname);
  aliases.delete(canonical.hostname);

  const host = request.headers.get('host') ?? incoming.host;
  // Match an exact DNS authority only; ignore forwarded headers, ports and URL-like Host values.
  if (!/^[a-z0-9.-]+(?::443)?$/i.test(host)) return null;
  const hostname = host.toLowerCase().replace(/:443$/, '');
  if (!aliases.has(hostname)) return null;

  const destination = new URL(canonical.origin);
  // Assignment preserves query strings without allowing a //path to replace the trusted host.
  destination.pathname = incoming.pathname;
  destination.search = incoming.search;
  return destination;
}
