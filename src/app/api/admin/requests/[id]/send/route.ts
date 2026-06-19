import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-api';
import { invokeEdgeFunction } from '@/lib/internal-auth';
import { logEvent } from '@/lib/log';

export const runtime = 'nodejs';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return withAdmin(async ({ db, user }) => {
    await logEvent(db, { requestId: params.id, action: 'admin_send', metadata: { by: user.email } });
    await invokeEdgeFunction('send-output', { request_id: params.id });
    return NextResponse.json({ ok: true });
  });
}
