import { useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useProfile, type ProfileGender } from '@/lib/useProfile';
import { Spinner } from '@/components/ui/Spinner';
import { Link } from 'react-router-dom';
import { Share2, Check, X } from 'lucide-react';

type Settings = Record<string, any>;

interface MetaConnection {
  meta_user_id: string;
  meta_user_name: string | null;
  meta_user_picture: string | null;
  status: string;
  pages_count: number;
  instagram_accounts_count: number;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block mb-3">
      <span className="block text-sm font-medium mb-1">{label}</span>
      {children}
    </label>
  );
}

export default function SettingsPage() {
  const { profile } = useProfile();
  const [settings, setSettings] = useState<Settings>({});
  const [profileGender, setProfileGender] = useState<ProfileGender | ''>('');
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [metaConnection, setMetaConnection] = useState<MetaConnection | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);

  useEffect(() => {
    setProfileGender(profile?.gender ?? '');
  }, [profile?.gender]);

  useEffect(() => {
    createSupabaseBrowserClient()
      .from('settings')
      .select('key, value_json')
      .then(({ data }) => {
        const next: Settings = {};
        (data ?? []).forEach((row: any) => {
          next[row.key] = row.value_json;
        });
        setSettings(next);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    async function fetchMetaConnection() {
      try {
        const supabase = createSupabaseBrowserClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setMetaLoading(false);
          return;
        }

        console.log('Fetching Meta connection...');
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-meta-connections`,
          {
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
          }
        );

        console.log('Response status:', response.status);
        
        if (response.ok) {
          const data = await response.json();
          console.log('Meta connection data:', data);
          if (data.connection) {
            setMetaConnection({
              meta_user_id: data.connection.meta_user_id,
              meta_user_name: data.connection.meta_user_name,
              meta_user_picture: data.connection.meta_user_picture,
              status: data.connection.status,
              pages_count: data.pages?.length || 0,
              instagram_accounts_count: data.instagram_accounts?.length || 0,
            });
          }
        } else {
          const errorData = await response.json().catch(() => ({ error: 'unknown' }));
          console.error('Meta connection error:', errorData);
          setMetaError(errorData.error || 'Failed to load connection');
        }
      } catch (error) {
        console.error('Failed to fetch Meta connection:', error);
        setMetaError(error instanceof Error ? error.message : 'Network error');
      } finally {
        setMetaLoading(false);
      }
    }

    fetchMetaConnection();
  }, []);

  function update(key: string, value: any) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    const db = createSupabaseBrowserClient();
    await Promise.all(
      Object.entries(settings).map(([key, value]) =>
        db.from('settings').upsert({ key, value_json: value } as never, { onConflict: 'key' })
      ),
    );
    if (profile?.id && profileGender) {
      await db.from('profiles').update({ gender: profileGender } as never).eq('id', profile.id);
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const tpl = settings.whatsapp_templates ?? {};
  const email = settings.email_settings ?? {};
  const aiModels = settings.ai_models ?? {
    image_model: 'gpt-image-2',
    image_size: '1024x1024',
    image_quality: 'auto',
  };
  const approval = settings.approval_mode ?? { mode: 'by_output_type', by_type: {} };
  const approvalQuickReply = settings.whatsapp_approval_quick_reply ?? { enabled: false, content_sid: '' };
  const limits = settings.rate_limits ?? {};
  const budget = settings.request_budget_usd ?? { max: 0.08 };
  // Default to visible: only an explicit stored `false` hides the link.
  const signupVisible = settings.public_signup_visible !== false;
  const requireOnboardingUploads = settings.onboarding_require_uploads === true;
  const input = 'w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm';

  if (loading) return <p className="text-[var(--muted)]"><Spinner /></p>;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-[#071a33]">הגדרות</h1>
        <button onClick={save} className="rounded-lg bg-brand text-white px-4 py-2 text-sm font-semibold">
          {saved ? 'נשמר' : 'שמירת הגדרות'}
        </button>
      </div>

      <div className="space-y-6">

      <section className="bg-white rounded-xl border border-[var(--border)] p-4">
        <h2 className="font-semibold mb-3">הרשמה</h2>
        <div className="mb-4 border-b border-[var(--border)] pb-4">
          <div className="mb-1 text-sm font-medium">לשון פנייה אישית</div>
          <p className="mb-3 text-xs text-[var(--muted)]">
            בחירה זו קובעת אם טקסטים שפונים אליך ביחיד יוצגו בלשון זכר או נקבה.
          </p>
          <div className="grid max-w-md grid-cols-2 gap-2">
            <GenderOption
              value="male"
              selected={profileGender}
              onChange={setProfileGender}
              label="זכר"
            />
            <GenderOption
              value="female"
              selected={profileGender}
              onChange={setProfileGender}
              label="נקבה"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={signupVisible}
            onChange={(e) => update('public_signup_visible', e.target.checked)}
          />
          הצגת הקישור "הירשם" במסך הכניסה
        </label>
        <p className="text-xs text-[var(--muted)] mt-2">
          כשמכובה, אין קישור הרשמה פתוח במסך הכניסה — אפשר עדיין לצרף משתמשים דרך קישורי הזמנה ממותגים
          (משתמשים והרשאות → הזמנות). הרשמה ישירה דרך הכתובת /signup עדיין אפשרית.
        </p>

        <label className="mt-4 flex items-center gap-2 border-t border-[var(--border)] pt-4 text-sm">
          <input
            type="checkbox"
            checked={requireOnboardingUploads}
            onChange={(e) => update('onboarding_require_uploads', e.target.checked)}
          />
          חובה להעלות מסמכים וקבצים באונבורדינג
        </label>
        <p className="text-xs text-[var(--muted)] mt-2">
          כשמופעל, משתמש עם מותג משויך חייב להעלות לפחות מסמך אחד וקובץ אחד בשלבי האונבורדינג לפני
          הכניסה למערכת. שם מלא ולשון פנייה הם תמיד חובה; טלפון ותפקיד הם אופציונליים.
        </p>

        <div className="mt-4 border-t border-[var(--border)] pt-4">
          <div className="mb-1 text-sm font-medium">התקנת האפליקציה</div>
          <p className="text-xs text-[var(--muted)]">
            סגירת הודעת ההתקנה מסתירה אותה ל-24 שעות בפעם הראשונה, לשבוע בפעם השנייה, ולתמיד
            בפעם השלישית. התקנה ידנית: ב-iPhone פותחים ב-Safari, לוחצים שיתוף ובוחרים "הוסף
            למסך הבית"; באנדרואיד או בדסקטופ פותחים את תפריט הדפדפן ובוחרים התקנה או הוספה
            למסך הבית.
          </p>
        </div>
      </section>

      <section className="bg-white rounded-xl border border-[var(--border)] p-4">
        <h2 className="font-semibold mb-3">מייל</h2>
        <Field label="שם שולח">
          <input className={input} value={email.from_name ?? ''} onChange={(e) => update('email_settings', { ...email, from_name: e.target.value })} />
        </Field>
        <Field label="נושא">
          <input className={input} value={email.subject_rule ?? ''} onChange={(e) => update('email_settings', { ...email, subject_rule: e.target.value })} />
        </Field>
        <Field label="חתימה">
          <textarea className={`${input} h-20`} value={email.signature ?? ''} onChange={(e) => update('email_settings', { ...email, signature: e.target.value })} />
        </Field>
      </section>

      <section className="bg-white rounded-xl border border-[var(--border)] p-4">
        <div className="flex items-center gap-2 mb-3">
          <Share2 className="w-5 h-5" />
          <h2 className="font-semibold">רשתות חברתיות (Facebook & Instagram)</h2>
        </div>
        
        {metaLoading ? (
          <div className="py-4">
            <Spinner />
          </div>
        ) : metaConnection ? (
          <div>
            <div className="flex items-center gap-3 mb-4">
              {metaConnection.meta_user_picture && (
                <img 
                  src={metaConnection.meta_user_picture} 
                  alt={metaConnection.meta_user_name || 'משתמש'} 
                  className="w-12 h-12 rounded-full border-2 border-[var(--border)]"
                />
              )}
              <div className="text-sm">
                <div className="font-medium text-[#071a33]">
                  {metaConnection.meta_user_name || 'משתמש'}
                </div>
                <div className="text-[var(--muted)] mt-0.5">
                  {metaConnection.pages_count} דפי פייסבוק
                  {metaConnection.instagram_accounts_count > 0 && 
                    ` • ${metaConnection.instagram_accounts_count} חשבונות אינסטגרם`
                  }
                </div>
              </div>
            </div>
            <Link 
              to="/admin/meta-connection"
              className="inline-block text-sm text-brand hover:underline"
            >
              נהל חיבור ←
            </Link>
          </div>
        ) : (
          <div>
            <p className="text-sm text-[var(--muted)] mb-4">
              חבר את חשבון הרשתות החברתיות שלך כדי לפרסם באופן אוטומטי לפייסבוק ואינסטגרם
            </p>
            <Link 
              to="/admin/meta-connection"
              className="inline-block rounded-lg bg-brand text-white px-4 py-2 text-sm font-semibold hover:bg-brand/90"
            >
              חבר עכשיו
            </Link>
          </div>
        )}
      </section>

      <section className="bg-white rounded-xl border border-[var(--border)] p-4">
        <h2 className="font-semibold mb-3">מודלי AI</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="מודל תמונות">
            <select
              className={input}
              value={aiModels.image_model ?? 'gpt-image-2'}
              onChange={(e) => update('ai_models', { ...aiModels, image_model: e.target.value })}
            >
              <option value="gpt-image-2">gpt-image-2 - המתקדם ביותר</option>
              <option value="gpt-image-1.5">gpt-image-1.5</option>
              <option value="gpt-image-1">gpt-image-1</option>
              <option value="gpt-image-1-mini">gpt-image-1-mini</option>
            </select>
          </Field>
          <Field label="גודל תמונה">
            <select
              className={input}
              value={aiModels.image_size ?? '1024x1024'}
              onChange={(e) => update('ai_models', { ...aiModels, image_size: e.target.value })}
            >
              <option value="1024x1024">1024x1024</option>
              <option value="1536x1024">1536x1024</option>
              <option value="1024x1536">1024x1536</option>
            </select>
          </Field>
          <Field label="איכות">
            <select
              className={input}
              value={aiModels.image_quality ?? 'auto'}
              onChange={(e) => update('ai_models', { ...aiModels, image_quality: e.target.value })}
            >
              <option value="auto">auto</option>
              <option value="high">high</option>
              <option value="medium">medium</option>
              <option value="low">low</option>
            </select>
          </Field>
        </div>
        <p className="text-xs text-[var(--muted)] mt-2">
          ברירת המחדל היא gpt-image-2, המודל המתקדם הנוכחי של OpenAI לתמונות.
        </p>

        <div className="mt-4 border-t border-[var(--border)] pt-4">
          <Field label="מצב הפקת מצגות">
            <select
              className={input}
              value={aiModels.presentation_mode ?? 'auto'}
              onChange={(e) => update('ai_models', { ...aiModels, presentation_mode: e.target.value })}
            >
              <option value="auto">המערכת מכינה מצגת לבד (תמונות + צבעים מוטמעים)</option>
              <option value="gemini">פרומפט ארוך ל-Gemini / NotebookLM</option>
            </select>
          </Field>
          <p className="text-xs text-[var(--muted)]">
            "מצגת לבד" מפיקה קובץ מצגת ממותג עם התמונות של העיר מוטמעות ופלטת הצבעים שלה. "פרומפט ל-Gemini" מפיק טקסט מפורט וקישורים להזנה ידנית ב-NotebookLM (Gemini אינו מטמיע תמונות מקישור או מ-base64).
          </p>
        </div>
      </section>

      <section className="bg-white rounded-xl border border-[var(--border)] p-4">
        <h2 className="font-semibold mb-3">מצב אישור</h2>
        <Field label="מצב כללי">
          <select className={input} value={approval.mode} onChange={(e) => update('approval_mode', { ...approval, mode: e.target.value })}>
            <option value="manual">ידני לכל התוצרים</option>
            <option value="automatic">אוטומטי לאחר בדיקות מערכת</option>
            <option value="by_output_type">לפי סוג תוצר</option>
          </select>
        </Field>
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(approvalQuickReply.enabled)}
            onChange={(e) => update('whatsapp_approval_quick_reply', { ...approvalQuickReply, enabled: e.target.checked })}
          />
          שליחת כפתור "מאשר" ב-WhatsApp
        </label>
        <Field label="Twilio ContentSid לכפתור מאשר">
          <input
            className={input}
            dir="ltr"
            placeholder="HX..."
            value={approvalQuickReply.content_sid ?? ''}
            onChange={(e) => update('whatsapp_approval_quick_reply', { ...approvalQuickReply, content_sid: e.target.value.trim() })}
          />
        </Field>
      </section>

      <section className="bg-white rounded-xl border border-[var(--border)] p-4">
        <h2 className="font-semibold mb-3">מגבלות ושימוש</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="סבבי שאלות מקסימלי">
            <input type="number" inputMode="numeric" className={input} value={settings.question_rounds?.max ?? 3} onChange={(e) => update('question_rounds', { max: Number(e.target.value) })} />
          </Field>
          <Field label="ניסיונות יצירה מקסימלי">
            <input type="number" inputMode="numeric" className={input} value={settings.generation_attempts?.max ?? 3} onChange={(e) => update('generation_attempts', { max: Number(e.target.value) })} />
          </Field>
          <Field label="ניסיונות תמונה מקסימלי">
            <input type="number" inputMode="numeric" min={1} className={input} value={settings.image_generation_attempts?.max ?? 1} onChange={(e) => update('image_generation_attempts', { max: Number(e.target.value) })} />
          </Field>
          <Field label="תקרת עלות לבקשה ($)">
            <input type="number" inputMode="decimal" step="0.01" min={0} className={input} value={budget.max ?? 0.08} onChange={(e) => update('request_budget_usd', { max: Number(e.target.value) })} />
          </Field>
          <Field label="הודעות ל-24 שעות">
            <input type="number" inputMode="numeric" className={input} value={limits.messages_per_24h ?? 50} onChange={(e) => update('rate_limits', { ...limits, messages_per_24h: Number(e.target.value) })} />
          </Field>
          <Field label="יצירות ל-24 שעות">
            <input type="number" inputMode="numeric" className={input} value={limits.generations_per_24h ?? 10} onChange={(e) => update('rate_limits', { ...limits, generations_per_24h: Number(e.target.value) })} />
          </Field>
        </div>
      </section>
      </div>
    </div>
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
  const active = selected === value;
  return (
    <label
      className={`flex min-h-11 cursor-pointer items-center justify-center rounded-lg border px-3 py-2 text-sm font-semibold ${
        active
          ? 'border-brand bg-brand/10 text-brand'
          : 'border-[var(--border)] bg-white text-[var(--text)] hover:bg-gray-50'
      }`}
    >
      <input
        type="radio"
        name="profile_gender"
        value={value}
        checked={active}
        onChange={() => onChange(value)}
        className="sr-only"
      />
      {label}
    </label>
  );
}
