// the WhatsApp bot on STAGING in dry mode: messages go in, replies come back in the answer, nothing is sent.
// env: WA_TICK (staging v2_secrets tick), WA_PHONE (a qa user's phone on staging). scripts/test-wa.sh fills both.
// WA_AI=1 when staging has its own AI keys: then the conversation tests run too.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const URL_ = 'https://lcbiktjrjcygxbteqaiu.supabase.co/functions/v1/smartsend-webhook?dry=1';
const TICK = process.env.WA_TICK || '';
const PHONE = process.env.WA_PHONE || '';
if (!TICK || !PHONE) throw new Error('WA_TICK and WA_PHONE needed');
const AI = process.env.WA_AI === '1';
const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let n = 0;

async function send(phone, text, at = `${run}-${n++}`) {
  const r = await fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tick': TICK }, body: JSON.stringify({ phone, message_type: 'text', text, currentDateTime: at }) });
  assert.equal(r.status, 200, `dry call ${r.status}`);
  return (await r.json()).replies ?? [];
}
const TEMP_ERR = /תקלה זמנית/;

test('dry mode needs the tick secret', async () => {
  const r = await fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tick': 'wrong' }, body: '{}' });
  assert.equal(r.status, 403);
});

test('unknown number: told it is not registered, nothing else', async () => {
  const replies = await send('972500' + String(Date.now()).slice(-6), 'שלום');
  assert.equal(replies.length, 1);
  assert.match(replies[0], /לא רשום במערכת/);
});

test('the same message twice is answered once', async () => {
  const at = `${run}-dup`;
  const first = await send(PHONE, 'שלום', at);
  const second = await send(PHONE, 'שלום', at);
  assert.ok(first.length >= 1, 'first one answered');
  assert.deepEqual(second, [], 'duplicate ignored');
});

test('registered user always gets an answer', async () => {
  const replies = await send(PHONE, 'היי');
  assert.ok(replies.length >= 1);
});

test('registered user gets a real answer, not the temporary-error fallback', { skip: !AI && 'staging has no AI keys yet (WA_AI=1 when it does)' }, async () => {
  for (const msg of ['שלום', 'מה מתוזמן החודש?']) {
    const replies = await send(PHONE, msg);
    assert.ok(replies.length >= 1, msg);
    assert.ok(!replies.some((r) => TEMP_ERR.test(r)), `${msg}: ${replies.join(' | ')}`);
  }
});
