import { assertEquals } from 'jsr:@std/assert@1';
import { afterBadAnswer, afterCrash, isQuota, MAX_TRIES } from './jobPolicy.ts';

const NOW = Date.parse('2026-11-05T10:00:00Z');

Deno.test('bad answer: 2 retries 5 s apart, then fail', () => {
  const a = afterBadAnswer(0, NOW);
  assertEquals(a, { retry: true, row: { tries: 1, pend: {}, next_at: '2026-11-05T10:00:05.000Z', lock_until: '2026-11-05T10:00:00.000Z' } });
  assertEquals(afterBadAnswer(1, NOW).retry, true);
  assertEquals(afterBadAnswer(2, NOW), { retry: false });
});
Deno.test('crash: 2 retries 10 s apart, then fail', () => {
  const a = afterCrash(1, NOW);
  assertEquals(a.retry && a.row.tries, 2);
  assertEquals(a.retry && a.row.next_at, '2026-11-05T10:00:10.000Z');
  assertEquals(afterCrash(MAX_TRIES, NOW), { retry: false });
});
Deno.test('no tries recorded counts as 0', () => {
  const a = afterBadAnswer(null, NOW); assertEquals(a.retry && a.row.tries, 1);
  const b = afterCrash(undefined, NOW); assertEquals(b.retry && b.row.tries, 1);
});
Deno.test('retry clears pending requests and frees the lock now', () => {
  const a = afterBadAnswer(0, NOW);
  assertEquals(a.retry && a.row.pend, {});
  assertEquals(a.retry && a.row.lock_until, new Date(NOW).toISOString());
});
Deno.test('quota failures are recognised (never retried)', () => {
  assertEquals(isQuota('quota:{"used":60,"limit":60}'), true);
  assertEquals(isQuota('texts'), false);
  assertEquals(isQuota('provider quota exceeded'), false);
});
