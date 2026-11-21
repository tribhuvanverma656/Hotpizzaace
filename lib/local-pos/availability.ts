/**
 * The local POS runs on the restaurant's own computer with a local database. Its first-run
 * setup creates a Super User for whoever opens it first, so it must never be reachable on a
 * hosted website. It is off unless that computer sets LOCAL_POS_ENABLED=true.
 */
export function localPosEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.LOCAL_POS_ENABLED === 'true';
}

/** True for every local POS page and API path, including nested routes. */
export function isLocalPosPath(pathname: string): boolean {
  return ['/local-pos', '/api/local-pos'].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
