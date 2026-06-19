import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-api';
import { logEvent } from '@/lib/log';

export const runtime = 'nodejs';

export async function GET() {
  return withAdmin(async ({ db }) => {
    const { data } = await db
      .from('system_prompt_versions')
      .select('id, content, created_at, is_active')
      .eq('is_active', true)
      .maybeSingle();
    return NextResponse.json({ active: data });
  });
}

// Save a NEW version and make it active, preserving history (spec §10.2).
export async function PUT(req: NextRequest) {
  return withAdmin(async ({ db, user }) => {
    const { content } = await req.json();
    if (typeof content !== 'string' || !content.trim()) {
      return NextResponse.json({ error: 'content required' }, { status: 400 });
    }
    await db.from('system_prompt_versions').update({ is_active: false }).eq('is_active', true);
    const { error } = await db
      .from('system_prompt_versions')
      .insert({ content, is_active: true, created_by: user.id });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logEvent(db, { action: 'admin_update_system_prompt', metadata: { by: user.email } });
    return NextResponse.json({ ok: true });
  });
}
