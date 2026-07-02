import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { applyBrandPalette, resetBrandTheme, type PaletteEntry } from '@/lib/useBrandTheme';
import { Spinner } from '@/components/ui/Spinner';

interface InviteBrand {
  name: string;
  logo_url: string | null;
  color_palette: PaletteEntry[];
}

export default function SignupPage() {
  const navigate = useNavigate();
  const supabase = createSupabaseBrowserClient();
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('invite');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Invite resolution: while we don't know yet, hold off rendering the form so
  // the brand logo/colors can come in first (avoids a generic→branded flash).
  const [inviteBrand, setInviteBrand] = useState<InviteBrand | null>(null);
  const [resolvingInvite, setResolvingInvite] = useState(!!inviteToken);

  useEffect(() => {
    if (!inviteToken) return;
    let active = true;
    (async () => {
      const { data } = await supabase.functions.invoke('resolve-invite', { body: { token: inviteToken } });
      if (!active) return;
      const brand = (data as { brand?: InviteBrand } | null)?.brand ?? null;
      if (brand) {
        setInviteBrand(brand);
        applyBrandPalette(brand.color_palette ?? []);
      }
      setResolvingInvite(false);
    })();
    return () => {
      active = false;
      resetBrandTheme();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteToken]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('הסיסמה צריכה להכיל לפחות 8 תווים.');
      return;
    }

    setLoading(true);

    // Register via the edge function (no email confirmation — the user is
    // created pre-confirmed), then sign in straight away. When an invite token
    // is present the function also assigns the brand + enables output creation.
    const { data, error: fnError } = await supabase.functions.invoke('signup', {
      body: { email: email.trim().toLowerCase(), password, invite_token: inviteToken ?? undefined },
    });

    const errorCode = (data as { error?: string } | null)?.error;
    if (fnError || errorCode) {
      setLoading(false);
      setError(errorCode === 'email_taken' ? 'כתובת המייל כבר רשומה.' : 'ההרשמה נכשלה. נסו שוב.');
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    setLoading(false);
    if (signInError) {
      setError('נרשמת בהצלחה, אך הכניסה נכשלה. נסו להתחבר ממסך הכניסה.');
      return;
    }
    navigate('/onboarding', { replace: true });
  }

  if (resolvingInvite) {
    return <main className="min-h-screen grid place-items-center text-[var(--muted)]"><Spinner /></main>;
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-[var(--border)] p-6">
        {inviteBrand ? (
          <div className="mb-6 flex flex-col items-center text-center">
            <div className="mb-3 flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
              {inviteBrand.logo_url ? (
                <img src={inviteBrand.logo_url} alt={inviteBrand.name} className="h-full w-full object-contain p-1.5" />
              ) : (
                <span className="text-2xl font-bold text-brand">{inviteBrand.name.slice(0, 2)}</span>
              )}
            </div>
            <h1 className="text-xl font-semibold tracking-normal">הרשמה ל{inviteBrand.name}</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">צרו חשבון כדי להתחיל לעבוד על המותג</p>
          </div>
        ) : (
          <>
            <h1 className="mb-1 text-xl font-semibold tracking-normal">הרשמה</h1>
            <p className="mb-4 text-sm text-[var(--muted)]">צרו חשבון כדי להצטרף למערכת.</p>
            <img src="/primeos-logo.png" alt="PrimeOS" className="mb-6 h-12 w-auto object-contain" />
          </>
        )}

        <label className="block mb-1 text-sm font-medium" htmlFor="email">כתובת מייל</label>
        <input id="email" type="email" dir="ltr" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full mb-4 rounded-lg border border-[var(--border)] px-3 py-2" style={{ textAlign: 'left' }} />

        <label className="block mb-1 text-sm font-medium" htmlFor="password">סיסמה</label>
        <div className="relative mb-1">
          <input id="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-lg border border-[var(--border)] pe-10 ps-3 py-2" />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'הסתר סיסמה' : 'הצג סיסמה'}
            className="absolute inset-y-0 end-0 flex items-center px-3 text-[var(--muted)] hover:text-[var(--foreground)]"
          >
            {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
        </div>
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
