import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Auth-scoped Supabase client for Server Components / Route Handlers.
 * Respects RLS via the logged-in admin's session cookie.
 */
export function createSupabaseServerClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — middleware refreshes the session.
          }
        },
      },
    }
  );
}
