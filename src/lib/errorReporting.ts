// Client-side error reporting.
//
// Errors thrown in a browser land in the console OF THE USER'S MACHINE — a
// place you will never look. This ships them to the same `logs` table the
// server already writes to, so /admin/errors shows the whole picture.
//
// The reporting path is deliberately defensive: it must never throw, never
// block a render, and never turn one broken component into a request storm.

const ENDPOINT = 'client-error';

// A render loop can throw the same error hundreds of times a second. Both
// guards below exist so the reporter cannot become the outage.
const RATE_LIMIT_PER_MINUTE = 20;
const DEDUPE_WINDOW_MS = 60_000;

const seen = new Map<string, number>();
let windowStartedAt = 0;
let sentInWindow = 0;

export type Severity = 'error' | 'warning';

function fingerprint(action: string, message: string): string {
  return `${action}::${message.slice(0, 200)}`;
}

function allowSend(key: string): boolean {
  const now = Date.now();

  if (now - windowStartedAt > 60_000) {
    windowStartedAt = now;
    sentInWindow = 0;
  }
  if (sentInWindow >= RATE_LIMIT_PER_MINUTE) return false;

  const last = seen.get(key);
  if (last && now - last < DEDUPE_WINDOW_MS) return false;

  seen.set(key, now);
  sentInWindow += 1;
  // Bound the map so a page open for days cannot grow it without limit.
  if (seen.size > 200) {
    for (const [k, t] of seen) if (now - t > DEDUPE_WINDOW_MS) seen.delete(k);
  }
  return true;
}

function describe(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) {
    return { message: error.message || error.name, stack: error.stack ?? null };
  }
  if (typeof error === 'string') return { message: error, stack: null };
  try {
    return { message: JSON.stringify(error).slice(0, 500), stack: null };
  } catch {
    return { message: String(error), stack: null };
  }
}

/**
 * Report a client-side failure. Fire-and-forget by design — callers `void` it.
 *
 * `critical` marks the cases where the user is staring at something broken
 * right now (a render crash). A transient fetch rejection is NOT critical; if
 * every dropped request paged someone, the alerts would be ignored within a day.
 */
export async function logError(action: string, error: unknown, critical = false): Promise<void> {
  try {
    const { message, stack } = describe(error);
    if (!allowSend(fingerprint(action, message))) return;

    const { createSupabaseBrowserClient } = await import('@/lib/supabase/client');
    const db = createSupabaseBrowserClient();

    await db.functions.invoke(ENDPOINT, {
      body: {
        action,
        message,
        critical,
        metadata: {
          stack,
          url: window.location.href,
          user_agent: navigator.userAgent,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          at: new Date().toISOString(),
        },
      },
    });
  } catch (reportingFailure) {
    // Reporting is best-effort: a failure here must not replace the original
    // error, and must not bubble into the app.
    console.error('[errorReporting] failed to report', reportingFailure);
  }
}

let installed = false;

/**
 * Catches what an ErrorBoundary structurally cannot: rejected promises and
 * errors thrown from event handlers, timers and async callbacks. Boundaries
 * only see errors raised during render.
 */
export function installGlobalErrorHandlers(): void {
  if (installed) return;
  installed = true;

  window.addEventListener('unhandledrejection', (event) => {
    console.error('[unhandledrejection]', event.reason);
    void logError('unhandled_promise_rejection', event.reason);
  });

  window.addEventListener('error', (event) => {
    // Resource load failures (a broken <img>) also fire here with no `error`
    // object — they are noise, not application faults.
    if (!event.error && !event.message) return;
    console.error('[uncaught_error]', event.error ?? event.message);
    void logError('uncaught_error', event.error ?? event.message);
  });
}
