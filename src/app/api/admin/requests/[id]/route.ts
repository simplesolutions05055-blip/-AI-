import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-api';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withAdmin(async ({ db }) => {
    const { data: request } = await db
      .from('requests')
      .select('*, conversations!requests_conversation_id_fkey(*)')
      .eq('id', params.id)
      .maybeSingle();
    if (!request) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const [{ data: messages }, { data: outputs }, { data: logs }, { data: usage }] =
      await Promise.all([
        db.from('messages').select('*').eq('conversation_id', request.conversation_id).order('created_at'),
        db.from('outputs').select('*').eq('request_id', params.id).order('version', { ascending: false }),
        db.from('logs').select('*').eq('request_id', params.id).order('created_at', { ascending: false }),
        db.from('usage_events').select('*').eq('request_id', params.id).order('created_at'),
      ]);

    return NextResponse.json({ request, messages, outputs, logs, usage });
  });
}
