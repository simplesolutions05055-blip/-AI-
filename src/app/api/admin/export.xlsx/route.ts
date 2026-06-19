import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { withAdmin } from '@/lib/admin-api';
import { formatHebrewDate } from '@/lib/format';

export const runtime = 'nodejs';

// XLSX export with date range, 3 sheets: requests / costs / errors (spec §18.7).
export async function GET(req: NextRequest) {
  return withAdmin(async ({ db }) => {
    const from = req.nextUrl.searchParams.get('from') ?? '2000-01-01';
    const to = req.nextUrl.searchParams.get('to') ?? new Date().toISOString();

    const [{ data: requests }, { data: usage }, { data: logs }] = await Promise.all([
      db
        .from('requests')
        .select('id, customer_email, output_type, status, estimated_cost, created_at, sent_at, conversations!requests_conversation_id_fkey(whatsapp_from)')
        .gte('created_at', from)
        .lte('created_at', to)
        .order('created_at', { ascending: false }),
      db
        .from('usage_events')
        .select('id, request_id, provider, model, input_units, output_units, estimated_cost, created_at')
        .gte('created_at', from)
        .lte('created_at', to),
      db
        .from('logs')
        .select('id, request_id, severity, action, message, created_at')
        .in('severity', ['error', 'warning'])
        .gte('created_at', from)
        .lte('created_at', to),
    ]);

    const wb = new ExcelJS.Workbook();
    const rtlView = { rightToLeft: true } as ExcelJS.WorksheetView;

    const sReq = wb.addWorksheet('בקשות', { views: [rtlView] });
    sReq.columns = [
      { header: 'תאריך', key: 'created_at', width: 20 },
      { header: 'מספר WhatsApp', key: 'phone', width: 20 },
      { header: 'מייל', key: 'email', width: 28 },
      { header: 'סוג תוצר', key: 'type', width: 14 },
      { header: 'סטטוס', key: 'status', width: 18 },
      { header: 'עלות ($)', key: 'cost', width: 12 },
    ];
    (requests ?? []).forEach((r) =>
      sReq.addRow({
        created_at: formatHebrewDate(r.created_at),
        phone: (r.conversations as { whatsapp_from?: string } | null)?.whatsapp_from ?? '',
        email: r.customer_email ?? '',
        type: r.output_type ?? '',
        status: r.status,
        cost: r.estimated_cost,
      })
    );

    const sCost = wb.addWorksheet('עלויות', { views: [rtlView] });
    sCost.columns = [
      { header: 'תאריך', key: 'created_at', width: 20 },
      { header: 'ספק', key: 'provider', width: 14 },
      { header: 'מודל', key: 'model', width: 18 },
      { header: 'יחידות קלט', key: 'input', width: 14 },
      { header: 'יחידות פלט', key: 'output', width: 14 },
      { header: 'עלות ($)', key: 'cost', width: 12 },
    ];
    (usage ?? []).forEach((u) =>
      sCost.addRow({
        created_at: formatHebrewDate(u.created_at),
        provider: u.provider,
        model: u.model ?? '',
        input: u.input_units,
        output: u.output_units,
        cost: u.estimated_cost,
      })
    );

    const sErr = wb.addWorksheet('שגיאות', { views: [rtlView] });
    sErr.columns = [
      { header: 'תאריך', key: 'created_at', width: 20 },
      { header: 'חומרה', key: 'severity', width: 12 },
      { header: 'פעולה', key: 'action', width: 22 },
      { header: 'הודעה', key: 'message', width: 50 },
    ];
    (logs ?? []).forEach((l) =>
      sErr.addRow({
        created_at: formatHebrewDate(l.created_at),
        severity: l.severity,
        action: l.action,
        message: l.message ?? '',
      })
    );

    const buffer = await wb.xlsx.writeBuffer();
    const fromLabel = formatHebrewDate(from).replace(/\//g, '-');
    const toLabel = formatHebrewDate(to).replace(/\//g, '-');
    const filename = `export_${fromLabel}_${toLabel}.xlsx`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  });
}
