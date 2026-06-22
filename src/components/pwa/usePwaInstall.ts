import { useEffect, useMemo, useState } from 'react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

const DISMISS_AT_KEY = 'pwa_install_dismissed_at';
const DISMISS_COUNT_KEY = 'pwa_install_dismiss_count';
const PERMANENT_KEY = 'pwa_install_dismissed_permanent';
const DISMISS_DAYS = 7;

function isIos() {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function dismissalExpired() {
  const dismissedAt = Number(window.localStorage.getItem(DISMISS_AT_KEY) ?? 0);
  if (!dismissedAt) return true;
  return Date.now() - dismissedAt > DISMISS_DAYS * 24 * 60 * 60 * 1000;
}

export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone);
  const [dismissed, setDismissed] = useState(false);
  const ios = useMemo(isIos, []);

  useEffect(() => {
    const refreshDismissed = () => {
      setDismissed(
        window.localStorage.getItem(PERMANENT_KEY) === '1' ||
          (window.localStorage.getItem(DISMISS_AT_KEY) !== null && !dismissalExpired()),
      );
    };
    refreshDismissed();

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      refreshDismissed();
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

  const canInstall = !installed && !dismissed && (Boolean(deferredPrompt) || ios);

  async function promptInstall() {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    if (choice.outcome === 'accepted') {
      window.localStorage.setItem(PERMANENT_KEY, '1');
      setInstalled(true);
      return true;
    }
    return false;
  }

  function dismiss(permanent = false) {
    if (permanent) {
      window.localStorage.setItem(PERMANENT_KEY, '1');
    } else {
      const count = Number(window.localStorage.getItem(DISMISS_COUNT_KEY) ?? 0) + 1;
      window.localStorage.setItem(DISMISS_COUNT_KEY, String(count));
      if (count >= 2) window.localStorage.setItem(PERMANENT_KEY, '1');
      window.localStorage.setItem(DISMISS_AT_KEY, String(Date.now()));
    }
    setDismissed(true);
  }

  return {
    canInstall,
    ios,
    installed,
    promptInstall,
    dismiss,
  };
}
