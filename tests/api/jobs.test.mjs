// the job runner's watchdog (smartsend-webhook ?tick=1&watchdog=1): a job whose step stands still is released, then failed
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { API, makeOrg, dropOrg, insert, select, del } from './lib.mjs';

let A, TICK;
const rest = (path, init = {}) => fetch(`${API}/rest/v1/${path}`, { ...init, headers: { apikey: process.env.SERVICE_ROLE_KEY, authorization: `Bearer ${process.env.SERVICE_ROLE_KEY}`, 'content-type': 'application/json', prefer: 'return=representation', ...(init.headers || {}) } });
const patch = (q, row) => rest(`v2_jobs?${q}`, { method: 'PATCH', body: JSON.stringify(row) });
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
const dog = async () => (await fetch(`${API}/functions/v1/smartsend-webhook?tick=1&watchdog=1`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tick': TICK, apikey: process.env.ANON_KEY, authorization: `Bearer ${process.env.ANON_KEY}` }, body: '{}' })).json();
// a job that waits on an answer that will never come; next_at far ahead so no runner picks it up during the test
const job = async (step, min, unstuck = 0) => {
  const [j] = await insert('v2_jobs', [{ org_id: A.org, kind: 'graphic', src: 'web', step, pend: { t: 999999999 }, next_at: new Date(Date.now() + 3600000).toISOString() }]);
  await patch(`id=eq.${j.id}`, { step_at: ago(min), unstuck });
  return j.id;
};
const row = async (id) => (await select('v2_jobs', `id=eq.${id}`))[0];
const kinds = async (id) => (await select('v2_events', `job_id=eq.${id}&order=id.asc`)).map((e) => e.kind);

before(async () => { A = await makeOrg('wd'); TICK = (await select('v2_secrets', 'k=eq.tick'))[0]?.v || ''; });
after(async () => { await del('v2_jobs', `org_id=eq.${A.org}`); await dropOrg(A); });

test('the watchdog needs the tick secret', async () => {
  const r = await fetch(`${API}/functions/v1/smartsend-webhook?tick=1&watchdog=1`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tick': 'nope', apikey: process.env.ANON_KEY, authorization: `Bearer ${process.env.ANON_KEY}` }, body: '{}' });
  assert.equal(r.status, 403);
});

test('a step inside its time is left alone; one past it is released and runs again', async () => {
  const fresh = await job('texts', 5), old = await job('texts', 14), render = await job('status', 20);
  const r = await dog();
  assert.equal(r.ok, true); assert.ok(r.released >= 1);
  assert.deepEqual((await row(fresh)).pend, { t: 999999999 });
  assert.deepEqual((await row(render)).pend, { t: 999999999 }, 'a render may stand 25 minutes by its own rule');
  const j = await row(old);
  assert.deepEqual(j.pend, {}); assert.equal(j.unstuck, 1); assert.equal(j.state, 'run'); assert.equal(j.tries, 0);
  assert.ok(Date.now() - new Date(j.step_at).getTime() < 60000, 'its clock starts again');
  assert.ok(new Date(j.next_at).getTime() <= Date.now() + 1000, 'runnable now');
  assert.ok((await kinds(old)).includes('job.unstick'));
  // a second round right after does not touch it again
  await dog(); assert.equal((await row(old)).unstuck, 1);
  await patch(`id=eq.${old}`, { state: 'done', step: 'done' });
});

test('after two releases the job fails as stuck, with the reason in the log', async () => {
  const id = await job('design', 14, 2);
  const r = await dog();
  assert.ok(r.failed >= 1);
  const j = await row(id);
  assert.equal(j.state, 'error'); assert.equal(j.error, 'stuck');
  const k = await kinds(id);
  assert.ok(k.includes('job.stuck') && k.includes('job.error'), k.join(','));
});

test('a new step starts the clock and the release count again', async () => {
  const id = await job('texts', 14, 2);
  await patch(`id=eq.${id}`, { step: 'design' });
  const j = await row(id);
  assert.equal(j.unstuck, 0); assert.ok(Date.now() - new Date(j.step_at).getTime() < 60000);
  await dog(); assert.equal((await row(id)).state, 'run');
});
