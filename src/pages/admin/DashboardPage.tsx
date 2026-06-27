import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { OUTPUT_LABEL, STATUS_COLOR, STATUS_LABEL, senderLabel } from '@/lib/labels';
import { formatUsd, formatHebrewDate } from '@/lib/format';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import type { OutputType, RequestStatus } from '@/types/db';

// How many recent days the daily-outputs chart covers, and how many users the
// per-user chart shows before collapsing the rest into "אחרים".
const DAILY_WINDOW_DAYS = 14;
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
  const [todayCount, setTodayCount] = useState(0);
  const [outputsCount, setOutputsCount] = useState(0);
  const [todayCost, setTodayCost] = useState(0);
  const [outputRows, setOutputRows] = useState<OutputRow[]>([]);
  const [recentFiles, setRecentFiles] = useState<Record<OutputType, RecentFileRow[]>>({
    image: [],
    pdf: [],
    presentation: [],
    text: [],
  });
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const db = createSupabaseBrowserClient();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const todayIso = startOfDay.toISOString();

    const windowStart = new Date();
    windowStart.setHours(0, 0, 0, 0);
    windowStart.setDate(windowStart.getDate() - (DAILY_WINDOW_DAYS - 1));
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
      db.from('requests').select('status'),
      db.from('requests').select('id', { count: 'exact', head: true }).gte('created_at', todayIso),
      db.from('usage_events').select('estimated_cost').gte('created_at', todayIso),
      db.from('outputs').select('id', { count: 'exact', head: true }),
      fetchRecentOutputs(),
      db
        .from('outputs')
        .select('id, output_type, text_content, storage_path, created_at, requests(structured_brief)')
        .order('created_at', { ascending: false })
        .limit(30),
    ]).then(([statuses, today, costs, outputs, recentOutputs, recentFilesData]) => {
      setStatusRows((statuses.data ?? []) as Array<{ status: RequestStatus }>);
      setTodayCount(today.count ?? 0);
      setTodayCost((costs.data ?? []).reduce((sum, row: any) => sum + Number(row.estimated_cost ?? 0), 0));
      setOutputsCount(outputs.count ?? 0);
      setOutputRows((recentOutputs ?? []) as unknown as OutputRow[]);

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
  }, []);

  const byStatus: Record<string, number> = {};
  statusRows.forEach((r) => {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  });

  const daily = buildDailySeries(outputRows);
  const perUser = buildPerUserSeries(outputRows);

  const cards = [
    { label: 'בקשות היום', value: todayCount },
    { label: 'עלות היום', value: formatUsd(todayCost), ltr: true },
    { label: 'סך תוצרים', value: outputsCount },
    { label: 'ממתינות לאישור', value: byStatus.waiting_for_approval ?? 0 },
  ];

  if (loading) return <p className="text-[var(--muted)]">טוען...</p>;

  return (
    <div dir="rtl">
      <h1 className="text-2xl font-bold mb-6">לוח בקרה</h1>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {cards.map((card) => (
          <div key={card.label} className="bg-white rounded-xl border border-[var(--border)] p-4">
            <div className="text-sm text-[var(--muted)] mb-1">{card.label}</div>
            <div className={`text-2xl font-bold ${card.ltr ? 'ltr' : ''}`}>{card.value}</div>
          </div>
        ))}
      </section>

      <div className="grid gap-8 lg:grid-cols-2 mb-8">
        <DailyOutputsChart data={daily} />
        <PerUserOutputsChart data={perUser} />
      </div>

      <section className="mt-5 rounded-[14px] border border-[#EAECF0] bg-white px-5 py-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:px-8 mb-8">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[18px] font-bold text-[#1A1A2E]">תוצרים אחרונים</h2>
          <Link to="/admin/files" className="text-[13px] font-semibold text-[#2563EB] hover:underline">
            ← כל התוצרים
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
            const typeIcon: Record<OutputType, string> = {
              image: '🖼️',
              pdf: '📕',
              presentation: '📊',
              text: '📄',
            };
            const items = recentFiles[type];
            return (
              <Link
                key={type}
                to={`/admin/files?type=${type}`}
                className="group flex flex-col overflow-hidden rounded-[12px] border border-[#EAECF0] bg-white text-right transition hover:-translate-y-0.5 hover:border-[#BFDBFE]"
              >
                {/* Header band — category color + icon + name */}
                <div className="flex items-center gap-2 px-3 py-2.5" style={{ backgroundColor: bgColors[type] }}>
                  <span className="text-[20px]">{typeIcon[type]}</span>
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
                            <span className="text-[16px]">{typeIcon[file.output_type]}</span>
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

                <div className="border-t border-[#F1F5F9] px-3 py-2 text-[11px] font-semibold text-[#2563EB] group-hover:underline">
                  צפייה בכל ה{OUTPUT_LABEL[type]} ←
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="bg-white rounded-xl border border-[var(--border)] p-4 mb-8">
        <h2 className="font-semibold mb-3">בקשות לפי סטטוס</h2>
        <div className="flex flex-wrap gap-2">
          {Object.entries(byStatus).map(([status, count]) => (
            <span key={status} className={`rounded-full px-3 py-1 text-sm ${STATUS_COLOR[status as RequestStatus] ?? 'bg-gray-100'}`}>
              {STATUS_LABEL[status as RequestStatus] ?? status}: {count}
            </span>
          ))}
          {Object.keys(byStatus).length === 0 && <span className="text-[var(--muted)] text-sm">אין בקשות עדיין.</span>}
        </div>
      </section>
    </div>
  );
}

// ─── daily outputs ──────────────────────────────────────────────────────────

function buildDailySeries(rows: OutputRow[]): Array<{ key: string; label: string; count: number }> {
  // Seed every day in the window with 0 so gaps render as empty bars, not holes.
  const days: Array<{ key: string; label: string; count: number }> = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() - (DAILY_WINDOW_DAYS - 1));
  for (let i = 0; i < DAILY_WINDOW_DAYS; i++) {
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

function DailyOutputsChart({ data }: { data: Array<{ key: string; label: string; count: number }> }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const total = data.reduce((sum, d) => sum + d.count, 0);

  return (
    <section className="bg-white rounded-xl border border-[var(--border)] p-4">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="font-semibold">תוצרים לפי יום</h2>
        <span className="text-xs text-[var(--muted)]">{DAILY_WINDOW_DAYS} ימים אחרונים · סה״כ {total}</span>
      </div>
      {total === 0 ? (
        <p className="text-sm text-[var(--muted)]">אין תוצרים בטווח הזה.</p>
      ) : (
        // On phones 14 bars get too thin to read, so the bar row scrolls
        // horizontally with a sensible min width; from sm up it fills the card.
        <div className="-mx-1 overflow-x-auto px-1">
          <div className="flex h-44 min-w-[460px] gap-1.5 sm:min-w-0">
            {data.map((d) => (
              <div key={d.key} className="flex h-full flex-1 flex-col items-center gap-1.5" title={`${d.label}: ${d.count}`}>
                <span className="text-[10px] font-semibold text-[var(--muted)]">{d.count || ''}</span>
                {/* flex-1 track has a definite height so the bar's % resolves correctly */}
                <div className="flex w-full flex-1 flex-col justify-end">
                  <div
                    className="w-full rounded-t bg-brand/80 transition-all hover:bg-brand"
                    style={{ height: `${Math.max(d.count ? 6 : 2, (d.count / max) * 100)}%` }}
                  />
                </div>
                <span className="whitespace-nowrap text-[10px] text-[var(--muted)] ltr">{d.label}</span>
              </div>
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

function PerUserOutputsChart({ data }: { data: Array<{ label: string; count: number }> }) {
  const max = Math.max(1, ...data.map((d) => d.count));

  return (
    <section className="bg-white rounded-xl border border-[var(--border)] p-4">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="font-semibold">תוצרים לפי משתמש</h2>
        <span className="text-xs text-[var(--muted)]">{DAILY_WINDOW_DAYS} ימים אחרונים</span>
      </div>
      {data.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">אין תוצרים בטווח הזה.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {data.map((d) => (
            <div key={d.label} className="flex items-center gap-3">
              <span className="w-20 shrink-0 truncate text-sm text-[var(--text)] sm:w-28" title={d.label}>{d.label}</span>
              <div className="h-5 flex-1 overflow-hidden rounded bg-gray-100">
                <div
                  className="h-full rounded bg-brand/80"
                  style={{ width: `${Math.max(4, (d.count / max) * 100)}%` }}
                />
              </div>
              <span className="w-8 shrink-0 text-left text-sm font-semibold tabular-nums">{d.count}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
