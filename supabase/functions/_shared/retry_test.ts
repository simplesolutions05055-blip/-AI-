import { assertEquals } from 'jsr:@std/assert@1';
import { fetchRetry } from './retry.ts';
import { evOrg, jobOf, setSink, withEv } from './events.ts';
import shared from './retry.ts' with { type: 'text' };
import generate from '../generate/retry.ts' with { type: 'text' };
import image from '../image/retry.ts' with { type: 'text' };
import produce from '../produce/retry.ts' with { type: 'text' };
import smartsend from '../smartsend-webhook/retry.ts' with { type: 'text' };

Deno.test('the per-function retry.ts copies match _shared/retry.ts (run npm run sync:design)', () => {
  for (const [name, copy] of Object.entries({ generate, image, produce, smartsend })) assertEquals(copy, shared, name);
});

Deno.test('fetchRetry that throws on every try logs one error ai.call with status 0', async () => {
  const got: any[] = [];
  setSink((r) => { got.push(r); return Promise.resolve(); });
  const real = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error('boom'))) as typeof fetch;
  let threw = false;
  try { await fetchRetry('https://api.openai.com/v1/x', { method: 'POST', body: '{}' }, { tries: 2, base: 1, maxWait: 1 }); } catch { threw = true; }
  finally { globalThis.fetch = real; setSink(null); }
  assertEquals(threw, true);
  assertEquals(got.length, 1);
  assertEquals([got[0].level, got[0].detail.status, typeof got[0].detail.error], ['error', 0, 'string']);
});

Deno.test('fetchRetry logs one ai.call after its retries, tagged warn with the try count', async () => {
  const got: any[] = [];
  setSink((r) => { got.push(r); return Promise.resolve(); });
  const real = globalThis.fetch; let n = 0;
  globalThis.fetch = (() => Promise.resolve(new Response('{}', { status: ++n < 2 ? 529 : 200 }))) as typeof fetch;
  try { await fetchRetry('https://api.anthropic.com/v1/messages', { method: 'POST', body: '{"model":"m"}' }, { base: 1, maxWait: 1 }); }
  finally { globalThis.fetch = real; setSink(null); }
  assertEquals(got.length, 1);
  assertEquals([got[0].level, got[0].detail.tries, got[0].detail.status], ['warn', 2, 200]);
});

Deno.test('fetchRetry to a non-provider host logs nothing', async () => {
  const got: any[] = [];
  setSink((r) => { got.push(r); return Promise.resolve(); });
  const real = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response('ok'))) as typeof fetch;
  try { await fetchRetry('https://images.pexels.com/x', {}); } finally { globalThis.fetch = real; setSink(null); }
  assertEquals(got.length, 0);
});

Deno.test('a handler-style withEv wrapper tags fetchRetry ai.call with the token org and the header job', async () => {
  const got: any[] = [];
  setSink((r) => { got.push(r); return Promise.resolve(); });
  const real = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response('{}'))) as typeof fetch;
  const job = '5f0e1d2c-3b4a-4968-8776-655443322110';
  const req = new Request('http://fn/generate', { method: 'POST', headers: { 'x-primeos-job': job } });
  // what generate / image / produce do: the job from the header, the org once the token is read
  const handle = async () => { await evOrg('org-1'); await fetchRetry('https://api.anthropic.com/v1/messages', { method: 'POST', body: '{"model":"m"}' }); return new Response('ok'); };
  try { await withEv({ job_id: jobOf(req) }, handle); } finally { globalThis.fetch = real; setSink(null); }
  assertEquals(got.length, 1);
  assertEquals([got[0].kind, got[0].org_id, got[0].job_id, got[0].detail.model], ['ai.call', 'org-1', job, 'm']);
});
