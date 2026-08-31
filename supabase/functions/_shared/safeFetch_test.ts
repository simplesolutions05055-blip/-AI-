import { assertEquals, assertThrows } from 'jsr:@std/assert@1';
import { assertSafeUrl, BlockedUrlError } from './safeFetch.ts';

Deno.test('allows Smart Send CDN media URLs', () => {
  const url = assertSafeUrl('https://cdn.smartsend.co.il/media/example.jpg');
  assertEquals(url.hostname, 'cdn.smartsend.co.il');
});

Deno.test('still blocks unrelated hosts', () => {
  assertThrows(
    () => assertSafeUrl('https://example.com/media/example.jpg'),
    BlockedUrlError,
    'host not allowlisted',
  );
});
