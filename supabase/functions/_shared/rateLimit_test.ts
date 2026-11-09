import { assertEquals } from 'jsr:@std/assert@1';
import { clientIp, limitFor, rateOk } from './rateLimit.ts';

const req = (h: Record<string, string>) => new Request('http://x/', { headers: h });

Deno.test('edge network address wins over anything the client sends', () => {
  assertEquals(clientIp(req({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '9.9.9.9, 2.2.2.2' })), '1.1.1.1');
});
Deno.test('forwarded-for: the proxy-added last entry, not the client-written first', () => {
  assertEquals(clientIp(req({ 'x-forwarded-for': '9.9.9.9, 2.2.2.2' })), '2.2.2.2');
});
Deno.test('no address headers: one shared bucket', () => {
  assertEquals(clientIp(req({})), 'unknown');
});
Deno.test('limiter error lets the call through', async () => {
  const broken = { rpc: () => Promise.resolve({ data: null, error: { message: 'no such function' } }) };
  assertEquals(await rateOk(broken, 'k', 60, 1), true);
  const throws = { rpc: () => Promise.reject(new Error('down')) };
  assertEquals(await rateOk(throws, 'k', 60, 1), true);
});
Deno.test('over the limit says no', async () => {
  const full = { rpc: () => Promise.resolve({ data: false, error: null }) };
  assertEquals(await rateOk(full, 'k', 60, 1), false);
});
Deno.test('proxied calls get 10x room', () => {
  assertEquals(limitFor(req({ 'x-primeos-via': 'proxy' }), 20), 200);
  assertEquals(limitFor(req({}), 20), 20);
});
