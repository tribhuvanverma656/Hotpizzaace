import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { handleKitchenRequest } from './kitchen-staff.js';

function defaultKey(value: string | undefined): string | undefined {
  if (!value) return;
  try {
    const key = JSON.parse(value).default;
    return typeof key === 'string' ? key : undefined;
  } catch {
    return;
  }
}
const options = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: {
    fetch: (input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(10_000) }),
  },
};
Deno.serve(async (request: Request) => {
  const env = Deno.env.toObject();
  const url = env.SUPABASE_URL;
  const secret = defaultKey(env.SUPABASE_SECRET_KEYS) ?? env.SUPABASE_SERVICE_ROLE_KEY;
  const publicKey = defaultKey(env.SUPABASE_PUBLISHABLE_KEYS) ?? env.SUPABASE_ANON_KEY;
  if (!url || !secret || !publicKey)
    return new Response(
      JSON.stringify({
        error: 'Kitchen access is temporarily unavailable.',
        code: 'kitchen_unavailable',
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
      },
    );
  return handleKitchenRequest(request, {
    db: createClient(url, secret, options),
    auth: () => createClient(url, publicKey, options),
  });
});
