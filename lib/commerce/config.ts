/** A server-controlled switch; browser storage never enables shared commerce. */
export function isCommerceEnabled(
  environment: { COMMERCE_ENABLED?: string } = { COMMERCE_ENABLED: process.env.COMMERCE_ENABLED },
): boolean {
  return environment.COMMERCE_ENABLED === 'true';
}

export const commercePrivateHeaders = {
  'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
  Vary: 'Cookie',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};
