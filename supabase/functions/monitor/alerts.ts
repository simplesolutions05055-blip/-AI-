// WhatsApp alerts to the people who run PrimeOS: a production that failed, a critical incident, a stuck production,
// a WhatsApp message that did not go out. Read from the admin event log (v2_events) on every monitor round.
// One message per round at most, the same thing never twice inside its quiet time, a cap per hour. The staging copy never sends.
// deno-lint-ignore-file no-explicit-any

// two rows of admin_state, one writer each: 'alerts' is what the admin sets (the console writes it), 'alerts_state' is the monitor's own place
export interface AlertSettings { on?: boolean; phones?: { n: string; ph: string }[] }
export interface AlertState { last?: number; sent?: Record<string, string>; hour?: string[] }
export interface AlertItem { key: string; line: string; quiet: number; job?: string }

const MIN = 60000;
export const MAX_PER_HOUR = 6;   // messages, not lines
export const MAX_LINES = 8;      // lines in one message; the rest is counted
// the same names the console shows for production steps
const STEP_HE: Record<string, string> = { start: 'התחלה', brief: 'הבנת הבקשה', texts: 'כתיבת הטקסטים', design: 'עיצוב', fit: 'התאמת העיצוב', media: 'הכנת המדיה', clips: 'קטעי הווידאו', render: 'רינדור', status: 'המתנה לרינדור', fix: 'תיקון', done: 'סיום' };
const stepHe = (c: unknown) => STEP_HE[String(c ?? '')] ?? String(c ?? '-');
const KIND_HE: Record<string, string> = { graphic: 'גרפיקה', doc: 'מסמך', deck: 'מצגת', video: 'סרטון', vscan: 'ניתוח סרטון', carousel: 'קרוסלה' };

// an Israeli mobile as people type it (050-1234567, +972 50 123 4567) -> 972501234567; anything else must already be international digits
export function phoneOf(v: unknown): string | null {
  let s = String(v ?? '').replace(/\D/g, '');
  if (/^0[5]\d{8}$/.test(s)) s = '972' + s.slice(1);
  return /^[1-9]\d{9,14}$/.test(s) ? s : null;
}

// what this round found, as lines with a key (the thing) and its quiet time (minutes before the same thing may alert again)
export function collect(events: any[], stuck: any[]): AlertItem[] {
  const out: AlertItem[] = [];
  let waFail = 0;
  for (const e of events) {
    const d = e.detail ?? {};
    if (e.kind === 'job.error' && e.job_id) out.push({ key: 'job:' + e.job_id, quiet: 360, job: String(e.job_id), line: String(e.msg ?? 'הפקה נכשלה').replace(/בשלב ([a-z_]+)/, (_x: string, c: string) => 'בשלב ' + stepHe(c)).slice(0, 160) });
    else if (e.kind === 'incident.open' && (d.severity === 'crit' || d.kind === 'stuck')) out.push({ key: 'inc:' + String(d.kind ?? d.incident), quiet: 60, line: (d.severity === 'crit' ? 'תקלה קריטית: ' : 'תקלה: ') + String(e.msg ?? '').replace(/^תקלה נפתחה:\s*/, '').slice(0, 140) });
    else if (e.kind === 'wa.send_fail') waFail++;
  }
  if (waFail) out.push({ key: 'wa', quiet: 30, line: waFail === 1 ? 'הודעת WhatsApp ללקוח לא נשלחה' : waFail + ' הודעות WhatsApp ללקוחות לא נשלחו' });
  for (const j of stuck) out.push({ key: 'stuck:' + j.id, quiet: 1440, job: String(j.id), line: 'הפקה תקועה מעל 10 דקות: ' + (KIND_HE[j.kind] ?? j.kind) + (j.org ? ' · ' + j.org : '') + ', בשלב ' + stepHe(j.step) });
  return out;
}

// what may go out now, and the state after it. Pure: the same input gives the same answer.
export function decide(items: AlertItem[], st: AlertState, now: number): { items: AlertItem[]; more: number; state: AlertState; capped: boolean } {
  const sent: Record<string, string> = {};
  // forget what is past the longest quiet time
  for (const [k, at] of Object.entries(st.sent ?? {})) if (now - new Date(at).getTime() < 1440 * MIN) sent[k] = at;
  const hour = (st.hour ?? []).filter((at) => now - new Date(at).getTime() < 60 * MIN);
  const fresh: AlertItem[] = [];
  for (const it of items) {
    if (fresh.some((f) => f.key === it.key)) continue;
    const at = sent[it.key];
    if (at && now - new Date(at).getTime() < it.quiet * MIN) continue;
    fresh.push(it);
  }
  const state: AlertState = { ...st, sent, hour };
  if (!fresh.length) return { items: [], more: 0, state, capped: false };
  // over the hourly cap: nothing goes out and nothing is marked, so the first free round carries it
  if (hour.length >= MAX_PER_HOUR) return { items: [], more: fresh.length, state, capped: true };
  const iso = new Date(now).toISOString();
  for (const it of fresh) sent[it.key] = iso;
  state.hour = [...hour, iso];
  return { items: fresh.slice(0, MAX_LINES), more: Math.max(0, fresh.length - MAX_LINES), state, capped: false };
}

// a production line carries the link that opens its timeline in the console
export function message(items: { line: string; job?: string }[], more: number, app: string): string {
  const n = items.length + more;
  return ['PrimeOS: ' + (n === 1 ? 'התראה' : n + ' התראות'), ...items.flatMap((i) => ['• ' + i.line, ...(i.job ? ['  ' + app + '/admin?job=' + i.job] : [])]), ...(more ? ['ועוד ' + more + ' ביומן החי'] : []), ...(items.some((i) => i.job) && !more ? [] : [app + '/admin'])].join('\n');
}

export interface AlertDeps {
  staging: boolean; app: string;
  send: (phone: string, text: string) => Promise<void>;          // WhatsApp
  mail: (subject: string, html: string) => Promise<boolean>;     // when WhatsApp itself is what failed
  log: (e: { kind: string; level: 'info' | 'warn' | 'error'; msg: string; detail: Record<string, unknown> }) => void;
}

// to every phone; a phone that fails does not stop the others. WhatsApp down for all of them -> the same text by mail.
// `why` is the provider's own words for the first refusal, kept for the log: without it a failed alert cannot be explained
export async function deliver(text: string, phones: { ph: string }[], deps: AlertDeps): Promise<{ ok: number; fail: number; dry: boolean; mailed: boolean; why?: string }> {
  if (deps.staging) return { ok: 0, fail: 0, dry: true, mailed: false };
  let ok = 0, fail = 0, why = '';
  for (const p of phones) { try { await deps.send(p.ph, text); ok++; } catch (e) { fail++; why ||= (e instanceof Error ? e.message : String(e)).slice(0, 240); } }
  let mailed = false;
  if (!ok) mailed = await deps.mail('PrimeOS: התראה (WhatsApp לא זמין)', '<div dir="rtl" style="white-space:pre-line">' + text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string)) + '</div>').catch(() => false);
  return why ? { ok, fail, dry: false, mailed, why } : { ok, fail, dry: false, mailed };
}

// one monitor round. Never throws: the checks of the monitor do not depend on it.
export async function alertRound(d: any, deps: AlertDeps, now = Date.now()): Promise<Record<string, unknown>> {
  try {
    const [{ data: row }, { data: own }] = await Promise.all([
      d.from('admin_state').select('data').eq('id', 'alerts').maybeSingle(),
      d.from('admin_state').select('data').eq('id', 'alerts_state').maybeSingle(),
    ]);
    const set = (row?.data ?? {}) as AlertSettings, st = (own?.data ?? {}) as AlertState;
    const save = (s: AlertState) => d.from('admin_state').upsert({ id: 'alerts_state', data: { last: s.last, sent: s.sent ?? {}, hour: s.hour ?? [] }, updated_at: new Date(now).toISOString() });
    const { data: top } = await d.from('v2_events').select('id').order('id', { ascending: false }).limit(1);
    const max = +(top?.[0]?.id ?? 0);
    // the first round only marks the place: an old log is not sent as news
    if (st.last == null) { await save({ ...st, last: max }); return { ok: true, first: true }; }
    const phones = (set.phones ?? []).filter((p) => phoneOf(p.ph));
    if (set.on === false || !phones.length) { await save({ ...st, last: max }); return { ok: true, off: true }; }
    const [{ data: evs }, { data: jobs }] = await Promise.all([
      d.from('v2_events').select('id,kind,msg,detail,job_id').gt('id', st.last).lte('id', max).in('kind', ['job.error', 'incident.open', 'wa.send_fail']).order('id', { ascending: true }).limit(300),
      d.from('v2_jobs').select('id,kind,step,org_id')
        // stuck now, and moved in the last day: a production abandoned long ago is not news
      .eq('state', 'run').lt('next_at', new Date(now - 10 * MIN).toISOString()).gt('updated_at', new Date(now - 1440 * MIN).toISOString()).limit(20),
    ]);
    const ids = [...new Set((jobs ?? []).map((j: any) => j.org_id).filter(Boolean))];
    const { data: orgs } = ids.length ? await d.from('organizations').select('id,name').in('id', ids) : { data: [] };
    const names = Object.fromEntries((orgs ?? []).map((o: any) => [o.id, o.name]));
    const items = collect(evs ?? [], (jobs ?? []).map((j: any) => ({ ...j, org: names[j.org_id] ?? null })));
    const r = decide(items, st, now);
    if (r.capped) {
      // the place in the log stays: what was held back is read again on the next round
      await save({ ...r.state, last: st.last });
      deps.log({ kind: 'alert.held', level: 'warn', msg: 'התראות WhatsApp הושהו: יותר מ-' + MAX_PER_HOUR + ' בשעה', detail: { waiting: r.more } });
      return { ok: true, capped: true, waiting: r.more };
    }
    await save({ ...r.state, last: max });
    if (!r.items.length) return { ok: true, sent: 0 };
    const out = await deliver(message(r.items, r.more, deps.app), phones, deps);
    deps.log({ kind: out.dry || out.ok ? 'alert.sent' : 'alert.fail', level: out.dry || out.ok ? 'info' : 'error', msg: out.dry ? 'התראת WhatsApp (סביבת בדיקות, לא נשלחה)' : out.ok ? 'התראת WhatsApp נשלחה למנהלים' : 'התראת WhatsApp לא נשלחה', detail: { lines: r.items.length + r.more, phones: phones.length, ok: out.ok, fail: out.fail, dry: out.dry, mailed: out.mailed, ...(out.why ? { why: out.why } : {}) } });
    return { ok: true, sent: r.items.length + r.more, delivered: out.ok, failed: out.fail, dry: out.dry, mailed: out.mailed };
  } catch (e) {
    console.error('alerts', e instanceof Error ? e.message : e);
    return { ok: false };
  }
}
