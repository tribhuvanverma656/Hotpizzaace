import type { SupabasePublicConfig } from '@/lib/supabase/config';

export type GoogleProviderStatus = 'enabled' | 'disabled' | 'unavailable';

/** Read public provider readiness without a service key or a user session. */
export async function getGoogleProviderStatus(
  config: SupabasePublicConfig,
  request: typeof fetch = fetch,
): Promise<GoogleProviderStatus> {
  try {
    const response = await request(`${config.url}/auth/v1/settings`, {
      headers: { apikey: config.publishableKey },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return 'unavailable';
    const settings: unknown = await response.json();
    if (!settings || typeof settings !== 'object' || !('external' in settings))
      return 'unavailable';
    const external = settings.external;
    if (!external || typeof external !== 'object' || !('google' in external)) return 'unavailable';
    if (external.google === true) return 'enabled';
    if (external.google === false) return 'disabled';
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}
