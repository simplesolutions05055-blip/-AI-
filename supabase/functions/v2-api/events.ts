// admin reads of v2_events: a page of the log, one production's timeline, the live stream (Task 7)
// deno-lint-ignore-file no-explicit-any
import { errText } from '../_shared/events.ts';
export const EV_COLS = 'id,at,org_id,job_id,src,kind,level,msg,detail,ms';
const SRCS = ['job', 'wa', 'ai', 'render', 'api', 'cron', 'monitor', 'admin', 'client'];
const LEVELS = ['info', 'warn', 'error'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EvFilter { src?: string; level?: string; org?: string }
export function evFilter(p: Record<string, any>): EvFilter {
  return {
    src: SRCS.includes(p.src) ? p.src : undefined,
    level: p.level === 'warn' ? 'warn' : LEVELS.includes(p.level) ? p.level : undefined,
    org: typeof p.org === 'string' && UUID.test(p.org) ? p.org : undefined,
  };
}
// level 'warn' means "warn and worse"
export function applyFilter(q: any, f: EvFilter) {
  if (f.src) q = q.eq('src', f.src);
  if (f.level === 'warn') q = q.in('level', ['warn', 'error']); else if (f.level) q = q.eq('level', f.level);
  if (f.org) q = q.eq('org_id', f.org);
  return q;
}
export async function orgNames(d: any, rows: any[]) {
  const ids = [...new Set(rows.map((r) => r.org_id).filter(Boolean))];
  const { data } = ids.length ? await d.from('organizations').select('id,name').in('id', ids) : { data: [] };
  const m = Object.fromEntries((data ?? []).map((o: any) => [o.id, o.name]));
  return rows.map((r) => ({ ...r, org: r.org_id ? m[r.org_id] ?? null : null }));
}

export async function evLoad(d: any, p: Record<string, any>) {
  const limit = Math.min(200, Math.max(1, Number(p.limit) || 100));
  let q = applyFilter(d.from('v2_events').select(EV_COLS), evFilter(p)).order('id', { ascending: false }).limit(limit);
  if (Number.isFinite(+p.before) && +p.before > 0) q = q.lt('id', +p.before);
  const { data, error } = await q;
  if (error) throw error;
  const rows = data ?? [];
  return { ok: true as const, events: await orgNames(d, rows), next: rows.length === limit ? rows[rows.length - 1].id : null };
}

export async function evTimeline(d: any, p: Record<string, any>) {
  const id = String(p.job_id ?? '');
  if (!UUID.test(id)) throw new Error('bad_job');
  const [{ data: job }, { data: events, error }] = await Promise.all([
    d.from('v2_jobs').select('id,org_id,kind,step,state,src,error,tries,created_at,updated_at,next_at,ui_id').eq('id', id).maybeSingle(),
    d.from('v2_events').select(EV_COLS).eq('job_id', id).order('id', { ascending: true }).limit(1000),
  ]);
  if (error) throw error;
  if (!job && !(events ?? []).length) throw new Error('not_found');
  const orgId = job?.org_id ?? events?.[0]?.org_id ?? null;
  const { data: o } = orgId ? await d.from('organizations').select('name').eq('id', orgId).maybeSingle() : { data: null };
  return { ok: true as const, job: job ?? null, org: o?.name ?? null, events: events ?? [] };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// a live stream of new events. Ends by itself (below the function's time limit); the console reconnects with after = last id.
export function evStream(req: Request, d: any, p: Record<string, any>, headers: Record<string, string>): Response {
  const f = evFilter(p);
  const life = Math.min(120000, Math.max(1000, Number(p.ms) || 120000));
  const end = Date.now() + life;
  const enc = new TextEncoder();
  let after = Math.max(0, Math.floor(Number(p.after) || 0));
  const body = new ReadableStream({
    async start(c) {
      const send = (s: string) => c.enqueue(enc.encode(s));
      let ping = Date.now();
      try {
        // first open without a position: the newest 50, oldest first
        if (!after) {
          const { data, error } = await applyFilter(d.from('v2_events').select(EV_COLS), f).order('id', { ascending: false }).limit(50);
          if (error) throw error;
          const rows = (data ?? []).reverse();
          for (const r of await orgNames(d, rows)) { send(`id: ${r.id}\ndata: ${JSON.stringify(r)}\n\n`); after = r.id; }
        }
        while (Date.now() < end && !req.signal.aborted) {
          const { data, error } = await applyFilter(d.from('v2_events').select(EV_COLS), f).gt('id', after).order('id', { ascending: true }).limit(200);
          if (error) throw error;
          const rows = data ?? [];
          for (const r of await orgNames(d, rows)) { send(`id: ${r.id}\ndata: ${JSON.stringify(r)}\n\n`); after = r.id; }
          if (Date.now() - ping > 15000) { send(': ping\n\n'); ping = Date.now(); }
          if (rows.length < 200) await sleep(1000);
        }
        send(`event: end\ndata: ${JSON.stringify({ after })}\n\n`);
      } catch {
        try { send('event: error\ndata: {}\n\n'); } catch { /* client gone */ }
      }
      try { c.close(); } catch { /* already closed */ }
    },
  });
  return new Response(body, { status: 200, headers: { ...headers, 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
}

const RENDER_KINDS = ['render.start', 'render.done', 'render.fail'];
const WHAT_HE: Record<string, string> = { video: 'סרטון', pdf: 'PDF', image: 'תמונה', deck: 'מצגת', doc: 'מסמך', convert: 'המרה' };
// the Vercel render routes report here (they hold the caller's token, not the service key)
// one caller cannot flood the log: a browser session gets 30 render events an hour (per member); a server token
// (produce -> /api/render, the job runner) gets 600 an hour per org, so a busy org keeps its render failures
export function renderLimit(s: { memberId?: string | null; session?: boolean }): { member: string | null; max: number } {
  return s.session ? { member: s.memberId ?? null, max: 30 } : { member: null, max: 600 }; // an admin session counts on the admin bucket (no org)
}
export async function evRender(d: any, s: { orgId?: string | null; memberId?: string | null; session?: boolean }, p: Record<string, any>) {
  const kind = String(p.kind ?? '');
  if (!RENDER_KINDS.includes(kind)) throw new Error('bad_kind');
  const { member, max } = renderLimit(s);
  let q = d.from('v2_events').select('id', { count: 'exact', head: true }).eq('src', 'render').gte('at', new Date(Date.now() - 3600000).toISOString());
  q = member ? q.eq('detail->>member', member) : s.orgId ? q.eq('org_id', s.orgId) : q.is('org_id', null);
  const { count } = await q;
  if ((count ?? 0) >= max) return { ok: true, dropped: true };
  const what = WHAT_HE[p.what] ? String(p.what) : 'convert';
  const UUIDJ = typeof p.job_id === 'string' && UUID.test(p.job_id) ? p.job_id : null;
  const he = WHAT_HE[what];
  const msg = kind === 'render.start' ? `רינדור ${he} התחיל` : kind === 'render.done' ? `רינדור ${he} הסתיים` : `רינדור ${he} נכשל`;
  const { error } = await d.from('v2_events').insert({
    src: 'render', kind, level: kind === 'render.fail' ? 'error' : 'info', msg,
    detail: { what, error: p.error ? errText(p.error) : undefined, size: Number.isFinite(+p.size) ? +p.size : undefined, member: member ?? undefined },
    ms: Number.isFinite(+p.ms) ? Math.min(2147483647, Math.max(0, Math.round(+p.ms))) : null,
    org_id: s.orgId ?? null, job_id: UUIDJ,
  });
  if (error) throw error;
  return { ok: true };
}
