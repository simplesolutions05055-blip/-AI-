import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-api';
import { logEvent } from '@/lib/log';

export const runtime = 'nodejs';

export async function GET() {
  return withAdmin(async ({ db }) => {
    const { data } = await db
      .from('blocked_numbers')
      .select('*')
      .order('created_at', { ascending: false });
    return NextResponse.json({ blocked: data ?? [] });
  });
}

export async function POST(req: NextRequest) {
  return withAdmin(async ({ db, user }) => {
    const { phone_number, reason } = await req.json();
    if (!phone_number) return NextResponse.json({ error: 'phone_number required' }, { status: 400 });
    const { error } = await db
      .from('blocked_numbers')
      .insert({ phone_number, reason: reason ?? null, created_by: user.id });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logEvent(db, { action: 'admin_block_number', metadata: { phone_number, by: user.email } });
    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(req: NextRequest) {
  return withAdmin(async ({ db, user }) => {
    const id = req.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    await db.from('blocked_numbers').delete().eq('id', id);
    await logEvent(db, { action: 'admin_unblock_number', metadata: { id, by: user.email } });
    return NextResponse.json({ ok: true });
  });
}
