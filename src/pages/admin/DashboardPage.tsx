import { useEffect, useState } from 'react';
import { STATUS_COLOR, STATUS_LABEL } from '@/lib/labels';
import { formatUsd } from '@/lib/format';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import type { RequestStatus } from '@/types/db';

export default function DashboardPage() {
  const [statusRows, setStatusRows] = useState<Array<{ status: RequestStatus }>>([]);
  const [todayCount, setTodayCount] = useState(0);
  const [outputsCount, setOutputsCount] = useState(0);
  const [todayCost, setTodayCost] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const db = createSupabaseBrowserClient();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const todayIso = startOfDay.toISOString();

    Promise.all([
      db.from('requests').select('status'),
      db.from('requests').select('id', { count: 'exact', head: true }).gte('created_at', todayIso),
      db.from('usage_events').select('estimated_cost').gte('created_at', todayIso),
      db.from('outputs').select('id', { count: 'exact', head: true }),
    ]).then(([statuses, today, costs, outputs]) => {
      setStatusRows((statuses.data ?? []) as Array<{ status: RequestStatus }>);
      setTodayCount(today.count ?? 0);
      setTodayCost((costs.data ?? []).reduce((sum, row: any) => sum + Number(row.estimated_cost ?? 0), 0));
      setOutputsCount(outputs.count ?? 0);
      setLoading(false);
    });
  }, []);

  const byStatus: Record<string, number> = {};
  statusRows.forEach((r) => {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  });

  const cards = [
    { label: 'בקשות היום', value: todayCount },
    { label: 'עלות היום', value: formatUsd(todayCost), ltr: true },
    { label: 'סך תוצרים', value: outputsCount },
    { label: 'ממתינות לאישור', value: byStatus.waiting_for_approval ?? 0 },
  ];

  if (loading) return <p className="text-[var(--muted)]">טוען...</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">לוח בקרה</h1>
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {cards.map((card) => (
          <div key={card.label} className="bg-white rounded-xl border border-[var(--border)] p-4">
            <div className="text-sm text-[var(--muted)] mb-1">{card.label}</div>
            <div className={`text-2xl font-bold ${card.ltr ? 'ltr' : ''}`}>{card.value}</div>
          </div>
        ))}
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
