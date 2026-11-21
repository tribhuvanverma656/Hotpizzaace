import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';

export const GUEST_COOKIE = 'hpa_guest_session';

export function guestCookieOptions(origin: string) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: origin.startsWith('https://'),
    path: '/',
    maxAge: 60 * 60 * 24 * 90,
  };
}

export function newGuestSession(): string {
  return randomBytes(32).toString('hex');
}

/** Authentication boundaries discard browser-only order capabilities, never transfer them. */
export async function rotateGuestSession(origin: string): Promise<void> {
  (await cookies()).set(GUEST_COOKIE, newGuestSession(), guestCookieOptions(origin));
}

/** A one-way display/cache partition. This value is never an order-access capability. */
export async function customerPrivacyContext(origin: string, userId: string | null) {
  const store = await cookies();
  let nonce = store.get(GUEST_COOKIE)?.value;
  if (!nonce || !/^[a-f0-9]{64}$/.test(nonce)) {
    nonce = newGuestSession();
    store.set(GUEST_COOKIE, nonce, guestCookieOptions(origin));
  }
  return createHash('sha256')
    .update(`hpa-customer-context:v1:${nonce}:${userId ?? 'guest'}`)
    .digest('hex');
}
