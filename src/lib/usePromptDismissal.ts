import { useCallback, useEffect, useRef, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

type DismissalRow = {
  dismiss_count: number;
  dismissed_until: string | null;
  permanently_dismissed: boolean;
};

/**
 * Per-user dismissal cadence for a one-off prompt, persisted in
 * public.pwa_install_prompt_dismissals so it follows the user across devices.
 * The table is keyed by prompt_key and holds every UI prompt, not just the PWA
 * one it was first built for.
 *
 * `delaysMs` is the snooze after each close: the n-th close snoozes for
 * delaysMs[n-1], and the close past the end of the list silences the prompt for
 * good.
 */
export function usePromptDismissal(userId: string | null, promptKey: string, delaysMs: number[]) {
  const [row, setRow] = useState<DismissalRow | null>(null);
  const [loaded, setLoaded] = useState(false);
  const shownLoggedRef = useRef(false);

  useEffect(() => {
    setLoaded(false);
    setRow(null);
    shownLoggedRef.current = false;
    if (!userId) return;
    let active = true;

    createSupabaseBrowserClient()
      .from('pwa_install_prompt_dismissals')
      .select('dismiss_count, dismissed_until, permanently_dismissed')
      .eq('user_id', userId)
      .eq('prompt_key', promptKey)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        setRow((data as DismissalRow | null) ?? null);
        setLoaded(true);
      });

    return () => {
      active = false;
    };
  }, [userId, promptKey]);

  // Unknown state counts as suppressed so the modal never flashes before the
  // stored cadence has loaded.
  const suppressed =
    !loaded ||
    !!row?.permanently_dismissed ||
    (!!row?.dismissed_until && new Date(row.dismissed_until).getTime() > Date.now());

  const markShown = useCallback(() => {
    if (!userId || shownLoggedRef.current) return;
    shownLoggedRef.current = true;
    createSupabaseBrowserClient()
      .from('pwa_install_prompt_dismissals')
      .upsert(
        { user_id: userId, prompt_key: promptKey, last_shown_at: new Date().toISOString() } as never,
        { onConflict: 'user_id,prompt_key' },
      )
      .then(({ error }) => {
        if (error) shownLoggedRef.current = false;
      });
  }, [userId, promptKey]);

  const dismiss = useCallback(async () => {
    if (!userId) return;
    const now = new Date();
    const count = (row?.dismiss_count ?? 0) + 1;
    const delay = delaysMs[count - 1];
    const next: DismissalRow = {
      dismiss_count: count,
      dismissed_until: delay === undefined ? null : new Date(now.getTime() + delay).toISOString(),
      permanently_dismissed: delay === undefined,
    };

    setRow(next);
    await createSupabaseBrowserClient()
      .from('pwa_install_prompt_dismissals')
      .upsert(
        { user_id: userId, prompt_key: promptKey, ...next, last_dismissed_at: now.toISOString() } as never,
        { onConflict: 'user_id,prompt_key' },
      );
  }, [userId, promptKey, row, delaysMs]);

  return { suppressed, dismiss, markShown };
}
