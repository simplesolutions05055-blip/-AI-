import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ic } from '../ui/Ic';
import { PageHead, Badge, SkeletonRows, Seg } from '../ui/kit';
import { api, ST, fmtDate, type Item } from '../lib';
import { useSession } from '../session';

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

export default function CalendarPage() {
  const nav = useNavigate();
  const { boot } = useSession();
  const [items, setItems] = useState<Item[] | null>(null);
  const [view, setView] = useState<'month' | 'list'>('month');
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });

  useEffect(() => { void api<{ items: Item[] }>('items.list').then((r) => setItems(r.items)).catch(() => setItems([])); }, []);

  const dated = useMemo(() =>
    (items ?? []).filter((i) => i.scheduled_for && !['archived', 'rejected'].includes(i.status)),
    [items]);

  const byDay = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const it of dated) {
      const d = new Date(it.scheduled_for!);
      if (d.getFullYear() !== cursor.y || d.getMonth() !== cursor.m) continue;
      const k = String(d.getDate());
      map.set(k, [...(map.get(k) ?? []), it]);
    }
    return map;
  }, [dated, cursor]);

  const deptName = (id: string | null) => boot?.departments.find((d) => d.id === id)?.name ?? '';
  const today = new Date();
  const first = new Date(cursor.y, cursor.m, 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const cells = Math.ceil((startPad + daysInMonth) / 7) * 7;

  function move(delta: number) {
    const d = new Date(cursor.y, cursor.m + delta, 1);
    setCursor({ y: d.getFullYear(), m: d.getMonth() });
  }

  if (items === null) return <><PageHead title="לוח התוכן" /><SkeletonRows n={4} /></>;

  return (
    <>
      <PageHead
        title="לוח התוכן"
        desc="כל התכנים המתוזמנים, המאושרים והמפורסמים, לפי מועד."
        actions={<button className="btn btn-primary" onClick={() => nav('/create')}><Ic n="create" s={16} /> תוכן חדש</button>}
      />

      <div className="filters">
        <button className="icon-btn" aria-label="חודש קודם" onClick={() => move(-1)}><Ic n="chevR" s={17} /></button>
        <b style={{ fontSize: 14.5, minWidth: 120, textAlign: 'center' }}>{MONTHS[cursor.m]} {cursor.y}</b>
        <button className="icon-btn" aria-label="חודש הבא" onClick={() => move(1)}><Ic n="chevL" s={17} /></button>
        <button className="btn btn-sm" onClick={() => setCursor({ y: today.getFullYear(), m: today.getMonth() })}>היום</button>
        <div style={{ marginInlineStart: 'auto' }}>
          <Seg value={view} onChange={setView} options={[['month', 'חודש'], ['list', 'רשימה']]} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {(['draft', 'pending_approval', 'approved', 'scheduled', 'published'] as const).map((k) => <Badge key={k} s={k} />)}
      </div>

      {view === 'month' ? (
        <div className="cal">
          <div className="cal-head">{DAY_NAMES.map((d) => <div key={d}>{d}</div>)}</div>
          <div className="cal-grid">
            {Array.from({ length: cells }).map((_, i) => {
              const dn = i - startPad + 1;
              const off = dn < 1 || dn > daysInMonth;
              const isToday = !off && dn === today.getDate() && cursor.m === today.getMonth() && cursor.y === today.getFullYear();
              const evs = off ? [] : byDay.get(String(dn)) ?? [];
              return (
                <div key={i} className={`cal-cell${off ? ' off' : ''}${isToday ? ' today' : ''}`}>
                  <span className="dn">{off ? '' : dn}</span>
                  {evs.map((e) => (
                    <button key={e.id} className={`cal-ev ${ST[e.status].e}`} onClick={() => nav(`/item/${e.id}`)}>
                      {(e.title || 'ללא כותרת').slice(0, 26)}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="tbl-wrap">
          <table className="responsive">
            <thead><tr><th>מועד</th><th>כותרת</th><th>מחלקה</th><th>סטטוס</th><th></th></tr></thead>
            <tbody>
              {dated
                .slice()
                .sort((a, b) => (a.scheduled_for! < b.scheduled_for! ? -1 : 1))
                .map((it) => (
                  <tr key={it.id}>
                    <td data-l="מועד"><b>{fmtDate(it.scheduled_for)}</b></td>
                    <td data-l="כותרת"><span className="row-title" onClick={() => nav(`/item/${it.id}`)}>{it.title || 'ללא כותרת'}</span></td>
                    <td data-l="מחלקה">{deptName(it.department_id)}</td>
                    <td data-l="סטטוס"><Badge s={it.status} /></td>
                    <td><button className="btn btn-sm" onClick={() => nav(`/item/${it.id}`)}>פתיחה</button></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
