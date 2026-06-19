import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-api';
import { logEvent } from '@/lib/log';

export const runtime = 'nodejs';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return withAdmin(async ({ db, user }) => {
    const { data: request } = await db
      .from('requests')
      .select('conversation_id')
      .eq('id', params.id)
      .single();

    await db
      .from('requests')
      .update({ status: 'closed', closed_at: new Date().toISOString() })
      .eq('id', params.id);

    if (request) {
      // free the conversation so a new message opens a fresh request (spec §7.24)
      await db
        .from('conversations')
        .update({ current_request_id: null, status: 'active' })
        .eq('id', request.conversation_id);
    }
    await logEvent(db, { requestId: params.id, action: 'admin_close', metadata: { by: user.email } });
    return NextResponse.json({ ok: true });
  });
}
