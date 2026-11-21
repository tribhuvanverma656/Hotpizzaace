import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import {
  readPhonePeConfig,
  readPhonePeWebhookBody,
  verifyPhonePeWebhookAuthorization,
  parsePhonePeWebhook,
  PhonePeError,
} from './phonepe.js';
import {
  findPhonePeAttemptByMerchantOrderId,
  flagPhonePeRefund,
  synchronizePhonePeAttempt,
} from './phonepe-payments.js';

const headers = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};
const reply = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers });
function defaultKey(value: string | undefined): string | undefined {
  if (!value) return;
  try {
    const key = JSON.parse(value).default;
    return typeof key === 'string' ? key : undefined;
  } catch {
    return;
  }
}

/**
 * Deploy with JWT verification off; PhonePe authenticates with the dashboard username and
 * password digest instead. The body only names an order or refund: its state is always
 * re-read from PhonePe before the ledger changes. Must answer within PhonePe's 3–5 s window,
 * and only after the atomic write, so PhonePe retries cover outages.
 */
Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405);
  try {
    const environment = Deno.env.toObject();
    const mode = environment.PHONEPE_MODE === 'test' ? 'development' : 'production';
    const config = readPhonePeConfig(environment, mode);
    if (!config) return reply({ error: 'Payment webhooks are not enabled.' }, 503);
    if (!(await verifyPhonePeWebhookAuthorization(request.headers.get('authorization'), config)))
      return reply({ error: 'Invalid payment authorization.' }, 401);
    const raw = await readPhonePeWebhookBody(request);
    const event = parsePhonePeWebhook(raw);
    if (!event) return reply({ received: true });
    const key =
      defaultKey(environment.SUPABASE_SECRET_KEYS) ?? environment.SUPABASE_SERVICE_ROLE_KEY;
    if (!environment.SUPABASE_URL || !key)
      return reply({ error: 'Payment service unavailable.' }, 503);
    const db = createClient(environment.SUPABASE_URL, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const snapshot = await db.rpc('hpa_catalog_snapshot');
    if (snapshot.error || snapshot.data?.mode !== mode)
      return reply({ error: 'Payment environment mismatch.' }, 503);
    let attempt;
    try {
      attempt = await findPhonePeAttemptByMerchantOrderId(
        db,
        event.kind === 'order' ? event.merchantOrderId : event.originalMerchantOrderId,
      );
    } catch (error) {
      // The merchant account may also take payments elsewhere; unknown orders are not ours.
      if (error instanceof PhonePeError && error.code === 'payment_not_found')
        return reply({ received: true, ignored: true });
      throw error;
    }
    if (attempt.mode !== config.mode) return reply({ error: 'Payment environment mismatch.' }, 409);
    if (event.kind === 'refund') {
      await flagPhonePeRefund(db, config, attempt, event.merchantRefundId);
      return reply({ received: true });
    }
    const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(raw));
    const eventHash = Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
    // A still-pending status leaves the event unrecorded so a later delivery can apply it.
    await synchronizePhonePeAttempt(db, config, attempt, { eventHash });
    return reply({ received: true });
  } catch (error) {
    // PhonePeError extends RazorpayError; both carry a safe status and code.
    if (error instanceof PhonePeError || (error as { code?: unknown })?.code)
      return reply(
        { error: (error as { code: string }).code },
        (error as { status?: number }).status ?? 503,
      );
    return reply({ error: 'Payment service unavailable.' }, 503);
  }
});
