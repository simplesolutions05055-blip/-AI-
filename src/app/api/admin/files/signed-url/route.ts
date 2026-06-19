import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-api';

export const runtime = 'nodejs';

// Generate a short-lived signed URL for viewing/downloading a private object.
export async function GET(req: NextRequest) {
  return withAdmin(async ({ db }) => {
    const bucket = req.nextUrl.searchParams.get('bucket') ?? 'outputs';
    const path = req.nextUrl.searchParams.get('path');
    if (!path) return NextResponse.json({ error: 'path required' }, { status: 400 });
    if (!['outputs', 'inbound'].includes(bucket)) {
      return NextResponse.json({ error: 'bad bucket' }, { status: 400 });
    }
    const { data, error } = await db.storage.from(bucket).createSignedUrl(path, 300);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ url: data.signedUrl });
  });
}
