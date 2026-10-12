import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ic } from '../ui/Ic';
import { PageHead, Badge, Empty, SkeletonRows, Modal, useToast } from '../ui/kit';
import { api, SOURCE_T, timeAgo, type Item } from '../lib';
import { useSession } from '../session';

export default function Approvals() {
  const { boot, setPendingCount } = useSession();
  const nav = useNavigate();
  const toast = useToast();
  const [items, setItems] = useState<Item[] | null>(null);
  const [decide, setDecide] = useState<{ item: Item; kind: 'fix' | 'reject' } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const me = boot?.me;
  const canDecide = me ? ['system_admin', 'comms_manager', 'dept_approver'].includes(me.role) : false;
  const deptName = (id: string | null) => boot?.departments.find((d) => d.id === id)?.name ?? '';
  const memberName = (id: string | null) => boot?.members.find((m) => m.id === id)?.full_name ?? '';

  const load = useCallback(async () => {
    const r = await api<{ items: Item[] }>('items.list', { status: 'pending_approval' });
    setItems(r.items);
    setPendingCount(r.items.length);
  }, [setPendingCount]);

  useEffect(() => { void load().catch(() => setItems([])); }, [load]);

  async function approve(it: Item) {
    setBusy(true);
    try {
      const r = await api<{ status: string }>('items.decide', { id: it.id, decision: 'approve' });
      toast({ title: 'הפריט אושר', sub: r.status === 'scheduled' ? 'תוזמן ומופיע בלוח התוכן.' : 'ממתין לקביעת מועד פרסום.' });
      await load();
    } catch (e) {
      const code = (e as { code?: string }).code;
      toast({
        err: true,
        title: code === 'self_approval_forbidden' ? 'אי אפשר לאשר פריט שיצרת' : 'האישור נכשל',
        sub: code === 'self_approval_forbidden' ? 'מאשר אחר בארגון צריך לבדוק את הפריט.' : code,
      });
    } finally { setBusy(false); }
  }

  async function submitDecision() {
    if (!decide || note.trim().length < 3) return;
    setBusy(true);
    try {
      await api('items.decide', { id: decide.item.id, decision: decide.kind, note: note.trim() });
      toast({
        title: decide.kind === 'fix' ? 'הבקשה נשלחה' : 'הפריט נדחה',
        sub: decide.kind === 'fix' ? 'הפריט חזר ליוצר עם ההערה.' : 'הסיבה נשמרה ונשלחה ליוצר.',
      });
      setDecide(null); setNote('');
      await load();
    } catch (e) {
      toast({ err: true, title: 'הפעולה נכשלה', sub: (e as { code?: string }).code });
    } finally { setBusy(false); }
  }

  return (
    <>
      <PageHead title="מרכז האישורים" desc="בדיקה, אישור, בקשת תיקון או דחייה מנומקת. כל החלטה נשמרת בהיסטוריה." />
      {items === null ? <SkeletonRows n={4} /> : items.length === 0 ? (
        <Empty icon="checkc" title="אין פריטים שממתינים לאישור"
          desc="כל מה שנשלח לאישור טופל. פריט חדש יופיע כאן מיד עם שליחתו." />
      ) : (
        <div className="grid" style={{ gridTemplateColumns: '1fr', gap: 12 }}>
          {items.map((x, idx) => (
            <div className="card" key={x.id} style={idx === 0 ? { borderColor: 'var(--brand-200)' } : undefined}>
              <div className="rowi" style={{ padding: '15px 20px' }}>
                <span className="ic-box warn"><Ic n="clock" s={17} /></span>
                <span className="grow">
                  <span className="nm">{x.title || 'ללא כותרת'}</span><br />
                  <span className="mt">
                    {memberName(x.created_by)} · {deptName(x.department_id)} · {SOURCE_T[x.source]} · ממתין {timeAgo(x.updated_at).replace('לפני ', '')}
                  </span>
                </span>
                <span className="hide-sm"><Badge s={x.status} /></span>
                <button className="btn btn-sm" onClick={() => nav(`/item/${x.id}`)}>בדיקה מלאה</button>
                {canDecide && (
                  <>
                    <button className="btn btn-sm btn-ok" disabled={busy} onClick={() => void approve(x)}>
                      <Ic n="check" s={14} /> אישור
                    </button>
                    <button className="btn btn-sm" disabled={busy} onClick={() => { setDecide({ item: x, kind: 'fix' }); setNote(''); }}>
                      בקשת תיקון
                    </button>
                    <button className="btn btn-sm btn-quiet-bad" disabled={busy} onClick={() => { setDecide({ item: x, kind: 'reject' }); setNote(''); }}>
                      דחייה
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={decide !== null} onClose={() => setDecide(null)}>
        {decide && (
          <>
            <div className="mb">
              <div className={`m-ic ${decide.kind === 'reject' ? 'bad' : 'warn'}`}>
                <Ic n={decide.kind === 'reject' ? 'x' : 'undo'} s={20} />
              </div>
              <h3>{decide.kind === 'reject' ? 'דחיית הפריט' : 'בקשת תיקון'}</h3>
              <p>
                {decide.kind === 'reject'
                  ? 'דחייה מחייבת סיבה. הסיבה תוצג ליוצר ותישמר בהיסטוריית האישורים.'
                  : 'כתבו מה צריך לתקן. הפריט יחזור ליוצר עם ההערה.'}
              </p>
              <div className="field" style={{ marginTop: 14 }}>
                <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} autoFocus
                  placeholder={decide.kind === 'reject' ? 'מדוע התוכן אינו מתאים לפרסום' : 'לדוגמה: להוסיף את שעת הסיום ואת פרטי ההרשמה'} />
                <div className="t-sub" style={{ marginTop: 6 }}>
                  {note.trim().length < 3 ? 'יש להזין סיבה כדי להפעיל את הכפתור.' : 'אפשר לשלוח.'}
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <button
                className={`btn ${decide.kind === 'reject' ? 'btn-quiet-bad' : 'btn-primary'}`}
                disabled={busy || note.trim().length < 3}
                onClick={() => void submitDecision()}
              >
                {decide.kind === 'reject' ? 'דחיית הפריט' : 'שליחת בקשת תיקון'}
              </button>
              <button className="btn" onClick={() => setDecide(null)}>ביטול</button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
