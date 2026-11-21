import { handlePasswordForm } from '@/lib/auth/password';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { rotateGuestSession } from '@/lib/commerce/guest-session';
import { getRequestOrigin } from '@/lib/auth/google';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return handlePasswordForm(request, {
    createClient: createSupabaseServerClient,
    signInOnly: true,
    onVerifiedSignIn: () => rotateGuestSession(getRequestOrigin(request)),
  });
}
