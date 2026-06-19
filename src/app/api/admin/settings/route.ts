import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-api';
import { logEvent } from '@/lib/log';

export const runtime = 'nodejs';

export async function GET() {
  return withAdmin(async ({ db }) => {
    const { data } = await db.from('settings').select('key, value_json, updated_at');
    const map: Record<string, unknown> = {};
    (data ?? []).forEach((r) => (map[r.key] = r.value_json));
    return NextResponse.json({ settings: map });
  });
}

// Body: { settings: { key: value_json, ... } } — upserts each key.
export async function PUT(req: NextRequest) {
  return withAdmin(async ({ db, user }) => {
    const { settings } = await req.json();
    if (!settings || typeof settings !== 'object') {
      return NextResponse.json({ error: 'settings object required' }, { status: 400 });
    }
    const rows = Object.entries(settings).map(([key, value_json]) => ({
      key,
      value_json,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await db.from('settings').upsert(rows, { onConflict: 'key' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logEvent(db, { action: 'admin_update_settings', metadata: { keys: Object.keys(settings), by: user.email } });
    return NextResponse.json({ ok: true });
  });
}
