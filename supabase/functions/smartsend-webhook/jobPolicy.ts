// what happens to a job after something goes wrong. one place, so the two paths can't drift apart.
//   a step answers badly (provider error, empty answer): up to 2 more tries, 5 s apart, then the job fails
//   the step itself throws (crash, timeout):           up to 2 more tries, 10 s apart, then the job fails
//   a quota failure ("quota:{...}") is never retried; the person is told when the month opens again
export const MAX_TRIES = 2;
export const STEP_RETRY_S = 5;
export const CRASH_RETRY_S = 10;

export type Next = { retry: true; row: { tries: number; pend: Record<string, never>; next_at: string; lock_until: string } } | { retry: false };

function decide(tries: number | null | undefined, waitS: number, now: number): Next {
  const t = tries ?? 0;
  if (t >= MAX_TRIES) return { retry: false };
  return { retry: true, row: { tries: t + 1, pend: {}, next_at: new Date(now + waitS * 1000).toISOString(), lock_until: new Date(now).toISOString() } };
}
export const afterBadAnswer = (tries: number | null | undefined, now = Date.now()) => decide(tries, STEP_RETRY_S, now);
export const afterCrash = (tries: number | null | undefined, now = Date.now()) => decide(tries, CRASH_RETRY_S, now);
export const isQuota = (why: string) => why.startsWith('quota:');
