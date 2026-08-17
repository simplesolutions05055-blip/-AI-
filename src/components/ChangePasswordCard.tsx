import { useState } from 'react';
import { Eye, EyeOff, KeyRound } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useProfile } from '@/lib/useProfile';

const MIN_LENGTH = 8;

/** Password change for the signed-in user: re-auth with the current password, then update. */
export default function ChangePasswordCard() {
  const { profile } = useProfile();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setDone(false);

    if (next.length < MIN_LENGTH) {
      setError(`הסיסמה החדשה צריכה להכיל לפחות ${MIN_LENGTH} תווים.`);
      return;
    }
    if (next !== confirm) {
      setError('הסיסמה החדשה ואימות הסיסמה אינם זהים.');
      return;
    }
    if (next === current) {
      setError('הסיסמה החדשה זהה לסיסמה הנוכחית.');
      return;
    }

    setSaving(true);
    const db = createSupabaseBrowserClient();
    const { data: auth } = await db.auth.getUser();
    const email = auth.user?.email;
    if (!email) {
      setSaving(false);
      setError('לא הצלחנו לזהות את המשתמש. התחברו מחדש ונסו שוב.');
      return;
    }

    // Verify the current password before allowing the change.
    const { error: reauthError } = await db.auth.signInWithPassword({ email, password: current });
    if (reauthError) {
      setSaving(false);
      setError('הסיסמה הנוכחית שגויה.');
      return;
    }

    const { error: updateError } = await db.auth.updateUser({ password: next });
    if (updateError) {
      setSaving(false);
      setError('עדכון הסיסמה נכשל. נסו סיסמה אחרת.');
      return;
    }

    // Invalidate the other devices that were signed in with the old password.
    await db.auth.signOut({ scope: 'others' });

    setSaving(false);
    setCurrent('');
    setNext('');
    setConfirm('');
    setDone(true);
  }

  return (
    <section className="mx-auto mt-6 w-full max-w-lg rounded-2xl border border-[var(--border)] bg-white p-6 shadow-sm">
      <div className="mb-1 flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand/10 text-brand">
          <KeyRound className="h-4 w-4" />
        </span>
        <h2 className="text-lg font-bold text-[var(--text)]">שינוי סיסמה</h2>
      </div>
      <p className="mb-5 text-sm text-[var(--muted)]">
        לאחר השינוי תישארו מחוברים במכשיר הזה, וכל שאר המכשירים ינותקו.
      </p>

      <form onSubmit={onSubmit}>
        {/* Helps password managers associate the change with the right account. */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          className="hidden"
          tabIndex={-1}
          readOnly
          value={profile?.email ?? ''}
        />

        <label className="mb-1 block text-sm font-medium" htmlFor="current-password">סיסמה נוכחית</label>
        <input
          id="current-password"
          type={show ? 'text' : 'password'}
          autoComplete="current-password"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          className="mb-4 w-full rounded-lg border border-[var(--border)] px-3 py-2"
        />

        <label className="mb-1 block text-sm font-medium" htmlFor="new-password">סיסמה חדשה</label>
        <div className="relative mb-1">
          <input
            id="new-password"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            required
            minLength={MIN_LENGTH}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className="w-full rounded-lg border border-[var(--border)] py-2 pe-10 ps-3"
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? 'הסתר סיסמה' : 'הצג סיסמה'}
            className="absolute inset-y-0 end-0 flex items-center px-3 text-[var(--muted)] hover:text-[var(--text)]"
          >
            {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
        </div>
        <p className="mb-4 text-xs text-[var(--muted)]">לפחות {MIN_LENGTH} תווים.</p>

        <label className="mb-1 block text-sm font-medium" htmlFor="confirm-password">אימות סיסמה חדשה</label>
        <input
          id="confirm-password"
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          required
          minLength={MIN_LENGTH}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="mb-4 w-full rounded-lg border border-[var(--border)] px-3 py-2"
        />

        {error && <p className="mb-4 text-sm text-red-600" role="alert">{error}</p>}
        {done && <p className="mb-4 text-sm text-emerald-700" role="status">הסיסמה עודכנה בהצלחה.</p>}

        <button
          type="submit"
          disabled={saving || !current || !next || !confirm}
          className="w-full rounded-lg bg-brand py-2 font-semibold text-white transition hover:bg-brand-dark disabled:opacity-60"
        >
          {saving ? 'מעדכן...' : 'עדכון סיסמה'}
        </button>
      </form>
    </section>
  );
}
