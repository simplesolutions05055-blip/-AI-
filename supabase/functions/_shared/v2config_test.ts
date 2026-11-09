import { assertEquals } from 'jsr:@std/assert@1';
import { allowOrigin, CLAUDE_MODELS, ORIGINS } from './v2config.ts';

Deno.test('known site gets its own origin back', () => {
  for (const o of ORIGINS) assertEquals(allowOrigin(o), o);
});
Deno.test('unknown site gets the live site (browser blocks it)', () => {
  assertEquals(allowOrigin('https://evil.example'), 'https://app.primeos.co.il');
  assertEquals(allowOrigin(''), 'https://app.primeos.co.il');
});
Deno.test('models: newest first, never empty', () => {
  assertEquals(CLAUDE_MODELS[0], 'claude-sonnet-5-5');
});
