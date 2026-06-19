import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

// Supabase auto-injects SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY into every
// Edge Function. The service-role client bypasses RLS.
export function db() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export type DB = ReturnType<typeof db>;
