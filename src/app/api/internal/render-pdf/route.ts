import { NextRequest, NextResponse } from 'next/server';
import { verifyInternalSecret } from '@/lib/internal-auth';
import { renderPdf } from '@/lib/pdf';

export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * HTML → PDF (Puppeteer). The ONLY backend work left on Vercel — it needs Node,
 * which Deno Edge Functions can't provide. Requires no provider key; the Edge
 * worker authenticates with INTERNAL_API_SECRET (a Supabase secret).
 */
export async function POST(req: NextRequest) {
  if (!verifyInternalSecret(req)) return new NextResponse('Forbidden', { status: 403 });
  const { html } = await req.json();
  if (typeof html !== 'string') {
    return NextResponse.json({ error: 'html required' }, { status: 400 });
  }
  const pdf = await renderPdf(html);
  return NextResponse.json({ base64: pdf.toString('base64') });
}
