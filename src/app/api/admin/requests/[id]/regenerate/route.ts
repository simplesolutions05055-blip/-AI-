import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-api';
import { invokeEdgeFunction } from '@/lib/internal-auth';
import { logEvent } from '@/lib/log';

export const runtime = 'nodejs';

// Regenerate with an optional admin note (spec §18.4). The note is logged and
// folded into the brief so the next generation honours it.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return withAdmin(async ({ db, user }) => {
    const { note } = await req.json().catch(() => ({ note: undefined }));

    const { data: request } = await db
      .from('requests')
      .select('structured_brief')
      .eq('id', params.id)
      .single();

    const brief = (request?.structured_brief ?? {}) as Record<string, unknown>;
    if (note) brief.admin_note = note;

    await db
      .from('requests')
      .update({ status: 'queued', structured_brief: brief })
      .eq('id', params.id);
    await db.from('jobs').insert({ request_id: params.id, job_type: 'process-request', status: 'pending' });
    await logEvent(db, { requestId: params.id, action: 'admin_regenerate', message: note, metadata: { by: user.email } });
    await invokeEdgeFunction('process-request', { request_id: params.id });
    return NextResponse.json({ ok: true });
  });
}
