import { createClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client — bypasses RLS. SERVER ONLY.
 * Used by the Twilio webhook and internal worker callbacks.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase service-role configuration');

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
