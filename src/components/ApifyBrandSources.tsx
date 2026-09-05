import { useEffect, useMemo, useRef, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

type Kind = 'website' | 'facebook' | 'instagram';
interface Content { title: string; content: string; source_url: string }
interface Job { kind: Kind; ticket: string; status: string; terminal: boolean; content: Content[]; usage_usd: number | null }
const LABELS: Record<Kind, string> = { website: 'אתר רשמי', facebook: 'Facebook', instagram: 'Instagram' };
const STATUS: Record<string, string> = { READY: 'ממתין', RUNNING: 'סורק', SUCCEEDED: 'הושלם', FAILED: 'נכשל', 'TIMED-OUT': 'תם זמן הסריקה', ABORTED: 'נעצר', ERROR: 'בדיקת הסטטוס נכשלה' };

export default function ApifyBrandSources({ website, socialLinks, onApply }: { website?: string; socialLinks?: { facebook: string | null; instagram: string | null }; onApply: (content: Content[]) => void }) {
  const db = useMemo(() => createSupabaseBrowserClient(), []);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [urls, setUrls] = useState<Record<Kind, string>>({ website: '', facebook: '', instagram: '' });
  const [jobs, setJobs] = useState<Job[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
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
      setJobs(current => current.map(job => updates.find(update => update?.ticket === job.ticket) ?? job));
      if (updates.every(Boolean)) timer = setTimeout(() => void tick(), 3000);
    }
    void tick();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [polling, db]);

  async function start() {
    setError(''); setStarting(true); setJobs([]); setSelected(new Set());
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
  return <section dir="rtl" className="mt-5 rounded-xl border border-[var(--border)] bg-white p-4">
    <h3 className="font-bold">השלמת תוכן מהאתר ומהרשתות</h3>
    <p className="mt-1 text-sm text-[var(--muted)]">עד 8 עמודי אתר ו־20 פוסטים מכל רשת. אשרו שהקישורים שייכים למותג. התוכן ייכנס לטופס רק לאחר בחירה, ויישמר בלחיצה על שמירה.</p>
    {enabled === false && <p role="status" className="mt-2 text-sm text-amber-800">שירות הסריקה טרם הופעל. המילוי הרגיל נשאר זמין.</p>}
    <div className="mt-3 grid gap-3 sm:grid-cols-3">{(Object.keys(LABELS) as Kind[]).map(kind => <label key={kind} className="text-sm">{LABELS[kind]}<input type="url" dir="ltr" value={urls[kind]} disabled={active || starting} onChange={e => setUrls(current => ({ ...current, [kind]: e.target.value }))} placeholder={kind === 'website' ? 'https://example.com' : `https://www.${kind}.com/brand`} className="mt-1 w-full rounded-lg border p-2 text-left" /></label>)}</div>
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" disabled={!enabled || active || starting || !Object.values(urls).some(url => url.trim())} onClick={() => void start()} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{starting ? 'מתחיל סריקה…' : 'סריקת המקורות שסומנו'}</button>
      {active && <button type="button" onClick={() => void abort()} className="rounded-lg border px-3 py-2 text-sm">עצירת סריקות</button>}
      {active && !polling && <button type="button" onClick={() => { setError(''); setPolling(true); }} className="rounded-lg border px-3 py-2 text-sm">חידוש מעקב</button>}
    </div>
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    <ul aria-live="polite" className="mt-3 space-y-1 text-sm">{jobs.map(job => <li key={job.ticket}>{LABELS[job.kind]}: {STATUS[job.status] ?? 'בתהליך'} · {job.content.length} מקורות {job.usage_usd !== null && <bdi>(${job.usage_usd.toFixed(4)})</bdi>}{job.terminal && !job.content.length ? ' — לא התקבל תוכן לקריאה' : ''}</li>)}</ul>
    {[...unique].map(([key, item]) => <label key={key} className="mt-2 flex items-start gap-2 rounded-lg border p-3 text-sm"><input type="checkbox" className="mt-1" disabled={applied.current.has(key)} checked={selected.has(key)} onChange={e => setSelected(current => { const next = new Set(current); if (e.target.checked) next.add(key); else next.delete(key); return next; })} /><span><strong>{item.title}</strong><span className="my-1 line-clamp-3 block whitespace-pre-line">{item.content}</span><a className="text-brand underline" target="_blank" rel="noreferrer" href={item.source_url}>בדיקת המקור</a>{applied.current.has(key) && <span> · הועבר לטופס</span>}</span></label>)}
    {unique.size > 0 && <button type="button" disabled={!selected.size} onClick={() => { const chosen = [...selected].flatMap(key => unique.has(key) ? [unique.get(key)!] : []); onApply(chosen); selected.forEach(key => applied.current.add(key)); setSelected(new Set()); }} className="mt-3 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">אישור התוכן שנבחר והעברתו למוח העסקי בטופס</button>}
  </section>;
}
