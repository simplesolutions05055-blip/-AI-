import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-api';

export const runtime = 'nodejs';

// Lists output files with linked request info + total storage volume (spec §18.5).
export async function GET() {
  return withAdmin(async ({ db }) => {
    const { data: outputs } = await db
      .from('outputs')
      .select('id, request_id, output_type, storage_path, mime_type, created_at')
      .not('storage_path', 'is', null)
      .order('created_at', { ascending: false })
      .limit(500);

    return NextResponse.json({ files: outputs ?? [] });
  });
}
