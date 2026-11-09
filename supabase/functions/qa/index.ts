// Test helper for the automated browser tests (Playwright). Runs ONLY in the staging copy of the backend:
// on the live project every call answers 404, whatever is sent.
//   POST { action:'login', who:'manager'|'dept'|'solo'|'admin' } -> { lc }   one-time entry link for a test user
//   POST { action:'code', who:'manager'|'dept'|'solo' }          -> { email, code } a 6-digit login code, as if e-mailed
//   POST { action:'incident' }                                     -> { id }   an open "stuck jobs" incident for the admin fix test
//   POST { action:'jobs', who, since }                             -> { jobs } the test organisation's latest production jobs
//   POST { action:'report', run }                                  -> { ok }   a test run's summary, kept in qa_runs
//   POST { action:'runs' }                                         -> { runs } the last runs
// Only the made-up qa organisations can be entered; nothing here touches a real account.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPA = Deno.env.get('SUPABASE_URL') ?? '';
const IS_STAGING = !!SUPA && !SUPA.includes('tgropjisnheppsxejfdn');
const db = () => createClient(SUPA, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } });
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const hex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, '0')).join('');

// the test users (seeded in staging, see claude/staging-environment.md)
const WHO: Record<string, Record<string, string>> = {
  manager: { kind: 'client', org_id: 'c0000000-0000-4000-8000-000000000001', member_id: 'd0000000-0000-4000-8000-000000000001' },
  dept: { kind: 'client', org_id: 'c0000000-0000-4000-8000-000000000001', member_id: 'd0000000-0000-4000-8000-000000000002' },
  solo: { kind: 'client', org_id: 'c0000000-0000-4000-8000-000000000002', member_id: 'd0000000-0000-4000-8000-000000000003' },
  admin: { kind: 'admin', admin_id: '5f21f18e-3f7d-4438-9305-2a434ec2435b', email: 'simple.solutions05055@gmail.com' },
};

Deno.serve(async (req) => {
  if (!IS_STAGING || req.method !== 'POST') return json({ error: 'not_found' }, 404);
  let p: Record<string, any> = {};
  try { p = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const d = db();
  if (p.action === 'login') {
    const w = WHO[String(p.who)];
    if (!w) return json({ error: 'unknown_user' }, 400);
    const raw = hex(36);
    const row = { email: w.email ?? 'qa', kind: w.kind, purpose: w.kind === 'admin' ? 'direct' : 'enter', org_id: w.org_id ?? null, member_id: w.member_id ?? null, admin_id: w.admin_id ?? null, link_hash: await sha(raw), expires_at: new Date(Date.now() + 10 * 60000).toISOString() };
    const { error } = await d.from('v2_login_codes').insert(row);
    if (error) return json({ error: error.message }, 500);
    return json({ lc: raw });
  }
  // the code the login e-mail would carry (staging sends no mail): the browser test types it into the real login screen
  if (p.action === 'code') {
    const w = WHO[String(p.who)];
    if (!w || w.kind !== 'client') return json({ error: 'unknown_user' }, 400);
    const { data: m } = await d.from('org_members').select('email').eq('id', w.member_id).eq('org_id', w.org_id).maybeSingle();
    const email = String(m?.email ?? '').trim().toLowerCase();
    if (!email.endsWith('@primeos.test')) return json({ error: 'not_a_test_user' }, 400);
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
    const { error } = await d.from('v2_login_codes').insert({ email, kind: 'client', purpose: 'code', code_hash: await sha(email + ':' + code), org_id: w.org_id, member_id: w.member_id, expires_at: new Date(Date.now() + 10 * 60000).toISOString() });
    if (error) return json({ error: error.message }, 500);
    return json({ email, code });
  }
  // an open incident whose fix is harmless on staging (frees stuck job locks, runs the queue). marked qa so reset closes leftovers
  if (p.action === 'incident') {
    const { data, error } = await d.from('v2_incidents').insert({ kind: 'stuck', severity: 'mid', title: 'qa: עבודות תקועות (בדיקה)', detail: { qa: true } }).select('id').single();
    return error ? json({ error: error.message }, 500) : json({ id: data.id });
  }
  // what the server made for a test organisation (the browser test waits on the real job, not on screen text)
  if (p.action === 'jobs') {
    const w = WHO[String(p.who)];
    if (!w || w.kind !== 'client') return json({ error: 'unknown_user' }, 400);
    let q = d.from('v2_jobs').select('id,kind,step,state,error,result,created_at').eq('org_id', w.org_id).order('created_at', { ascending: false }).limit(10);
    if (p.since) q = q.gte('created_at', String(p.since));
    const { data, error } = await q;
    return error ? json({ error: error.message }, 500) : json({ jobs: data ?? [] });
  }
  if (p.action === 'report') {
    const r = p.run ?? {};
    const { error } = await d.from('qa_runs').insert({
      sha: String(r.sha ?? '').slice(0, 40), passed: +r.passed || 0, failed: +r.failed || 0, flaky: +r.flaky || 0, skipped: +r.skipped || 0,
      ms: +r.ms || 0, failures: Array.isArray(r.failures) ? r.failures.slice(0, 50) : [], shots: Array.isArray(r.shots) ? r.shots.slice(0, 200) : [], url: String(r.url ?? '').slice(0, 300),
    });
    return error ? json({ error: error.message }, 500) : json({ ok: true });
  }
  // a screenshot of a test run (for the owner's review), kept in the public qa bucket
  if (p.action === 'shot') {
    const path = String(p.path ?? '');
    if (!/^runs\/[\w.-]{1,60}\/[\w.-]{1,120}\.png$/.test(path)) return json({ error: 'bad_path' }, 400);
    const bytes = Uint8Array.from(atob(String(p.b64 ?? '')), (c) => c.charCodeAt(0));
    if (bytes.length < 100 || bytes.length > 8_000_000) return json({ error: 'bad_size' }, 400);
    const up = await d.storage.from('qa').upload(path, bytes, { contentType: 'image/png', upsert: true });
    if (up.error) return json({ error: up.error.message }, 500);
    return json({ url: d.storage.from('qa').getPublicUrl(path).data.publicUrl });
  }
  // back to the known starting point before a run: the saved state of each test organisation, no leftover items or jobs
  if (p.action === 'reset') {
    const { data: fx } = await d.from('qa_fixtures').select('org_id,data');
    for (const f of fx ?? []) {
      await d.from('org_state').upsert({ org_id: f.org_id, data: f.data, updated_at: new Date().toISOString() });
      await d.from('content_items').delete().eq('org_id', f.org_id);
      await d.from('v2_jobs').delete().eq('org_id', f.org_id);
      // AI runs log real usage; it feeds the console's money screens, so the pictures would change after every AI run
      await d.from('v2_usage').delete().eq('org_id', f.org_id);
    }
    await d.from('v2_incidents').update({ state: 'resolved', closed_at: new Date().toISOString(), closed_by: 'qa' }).eq('state', 'open').eq('detail->>qa', 'true');
    return json({ ok: true, orgs: (fx ?? []).length });
  }
  if (p.action === 'runs') {
    const { data } = await d.from('qa_runs').select('*').order('at', { ascending: false }).limit(10);
    return json({ runs: data ?? [] });
  }
  return json({ error: 'unknown_action' }, 400);
});
