import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-api';
import { invokeEdgeFunction } from '@/lib/internal-auth';
import { logEvent } from '@/lib/log';

export const runtime = 'nodejs';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return withAdmin(async ({ db, user }) => {
    await db.from('requests').update({ status: 'queued' }).eq('id', params.id);
    await db.from('jobs').insert({ request_id: params.id, job_type: 'process-request', status: 'pending' });
    await logEvent(db, { requestId: params.id, action: 'admin_retry', metadata: { by: user.email } });
    await invokeEdgeFunction('process-request', { request_id: params.id });
    return NextResponse.json({ ok: true });
  });
}
