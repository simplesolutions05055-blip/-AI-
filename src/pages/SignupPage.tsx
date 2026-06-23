import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export default function SignupPage() {
  const navigate = useNavigate();
  const supabase = createSupabaseBrowserClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('הסיסמה צריכה להכיל לפחות 8 תווים.');
      return;
    }

    setLoading(true);
    const { data, error: signUpError } = await supabase.auth.signUp({ email, password });

    if (signUpError) {
      setLoading(false);
      setError('ההרשמה נכשלה. ייתכן שכתובת המייל כבר רשומה.');
      return;
    }

    // No email confirmation flow — sign the user straight in.
    if (!data.session) {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setLoading(false);
        setError('נרשמת בהצלחה, אך הכניסה נכשלה. נסו להתחבר ממסך הכניסה.');
        return;
      }
    }

    setLoading(false);
    navigate('/admin', { replace: true });
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-[var(--border)] p-6">
        <h1 className="text-2xl font-bold mb-1">הרשמה</h1>
        <p className="text-[var(--muted)] mb-6 text-sm">פתחו חשבון חדש לסוכן ה-AI</p>

        <label className="block mb-1 text-sm font-medium" htmlFor="email">כתובת מייל</label>
        <input id="email" type="email" dir="ltr" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full mb-4 rounded-lg border border-[var(--border)] px-3 py-2" style={{ textAlign: 'left' }} />

        <label className="block mb-1 text-sm font-medium" htmlFor="password">סיסמה</label>
        <input id="password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="w-full mb-1 rounded-lg border border-[var(--border)] px-3 py-2" />
        <p className="text-xs text-[var(--muted)] mb-4">לפחות 8 תווים.</p>

        {error && <p className="text-red-600 text-sm mb-4" role="alert">{error}</p>}

        <button type="submit" disabled={loading} className="w-full bg-brand hover:bg-brand-dark text-white rounded-lg py-2 font-semibold disabled:opacity-60">
          {loading ? 'נרשם...' : 'הרשמה וכניסה'}
        </button>

        <p className="text-center text-sm text-[var(--muted)] mt-4">
          כבר יש לך חשבון?{' '}
          <Link to="/login" className="text-brand font-semibold hover:underline">כניסה</Link>
        </p>
      </form>
    </main>
  );
}
