import { useEffect, useState } from 'react';
import { STATUS_COLOR, STATUS_LABEL, OUTPUT_LABEL } from '@/lib/labels';
import { formatHebrewDateTime, formatUsd } from '@/lib/format';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import type { OutputType, RequestStatus } from '@/types/db';

interface Row {
  id: string;
  customer_email: string | null;
  output_type: OutputType | null;
  status: RequestStatus;
  estimated_cost: number;
  created_at: string;
  conversations: { whatsapp_from: string } | null;
}

export default function RequestsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: '', output_type: '', email: '', phone: '' });

  useEffect(() => {
    const db = createSupabaseBrowserClient();
    let query = db
      .from('requests')
      .select('id, customer_email, output_type, status, estimated_cost, created_at, conversations(whatsapp_from)')
      .order('created_at', { ascending: false })
      .limit(100);

    if (filters.status) query = query.eq('status', filters.status);
    if (filters.output_type) query = query.eq('output_type', filters.output_type);
    if (filters.email) query = query.ilike('customer_email', `%${filters.email}%`);

    setLoading(true);
    query.then(({ data }) => {
      const nextRows = ((data ?? []) as unknown as Row[]).filter((row) => {
        if (!filters.phone) return true;
        return row.conversations?.whatsapp_from?.includes(filters.phone);
      });
      setRows(nextRows);
      setLoading(false);
    });
  }, [filters]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">בקשות</h1>
      <div className="flex flex-wrap gap-2 mb-4">
        <select aria-label="סטטוס" className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
          <option value="">כל הסטטוסים</option>
          {Object.entries(STATUS_LABEL).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
        </select>
        <select aria-label="סוג תוצר" className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm" value={filters.output_type} onChange={(e) => setFilters((f) => ({ ...f, output_type: e.target.value }))}>
          <option value="">כל הסוגים</option>
          {Object.entries(OUTPUT_LABEL).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
        </select>
        <input placeholder="מייל" dir="ltr" className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm" value={filters.email} onChange={(e) => setFilters((f) => ({ ...f, email: e.target.value }))} />
        <input placeholder="מספר" dir="ltr" className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm" value={filters.phone} onChange={(e) => setFilters((f) => ({ ...f, phone: e.target.value }))} />
      </div>

      <div className="bg-white rounded-xl border border-[var(--border)] overflow-x-auto">
        <table className="w-full text-sm" dir="rtl">
          <thead>
            <tr className="text-[var(--muted)] border-b border-[var(--border)]">
              <th className="text-start p-3">תאריך</th>
              <th className="text-start p-3">מספר</th>
              <th className="text-start p-3">מייל</th>
              <th className="text-start p-3">סוג</th>
              <th className="text-start p-3">סטטוס</th>
              <th className="text-start p-3">עלות</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="p-6 text-center text-[var(--muted)]">טוען...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="p-6 text-center text-[var(--muted)]">אין בקשות להצגה.</td></tr>
            ) : rows.map((row) => (
              <tr key={row.id} className="border-b border-[var(--border)] hover:bg-gray-50">
                <td className="p-3 ltr">{formatHebrewDateTime(row.created_at)}</td>
                <td className="p-3 ltr">{row.conversations?.whatsapp_from?.replace('whatsapp:', '') ?? '-'}</td>
                <td className="p-3 ltr">{row.customer_email ?? '-'}</td>
                <td className="p-3">{row.output_type ? OUTPUT_LABEL[row.output_type] : '-'}</td>
                <td className="p-3"><span className={`rounded-full px-2 py-1 text-xs ${STATUS_COLOR[row.status]}`}>{STATUS_LABEL[row.status]}</span></td>
                <td className="p-3 ltr">{formatUsd(Number(row.estimated_cost ?? 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
