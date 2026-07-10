import { useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useProfile, type ProfileGender } from '@/lib/useProfile';
import { Spinner } from '@/components/ui/Spinner';
import {
  PRODUCTION_PERMISSION_TYPES,
  normalizeOutputPermissions,
  type OutputPermissions,
  type OutputPermissionsRole,
  type ProductionPermissionType,
} from '@/lib/outputPermissions';

type Settings = Record<string, any>;
type SettingsTab = 'whatsapp' | 'signup' | 'permissions' | 'email' | 'models' | 'approval' | 'limits';

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'permissions', label: 'הרשאות תוצרים' },
  { id: 'models', label: 'מודלי AI' },
  { id: 'limits', label: 'מגבלות' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'signup', label: 'הרשמה' },
  { id: 'email', label: 'מייל' },
  { id: 'approval', label: 'אישור' },
];

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
  const [activeTab, setActiveTab] = useState<SettingsTab>('permissions');
  const [resetting, setResetting] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);

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
          // Runtime-managed Twilio Content SIDs must not be copied into the
          // editable form, otherwise a later admin save could overwrite a
          // newer cache created by an Edge Function.
          if (row.key === 'whatsapp_interactive_content_cache') return;
          next[row.key] = row.value_json;
        });
        setSettings(next);
        setLoading(false);
      });
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

  async function resetLiveConversation() {
    if (resetting) return;
    if (!window.confirm('לאפס את השיחות החיות ב-WhatsApp? כל שיחה פעילה תחזור לתפריט הראשי וההודעה הבאה תתחיל מחדש.')) return;
    setResetting(true);
    setResetMsg(null);
    try {
      const { data, error } = await createSupabaseBrowserClient().functions.invoke('reset-conversation', { body: {} });
      if (error || (data as any)?.error) {
        setResetMsg('האיפוס נכשל. נסו שוב.');
      } else {
        const count = (data as any)?.reset ?? 0;
        setResetMsg(count > 0 ? `אופסו ${count} שיחות.` : 'אין כרגע שיחות פעילות לאיפוס.');
      }
    } catch {
      setResetMsg('האיפוס נכשל. נסו שוב.');
    } finally {
      setResetting(false);
      setTimeout(() => setResetMsg(null), 4000);
    }
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
  const outputPermissions = normalizeOutputPermissions(settings.output_permissions);
  const interactiveWhatsAppEnabled = settings.whatsapp_interactive_messages?.enabled === true;
  const groupSettings = settings.whatsapp_group_settings ?? { enabled: false, trigger_word: 'גרפיקה' };
  // Default to visible: only an explicit stored `false` hides the link.
  const signupVisible = settings.public_signup_visible !== false;
  const requireOnboardingUploads = settings.onboarding_require_uploads === true;
  const input = 'w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm';

  if (loading) return <p className="text-[var(--muted)]"><Spinner /></p>;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-normal">הגדרות מערכת</h1>
          <p className="mt-1 hidden text-sm text-[var(--muted)] sm:block">נהלו נוסחים, הרשאות, מיילים, מודלים ומגבלות.</p>
        </div>
        <button onClick={save} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white sm:w-auto">
          {saved ? 'נשמר' : 'שמירת הגדרות'}
        </button>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-white p-1">
        <div className="grid grid-cols-2 gap-1 sm:flex sm:flex-wrap">
          {SETTINGS_TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`min-h-10 rounded-lg px-2 py-2 text-sm font-semibold transition sm:px-3 ${
                  active
                    ? 'bg-brand text-white'
                    : 'text-[var(--muted)] hover:bg-gray-50 hover:text-[var(--text)]'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {activeTab === 'whatsapp' && (
      <section className="bg-white rounded-xl border border-[var(--border)] p-4">
        <h2 className="font-semibold mb-1">WhatsApp</h2>
        <p className="mb-4 text-xs text-[var(--muted)]">הגדירו את חוויית השיחה ואת נוסחי ההודעות של הבוט.</p>

        <label className="mb-5 flex min-h-14 cursor-pointer items-center justify-between gap-4 rounded-xl border border-[var(--border)] bg-gray-50 px-4 py-3">
          <span>
            <span className="block text-sm font-semibold">כפתורים אינטראקטיביים</span>
            <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">
              כשהמתג פעיל, בחירות מוצגות ככפתורים או כרשימה. במקרה תקלה המערכת חוזרת אוטומטית לטקסט.
            </span>
          </span>
          <span className="relative inline-flex shrink-0 items-center">
            <input
              type="checkbox"
              role="switch"
              className="peer sr-only"
              checked={interactiveWhatsAppEnabled}
              aria-label="כפתורים אינטראקטיביים ב-WhatsApp"
              onChange={(e) => update('whatsapp_interactive_messages', { enabled: e.target.checked })}
            />
            <span className="h-7 w-12 rounded-full bg-gray-300 transition peer-checked:bg-brand peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand" />
            <span className="pointer-events-none absolute start-1 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5 rtl:peer-checked:-translate-x-5" />
          </span>
        </label>

        <h3 className="mb-3 text-sm font-semibold">נוסחי הודעות</h3>
        <Field label="קבלת בקשה">
          <input className={input} dir="auto" value={tpl.received ?? ''} onChange={(e) => update('whatsapp_templates', { ...tpl, received: e.target.value })} />
        </Field>
        <Field label="בקשת מייל">
          <input className={input} dir="auto" value={tpl.ask_email ?? ''} onChange={(e) => update('whatsapp_templates', { ...tpl, ask_email: e.target.value })} />
        </Field>
        <Field label="השלמת שליחה">
          <input className={input} dir="auto" value={tpl.sent ?? ''} onChange={(e) => update('whatsapp_templates', { ...tpl, sent: e.target.value })} />
        </Field>
        <Field label="דחיית מדיה">
          <input className={input} dir="auto" value={tpl.rejected_media ?? ''} onChange={(e) => update('whatsapp_templates', { ...tpl, rejected_media: e.target.value })} />
        </Field>

        <div className="mt-5 border-t border-[var(--border)] pt-4">
          <h3 className="mb-1 text-sm font-semibold">בוט בקבוצות</h3>
          <p className="mb-3 text-xs leading-5 text-[var(--muted)]">
            כשהמתג פעיל, הבוט מגיב בקבוצות WhatsApp — אבל רק להודעות שמתחילות במילת ההפעלה
            (למשל "{groupSettings.trigger_word || 'גרפיקה'} תכין לי פוסט"). שאר השיחה בקבוצה לא מפעילה אותו.
            דורש חיבור מספר ייעודי דרך שער קבוצות (ראו תוכנית-בוט-בקבוצת-וואטסאפ).
          </p>
          <label className="mb-3 flex min-h-14 cursor-pointer items-center justify-between gap-4 rounded-xl border border-[var(--border)] bg-gray-50 px-4 py-3">
            <span className="text-sm font-semibold">הפעלת הבוט בקבוצות</span>
            <span className="relative inline-flex shrink-0 items-center">
              <input
                type="checkbox"
                role="switch"
                className="peer sr-only"
                checked={groupSettings.enabled === true}
                aria-label="הפעלת הבוט בקבוצות WhatsApp"
                onChange={(e) => update('whatsapp_group_settings', { ...groupSettings, enabled: e.target.checked })}
              />
              <span className="h-7 w-12 rounded-full bg-gray-300 transition peer-checked:bg-brand peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand" />
              <span className="pointer-events-none absolute start-1 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5 rtl:peer-checked:-translate-x-5" />
            </span>
          </label>
          <Field label="מילת הפעלה">
            <input
              className={input}
              dir="auto"
              value={groupSettings.trigger_word ?? ''}
              placeholder="גרפיקה"
              onChange={(e) => update('whatsapp_group_settings', { ...groupSettings, trigger_word: e.target.value })}
            />
          </Field>
        </div>

        <div className="mt-5 border-t border-[var(--border)] pt-4">
          <h3 className="mb-1 text-sm font-semibold">איפוס שיחה</h3>
          <p className="mb-3 text-xs leading-5 text-[var(--muted)]">
            מאפס את השיחות החיות ב-WhatsApp — סוגר בקשה פתוחה, מנקה את מצב התפריט ומחזיר לתפריט הראשי.
            ההודעה הבאה של הלקוח תתחיל מחדש. לא משפיע על תוצרים שכבר נשלחו.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={resetLiveConversation}
              disabled={resetting}
              className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-60"
            >
              {resetting ? 'מאפס…' : 'אפס שיחה חיה'}
            </button>
            {resetMsg && <span className="text-sm text-[var(--muted)]">{resetMsg}</span>}
          </div>
        </div>
      </section>
      )}

      {activeTab === 'signup' && (
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
            כדי להתקין את האפליקציה, פתחו את תפריט הדפדפן ובחרו התקנה או הוספה למסך הבית.
          </p>
        </div>
      </section>
      )}

      {activeTab === 'permissions' && (
      <section className="bg-white rounded-xl border border-[var(--border)] p-4">
        <h2 className="font-semibold mb-1">הרשאות הפקת תוצרים</h2>
        <p className="mb-4 text-xs text-[var(--muted)]">
          קובע אילו סוגי תוצרים כל תפקיד יכול להפיק. למשתמש רגיל עדיין נדרשת גם הרשאת הפקה כללית במסך משתמשים והרשאות.
        </p>
        <div className="space-y-2 sm:hidden">
          {PRODUCTION_PERMISSION_TYPES.map((item) => (
            <div key={item.type} className="rounded-lg border border-[var(--border)] p-3">
              <div className="mb-3 text-sm font-semibold leading-snug">{item.label}</div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <label className="flex min-h-11 items-center justify-between gap-2 rounded-lg bg-gray-50 px-3">
                  <span>מנהל</span>
                  <PermissionCheckbox
                    permissions={outputPermissions}
                    type={item.type}
                    role="admin"
                    onChange={(next) => update('output_permissions', next)}
                  />
                </label>
                <label className="flex min-h-11 items-center justify-between gap-2 rounded-lg bg-gray-50 px-3">
                  <span>משתמש</span>
                  <PermissionCheckbox
                    permissions={outputPermissions}
                    type={item.type}
                    role="user"
                    onChange={(next) => update('output_permissions', next)}
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
        <div className="hidden overflow-hidden sm:block">
          <table className="w-full table-fixed border-collapse text-sm">
            <colgroup>
              <col />
              <col className="w-16 sm:w-24" />
              <col className="w-20 sm:w-28" />
            </colgroup>
            <thead>
              <tr className="border-b border-[var(--border)] text-right text-xs text-[var(--muted)]">
                <th className="py-2 pe-2 font-semibold">תוצר</th>
                <th className="py-2 text-center font-semibold">מנהל</th>
                <th className="py-2 text-center font-semibold">משתמש<span className="hidden sm:inline"> רגיל</span></th>
              </tr>
            </thead>
            <tbody>
              {PRODUCTION_PERMISSION_TYPES.map((item) => (
                <tr key={item.type} className="border-b border-[var(--border)] last:border-0">
                  <td className="py-3 pe-2 font-medium leading-snug">{item.label}</td>
                  <td className="py-3 text-center">
                    <PermissionCheckbox
                      permissions={outputPermissions}
                      type={item.type}
                      role="admin"
                      onChange={(next) => update('output_permissions', next)}
                    />
                  </td>
                  <td className="py-3 text-center">
                    <PermissionCheckbox
                      permissions={outputPermissions}
                      type={item.type}
                      role="user"
                      onChange={(next) => update('output_permissions', next)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      )}

      {activeTab === 'email' && (
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
      )}

      {activeTab === 'models' && (
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
      </section>
      )}

      {activeTab === 'approval' && (
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
      )}

      {activeTab === 'limits' && (
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
      )}
    </div>
  );
}

function PermissionCheckbox({
  permissions,
  type,
  role,
  onChange,
}: {
  permissions: OutputPermissions;
  type: ProductionPermissionType;
  role: OutputPermissionsRole;
  onChange: (permissions: OutputPermissions) => void;
}) {
  const checked = permissions[type][role];
  return (
    <input
      type="checkbox"
      checked={checked}
      aria-label={`${type}-${role}`}
      onChange={(e) => onChange({
        ...permissions,
        [type]: {
          ...permissions[type],
          [role]: e.target.checked,
        },
      })}
    />
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
