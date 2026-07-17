import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Share2 } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { usePromptDismissal } from '@/lib/usePromptDismissal';

const DAY_MS = 24 * 60 * 60 * 1000;
// First close snoozes a day, the second a few days, the third silences it.
const SNOOZE_STEPS = [DAY_MS, 4 * DAY_MS];

export default function SocialConnectPrompt({ userId }: { userId: string }) {
  const { pathname } = useLocation();
  const [connected, setConnected] = useState<boolean | null>(null);
  const { suppressed, dismiss, markShown } = usePromptDismissal(userId, 'social_connect', SNOOZE_STEPS);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const client = createSupabaseBrowserClient();
        const { data } = await client.auth.getSession();
        if (!data.session) return;
        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-meta-connections`, {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
        });
        if (!response.ok || !active) return;
        const payload = (await response.json()) as { connected?: boolean };
        if (active) setConnected(Boolean(payload.connected));
      } catch {
        // A failed check stays silent — never nag on a network hiccup.
      }
    })();

    return () => {
      active = false;
    };
  }, [userId]);

  // Not on the connection page itself: the user is already there.
  const visible = connected === false && !suppressed && !pathname.startsWith('/admin/meta-connection');

  useEffect(() => {
    if (visible) markShown();
  }, [visible, markShown]);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="social-connect-title"
      dir="rtl"
    >
      <button type="button" className="absolute inset-0 h-full w-full cursor-default" aria-label="סגירה" onClick={dismiss} />
      <section className="relative w-full max-w-md rounded-2xl border border-[var(--border)] bg-white p-5 text-right shadow-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[var(--warm-accent-soft)] text-[var(--warm-accent-dark)]">
              <Share2 className="h-5 w-5" />
            </span>
            <h2 id="social-connect-title" className="text-lg font-bold text-[var(--text)]">
              עוד לא חיברתם רשתות חברתיות
            </h2>
          </div>
          <button onClick={dismiss} className="shrink-0 rounded-lg px-2 text-xl leading-none text-[var(--muted)]" aria-label="סגירה">
            ×
          </button>
        </div>

        <p className="text-sm leading-6 text-[var(--text)]">
          כדי לתזמן פוסטים ולפרסם אותם אוטומטית לפייסבוק ולאינסטגרם, צריך לחבר את המותג לחשבון הרשתות החברתיות. בלי החיבור אפשר
          ליצור תוצרים, אבל אי אפשר לתזמן פרסום.
        </p>

        <div className="mt-5 flex flex-row gap-2">
          <Link
            to="/admin/meta-connection"
            onClick={dismiss}
            className="flex-1 rounded-lg bg-brand px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-brand-dark"
          >
            חיבור רשתות חברתיות
          </Link>
          <button
            onClick={dismiss}
            className="flex-1 rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] hover:bg-gray-50"
          >
            לא עכשיו
          </button>
        </div>
      </section>
    </div>
  );
}
