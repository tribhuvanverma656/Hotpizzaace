import { handleOwnerPassword, isVerifiedOwnerSession } from '@/lib/auth/owner-password';
import { proxyCommerce } from '@/lib/commerce/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function verifyOwner(request: Request, userId: string) {
  const sessionRequest = new Request(new URL('/api/commerce/session', request.url), {
    method: 'GET',
    headers: request.headers,
  });
  const response = await proxyCommerce(sessionRequest, ['session']);
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) return false;
    throw new Error('Owner authorization is unavailable.');
  }
  return isVerifiedOwnerSession(await response.json(), userId);
}

async function handle(request: Request) {
  return handleOwnerPassword(request, {
    createClient: createSupabaseServerClient,
    verifyOwner,
  });
}

export const GET = handle;
export const POST = handle;
