import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-api';
import { logEvent } from '@/lib/log';

export const runtime = 'nodejs';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return withAdmin(async ({ db, user }) => {
    await db.from('requests').update({ status: 'rejected' }).eq('id', params.id);
    await logEvent(db, { requestId: params.id, action: 'admin_reject', metadata: { by: user.email } });
    return NextResponse.json({ ok: true });
  });
}
