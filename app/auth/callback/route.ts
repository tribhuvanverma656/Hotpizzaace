import { handleAuthCallback } from '@/lib/auth/callback';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';
import { rotateGuestSession } from '@/lib/commerce/guest-session';
import { getRequestOrigin } from '@/lib/auth/google';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const parameters = new URL(request.url).searchParams;
  const flowId = parameters.get('sb_flow_id');
  const validFlowId = typeof flowId === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(flowId);
  const cookieNames = (await cookies()).getAll().map(({ name }) => name);
  // Only finite stages and presence flags; never log URLs, flow IDs, tokens or cookie values.
  console.info(
    'auth_callback',
    JSON.stringify({
      stage: 'received',
      hasCode: parameters.has('code'),
      hasFlowId: parameters.has('sb_flow_id'),
      validFlowId,
      hasVerifierCookie: validFlowId
        ? cookieNames.some((name) => name.endsWith(`-flow-${flowId}-code-verifier`))
        : cookieNames.some((name) => name.endsWith('-code-verifier')),
    }),
  );
  return handleAuthCallback(request, {
    createClient: createSupabaseServerClient,
    onVerifiedSignIn: () => rotateGuestSession(getRequestOrigin(request)),
    onFailure: (reason) =>
      console.warn('auth_callback', JSON.stringify({ stage: 'failed', reason })),
  });
}
