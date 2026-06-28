import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const navigate = useNavigate();
  const supabase = createSupabaseBrowserClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Admin-controlled (Settings): whether to surface the public "register" link.
  // Defaults to visible; only an explicit `false` hides it.
  const [signupVisible, setSignupVisible] = useState(true);

  useEffect(() => {
    supabase
      .from('settings')
      .select('value_json')
      .eq('key', 'public_signup_visible')
      .maybeSingle()
      .then(({ data }) => {
        if ((data as { value_json?: boolean } | null)?.value_json === false) setSignupVisible(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError('הכניסה נכשלה. בדקו את כתובת המייל והסיסמה.');
      return;
    }
    navigate('/admin', { replace: true });
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-[var(--border)] p-6">
        <img src="/primeos-logo.png" alt="PrimeOS" className="mb-6 h-12 w-auto object-contain" />

        <label className="block mb-1 text-sm font-medium" htmlFor="email">כתובת מייל</label>
        <input id="email" type="email" dir="ltr" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full mb-4 rounded-lg border border-[var(--border)] px-3 py-2 text-start" style={{ textAlign: 'left' }} />

        <label className="block mb-1 text-sm font-medium" htmlFor="password">סיסמה</label>
        <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full mb-4 rounded-lg border border-[var(--border)] px-3 py-2" />

        {error && <p className="text-red-600 text-sm mb-4" role="alert">{error}</p>}

        <button type="submit" disabled={loading} className="w-full bg-brand hover:bg-brand-dark text-white rounded-lg py-2 font-semibold disabled:opacity-60">
          {loading ? 'מתחבר...' : 'כניסה'}
        </button>

        {signupVisible && (
          <p className="text-center text-sm text-[var(--muted)] mt-4">
            אין לך חשבון?{' '}
            <Link to="/signup" className="text-brand font-semibold hover:underline">הירשם</Link>
          </p>
        )}
      </form>
    </main>
  );
}
