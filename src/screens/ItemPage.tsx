import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Ic } from '../ui/Ic';
import { PageHead, Badge, SkeletonRows, Modal, useToast } from '../ui/kit';
import { api, ST, TYPES, SOURCE_T, fmtDate, timeAgo, type Item, type Approval, type CommentRow, type Channel } from '../lib';
import { useSession } from '../session';

type Detail = {
  item: Item;
  versions: { id: string; version_no: number; title: string | null; change_note: string | null; created_by: string | null; created_at: string }[];
  approvals: Approval[];
  comments: CommentRow[];
  publications: { id: string; channel_id: string; status: string; scheduled_at: string | null }[];
};

const ACT_T: Record<string, string> = {
  submitted: 'נשלח לאישור', resubmitted: 'נשלח מחדש לאישור', approved: 'אושר',
  fix_requested: 'הוחזר לתיקון', rejected: 'נדחה',
};

export default function ItemPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { boot, refresh } = useSession();
  const [d, setD] = useState<Detail | null>(null);
  const [tab, setTab] = useState<'content' | 'versions' | 'comments' | 'history'>('content');
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({ title: '', body: '', cta: '' });
  const [comment, setComment] = useState('');
  const [sched, setSched] = useState<{ when: string; channels: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const r = await api<Detail>('items.get', { id });
    setD(r);
    setForm({ title: r.item.title, body: r.item.body, cta: r.item.cta });
  }, [id]);

  useEffect(() => { void load().catch(() => nav('/library')); }, [load, nav]);

  if (!d || !boot) return <SkeletonRows n={5} />;
  const it = d.item;
  const me = boot.me;
  const deptName = boot.departments.find((x) => x.id === it.department_id)?.name ?? '';
  const memberName = (mid: string | null) => boot.members.find((m) => m.id === mid)?.full_name ?? 'מערכת';
  const canDecide = ['system_admin', 'comms_manager', 'dept_approver'].includes(me.role) && it.created_by !== me.id;
  const canSchedule = ['system_admin', 'comms_manager'].includes(me.role);
  const editable = ['draft', 'fix_required', 'rejected'].includes(it.status);

  async function act(fn: () => Promise<unknown>, ok: string, okSub?: string) {
    setBusy(true);
    try { await fn(); toast({ title: ok, sub: okSub }); await load(); await refresh(); }
    catch (e) {
      const code = (e as { code?: string }).code;
      toast({ err: true, title: 'הפעולה נכשלה', sub: code === 'self_approval_forbidden' ? 'אי אפשר לאשר פריט שיצרת.' : code });
    }
    finally { setBusy(false); }
  }

  const saveEdit = () => act(async () => {
    await api('items.save', { id: it.id, ...form });
    setEdit(false);
  }, 'השינויים נשמרו', 'נפתחה גרסה חדשה בהיסטוריית הגרסאות.');

  const submit = () => act(() => api('items.submit', { id: it.id }), 'נשלח לאישור', 'המאשר יראה את הפריט במרכז האישורים.');
  const approve = () => act(() => api('items.decide', { id: it.id, decision: 'approve' }), 'הפריט אושר');

  const doSchedule = () => {
    if (!sched?.when) return;
    return act(() => api('items.schedule', { id: it.id, when: new Date(sched.when).toISOString(), channel_ids: sched.channels }),
      'הפריט תוזמן', 'יופיע בלוח התוכן במועד שנקבע.').then(() => setSched(null));
  };

  const addComment = () => {
    if (!comment.trim()) return;
    return act(async () => { await api('comments.add', { item_id: it.id, body: comment }); setComment(''); }, 'ההערה נוספה');
  };

  return (
    <>
      <PageHead
        crumb={[{ t: 'ספריית התוכן', onClick: () => nav('/library') }, { t: it.title || 'פריט' }]}
        title={it.title || 'ללא כותרת'}
        desc={`${TYPES[it.type].t} · ${deptName} · ${SOURCE_T[it.source]} · עודכן ${timeAgo(it.updated_at)}`}
        actions={
          <>
            {editable && !edit && <button className="btn" onClick={() => setEdit(true)}><Ic n="edit" s={16} /> עריכה</button>}
            {editable && <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}><Ic n="send" s={16} /> שליחה לאישור</button>}
            {it.status === 'pending_approval' && canDecide && (
              <button className="btn btn-ok" disabled={busy} onClick={() => void approve()}><Ic n="check" s={16} /> אישור</button>
            )}
            {['approved', 'scheduled'].includes(it.status) && canSchedule && (
              <button className="btn btn-primary" onClick={() => setSched({ when: it.scheduled_for?.slice(0, 16) ?? '', channels: [] })}>
                <Ic n="cal" s={16} /> תזמון
              </button>
            )}
          </>
        }
      />

      <div style={{ marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Badge s={it.status} />
        {it.status_note && (
          <span className={`badge ${it.status === 'rejected' ? 's-rejected' : 's-fix'}`}>
            <Ic n={it.status === 'rejected' ? 'x' : 'undo'} s={13} /> {it.status_note}
          </span>
        )}
      </div>

      <div className="split-wide">
        <div>
          <div className="tabs">
            {([['content', 'תוכן'], ['versions', 'גרסאות'], ['comments', 'הערות'], ['history', 'היסטוריית אישורים']] as const).map(([k, t]) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t}</button>
            ))}
          </div>

          {tab === 'content' && (
            <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="field"><label>כותרת</label>
                <input type="text" value={edit ? form.title : it.title} disabled={!edit}
                  onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
              <div className="field"><label>גוף הטקסט</label>
                <textarea rows={7} value={edit ? form.body : it.body} disabled={!edit}
                  onChange={(e) => setForm({ ...form, body: e.target.value })} /></div>
              <div className="field"><label>קריאה לפעולה</label>
                <input type="text" value={edit ? form.cta : it.cta} disabled={!edit}
                  onChange={(e) => setForm({ ...form, cta: e.target.value })} /></div>
              {edit ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-primary" disabled={busy} onClick={() => void saveEdit()}>שמירת שינויים</button>
                  <button className="btn" onClick={() => { setEdit(false); setForm({ title: it.title, body: it.body, cta: it.cta }); }}>ביטול</button>
                </div>
              ) : (
                <div className="note"><Ic n="help" s={16} />
                  <span>בסטטוס {ST[it.status].t} השדות {editable ? 'נפתחים לעריכה בלחיצה על "עריכה".' : 'נעולים לצפייה בלבד.'}</span>
                </div>
              )}
            </div>
          )}

          {tab === 'versions' && (
            <div className="tbl-wrap">
              <table className="responsive">
                <thead><tr><th>גרסה</th><th>כותרת</th><th>מי</th><th>מתי</th></tr></thead>
                <tbody>
                  <tr><td data-l="גרסה"><b>{it.version} (נוכחית)</b></td><td data-l="כותרת">{it.title}</td>
                    <td data-l="מי">{memberName(it.created_by)}</td><td data-l="מתי" className="t-sub">{timeAgo(it.updated_at)}</td></tr>
                  {d.versions.map((v) => (
                    <tr key={v.id}><td data-l="גרסה">{v.version_no}</td><td data-l="כותרת">{v.title}</td>
                      <td data-l="מי">{memberName(v.created_by)}</td><td data-l="מתי" className="t-sub">{timeAgo(v.created_at)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'comments' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 760 }}>
              {d.comments.length === 0 && <div className="note"><Ic n="note" s={16} /><span>עדיין אין הערות על הפריט.</span></div>}
              {d.comments.map((c) => (
                <div className="card card-pad" key={c.id} style={{ padding: '14px 16px' }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 7 }}>
                    <b style={{ fontSize: 13.5 }}>{memberName(c.author_member_id)}</b>
                    <span className="t-sub">{timeAgo(c.created_at)}</span>
                  </div>
                  <div style={{ fontSize: 14, lineHeight: 1.6 }}>{c.body}</div>
                </div>
              ))}
              <div className="card card-pad" style={{ padding: '14px 16px' }}>
                <div className="field"><label>הוספת הערה</label>
                  <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="הערה לצוות או למאשר" /></div>
                <button className="btn btn-primary btn-sm" style={{ marginTop: 10 }} disabled={busy || !comment.trim()}
                  onClick={() => void addComment()}>שליחת הערה</button>
              </div>
            </div>
          )}

          {tab === 'history' && (
            <div className="card">
              <div className="tl" style={{ padding: '14px 18px' }}>
                <div className="tl-i">
                  <span className="tl-dot"><Ic n="edit" s={13} sw={2} /></span>
                  <span className="tl-tx"><b>נוצר</b> על ידי {memberName(it.created_by)}<br />
                    <span className="tl-time">{fmtDate(it.created_at)}</span></span>
                </div>
                {d.approvals.map((a) => (
                  <div className="tl-i" key={a.id}>
                    <span className={`tl-dot ${a.action === 'approved' ? 'ok' : ['fix_requested', 'rejected'].includes(a.action) ? 'warn' : 'info'}`}>
                      <Ic n={a.action === 'approved' ? 'check' : a.action === 'rejected' ? 'x' : a.action === 'fix_requested' ? 'undo' : 'send'} s={13} sw={2} />
                    </span>
                    <span className="tl-tx">
                      <b>{ACT_T[a.action] ?? a.action}</b> על ידי {memberName(a.actor_member_id)}
                      {a.note ? `: ${a.note}` : ''}<br />
                      <span className="tl-time">{fmtDate(a.created_at)}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-head"><h3>פרטי הפריט</h3></div>
          <div className="card-pad kv">
            <div className="r"><span className="k">סטטוס</span><span className="v"><Badge s={it.status} /></span></div>
            <div className="r"><span className="k">סוג</span><span className="v">{TYPES[it.type].t}</span></div>
            <div className="r"><span className="k">מחלקה</span><span className="v">{deptName}</span></div>
            <div className="r"><span className="k">נוצר על ידי</span><span className="v">{memberName(it.created_by)}</span></div>
            <div className="r"><span className="k">מקור</span><span className="v">{SOURCE_T[it.source]}</span></div>
            <div className="r"><span className="k">מועד פרסום</span><span className="v">{fmtDate(it.scheduled_for)}</span></div>
            <div className="r"><span className="k">גרסה</span><span className="v">{it.version}</span></div>
          </div>
        </div>
      </div>

      <Modal open={sched !== null} onClose={() => setSched(null)}>
        {sched && (
          <>
            <div className="mb">
              <div className="m-ic warn"><Ic n="cal" s={20} /></div>
              <h3>תזמון הפרסום</h3>
              <p>בחרו מועד וערוצים. הפריט יעבור לסטטוס "מתוזמן" ויופיע בלוח התוכן.</p>
              <div className="field" style={{ marginTop: 14 }}>
                <label>מועד</label>
                <input type="datetime-local" value={sched.when} onChange={(e) => setSched({ ...sched, when: e.target.value })} />
              </div>
              <div className="field" style={{ marginTop: 12 }}>
                <label>ערוצים</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {boot.channels.map((ch: Channel) => {
                    const on = sched.channels.includes(ch.id);
                    return (
                      <button key={ch.id} className={`chip`} style={on ? { background: 'var(--brand-50)', borderColor: 'var(--brand-200)', color: 'var(--brand)', fontWeight: 600 } : undefined}
                        onClick={() => setSched({ ...sched, channels: on ? sched.channels.filter((c) => c !== ch.id) : [...sched.channels, ch.id] })}>
                        {ch.account_name ?? ch.network}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn btn-primary" disabled={busy || !sched.when} onClick={() => void doSchedule()}>תזמון</button>
              <button className="btn" onClick={() => setSched(null)}>ביטול</button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
