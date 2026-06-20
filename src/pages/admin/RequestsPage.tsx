import { useEffect, useState } from 'react';
import { STATUS_COLOR, STATUS_LABEL, OUTPUT_LABEL } from '@/lib/labels';
import { formatHebrewDateTime, formatUsd } from '@/lib/format';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { formatIls, getUsdToIlsRates, rateForDate } from '@/lib/fx';
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
  const [rates, setRates] = useState<Map<string, number | null>>(new Map());
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: '', output_type: '', email: '', phone: '', from: '', to: '' });

  useEffect(() => {
    const db = createSupabaseBrowserClient();
    let cancelled = false;
    let query = db
      .from('requests')
      .select('id, customer_email, output_type, status, estimated_cost, created_at, conversations!requests_conversation_id_fkey(whatsapp_from)')
      .order('created_at', { ascending: false })
      .limit(100);

    if (filters.status) query = query.eq('status', filters.status);
    if (filters.output_type) query = query.eq('output_type', filters.output_type);
    if (filters.email) query = query.ilike('customer_email', `%${filters.email}%`);
    if (filters.from) query = query.gte('created_at', `${filters.from}T00:00:00`);
    if (filters.to) query = query.lte('created_at', `${filters.to}T23:59:59`);

    setLoading(true);
    query.then(async ({ data }) => {
      if (cancelled) return;
      const nextRows = ((data ?? []) as unknown as Row[]).filter((row) => {
        if (!filters.phone) return true;
        return row.conversations?.whatsapp_from?.includes(filters.phone);
      });
      setRows(nextRows);
      setLoading(false);
      // Convert each cost using the USD→ILS rate of the day it was incurred.
      const fetchedRates = await getUsdToIlsRates(nextRows.map((r) => r.created_at));
      if (!cancelled) setRates(fetchedRates);
    });

    return () => {
      cancelled = true;
    };
  }, [filters]);

  const ratesReady = rates.size > 0;

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
        <label className="flex items-center gap-1 text-sm text-[var(--muted)]">
          מתאריך
          <input type="date" aria-label="מתאריך" className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
        </label>
        <label className="flex items-center gap-1 text-sm text-[var(--muted)]">
          עד תאריך
          <input type="date" aria-label="עד תאריך" className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
        </label>
        {(filters.from || filters.to) && (
          <button
            onClick={() => setFilters((f) => ({ ...f, from: '', to: '' }))}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-gray-50"
          >
            נקה תאריכים
          </button>
        )}
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
              <th className="text-start p-3">עלות ($)</th>
              <th className="text-start p-3">עלות (₪)</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="p-6 text-center text-[var(--muted)]">טוען...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="p-6 text-center text-[var(--muted)]">אין בקשות להצגה.</td></tr>
            ) : rows.map((row) => {
              const rate = rateForDate(rates, row.created_at);
              const cost = Number(row.estimated_cost ?? 0);
              return (
                <tr key={row.id} className="border-b border-[var(--border)] hover:bg-gray-50">
                  <td className="p-3"><span className="ltr">{formatHebrewDateTime(row.created_at)}</span></td>
                  <td className="p-3"><span className="ltr">{row.conversations?.whatsapp_from?.replace('whatsapp:', '') ?? '-'}</span></td>
                  <td className="p-3"><span className="ltr">{row.customer_email ?? '-'}</span></td>
                  <td className="p-3">{row.output_type ? OUTPUT_LABEL[row.output_type] : '-'}</td>
                  <td className="p-3"><span className={`rounded-full px-2 py-1 text-xs ${STATUS_COLOR[row.status]}`}>{STATUS_LABEL[row.status]}</span></td>
                  <td className="p-3"><span className="ltr">{formatUsd(cost)}</span></td>
                  <td className="p-3"><span className="ltr">{ratesReady ? (rate != null ? formatIls(cost * rate) : '—') : '…'}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
