import { useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

type Settings = Record<string, any>;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block mb-3">
      <span className="block text-sm font-medium mb-1">{label}</span>
      {children}
    </label>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({});
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

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

  function update(key: string, value: any) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    const db = createSupabaseBrowserClient();
    await Promise.all(
      Object.entries(settings).map(([key, value]) =>
        db.from('settings').upsert({ key, value_json: value } as never, { onConflict: 'key' })
      )
    );
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
  const input = 'w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm';

  if (loading) return <p className="text-[var(--muted)]">טוען...</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">הגדרות</h1>
        <button onClick={save} className="rounded-lg bg-brand text-white px-4 py-2 text-sm font-semibold">
          {saved ? 'נשמר' : 'שמירת הגדרות'}
        </button>
      </div>

      <section className="bg-white rounded-xl border border-[var(--border)] p-4">
        <h2 className="font-semibold mb-3">נוסחי WhatsApp</h2>
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
            <option value="automatic">אוטומטי לאחר QA</option>
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
        <div className="grid grid-cols-2 gap-3">
          <Field label="סבבי שאלות מקסימלי">
            <input type="number" className={input} value={settings.question_rounds?.max ?? 3} onChange={(e) => update('question_rounds', { max: Number(e.target.value) })} />
          </Field>
          <Field label="ניסיונות יצירה מקסימלי">
            <input type="number" className={input} value={settings.generation_attempts?.max ?? 3} onChange={(e) => update('generation_attempts', { max: Number(e.target.value) })} />
          </Field>
          <Field label="ניסיונות תמונה מקסימלי">
            <input type="number" min={1} className={input} value={settings.image_generation_attempts?.max ?? 1} onChange={(e) => update('image_generation_attempts', { max: Number(e.target.value) })} />
          </Field>
          <Field label="תקרת עלות לבקשה ($)">
            <input type="number" step="0.01" min={0} className={input} value={budget.max ?? 0.08} onChange={(e) => update('request_budget_usd', { max: Number(e.target.value) })} />
          </Field>
          <Field label="הודעות ל-24 שעות">
            <input type="number" className={input} value={limits.messages_per_24h ?? 50} onChange={(e) => update('rate_limits', { ...limits, messages_per_24h: Number(e.target.value) })} />
          </Field>
          <Field label="יצירות ל-24 שעות">
            <input type="number" className={input} value={limits.generations_per_24h ?? 10} onChange={(e) => update('rate_limits', { ...limits, generations_per_24h: Number(e.target.value) })} />
          </Field>
        </div>
      </section>
    </div>
  );
}
