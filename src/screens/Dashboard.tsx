import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ic } from '../ui/Ic';
import { PageHead, SkeletonRows, Badge } from '../ui/kit';
import { api, ST, SOURCE_T, timeAgo, type Item, type Approval } from '../lib';
import { useSession } from '../session';

type DashData = { items: Item[]; activity: (Approval & { item_id: string })[] };

const ACT_T: Record<string, { t: string; k: string; i: string }> = {
  submitted:     { t: 'נשלח לאישור',   k: 'warn', i: 'send' },
  resubmitted:   { t: 'נשלח מחדש',     k: 'warn', i: 'send' },
  approved:      { t: 'אושר',          k: 'ok',   i: 'check' },
  fix_requested: { t: 'הוחזר לתיקון',  k: 'warn', i: 'undo' },
  rejected:      { t: 'נדחה',          k: '',     i: 'x' },
};

export default function Dashboard() {
  const { boot } = useSession();
  const nav = useNavigate();
  const [data, setData] = useState<DashData | null>(null);

  useEffect(() => { void api<DashData>('dashboard').then(setData).catch(() => setData({ items: [], activity: [] })); }, []);

  const firstName = boot?.me.full_name.split(' ')[0] ?? '';
  const deptName = (id: string | null) => boot?.departments.find((d) => d.id === id)?.name ?? '';
  const memberName = (id: string | null) => boot?.members.find((m) => m.id === id)?.full_name ?? '';

  const stats = useMemo(() => {
    const it = data?.items ?? [];
    const c = (s: string[]) => it.filter((x) => s.includes(x.status)).length;
    return {
      drafts: c(['draft', 'fix_required']),
      pending: c(['pending_approval']),
      scheduled: c(['scheduled', 'approved']),
      published: c(['published']),
    };
  }, [data]);

  const needs = useMemo(() => {
    const it = data?.items ?? [];
    return [
      ...it.filter((x) => x.status === 'pending_approval'),
      ...it.filter((x) => x.status === 'fix_required'),
      ...it.filter((x) => x.status === 'publish_failed'),
    ].slice(0, 6);
  }, [data]);

  if (!data) return <><PageHead title={`שלום, ${firstName}`} desc="טוען נתונים..." /><SkeletonRows n={5} /></>;

  const items = data.items;

  return (
    <>
      <PageHead
        title={`שלום, ${firstName}`}
        desc={needs.length
          ? `${needs.length} פריטים ממתינים לטיפול, ו-${stats.scheduled} מתוזמנים קדימה.`
          : 'אין פריטים שממתינים לטיפול. אפשר ליצור תוכן חדש.'}
        actions={<button className="btn btn-primary btn-lg" onClick={() => nav('/create')}><Ic n="create" s={17} /> יצירת תוכן חדש</button>}
      />

      <div className="grid g-4" style={{ marginBottom: 18 }}>
        {([
          ['טיוטות פעילות', stats.drafts, 'כולל פריטים שחזרו לתיקון', 'edit', '/library?status=draft'],
          ['ממתינים לאישור', stats.pending, 'מרכז האישורים מרכז הכול', 'clock', '/approvals'],
          ['מאושרים ומתוזמנים', stats.scheduled, 'מופיעים בלוח התוכן', 'cal', '/calendar'],
          ['פורסמו', stats.published, 'בכל הערוצים המחוברים', 'send', '/publications'],
        ] as [string, number, string, string, string][]).map(([l, n, f, i, to]) => (
          <button key={l} className="stat" onClick={() => nav(to)}>
            <span className="lbl"><Ic n={i} s={15} />{l}</span>
            <span className="num">{n}</span>
            <span className="foot">{f}</span>
          </button>
        ))}
      </div>

      <div className="split-wide">
        <div className="card">
          <div className="card-head">
            <Ic n="inbox" s={18} /><h3>דורש טיפול</h3>
            <span className="chip" style={{ marginInlineStart: 'auto' }}>{needs.length} פריטים</span>
          </div>
          {needs.length === 0 ? (
            <div style={{ padding: '26px 20px', color: 'var(--ink-2)', fontSize: 14 }}>
              הכול מטופל. פריטים חדשים שימתינו לאישור יופיעו כאן.
            </div>
          ) : (
            <div className="row-list">
              {needs.map((x) => (
                <div className="rowi" key={x.id}>
                  <span className={`ic-box ${x.status === 'pending_approval' ? 'warn' : 'fix'}`}>
                    <Ic n={ST[x.status].i} s={17} />
                  </span>
                  <span className="grow">
                    <span className="nm">{x.title || 'ללא כותרת'}</span><br />
                    <span className="mt">{deptName(x.department_id)} · {SOURCE_T[x.source]} · עודכן {timeAgo(x.updated_at)}</span>
                  </span>
                  <span className="hide-sm"><Badge s={x.status} /></span>
                  <button className="btn btn-sm" onClick={() => nav(`/item/${x.id}`)}>
                    {x.status === 'pending_approval' ? 'פתיחה לבדיקה' : 'פתיחה'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-head"><Ic n="hist" s={18} /><h3>פעילות אחרונה</h3></div>
          <div className="tl">
            {data.activity.length === 0 && (
              <div style={{ padding: '14px 0', color: 'var(--ink-2)', fontSize: 13.5 }}>עדיין אין פעילות.</div>
            )}
            {data.activity.map((a) => {
              const m = ACT_T[a.action] ?? { t: a.action, k: '', i: 'edit' };
              const item = items.find((x) => x.id === a.item_id);
              return (
                <div className="tl-i" key={a.id}>
                  <span className={`tl-dot ${m.k}`}><Ic n={m.i} s={13} sw={2} /></span>
                  <span className="tl-tx">
                    <b>{memberName(a.actor_member_id)}</b> {m.t}: {item?.title ?? 'פריט'}
                    <br /><span className="tl-time">{timeAgo(a.created_at)}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
