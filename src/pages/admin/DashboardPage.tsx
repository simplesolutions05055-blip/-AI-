import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { OUTPUT_LABEL, STATUS_COLOR, STATUS_LABEL, senderLabel } from '@/lib/labels';
import { formatUsd, formatHebrewDate } from '@/lib/format';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { Tooltip } from '@/components/ui/Tooltip';
import type { OutputType, RequestStatus } from '@/types/db';
import { Spinner } from '@/components/ui/Spinner';
import { Image as ImageIcon, FileText, Presentation, File } from 'lucide-react';

// How many users the
// per-user chart shows before collapsing the rest into "אחרים".
const TOP_USERS = 8;

type OutputRow = {
  created_at: string;
  requests: {
    created_by: string | null;
    profiles: { email: string | null } | null;
    conversations: { whatsapp_from: string | null } | null;
  } | null;
};

type RecentFileRow = {
  id: string;
  output_type: OutputType;
  text_content: string | null;
  storage_path: string | null;
  created_at: string;
  requests: { structured_brief: { source?: string | null } | null } | null;
};

export default function DashboardPage() {
  const [statusRows, setStatusRows] = useState<Array<{ status: RequestStatus }>>([]);
  const [periodReqsCount, setPeriodReqsCount] = useState(0);
  const [periodOutputsCount, setPeriodOutputsCount] = useState(0);
  const [periodCost, setPeriodCost] = useState(0);
  const [totals, setTotals] = useState({ requests: 0, cost: 0, outputs: 0, waiting: 0 });
  const [outputRows, setOutputRows] = useState<OutputRow[]>([]);
  const [recentFiles, setRecentFiles] = useState<Record<OutputType, RecentFileRow[]>>({
    image: [],
    pdf: [],
    presentation: [],
    text: [],
  });
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [timeFilter, setTimeFilter] = useState<number>(14);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const db = createSupabaseBrowserClient();
    // Removed todayIso since it's no longer used for the top metrics.

    const windowStart = new Date();
    windowStart.setHours(0, 0, 0, 0);
    windowStart.setDate(windowStart.getDate() - (timeFilter - 1));
    const windowIso = windowStart.toISOString();

    // Rich select needs the created_by column + profiles relationship. Until the
    // migration is applied that select errors out wholesale, so fall back to a
    // plain select (per-user then groups by conversation source instead).
    async function fetchRecentOutputs() {
      // Explicit FK hints: conversations has two FKs to requests (conversation_id
      // + current_request_id) and profiles is reached via created_by — both are
      // ambiguous to PostgREST without disambiguation.
      const rich = await db
        .from('outputs')
        .select('created_at, requests(created_by, profiles!requests_created_by_fkey(email), conversations!requests_conversation_id_fkey(whatsapp_from))')
        .gte('created_at', windowIso);
      if (!rich.error) return rich.data ?? [];
      console.warn('Dashboard rich outputs query failed, falling back:', rich.error.message);
      const plain = await db
        .from('outputs')
        .select('created_at, requests(conversations!requests_conversation_id_fkey(whatsapp_from))')
        .gte('created_at', windowIso);
      if (plain.error) console.error('Dashboard outputs query failed:', plain.error.message);
      return plain.data ?? [];
    }

    Promise.all([
      db.from('requests').select('status').gte('created_at', windowIso),
      db.from('requests').select('id', { count: 'exact', head: true }).gte('created_at', windowIso),
      db.from('usage_events').select('estimated_cost').gte('created_at', windowIso),
      db.from('outputs').select('id', { count: 'exact', head: true }).gte('created_at', windowIso),
      fetchRecentOutputs(),
      db.from('requests').select('id', { count: 'exact', head: true }),
      db.from('usage_events').select('estimated_cost'),
      db.from('outputs').select('id', { count: 'exact', head: true }),
      db.from('requests').select('id', { count: 'exact', head: true }).eq('status', 'waiting_for_approval'),
      db
        .from('outputs')
        .select('id, output_type, text_content, storage_path, created_at, requests(structured_brief)')
        .order('created_at', { ascending: false })
        .limit(30),
    ]).then(([statuses, pReq, pCost, pOut, recentOutputs, tReq, tCost, tOut, tWait, recentFilesData]) => {
      setStatusRows((statuses.data ?? []) as Array<{ status: RequestStatus }>);
      setPeriodReqsCount(pReq.count ?? 0);
      setPeriodCost((pCost.data ?? []).reduce((sum, row: any) => sum + Number(row.estimated_cost ?? 0), 0));
      setPeriodOutputsCount(pOut.count ?? 0);
      setOutputRows((recentOutputs ?? []) as unknown as OutputRow[]);

      setTotals({
        requests: tReq.count ?? 0,
        cost: (tCost.data ?? []).reduce((sum, row: any) => sum + Number(row.estimated_cost ?? 0), 0),
        outputs: tOut.count ?? 0,
        waiting: tWait.count ?? 0,
      });

      // Group recent files by type, taking 2 per type
      const grouped: Record<OutputType, RecentFileRow[]> = {
        image: [],
        pdf: [],
        presentation: [],
        text: [],
      };
      for (const file of (recentFilesData.data ?? []) as RecentFileRow[]) {
        if (file.requests?.structured_brief?.source === 'quote') continue;
        if (grouped[file.output_type].length < 2) {
          grouped[file.output_type].push(file);
        }
      }
      setRecentFiles(grouped);
      setLoading(false);

      // Generate signed thumbnail URLs for the image outputs shown in the boxes.
      const images = grouped.image.filter((f) => f.storage_path);
      Promise.all(
        images.map(async (f) => {
          const { data: s } = await db.storage.from('outputs').createSignedUrl(f.storage_path as string, 600);
          return [f.id, s?.signedUrl] as const;
        }),
      ).then((pairs) => {
        setPreviews(Object.fromEntries(pairs.filter(([, url]) => url)) as Record<string, string>);
      });
    });
  }, [timeFilter]);

  const byStatus: Record<string, number> = {};
  statusRows.forEach((r) => {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  });

  const daily = buildDailySeries(outputRows, timeFilter);
  const perUser = buildPerUserSeries(outputRows);

  const cards = [
    { label: 'בקשות בתקופה', value: periodReqsCount, subtext: `סה״כ: ${totals.requests}` },
    { label: 'עלות בתקופה', value: formatUsd(periodCost), ltr: true, subtext: `סה״כ: ${formatUsd(totals.cost)}` },
    { label: 'תוצרים בתקופה', value: periodOutputsCount, subtext: `סה״כ: ${totals.outputs}` },
    { label: 'ממתינות (נוצרו בתקופה)', value: byStatus.waiting_for_approval ?? 0, subtext: `סה״כ ממתינות: ${totals.waiting}` },
  ];

  if (loading) return <p className="text-[var(--muted)]"><Spinner /></p>;

  return (
    <div dir="rtl" className="min-w-0">
      <div className="mb-5 flex items-center justify-between sm:mb-6">
        <h1 className="text-[28px] font-bold leading-tight sm:text-2xl">לוח בקרה</h1>
        <select
          value={timeFilter}
          onChange={(e) => setTimeFilter(Number(e.target.value))}
          className="rounded-lg border border-[var(--border)] bg-white px-3 py-1.5 text-sm font-semibold shadow-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand"
        >
          <option value={1}>היום האחרון</option>
          <option value={7}>השבוע האחרון</option>
          <option value={14}>14 ימים אחרונים</option>
          <option value={30}>החודש האחרון</option>
          <option value={365}>השנה האחרונה</option>
        </select>
      </div>

      <section className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4 lg:mb-8">
        {cards.map((card) => (
          <div key={card.label} className="min-w-0 rounded-xl border border-[var(--border)] bg-white p-3 sm:p-4 flex flex-col">
            <div className="mb-1 truncate text-sm text-[var(--muted)]">{card.label}</div>
            <div className={`truncate text-[26px] font-bold leading-tight sm:text-2xl ${card.ltr ? 'ltr max-w-full' : ''}`}>{card.value}</div>
            <div className="mt-1 text-[11px] text-[var(--muted)] font-medium ltr text-right">{card.subtext}</div>
          </div>
        ))}
      </section>

      <div className="mb-6 grid min-w-0 gap-4 lg:mb-8 lg:grid-cols-2 lg:gap-8">
        <DailyOutputsChart data={daily} windowDays={timeFilter} />
        <PerUserOutputsChart data={perUser} windowDays={timeFilter} />
      </div>

      <section className="mt-5 rounded-[14px] border border-[#EAECF0] bg-white px-5 py-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:px-8 mb-8">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[18px] font-bold text-[#1A1A2E]">תוצרים אחרונים</h2>
          <Link to="/admin/files" className="rounded-lg border border-[#EAECF0] px-4 py-1.5 text-[13px] font-semibold text-[#1A1A2E] hover:bg-[#F8FAFC] transition-colors">
            כל התוצרים
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {(['image', 'pdf', 'presentation', 'text'] as const).map((type) => {
            const bgColors: Record<OutputType, string> = {
              image: '#FEF3C7',
              pdf: '#DBEAFE',
              presentation: '#D1FAE5',
              text: '#EDE9FE',
            };
            const typeIcon: Record<OutputType, React.ReactNode> = {
              image: <ImageIcon className="h-5 w-5 text-[#1A1A2E]" />,
              pdf: <FileText className="h-5 w-5 text-[#1A1A2E]" />,
              presentation: <Presentation className="h-5 w-5 text-[#1A1A2E]" />,
              text: <File className="h-5 w-5 text-[#1A1A2E]" />,
            };
            const items = recentFiles[type];
            return (
              <Link
                key={type}
                to={`/admin/files?type=${type}`}
                className="group flex flex-col overflow-hidden rounded-[12px] border border-[#EAECF0] bg-white text-right transition hover:-translate-y-0.5 hover:border-[#BFDBFE] hover:shadow-sm"
              >
                {/* Header band — category color + icon + name */}
                <div className="flex items-center gap-2 px-3 py-2.5" style={{ backgroundColor: bgColors[type] }}>
                  {typeIcon[type]}
                  <span className="text-[13px] font-bold text-[#1A1A2E]">{OUTPUT_LABEL[type]}</span>
                </div>

                {/* Up to 2 real recent products from this category */}
                <div className="flex flex-1 flex-col gap-2 p-3">
                  {items.length === 0 ? (
                    <div className="flex flex-1 items-center justify-center py-6 text-[11px] text-[#94A3B8]">
                      אין תוצרים עדיין
                    </div>
                  ) : (
                    items.map((file) => (
                      <div key={file.id} className="flex items-center gap-2 rounded-[8px] border border-[#F1F5F9] p-1.5">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[6px] bg-[#F8FAFC]">
                          {file.output_type === 'image' && previews[file.id] ? (
                            <img src={previews[file.id]} alt="" className="h-full w-full object-cover" />
                          ) : file.text_content ? (
                            <span className="px-0.5 text-[6px] leading-[7px] text-[#94A3B8] line-clamp-3 break-all">
                              {file.text_content.slice(0, 60)}
                            </span>
                          ) : (
                            <div className="flex h-full w-full items-center justify-center opacity-70">
                              {typeIcon[file.output_type]}
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[11px] font-medium text-[#1A1A2E]">
                            {file.text_content ? file.text_content.slice(0, 30) : OUTPUT_LABEL[file.output_type]}
                          </div>
                          <div className="text-[10px] text-[#94A3B8] ltr text-start">{formatHebrewDate(file.created_at)}</div>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="p-3 pt-0">
                  <div className="flex w-full items-center justify-center rounded-[8px] bg-[#F8FAFC] py-2 text-[12px] font-semibold text-[#1E293B] transition-colors group-hover:bg-[#F1F5F9] border border-[#F1F5F9] group-hover:border-[#E2E8F0]">
                    צפייה בכל ה{OUTPUT_LABEL[type]}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>


    </div>
  );
}

// ─── daily outputs ──────────────────────────────────────────────────────────

function buildDailySeries(rows: OutputRow[], windowDays: number): Array<{ key: string; label: string; count: number }> {
  // Seed every day in the window with 0 so gaps render as empty bars, not holes.
  const days: Array<{ key: string; label: string; count: number }> = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() - (windowDays - 1));
  for (let i = 0; i < windowDays; i++) {
    const key = localDayKey(cursor);
    days.push({ key, label: `${cursor.getDate()}/${cursor.getMonth() + 1}`, count: 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  const index = new Map(days.map((d) => [d.key, d]));
  for (const row of rows) {
    const day = index.get(localDayKey(new Date(row.created_at)));
    if (day) day.count += 1;
  }
  return days;
}

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function DailyOutputsChart({ data, windowDays }: { data: Array<{ key: string; label: string; count: number }>; windowDays: number }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const total = data.reduce((sum, d) => sum + d.count, 0);

  return (
    <section className="min-w-0 rounded-xl border border-[var(--border)] bg-white p-3 sm:p-4">
      <div className="mb-4 flex items-start justify-between gap-3 sm:items-baseline">
        <h2 className="shrink-0 font-semibold">תוצרים לפי יום</h2>
        <span className="text-start text-xs text-[var(--muted)]">{windowDays === 1 ? 'היום האחרון' : `${windowDays} ימים אחרונים`} · סה״כ {total}</span>
      </div>
      {total === 0 ? (
        <p className="text-sm text-[var(--muted)]">אין תוצרים בטווח הזה.</p>
      ) : (
        <div className="min-w-0 overflow-x-auto pb-2 custom-scrollbar">
          <div className="flex h-40 min-w-min gap-1 sm:h-44 sm:gap-1.5" style={{ minWidth: `${data.length * 28}px` }}>
            {data.map((d) => (
              <Tooltip key={d.key} content={`${d.label}: ${d.count}`}>
                <div className="flex h-full min-w-0 flex-1 flex-col items-center gap-1.5 cursor-pointer">
                  <span className="text-[10px] font-semibold text-[var(--muted)]">{d.count || ''}</span>
                  {/* flex-1 track has a definite height so the bar's % resolves correctly */}
                  <div className="flex w-full flex-1 flex-col justify-end">
                    <div
                      className="mx-auto w-full max-w-8 rounded-t bg-brand/80 transition-all hover:bg-brand"
                      style={{ height: `${Math.max(d.count ? 6 : 2, (d.count / max) * 100)}%` }}
                    />
                  </div>
                  <span className="whitespace-nowrap text-[9px] text-[var(--muted)] ltr sm:text-[10px]">{d.label}</span>
                </div>
              </Tooltip>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ─── per-user outputs ─────────────────────────────────────────────────────────

function buildPerUserSeries(rows: OutputRow[]): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    // Prefer the producing system user's email (form requests); fall back to the
    // conversation source for WhatsApp / legacy requests with no created_by.
    const email = row.requests?.profiles?.email ?? null;
    const label = email ?? senderLabel(row.requests?.conversations?.whatsapp_from ?? null);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
  if (sorted.length <= TOP_USERS) return sorted;
  const top = sorted.slice(0, TOP_USERS);
  const rest = sorted.slice(TOP_USERS).reduce((sum, u) => sum + u.count, 0);
  return [...top, { label: 'אחרים', count: rest }];
}

function PerUserOutputsChart({ data, windowDays }: { data: Array<{ label: string; count: number }>; windowDays: number }) {
  const max = Math.max(1, ...data.map((d) => d.count));

  return (
    <section className="min-w-0 rounded-xl border border-[var(--border)] bg-white p-3 sm:p-4">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="font-semibold">תוצרים לפי משתמש</h2>
        <span className="text-xs text-[var(--muted)]">{windowDays === 1 ? 'היום האחרון' : `${windowDays} ימים אחרונים`}</span>
      </div>
      {data.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">אין תוצרים בטווח הזה.</p>
      ) : (
        <div className="flex min-w-0 flex-col gap-3">
          {data.map((d) => (
            <Tooltip
              key={d.label}
              content={
                <div className="flex items-center gap-1">
                  <span dir="ltr" className="text-right break-all">{d.label}</span>
                  <span>:</span>
                  <span className="font-semibold">{d.count}</span>
                </div>
              }
            >
              <div className="flex min-w-0 items-center gap-2 sm:gap-3 cursor-pointer group">
                <span className="w-16 shrink-0 truncate text-sm text-[var(--text)] sm:w-28 text-right" dir="ltr">{d.label}</span>
                <div className="h-5 flex-1 overflow-hidden rounded bg-gray-100">
                  <div
                    className="h-full rounded bg-brand/80 transition-all group-hover:bg-brand"
                    style={{ width: `${Math.max(4, (d.count / max) * 100)}%` }}
                  />
                </div>
                <span className="w-8 shrink-0 text-left text-sm font-semibold tabular-nums">{d.count}</span>
              </div>
            </Tooltip>
          ))}
        </div>
      )}
    </section>
  );
}
