import { assertEquals } from 'jsr:@std/assert@1';
import { afterBadAnswer, afterCrash, isQuota, MAX_TRIES, MAX_UNSTICK, renderAgain, stuckLimitMs, stuckNext } from './jobPolicy.ts';

const NOW = Date.parse('2026-11-05T10:00:00Z');
const at = (r: ReturnType<typeof afterBadAnswer>) => (r.retry ? r.row.next_at : null);

Deno.test('bad answer: 3 retries with growing waits (5 s, 30 s, 2 min), then fail', () => {
  const a = afterBadAnswer(0, NOW);
  assertEquals(a, { retry: true, row: { tries: 1, pend: {}, next_at: '2026-11-05T10:00:05.000Z', lock_until: '2026-11-05T10:00:00.000Z' } });
  assertEquals(at(afterBadAnswer(1, NOW)), '2026-11-05T10:00:30.000Z');
  assertEquals(at(afterBadAnswer(2, NOW)), '2026-11-05T10:02:00.000Z');
  assertEquals(afterBadAnswer(3, NOW), { retry: false });
});
Deno.test('crash: 3 retries (10 s, 45 s, 3 min), then fail', () => {
  const a = afterCrash(1, NOW);
  assertEquals(a.retry && a.row.tries, 2);
  assertEquals(at(afterCrash(0, NOW)), '2026-11-05T10:00:10.000Z');
  assertEquals(at(a), '2026-11-05T10:00:45.000Z');
  assertEquals(at(afterCrash(2, NOW)), '2026-11-05T10:03:00.000Z');
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
Deno.test('a failed render starts again once', () => {
  assertEquals(renderAgain(undefined), true); assertEquals(renderAgain(0), true); assertEquals(renderAgain(1), false);
});
Deno.test('watchdog: a step inside its time is left alone; past it, released twice, then failed', () => {
  const ago = (min: number) => new Date(NOW - min * 60000).toISOString();
  assertEquals(stuckNext({ step: 'texts', step_at: ago(11), unstuck: 0 }, NOW), 'ok');
  assertEquals(stuckNext({ step: 'texts', step_at: ago(13), unstuck: 0 }, NOW), 'release');
  assertEquals(stuckNext({ step: 'texts', step_at: ago(13), unstuck: 1 }, NOW), 'release');
  assertEquals(stuckNext({ step: 'texts', step_at: ago(13), unstuck: MAX_UNSTICK }, NOW), 'fail');
  // a render may run 25 minutes by its own rule: the watchdog waits longer than that
  assertEquals(stuckNext({ step: 'status', step_at: ago(26), unstuck: 0 }, NOW), 'ok');
  assertEquals(stuckNext({ step: 'status', step_at: ago(33), unstuck: 0 }, NOW), 'release');
  assertEquals(stuckLimitMs('clips') > 12 * 60000 && stuckLimitMs('prepwait') > 15 * 60000, true);
  // a row without the time (should not happen) is never touched
  assertEquals(stuckNext({ step: 'texts', step_at: null }, NOW), 'ok');
});
