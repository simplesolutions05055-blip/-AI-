// v2_events: what the triggers and the log write, what the admin reads (admin only, metadata only)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { call, makeOrg, makeAdmin, dropOrg, insert, select, del, hex } from './lib.mjs';

let A, ADM;
const tag = hex(4);
const rest = (path, init = {}) => fetch(`${process.env.API_URL || 'http://127.0.0.1:54321'}/rest/v1/${path}`, { ...init, headers: { apikey: process.env.SERVICE_ROLE_KEY, authorization: `Bearer ${process.env.SERVICE_ROLE_KEY}`, 'content-type': 'application/json', prefer: 'return=representation', ...(init.headers || {}) } });
const patch = (table, q, row) => rest(`${table}?${q}`, { method: 'PATCH', body: JSON.stringify(row) });
const evOf = (job) => select('v2_events', `job_id=eq.${job}&order=id.asc`);

before(async () => { A = await makeOrg('ev'); ADM = await makeAdmin(); });
after(async () => { await dropOrg(A); await del('admin_tokens', `admin_id=eq.${ADM.admin}`); await del('admin_users', `id=eq.${ADM.admin}`); });

test('a job leaves start, step, error, retry, done events with org and durations', async () => {
  const [j] = await insert('v2_jobs', [{ org_id: A.org, kind: 'graphic', step: 'brief', input: { brief: `secret ${tag}` } }]);
  await patch('v2_jobs', `id=eq.${j.id}`, { step: 'texts', updated_at: new Date().toISOString() });
  await patch('v2_jobs', `id=eq.${j.id}`, { state: 'error', error: `boom ${tag}` });
  await patch('v2_jobs', `id=eq.${j.id}`, { state: 'run', error: null });
  await patch('v2_jobs', `id=eq.${j.id}`, { state: 'done', step: 'done' });
  const ev = await evOf(j.id);
  assert.deepEqual(ev.map((e) => e.kind), ['job.start', 'job.step', 'job.error', 'job.retry', 'job.done']);
  assert.ok(ev.every((e) => e.org_id === A.org && e.src === 'job'));
  assert.equal(ev[1].detail.step_from, 'brief'); assert.equal(ev[1].detail.step_to, 'texts');
  assert.ok(Number.isInteger(ev[1].ms));
  assert.equal(ev[2].level, 'error'); assert.equal(ev[2].detail.error, `boom ${tag}`);
  assert.ok(Number.isInteger(ev[4].ms));
  assert.match(ev[0].msg, /גרפיקה/); assert.match(ev[0].msg, /qa-api-ev-/);
  assert.ok(!JSON.stringify(ev).includes(`secret ${tag}`), 'no job input in events');
});

test('lock-only updates write no event', async () => {
  const [j] = await insert('v2_jobs', [{ org_id: A.org, kind: 'doc', step: 'texts' }]);
  await patch('v2_jobs', `id=eq.${j.id}`, { lock_until: new Date(Date.now() + 60000).toISOString() });
  assert.deepEqual((await evOf(j.id)).map((e) => e.kind), ['job.start']);
});

test('events are not readable with the anon key', async () => {
  const r = await fetch(`${process.env.API_URL || 'http://127.0.0.1:54321'}/rest/v1/v2_events?limit=1`, { headers: { apikey: process.env.ANON_KEY, authorization: `Bearer ${process.env.ANON_KEY}` } });
  const body = r.ok ? await r.json() : [];
  assert.equal(body.length, 0);
});

test('whatsapp in/out: event per message, never the text', async () => {
  await insert('v2_wa_msgs', [{ id: `ev-${tag}-1`, phone: '972500000123', org_id: A.org, dir: 'in', body: `hello ${tag}` }, { id: `ev-${tag}-2`, phone: '972500000123', org_id: A.org, dir: 'out', body: `reply ${tag}` }]);
  const ev = await select('v2_events', `org_id=eq.${A.org}&src=eq.wa&order=id.asc`);
  assert.deepEqual(ev.map((e) => e.kind), ['wa.in', 'wa.out']);
  assert.equal(ev[0].detail.phone_tail, '0123');
  assert.ok(!JSON.stringify(ev).includes(tag), 'no message text');
  await del('v2_wa_msgs', `org_id=eq.${A.org}`);
});

test('incident open and close become events, on the production timeline when the incident names a job', async () => {
  const [j] = await insert('v2_jobs', [{ org_id: A.org, kind: 'graphic', step: 'brief' }]);
  const [i] = await insert('v2_incidents', [{ kind: `qa_ev_${tag}`, severity: 'crit', title: `qa ${tag}`, org_id: A.org, detail: { job: j.id } }]);
  await patch('v2_incidents', `id=eq.${i.id}`, { state: 'fixed', closed_by: 'qa' });
  const ev = await select('v2_events', `org_id=eq.${A.org}&src=eq.monitor&order=id.asc`);
  assert.deepEqual(ev.map((e) => [e.kind, e.level, e.job_id]), [['incident.open', 'error', j.id], ['incident.close', 'info', j.id]]);
  assert.equal(ev[0].detail.incident, i.id); assert.equal(ev[1].detail.incident, i.id);
  // a detail.job that is not a UUID is ignored (never breaks the incident row)
  const [k] = await insert('v2_incidents', [{ kind: `qa_ev2_${tag}`, severity: 'mid', title: `qa2 ${tag}`, org_id: A.org, detail: { job: '------------------------------------' } }]);
  const ev2 = await select('v2_events', `org_id=eq.${A.org}&kind=eq.incident.open&order=id.desc&limit=1`);
  assert.deepEqual([ev2[0].detail.incident, ev2[0].job_id, ev2[0].level], [k.id, null, 'warn']);
  await del('v2_incidents', `id=in.(${i.id},${k.id})`);
});

test('error text copied by the triggers is masked like errText (urls, keys, phone numbers)', async () => {
  const raw = `fetch https://x.test/a?key=SECRET failed for 0501234567 on 2026-11-15 token=abc`;
  const [j] = await insert('v2_jobs', [{ org_id: A.org, kind: 'graphic', step: 'brief' }]);
  await patch('v2_jobs', `id=eq.${j.id}`, { state: 'error', error: raw });
  const je = (await evOf(j.id)).find((e) => e.kind === 'job.error');
  assert.equal(je.detail.error, 'fetch https://x.test/a failed for … on 2026-11-15 token=…');
  await insert('v2_client_errors', [{ org_id: A.org, kind: 'client', msg: raw, route: `mask${tag}` }]);
  const [ce] = await select('v2_events', `org_id=eq.${A.org}&kind=eq.client.error&detail->>route=eq.mask${tag}`);
  assert.equal(ce.detail.error, 'fetch https://x.test/a failed for … on 2026-11-15 token=…');
  for (const t of [JSON.stringify(je), JSON.stringify(ce)]) { assert.ok(!t.includes('SECRET')); assert.ok(!t.includes('0501234567')); }
  await del('v2_client_errors', `org_id=eq.${A.org}`);
  await del('v2_events', `id=eq.${ce.id}`);
});

test('browser error and deploy become events', async () => {
  await insert('v2_client_errors', [{ org_id: A.org, kind: 'client', msg: `TypeError ${tag}`, route: 'create', ver: '2.6.0' }]);
  await insert('v2_audit', [{ org_id: A.org, actor_kind: 'ci', action: 'deploy', target: `abc${tag}` }]);
  const ce = await select('v2_events', `org_id=eq.${A.org}&kind=eq.client.error`);
  assert.equal(ce.length, 1); assert.equal(ce[0].level, 'warn'); assert.equal(ce[0].detail.route, 'create');
  const dep = await select('v2_events', `org_id=eq.${A.org}&kind=eq.deploy`);
  assert.equal(dep[0].detail.target, `abc${tag}`);
  await del('v2_client_errors', `org_id=eq.${A.org}`);
});

const ev = (action, body, tok = ADM.sessionTok) => call(action, body, tok);

test('load: newest first, filters, cursor, org names', async () => {
  const [j] = await insert('v2_jobs', [{ org_id: A.org, kind: 'graphic', step: 'brief' }]);
  await patch('v2_jobs', `id=eq.${j.id}`, { state: 'error', error: `load ${tag}` });
  const r = await ev('admin.events.load', { org: A.org, limit: 1 });
  assert.equal(r.status, 200); assert.equal(r.body.events.length, 1);
  assert.equal(r.body.events[0].kind, 'job.error'); assert.match(r.body.events[0].org, /^qa-api-ev-/);
  const r2 = await ev('admin.events.load', { org: A.org, before: r.body.next, limit: 50 });
  assert.ok(r2.body.events.every((e) => e.id < r.body.events[0].id));
  const errs = await ev('admin.events.load', { org: A.org, level: 'error' });
  assert.ok(errs.body.events.length >= 1 && errs.body.events.every((e) => e.level === 'error'));
});

test('timeline: the job without its input, its events in order', async () => {
  const [j] = await insert('v2_jobs', [{ org_id: A.org, kind: 'doc', step: 'brief', input: { brief: `tl ${tag}` } }]);
  await patch('v2_jobs', `id=eq.${j.id}`, { step: 'texts' });
  const r = await ev('admin.job.timeline', { job_id: j.id });
  assert.equal(r.status, 200);
  assert.equal(r.body.job.id, j.id); assert.equal(r.body.job.input, undefined);
  assert.deepEqual(r.body.events.map((e) => e.kind), ['job.start', 'job.step']);
  assert.match(r.body.org, /^qa-api-ev-/);
  assert.ok(!JSON.stringify(r.body).includes(`tl ${tag}`));
  assert.equal((await ev('admin.job.timeline', { job_id: 'nope' })).status, 400);
});

test('client tokens are refused; reading the log is not itself audited', async () => {
  for (const a of ['admin.events.load', 'admin.job.timeline', 'admin.events.stream']) assert.notEqual((await call(a, {}, A.ownerTok)).status, 200, a);
  await ev('admin.events.load', {});
  const aud = await select('v2_audit', `action=like.admin.events*&actor_id=eq.${ADM.admin}`);
  assert.equal(aud.length, 0);
});

test('stream: pushes events after `after`, then ends with the last id', async () => {
  const start = (await ev('admin.events.load', { limit: 1 })).body.events[0]?.id ?? 0;
  const API = process.env.API_URL || 'http://127.0.0.1:54321';
  const res = fetch(`${API}/functions/v1/v2-api`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: process.env.ANON_KEY, authorization: `Bearer ${process.env.ANON_KEY}`, 'x-primeos-token': ADM.sessionTok }, body: JSON.stringify({ action: 'admin.events.stream', payload: { after: start, org: A.org, ms: 4000 } }) });
  await new Promise((r) => setTimeout(r, 1200));
  const [j] = await insert('v2_jobs', [{ org_id: A.org, kind: 'video', step: 'brief' }]);
  const r = await res;
  assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/event-stream/);
  const text = await r.text();
  const evs = text.split('\n\n').filter((b) => b.startsWith('id: ')).map((b) => JSON.parse(b.split('\ndata: ')[1]));
  assert.ok(evs.some((e) => e.job_id === j.id && e.kind === 'job.start'), 'new event pushed');
  assert.ok(evs.every((e) => e.id > start && e.org_id === A.org));
  const end = text.split('\n\n').find((b) => b.startsWith('event: end'));
  assert.equal(JSON.parse(end.split('\ndata: ')[1]).after, evs.at(-1).id);
});

test('event.render: any valid token, org from the token, kind whitelisted', async () => {
  const ok = await call('event.render', { kind: 'render.fail', what: 'video', ms: 1234, error: `upload failed 0501234567 end`, org_id: 'ignored' }, A.ownerTok);
  assert.equal(ok.status, 200);
  const rows = await select('v2_events', `org_id=eq.${A.org}&src=eq.render`);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].kind, rows[0].level, rows[0].ms, rows[0].detail.what], ['render.fail', 'error', 1234, 'video']);
  assert.equal(rows[0].detail.error, 'upload failed … end');
  assert.ok(!rows[0].detail.error.includes('0501234567'));
  assert.equal((await call('event.render', { kind: 'job.done', what: 'video' }, A.ownerTok)).status, 400);
  assert.equal((await call('event.render', { kind: 'render.done', what: 'video' })).status, 401);
});

test('event.render: 30 an hour per browser session, 600 per org for server tokens', async () => {
  const B = await makeOrg('evr');
  try {
    const job = '5f0e1d2c-3b4a-4968-8776-655443322110';
    // a session: 30 of its member's render events in the hour, then dropped
    await insert('v2_events', Array.from({ length: 29 }, () => ({ src: 'render', kind: 'render.start', msg: 'seed', org_id: B.org, detail: { member: B.dept } })));
    const ok = await call('event.render', { kind: 'render.done', what: 'image', job_id: job }, B.deptTok);
    assert.deepEqual([ok.status, ok.body.dropped], [200, undefined]);
    const [last] = await select('v2_events', `org_id=eq.${B.org}&src=eq.render&kind=eq.render.done`);
    assert.deepEqual([last.job_id, last.detail.member], [job, B.dept]);
    const over = await call('event.render', { kind: 'render.done', what: 'image' }, B.deptTok);
    assert.deepEqual([over.status, over.body.dropped], [200, true]);
    // another member's session of the same org has its own 30
    const own = await call('event.render', { kind: 'render.done', what: 'image' }, B.ownerTok);
    assert.deepEqual([own.status, own.body.dropped], [200, undefined]);
    // the internal (server) token of the same org is past 30 org events and still writes: its limit is 600 per org
    const srv = await call('event.render', { kind: 'render.fail', what: 'image' }, B.internalTok);
    assert.deepEqual([srv.status, srv.body.dropped], [200, undefined]);
    assert.equal((await select('v2_events', `org_id=eq.${B.org}&src=eq.render`)).length, 32);
  } finally { await del('v2_events', `org_id=eq.${B.org}`); await dropOrg(B); }
});

test('an admin action lands in the log, the console\'s own reads do not', async () => {
  const mk = (action) => insert('v2_audit', [{ actor_kind: 'admin', action, target: `t-${tag}` }]);
  await mk('admin.sys.load'); await mk('admin.incidents.load'); await mk('admin.org.update');
  const ev = await select('v2_events', `kind=eq.admin.action&detail->>target=eq.t-${tag}&order=id.asc`);
  assert.deepEqual(ev.map((e) => e.detail.action), ['admin.org.update']);
  await del('v2_audit', `target=eq.t-${tag}`);
});

test('alert settings: admin only, phones are checked and normalised, a save leaves the monitor\'s own row alone', async () => {
  for (const a of ['admin.alerts.load', 'admin.alerts.save', 'admin.alerts.test']) for (const tok of [A.ownerTok, A.internalTok]) assert.notEqual((await call(a, { on: true, phones: [] }, tok)).status, 200, a);
  await del('admin_state', 'id=in.(alerts,alerts_state)');
  await insert('admin_state', [{ id: 'alerts_state', data: { last: 77, sent: { 'job:x': new Date().toISOString() } } }]);
  const bad = await call('admin.alerts.save', { on: true, phones: [{ n: 'x', ph: '12345' }] }, ADM.sessionTok);
  assert.equal(bad.status, 400); assert.equal(bad.body.error, 'bad_phone');
  const ok = await call('admin.alerts.save', { on: true, phones: [{ n: ' מאור ', ph: '050-123 4567' }, { n: 'dup', ph: '+972501234567' }] }, ADM.sessionTok);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.phones, [{ n: 'מאור', ph: '972501234567' }]);
  const [row] = await select('admin_state', 'id=eq.alerts_state');
  assert.equal(row.data.last, 77); assert.ok(row.data.sent['job:x']);
  const [set] = await select('admin_state', 'id=eq.alerts');
  assert.deepEqual(Object.keys(set.data).sort(), ['on', 'phones']);
  const off = await call('admin.alerts.save', { on: false, phones: ok.body.phones }, ADM.sessionTok);
  assert.equal(off.body.on, false);
  await del('admin_state', 'id=in.(alerts,alerts_state)');
});
