import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { readSupabasePublicConfig } from '@/lib/supabase/config';
import { readRazorpayCapability } from '@/lib/payments/razorpay-client';
import { readPhonePeCapability } from '@/lib/payments/phonepe-client';
import { isCommerceEnabled } from '@/lib/commerce/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Uncached infrastructure readiness; never includes customer records or credentials. */
export async function GET() {
  const headers = { 'Cache-Control': 'no-store, max-age=0' };
  const shared = isCommerceEnabled();
  let application = shared ? 'shared' : 'demo';
  let payments:
    | 'simulation'
    | 'disabled'
    | 'razorpay_test'
    | 'razorpay_live'
    | 'phonepe_test'
    | 'phonepe_live' = 'disabled';
  try {
    const config = readSupabasePublicConfig({
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    });
    if (!config && shared) throw new Error('Shared commerce requires Supabase.');
    if (!config)
      return Response.json(
        { status: 'ok', application: 'demo', database: 'not_configured' },
        { headers },
      );
    // No session persistence/refresh and no cookies: this query returns no customer data.
    const client = createClient(config.url, config.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await client
      .rpc('hpa_healthcheck')
      .abortSignal(AbortSignal.timeout(5000));
    if (error || data !== true) throw new Error('Database readiness check failed.');
    if (shared) {
      const response = await fetch(`${config.url}/functions/v1/hpa-commerce`, {
        method: 'POST',
        headers: { apikey: config.publishableKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'GET',
          path: ['catalog'],
          query: {},
          body: null,
          guestSession: randomBytes(32).toString('hex'),
        }),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
      const snapshot = await response.json();
      if (
        !response.ok ||
        !snapshot ||
        typeof snapshot !== 'object' ||
        !Array.isArray(snapshot.branches) ||
        !snapshot.branches.length ||
        !['development', 'production'].includes(snapshot.mode) ||
        typeof snapshot.allowSimulatedPayments !== 'boolean'
      )
        throw new Error('Shared commerce readiness check failed.');
      application = `shared-${snapshot.mode}`;
      // A connected database does not establish a configured or verified payment provider.
      // The Edge simulator itself also requires development mode, even if a production flag is set.
      const gateway = readPhonePeCapability(snapshot) ?? readRazorpayCapability(snapshot);
      payments = gateway
        ? `${gateway.provider}_${gateway.mode}`
        : snapshot.mode === 'development' && snapshot.allowSimulatedPayments === true
          ? 'simulation'
          : 'disabled';
    }
    return Response.json(
      {
        status: 'ok',
        application,
        database: 'connected',
        ...(shared ? { commerce: 'connected', payments } : {}),
      },
      { headers },
    );
  } catch {
    // Do not expose SDK errors, connection strings, credentials, or database structure.
    return Response.json(
      { status: 'degraded', application, database: 'unavailable' },
      { status: 503, headers },
    );
  }
}
