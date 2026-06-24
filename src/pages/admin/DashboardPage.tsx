import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { OUTPUT_LABEL, STATUS_COLOR, STATUS_LABEL, senderLabel } from '@/lib/labels';
import { formatUsd } from '@/lib/format';
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

const PRODUCT_LINKS: Array<{ type: OutputType; description: string }> = [
  { type: 'image', description: 'פוסט, מודעה או גרפיקה לרשתות.' },
  { type: 'presentation', description: 'מבנה ותוכן שקפים למצגת.' },
  { type: 'text', description: 'פוסט, מייל, נאום או תוכן שיווקי.' },
  { type: 'pdf', description: 'מסמך מסודר להורדה או שליחה.' },
];

export default function DashboardPage() {
  const [statusRows, setStatusRows] = useState<Array<{ status: RequestStatus }>>([]);
  const [todayCount, setTodayCount] = useState(0);
  const [outputsCount, setOutputsCount] = useState(0);
  const [todayCost, setTodayCost] = useState(0);
  const [outputRows, setOutputRows] = useState<OutputRow[]>([]);
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
    ]).then(([statuses, today, costs, outputs, recentOutputs]) => {
      setStatusRows((statuses.data ?? []) as Array<{ status: RequestStatus }>);
      setTodayCount(today.count ?? 0);
      setTodayCost((costs.data ?? []).reduce((sum, row: any) => sum + Number(row.estimated_cost ?? 0), 0));
      setOutputsCount(outputs.count ?? 0);
      setOutputRows((recentOutputs ?? []) as unknown as OutputRow[]);
      setLoading(false);
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

      <section className="mb-8">
        <h2 className="font-semibold mb-3">הפקת תוצרים</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {PRODUCT_LINKS.map((item) => (
            <Link
              key={item.type}
              to={`/admin/production/${item.type}`}
              className="group flex h-full flex-col rounded-xl border border-[var(--border)] bg-white p-4 transition hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-[0_16px_40px_rgba(59,130,246,0.12)]"
            >
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10 text-brand transition group-hover:scale-105">
                <ProductIcon type={item.type} className="h-6 w-6" />
              </div>
              <div className="text-lg font-bold mb-1 group-hover:text-brand">{OUTPUT_LABEL[item.type]}</div>
              <p className="text-sm text-[var(--muted)] leading-6">{item.description}</p>
              <span className="mt-3 text-sm font-semibold text-brand">התחלה ←</span>
            </Link>
          ))}
        </div>
      </section>

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

// Product type icons — kept in sync with the production picker (ProductionPage).
function ProductIcon({ type, className = 'h-6 w-6' }: { type: OutputType; className?: string }) {
  if (type === 'presentation') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <rect x="4" y="5" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8 19h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M12 15v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === 'text') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M6 5.5h12M6 10h12M6 14.5h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M6 19h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.65" />
      </svg>
    );
  }
  if (type === 'pdf') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M7 4.75h6.5L17 8.25V19a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5.75a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.8" />
        <path d="M13.5 4.75v3.5H17" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M8.5 15h7M8.5 12h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M6 9.5a6 6 0 0 1 12 0v5a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-5Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 9.5h6M9 12h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="m15.5 16.5 2 2 2-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
        <div className="flex h-44 gap-1.5">
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
              <span className="text-[10px] text-[var(--muted)] ltr">{d.label}</span>
            </div>
          ))}
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
              <span className="w-28 shrink-0 truncate text-sm text-[var(--text)]" title={d.label}>{d.label}</span>
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
