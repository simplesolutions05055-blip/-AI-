import { useEffect, useMemo, useRef, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

type Kind = 'website' | 'facebook' | 'instagram';
interface Content { title: string; content: string; source_url: string }
interface Job { kind: Kind; ticket: string; status: string; terminal: boolean; content: Content[]; usage_usd: number | null; status_message?: string | null }
const LABELS: Record<Kind, string> = { website: 'אתר רשמי', facebook: 'Facebook', instagram: 'Instagram' };
const STATUS: Record<string, string> = { READY: 'ממתין', RUNNING: 'סורק', SUCCEEDED: 'הושלם', FAILED: 'נכשל', 'TIMED-OUT': 'תם זמן הסריקה', ABORTED: 'נעצר', ERROR: 'בדיקת הסטטוס נכשלה' };

export default function ApifyBrandSources({ website, socialLinks, onApply, triggerToken, onProgress }: { website?: string; socialLinks?: { facebook: string | null; instagram: string | null }; onApply: (content: Content[]) => void; triggerToken?: number; onProgress?: (status: { active: boolean; items: number }) => void }) {
  const db = useMemo(() => createSupabaseBrowserClient(), []);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [urls, setUrls] = useState<Record<Kind, string>>({ website: '', facebook: '', instagram: '' });
  const [jobs, setJobs] = useState<Job[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [showPosts, setShowPosts] = useState(false);
  const applied = useRef(new Set<string>());
  const active = jobs.some(job => !job.terminal);
  const [polling, setPolling] = useState(false);
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  useEffect(() => {
    let current = true;
    void db.functions.invoke('brand-apify', { body: { action: 'config' } }).then(({ data, error }) => {
      if (current) setEnabled(!error && data?.enabled === true);
    }).catch(() => { if (current) setEnabled(false); });
    return () => { current = false; };
  }, [db]);
  useEffect(() => { if (website) setUrls(current => ({ ...current, website: current.website || website })); }, [website]);
  useEffect(() => { if (socialLinks) setUrls(current => ({ ...current, facebook: current.facebook || socialLinks.facebook || '', instagram: current.instagram || socialLinks.instagram || '' })); }, [socialLinks]);
  useEffect(() => {
    if (!polling) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      const pending = jobsRef.current.filter(job => !job.terminal);
      if (!pending.length) { if (!cancelled) setPolling(false); return; }
      const updates = await Promise.all(pending.map(async job => {
        const { data, error } = await db.functions.invoke('brand-apify', { body: { action: 'status', ticket: job.ticket } }).catch(() => ({ data: null, error: true }));
        if (error || data?.error) return null;
        return { ...job, ...data } as Job;
      }));
      if (cancelled) return;
      if (updates.some(update => !update)) {
        setError('בדיקת הסטטוס נכשלה. אפשר לחדש מעקב בלי להתחיל סריקה נוספת.');
        setPolling(false);
      }
      let nextJobs: Job[] = [];
      setJobs(current => { nextJobs = current.map(job => updates.find(update => update?.ticket === job.ticket) ?? job); return nextJobs; });
      if (updates.every(Boolean)) timer = setTimeout(() => void tick(), 3000);
    }
    void tick();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [polling, db]);

  // Every terminal job's content is pushed onto the form the moment it lands —
  // no per-post confirmation. The admin reviews everything, still unsaved, on
  // the form itself (and can look back at raw posts in the modal below).
  useEffect(() => {
    const fresh: Content[] = [];
    for (const job of jobs) {
      if (!job.terminal) continue;
      for (const item of job.content) {
        const key = `${item.source_url}\n${item.content}`;
        if (applied.current.has(key)) continue;
        applied.current.add(key);
        fresh.push(item);
      }
    }
    if (fresh.length) onApply(fresh);
  }, [jobs, onApply]);

  // Lets the parent fold this component's progress into one unified
  // loading indicator instead of showing a separate, easy-to-miss spinner.
  useEffect(() => {
    const items = new Set(jobs.flatMap(job => job.content.map(item => `${item.source_url}\n${item.content}`))).size;
    onProgress?.({ active: starting || active, items });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [starting, active, jobs]);

  const lastTrigger = useRef(0);
  useEffect(() => {
    if (!triggerToken || triggerToken === lastTrigger.current) return;
    if (!enabled || active || starting) return;
    if (!Object.values(urls).some(url => url.trim())) return;
    lastTrigger.current = triggerToken;
    void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerToken, enabled, urls, active, starting]);

  async function start() {
    setError(''); setStarting(true); setJobs([]);
    applied.current = new Set();
    const sources = (Object.keys(LABELS) as Kind[]).filter(kind => urls[kind].trim());
    const launched = await Promise.all(sources.map(async kind => {
      const { data, error } = await db.functions.invoke('brand-apify', { body: { action: 'start', kind, url: urls[kind].trim() } }).catch(() => ({ data: null, error: true }));
      if (error || data?.error || !data?.ticket) return null;
      return { kind, ticket: data.ticket as string, status: 'READY', terminal: false, content: [], usage_usd: null } as Job;
    }));
    const successful = launched.filter((job): job is Job => Boolean(job));
    setJobs(successful); jobsRef.current = successful;
    if (successful.length !== sources.length) setError('חלק מהסריקות לא התחילו. בדקו קישורי HTTPS, הרשאות והגדרת השירות.');
    setStarting(false); setPolling(successful.length > 0);
  }
  async function abort() {
    setError('');
    const results = await Promise.all(jobs.filter(job => !job.terminal).map(job => db.functions.invoke('brand-apify', { body: { action: 'abort', ticket: job.ticket } }).catch(() => ({ data: null, error: true }))));
    if (results.some(result => result.error || result.data?.error)) setError('לא כל הסריקות נעצרו. המעקב יימשך; קיימת מגבלת זמן בשרת.');
    setPolling(true);
  }
  const unique = new Map<string, Content>();
  for (const job of jobs) for (const item of job.content) unique.set(`${item.source_url}\n${item.content}`, item);
  const failedEmpty = jobs.filter(job => job.terminal && !job.content.length);
  return <section dir="rtl" className="mt-5 rounded-xl border border-[var(--border)] bg-white p-4">
    <h3 className="font-bold">השלמת תוכן מהאתר ומהרשתות</h3>
    <p className="mt-1 text-sm text-[var(--muted)]">עד 8 עמודי אתר ו־20 פוסטים מכל רשת. אשרו שהקישורים שייכים למותג. הסריקה רצה ברקע והתוכן שנמצא נכנס לטופס אוטומטית — כלום לא נשמר עד לחיצה על שמירה.</p>
    {enabled === false && <p role="status" className="mt-2 text-sm text-amber-800">שירות הסריקה טרם הופעל. המילוי הרגיל נשאר זמין.</p>}
    <div className="mt-3 grid gap-3 sm:grid-cols-3">{(Object.keys(LABELS) as Kind[]).map(kind => <label key={kind} className="text-sm">{LABELS[kind]}<input type="url" dir="ltr" value={urls[kind]} disabled={active || starting} onChange={e => setUrls(current => ({ ...current, [kind]: e.target.value }))} placeholder={kind === 'website' ? 'https://example.com' : `https://www.${kind}.com/brand`} className="mt-1 w-full rounded-lg border p-2 text-left" /></label>)}</div>
    {(starting || active) && <p className="mt-3 flex items-center gap-2 text-sm text-brand"><Spinner small />{starting ? 'מתחיל סריקה…' : 'סורק ברקע… אפשר להמשיך למלא את הטופס בינתיים'}</p>}
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {active && <button type="button" onClick={() => void abort()} className="rounded-lg border px-3 py-2 text-sm">עצירת סריקות</button>}
      {active && !polling && <button type="button" onClick={() => { setError(''); setPolling(true); }} className="rounded-lg border px-3 py-2 text-sm">חידוש מעקב</button>}
      {!active && !starting && jobs.length > 0 && <button type="button" disabled={!enabled || !Object.values(urls).some(url => url.trim())} onClick={() => void start()} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50">סריקה מחדש</button>}
      {unique.size > 0 && <button type="button" onClick={() => setShowPosts(true)} className="rounded-lg border px-3 py-2 text-sm">צפייה בפוסטים שנסרקו ({unique.size})</button>}
    </div>
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    {jobs.length > 0 && <ul aria-live="polite" className="mt-3 space-y-1 text-sm">{jobs.map(job => <li key={job.ticket} className="flex items-center gap-2">
      {!job.terminal && <Spinner small />}
      {LABELS[job.kind]}: {STATUS[job.status] ?? 'בתהליך'} · {job.content.length} פריטים {job.usage_usd !== null && <bdi>(${job.usage_usd.toFixed(4)})</bdi>}{job.terminal && !job.content.length ? ' — לא התקבל תוכן לקריאה' : ''}
      {job.status_message && <span className="block text-xs text-red-700" dir="ltr">{job.status_message}</span>}
    </li>)}</ul>}
    {failedEmpty.length > 0 && <p className="mt-2 text-xs text-[var(--muted)]">מקור שהסתיים בלי תוכן: ייתכן שהחיפוש חרג מזמן הסריקה, שהעמוד חסום לרובוטים, או שהחשבון בפרופיל פרטי. אפשר לנסות שוב או להמשיך בהזנה ידנית.</p>}
    {unique.size > 0 && <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{unique.size} פריטי תוכן נכנסו לטופס אוטומטית מהסריקה.</p>}
    {showPosts && <PostsModal items={[...unique.values()]} onClose={() => setShowPosts(false)} />}
  </section>;
}

function Spinner({ small = false }: { small?: boolean }) {
  const size = small ? 'h-3.5 w-3.5' : 'h-4 w-4';
  return <span className={`${size} inline-block shrink-0 animate-spin rounded-full border-2 border-white/40 border-t-white`} style={small ? { borderColor: 'var(--border)', borderTopColor: 'var(--brand,#1A4D9C)' } : undefined} />;
}

function PostsModal({ items, onClose }: { items: Content[]; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-4 py-6" onClick={onClose}>
    <div dir="rtl" className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-4 shadow-xl" onClick={e => e.stopPropagation()}>
      <div className="mb-3 flex items-center justify-between">
        <h4 className="font-bold">הפוסטים והעמודים שנסרקו</h4>
        <button type="button" onClick={onClose} className="rounded-lg border px-3 py-1.5 text-sm">סגירה</button>
      </div>
      <div className="space-y-2">
        {items.map((item, index) => <div key={`${item.source_url}-${index}`} className="rounded-lg border p-3 text-sm">
          <strong className="block">{item.title}</strong>
          <span className="mt-1 block whitespace-pre-line text-[var(--muted)]">{item.content}</span>
          <a className="mt-1 inline-block text-brand underline" target="_blank" rel="noreferrer" href={item.source_url}>בדיקת המקור</a>
        </div>)}
        {!items.length && <p className="text-sm text-[var(--muted)]">אין עדיין פוסטים שנסרקו.</p>}
      </div>
    </div>
  </div>;
}
