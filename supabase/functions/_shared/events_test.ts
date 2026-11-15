import { assert, assertEquals } from 'jsr:@std/assert@1';
import { aiProvider, errText, clean, log, row, setSink, time, withEv, aiFetch, evCtx, evOrg, jobHeader, jobOf, modelOf, JOB_HEADER } from './events.ts';

Deno.test('clean drops content keys at any depth and trims long strings', () => {
  const c = clean({ text: 'hi', a: { prompt: 'x', b: 'y'.repeat(500), body: 'z' }, list: [{ caption: 'c', ok: 1 }] }) as any;
  assertEquals(c.text, undefined); assertEquals(c.a.prompt, undefined); assertEquals(c.a.body, undefined);
  assertEquals(c.a.b.length, 301); assertEquals(c.list[0], { ok: 1 });
});

Deno.test('row trims msg, caps detail size, takes org/job from the context', () => {
  const r = row({ src: 'ai', kind: 'ai.call', msg: 'm'.repeat(400), detail: { big: Array.from({ length: 100 }, (_, i) => 'x'.repeat(250) + i) } }, { org_id: 'o', job_id: 'j' });
  assertEquals(r.msg.length, 200); assertEquals(r.detail, { truncated: true });
  assertEquals([r.org_id, r.job_id, r.level], ['o', 'j', 'info']);
});

Deno.test('log never throws, even when the sink throws or rejects', async () => {
  setSink(() => { throw new Error('db down'); });
  log({ src: 'api', kind: 'fn.error', msg: 'x' });
  setSink(() => Promise.reject(new Error('db down')));
  log({ src: 'api', kind: 'fn.error', msg: 'x' });
  await new Promise((r) => setTimeout(r, 10));
  setSink(null);
});

Deno.test('withEv context reaches log inside async work; time() measures ms and marks failures', async () => {
  const got: any[] = [];
  setSink((r) => { got.push(r); return Promise.resolve(); });
  await withEv({ org_id: 'o1', job_id: 'j1' }, async () => {
    await new Promise((r) => setTimeout(r, 5));
    const t = time({ src: 'render', kind: 'render.done', msg: 'r' });
    t.fail(new Error('nope'), { size: 3 });
  });
  setSink(null);
  assertEquals(got.length, 1);
  assertEquals([got[0].org_id, got[0].job_id, got[0].level, got[0].detail.error, got[0].detail.size], ['o1', 'j1', 'error', 'nope', 3]);
  assert(Number.isInteger(got[0].ms));
});

Deno.test('aiProvider knows the provider hosts and nothing else', () => {
  assertEquals(aiProvider('https://api.anthropic.com/v1/messages'), 'anthropic');
  assertEquals(aiProvider('https://generativelanguage.googleapis.com/v1beta/x'), 'gemini');
  assertEquals(aiProvider('https://api.higgsfield.ai/requests/1/status'), 'higgsfield');
  assertEquals(aiProvider('https://images.pexels.com/a.jpg'), null);
  assertEquals(aiProvider('not a url'), null);
});

Deno.test('aiFetch logs one ai.call with provider, status, model; never the body', async () => {
  const got: any[] = [];
  setSink((r) => { got.push(r); return Promise.resolve(); });
  const real = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response('{}', { status: 529 }))) as typeof fetch;
  try { await aiFetch('https://api.anthropic.com/v1/messages', { method: 'POST', body: JSON.stringify({ model: 'claude-x', messages: [{ content: 'secret' }] }) }); }
  finally { globalThis.fetch = real; setSink(null); }
  assertEquals(got.length, 1);
  assertEquals([got[0].kind, got[0].level, got[0].detail.provider, got[0].detail.status, got[0].detail.model], ['ai.call', 'error', 'anthropic', 529, 'claude-x']);
  assert(!JSON.stringify(got[0]).includes('secret'));
});

Deno.test('row caps detail by bytes, not characters (Hebrew is multibyte)', () => {
  const r = row({ src: 'api', kind: 'k', msg: 'm', detail: { a: 'ש'.repeat(270), b: 'ש'.repeat(270), c: 'ש'.repeat(270), d: 'ש'.repeat(270), e: 'ש'.repeat(270), f: 'ש'.repeat(270), g: 'ש'.repeat(270), h: 'ש'.repeat(270) } });
  assert(JSON.stringify(r.detail).length < 4096);
  assertEquals(r.detail, { truncated: true });
});

Deno.test('errText strips URL query strings and masks secret params', () => {
  const e = new Error('error sending request for url (https://texttospeech.googleapis.com/v1/text:synthesize?key=SECRET123&x=1): boom');
  const t = errText(e);
  assert(!t.includes('SECRET123') && !t.includes('x=1'));
  assert(t.includes('https://texttospeech.googleapis.com/v1/text:synthesize'));
  const m = errText('bad token=abc123 and api_key=zzz');
  assert(!m.includes('abc123') && !m.includes('zzz'));
});

Deno.test('clean drops content keys by pattern, keeps metadata', () => {
  assertEquals(clean({ prompt_text: 'a', instructions: 'b', transcript: 'c', model: 'm', status: 200, step_to: 'x' }), { model: 'm', status: 200, step_to: 'x' });
});

Deno.test('errText masks phone numbers but keeps statuses, counts and ISO dates', () => {
  for (const p of ['+972-50-123-4567', '972501234567', '050 123 4567', '050.123.4567']) assertEquals(errText('to ' + p + ' failed'), 'to … failed');
  assertEquals(errText('smartsend_500: bad'), 'smartsend_500: bad');
  assertEquals(errText('retry after 429'), 'retry after 429');
  assertEquals(errText('at 2026-11-15 12 rows'), 'at 2026-11-15 12 rows');
  assertEquals(errText('smartsend_400: {"phone":"0501234567"}'), 'smartsend_400: {"phone":"…"}');
});

const JOB = '0b9c6f2e-3d1a-4c8e-9f7b-2a5d6e8f1c3b';
Deno.test('jobHeader carries the context job as x-primeos-job; jobOf reads back only a UUID', async () => {
  assertEquals(jobHeader(), {});
  assertEquals(await withEv({ org_id: 'o', job_id: JOB }, async () => jobHeader()), { [JOB_HEADER]: JOB });
  assertEquals(jobHeader('not-a-uuid'), {});
  assertEquals(jobHeader(JOB.toUpperCase()), { 'x-primeos-job': JOB });
  const req = (v?: string) => new Request('http://x/', { headers: v ? { [JOB_HEADER]: v } : {} });
  assertEquals([jobOf(req(JOB)), jobOf(req()), jobOf(req("1' or 1=1")), jobOf(req(JOB + 'x'))], [JOB, null, null, null]);
});

Deno.test('evOrg fills the handler context: the token org, else the job org, never outside a context', async () => {
  const reads: string[] = [];
  const d = { from: (t: string) => ({ select: () => ({ eq: (_c: string, v: string) => ({ maybeSingle: () => { reads.push(t + ':' + v); return Promise.resolve({ data: { org_id: 'job-org' } }); } }) }) }) };
  assertEquals(await withEv({ job_id: JOB }, async () => { await evOrg('tok-org', d); return evCtx(); }), { job_id: JOB, org_id: 'tok-org' });
  assertEquals(reads, []);
  assertEquals(await withEv({ job_id: JOB }, async () => { await evOrg(null, d); return evCtx(); }), { job_id: JOB, org_id: 'job-org' });
  assertEquals(reads, ['v2_jobs:' + JOB]);
  assertEquals(await withEv({ job_id: null }, async () => { await evOrg(null, d); return evCtx(); }), { job_id: null, org_id: null });
  assertEquals(reads.length, 1, 'no header, no read');
  await evOrg('x', d); assertEquals(evCtx(), {});
});

Deno.test('modelOf parses small bodies; a multi-MB body is only searched near its start', () => {
  assertEquals(modelOf({ body: '{"model":"claude-x","max_tokens":5}' }), 'claude-x');
  const big = '{"model": "gpt-image-1", "image": "' + 'A'.repeat(19_000_000) + '"}';
  const realParse = JSON.parse; let parsed = 0;
  JSON.parse = ((...a: Parameters<typeof JSON.parse>) => { parsed++; return realParse(...a); }) as typeof JSON.parse;
  try { assertEquals(modelOf({ body: big }), 'gpt-image-1'); } finally { JSON.parse = realParse; }
  assertEquals(parsed, 0, 'no JSON.parse of a big body');
  assertEquals(modelOf({ body: '{"image":"' + 'A'.repeat(70000) + '","model":"late"}' }), undefined);
  assertEquals(modelOf({ body: new Uint8Array(3) }), undefined);
});
