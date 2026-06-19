import { createAdminClient } from '@/lib/supabase/admin';
import { STATUS_LABEL, STATUS_COLOR } from '@/lib/labels';
import { formatHebrewDateTime, formatUsd } from '@/lib/format';
import type { RequestStatus } from '@/types/db';

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const db = createAdminClient();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const todayIso = startOfDay.toISOString();

  const [{ data: statusRows }, todayCount, { data: costRows }, outputsCount, { data: errors }] =
    await Promise.all([
      db.from('requests').select('status'),
      db.from('requests').select('id', { count: 'exact', head: true }).gte('created_at', todayIso),
      db.from('usage_events').select('estimated_cost').gte('created_at', todayIso),
      db.from('outputs').select('id', { count: 'exact', head: true }),
      db
        .from('logs')
        .select('id, action, message, created_at, severity')
        .eq('severity', 'error')
        .order('created_at', { ascending: false })
        .limit(5),
    ]);

  const byStatus: Record<string, number> = {};
  (statusRows ?? []).forEach((r) => {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  });
  const todayCost = (costRows ?? []).reduce((s, r) => s + Number(r.estimated_cost), 0);

  const cards = [
    { label: 'בקשות היום', value: todayCount.count ?? 0 },
    { label: 'עלות היום', value: formatUsd(todayCost), ltr: true },
    { label: 'סך תוצרים', value: outputsCount.count ?? 0 },
    { label: 'ממתינות לאישור', value: byStatus['waiting_for_approval'] ?? 0 },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">לוח בקרה</h1>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {cards.map((c) => (
          <div key={c.label} className="bg-white rounded-xl border border-[var(--border)] p-4">
            <div className="text-sm text-[var(--muted)] mb-1">{c.label}</div>
            <div className={`text-2xl font-bold ${c.ltr ? 'ltr' : ''}`}>{c.value}</div>
          </div>
        ))}
      </section>

      <section className="bg-white rounded-xl border border-[var(--border)] p-4 mb-8">
        <h2 className="font-semibold mb-3">בקשות לפי סטטוס</h2>
        <div className="flex flex-wrap gap-2">
          {Object.entries(byStatus).map(([status, n]) => (
            <span
              key={status}
              className={`rounded-full px-3 py-1 text-sm ${
                STATUS_COLOR[status as RequestStatus] ?? 'bg-gray-100'
              }`}
            >
              {STATUS_LABEL[status as RequestStatus] ?? status}: {n}
            </span>
          ))}
          {Object.keys(byStatus).length === 0 && (
            <span className="text-[var(--muted)] text-sm">אין בקשות עדיין.</span>
          )}
        </div>
      </section>

      <section className="bg-white rounded-xl border border-[var(--border)] p-4">
        <h2 className="font-semibold mb-3">שגיאות אחרונות</h2>
        {(errors ?? []).length === 0 ? (
          <p className="text-[var(--muted)] text-sm">אין שגיאות. 🎉</p>
        ) : (
          <ul className="space-y-2">
            {(errors ?? []).map((e) => (
              <li key={e.id} className="text-sm border-b border-[var(--border)] pb-2">
                <span className="text-[var(--muted)] ltr">{formatHebrewDateTime(e.created_at)}</span>
                {' — '}
                <span className="font-medium">{e.action}</span>
                {e.message ? <span className="text-[var(--muted)]">: {e.message}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
