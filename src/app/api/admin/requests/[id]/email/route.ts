import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-api';
import { isValidEmail } from '@/lib/format';
import { logEvent } from '@/lib/log';

export const runtime = 'nodejs';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  return withAdmin(async ({ db, user }) => {
    const { customer_email } = await req.json();
    if (!isValidEmail(customer_email ?? '')) {
      return NextResponse.json({ error: 'invalid email' }, { status: 400 });
    }
    await db.from('requests').update({ customer_email }).eq('id', params.id);
    await logEvent(db, { requestId: params.id, action: 'admin_edit_email', metadata: { by: user.email } });
    return NextResponse.json({ ok: true });
  });
}
