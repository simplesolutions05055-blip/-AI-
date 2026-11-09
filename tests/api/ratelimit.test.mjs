// sign-in endpoints: a limit per address (they need no token, so this is what stops a flood)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { call, del, randomIp } from './lib.mjs';

const used = [];
after(async () => { for (const ip of used) await del('v2_rate_hits', `key=like.ip:${ip}:*`); });
const ipFor = () => { const ip = randomIp(); used.push(ip); return ip; };
const code = (ip, headers) => call('login.code', { email: `nobody-${ip}@example.test` }, undefined, { ip, headers });

test('login code: 20 an hour per address, the 21st is refused', async () => {
  const ip = ipFor();
  for (let i = 0; i < 20; i++) assert.equal((await code(ip)).status, 200, `request ${i + 1}`);
  const r = await code(ip);
  assert.equal(r.status, 429); assert.equal(r.body.error, 'rate_limited');
  // "send again" (login.link) counts in the same bucket
  assert.equal((await call('login.link', { email: 'x@example.test' }, undefined, { ip })).status, 429);
});

test('another address is not affected', async () => {
  const a = ipFor(), b = ipFor();
  for (let i = 0; i < 21; i++) await code(a);
  assert.equal((await code(b)).status, 200);
});

test('calls through the site proxy get 10x room', async () => {
  const ip = ipFor();
  for (let i = 0; i < 25; i++) assert.equal((await code(ip, { 'x-primeos-via': 'proxy' })).status, 200, `request ${i + 1}`);
});

test('wrong codes: 30 tries per 10 minutes per address', async () => {
  const ip = ipFor();
  for (let i = 0; i < 30; i++) assert.notEqual((await call('login.verify', { email: 'x@example.test', code: '000000' }, undefined, { ip })).status, 429, `try ${i + 1}`);
  assert.equal((await call('login.verify', { email: 'x@example.test', code: '000000' }, undefined, { ip })).status, 429);
});
