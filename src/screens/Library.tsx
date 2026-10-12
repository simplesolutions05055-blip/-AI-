import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Ic } from '../ui/Ic';
import { PageHead, Badge, Empty, SkeletonRows, Seg } from '../ui/kit';
import { api, ST, TYPES, timeAgo, type Item, type Status } from '../lib';
import { useSession } from '../session';

const THUMB = ['', 't2', 't3', 't4', 't5'];

export default function Library() {
  const { boot } = useSession();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [items, setItems] = useState<Item[] | null>(null);
  const [view, setView] = useState<'cards' | 'table'>('cards');

  const q = sp.get('q') ?? '';
  const status = sp.get('status') ?? '';
  const dept = sp.get('dept') ?? '';
  const type = sp.get('type') ?? '';

  useEffect(() => {
    setItems(null);
    const payload: Record<string, string> = {};
    if (q) payload.q = q;
    if (dept) payload.department_id = dept;
    if (type) payload.type = type;
    void api<{ items: Item[] }>('items.list', payload).then((r) => setItems(r.items)).catch(() => setItems([]));
  }, [q, dept, type]);

  const filtered = useMemo(() => {
    let list = items ?? [];
    if (status === 'draft') list = list.filter((i) => ['draft', 'fix_required'].includes(i.status));
    else if (status) list = list.filter((i) => i.status === status);
    return list.filter((i) => i.status !== 'archived');
  }, [items, status]);

  const deptName = (id: string | null) => boot?.departments.find((d) => d.id === id)?.name ?? '';
  const deptColor = (id: string | null) => boot?.departments.find((d) => d.id === id)?.color ?? '#94A3B8';
  const setParam = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v); else n.delete(k);
    setSp(n, { replace: true });
  };

  return (
    <>
      <PageHead
        title="ספריית התוכן"
        desc="כל פריטי התוכן של הארגון, בכל הסטטוסים והמחלקות."
        actions={<button className="btn btn-primary" onClick={() => nav('/create')}><Ic n="create" s={16} /> יצירת תוכן</button>}
      />

      <div className="filters">
        <div className="search" style={{ maxWidth: 280, flex: '1 1 220px' }}>
          <span className="ic"><Ic n="search" s={16} /></span>
          <input type="text" defaultValue={q} placeholder="חיפוש לפי כותרת"
            onKeyDown={(e) => { if (e.key === 'Enter') setParam('q', (e.target as HTMLInputElement).value); }} />
        </div>
        <select value={type} onChange={(e) => setParam('type', e.target.value)}>
          <option value="">כל הסוגים</option>
          {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v.t}</option>)}
        </select>
        <select value={dept} onChange={(e) => setParam('dept', e.target.value)}>
          <option value="">כל המחלקות</option>
          {boot?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={status} onChange={(e) => setParam('status', e.target.value)}>
          <option value="">כל הסטטוסים</option>
          {Object.entries(ST).filter(([k]) => k !== 'archived').map(([k, v]) => <option key={k} value={k}>{v.t}</option>)}
        </select>
        <div style={{ marginInlineStart: 'auto' }}>
          <Seg value={view} onChange={setView} options={[['cards', 'כרטיסים'], ['table', 'טבלה']]} />
        </div>
      </div>

      {items === null ? <SkeletonRows n={5} /> : filtered.length === 0 ? (
        <Empty title="אין פריטים שתואמים לסינון" desc="נסו לשנות את הסינון או צרו פריט חדש."
          action={<button className="btn btn-primary" onClick={() => nav('/create')}><Ic n="create" s={16} /> יצירת תוכן</button>} />
      ) : view === 'cards' ? (
        <div className="grid g-4">
          {filtered.map((it, idx) => (
            <article className="cc" key={it.id}>
              <div className={`thumb ${THUMB[idx % THUMB.length]}`}>
                <span className="kind">{TYPES[it.type].t}</span>
                <span className="tt">{it.title || 'ללא כותרת'}</span>
              </div>
              <div className="cc-body">
                <span className="cc-title" onClick={() => nav(`/item/${it.id}`)}>{it.title || 'ללא כותרת'}</span>
                <span className="cc-meta">
                  <span className="dept-color" style={{ background: deptColor(it.department_id) }} />
                  {deptName(it.department_id)}<span>·</span>עודכן {timeAgo(it.updated_at)}
                </span>
                <span><Badge s={it.status} /></span>
              </div>
              <div className="cc-foot">
                <button className="btn btn-sm" onClick={() => nav(`/item/${it.id}`)}>פתיחה</button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="tbl-wrap">
          <table className="responsive">
            <thead><tr><th>כותרת</th><th>סוג</th><th>מחלקה</th><th>סטטוס</th><th>עודכן</th><th></th></tr></thead>
            <tbody>
              {filtered.map((it) => (
                <tr key={it.id}>
                  <td data-l="כותרת"><span className="row-title" onClick={() => nav(`/item/${it.id}`)}>{it.title || 'ללא כותרת'}</span></td>
                  <td data-l="סוג">{TYPES[it.type].t}</td>
                  <td data-l="מחלקה">{deptName(it.department_id)}</td>
                  <td data-l="סטטוס"><Badge s={it.status as Status} /></td>
                  <td data-l="עודכן" className="t-sub">{timeAgo(it.updated_at)}</td>
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
