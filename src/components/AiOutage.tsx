import { useState } from 'react';
import { AI_OUTAGE_ADMIN_MESSAGE, AI_OUTAGE_USER_MESSAGE, aiErrorLabel, isAiQuotaError } from '@/lib/aiErrors';
import { clearSessionOpenAiKey, getSessionOpenAiKey, setSessionOpenAiKey } from '@/lib/aiSessionKey';
import { invalidateAiStatus, useAiStatus } from '@/lib/useAiStatus';
import { genderCopy } from '@/lib/genderCopy';
import { useProfile } from '@/lib/useProfile';

// Everything a screen needs when the AI provider is out of credit.
//
// The split is always the same and lives only here, so no screen can get it
// wrong: an admin sees the real cause and the one-off-key button; anyone else
// sees "temporary fault, the admins were notified" and nothing to click.
// See docs/ai-outage-handling.md before adding a new AI screen.

function SparkIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M12 3.5l1.6 4.2L18 9.3l-4.4 1.6L12 15.1l-1.6-4.2L6 9.3l4.4-1.6L12 3.5Z" fill="currentColor" />
      <path d="M18.6 13.2l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9.9-2.4Z" fill="currentColor" opacity="0.8" />
    </svg>
  );
}

/**
 * Renders an AI failure. Pass the raw error text — the component decides what
 * this user is allowed to read, and whether the one-off key button belongs.
 */
export function AiErrorNotice({
  error,
  onKeySaved,
  className = '',
}: {
  error: string | null;
  // Called after an admin stores a one-off key, so the caller can retry.
  onKeySaved?: (key: string) => void;
  className?: string;
}) {
  const { profile } = useProfile();
  const isAdmin = profile?.role === 'admin';
  const [keyModalOpen, setKeyModalOpen] = useState(false);
  if (!error) return null;

  const quota = isAiQuotaError(error);
  const message = aiErrorLabel(error, isAdmin);
  // Only an admin can act on an outage, so only an admin is offered the key.
  const showKeyButton = quota && isAdmin;

  return (
    <div
      className={`rounded-lg border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger-fg)] ${className}`}
      role="alert"
    >
      <p>{message}</p>
      {showKeyButton && (
        <button
          type="button"
          onClick={() => setKeyModalOpen(true)}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[var(--danger-fg)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
        >
          <SparkIcon className="h-3.5 w-3.5" />
          {getSessionOpenAiKey()
            ? 'החלפת המפתח החד-פעמי'
            : genderCopy(profile?.gender, {
                male: 'שים מפתח API חד-פעמי',
                female: 'שימי מפתח API חד-פעמי',
                neutral: 'הגדרת מפתח API חד-פעמי',
              })}
        </button>
      )}
      {keyModalOpen && (
        <OneTimeKeyModal
          onClose={() => setKeyModalOpen(false)}
          onSave={(key) => {
            setKeyModalOpen(false);
            onKeySaved?.(key);
          }}
        />
      )}
    </div>
  );
}

/**
 * Page-level banner driven by the server's circuit breaker — shown *before*
 * anyone tries, so nobody waits out a 90-second failure. Renders nothing while
 * the provider is healthy.
 */
export function AiDegradedBanner({ className = '' }: { className?: string }) {
  const { degraded } = useAiStatus();
  const { profile } = useProfile();
  const isAdmin = profile?.role === 'admin';
  if (!degraded) return null;
  return (
    <div
      className={`mb-4 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger-fg)] ${className}`}
      role="status"
    >
      {isAdmin ? AI_OUTAGE_ADMIN_MESSAGE : AI_OUTAGE_USER_MESSAGE}
    </div>
  );
}

/**
 * True when AI actions should be disabled up front. Non-admins are blocked
 * during an outage; an admin keeps the buttons, because a one-off key (a
 * different billing account) still works and is how the fix gets verified.
 */
export function useAiBlocked(): boolean {
  const { degraded } = useAiStatus();
  const { profile } = useProfile();
  return degraded && profile?.role !== 'admin';
}

export function OneTimeKeyModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (key: string) => void;
}) {
  const { profile } = useProfile();
  const [value, setValue] = useState('');
  const hasExisting = !!getSessionOpenAiKey();

  function save() {
    const key = value.trim();
    if (!key) return;
    setSessionOpenAiKey(key);
    // A working one-off key means AI is usable again for this admin — drop the
    // cached degraded flag so the banner does not contradict the screen.
    invalidateAiStatus();
    onSave(key);
  }

  return (
    <div dir="rtl" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 text-right shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-2 text-lg font-bold">מפתח API חד-פעמי</h2>
        <p className="mb-4 text-sm text-[var(--muted)]">
          המפתח נשמר לסשן הדפדפן הזה בלבד ומשמש את ההפקה הנוכחית.{' '}
          {genderCopy(profile?.gender, {
            male: 'כשתסגור את החלון/הדפדפן הוא יימחק',
            female: 'כשתסגרי את החלון/הדפדפן הוא יימחק',
            neutral: 'בסגירת החלון/הדפדפן הוא יימחק',
          })}{' '}
          והמערכת תחזור למפתח הרגיל של הפרויקט. המפתח לא נשמר בשרת.
        </p>
        <input
          autoFocus
          type="password"
          dir="ltr"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
          }}
          placeholder="sk-..."
          className="mb-4 w-full rounded-xl border border-[var(--border)] px-3 py-3 text-left shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15"
        />
        <div className="flex items-center justify-start gap-3">
          <button
            type="button"
            onClick={save}
            disabled={!value.trim()}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] bg-brand px-5 py-3 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:bg-[var(--bg-subtle)] disabled:text-[var(--text-faint)]"
          >
            <SparkIcon className="h-4 w-4" />
            שמירה והפקה
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] border border-[var(--border-warm)] bg-white px-5 py-3 text-sm font-semibold text-[var(--text-strong)] hover:bg-[var(--bg-subtle)]"
          >
            ביטול
          </button>
        </div>
        {hasExisting && (
          <button
            type="button"
            onClick={() => {
              clearSessionOpenAiKey();
              onClose();
            }}
            className="mt-4 text-xs font-semibold text-red-600 hover:underline"
          >
            הסרת המפתח החד-פעמי וחזרה למפתח הפרויקט
          </button>
        )}
      </div>
    </div>
  );
}
