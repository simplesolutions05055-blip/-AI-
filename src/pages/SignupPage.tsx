import { useEffect, useRef, useState } from 'react';
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

const SIGNUP_ERRORS: Record<string, string> = {
  email_taken: 'כתובת המייל כבר רשומה.',
  invalid_email: 'כתובת המייל אינה תקינה.',
  weak_password: 'הסיסמה צריכה להכיל לפחות 8 תווים.',
  code_cooldown: 'שלחנו קוד ממש עכשיו — המתינו כדקה לפני בקשת קוד חדש.',
  too_many_requests: 'נשלחו יותר מדי קודים לכתובת הזו. נסו שוב בעוד שעה.',
  code_send_failed: 'שליחת קוד האימות נכשלה. נסו שוב בעוד רגע.',
};

const RESEND_COOLDOWN_SECONDS = 60;

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

  // Email verification step: after signup a 6-digit code is emailed; the user
  // verifies here (verifyOtp both confirms the email and signs them in).
  const [step, setStep] = useState<'form' | 'code'>('form');
  const [code, setCode] = useState('');
  // Whether the account pre-existed unverified — the password typed now is
  // applied right after verification (verify proves address ownership).
  const [passwordNeedsUpdate, setPasswordNeedsUpdate] = useState(false);
  const [resendIn, setResendIn] = useState(RESEND_COOLDOWN_SECONDS);
  const codeInputRef = useRef<HTMLInputElement | null>(null);

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

  // Resend cooldown ticker (active only on the code step).
  useEffect(() => {
    if (step !== 'code' || resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [step, resendIn]);

  async function requestCode(): Promise<boolean> {
    // Register via the edge function: the user is created unconfirmed and a
    // 6-digit verification code is emailed. Re-invoking for an unverified
    // address simply re-sends a fresh code (resent: true).
    const { data, error: fnError } = await supabase.functions.invoke('signup', {
      body: { email: email.trim().toLowerCase(), password, invite_token: inviteToken ?? undefined },
    });
    const body = (data as { error?: string; verify?: boolean; resent?: boolean } | null) ?? null;
    if (fnError || body?.error || !body?.verify) {
      setError(SIGNUP_ERRORS[body?.error ?? ''] ?? 'ההרשמה נכשלה. נסו שוב.');
      return false;
    }
    setPasswordNeedsUpdate(!!body.resent);
    return true;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('הסיסמה צריכה להכיל לפחות 8 תווים.');
      return;
    }

    setLoading(true);
    const sent = await requestCode();
    setLoading(false);
    if (!sent) return;
    setCode('');
    setResendIn(RESEND_COOLDOWN_SECONDS);
    setStep('code');
    setTimeout(() => codeInputRef.current?.focus(), 50);
  }

  async function onResend() {
    if (resendIn > 0 || loading) return;
    setError(null);
    setLoading(true);
    const sent = await requestCode();
    setLoading(false);
    if (sent) setResendIn(RESEND_COOLDOWN_SECONDS);
  }

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const cleanCode = code.replace(/\D+/g, '');
    if (cleanCode.length !== 6) {
      setError('הזינו את הקוד בן 6 הספרות שנשלח למייל.');
      return;
    }
    setLoading(true);
    const cleanEmail = email.trim().toLowerCase();
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: cleanEmail,
      token: cleanCode,
      type: 'email',
    });
    if (verifyError) {
      setLoading(false);
      setError('הקוד שגוי או שפג תוקפו. אפשר לבקש קוד חדש.');
      return;
    }
    // Ownership proven — align the stored password with what was typed now
    // (matters when an old unverified signup existed with a different one).
    if (passwordNeedsUpdate) {
      await supabase.auth.updateUser({ password });
    }
    setLoading(false);
    navigate('/onboarding', { replace: true });
  }

  if (resolvingInvite) {
    return <main className="min-h-screen grid place-items-center text-[var(--muted)]"><Spinner /></main>;
  }

  if (step === 'code') {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <form onSubmit={onVerify} className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-[var(--border)] p-6">
          <h1 className="mb-1 text-xl font-semibold tracking-normal">אימות כתובת המייל</h1>
          <p className="mb-4 text-sm text-[var(--muted)]">
            שלחנו קוד בן 6 ספרות אל <span className="font-semibold ltr inline-block" dir="ltr">{email.trim().toLowerCase()}</span>.
            הזינו אותו כאן כדי להשלים את ההרשמה.
          </p>

          <label className="block mb-1 text-sm font-medium" htmlFor="otp">קוד אימות</label>
          <input
            id="otp"
            ref={codeInputRef}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            dir="ltr"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D+/g, ''))}
            className="w-full mb-4 rounded-lg border border-[var(--border)] px-3 py-2 text-center text-2xl tracking-[0.5em] font-semibold"
            placeholder="••••••"
          />

          {error && <p className="text-red-600 text-sm mb-4" role="alert">{error}</p>}

          <button type="submit" disabled={loading || code.length !== 6} className="w-full bg-brand hover:bg-brand-dark text-white rounded-lg py-2 font-semibold disabled:opacity-60">
            {loading ? 'מאמת...' : 'אימות והרשמה'}
          </button>

          <div className="mt-4 flex items-center justify-between text-sm">
            <button type="button" onClick={onResend} disabled={resendIn > 0 || loading} className="text-brand font-semibold hover:underline disabled:text-[var(--muted)] disabled:no-underline">
              {resendIn > 0 ? `שליחת קוד חדש (${resendIn})` : 'שליחת קוד חדש'}
            </button>
            <button type="button" onClick={() => { setStep('form'); setError(null); }} className="text-[var(--muted)] hover:underline">
              חזרה
            </button>
          </div>
        </form>
      </main>
    );
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
          {loading ? 'שולח קוד...' : 'הרשמה'}
        </button>

        <p className="text-center text-sm text-[var(--muted)] mt-4">
          כבר יש לך חשבון?{' '}
          <Link to="/login" className="text-brand font-semibold hover:underline">כניסה</Link>
        </p>
      </form>
    </main>
  );
}
