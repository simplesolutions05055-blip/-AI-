import { assertEquals } from 'jsr:@std/assert@1';
import { bypassHeaders } from './vercelBypass.ts';

Deno.test('bypass key goes to the staging site', () => {
  assertEquals(bypassHeaders('https://primeos-staging.vercel.app/api/render', 'k'), { 'x-vercel-protection-bypass': 'k' });
});
Deno.test('no key set (prod): no header', () => {
  assertEquals(bypassHeaders('https://primeos-staging.vercel.app/api/render', ''), {});
});
Deno.test('never sent to another host', () => {
  assertEquals(bypassHeaders('https://app.primeos.co.il/api/render', 'k'), {});
  assertEquals(bypassHeaders('https://primeos-staging.vercel.app.evil.com/x', 'k'), {});
  assertEquals(bypassHeaders('not a url', 'k'), {});
});
