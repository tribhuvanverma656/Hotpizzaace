import 'server-only';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from './supabase/server';
import { getSupabasePublicConfig } from './supabase/config';
import { getRequestOrigin } from './auth/google';
import { handleKitchenGateway } from './kitchen-gateway';

export function proxyKitchen(request: Request, path: string[], owner = false) {
  return handleKitchenGateway(
    request,
    path,
    {
      config: getSupabasePublicConfig,
      origin: getRequestOrigin,
      cookies,
      fetch,
      ownerToken: async () => {
        const client = await createSupabaseServerClient();
        const verified = await client.auth.getUser();
        if (verified.error || !verified.data.user) return null;
        const session = await client.auth.getSession();
        if (session.error || session.data.session?.user.id !== verified.data.user.id) return null;
        return session.data.session.access_token;
      },
    },
    owner,
  );
}
