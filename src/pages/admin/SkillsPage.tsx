import { useEffect, useMemo, useState, useCallback } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import type { Skill, SkillVersion, SkillCategory } from '@/types/db';

const CATEGORIES: { key: SkillCategory; label: string }[] = [
  { key: 'skill', label: 'סקילים' },
  { key: 'agent', label: 'סוכנים' },
  { key: 'rule', label: 'חוקים' },
];

const input = 'w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm';

export default function SkillsPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
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
      </div>

      {/* category tabs */}
      <div className="flex gap-2 mb-4">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            onClick={() => {
              setActiveCat(c.key);
              setSelectedKey(null);
            }}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${
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
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-sm">{s.display_name}</span>
                <span
                  className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full ${
                    s.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'
                  }`}
                >
                  {s.enabled ? 'פעיל' : 'כבוי'}
                </span>
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
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold">{selected.display_name}</h2>
                  <code className="text-xs text-[var(--muted)] ltr">{selected.key}</code>
                </div>
                <label className="flex items-center gap-2 text-sm shrink-0 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.enabled}
                    onChange={() => toggleEnabled(selected)}
                  />
                  פעיל
                </label>
              </div>

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
