import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { OnboardingState } from '@/lib/useProfile';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

// Top reminder shown when a user entered the app but hasn't finished the
// optional brand-setup steps. Dismissal is persisted in the user's profile.
export default function OnboardingBanner({ userId, onboarding }: { userId: string; onboarding: OnboardingState }) {
  const navigate = useNavigate();
  const [hidden, setHidden] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  if (hidden) return null;

  async function dismiss() {
    if (dismissing) return;
    const next = { ...onboarding, banner_dismissed_at: new Date().toISOString() };
    setHidden(true);
    setDismissing(true);
    const { error } = await createSupabaseBrowserClient()
      .from('profiles')
      .update({ onboarding: next } as never)
      .eq('id', userId);
    if (error) {
      setHidden(false);
      setDismissing(false);
    }
  }

  return (
    <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <span className="flex-1">עוד לא השלמתם את הגדרת המותג — מומלץ להוסיף מסמכים וקבצים.</span>
      <button
        onClick={() => navigate('/onboarding')}
        className="shrink-0 rounded-md bg-brand px-3 py-1 text-xs font-semibold text-white hover:bg-brand-dark"
      >
        להשלמה
      </button>
      <button
        onClick={dismiss}
        disabled={dismissing}
        aria-label="סגירה"
        className="shrink-0 text-amber-700 hover:text-amber-900 disabled:opacity-50"
      >
        ✕
      </button>
    </div>
  );
}
