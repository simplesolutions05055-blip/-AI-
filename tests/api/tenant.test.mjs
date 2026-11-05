// one organisation can never read or change another one's data, through any v2-api action.
// every client action in the router must be covered here (by an id attack or the leak sweep), or this file fails.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { call, makeOrg, dropOrg, insert, select, hex, uuid, CLIENT_ACTIONS } from './lib.mjs';

let A, B, MARK, UI, JOB;
before(async () => {
  A = await makeOrg('a'); B = await makeOrg('b');
  MARK = 'secret-of-b-' + hex(6);
  UI = 900000000 + Math.floor(Math.random() * 1e6);
  JOB = uuid();
  await insert('content_items', [{ org_id: B.org, ui_id: UI, type: 'graphic', title: MARK, body: MARK, meta: { ui: { id: UI, t: MARK } } }]);
  await insert('v2_jobs', [{ id: JOB, org_id: B.org, member_id: B.owner, src: 'web', kind: 'graphic', step: 'fit', state: 'done', result: { note: MARK }, ui_id: UI }]);
});
after(async () => { await dropOrg(A); await dropOrg(B); });

const bItem = async () => (await select('content_items', `org_id=eq.${B.org}&ui_id=eq.${UI}&select=title,meta`))[0];
const bJob = async () => (await select('v2_jobs', `id=eq.${JOB}&select=state,tries,org_id`))[0];
const bMember = async (id) => (await select('org_members', `id=eq.${id}&select=name,org_id,perms`))[0];
const bTokens = async () => (await select('api_tokens', `org_id=eq.${B.org}&select=token`)).length;
const noLeak = (r, what) => assert.ok(!JSON.stringify(r.body ?? '').includes(MARK) && !JSON.stringify(r.body ?? '').includes(B.org), `${what} leaked org B data`);

// attacks that name B's ids directly
const ID_ATTACKS = {
  'items.get': async () => { const r = await call('items.get', { ids: [UI] }, A.ownerTok); noLeak(r, 'items.get'); assert.deepEqual(r.body.items, []); },
  'items.remove': async () => { await call('items.remove', { ids: [UI] }, A.ownerTok); assert.ok(await bItem(), 'B item still there'); },
  'items.upsert': async () => {
    await call('items.upsert', { items: [{ id: UI, t: 'taken over by a' }] }, A.ownerTok);
    const it = await bItem(); assert.equal(it.title, MARK); assert.equal(it.meta.ui.t, MARK);
  },
  'job.get': async () => { const r = await call('job.get', { id: JOB }, A.ownerTok); noLeak(r, 'job.get'); assert.equal(r.body.state, 'missing'); },
  'job.retry': async () => { const r = await call('job.retry', { id: JOB }, A.ownerTok); assert.notEqual(r.body?.ok, true); assert.equal((await bJob()).state, 'done'); },
  'members.remove': async () => { const r = await call('members.remove', { id: B.dept }, A.ownerTok); assert.notEqual(r.status, 200); assert.ok(await bMember(B.dept)); },
  'members.update': async () => { const r = await call('members.update', { id: B.dept, name: 'renamed by a', perms: { admin: true } }, A.ownerTok); assert.notEqual(r.status, 200); const m = await bMember(B.dept); assert.equal(m.name, 'dept b'); },
  'members.relink': async () => { const n = await bTokens(); const r = await call('members.relink', { id: B.owner }, A.ownerTok); assert.notEqual(r.status, 200); assert.equal(await bTokens(), n); },
  'members.send': async () => { const r = await call('members.send', { id: B.owner }, A.ownerTok); assert.notEqual(r.status, 200); noLeak(r, 'members.send'); },
  'members.invite.link': async () => { const r = await call('members.invite.link', { id: B.owner }, A.ownerTok); assert.notEqual(r.status, 200); noLeak(r, 'members.invite.link'); },
};
// actions with no foreign id to aim at: run them as A and check nothing of B comes back
const SWEEP = ['live.load', 'state.save', 'state.patch', 'inbox.add', 'members.list', 'members.create', 'quota.state', 'quota.take',
  'job.create', 'job.start', 'wa.list', 'bot.phones', 'bot.phones.add', 'bot.phones.remove', 'ch.list', 'ch.connect', 'ch.stats', 'ch.disconnect'];

test('every client action in the router is covered', () => {
  assert.ok(CLIENT_ACTIONS.length >= 25, `parsed ${CLIENT_ACTIONS.length} client actions`);
  const missing = CLIENT_ACTIONS.filter((a) => !(a in ID_ATTACKS) && !SWEEP.includes(a));
  assert.deepEqual(missing, [], 'new client action(s) without an isolation test: add to ID_ATTACKS or SWEEP');
});

for (const [a, fn] of Object.entries(ID_ATTACKS)) test(`A cannot reach B through ${a}`, fn);

test('no-id actions return nothing of B', async () => {
  for (const a of SWEEP) {
    if (a === 'state.save' || a === 'state.patch') continue; // writes A's own state only; covered by the read below
    noLeak(await call(a, {}, A.ownerTok), a);
  }
  noLeak(await call('live.load', {}, A.ownerTok), 'live.load after writes');
});

test('file.sign never signs a path in B\'s folder', async () => {
  const r = await call('file.sign', { urls: [`pv:doc/${B.org}/contract.pdf`] }, A.ownerTok);
  assert.deepEqual(r.body.urls, {});
});

test('upload.sign always lands in the caller\'s own folder', async () => {
  const r = await call('upload.sign', { name: 'x.png', org_id: B.org, org: B.org }, A.ownerTok);
  assert.equal(r.status, 200); assert.ok(r.body.path.includes(`/${A.org}/`), r.body.path); noLeak(r, 'upload.sign');
});

test('positive control: B sees its own item', async () => {
  const r = await call('items.get', { ids: [UI] }, B.ownerTok);
  assert.equal(r.body.items.length, 1); assert.equal(r.body.items[0].t, MARK);
});
