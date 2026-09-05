import { ApifyClient, actorInput, formatIsraeliDateTime, normalizeItems, signTicket, sourceUrl, verifyTicket } from './apifyBrand.ts';
function assert(value: unknown, message = 'assertion failed'): asserts value { if (!value) throw new Error(message); }
Deno.test('Apify rejects private addresses, credentials and foreign social hosts', () => {
  for (const url of ['http://example.com', 'https://127.0.0.1', 'https://user:pass@example.com', 'https://localhost', 'https://example.com:8080']) {
    let rejected = false; try { sourceUrl(url, 'website'); } catch { rejected = true; } assert(rejected, url);
  }
  let rejected = false; try { sourceUrl('https://instagram.com.evil.com/brand', 'instagram'); } catch { rejected = true; } assert(rejected);
});
Deno.test('Apify actor inputs bound scope and avoid paid video enrichment', () => {
  const website = actorInput('website', 'https://example.com/');
  assert(website.maxCrawlPages === 8 && website.respectRobotsTxtFile === true);
  assert(actorInput('facebook', 'https://facebook.com/brand').captionText === false);
  const instagram = actorInput('instagram', 'https://instagram.com/brand');
  assert(instagram.resultsLimit === 20 && instagram.dataDetailLevel === 'basicData');
});
Deno.test('Apify signed tickets reject tampering, other users and expiry', async () => {
  const ticket = { runId: 'abc123', userId: 'user1', kind: 'website' as const, url: 'https://example.com', expires: Date.now() + 10000 };
  const signed = await signTicket(ticket, 'test-secret');
  assert((await verifyTicket(signed, 'user1', 'test-secret')).runId === ticket.runId);
  for (const [value, user] of [[signed, 'user2'], [signed.slice(0, -3) + 'abc', 'user1'], [await signTicket({ ...ticket, expires: 1 }, 'test-secret'), 'user1']]) {
    let rejected = false; try { await verifyTicket(value, user, 'test-secret'); } catch { rejected = true; } assert(rejected);
  }
});
Deno.test('Apify normalization drops errors, unrelated domains and duplicates; preserves date', () => {
  const content = normalizeItems([
    { url: 'https://www.facebook.com/brand/posts/1', text: 'hello', time: '2026-09-01' },
    { url: 'https://www.facebook.com/brand/posts/1', text: 'hello', time: '2026-09-01' },
    { url: 'https://evil.com', text: 'wrong' }, { error: 'private' }, null,
  ], 'facebook', 'https://facebook.com/brand');
  assert(content.length === 1 && content[0].content.includes(formatIsraeliDateTime('2026-09-01')));
});
Deno.test('Apify dates render in dd/mm/yyyy HH:mm Israel time', () => {
  assert(formatIsraeliDateTime('2026-08-12T17:13:40.000Z') === '12/08/2026 20:13');
});
Deno.test('Apify start -> pending -> successful dataset; no repeated paid start on polling', async () => {
  const calls: string[] = [];
  let polls = 0;
  const mock = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); calls.push(url);
    assert(new Headers(init?.headers).get('Authorization') === 'Bearer fake');
    assert(!url.includes('fake'));
    let body: unknown;
    if (url.includes('/acts/')) { assert(init?.method === 'POST'); body = { data: { id: 'run1' } }; }
    else if (url.includes('/actor-runs/')) body = { data: { status: ++polls === 1 ? 'RUNNING' : 'SUCCEEDED', defaultDatasetId: 'dataset1', usageTotalUsd: 0.02 } };
    else body = [{ url: 'https://example.com/about', title: 'About', markdown: 'Brand content' }];
    return Promise.resolve(new Response(JSON.stringify(body)));
  }) as typeof fetch;
  const client = new ApifyClient('fake', mock);
  const runId = await client.start('website', 'https://example.com');
  const ticket = { runId, kind: 'website' as const, url: 'https://example.com', userId: 'user1', expires: Date.now() + 10000 };
  assert(!(await client.status(ticket)).terminal);
  const result = await client.status(ticket);
  assert(result.terminal && result.content.length === 1 && result.usage_usd === 0.02);
  assert(calls.filter(url => url.includes('/acts/')).length === 1);
});
Deno.test('Apify errors never include provider response secrets', async () => {
  const client = new ApifyClient('secret', (() => Promise.resolve(new Response('secret details', { status: 401 }))) as typeof fetch);
  try { await client.start('website', 'https://example.com'); throw new Error('expected failure'); }
  catch (e) { assert(e instanceof Error && e.message === 'apify_http_401'); }
});
