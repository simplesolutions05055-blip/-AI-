import { useEffect, useMemo, useState } from 'react';
import { Check, ExternalLink, Search, TriangleAlert } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

type BrandPatch = Record<string, string | { role: string; hex: string }[]>;
interface CandidateField { key: string; value: string; state: 'trusted' | 'review'; source_url: string; source_label: string }
interface ContentCandidate { title: string; content: string; source_url: string }
interface LocationCandidate { address: string | null; phone: string | null; source_url: string | null }
interface Result {
  client_type: 'business' | 'municipality';
  fields: CandidateField[];
  colors: string[];
  palette?: Array<{ role: string; hex: string }>;
  color_source_url?: string | null;
  content: ContentCandidate[];
  locations: LocationCandidate[];
  parent_brand: { name?: string; source_url?: string } | null;
  website_found: boolean;
  partial: boolean;
  engines: { search: string; website: string };
  warnings: string[];
}

const LABELS: Record<string, string> = {
  name: 'שם המותג', official_name: 'שם רשמי', short_name: 'שם קצר', website: 'אתר', address: 'כתובת',
  phone: 'טלפון', fax: 'פקס', email: 'אימייל', legal_id: 'ח.פ / מזהה רשות', contact_person_name: 'איש קשר',
  contact_person_title: 'תפקיד איש קשר', client_type: 'סוג לקוח', color_palette: 'צבעי מותג',
};

export default function BrandAutofillPanel({ initialQuery, onApply }: {
  initialQuery: string;
  onApply: (patch: BrandPatch, content: ContentCandidate[]) => void;
}) {
  const db = useMemo(() => createSupabaseBrowserClient(), []);
  const [query, setQuery] = useState(initialQuery);
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Verified fields we already pushed onto the form without asking.
  const [autoApplied, setAutoApplied] = useState<Set<string>>(new Set());
  const [selectedContent, setSelectedContent] = useState<Set<number>>(new Set());
  const [contentConsent, setContentConsent] = useState(false);
  const [locationIndex, setLocationIndex] = useState<number | null>(null);
  const [parentDecision, setParentDecision] = useState<'same' | 'parent' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (!query) setQuery(initialQuery); }, [initialQuery]);
  useEffect(() => {
    if (!loading) return;
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [loading]);

  async function run() {
    if (!query.trim()) return;
    setLoading(true); setElapsed(0); setError(null); setResult(null); setAutoApplied(new Set());
    try {
      const looksLikeUrl = /^(?:https?:\/\/)?[^\s]+\.[^\s]+/i.test(query.trim());
      const { data, error: invokeError } = await db.functions.invoke('brand-autofill', {
        body: { query: query.trim(), website: looksLikeUrl ? query.trim() : undefined, include_content: true },
      });
      const payload = data as (Result & { error?: string }) | null;
      if (invokeError || payload?.error || !payload) throw new Error(payload?.error || 'autofill_failed');
      if (payload.colors.length > 0) {
        const { data: colorData } = await db.functions.invoke('analyze-brand-colors', { body: { website_colors: payload.colors, brand_name: payload.fields.find((field) => field.key === 'name')?.value ?? query.trim() } });
        if (Array.isArray(colorData?.colors)) payload.palette = colorData.colors;
      }
      setResult(payload);
      setSelectedContent(new Set());
      setContentConsent(false);
      setLocationIndex(null);
      setParentDecision(null);

      // Verified fields go straight onto the form — no checkbox, no confirm.
      // The only exception is when the answer is genuinely ambiguous: several
      // branches, or a possible parent brand. There we keep the manual flow so
      // the user picks first.
      const trusted = payload.fields.filter((field) => field.state === 'trusted');
      const ambiguous = payload.locations.length > 1 || Boolean(payload.parent_brand?.name);
      if (!ambiguous && (trusted.length || payload.colors.length)) {
        const patch: BrandPatch = {};
        for (const field of trusted) patch[field.key] = field.value;
        if (payload.colors.length) patch.color_palette = payload.palette?.length ? payload.palette : paletteFromColors(payload.colors);
        onApply(patch, []);
        setAutoApplied(new Set([...trusted.map((f) => f.key), ...(payload.colors.length ? ['color_palette'] : [])]));
        setSelected(new Set()); // review fields start unchecked
      } else {
        setAutoApplied(new Set());
        setSelected(new Set(trusted.map((field) => field.key).concat(payload.colors.length ? ['color_palette'] : [])));
      }
    } catch (cause) {
      setError(cause instanceof Error && cause.message === 'robots_disallowed'
        ? 'האתר אינו מאפשר סריקה. אפשר להמשיך בהזנה ידנית.'
        : 'לא הצלחנו להשלים את הבדיקה. אפשר לנסות שוב או להמשיך בהזנה ידנית.');
    } finally { setLoading(false); }
  }

  function toggle(key: string) { setSelected((current) => { const next = new Set(current); next.has(key) ? next.delete(key) : next.add(key); return next; }); }
  function apply() {
    if (!result) return;
    const patch: BrandPatch = {};
    for (const field of result.fields) if (selected.has(field.key)) patch[field.key] = field.value;
    if (selected.has('color_palette')) patch.color_palette = result.palette?.length ? result.palette : paletteFromColors(result.colors);
    if (locationIndex !== null) {
      const location = result.locations[locationIndex];
      if (location?.address) patch.address = location.address;
      if (location?.phone) patch.phone = location.phone;
    }
    if (parentDecision === 'parent') {
      for (const key of ['address', 'phone', 'fax', 'email', 'legal_id', 'contact_person_name', 'contact_person_title']) delete patch[key];
    }
    const content = contentConsent ? result.content.filter((_, index) => selectedContent.has(index)) : [];
    onApply(patch, content);
  }

  const reviewFields = result?.fields.filter((field) => !autoApplied.has(field.key)) ?? [];
  const showColorRow = (result?.colors.length ?? 0) > 0 && !autoApplied.has('color_palette');
  const hasManualWork =
    reviewFields.length > 0 ||
    showColorRow ||
    (result?.locations.length ?? 0) > 1 ||
    Boolean(result?.parent_brand?.name) ||
    (result?.content.length ?? 0) > 0;

  return <div className="mb-6 rounded-2xl border border-brand/25 bg-brand/5 p-4">
    <h2 className="font-bold text-[var(--text)]">מילוי אוטומטי מהאתר הרשמי</h2>
    <p className="mt-1 text-sm text-[var(--muted)]">שדות מאומתים נכנסים לטופס אוטומטית. רק שדות שדורשים אישור מוצגים כאן. שום דבר לא נשמר עד שתלחצו שמירה.</p>
    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
      <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void run(); } }} className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm" dir="auto" placeholder="https://www.example.co.il או שם הארגון" />
      <button type="button" onClick={() => void run()} disabled={loading || !query.trim()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Search size={16} />{loading ? 'קורא ומצליב...' : 'מלאו בשבילי'}</button>
    </div>
    {loading && <div className="mt-4 space-y-2 text-sm" aria-live="polite">
      <Progress done={elapsed >= 1} active={elapsed < 1} label="מאתר את הארגון והאתר הרשמי" />
      <Progress done={elapsed >= 4} active={elapsed >= 1 && elapsed < 4} label="מצליב פרטי קשר עם מקורות" />
      <Progress done={elapsed >= 8} active={elapsed >= 4} label="קורא צבעים ותוכן מהאתר" />
    </div>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {result && <div className="mt-5">
      {result.partial && <div className="mb-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><TriangleAlert className="mt-0.5 shrink-0" size={16} /><span>התקבל מילוי חלקי. כל מנוע עובד בנפרד; בדקו במיוחד שדות צהובים.</span></div>}
      {!result.website_found && <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">לא נמצא אתר רשמי. לא נאסף מידע מאתרי אינדקס. המשיכו ידנית.</div>}
      {autoApplied.size > 0 && (
        <p className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-900">
          {autoApplied.size} שדות שבטוחים בהם כבר הוחלו על הטופס. גללו למטה כדי לראות מה נכנס. כאן מוצגים רק שדות שדורשים אישור.
        </p>
      )}
      <div className="space-y-2">
        {result.fields.filter((field) => !autoApplied.has(field.key)).map((field) => {
          const auto = false;
          return (
            <label key={field.key} className={`flex items-start gap-3 rounded-lg border p-3 ${auto ? 'border-emerald-300 bg-emerald-50' : field.state === 'review' ? 'cursor-pointer border-amber-300 bg-amber-50' : 'cursor-pointer border-emerald-200 bg-emerald-50'}`}>
              {auto
                ? <Check size={16} className="mt-0.5 shrink-0 text-emerald-600" />
                : <input type="checkbox" checked={selected.has(field.key)} onChange={() => toggle(field.key)} className="mt-1" />}
              <span className="min-w-0 flex-1"><strong className="block text-sm">{LABELS[field.key] ?? field.key}</strong><span className="block break-words text-sm" dir="auto">{field.key === 'client_type' ? (field.value === 'municipality' ? 'רשות / גוף ציבורי' : 'עסק') : field.value}</span><a href={field.source_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-brand hover:underline">מקור: {field.source_label}<ExternalLink size={11} /></a></span>
              <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-bold ${auto ? 'bg-emerald-600 text-white' : field.state === 'review' ? 'bg-amber-200 text-amber-950' : 'bg-emerald-200 text-emerald-950'}`}>{auto ? 'עודכן אוטומטית' : field.state === 'review' ? 'דורש אישור' : 'מאומת'}</span>
            </label>
          );
        })}
        {showColorRow && <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3"><input type="checkbox" checked={selected.has('color_palette')} onChange={() => toggle('color_palette')} /><span><strong className="block text-sm">צבעים מהאתר</strong>{result.color_source_url && <a href={result.color_source_url} target="_blank" rel="noreferrer" className="text-xs text-brand underline">מקור: האתר הרשמי</a>}</span><span className="flex flex-wrap gap-1">{result.colors.slice(0, 5).map((color) => <span key={color} title={color} className="h-6 w-6 rounded border border-black/10" style={{ backgroundColor: color }} />)}</span></label>}
      </div>
      {result.locations.length > 1 && <fieldset className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3"><legend className="px-1 text-sm font-bold">נמצאו כמה סניפים. חובה לבחור:</legend>{result.locations.map((location, index) => <label key={index} className="mt-2 flex items-start gap-2 text-sm"><input type="radio" name="brand-location" checked={locationIndex === index} onChange={() => setLocationIndex(index)} className="mt-1" /><span>{location.address || 'ללא כתובת'} · {location.phone || 'ללא טלפון'} {location.source_url && <a href={location.source_url} target="_blank" rel="noreferrer" className="text-brand underline">מקור</a>}</span></label>)}</fieldset>}
      {result.parent_brand?.name && <fieldset className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm"><legend className="px-1 font-bold">ייתכן שזה אתר של מותג אם: {result.parent_brand.name}. חובה לבחור:</legend><label className="mt-2 flex gap-2"><input type="radio" name="parent-brand" checked={parentDecision === 'same'} onChange={() => setParentDecision('same')} />האתר והפרטים שייכים למותג שחיפשתי</label><label className="mt-2 flex gap-2"><input type="radio" name="parent-brand" checked={parentDecision === 'parent'} onChange={() => setParentDecision('parent')} />זה מותג אם; לא להחיל פרטי קשר אוטומטיים</label></fieldset>}
      {result.content.length > 0 && <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3">
        <label className="flex items-start gap-2 text-sm font-semibold"><input type="checkbox" checked={contentConsent} onChange={(event) => { setContentConsent(event.target.checked); if (!event.target.checked) setSelectedContent(new Set()); }} className="mt-1" />אני מאשר/ת לשמור תוכן מהאתר הרשמי במוח העסקי לשימוש פנימי עבור המותג.</label>
        {contentConsent && result.content.map((item, index) => <label key={`${item.source_url}-${index}`} className="mt-2 flex items-start gap-2 rounded-lg bg-white p-2 text-sm"><input type="checkbox" checked={selectedContent.has(index)} onChange={() => setSelectedContent((current) => { const next = new Set(current); next.has(index) ? next.delete(index) : next.add(index); return next; })} className="mt-1" /><span><strong>{item.title}</strong><span className="mt-1 line-clamp-3 block text-[var(--muted)]">{item.content}</span><a href={item.source_url} target="_blank" rel="noreferrer" className="text-xs text-brand underline">מקור</a></span></label>)}
      </div>}
      {hasManualWork && (
        <button type="button" onClick={apply} disabled={(result.locations.length > 1 && locationIndex === null) || (Boolean(result.parent_brand?.name) && parentDecision === null)} className="mt-4 w-full rounded-lg bg-brand py-2.5 font-semibold text-white disabled:opacity-50">החלת השדות שסומנו על הטופס</button>
      )}
    </div>}
  </div>;
}

function Progress({ done, active, label }: { done: boolean; active: boolean; label: string }) { return <div className={`flex items-center gap-2 ${done ? 'text-emerald-700' : active ? 'text-brand' : 'text-[var(--muted)]'}`}><span className={`grid h-5 w-5 place-items-center rounded-full border ${done ? 'border-emerald-600 bg-emerald-600 text-white' : active ? 'animate-pulse border-brand' : 'border-gray-300'}`}>{done && <Check size={13} />}</span>{label}</div>; }
function paletteFromColors(colors: string[]) { const roles = ['primary', 'secondary', 'accent', 'background', 'text']; const defaults = ['#1A4D9C', '#0F766E', '#F59E0B', '#FFFFFF', '#111827']; return roles.map((role, index) => ({ role, hex: colors[index] ?? defaults[index] })); }
