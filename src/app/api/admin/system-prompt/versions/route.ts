import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-api';

export const runtime = 'nodejs';

export async function GET() {
  return withAdmin(async ({ db }) => {
    const { data } = await db
      .from('system_prompt_versions')
      .select('id, content, created_at, is_active, created_by')
      .order('created_at', { ascending: false })
      .limit(50);
    return NextResponse.json({ versions: data ?? [] });
  });
}
