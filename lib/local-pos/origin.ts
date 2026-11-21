import { LocalPosError } from './errors';

export function assertLocalPosOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  const fetchSite = request.headers.get('sec-fetch-site');
  let expectedOrigin: string;
  try {
    const requestUrl = new URL(request.url);
    if (
      !host ||
      !/^[a-z0-9.[\]:-]+$/i.test(host) ||
      (requestUrl.protocol !== 'http:' && requestUrl.protocol !== 'https:')
    )
      throw new Error('invalid local origin');
    const hostUrl = new URL(`${requestUrl.protocol}//${host}`);
    if (
      hostUrl.username ||
      hostUrl.password ||
      hostUrl.pathname !== '/' ||
      hostUrl.search ||
      hostUrl.hash
    )
      throw new Error('invalid local host');
    expectedOrigin = hostUrl.origin;
  } catch {
    throw new LocalPosError(
      'The local POS could not verify this request origin.',
      403,
      'origin_denied',
    );
  }
  let actualOrigin: string;
  try {
    if (!origin) throw new Error('missing origin');
    const parsedOrigin = new URL(origin);
    if (
      parsedOrigin.username ||
      parsedOrigin.password ||
      parsedOrigin.pathname !== '/' ||
      parsedOrigin.search ||
      parsedOrigin.hash
    )
      throw new Error('invalid origin');
    actualOrigin = parsedOrigin.origin;
  } catch {
    throw new LocalPosError(
      'This request did not come from the local POS application.',
      403,
      'origin_denied',
    );
  }
  if (actualOrigin !== expectedOrigin || (fetchSite !== null && fetchSite !== 'same-origin'))
    throw new LocalPosError(
      'This request did not come from the local POS application.',
      403,
      'origin_denied',
    );
}
