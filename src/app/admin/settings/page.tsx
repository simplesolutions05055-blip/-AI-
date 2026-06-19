'use client';

import { useEffect, useState, useCallback } from 'react';
import SystemPromptModal from '@/components/SystemPromptModal';

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
  const [systemPrompt, setSystemPrompt] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [blocked, setBlocked] = useState<any[]>([]);
  const [newPhone, setNewPhone] = useState('');

  const load = useCallback(async () => {
    const [s, sp, b] = await Promise.all([
      fetch('/api/admin/settings').then((r) => r.json()),
      fetch('/api/admin/system-prompt').then((r) => r.json()),
      fetch('/api/admin/blocked-numbers').then((r) => r.json()),
    ]);
    setSettings(s.settings ?? {});
    setSystemPrompt(sp.active?.content ?? '');
    setBlocked(b.blocked ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function update(key: string, value: any) {
    setSettings((s) => ({ ...s, [key]: value }));
  }

  async function save() {
    await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings }),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function blockNumber() {
    if (!newPhone) return;
    await fetch('/api/admin/blocked-numbers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone_number: newPhone }),
    });
    setNewPhone('');
    load();
  }

  async function unblock(id: string) {
    await fetch(`/api/admin/blocked-numbers?id=${id}`, { method: 'DELETE' });
    load();
  }

  const tpl = settings.whatsapp_templates ?? {};
  const email = settings.email_settings ?? {};
  const approval = settings.approval_mode ?? { mode: 'by_output_type', by_type: {} };
  const limits = settings.rate_limits ?? {};
  const input = 'w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">הגדרות</h1>
        <button onClick={save} className="rounded-lg bg-brand text-white px-4 py-2 text-sm font-semibold">
          {saved ? 'נשמר ✓' : 'שמירת הגדרות'}
        </button>
      </div>

      <section className="bg-white rounded-xl border border-[var(--border)] p-4">
        <h2 className="font-semibold mb-3">System Message</h2>
        <p className="text-sm text-[var(--muted)] mb-3">עריכה מלאה של הנחיות ה־AI ב־Modal ייעודי.</p>
        <button onClick={() => setModalOpen(true)} className="rounded-lg bg-gray-100 px-3 py-2 text-sm">
          פתיחת עורך System Message
        </button>
      </section>

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
        <Field label="נושא (Subject)">
          <input className={input} value={email.subject_rule ?? ''} onChange={(e) => update('email_settings', { ...email, subject_rule: e.target.value })} />
        </Field>
        <Field label="חתימה">
          <textarea className={`${input} h-20`} value={email.signature ?? ''} onChange={(e) => update('email_settings', { ...email, signature: e.target.value })} />
        </Field>
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
        {approval.mode === 'by_output_type' && (
          <div className="grid grid-cols-3 gap-3">
            {(['text', 'image', 'pdf'] as const).map((t) => (
              <Field key={t} label={t === 'text' ? 'טקסט' : t === 'image' ? 'תמונה' : 'PDF'}>
                <select
                  className={input}
                  value={approval.by_type?.[t] ?? 'manual'}
                  onChange={(e) => update('approval_mode', { ...approval, by_type: { ...approval.by_type, [t]: e.target.value } })}
                >
                  <option value="automatic">אוטומטי</option>
                  <option value="manual">ידני</option>
                </select>
              </Field>
            ))}
          </div>
        )}
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
          <Field label="הודעות ל-24 שעות">
            <input type="number" className={input} value={limits.messages_per_24h ?? 50} onChange={(e) => update('rate_limits', { ...limits, messages_per_24h: Number(e.target.value) })} />
          </Field>
          <Field label="יצירות ל-24 שעות">
            <input type="number" className={input} value={limits.generations_per_24h ?? 10} onChange={(e) => update('rate_limits', { ...limits, generations_per_24h: Number(e.target.value) })} />
          </Field>
        </div>
      </section>

      <section className="bg-white rounded-xl border border-[var(--border)] p-4">
        <h2 className="font-semibold mb-3">מספרים חסומים</h2>
        <div className="flex gap-2 mb-3">
          <input dir="ltr" placeholder="+972..." className={input} value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
          <button onClick={blockNumber} className="rounded-lg bg-red-100 text-red-700 px-3 py-2 text-sm whitespace-nowrap">
            חסימה
          </button>
        </div>
        <ul className="space-y-1 text-sm">
          {blocked.map((b) => (
            <li key={b.id} className="flex items-center justify-between border-b border-[var(--border)] py-1">
              <span className="ltr">{b.phone_number}</span>
              <button onClick={() => unblock(b.id)} className="text-brand text-xs">
                הסרה
              </button>
            </li>
          ))}
          {blocked.length === 0 && <li className="text-[var(--muted)]">אין מספרים חסומים.</li>}
        </ul>
      </section>

      {modalOpen && (
        <SystemPromptModal
          initialContent={systemPrompt}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            load();
          }}
        />
      )}
    </div>
  );
}
