'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { STATUS_LABEL, STATUS_COLOR, OUTPUT_LABEL } from '@/lib/labels';
import { formatHebrewDateTime, formatUsd } from '@/lib/format';
import type { RequestStatus, OutputType } from '@/types/db';

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

  const load = useCallback(async () => {
    setLoading(true);
    const sp = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && sp.set(k, v));
    const res = await fetch(`/api/admin/requests?${sp.toString()}`);
    const data = await res.json();
    setRows(data.requests ?? []);
    setLoading(false);
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">בקשות</h1>

      <div className="flex flex-wrap gap-2 mb-4">
        <select
          aria-label="סטטוס"
          className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
          value={filters.status}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
        >
          <option value="">כל הסטטוסים</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select
          aria-label="סוג תוצר"
          className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
          value={filters.output_type}
          onChange={(e) => setFilters((f) => ({ ...f, output_type: e.target.value }))}
        >
          <option value="">כל הסוגים</option>
          {Object.entries(OUTPUT_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <input
          placeholder="מייל"
          dir="ltr"
          className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
          value={filters.email}
          onChange={(e) => setFilters((f) => ({ ...f, email: e.target.value }))}
        />
        <input
          placeholder="מספר"
          dir="ltr"
          className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
          value={filters.phone}
          onChange={(e) => setFilters((f) => ({ ...f, phone: e.target.value }))}
        />
        <a
          href={`/api/admin/export.xlsx`}
          className="btn inline-flex items-center rounded-lg bg-gray-100 hover:bg-gray-200 px-3 py-2 text-sm font-medium"
        >
          ייצוא XLSX
        </a>
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
              <tr>
                <td colSpan={6} className="p-6 text-center text-[var(--muted)]">
                  טוען…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-6 text-center text-[var(--muted)]">
                  אין בקשות להצגה.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b border-[var(--border)] hover:bg-gray-50">
                  <td className="p-3">
                    <Link href={`/admin/requests/${r.id}`} className="text-brand hover:underline ltr">
                      {formatHebrewDateTime(r.created_at)}
                    </Link>
                  </td>
                  <td className="p-3 ltr">{r.conversations?.whatsapp_from?.replace('whatsapp:', '') ?? '—'}</td>
                  <td className="p-3 ltr">{r.customer_email ?? '—'}</td>
                  <td className="p-3">{r.output_type ? OUTPUT_LABEL[r.output_type] : '—'}</td>
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-1 text-xs ${STATUS_COLOR[r.status]}`}>
                      {STATUS_LABEL[r.status]}
                    </span>
                  </td>
                  <td className="p-3 ltr">{formatUsd(Number(r.estimated_cost))}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
