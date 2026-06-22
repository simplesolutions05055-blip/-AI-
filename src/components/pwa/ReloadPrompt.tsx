import { useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

const DEFERRED_UPDATE_KEY = 'pwa_update_deferred_once';

export default function ReloadPrompt() {
  const [dismissed, setDismissed] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      registration?.update();
    },
    onNeedRefresh() {
      if (window.localStorage.getItem(DEFERRED_UPDATE_KEY) === '1') {
        window.localStorage.removeItem(DEFERRED_UPDATE_KEY);
        updateServiceWorker(true);
      }
    },
    onOfflineReady() {
      setOfflineReady(true);
      window.setTimeout(() => setOfflineReady(false), 3000);
    },
  });

  if (needRefresh && !dismissed) {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-3 pb-[calc(var(--safe-bottom)+12px)] sm:items-center" dir="rtl">
        <section className="w-[calc(100vw-24px)] max-w-md rounded-xl bg-white p-5 text-right shadow-2xl">
          <h2 className="text-lg font-bold">יש גרסה חדשה</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">רענון קצר יטען את העדכון האחרון של המערכת.</p>
          <div className="mt-5 flex gap-2">
            <button onClick={() => updateServiceWorker(true)} className="flex-1 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white">
              עדכן עכשיו
            </button>
            <button
              onClick={() => {
                window.localStorage.setItem(DEFERRED_UPDATE_KEY, '1');
                setDismissed(true);
                setNeedRefresh(false);
              }}
              className="flex-1 rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm font-semibold"
            >
              אחר כך
            </button>
          </div>
        </section>
      </div>
    );
  }

  if (!offlineReady) return null;
  return (
    <div className="fixed bottom-[calc(var(--safe-bottom)+12px)] right-3 z-40 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white shadow-lg" dir="rtl">
      האפליקציה מוכנה לשימוש מהיר יותר
    </div>
  );
}
