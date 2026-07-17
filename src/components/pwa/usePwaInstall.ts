import { useEffect, useMemo, useRef, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

type DismissalRow = {
  dismiss_count: number;
  dismissed_until: string | null;
  permanently_dismissed: boolean;
};

const PROMPT_KEY = 'pwa_install';
const DISMISS_AT_KEY = 'pwa_install_dismissed_at';
const DISMISS_COUNT_KEY = 'pwa_install_dismiss_count';
const PERMANENT_KEY = 'pwa_install_dismissed_permanent';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function isIos() {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function addMs(date: Date, ms: number) {
  return new Date(date.getTime() + ms).toISOString();
}

function isDismissedByRow(row: DismissalRow | null) {
  if (!row) return false;
  if (row.permanently_dismissed) return true;
  if (!row.dismissed_until) return false;
  return new Date(row.dismissed_until).getTime() > Date.now();
}

function isDismissedByLocalStorage() {
  if (window.localStorage.getItem(PERMANENT_KEY) === '1') return true;
  const dismissedAt = Number(window.localStorage.getItem(DISMISS_AT_KEY) ?? 0);
  if (!dismissedAt) return false;
  return Date.now() - dismissedAt <= WEEK_MS;
}

function persistLocalDismissal(permanent: boolean) {
  if (permanent) {
    window.localStorage.setItem(PERMANENT_KEY, '1');
    return;
  }
  const count = Number(window.localStorage.getItem(DISMISS_COUNT_KEY) ?? 0) + 1;
  window.localStorage.setItem(DISMISS_COUNT_KEY, String(count));
  if (count >= 2) window.localStorage.setItem(PERMANENT_KEY, '1');
  window.localStorage.setItem(DISMISS_AT_KEY, String(Date.now()));
}

export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone);
  const [dismissal, setDismissal] = useState<DismissalRow | null>(null);
  const [localDismissed, setLocalDismissed] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [dismissalLoaded, setDismissalLoaded] = useState(false);
  const shownLoggedRef = useRef(false);
  const ios = useMemo(isIos, []);

  useEffect(() => {
    const db = createSupabaseBrowserClient();
    let active = true;

    db.auth.getUser().then(({ data }) => {
      if (!active) return;
      setUserId(data.user?.id ?? null);
      if (!data.user) setDismissalLoaded(true);
    });

    const { data: listener } = db.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null);
      if (!session?.user) {
        setDismissal(null);
        setDismissalLoaded(true);
      }
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    setLocalDismissed(isDismissedByLocalStorage());
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setLocalDismissed(isDismissedByLocalStorage());
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
      window.localStorage.setItem(PERMANENT_KEY, '1');
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    setDismissalLoaded(false);

    createSupabaseBrowserClient()
      .from('pwa_install_prompt_dismissals')
      .select('dismiss_count, dismissed_until, permanently_dismissed')
      .eq('user_id', userId)
      .eq('prompt_key', PROMPT_KEY)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        setDismissal((data as DismissalRow | null) ?? null);
        setDismissalLoaded(true);
      });

    return () => {
      active = false;
    };
  }, [userId]);

  const dismissed = !dismissalLoaded || isDismissedByRow(dismissal) || localDismissed;
  // Signed-in only: the prompt belongs to the app, not to the login screens.
  const canInstall = Boolean(userId) && !installed && !dismissed && (Boolean(deferredPrompt) || ios);

  useEffect(() => {
    if (!canInstall || !userId || shownLoggedRef.current) return;
    shownLoggedRef.current = true;

    createSupabaseBrowserClient()
      .from('pwa_install_prompt_dismissals')
      .upsert(
        {
          user_id: userId,
          prompt_key: PROMPT_KEY,
          last_shown_at: new Date().toISOString(),
        } as never,
        { onConflict: 'user_id,prompt_key' },
      )
      .then(({ data: _data, error }) => {
        if (error) shownLoggedRef.current = false;
      });
  }, [canInstall, userId]);

  async function promptInstall() {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    if (choice.outcome === 'accepted') {
      window.localStorage.setItem(PERMANENT_KEY, '1');
      setInstalled(true);
      if (userId) {
        await createSupabaseBrowserClient()
          .from('pwa_install_prompt_dismissals')
          .upsert(
            {
              user_id: userId,
              prompt_key: PROMPT_KEY,
              permanently_dismissed: true,
              last_dismissed_at: new Date().toISOString(),
            } as never,
            { onConflict: 'user_id,prompt_key' },
          );
      }
      return true;
    }
    return false;
  }

  async function dismiss(permanent = false) {
    setLocalDismissed(true);
    persistLocalDismissal(permanent);

    if (!userId) return;

    const now = new Date();
    const nextCount = permanent ? Math.max((dismissal?.dismiss_count ?? 0) + 1, 2) : (dismissal?.dismiss_count ?? 0) + 1;
    const permanentlyDismissed = permanent || nextCount >= 2;
    const dismissedUntil = permanentlyDismissed ? null : addMs(now, WEEK_MS);
    const next = {
      dismiss_count: nextCount,
      dismissed_until: dismissedUntil,
      permanently_dismissed: permanentlyDismissed,
    };

    setDismissal(next);
    await createSupabaseBrowserClient()
      .from('pwa_install_prompt_dismissals')
      .upsert(
        {
          user_id: userId,
          prompt_key: PROMPT_KEY,
          ...next,
          last_dismissed_at: now.toISOString(),
        } as never,
        { onConflict: 'user_id,prompt_key' },
      );
  }

  return {
    canInstall,
    ios,
    installed,
    promptInstall,
    dismiss,
  };
}
