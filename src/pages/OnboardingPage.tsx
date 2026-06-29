import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import type { OnboardingState, ProfileGender } from '@/lib/useProfile';
import { Spinner } from '@/components/ui/Spinner';
import AdminNav, { AdminBottomNav } from '@/components/AdminNav';
import InstallPrompt from '@/components/pwa/InstallPrompt';
import { useBrandTheme } from '@/lib/useBrandTheme';

type StepKey = 'details' | 'docs' | 'files';

interface UploadedItem {
  name: string;
  status: 'uploading' | 'done' | 'error';
  error?: string;
}

const MAX_FILE_BYTES = 25 * 1024 * 1024;

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'user'>('user');
  const [canCreateOutputs, setCanCreateOutputs] = useState(false);
  const [hasBrand, setHasBrand] = useState(false);
  const [requireUploads, setRequireUploads] = useState(false);
  const [brandName, setBrandName] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [navMounted, setNavMounted] = useState(false);
  const [navVisible, setNavVisible] = useState(false);

  // step 1 fields
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [gender, setGender] = useState<ProfileGender | ''>('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  // uploads
  const [docs, setDocs] = useState<UploadedItem[]>([]);
  const [assets, setAssets] = useState<UploadedItem[]>([]);

  const progress = useRef<OnboardingState>({});
  const [stepIndex, setStepIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const steps: StepKey[] = useMemo(
    () => (hasBrand ? ['details', 'docs', 'files'] : ['details']),
    [hasBrand],
  );
  const step = steps[stepIndex];

  useBrandTheme(!!userId);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth.user;
      if (!user) {
        navigate('/login', { replace: true });
        return;
      }

      const [{ data: profile }, { data: brands }, { data: setting }] = await Promise.all([
        supabase
          .from('profiles')
          .select('email, role, can_create_outputs, full_name, phone, job_title, gender, avatar_path, onboarding')
          .eq('id', user.id)
          .maybeSingle(),
        supabase.from('user_brands').select('brand_id, brands(name)').eq('user_id', user.id),
        supabase.from('settings').select('value_json').eq('key', 'onboarding_require_uploads').maybeSingle(),
      ]);
      if (!active) return;

      const p = profile as {
        full_name?: string | null;
        phone?: string | null;
        job_title?: string | null;
        gender?: ProfileGender | null;
        email?: string | null;
        role?: 'admin' | 'user' | null;
        can_create_outputs?: boolean | null;
        avatar_path?: string | null;
        onboarding?: OnboardingState;
      } | null;
      setUserId(user.id);
      setEmail(p?.email ?? user.email ?? '');
      setRole(p?.role ?? 'user');
      setCanCreateOutputs(p?.can_create_outputs === true);
      setFullName(p?.full_name ?? '');
      setPhone(p?.phone ?? '');
      setJobTitle(p?.job_title ?? '');
      setGender(p?.gender ?? '');
      progress.current = p?.onboarding ?? {};

      if (p?.avatar_path) {
        const { data: avatarUrl } = await supabase.storage.from('avatars').createSignedUrl(p.avatar_path, 60 * 60);
        if (active) setAvatarPreview(avatarUrl?.signedUrl ?? null);
      }

      const brandRows = (brands as { brands?: { name?: string } | null }[] | null) ?? [];
      setHasBrand(brandRows.length > 0);
      setBrandName(brandRows[0]?.brands?.name ?? null);
      setRequireUploads(((setting as { value_json?: unknown } | null)?.value_json as boolean | undefined) === true);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [supabase, navigate]);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = navOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [navOpen]);

  useEffect(() => {
    if (navOpen) {
      setNavMounted(true);
      const frame = window.requestAnimationFrame(() => setNavVisible(true));
      return () => window.cancelAnimationFrame(frame);
    }
    setNavVisible(false);
    const timeout = window.setTimeout(() => setNavMounted(false), 320);
    return () => window.clearTimeout(timeout);
  }, [navOpen]);

  useEffect(() => {
    if (!navOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setNavOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navOpen]);

  useEffect(() => {
    if (!avatarModalOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setAvatarModalOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [avatarModalOpen]);

  useEffect(() => {
    return () => {
      if (avatarPreview?.startsWith('blob:')) URL.revokeObjectURL(avatarPreview);
    };
  }, [avatarPreview]);

  function onPickAvatar(file: File | null) {
    if (avatarPreview?.startsWith('blob:')) URL.revokeObjectURL(avatarPreview);
    setAvatarFile(file);
    setAvatarPreview(file ? URL.createObjectURL(file) : null);
  }

  function onAvatarButtonClick() {
    if (avatarPreview) {
      setAvatarModalOpen(true);
      return;
    }
    avatarInputRef.current?.click();
  }

  async function saveDetailsAndNext() {
    setError(null);
    if (!fullName.trim() || !gender) {
      setError('יש למלא שם מלא ולבחור לשון פנייה.');
      return;
    }
    if (!userId) return;
    setSaving(true);
    try {
      let avatar_path: string | undefined;
      if (avatarFile) {
        const ext = avatarFile.name.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() ?? '.png';
        const path = `${userId}/avatar${ext}`;
        const { error: upErr } = await supabase.storage
          .from('avatars')
          .upload(path, avatarFile, { upsert: true, contentType: avatarFile.type });
        if (upErr) throw upErr;
        avatar_path = path;
      }

      progress.current = { ...progress.current, details_done: true };
      const { error: updErr } = await supabase
        .from('profiles')
        .update({
          full_name: fullName.trim(),
          phone: phone.trim() || null,
          job_title: jobTitle.trim() || null,
          gender,
          ...(avatar_path ? { avatar_path } : {}),
          onboarding: progress.current,
        } as never)
        .eq('id', userId);
      if (updErr) throw updErr;

      advance();
    } catch (e) {
      setError('שמירת הפרטים נכשלה. נסו שוב.');
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  async function uploadFiles(kind: 'document' | 'asset', files: FileList | null) {
    if (!files || files.length === 0) return;
    const setList = kind === 'document' ? setDocs : setAssets;

    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE_BYTES) {
        setList((cur) => [...cur, { name: file.name, status: 'error', error: 'הקובץ גדול מ-25MB' }]);
        continue;
      }
      const idx = await new Promise<number>((resolve) =>
        setList((cur) => {
          resolve(cur.length);
          return [...cur, { name: file.name, status: 'uploading' }];
        }),
      );
      try {
        const base64 = await fileToBase64(file);
        const { data, error: fnErr } = await supabase.functions.invoke('onboarding-ingest', {
          body: { kind, base64, mime: file.type, name: file.name },
        });
        const errCode = (data as { error?: string } | null)?.error;
        if (fnErr || errCode) throw new Error(errCode ?? 'failed');

        progress.current = {
          ...progress.current,
          ...(kind === 'document' ? { docs_done: true } : { files_done: true }),
        };
        setList((cur) => cur.map((it, i) => (i === idx ? { ...it, status: 'done' } : it)));
      } catch (e) {
        console.error(e);
        setList((cur) =>
          cur.map((it, i) => (i === idx ? { ...it, status: 'error', error: 'ההעלאה נכשלה' } : it)),
        );
      }
    }
  }

  function advance() {
    if (stepIndex < steps.length - 1) {
      setStepIndex((i) => i + 1);
    } else {
      finish();
    }
  }

  async function finish() {
    if (!userId) return;
    setSaving(true);
    try {
      progress.current = { ...progress.current, hard_completed_at: new Date().toISOString() };
      await supabase.from('profiles').update({ onboarding: progress.current } as never).eq('id', userId);
      navigate('/admin', { replace: true });
    } finally {
      setSaving(false);
    }
  }

  const docsUploaded = docs.some((d) => d.status === 'done');
  const assetsUploaded = assets.some((a) => a.status === 'done');
  // When uploads are mandatory, the user must add at least one item to continue.
  const canLeaveStep =
    step === 'details' ? true : step === 'docs' ? !requireUploads || docsUploaded : !requireUploads || assetsUploaded;

  if (loading) {
    return <main className="grid min-h-[100dvh] place-items-center text-[var(--muted)]"><Spinner /></main>;
  }

  const isAdmin = role === 'admin';

  return (
    <div className="flex h-[100dvh] min-h-[100dvh] overflow-hidden bg-[#f6f9f8] text-[#071a33]">
      <div className="hidden lg:flex lg:h-[100dvh] lg:w-60 lg:shrink-0 lg:border-l lg:border-[#d7e3e0] lg:bg-white">
        <div className="lg:h-[100dvh] lg:w-full">
          <AdminNav email={email} isAdmin={isAdmin} canCreateOutputs={canCreateOutputs} />
        </div>
      </div>

      {navMounted && (
        <div
          className={`fixed inset-0 z-40 transition-opacity duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
            navVisible ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
          }`}
          role="dialog"
          aria-modal="true"
          aria-label="תפריט ניווט"
        >
          <button
            type="button"
            className="absolute inset-0 h-full w-full cursor-default bg-black/40"
            aria-label="סגירת התפריט"
            onClick={() => setNavOpen(false)}
          />
          <div
            className={`absolute bottom-0 right-0 top-0 w-[min(84vw,320px)] origin-right overflow-hidden shadow-xl transition duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
              navVisible ? 'translate-x-0 opacity-100 scale-100' : 'translate-x-full opacity-0 scale-[0.985]'
            }`}
          >
            <AdminNav email={email} isAdmin={isAdmin} canCreateOutputs={canCreateOutputs} onNavigate={() => setNavOpen(false)} />
          </div>
        </div>
      )}

      <main className="min-h-0 w-full flex-1 overflow-y-auto px-4 py-8 pb-[calc(var(--safe-bottom)+5.75rem)] lg:pb-8">
        <div className="mx-auto w-full max-w-lg">
          <Stepper steps={steps} current={stepIndex} />

          <div className="mt-6 rounded-2xl border border-[var(--border)] bg-white p-6 shadow-sm">
            {step === 'details' && (
              <section>
                <h1 className="text-xl font-bold">ברוכים הבאים 👋</h1>
                <p className="mb-5 mt-1 text-sm text-[var(--muted)]">כמה פרטים קצרים כדי להכיר אתכם.</p>

                <div className="mb-4 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={onAvatarButtonClick}
                    className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full border border-[var(--border)] bg-gray-50 ring-offset-2 transition hover:border-brand focus:outline-none focus:ring-2 focus:ring-brand"
                    aria-label={avatarPreview ? 'פתיחת תמונת פרופיל' : 'בחירת תמונת פרופיל'}
                  >
                    {avatarPreview ? (
                      <img src={avatarPreview} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-xl text-[var(--muted)]">🙂</span>
                    )}
                  </button>
                  <div>
                    <button
                      type="button"
                      onClick={onAvatarButtonClick}
                      className="text-sm font-medium text-brand hover:underline"
                    >
                      {avatarPreview ? 'צפייה בתמונת פרופיל' : 'העלאת תמונת פרופיל'}
                    </button>
                    <p className="mt-1 text-xs text-[var(--muted)]">אופציונלי</p>
                  </div>
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => onPickAvatar(e.target.files?.[0] ?? null)}
                  />
                </div>

                <Field label="שם מלא">
                  <input className={inputCls} value={fullName} onChange={(e) => setFullName(e.target.value)} />
                </Field>
                <Field label="טלפון (אופציונלי)">
                  <input
                    className={inputCls}
                    type="tel"
                    dir="ltr"
                    style={{ textAlign: 'right' }}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </Field>
                <Field label="תפקיד / עיסוק (אופציונלי)">
                  <input className={inputCls} value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
                </Field>
                <div className="mb-4">
                  <span className="mb-1 block text-sm font-medium">לשון פנייה</span>
                  <p className="mb-2 text-xs text-[var(--muted)]">כדי שנפנה אליכם בלשון המתאימה.</p>
                  <div className="grid grid-cols-2 gap-2">
                    <GenderOption value="male" selected={gender} onChange={setGender} label="זכר" />
                    <GenderOption value="female" selected={gender} onChange={setGender} label="נקבה" />
                  </div>
                </div>

                {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

                <button
                  onClick={saveDetailsAndNext}
                  disabled={saving}
                  className="mt-2 w-full rounded-lg bg-brand py-2.5 font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
                >
                  {saving ? 'שומר...' : steps.length > 1 ? 'המשך' : 'סיום וכניסה'}
                </button>
              </section>
            )}

            {step === 'docs' && (
              <UploadStep
                title="מסמכי המותג"
                subtitle={`העלו מסמכים (DOCX / PDF)${brandName ? ` של ${brandName}` : ''} — נשתמש בתוכן שלהם כמאפייני המותג.`}
                accept=".docx,.pdf"
                items={docs}
                onFiles={(f) => uploadFiles('document', f)}
                hint="קבצי Word או PDF, עד 25MB."
              />
            )}

            {step === 'files' && (
              <UploadStep
                title="קבצים ותמונות"
                subtitle={`העלו תמונות וקבצים${brandName ? ` של ${brandName}` : ''} שיישמרו במערכת וישמשו בתוצרים.`}
                accept="image/*"
                items={assets}
                onFiles={(f) => uploadFiles('asset', f)}
                hint="תמונות (PNG / JPG / WEBP), עד 25MB לקובץ."
              />
            )}

            {step !== 'details' && (
              <div className="mt-6 flex items-center justify-between gap-3">
                <button
                  onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
                  className="text-sm font-medium text-[var(--muted)] hover:underline"
                >
                  חזרה
                </button>
                <div className="flex items-center gap-3">
                  {!requireUploads && (
                    <button onClick={advance} className="text-sm font-medium text-[var(--muted)] hover:underline">
                      דלג
                    </button>
                  )}
                  <button
                    onClick={advance}
                    disabled={!canLeaveStep || saving}
                    className="rounded-lg bg-brand px-5 py-2.5 font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
                  >
                    {stepIndex < steps.length - 1 ? 'המשך' : 'סיום וכניסה'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
      <AdminBottomNav isAdmin={isAdmin} canCreateOutputs={canCreateOutputs} onOpenMenu={() => setNavOpen(true)} />
      <InstallPrompt />
      {avatarModalOpen && avatarPreview && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-4 py-6"
          role="dialog"
          aria-modal="true"
          aria-label="תמונת פרופיל"
          dir="rtl"
        >
          <button
            type="button"
            className="absolute inset-0 h-full w-full cursor-default"
            aria-label="סגירת תמונת פרופיל"
            onClick={() => setAvatarModalOpen(false)}
          />
          <div className="relative w-full max-w-md rounded-2xl border border-[var(--border)] bg-white p-5 text-right shadow-xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-[var(--text)]">תמונת פרופיל</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">אפשר להחליף את התמונה לפני שממשיכים.</p>
              </div>
              <button
                type="button"
                onClick={() => setAvatarModalOpen(false)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[var(--border)] text-lg text-[var(--muted)] hover:bg-gray-50"
                aria-label="סגירה"
              >
                ×
              </button>
            </div>
            <div className="mx-auto grid h-56 w-56 place-items-center overflow-hidden rounded-full border border-[var(--border)] bg-gray-50">
              <img src={avatarPreview} alt="תמונת פרופיל" className="h-full w-full object-cover" />
            </div>
            <div className="mt-5 flex justify-start gap-3">
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
              >
                החלפת תמונה
              </button>
              <button
                type="button"
                onClick={() => setAvatarModalOpen(false)}
                className="rounded-lg border border-[var(--border)] px-5 py-2.5 text-sm font-semibold text-[var(--text)] hover:bg-gray-50"
              >
                סגירה
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function UploadStep({
  title,
  subtitle,
  accept,
  items,
  onFiles,
  hint,
}: {
  title: string;
  subtitle: string;
  accept: string;
  items: UploadedItem[];
  onFiles: (files: FileList | null) => void;
  hint: string;
}) {
  return (
    <section>
      <h1 className="text-xl font-bold">{title}</h1>
      <p className="mb-4 mt-1 text-sm text-[var(--muted)]">{subtitle}</p>

      <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-[var(--border)] bg-gray-50 px-4 py-8 text-center hover:bg-gray-100">
        <span className="text-sm font-medium">לחצו לבחירת קבצים</span>
        <span className="text-xs text-[var(--muted)]">{hint}</span>
        <input
          type="file"
          accept={accept}
          multiple
          className="hidden"
          onChange={(e) => onFiles(e.target.files)}
        />
      </label>

      {items.length > 0 && (
        <ul className="mt-4 space-y-2">
          {items.map((it, i) => (
            <li
              key={i}
              className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
            >
              <span className="truncate">{it.name}</span>
              <span className="shrink-0 text-xs">
                {it.status === 'uploading' && <span className="text-[var(--muted)]">מעלה…</span>}
                {it.status === 'done' && <span className="text-green-600">✓ נשמר</span>}
                {it.status === 'error' && <span className="text-red-600">{it.error ?? 'שגיאה'}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Stepper({ steps, current }: { steps: StepKey[]; current: number }) {
  const labels: Record<StepKey, string> = { details: 'פרטים', docs: 'מסמכים', files: 'קבצים' };
  return (
    <div className="flex items-center justify-center gap-2">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span
              className={`grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${
                i <= current ? 'bg-brand text-white' : 'bg-gray-200 text-[var(--muted)]'
              }`}
            >
              {i + 1}
            </span>
            <span className={`text-sm ${i === current ? 'font-semibold' : 'text-[var(--muted)]'}`}>
              {labels[s]}
            </span>
          </div>
          {i < steps.length - 1 && <span className="h-px w-6 bg-[var(--border)]" />}
        </div>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

function GenderOption({
  value,
  selected,
  onChange,
  label,
}: {
  value: ProfileGender;
  selected: ProfileGender | '';
  onChange: (value: ProfileGender) => void;
  label: string;
}) {
  const isSelected = selected === value;
  return (
    <label
      className={`flex cursor-pointer items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium ${
        isSelected
          ? 'border-brand bg-blue-50 text-brand'
          : 'border-[var(--border)] bg-white text-[var(--text)] hover:bg-gray-50'
      }`}
    >
      <input
        type="radio"
        name="gender"
        value={value}
        checked={isSelected}
        onChange={() => onChange(value)}
        className="sr-only"
      />
      {label}
    </label>
  );
}

const inputCls = 'w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm';

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',').pop() ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
