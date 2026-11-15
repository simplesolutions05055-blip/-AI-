// The admin's live log (v2_events): one call per thing that happened, metadata only.
// log() never throws and is never awaited: a broken log must not break or slow a production.
// withEv() carries the org / job of the work being done, so deep helpers (fetchRetry, aiFetch) tag their events.
import { AsyncLocalStorage } from 'node:async_hooks';
import { db } from './db.ts';

export type Src = 'job' | 'wa' | 'ai' | 'render' | 'api' | 'cron' | 'monitor' | 'admin' | 'client';
export type Level = 'info' | 'warn' | 'error';
export interface Ev { src: Src; kind: string; level?: Level; msg: string; detail?: Record<string, unknown>; ms?: number | null; org_id?: string | null; job_id?: string | null }
export interface Ctx { org_id?: string | null; job_id?: string | null }

// customer content never goes into an event
const CONTENT = /text|prompt|brief|caption|message|content|input|instruction|transcript|body|system|parts/i;
export function clean(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') return v.length > 300 ? v.slice(0, 300) + '…' : v;
  if (v == null || typeof v !== 'object') return v;
  if (depth > 3) return '[…]';
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => clean(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (!CONTENT.test(k)) out[k] = clean(x, depth + 1);
  return out;
}

export function row(e: Ev, ctx: Ctx = {}) {
  let detail = (clean(e.detail ?? {}) ?? {}) as Record<string, unknown>;
  if (new TextEncoder().encode(JSON.stringify(detail)).length > 4096) detail = { truncated: true };
  return {
    src: e.src, kind: String(e.kind).slice(0, 40), level: (e.level ?? 'info') as Level,
    msg: String(e.msg ?? '').slice(0, 200), detail,
    ms: e.ms == null ? null : Math.round(e.ms),
    org_id: e.org_id ?? ctx.org_id ?? null, job_id: e.job_id ?? ctx.job_id ?? null,
  };
}

type Row = ReturnType<typeof row>;
let sink: ((r: Row) => PromiseLike<unknown>) | null = null;
export function setSink(fn: ((r: Row) => PromiseLike<unknown>) | null) { sink = fn; }
// deno-lint-ignore no-explicit-any
let client: any = null;
function dbSink(r: Row): PromiseLike<unknown> {
  if (!Deno.env.get('SUPABASE_URL') || !Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) return Promise.resolve();
  client ??= db();
  return client.from('v2_events').insert(r);
}

const als = new AsyncLocalStorage<Ctx>();
export function withEv<T>(ctx: Ctx, fn: () => Promise<T>): Promise<T> { return als.run(ctx, fn); }
export function evCtx(): Ctx { return als.getStore() ?? {}; }

// the production a call belongs to crosses function / HTTP boundaries as a header (the context itself cannot)
export const JOB_HEADER = 'x-primeos-job';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const asUuid = (v: unknown): string | null => (typeof v === 'string' && UUID.test(v.trim()) ? v.trim().toLowerCase() : null);
export function jobHeader(job: unknown = evCtx().job_id): Record<string, string> { const j = asUuid(job); return j ? { [JOB_HEADER]: j } : {}; }
export const jobOf = (req: Request) => asUuid(req.headers.get(JOB_HEADER));
// a handler runs as withEv({ job_id: jobOf(req) }, ...) and fills in the org once its token is read.
// No org at hand (an admin token) and a job header: the job's own org (one indexed read).
// deno-lint-ignore no-explicit-any
export async function evOrg(org: string | null | undefined, d?: any): Promise<void> {
  const c = als.getStore();
  if (!c) return;
  c.org_id = org ?? null;
  if (c.org_id || !c.job_id || !d) return;
  try { const { data } = await d.from('v2_jobs').select('org_id').eq('id', c.job_id).maybeSingle(); c.org_id = data?.org_id ?? null; } catch { /* the event just has no org */ }
}

export function log(e: Ev): void {
  try {
    const p = Promise.resolve((sink ?? dbSink)(row(e, als.getStore() ?? {}))).then(() => {}, () => {});
    // deno-lint-ignore no-explicit-any
    (globalThis as any).EdgeRuntime?.waitUntil?.(p);
  } catch { /* never throws */ }
}

// error text can embed a request URL (Deno fetch errors do), and URLs can carry keys in the query string; provider bodies can echo phone numbers (7+ digit runs are masked)
export const errText = (e: unknown) => String(e instanceof Error ? e.message : (e as { message?: unknown })?.message ?? e)
  .replace(/(https?:\/\/[^\s?#'")]+)\?[^\s'")]*/g, '$1')
  .replace(/((?:^|[?&\s])(?:key|api_key|apikey|token|secret|signature|sig|access_token)=)[^&\s'")]+/gi, '$1…')
  .replace(/(?<!\d)(?!\d{4}-\d{2}-\d{2}(?!\d))\+?\d(?:[\s.-]?\d){6,}/g, '…') // phone numbers / long ids; ISO dates are kept
  .slice(0, 300);

export function time(base: Ev) {
  const t0 = Date.now();
  return {
    ok: (detail: Record<string, unknown> = {}) => log({ ...base, detail: { ...base.detail, ...detail }, ms: Date.now() - t0 }),
    fail: (err: unknown, detail: Record<string, unknown> = {}) => log({ ...base, level: 'error', detail: { ...base.detail, ...detail, error: errText(err) }, ms: Date.now() - t0 }),
  };
}

const PROVIDERS: [RegExp, string][] = [
  [/(^|\.)api\.anthropic\.com$/, 'anthropic'], [/(^|\.)api\.openai\.com$/, 'openai'],
  [/^generativelanguage\.googleapis\.com$/, 'gemini'], [/^texttospeech\.googleapis\.com$/, 'google-tts'],
  [/(^|\.)api\.elevenlabs\.io$/, 'elevenlabs'], [/(^|\.)fal\.run$/, 'fal'], [/(^|\.)api\.higgsfield\.ai$/, 'higgsfield'],
];
export function aiProvider(url: string): string | null {
  try { const h = new URL(url).host; return PROVIDERS.find(([re]) => re.test(h))?.[1] ?? null; } catch { return null; }
}
// bodies can be megabytes of base64 (images, audio): only a small body is parsed, a big one is searched near its start
export function modelOf(init?: RequestInit): string | undefined {
  const b = init?.body;
  if (typeof b !== 'string') return undefined;
  if (b.length < 64000) { try { return String(JSON.parse(b).model ?? '').slice(0, 60) || undefined; } catch { return undefined; } }
  return /"model"\s*:\s*"([^"]{1,60})"/.exec(b.slice(0, 4096))?.[1];
}

// one ai.call event; status 0 = the request itself failed (network / timeout)
export function logAi(url: string, init: RequestInit | undefined, status: number, tries: number, ms: number, err?: unknown) {
  const provider = aiProvider(url);
  if (!provider) return;
  const ok = status >= 200 && status < 400;
  let path = ''; try { path = new URL(url).pathname.slice(0, 80); } catch { /* keep empty */ }
  log({
    src: 'ai', kind: 'ai.call', level: ok ? (tries > 1 ? 'warn' : 'info') : 'error',
    msg: `${provider} ${ok ? 'ענה' : 'נכשל'}${status ? ' (' + status + ')' : ''}${tries > 1 ? ' אחרי ' + tries + ' ניסיונות' : ''}`,
    detail: { provider, status, tries, path, model: modelOf(init), ...(err ? { error: errText(err) } : {}) }, ms,
  });
}

// fetch for a single provider call that does not go through fetchRetry
export async function aiFetch(url: string, init?: RequestInit): Promise<Response> {
  const t0 = Date.now();
  try { const r = await fetch(url, init); logAi(url, init, r.status, 1, Date.now() - t0); return r; }
  catch (e) { logAi(url, init, 0, 1, Date.now() - t0, e); throw e; }
}
