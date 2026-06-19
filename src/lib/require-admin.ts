import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Returns the authenticated admin user, or null. For use inside admin API
 * route handlers and server components.
 */
export async function getAdminUser() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, role')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile || profile.role !== 'admin') return null;
  return profile;
}
