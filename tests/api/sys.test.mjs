// System screen data (admin.sys.load): admin only, every tab answers, numbers come from the tables
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { call, makeOrg, makeAdmin, dropOrg, insert, del, hex } from './lib.mjs';

let A, ADM;
const tag = hex(4);
before(async () => {
  A = await makeOrg('sys'); ADM = await makeAdmin();
  const old = new Date(Date.now() - 30 * 60000).toISOString();
  await insert('v2_jobs', [
    { org_id: A.org, kind: 'graphic', step: 'done', state: 'done', error: null, next_at: new Date().toISOString() },
    { org_id: A.org, kind: 'graphic', step: 'texts', state: 'error', error: `qa boom ${tag}`, next_at: new Date().toISOString() },
    { org_id: A.org, kind: 'doc', step: 'texts', state: 'run', error: null, next_at: old },
  ]);
  await insert('v2_usage', [{ org_id: A.org, kind: 'graphic', cin: 1000, cout: 500, img_med: 2 }]);
  await insert('v2_wa_msgs', [{ id: `qa-${tag}-1`, phone: '000', org_id: A.org, dir: 'in' }, { id: `qa-${tag}-2`, phone: '000', org_id: A.org, dir: 'out' }]);
  await insert('v2_audit', [{ org_id: A.org, actor_kind: 'ci', action: 'deploy', target: `abc${tag} by qa` }]);
});
after(async () => {
  await del('v2_usage', `org_id=eq.${A.org}`); await del('v2_wa_msgs', `org_id=eq.${A.org}`);
  await dropOrg(A); await del('admin_tokens', `admin_id=eq.${ADM.admin}`); await del('admin_users', `id=eq.${ADM.admin}`);
});
const sys = (tab, tok = ADM.sessionTok) => call('admin.sys.load', { tab }, tok);

test('every tab answers for an admin', async () => {
  for (const tab of ['overview', 'jobs', 'wa', 'costs', 'deploys']) {
    const r = await sys(tab);
    assert.equal(r.status, 200, tab); assert.equal(r.body.ok, true); assert.equal(r.body.tab ?? 'deploys', tab);
  }
});
test('unknown tab is refused', async () => {
  const r = await sys('secrets');
  assert.notEqual(r.status, 200); assert.equal(r.body.error, 'bad_tab');
});
test('client manager is refused', async () => {
  assert.notEqual((await sys('overview', A.ownerTok)).status, 200);
});
test('jobs: counted per kind, failure and stuck job listed with org name', async () => {
  const b = (await sys('jobs')).body;
  assert.ok(b.byKind.graphic.error >= 1 && b.byKind.graphic.done >= 1);
  const e = b.errors.find((j) => j.error === `qa boom ${tag}`);
  assert.ok(e, 'error job listed'); assert.match(e.org, /^qa-api-sys-/);
  assert.ok(b.stuck.some((j) => j.kind === 'doc' && /^qa-api-sys-/.test(j.org)), 'stuck job listed');
});
test('costs: raw units per org (console prices them)', async () => {
  const row = (await sys('costs')).body.perOrg.find((o) => /^qa-api-sys-/.test(o.org));
  assert.ok(row); assert.equal(row.use.cin, 1000); assert.equal(row.use.img_med, 2);
});
test('whatsapp: in and out per org', async () => {
  const row = (await sys('wa')).body.perOrg.find((o) => /^qa-api-sys-/.test(o.org));
  assert.deepEqual({ in: row.in, out: row.out }, { in: 1, out: 1 });
});
test('deploys and overview show the last deploy', async () => {
  assert.ok((await sys('deploys')).body.deploys.some((x) => x.target === `abc${tag} by qa`));
  const o = (await sys('overview')).body;
  assert.ok(o.lastDeploy); assert.ok(o.jobs24.error >= 1);
});
