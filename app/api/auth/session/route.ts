import { isAuthSessionMissingError } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { readSupabasePublicConfig } from '@/lib/supabase/config';
import { customerPrivacyContext } from '@/lib/commerce/guest-session';
import { getRequestOrigin } from '@/lib/auth/google';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = {
  'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
  Vary: 'Cookie',
};

export async function GET(request: Request) {
  try {
    const config = readSupabasePublicConfig({
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    });
    if (!config)
      return Response.json({ configured: false, user: null, contextId: null }, { headers });
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error && !isAuthSessionMissingError(error))
      return Response.json(
        { configured: true, user: null, contextId: null },
        { status: 503, headers },
      );
    const contextId = await customerPrivacyContext(
      getRequestOrigin(request),
      data.user?.id ?? null,
    );
    if (!data.user) return Response.json({ configured: true, user: null, contextId }, { headers });
    const name = data.user.user_metadata?.full_name ?? data.user.user_metadata?.name;
    return Response.json(
      {
        configured: true,
        contextId,
        user: {
          id: data.user.id,
          email: data.user.email ?? null,
          name: typeof name === 'string' ? name.slice(0, 120) : null,
        },
      },
      { headers },
    );
  } catch {
    return Response.json(
      { configured: false, user: null, contextId: null },
      { status: 503, headers },
    );
  }
}
