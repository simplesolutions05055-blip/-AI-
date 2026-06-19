import { createClient } from '@supabase/supabase-js';

let browserClient: ReturnType<typeof createClient> | null = null;

export function createSupabaseBrowserClient() {
  if (browserClient) return browserClient;

  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
  }

  browserClient = createClient(url, key);
  return browserClient;
}
