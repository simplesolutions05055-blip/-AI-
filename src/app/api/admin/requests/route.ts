import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-api';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  return withAdmin(async ({ db }) => {
    const sp = req.nextUrl.searchParams;
    let q = db
      .from('requests')
      .select('id, customer_email, output_type, status, estimated_cost, created_at, sent_at, conversations!requests_conversation_id_fkey(whatsapp_from)')
      .order('created_at', { ascending: false })
      .limit(200);

    const status = sp.get('status');
    const outputType = sp.get('output_type');
    const from = sp.get('from');
    const to = sp.get('to');
    const email = sp.get('email');
    const phone = sp.get('phone');

    if (status) q = q.eq('status', status);
    if (outputType) q = q.eq('output_type', outputType);
    if (email) q = q.ilike('customer_email', `%${email}%`);
    if (from) q = q.gte('created_at', from);
    if (to) q = q.lte('created_at', to);

    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    let rows = data ?? [];
    if (phone) {
      rows = rows.filter((r) =>
        (r.conversations as { whatsapp_from?: string } | null)?.whatsapp_from?.includes(phone)
      );
    }
    return NextResponse.json({ requests: rows });
  });
}
