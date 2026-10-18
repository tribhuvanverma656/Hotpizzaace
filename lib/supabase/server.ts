import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isServerSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

/**
 * Privileged server-side Supabase client for API routes.
 */
export function getServiceSupabase() {
  if (!isServerSupabaseConfigured) {
    return null;
  }
  return createClient(supabaseUrl as string, supabaseKey as string, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
