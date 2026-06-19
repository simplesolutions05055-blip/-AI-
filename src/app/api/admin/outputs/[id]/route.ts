import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-api';
import { logEvent } from '@/lib/log';

export const runtime = 'nodejs';

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return withAdmin(async ({ db, user }) => {
    const { data: output } = await db
      .from('outputs')
      .select('id, request_id, storage_path')
      .eq('id', params.id)
      .maybeSingle();
    if (!output) return NextResponse.json({ error: 'not found' }, { status: 404 });

    if (output.storage_path) {
      await db.storage.from('outputs').remove([output.storage_path]);
    }
    await db.from('outputs').delete().eq('id', params.id);
    await logEvent(db, { requestId: output.request_id, action: 'admin_delete_output', metadata: { by: user.email } });
    return NextResponse.json({ ok: true });
  });
}
