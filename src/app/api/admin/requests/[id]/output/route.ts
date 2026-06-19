import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-api';
import { logEvent } from '@/lib/log';

export const runtime = 'nodejs';

// Edit the latest output's text before sending (spec §5.1, §18.4).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  return withAdmin(async ({ db, user }) => {
    const { text_content } = await req.json();
    if (typeof text_content !== 'string') {
      return NextResponse.json({ error: 'text_content required' }, { status: 400 });
    }
    const { data: output } = await db
      .from('outputs')
      .select('id')
      .eq('request_id', params.id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!output) return NextResponse.json({ error: 'no output' }, { status: 404 });

    await db.from('outputs').update({ text_content }).eq('id', output.id);
    await logEvent(db, { requestId: params.id, action: 'admin_edit_output', metadata: { by: user.email } });
    return NextResponse.json({ ok: true });
  });
}
