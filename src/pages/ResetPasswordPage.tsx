import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

const RESET_ERRORS: Record<string, string> = {
  invalid_email: 'כתובת המייל אינה תקינה.',
  code_cooldown: 'שלחנו קוד ממש עכשיו — המתינו כדקה לפני בקשת קוד חדש.',
  too_many_requests: 'נשלחו יותר מדי קודים לכתובת הזו. נסו שוב בעוד שעה.',
  code_send_failed: 'שליחת הקוד נכשלה. נסו שוב בעוד רגע.',
};

const RESEND_COOLDOWN_SECONDS = 60;

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const supabase = createSupabaseBrowserClient();

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resendIn, setResendIn] = useState(RESEND_COOLDOWN_SECONDS);
  const codeInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (step !== 'code' || resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [step, resendIn]);

  async function requestCode(): Promise<boolean> {
    const { data, error: fnError } = await supabase.functions.invoke('request-password-reset', {
      body: { email: email.trim().toLowerCase() },
    });
    const body = (data as { error?: string; ok?: boolean } | null) ?? null;
    if (fnError || body?.error || !body?.ok) {
      setError(RESET_ERRORS[body?.error ?? ''] ?? 'שליחת הקוד נכשלה. נסו שוב.');
      return false;
    }
    return true;
  }

  async function onSubmitEmail(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
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

  async function onSubmitReset(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const cleanCode = code.replace(/\D+/g, '');
    if (cleanCode.length !== 6) {
      setError('הזינו את הקוד בן 6 הספרות שנשלח למייל.');
      return;
    }
    if (password.length < 8) {
      setError('הסיסמה החדשה צריכה להכיל לפחות 8 תווים.');
      return;
    }
    setLoading(true);
    // Verifying the recovery code signs the user in; then the new password is set.
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: cleanCode,
      type: 'recovery',
    });
    if (verifyError) {
      setLoading(false);
      setError('הקוד שגוי או שפג תוקפו. אפשר לבקש קוד חדש.');
      return;
    }
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (updateError) {
      setError('עדכון הסיסמה נכשל. נסו סיסמה אחרת.');
      return;
    }
    navigate('/admin', { replace: true });
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      {step === 'email' ? (
        <form onSubmit={onSubmitEmail} className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-[var(--border)] p-6">
          <img src="/primeos-logo.png" alt="PrimeOS" className="mb-6 h-12 w-auto object-contain" />
          <h1 className="mb-1 text-xl font-semibold tracking-normal">שחזור סיסמה</h1>
          <p className="mb-4 text-sm text-[var(--muted)]">הזינו את כתובת המייל שאיתה נרשמתם, ואם היא רשומה — נשלח אליה קוד לאיפוס הסיסמה.</p>

          <label className="block mb-1 text-sm font-medium" htmlFor="email">כתובת מייל</label>
          <input id="email" type="email" dir="ltr" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full mb-4 rounded-lg border border-[var(--border)] px-3 py-2" style={{ textAlign: 'left' }} />

          {error && <p className="text-red-600 text-sm mb-4" role="alert">{error}</p>}

          <button type="submit" disabled={loading} className="w-full bg-brand hover:bg-brand-dark text-white rounded-lg py-2 font-semibold disabled:opacity-60">
            {loading ? 'שולח קוד...' : 'שליחת קוד לאיפוס'}
          </button>

          <p className="text-center text-sm text-[var(--muted)] mt-4">
            נזכרת בסיסמה?{' '}
            <Link to="/login" className="text-brand font-semibold hover:underline">כניסה</Link>
          </p>
        </form>
      ) : (
        <form onSubmit={onSubmitReset} className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-[var(--border)] p-6">
          <h1 className="mb-1 text-xl font-semibold tracking-normal">איפוס סיסמה</h1>
          <p className="mb-4 text-sm text-[var(--muted)]">
            אם הכתובת <span className="font-semibold ltr inline-block" dir="ltr">{email.trim().toLowerCase()}</span> רשומה במערכת,
            נשלח אליה קוד בן 6 ספרות. הזינו אותו יחד עם הסיסמה החדשה.
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

          <label className="block mb-1 text-sm font-medium" htmlFor="new-password">סיסמה חדשה</label>
          <div className="relative mb-1">
            <input id="new-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-lg border border-[var(--border)] pe-10 ps-3 py-2" />
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

          <button type="submit" disabled={loading || code.length !== 6} className="w-full bg-brand hover:bg-brand-dark text-white rounded-lg py-2 font-semibold disabled:opacity-60">
            {loading ? 'מאפס...' : 'איפוס סיסמה וכניסה'}
          </button>

          <div className="mt-4 flex items-center justify-between text-sm">
            <button type="button" onClick={onResend} disabled={resendIn > 0 || loading} className="text-brand font-semibold hover:underline disabled:text-[var(--muted)] disabled:no-underline">
              {resendIn > 0 ? `שליחת קוד חדש (${resendIn})` : 'שליחת קוד חדש'}
            </button>
            <button type="button" onClick={() => { setStep('email'); setError(null); }} className="text-[var(--muted)] hover:underline">
              חזרה
            </button>
          </div>
        </form>
      )}
    </main>
  );
}
