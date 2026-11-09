import { assertEquals } from 'jsr:@std/assert@1';
import { probeAllowed } from './probeHosts.ts';

Deno.test('own storage and media hosts are allowed', () => {
  for (const u of ['https://lcbiktjrjcygxbteqaiu.supabase.co/storage/v1/object/public/qa/a.png', 'https://app.primeos.co.il/logo.png', 'https://v3.fal.media/files/x.png', 'https://images.pexels.com/p.jpg']) assertEquals(probeAllowed(u), true, u);
});
Deno.test('other sites, internal addresses and tricks are refused', () => {
  for (const u of ['https://example.com/a.png', 'https://169.254.169.254/latest', 'http://app.primeos.co.il/x', 'https://app.primeos.co.il.evil.com/x', 'https://user@app.primeos.co.il/x', 'https://app.primeos.co.il:8443/x', 'https://evilprimeos.co.il/x', 'https://otherproj.supabase.co/x', 'not a url']) assertEquals(probeAllowed(u), false, u);
});
