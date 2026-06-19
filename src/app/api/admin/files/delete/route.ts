import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-api';
import { logEvent } from '@/lib/log';

export const runtime = 'nodejs';

// Multi-delete of output files (spec §4.1, §18.5). Body: { ids: string[] }
export async function POST(req: NextRequest) {
  return withAdmin(async ({ db, user }) => {
    const { ids } = await req.json();
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'ids required' }, { status: 400 });
    }
    const { data: outputs } = await db
      .from('outputs')
      .select('id, storage_path')
      .in('id', ids);

    const paths = (outputs ?? []).map((o) => o.storage_path).filter(Boolean) as string[];
    if (paths.length) await db.storage.from('outputs').remove(paths);
    await db.from('outputs').update({ storage_path: null }).in('id', ids);
    await logEvent(db, { action: 'admin_bulk_delete_files', metadata: { count: ids.length, by: user.email } });
    return NextResponse.json({ ok: true, deleted: paths.length });
  });
}
