import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import LegalLinks from '@/components/legal/LegalLinks';

export default function LoginPage() {
  const navigate = useNavigate();
  const supabase = createSupabaseBrowserClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
        <h1 className="mb-1 text-xl font-semibold tracking-normal">כניסה למערכת</h1>
        <p className="mb-4 text-sm text-[var(--muted)]">התחברו כדי להמשיך לעבודה במערכת.</p>

        <label className="block mb-1 text-sm font-medium" htmlFor="email">כתובת מייל</label>
        <input id="email" type="email" dir="ltr" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full mb-4 rounded-lg border border-[var(--border)] px-3 py-2 text-start" style={{ textAlign: 'left' }} />

        <div className="mb-1 flex items-center justify-between">
          <label className="block text-sm font-medium" htmlFor="password">סיסמה</label>
          <Link to="/reset-password" className="text-xs text-brand font-semibold hover:underline">שכחתי סיסמה</Link>
        </div>
        <div className="relative mb-4">
          <input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-lg border border-[var(--border)] pe-10 ps-3 py-2" />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'הסתר סיסמה' : 'הצג סיסמה'}
            className="absolute inset-y-0 end-0 flex items-center px-3 text-[var(--muted)] hover:text-[var(--foreground)]"
          >
            {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
        </div>

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
        <LegalLinks />
      </form>
    </main>
  );
}
