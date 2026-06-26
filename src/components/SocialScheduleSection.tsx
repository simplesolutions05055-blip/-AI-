import { useEffect, useState } from 'react';

type SocialPlatform = 'facebook' | 'instagram';

const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  facebook: 'פייסבוק',
  instagram: 'אינסטגרם',
};

export default function SocialScheduleSection() {
  const [platform, setPlatform] = useState<SocialPlatform | null>(null);

  return (
    <div>
      <label className="block text-sm font-semibold mb-2">תזמון פרסום</label>
      <div className="grid gap-2">
        <button
          type="button"
          onClick={() => setPlatform('facebook')}
          className="flex w-full items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] hover:bg-gray-50"
        >
          <span>תזמון פרסום בפייסבוק</span>
          <FacebookIcon />
        </button>
        <button
          type="button"
          onClick={() => setPlatform('instagram')}
          className="flex w-full items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] hover:bg-gray-50"
        >
          <span>תזמון פרסום באינסטגרם</span>
          <InstagramIcon />
        </button>
      </div>

      {platform && <ScheduleModal platform={platform} onClose={() => setPlatform(null)} />}
    </div>
  );
}

function ScheduleModal({ platform, onClose }: { platform: SocialPlatform; onClose: () => void }) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-5 text-right shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">תזמון פרסום ב{PLATFORM_LABEL[platform]}</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">בחרו מועד לפרסום התוצר בערוץ.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="סגירה"
            aria-label="סגירה"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] hover:bg-gray-50 hover:text-black"
          >
            <CloseIcon />
          </button>
        </div>

        <label className="mb-2 block text-sm font-semibold">תאריך ושעה</label>
        <input
          type="datetime-local"
          className="mb-3 w-full rounded-lg border border-[var(--border)] px-3 py-2 text-right"
        />

        <label className="mb-2 block text-sm font-semibold">כיתוב לפרסום</label>
        <textarea
          rows={4}
          placeholder="טקסט שיופיע לצד הפרסום"
          className="mb-3 w-full rounded-lg border border-[var(--border)] px-3 py-2"
        />

        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          תזמון הפרסום ב{PLATFORM_LABEL[platform]} עדיין לא זמין בשלב הזה.
        </div>

        <div className="flex items-center justify-start gap-3">
          <button
            type="button"
            disabled
            className="rounded-lg bg-brand px-4 py-2.5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            תזמון הפרסום
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] px-4 py-2.5 font-semibold hover:bg-gray-50"
          >
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}

function FacebookIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M13.5 22v-8h2.7l.4-3.1h-3.1V8.9c0-.9.3-1.5 1.6-1.5h1.7V4.6c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3v2.1H7.3V14h2.8v8h3.4Z" />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
