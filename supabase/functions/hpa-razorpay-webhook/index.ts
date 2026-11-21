import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import {
  readRazorpayConfig,
  readRazorpayWebhookBody,
  verifyRazorpayWebhookSignature,
  parseRazorpayWebhook,
  fetchRazorpayPayment,
  verifyRazorpayPayment,
  RazorpayError,
} from './razorpay.js';
import {
  findPaymentAttempt,
  commitVerifiedPayment,
  synchronizeRazorpayRefunds,
} from './payments.js';

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

/** No browser session or JWT is trusted here. Authenticate the exact raw bytes before any database lookup. */
Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405);
  try {
    const environment = Deno.env.toObject();
    const mode = environment.RAZORPAY_MODE === 'test' ? 'development' : 'production';
    const config = readRazorpayConfig(environment, mode);
    if (!config) return reply({ error: 'Payment webhooks are not enabled.' }, 503);
    const raw = await readRazorpayWebhookBody(request);
    if (
      !(await verifyRazorpayWebhookSignature(
        raw,
        request.headers.get('x-razorpay-signature') ?? '',
        config.webhookSecret,
      ))
    )
      return reply({ error: 'Invalid payment signature.' }, 401);
    const event = parseRazorpayWebhook(raw);
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
      attempt = await findPaymentAttempt(db, { providerOrderId: event.payment.order_id });
    } catch (error) {
      // A merchant may also use Payment Links or other sites. An authenticated
      // event with no binding in this app must not be retried or create an order.
      if (error instanceof RazorpayError && error.code === 'payment_not_found')
        return reply({ received: true, ignored: true });
      throw error;
    }
    if (attempt.mode !== config.mode) return reply({ error: 'Payment environment mismatch.' }, 409);
    const fetched = await fetchRazorpayPayment(config, event.payment.id);
    const digest = await crypto.subtle.digest('SHA-256', raw);
    const eventHash = Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
    if ('refund' in event || fetched.amount_refunded > 0 || fetched.status === 'refunded') {
      await synchronizeRazorpayRefunds(db, config, attempt, fetched, {
        ...('refund' in event ? { event } : {}),
        eventHash,
      });
    } else {
      const payment = verifyRazorpayPayment(fetched, {
        providerOrderId: attempt.provider_order_id!,
        amount: attempt.amount,
        paymentId: event.payment.id,
      });
      await commitVerifiedPayment(db, attempt, payment, eventHash);
    }
    return reply({ received: true });
  } catch (error) {
    // Never acknowledge a known event before its atomic commit; provider retries can recover outages.
    if (error instanceof RazorpayError) return reply({ error: error.code }, error.status);
    return reply({ error: 'Payment service unavailable.' }, 503);
  }
});
