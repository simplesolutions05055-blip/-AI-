// what happens to a job after something goes wrong. one place, so the paths can't drift apart.
//   a step answers badly (provider error, empty answer): up to 3 more tries, 5 s, 30 s and 2 min apart, then the job fails
//   the step itself throws (crash, timeout):           up to 3 more tries, 10 s, 45 s and 3 min apart, then the job fails
//     (a provider that is down for a minute or two no longer ends the production; a real fault still ends it within about 5 minutes)
//   a quota failure ("quota:{...}") is never retried; the person is told when the month opens again
//   a video render that fails or expires in the sandbox is started once more (same output slot, so no second charge of video seconds)
//   a job whose step has not changed for too long (an answer that never arrives, a worker that dies mid-step) is released
//     and its step run again, twice at most, then it fails as 'stuck'
export const MAX_TRIES = 3;
export const STEP_RETRY_S = [5, 30, 120];
export const CRASH_RETRY_S = [10, 45, 180];
export const MAX_RENDER_RETRIES = 1;

export type Next = { retry: true; row: { tries: number; pend: Record<string, never>; next_at: string; lock_until: string } } | { retry: false };

function decide(tries: number | null | undefined, waits: number[], now: number): Next {
  const t = tries ?? 0;
  if (t >= MAX_TRIES) return { retry: false };
  const waitS = waits[Math.min(t, waits.length - 1)];
  return { retry: true, row: { tries: t + 1, pend: {}, next_at: new Date(now + waitS * 1000).toISOString(), lock_until: new Date(now).toISOString() } };
}
export const afterBadAnswer = (tries: number | null | undefined, now = Date.now()) => decide(tries, STEP_RETRY_S, now);
export const afterCrash = (tries: number | null | undefined, now = Date.now()) => decide(tries, CRASH_RETRY_S, now);
export const isQuota = (why: string) => why.startsWith('quota:');

// may this failed render start again? the count lives in the job's data (a step change zeroes `tries`)
export const renderAgain = (done: number | null | undefined) => (done ?? 0) < MAX_RENDER_RETRIES;

// ---- the watchdog: minutes a step may stay unchanged. Each long step has its own limit inside the runner
// (render 25 min, AI clips 12 min, footage preparation 15 min); the watchdog sits above those, for what they cannot see.
export const STUCK_MIN: Record<string, number> = { status: 32, clips: 22, prepwait: 22, start: 15 };
export const STUCK_DEFAULT_MIN = 12;
export const MAX_UNSTICK = 2;
export const stuckLimitMs = (step: string | null | undefined) => (STUCK_MIN[String(step ?? '')] ?? STUCK_DEFAULT_MIN) * 60000;
export type Stuck = 'ok' | 'release' | 'fail';
export function stuckNext(j: { step?: string | null; step_at?: string | null; unstuck?: number | null }, now = Date.now()): Stuck {
  const at = j.step_at ? new Date(j.step_at).getTime() : NaN;
  if (!Number.isFinite(at) || now - at < stuckLimitMs(j.step)) return 'ok';
  return (j.unstuck ?? 0) < MAX_UNSTICK ? 'release' : 'fail';
}
