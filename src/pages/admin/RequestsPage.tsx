import { useEffect, useState } from 'react';
import { STATUS_COLOR, STATUS_LABEL, OUTPUT_LABEL, senderLabel } from '@/lib/labels';
import { formatHebrewDateTime, formatUsd } from '@/lib/format';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { formatIls, getUsdToIlsRates, rateForDate } from '@/lib/fx';
import type { OutputType, RequestStatus } from '@/types/db';
import { Spinner } from '@/components/ui/Spinner';

interface Row {
  id: string;
  customer_email: string | null;
  output_type: OutputType | null;
  status: RequestStatus;
  estimated_cost: number;
  created_at: string;
  conversation_id: string | null;
  structured_brief: Record<string, unknown> | null;
  conversations: { whatsapp_from: string } | null;
}

// A short human description of what the user actually tried to produce, beyond
// the generic type (מסמך/תמונה/...). Prefers the detected subtype, then the
// stated goal; falls back to the source materials so the row is never empty.
function briefDetail(brief: Record<string, unknown> | null): string | null {
  if (!brief) return null;
  const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const detail = pick(brief.subtype) ?? pick(brief.goal) ?? pick(brief.source_materials);
  if (!detail) return null;
  return detail.length > 80 ? `${detail.slice(0, 80)}…` : detail;
}

export default function RequestsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [rates, setRates] = useState<Map<string, number | null>>(new Map());
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: '', output_type: '', email: '', phone: '', from: '', to: '' });
  const [selectedRequest, setSelectedRequest] = useState<Row | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  useEffect(() => {
    const db = createSupabaseBrowserClient();
    let cancelled = false;
    let query = db
      .from('requests')
      .select('id, customer_email, output_type, status, estimated_cost, created_at, conversation_id, structured_brief, conversations!requests_conversation_id_fkey(whatsapp_from)')
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

  // Totals across the displayed rows. USD always sums; ILS sums only the rows
  // whose daily rate is available (missing rates are skipped, not zeroed).
  const totalUsd = rows.reduce((sum, r) => sum + Number(r.estimated_cost ?? 0), 0);
  const totalIls = rows.reduce((sum, r) => {
    const rate = rateForDate(rates, r.created_at);
    return rate != null ? sum + Number(r.estimated_cost ?? 0) * rate : sum;
  }, 0);

  return (
    <div>
      {!embedded && <h1 className="text-2xl font-bold mb-6">בקשות</h1>}

      <div className="mb-3 flex items-center justify-between gap-2 md:hidden">
        <button
          onClick={() => setShowFilters((v) => !v)}
          className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm"
        >
          <span>סינון</span>
          {activeFilterCount > 0 && (
            <span className="rounded-full bg-blue-600 px-1.5 text-xs font-semibold text-white">{activeFilterCount}</span>
          )}
          <span className="text-[var(--muted)]">{showFilters ? '▲' : '▼'}</span>
        </button>
        {activeFilterCount > 0 && (
          <button
            onClick={() => setFilters({ status: '', output_type: '', email: '', phone: '', from: '', to: '' })}
            className="text-sm text-blue-600"
          >
            נקה הכל
          </button>
        )}
      </div>

      <div className={`${showFilters ? 'grid' : 'hidden'} mb-4 grid-cols-1 gap-2 sm:grid-cols-2 md:flex md:flex-nowrap md:overflow-x-auto`}>
        <select aria-label="סטטוס" className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm md:shrink-0 md:min-w-max" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
          <option value="">כל הסטטוסים</option>
          {Object.entries(STATUS_LABEL).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
        </select>
        <select aria-label="סוג תוצר" className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm md:shrink-0 md:min-w-max" value={filters.output_type} onChange={(e) => setFilters((f) => ({ ...f, output_type: e.target.value }))}>
          <option value="">כל הסוגים</option>
          {Object.entries(OUTPUT_LABEL).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
        </select>
        <input placeholder="מייל" dir="ltr" className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm md:shrink-0 md:min-w-max" value={filters.email} onChange={(e) => setFilters((f) => ({ ...f, email: e.target.value }))} />
        <input placeholder="מספר" dir="ltr" className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm md:shrink-0 md:min-w-max" value={filters.phone} onChange={(e) => setFilters((f) => ({ ...f, phone: e.target.value }))} />
        <label className="flex items-center gap-1 text-sm text-[var(--muted)] md:shrink-0 md:whitespace-nowrap">
          מתאריך
          <input type="date" aria-label="מתאריך" className="min-w-0 flex-1 rounded-lg border border-[var(--border)] px-3 py-2 text-sm md:min-w-auto md:flex-auto" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
        </label>
        <label className="flex items-center gap-1 text-sm text-[var(--muted)] md:shrink-0 md:whitespace-nowrap">
          עד תאריך
          <input type="date" aria-label="עד תאריך" className="min-w-0 flex-1 rounded-lg border border-[var(--border)] px-3 py-2 text-sm md:min-w-auto md:flex-auto" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
        </label>
        {(filters.from || filters.to) && (
          <button
            onClick={() => setFilters((f) => ({ ...f, from: '', to: '' }))}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-gray-50 md:shrink-0 md:whitespace-nowrap"
          >
            נקה תאריכים
          </button>
        )}
      </div>

      {!loading && rows.length > 0 && (
        <div className="mb-3 flex items-baseline justify-between rounded-xl border border-[var(--border)] bg-white p-4 md:hidden">
          <span className="text-sm font-semibold">סה"כ ({rows.length})</span>
          <span className="flex items-baseline gap-2 text-sm">
            <span className="font-semibold ltr">{formatUsd(totalUsd)}</span>
            <span className="ltr text-[var(--muted)]">{ratesReady ? formatIls(totalIls) : '…'}</span>
          </span>
        </div>
      )}

      <div className="space-y-3 md:hidden">
        {loading ? (
          <div className="rounded-xl border border-[var(--border)] bg-white p-6 text-center text-[var(--muted)]"><Spinner /></div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-[var(--border)] bg-white p-6 text-center text-[var(--muted)]">אין בקשות להצגה.</div>
        ) : rows.map((row) => {
          const rate = rateForDate(rates, row.created_at);
          const cost = Number(row.estimated_cost ?? 0);
          return (
            <article
              key={row.id}
              onClick={() => setSelectedRequest(row)}
              className="rounded-xl border border-[var(--border)] bg-white p-4 shadow-sm cursor-pointer hover:shadow-md transition"
            >
              <div className="flex items-center justify-between gap-3">
                <span className={`shrink-0 rounded-full px-2 py-1 text-xs ${STATUS_COLOR[row.status]}`}>{STATUS_LABEL[row.status]}</span>
                <span className="text-xs text-[var(--muted)] ltr">{formatHebrewDateTime(row.created_at)}</span>
              </div>
              <div className="mt-2 font-semibold">
                {row.output_type ? OUTPUT_LABEL[row.output_type] : 'בקשה'}
              </div>
              {briefDetail(row.structured_brief) && (
                <div className="mt-0.5 text-sm text-[var(--muted)]">{briefDetail(row.structured_brief)}</div>
              )}
              <div className="mt-1 truncate text-sm ltr text-[var(--muted)]">
                {row.customer_email ?? senderLabel(row.conversations?.whatsapp_from)}
              </div>
              <div className="mt-3 border-t border-[var(--border)] pt-2 flex items-baseline gap-2 text-sm">
                <span className="font-semibold ltr">{formatUsd(cost)}</span>
                <span className="ltr text-[var(--muted)]">{ratesReady ? (rate != null ? formatIls(cost * rate) : '—') : '…'}</span>
              </div>
            </article>
          );
        })}
      </div>

      <div className="hidden overflow-x-auto rounded-xl border border-[var(--border)] bg-white md:block">
        <table className="w-full text-sm" dir="rtl">
          <thead>
            <tr className="text-[var(--muted)] border-b border-[var(--border)]">
              <th className="text-start p-3">תאריך</th>
              <th className="text-start p-3">מייל</th>
              <th className="text-start p-3">סוג תוצר</th>
              <th className="text-start p-3">סטטוס</th>
              <th className="text-start p-3">עלות ($)</th>
              <th className="text-start p-3">עלות (₪)</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="p-6 text-center text-[var(--muted)]"><div className="flex justify-center"><Spinner /></div></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="p-6 text-center text-[var(--muted)]">אין בקשות להצגה.</td></tr>
            ) : rows.map((row) => {
              const rate = rateForDate(rates, row.created_at);
              const cost = Number(row.estimated_cost ?? 0);
              return (
                <tr
                  key={row.id}
                  onClick={() => setSelectedRequest(row)}
                  className="border-b border-[var(--border)] hover:bg-gray-50 cursor-pointer"
                >
                  <td className="p-3"><span className="ltr">{formatHebrewDateTime(row.created_at)}</span></td>
                  <td className="p-3"><span className="ltr">{row.customer_email ?? '-'}</span></td>
                  <td className="p-3">
                    <div className="font-medium">{row.output_type ? OUTPUT_LABEL[row.output_type] : '-'}</div>
                    {briefDetail(row.structured_brief) && (
                      <div className="text-xs text-[var(--muted)]">{briefDetail(row.structured_brief)}</div>
                    )}
                  </td>
                  <td className="p-3"><span className={`rounded-full px-2 py-1 text-xs ${STATUS_COLOR[row.status]}`}>{STATUS_LABEL[row.status]}</span></td>
                  <td className="p-3"><span className="ltr">{formatUsd(cost)}</span></td>
                  <td className="p-3"><span className="ltr">{ratesReady ? (rate != null ? formatIls(cost * rate) : '—') : '…'}</span></td>
                </tr>
              );
            })}
          </tbody>
          {!loading && rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-[var(--border)] font-semibold">
                <td className="p-3" colSpan={3}>סה"כ ({rows.length} בקשות)</td>
                <td className="p-3" />
                <td className="p-3"><span className="ltr">{formatUsd(totalUsd)}</span></td>
                <td className="p-3"><span className="ltr">{ratesReady ? formatIls(totalIls) : '…'}</span></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {selectedRequest && (
        <RequestModal
          request={selectedRequest}
          onClose={() => setSelectedRequest(null)}
        />
      )}
    </div>
  );
}

interface RequestDetail {
  id: string;
  customer_email: string | null;
  output_type: OutputType | null;
  status: RequestStatus;
  estimated_cost: number;
  created_at: string;
  structured_brief: Record<string, unknown> | null;
  admin_note: string | null;
  conversation_id: string | null;
  conversations: { whatsapp_from: string } | null;
}

function RequestModal({ request, onClose }: { request: Row; onClose: () => void }) {
  const [detail, setDetail] = useState<RequestDetail | null>({
    ...request,
    admin_note: null,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const db = createSupabaseBrowserClient();
    db.from('requests')
      .select('id, customer_email, output_type, status, estimated_cost, created_at, structured_brief, admin_note, conversation_id, conversations!requests_conversation_id_fkey(whatsapp_from)')
      .eq('id', request.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) console.error('Error fetching request:', error);
        if (data) setDetail(data as unknown as RequestDetail);
        setLoading(false);
      });
  }, [request.id]);

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 border-b border-[var(--border)] bg-white p-4 flex items-center justify-between">
          <h2 className="font-bold text-lg">פרטי בקשה</h2>
          <button
            onClick={onClose}
            className="text-[var(--muted)] hover:text-[var(--text)] text-2xl leading-none"
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-4">
          {loading ? (
            <div className="text-center text-[var(--muted)]"><Spinner /></div>
          ) : detail ? (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-[var(--muted)]">מזהה</div>
                  <div className="font-mono text-sm break-all">{detail.id}</div>
                </div>
                <div>
                  <div className="text-xs text-[var(--muted)]">סטטוס</div>
                  <div className="text-sm">{STATUS_LABEL[detail.status]}</div>
                </div>
                <div>
                  <div className="text-xs text-[var(--muted)]">מייל</div>
                  <div className="text-sm ltr break-all">{detail.customer_email ?? '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-[var(--muted)]">סוג</div>
                  <div className="text-sm">{detail.output_type ? OUTPUT_LABEL[detail.output_type] : '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-[var(--muted)]">עלות</div>
                  <div className="text-sm ltr">${detail.estimated_cost?.toFixed(2) ?? '0.00'}</div>
                </div>
                <div>
                  <div className="text-xs text-[var(--muted)]">תאריך</div>
                  <div className="text-sm ltr">{formatHebrewDateTime(detail.created_at)}</div>
                </div>
              </div>

              {detail.conversations?.whatsapp_from && (
                <div>
                  <div className="text-xs text-[var(--muted)]">מספר</div>
                  <div className="text-sm ltr">{detail.conversations.whatsapp_from}</div>
                </div>
              )}

              {detail.structured_brief && (
                <div>
                  <div className="text-xs font-bold text-[var(--muted)] mb-2">בריף</div>
                  <div className="bg-gray-50 rounded-lg p-3 text-xs space-y-1 max-h-48 overflow-y-auto">
                    {Object.entries(detail.structured_brief).map(([key, value]) => (
                      <div key={key} className="leading-relaxed">
                        <span className="font-semibold">{key}:</span> {String(value)}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {detail.admin_note && (
                <div>
                  <div className="text-xs font-bold text-[var(--muted)] mb-2">הערת מנהל</div>
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm whitespace-pre-wrap">
                    {detail.admin_note}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-center text-[var(--muted)]">לא נמצאה בקשה.</div>
          )}
        </div>
      </div>
    </div>
  );
}
