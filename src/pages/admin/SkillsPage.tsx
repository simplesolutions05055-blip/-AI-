import { useEffect, useMemo, useState, useCallback } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { genderCopy } from '@/lib/genderCopy';
import { useProfile } from '@/lib/useProfile';
import type { Skill, SkillVersion, SkillCategory, SkillEnforcement } from '@/types/db';

const CATEGORIES: { key: SkillCategory; label: string }[] = [
  { key: 'skill', label: 'סקילים' },
  { key: 'agent', label: 'סוכנים' },
  { key: 'rule', label: 'חוקים' },
];

// Where the real logic lives, so a developer knows where to edit a code/mixed component.
const CODE_REF: Record<string, string> = {
  'whatsapp-brief-parser': 'supabase/functions/_shared/skills.ts (applyBriefSkillGate) + generate-chat-response / worker.ts',
  'brand-compliance-qa': 'supabase/functions/_shared/worker.ts (generateAndQa)',
  'independent-qa-reviewer': 'supabase/functions/_shared/worker.ts (generateAndQa)',
  'agent-brief-intake': 'supabase/functions/generate-chat-response + _shared/worker.ts',
  'agent-qa1': 'supabase/functions/_shared/worker.ts',
  'agent-qa2': 'supabase/functions/_shared/worker.ts',
  'rule-branding': 'supabase/functions/_shared/skills.ts (applyBriefSkillGate) + _shared/brand.ts',
  'rule-no-fabrication': 'supabase/functions/_shared/skills.ts (applyBriefSkillGate)',
  'rule-public-sector': 'supabase/functions/_shared/brand.ts (municipality block) + brands.client_type',
  'business-onboarding': 'מסך מיתוג (BrandingPage) + _shared/brand.ts',
  'approval-email-composer': 'supabase/functions/send-output + _shared/resend.ts',
  'publishing-rules-meta': 'טרם הוטמע — ייכתב ב-_shared/worker.ts (deliverOutput)',
  'cloud-archive-structurer': 'supabase/functions/_shared/worker.ts (storage upload)',
  'revision-to-rule-converter': 'supabase/functions/_shared/learning.ts + openai.ts (extractRuleLLM)',
  'agent-business-brain': 'supabase/functions/_shared/brand.ts + db.ts',
  'agent-routing': 'supabase/functions/_shared/skills.ts (selectSkills)',
  'agent-approval-orchestrator': 'supabase/functions/_shared/worker.ts',
  'agent-publishing': 'טרם הוטמע — _shared/worker.ts',
  'agent-archive': 'supabase/functions/_shared/worker.ts',
  'agent-learning': 'supabase/functions/_shared/learning.ts',
  'rule-approval': 'supabase/functions/_shared/worker.ts (waiting_for_approval)',
  'rule-two-layers': 'supabase/functions/_shared/worker.ts (generateAndQa)',
  'rule-consistency': 'supabase/functions/_shared/learning.ts (template_locks)',
  'rule-no-delete': 'מעוצב בקוד — אין פעולת DELETE בארגז הכלים (worker.ts)',
  'rule-tenant-isolation': 'migrations RLS + סינון brand_id (worker.ts)',
  'rule-timezone': "supabase/functions/_shared/util.ts + src/lib/format.ts (Asia/Jerusalem)",
  'rule-round-cap': 'supabase/functions/_shared/worker.ts (revision_round)',
};

const ENFORCEMENT: Record<SkillEnforcement, { label: string; chip: string; help: string }> = {
  prompt: {
    label: 'טקסט',
    chip: 'bg-green-100 text-green-700',
    help: 'הטקסט מוזרק כהנחיה. עריכה מהמסך משנה את ההתנהגות מיד.',
  },
  mixed: {
    label: 'משולב',
    chip: 'bg-amber-100 text-amber-700',
    help: 'הטקסט מכוון את המודל, אבל יש שומר-סף בקוד. עריכת הטקסט משנה רק את החלק הרך — הכלל הקשיח מוטמע בקוד.',
  },
  code: {
    label: 'קוד',
    chip: 'bg-red-100 text-red-700',
    help: 'ההיגיון מוטמע בקוד. עריכת הטקסט כאן היא תיעוד בלבד ולא תשנה התנהגות — נדרש שינוי בקוד על ידי מפתח.',
  },
};

const input = 'w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm';

export default function SkillsPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { profile } = useProfile();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [activeCat, setActiveCat] = useState<SkillCategory>('skill');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // editor state
  const [versions, setVersions] = useState<SkillVersion[]>([]);
  const [draft, setDraft] = useState('');
  const [activeContent, setActiveContent] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const loadSkills = useCallback(async () => {
    const { data } = await supabase.from('skills').select('*').order('order_index');
    setSkills((data ?? []) as unknown as Skill[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  const loadVersions = useCallback(
    async (key: string) => {
      const { data } = await supabase
        .from('skill_versions')
        .select('*')
        .eq('skill_key', key)
        .order('version_number', { ascending: false });
      const rows = (data ?? []) as unknown as SkillVersion[];
      setVersions(rows);
      const active = rows.find((v) => v.is_active);
      setActiveContent(active?.content ?? '');
      setDraft(active?.content ?? '');
      setNote('');
    },
    [supabase],
  );

  function selectSkill(key: string) {
    setSelectedKey(key);
    loadVersions(key);
  }

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  const selected = skills.find((s) => s.key === selectedKey) ?? null;
  const dirty = draft !== activeContent;
  const notePrefix = genderCopy(profile?.gender, {
    male: 'שים לב:',
    female: 'שימי לב:',
    neutral: 'חשוב לדעת:',
  });
  const saveEffectWarning = genderCopy(profile?.gender, {
    male: 'גם לאחר שתשמור כאן גרסה חדשה — השינוי',
    female: 'גם לאחר שתשמרי כאן גרסה חדשה — השינוי',
    neutral: 'גם לאחר שמירת גרסה חדשה כאן — השינוי',
  });

  async function saveNewVersion() {
    if (!selected || !dirty) return;
    setSaving(true);
    const { error } = await supabase.rpc('save_skill_version', {
      p_key: selected.key,
      p_content: draft,
      p_note: note || null,
    } as never);
    setSaving(false);
    if (error) return flash('השמירה נכשלה');
    flash('נשמרה גרסה חדשה');
    loadVersions(selected.key);
  }

  async function rollback(versionId: string, num: number) {
    if (!selected) return;
    if (!confirm(`לשחזר לגרסה ${num}? היא תהפוך לגרסה הפעילה.`)) return;
    const { error } = await supabase.rpc('activate_skill_version', { p_version_id: versionId } as never);
    if (error) return flash('השחזור נכשל');
    flash(`שוחזרה גרסה ${num}`);
    loadVersions(selected.key);
  }

  async function toggleEnabled(skill: Skill) {
    const { error } = await supabase
      .from('skills')
      .update({ enabled: !skill.enabled } as never)
      .eq('key', skill.key);
    if (error) return flash('העדכון נכשל');
    setSkills((prev) => prev.map((s) => (s.key === skill.key ? { ...s, enabled: !s.enabled } : s)));
  }

  if (loading) return <p className="text-[var(--muted)]">טוען...</p>;

  const list = skills.filter((s) => s.category === activeCat);

  return (
    <div className="max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">ניהול סקילים</h1>
        <p className="text-sm text-[var(--muted)] mt-1">
          עריכת ההנחיות לכל שלב בתהליך, שמירת גרסאות, ושחזור לגרסה קודמת. כל שמירה יוצרת גרסה חדשה.
        </p>
        {/* legend: what each enforcement tag means */}
        <div className="mt-3 grid gap-2 text-xs sm:flex sm:flex-wrap sm:items-center sm:gap-3">
          {(Object.keys(ENFORCEMENT) as SkillEnforcement[]).map((k) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className={`px-2 py-0.5 rounded-full ${ENFORCEMENT[k].chip}`}>{ENFORCEMENT[k].label}</span>
              <span className="text-[var(--muted)]">{ENFORCEMENT[k].help}</span>
            </span>
          ))}
        </div>
        <p className="mt-2 text-xs text-[var(--muted)] bg-gray-50 border border-[var(--border)] rounded-lg px-3 py-2">
          חשוב: ברכיבים מסוג <strong>קוד</strong> או <strong>משולב</strong>, עריכה ושמירה כאן <strong>לא מספיקה</strong> כדי
          לשנות את ההתנהגות בפועל. שמירת הטקסט רק מתעדת את הכוונה — כדי שהשינוי באמת יעבוד, מפתח צריך להטמיע אותו בקוד
          (במיקום שמופיע בבאנר של הרכיב). רק רכיבים מסוג <strong>טקסט</strong> משתנים מיד עם השמירה.
        </p>
      </div>

      {/* category tabs */}
      <div className="-mx-3 mb-4 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            onClick={() => {
              setActiveCat(c.key);
              setSelectedKey(null);
            }}
            className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium ${
              activeCat === c.key ? 'bg-brand text-white' : 'bg-white border border-[var(--border)] hover:bg-gray-50'
            }`}
          >
            {c.label} ({skills.filter((s) => s.category === c.key).length})
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* skills list */}
        <aside className="lg:col-span-1 space-y-2">
          {list.map((s) => (
            <button
              key={s.key}
              onClick={() => selectSkill(s.key)}
              className={`w-full text-start rounded-xl border p-3 transition ${
                selectedKey === s.key
                  ? 'border-brand bg-brand/5'
                  : 'border-[var(--border)] bg-white hover:bg-gray-50'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-semibold text-sm">{s.display_name}</span>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                  {s.implemented === false && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-800 text-white" title="הרכיב מתועד אך עדיין לא נבנה במערכת">
                      טרם הוטמע
                    </span>
                  )}
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full ${ENFORCEMENT[s.enforcement]?.chip ?? ''}`}
                    title={ENFORCEMENT[s.enforcement]?.help}
                  >
                    {ENFORCEMENT[s.enforcement]?.label}
                  </span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full ${
                      s.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'
                    }`}
                  >
                    {s.enabled ? 'פעיל' : 'כבוי'}
                  </span>
                </div>
              </div>
              {s.description && (
                <p className="text-xs text-[var(--muted)] mt-1 line-clamp-2">{s.description}</p>
              )}
              <code className="text-[10px] text-[var(--muted)] ltr block mt-1">{s.key}</code>
            </button>
          ))}
        </aside>

        {/* editor */}
        <section className="lg:col-span-2">
          {!selected ? (
            <div className="rounded-xl border border-dashed border-[var(--border)] p-10 text-center text-[var(--muted)]">
              בחרו רכיב מהרשימה כדי לערוך אותו.
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-[var(--border)] p-4 space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-lg font-bold">{selected.display_name}</h2>
                  <code className="text-xs text-[var(--muted)] ltr">{selected.key}</code>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {selected.implemented === false && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-white">טרם הוטמע</span>
                  )}
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${ENFORCEMENT[selected.enforcement]?.chip ?? ''}`}
                  >
                    {ENFORCEMENT[selected.enforcement]?.label}
                  </span>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={selected.enabled} onChange={() => toggleEnabled(selected)} />
                    פעיל
                  </label>
                </div>
              </div>

              {selected.implemented === false && (
                <div className="rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-gray-800">
                  <strong>רכיב זה טרם הוטמע במערכת.</strong> ההגדרה כאן היא תיעוד של הכוונה בלבד — אין מאחוריה
                  קוד פעיל, ולכן היא לא משפיעה על שום תהליך עד שהיא תיבנה.
                </div>
              )}

              {selected.enforcement !== 'prompt' && (
                <div
                  className={`rounded-lg border px-3 py-2 text-sm ${
                    selected.enforcement === 'code'
                      ? 'border-red-200 bg-red-50 text-red-800'
                      : 'border-amber-200 bg-amber-50 text-amber-800'
                  }`}
                >
                  {selected.enforcement === 'code' ? (
                    <>
                      <strong>{notePrefix}</strong> ההיגיון של רכיב זה מוטמע בקוד. עריכת הטקסט כאן היא תיעוד בלבד —
                      היא <strong>לא</strong> תשנה את ההתנהגות בפועל. לשינוי אמיתי נדרשת עריכה בקוד על ידי מפתח.
                    </>
                  ) : (
                    <>
                      <strong>{notePrefix}</strong> חלק מההתנהגות מוטמע בקוד (שומר-סף). עריכת הטקסט תשנה רק את ההכוונה
                      הרכה של המודל; הכלל הקשיח נשאר בקוד.
                    </>
                  )}
                  <div className="mt-1.5">
                    {saveEffectWarning} <strong>לא ייכנס לתוקף</strong> עד שמפתח יטמיע אותו בקוד.
                  </div>
                  {CODE_REF[selected.key] && (
                    <div className="mt-1.5 text-xs opacity-90">
                      <span className="font-semibold">מוטמע ב־</span>
                      <code className="ltr">{CODE_REF[selected.key]}</code>
                    </div>
                  )}
                </div>
              )}

              <label className="block">
                <span className="block text-sm font-medium mb-1">הנחיות הרכיב</span>
                <textarea
                  className={`${input} min-h-[50vh] leading-relaxed font-mono text-[13px]`}
                  dir="rtl"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  spellCheck={false}
                />
              </label>

              <label className="block">
                <span className="block text-sm font-medium mb-1">הערת שינוי (אופציונלי)</span>
                <input
                  className={input}
                  dir="rtl"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="מה שונה בגרסה הזו?"
                />
              </label>

              <div className="flex justify-start gap-2">
                <button
                  onClick={saveNewVersion}
                  disabled={saving || !dirty}
                  className="rounded-lg bg-brand text-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
                >
                  {saving ? 'שומר…' : 'שמירת גרסה חדשה'}
                </button>
                {dirty && (
                  <button
                    onClick={() => setDraft(activeContent)}
                    className="rounded-lg bg-gray-100 px-4 py-2 text-sm"
                  >
                    ביטול שינויים
                  </button>
                )}
              </div>

              {/* version history */}
              <div className="border-t border-[var(--border)] pt-4">
                <h3 className="text-sm font-bold mb-2">היסטוריית גרסאות</h3>
                <ul className="space-y-1">
                  {versions.map((v) => (
                    <li
                      key={v.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <span className="font-semibold">גרסה {v.version_number}</span>
                        {v.is_active && (
                          <span className="mr-2 text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                            פעילה
                          </span>
                        )}
                        <span className="text-xs text-[var(--muted)] block ltr">
                          {new Date(v.created_at).toLocaleString('he-IL')}
                        </span>
                        {v.note && <span className="text-xs text-[var(--muted)] block">{v.note}</span>}
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button
                          onClick={() => {
                            setDraft(v.content);
                          }}
                          className="text-xs text-brand hover:underline"
                        >
                          טען לעריכה
                        </button>
                        {!v.is_active && (
                          <button
                            onClick={() => rollback(v.id, v.version_number)}
                            className="text-xs text-[var(--muted)] hover:text-brand"
                          >
                            שחזר
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </section>
      </div>

      {toast && (
        <div className="fixed bottom-4 left-4 z-50 rounded-lg bg-black text-white px-4 py-2 text-sm shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
