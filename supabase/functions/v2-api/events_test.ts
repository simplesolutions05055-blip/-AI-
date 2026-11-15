import { assertEquals } from 'jsr:@std/assert@1';
import { renderLimit } from './events.ts';

Deno.test('renderLimit: 30 an hour per member for a browser session, 600 per org for server tokens', () => {
  assertEquals(renderLimit({ memberId: 'm', session: true }), { member: 'm', max: 30 });
  assertEquals(renderLimit({ memberId: 'm', session: false }), { member: null, max: 600 });
  assertEquals(renderLimit({ session: true }), { member: null, max: 30 }); // an admin session: no member, still a browser
  assertEquals(renderLimit({}), { member: null, max: 600 });
});
