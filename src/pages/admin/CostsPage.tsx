import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatHebrewDateTime, formatUsd } from '@/lib/format';
import { senderLabel } from '@/lib/labels';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { formatIls, getUsdToIlsRates, rateForDate } from '@/lib/fx';
import { Spinner } from '@/components/ui/Spinner';

interface RequestRow {
  id: string;
  conversation_id: string | null;
  estimated_cost: number | null;
  created_at: string;
  conversations: { whatsapp_from: string } | null;
}

interface ConversationCost {
  conversationId: string;
  phone: string;
  total: number;
  totalIls: number;
  requestCount: number;
  lastAt: string;
}

const PAGE_SIZE = 25;
// Supabase returns at most 1000 rows per request, so page through with .range().
const FETCH_BATCH = 1000;

export default function CostsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [rates, setRates] = useState<Map<string, number | null>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [dates, setDates] = useState({ from: '', to: '' });

  useEffect(() => {
    const db = createSupabaseBrowserClient();
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPage(0);

    const loadAll = async () => {
      try {
        const all: RequestRow[] = [];
        for (let from = 0; ; from += FETCH_BATCH) {
          let query = db
            .from('requests')
            .select('id, conversation_id, estimated_cost, created_at, conversations!requests_conversation_id_fkey(whatsapp_from)')
            .order('created_at', { ascending: false })
            .range(from, from + FETCH_BATCH - 1);
          if (dates.from) query = query.gte('created_at', `${dates.from}T00:00:00`);
          if (dates.to) query = query.lte('created_at', `${dates.to}T23:59:59`);
          const { data, error: queryError } = await query;
          if (queryError) throw queryError;
          const batch = (data ?? []) as unknown as RequestRow[];
          all.push(...batch);
          if (batch.length < FETCH_BATCH) break;
        }
        if (cancelled) return;
        setRows(all);
        setLoading(false);
        const fetchedRates = await getUsdToIlsRates(all.map((r) => r.created_at));
        if (!cancelled) setRates(fetchedRates);
      } catch (err) {
        if (cancelled) return;
        setRows([]);
        setLoading(false);
        setError(err instanceof Error ? err.message : String(err));
      }
    };

    loadAll();
    return () => {
      cancelled = true;
    };
  }, [dates]);

  const { conversations, total, totalIls } = useMemo(() => {
    const map = new Map<string, ConversationCost>();
    let sum = 0;
    let sumIls = 0;
    for (const row of rows) {
      const cost = Number(row.estimated_cost ?? 0);
      const rate = rateForDate(rates, row.created_at);
      const costIls = rate != null ? cost * rate : 0;
      sum += cost;
      sumIls += costIls;
      const id = row.conversation_id ?? row.id;
      const existing = map.get(id);
      if (existing) {
        existing.total += cost;
        existing.totalIls += costIls;
        existing.requestCount += 1;
        if (row.created_at > existing.lastAt) existing.lastAt = row.created_at;
      } else {
        map.set(id, {
          conversationId: id,
          phone: senderLabel(row.conversations?.whatsapp_from),
          total: cost,
          totalIls: costIls,
          requestCount: 1,
          lastAt: row.created_at,
        });
      }
    }
    return {
      conversations: [...map.values()].sort((a, b) => b.total - a.total),
      total: sum,
      totalIls: sumIls,
    };
  }, [rows, rates]);

  const ratesReady = rates.size > 0;

  const pageCount = Math.max(1, Math.ceil(conversations.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = conversations.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
        {embedded ? (
          <p className="text-sm text-[var(--muted)]">סיכום עלות מודלים לפי שיחה.</p>
        ) : (
          <div>
            <h1 className="text-2xl font-bold">עלויות</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">סיכום עלות מודלים לפי שיחה.</p>
          </div>
        )}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center">
          <label className="flex items-center gap-1 text-sm text-[var(--muted)]">
            מתאריך
            <input type="date" aria-label="מתאריך" className="min-w-0 flex-1 rounded-lg border border-[var(--border)] px-3 py-2 text-sm" value={dates.from} onChange={(e) => setDates((d) => ({ ...d, from: e.target.value }))} />
          </label>
          <label className="flex items-center gap-1 text-sm text-[var(--muted)]">
            עד תאריך
            <input type="date" aria-label="עד תאריך" className="min-w-0 flex-1 rounded-lg border border-[var(--border)] px-3 py-2 text-sm" value={dates.to} onChange={(e) => setDates((d) => ({ ...d, to: e.target.value }))} />
          </label>
          {(dates.from || dates.to) && (
            <button
              onClick={() => setDates({ from: '', to: '' })}
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-gray-50"
            >
              נקה תאריכים
            </button>
          )}
          <div className="rounded-xl border border-[var(--border)] bg-white px-4 py-2 text-sm sm:col-span-2">
            סה״כ עלות: <span className="font-bold ltr">{formatUsd(total)}</span>
            {ratesReady && <span className="text-[var(--muted)]"> · <span className="ltr">{formatIls(totalIls)}</span></span>}
          </div>
        </div>
      </div>

      <div className="space-y-3 md:hidden">
        {loading ? (
          <div className="rounded-xl border border-[var(--border)] bg-white p-6 text-center text-[var(--muted)]"><Spinner /></div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-red-600">לא ניתן לטעון עלויות: {error}</div>
        ) : conversations.length === 0 ? (
          <div className="rounded-xl border border-[var(--border)] bg-white p-6 text-center text-[var(--muted)]">אין נתוני עלות להצגה.</div>
        ) : pageRows.map((row) => (
          <article key={row.conversationId} className="rounded-xl border border-[var(--border)] bg-white p-4 shadow-sm">
            <Link to={`/admin/conversations?id=${encodeURIComponent(row.conversationId)}`} className="block truncate font-semibold text-blue-600 ltr">
              {row.phone}
            </Link>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs text-[var(--muted)]">בקשות</div>
                <div className="ltr">{row.requestCount}</div>
              </div>
              <div>
                <div className="text-xs text-[var(--muted)]">פעילות אחרונה</div>
                <div className="ltr">{formatHebrewDateTime(row.lastAt)}</div>
              </div>
              <div>
                <div className="text-xs text-[var(--muted)]">עלות ($)</div>
                <div className="font-semibold ltr">{formatUsd(row.total)}</div>
              </div>
              <div>
                <div className="text-xs text-[var(--muted)]">עלות (₪)</div>
                <div className="font-semibold ltr">{ratesReady ? formatIls(row.totalIls) : '…'}</div>
              </div>
            </div>
          </article>
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded-xl border border-[var(--border)] bg-white md:block">
        <table className="w-full text-sm" dir="rtl">
          <thead>
            <tr className="border-b border-[var(--border)] text-[var(--muted)]">
              <th className="p-3 text-start">מספר</th>
              <th className="p-3 text-start">בקשות</th>
              <th className="p-3 text-start">פעילות אחרונה</th>
              <th className="p-3 text-start">עלות ($)</th>
              <th className="p-3 text-start">עלות (₪)</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="p-6 text-center text-[var(--muted)]"><div className="flex justify-center"><Spinner /></div></td></tr>
            ) : error ? (
              <tr><td colSpan={5} className="p-6 text-center text-red-600">לא ניתן לטעון עלויות: {error}</td></tr>
            ) : conversations.length === 0 ? (
              <tr><td colSpan={5} className="p-6 text-center text-[var(--muted)]">אין נתוני עלות להצגה.</td></tr>
            ) : pageRows.map((row) => (
              <tr key={row.conversationId} className="border-b border-[var(--border)] hover:bg-gray-50">
                <td className="p-3">
                  <Link
                    to={`/admin/conversations?id=${encodeURIComponent(row.conversationId)}`}
                    className="ltr text-blue-600 hover:underline"
                  >
                    {row.phone}
                  </Link>
                </td>
                <td className="p-3"><span className="ltr">{row.requestCount}</span></td>
                <td className="p-3"><span className="ltr">{formatHebrewDateTime(row.lastAt)}</span></td>
                <td className="p-3 font-semibold"><span className="ltr">{formatUsd(row.total)}</span></td>
                <td className="p-3 font-semibold"><span className="ltr">{ratesReady ? formatIls(row.totalIls) : '…'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!loading && conversations.length > 0 && (
        <div className="sticky bottom-[calc(var(--safe-bottom)+0.5rem)] mt-4 flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-white/95 p-2 text-sm shadow-sm backdrop-blur md:static md:border-0 md:bg-transparent md:p-0 md:shadow-none" dir="rtl">
          <span className="text-[var(--muted)]">
            {conversations.length} שיחות · עמוד {currentPage + 1} מתוך {pageCount}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={currentPage === 0}
              className="rounded-lg border border-[var(--border)] bg-white px-3 py-1.5 disabled:opacity-40"
            >
              הקודם
            </button>
            <button
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={currentPage >= pageCount - 1}
              className="rounded-lg border border-[var(--border)] bg-white px-3 py-1.5 disabled:opacity-40"
            >
              הבא
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
