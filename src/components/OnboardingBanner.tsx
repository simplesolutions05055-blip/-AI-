import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

// Top reminder shown when a user entered the app but hasn't finished the
// optional brand-setup steps. Dismissable for the session; returns on reload
// until onboarding is complete.
export default function OnboardingBanner() {
  const navigate = useNavigate();
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

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
        onClick={() => setHidden(true)}
        aria-label="סגירה"
        className="shrink-0 text-amber-700 hover:text-amber-900"
      >
        ✕
      </button>
    </div>
  );
}
