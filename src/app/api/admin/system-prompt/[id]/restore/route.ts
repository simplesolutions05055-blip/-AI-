import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-api';
import { logEvent } from '@/lib/log';

export const runtime = 'nodejs';

// Restore a previous version by creating a new active copy of its content.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return withAdmin(async ({ db, user }) => {
    const { data: prev } = await db
      .from('system_prompt_versions')
      .select('content')
      .eq('id', params.id)
      .maybeSingle();
    if (!prev) return NextResponse.json({ error: 'not found' }, { status: 404 });

    await db.from('system_prompt_versions').update({ is_active: false }).eq('is_active', true);
    await db
      .from('system_prompt_versions')
      .insert({ content: prev.content, is_active: true, created_by: user.id });
    await logEvent(db, { action: 'admin_restore_system_prompt', metadata: { from: params.id, by: user.email } });
    return NextResponse.json({ ok: true });
  });
}
