import { NextResponse } from 'next/server';
import { getAdminUser } from '@/lib/require-admin';
import { createAdminClient } from '@/lib/supabase/admin';

/** Wrap an admin route handler: verifies admin, provides service-role db + user. */
export async function withAdmin(
  handler: (ctx: {
    db: ReturnType<typeof createAdminClient>;
    user: { id: string; email: string; role: string };
  }) => Promise<NextResponse>
): Promise<NextResponse> {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const db = createAdminClient();
  return handler({ db, user: user as { id: string; email: string; role: string } });
}
