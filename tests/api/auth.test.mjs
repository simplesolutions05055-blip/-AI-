// who can call what: tokens, sessions, expiry, admin vs client
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { call, makeOrg, makeAdmin, dropOrg, insert, del, hex, sha, past, uuid, ADMIN_ACTIONS } from './lib.mjs';

let A, ADM;
before(async () => { A = await makeOrg('auth'); ADM = await makeAdmin(); });
after(async () => { await dropOrg(A); await del('admin_tokens', `admin_id=eq.${ADM.admin}`); await del('admin_users', `id=eq.${ADM.admin}`); });

test('health answers without a token', async () => {
  const r = await call('health');
  assert.equal(r.status, 200); assert.equal(r.body.ok, true);
});

test('no token, unknown token: 401', async () => {
  assert.equal((await call('whoami')).status, 401);
  assert.equal((await call('whoami', {}, hex(32))).status, 401);
});

test('expired session: 401', async () => {
  const t = hex(32);
  await insert('api_tokens', [{ token: t, org_id: A.org, member_id: A.owner, kind: 'session', expires_at: past() }]);
  assert.equal((await call('whoami', {}, t)).status, 401);
});

test('client session opens the app', async () => {
  const r = await call('whoami', {}, A.ownerTok);
  assert.equal(r.status, 200); assert.deepEqual(r.body, { kind: 'client', session: true });
  assert.equal((await call('live.load', {}, A.ownerTok)).status, 200);
});

test('server (internal) token never opens the app', async () => {
  const r = await call('live.load', {}, A.internalTok);
  assert.equal(r.status, 401); assert.equal(r.body.error, 'session_required');
});

test('admin needs a browser session for every admin call', async () => {
  for (const a of ADMIN_ACTIONS) {
    const r = await call(a, {}, ADM.internalTok);
    assert.equal(r.status, 401, `${a} with admin internal token`);
  }
});

test('admin session opens the console', async () => {
  const r = await call('admin.load', {}, ADM.sessionTok);
  assert.equal(r.status, 200);
});

test(`client token reaches none of the ${ADMIN_ACTIONS.length} admin actions`, async () => {
  assert.ok(ADMIN_ACTIONS.length >= 10, 'admin action list parsed from router');
  for (const a of ADMIN_ACTIONS) {
    const r = await call(a, { org_id: A.org, id: A.org }, A.ownerTok);
    assert.notEqual(r.status, 200, `${a} with client session`);
  }
});

test('department user cannot save the whole org state or make invite links', async () => {
  assert.equal((await call('state.save', { data: {} }, A.deptTok)).status, 403);
  assert.equal((await call('members.invite.link', { id: A.owner }, A.deptTok)).status, 403);
});

test('login link: works once, never twice, never after expiry', async () => {
  const raw = hex(36), old = hex(36);
  await insert('v2_login_codes', [
    { email: 'qa', kind: 'client', purpose: 'enter', org_id: A.org, member_id: A.owner, link_hash: sha(raw), expires_at: new Date(Date.now() + 6e5).toISOString() },
    { email: 'qa', kind: 'client', purpose: 'enter', org_id: A.org, member_id: A.owner, link_hash: sha(old), expires_at: past() },
  ]);
  const ok = await call('login.use', { t: raw });
  assert.equal(ok.status, 200); assert.match(ok.body.token, /^[0-9a-f]+$/);
  assert.notEqual((await call('login.use', { t: raw })).status, 200, 'second use');
  assert.notEqual((await call('login.use', { t: old })).status, 200, 'expired link');
});

test('logout ends the session', async () => {
  const t = hex(32);
  await insert('api_tokens', [{ token: t, org_id: A.org, member_id: A.owner, kind: 'session', expires_at: new Date(Date.now() + 864e5).toISOString() }]);
  assert.equal((await call('logout', {}, t)).status, 200);
  assert.equal((await call('whoami', {}, t)).status, 401);
});
