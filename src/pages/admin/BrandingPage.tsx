import { type DragEvent, useEffect, useRef, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { randomUUID } from '@/lib/uuid';
import { formatHebrewDateTime } from '@/lib/format';
import {
  brandsToCsv,
  brandToCsv,
  brandCsvTemplate,
  parseBrandCsv,
  downloadCsv,
  slugForFilename,
} from '@/lib/brandCsv';
import type { Brand, BrandAsset, BrandColor, BrandColorRole, BusinessTextSource } from '@/types/db';
import { Spinner } from '@/components/ui/Spinner';
import { useProfile } from '@/lib/useProfile';
import { alertDialog, confirmDialog } from '@/lib/dialog';

const input = 'w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm';
const MAX_LOGO_BYTES = 5 * 1024 * 1024;

const ROLE_LABEL: Record<BrandColorRole, string> = {
  primary: 'ראשי',
  secondary: 'משני',
  accent: 'הדגשה',
  background: 'רקע',
  text: 'טקסט',
};

const DOCUMENT_STYLE_LABEL: Record<NonNullable<Brand['document_style']>, string> = {
  official: 'רשמי',
  modern: 'מודרני',
  municipal: 'עירוני / רשותי',
  legal: 'משפטי',
  commercial: 'מסחרי',
};

const DOCUMENT_USAGE_LABEL: Record<NonNullable<Brand['document_usage']>, string> = {
  print: 'הדפסה',
  digital: 'דיגיטלי',
  both: 'הדפסה ודיגיטל',
};

const FONT_OPTIONS = [
  { value: 'Assistant', label: 'Assistant' },
  { value: 'Heebo', label: 'Heebo' },
  { value: 'Noto Sans Hebrew', label: 'Noto Sans Hebrew' },
  { value: 'Arial', label: 'Arial' },
  { value: 'David', label: 'David' },
  { value: 'FrankRuehl', label: 'FrankRuehl' },
];

const FORMAL_TEXT_FIELDS: Array<{
  key: keyof Brand;
  label: string;
  placeholder?: string;
  multiline?: boolean;
  ltr?: boolean;
}> = [
  { key: 'official_name', label: 'שם הארגון הרשמי', placeholder: 'עיריית מגדל העמק / חברת לדוגמה בע"מ' },
  { key: 'short_name', label: 'שם מקוצר / שם מותג', placeholder: 'מגדל העמק' },
  { key: 'slogan', label: 'סלוגן רשמי', placeholder: 'צומחים. מתחדשים.' },
  { key: 'department_name', label: 'שם מחלקה', placeholder: 'מנהל הכנסות / השירות הווטרינרי' },
  { key: 'contact_person_name', label: 'שם איש קשר', placeholder: 'ישראל ישראלי' },
  { key: 'contact_person_title', label: 'תפקיד איש קשר', placeholder: 'מנהל/ת המחלקה' },
  { key: 'address', label: 'כתובת מלאה', placeholder: 'רחוב, מספר, עיר, מיקוד' },
  { key: 'phone', label: 'טלפון', placeholder: '04-6507000', ltr: true },
  { key: 'fax', label: 'פקס', placeholder: '04-6507222', ltr: true },
  { key: 'email', label: 'אימייל', placeholder: 'office@example.co.il', ltr: true },
  { key: 'website', label: 'אתר', placeholder: 'https://example.co.il', ltr: true },
  { key: 'legal_id', label: 'ח.פ / עמותה / מזהה רשות', placeholder: '500000000', ltr: true },
  { key: 'default_form_number', label: 'מספר טופס ברירת מחדל', placeholder: '012018', ltr: true },
  { key: 'document_footer_text', label: 'נוסח פוטר קבוע', placeholder: 'כתובת, טלפון, פקס או משפט שירות קבוע', multiline: true },
  { key: 'legal_disclaimer', label: 'נוסח משפטי / הצהרה קבועה', placeholder: 'הצהרה, תנאים, אחריות, אישור או התחייבות קבועה', multiline: true },
  { key: 'signature_label', label: 'נוסח חתימה', placeholder: 'חתימת המבקש / חתימת מורשה חתימה' },
];

const emptyBrand = (): Partial<Brand> => ({
  name: '',
  aliases: [],
  color_palette: [],
  style_notes: '',
  is_active: true,
  client_type: 'business',
  show_brand_background: true,
  show_contact_footer: true,
  document_usage: 'print',
  document_style: 'official',
});

export default function BrandingPage() {
  const { profile } = useProfile();
  const isAdmin = profile?.role === 'admin';
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Partial<Brand> | null>(null);
  const [assets, setAssets] = useState<BrandAsset[]>([]);
  const [textSources, setTextSources] = useState<BusinessTextSource[]>([]);
  const [newSourceTitle, setNewSourceTitle] = useState('');
  const [newSourceContent, setNewSourceContent] = useState('');
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [brandLogoUrls, setBrandLogoUrls] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [aliasesText, setAliasesText] = useState('');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [logoModalOpen, setLogoModalOpen] = useState(false);
  const [logoDragActive, setLogoDragActive] = useState(false);
  const [colorSummary, setColorSummary] = useState<string | null>(null);
  const [pendingColors, setPendingColors] = useState<BrandColor[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [logoPreviewOpen, setLogoPreviewOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const anchorRef = useRef<number | null>(null);
  const longPress = useRef<{ timer: number | null; fired: boolean }>({ timer: null, fired: false });
  const logoRef = useRef<HTMLInputElement>(null);
  const assetRef = useRef<HTMLInputElement>(null);
  const textSourceRef = useRef<HTMLInputElement>(null);
  const csvRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [csvModalOpen, setCsvModalOpen] = useState(false);

  const db = createSupabaseBrowserClient();

  async function loadBrands() {
    const { data } = await db.from('brands').select('*').order('created_at', { ascending: false });
    const nextBrands = (data ?? []) as Brand[];
    setBrands(nextBrands);
    setLoading(false);
    await loadBrandLogoUrls(nextBrands);
  }

  useEffect(() => {
    loadBrands();
  }, []);

  useEffect(() => {
    if (!logoPreviewOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLogoPreviewOpen(false);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [logoPreviewOpen]);

  useEffect(() => {
    if (!csvModalOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCsvModalOpen(false);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [csvModalOpen]);

  useEffect(() => {
    if (!logoModalOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLogoModalOpen(false);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [logoModalOpen]);

  async function signedUrl(path: string) {
    const { data } = await db.storage.from('branding').createSignedUrl(path, 600);
    return data?.signedUrl ?? '';
  }

  async function loadBrandLogoUrls(rows: Brand[]) {
    const entries = await Promise.all(
      rows.map(async (brand) => {
        if (!brand.logo_path) return [brand.id, ''] as const;
        return [brand.id, await signedUrl(brand.logo_path)] as const;
      }),
    );
    setBrandLogoUrls(Object.fromEntries(entries));
  }

  async function openBrand(b: Partial<Brand> | null) {
    setSelected(b ?? emptyBrand());
    setAliasesText((b?.aliases ?? []).join(', '));
    setAssets([]);
    setTextSources([]);
    setNewSourceTitle('');
    setNewSourceContent('');
    setPreviews({});
    setLogoFile(null);

    // Scroll to editor on mobile
    setTimeout(() => {
      if (window.innerWidth < 1024) {
        document.getElementById('brand-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 50);

    if (b?.id) {
      const { data } = await db
        .from('brand_assets')
        .select('*')
        .eq('brand_id', b.id)
        .order('created_at', { ascending: true });
      const list = (data ?? []) as BrandAsset[];
      setAssets(list);
      const { data: sources } = await db
        .from('business_text_sources')
        .select('*')
        .eq('brand_id', b.id)
        .order('created_at', { ascending: false });
      setTextSources((sources ?? []) as BusinessTextSource[]);
      // Resolve all preview URLs in parallel — one round-trip each, so a
      // sequential loop made the screen crawl on brands with many assets.
      const next: Record<string, string> = {};
      const [logoUrl, assetUrls] = await Promise.all([
        b.logo_path ? signedUrl(b.logo_path) : Promise.resolve(''),
        Promise.all(list.map((a) => signedUrl(a.storage_path))),
      ]);
      if (b.logo_path) next['__logo'] = logoUrl;
      list.forEach((a, i) => { next[a.id] = assetUrls[i]; });
      setPreviews(next);
    }
  }

  function patch(p: Partial<Brand>) {
    setSelected((cur) => ({ ...(cur ?? {}), ...p }));
  }

  function patchTextField(key: keyof Brand, value: string) {
    patch({ [key]: value.trim() ? value : null } as Partial<Brand>);
  }

  // ── color palette ──────────────────────────────────────────────────────────
  function addColor() {
    const palette = [...(selected?.color_palette ?? [])];
    palette.push({ hex: '#1A4D9C', role: 'primary' });
    patch({ color_palette: palette });
  }
  function updateColor(i: number, c: Partial<BrandColor>) {
    const palette = [...(selected?.color_palette ?? [])];
    palette[i] = { ...palette[i], ...c };
    patch({ color_palette: palette });
  }
  function removeColor(i: number) {
    const palette = [...(selected?.color_palette ?? [])];
    palette.splice(i, 1);
    patch({ color_palette: palette });
  }

  // ── save brand row ───────────────────────────────────────────────────────────
  async function save(): Promise<string | null> {
    if (!selected?.name?.trim()) {
      await alertDialog('שם מקום חובה');
      return null;
    }
    setSaving(true);
    const aliases = aliasesText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const formalRow = {
      official_name: selected.official_name ?? null,
      short_name: selected.short_name ?? null,
      slogan: selected.slogan ?? null,
      department_name: selected.department_name ?? null,
      contact_person_name: selected.contact_person_name ?? null,
      contact_person_title: selected.contact_person_title ?? null,
      address: selected.address ?? null,
      phone: selected.phone ?? null,
      fax: selected.fax ?? null,
      email: selected.email ?? null,
      website: selected.website ?? null,
      legal_id: selected.legal_id ?? null,
      default_form_number: selected.default_form_number ?? null,
      document_footer_text: selected.document_footer_text ?? null,
      legal_disclaimer: selected.legal_disclaimer ?? null,
      signature_label: selected.signature_label ?? null,
      title_font_family: selected.title_font_family ?? null,
      body_font_family: selected.body_font_family ?? null,
      document_style: selected.document_style ?? null,
      show_brand_background: selected.show_brand_background ?? true,
      show_contact_footer: selected.show_contact_footer ?? true,
      document_usage: selected.document_usage ?? 'print',
    };
    const row = isAdmin
      ? {
          name: selected.name.trim(),
          aliases,
          color_palette: selected.color_palette ?? [],
          style_notes: selected.style_notes ?? null,
          is_active: selected.is_active ?? true,
          client_type: selected.client_type ?? 'business',
          logo_path: selected.logo_path ?? null,
          ...formalRow,
        }
      : formalRow;
    let id = selected.id ?? null;
    if (!isAdmin && !id) {
      await alertDialog('משתמש רגיל יכול לערוך רק מותג קיים שהוקצה לו.');
      setSaving(false);
      return null;
    }
    if (id) {
      const { data, error } = await db.from('brands').update(row as never).eq('id', id).select('id');
      if (error) {
        await alertDialog('שמירה נכשלה: ' + error.message);
        setSaving(false);
        return null;
      }
      if (!data || data.length === 0) {
        await alertDialog('השמירה לא בוצעה — ככל הנראה אין הרשאת מנהל (RLS).');
        setSaving(false);
        return null;
      }
    } else {
      const { data, error } = await db.from('brands').insert(row as never).select('id').single();
      if (error || !data) {
        await alertDialog('שמירה נכשלה: ' + (error?.message ?? ''));
        setSaving(false);
        return null;
      }
      id = (data as { id: string }).id;
      patch({ id });
    }
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    await loadBrands();
    return id;
  }

  // ── uploads ──────────────────────────────────────────────────────────────────
  async function pickLogo(file: File | null) {
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) {
      await alertDialog('הלוגו גדול מ-5MB.');
      return;
    }
    setColorSummary(null);
    setPendingColors(null);
    await uploadLogo(file);
    void analyzeLogoColors(file);
  }

  function onLogoDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setLogoDragActive(false);
    void pickLogo(event.dataTransfer.files?.[0] ?? null);
  }

  async function analyzeLogoColors(file: File) {
    setExtracting(true);
    setColorSummary(null);
    setPendingColors(null);
    try {
      const { data, error } = await db.functions.invoke('analyze-brand-colors', {
        body: {
          logo_base64: await fileToBase64(file),
          logo_mime: file.type || 'image/png',
          logo_name: file.name,
          brand_name: selected?.name ?? null,
        },
      });
      const payload = data as {
        error?: string;
        summary?: string;
        colors?: { role: BrandColorRole; hex: string }[];
      } | null;
      if (error || payload?.error) throw new Error(payload?.error ?? 'failed');
      const current = selected?.color_palette ?? [];
      const fallbackRoles: BrandColorRole[] = ['primary', 'secondary', 'accent', 'background', 'text'];
      const next = fallbackRoles.map((role, index) => {
        const found = payload?.colors?.find((color) => color.role === role);
        const currentColor = current.find((color) => color.role === role) ?? current[index];
        return { role, hex: found?.hex ?? currentColor?.hex ?? '#1A4D9C' };
      });
      setPendingColors(next);
      setColorSummary(payload?.summary ?? 'זוהו צבעי מותג מרכזיים.');
    } catch (e) {
      console.error(e);
      setColorSummary('זיהוי הצבעים נכשל. אפשר לבחור צבעים ידנית.');
    } finally {
      setExtracting(false);
    }
  }

  function updatePendingColor(index: number, color: Partial<BrandColor>) {
    setPendingColors((cur) => {
      const next = [...(cur ?? [])];
      next[index] = { ...next[index], ...color };
      return next;
    });
  }

  function confirmPendingColors() {
    if (!pendingColors) return;
    if (!pendingColors.every((color) => isValidHexColor(color.hex))) {
      void alertDialog('יש צבע לא תקין. צריך להזין ערך HEX מלא, למשל #1A4D9C.');
      return;
    }
    patch({ color_palette: pendingColors });
    setPendingColors(null);
    setColorSummary('צבעי המותג נשמרו בבחירה הנוכחית.');
  }

  async function uploadLogo(file: File) {
    setLogoFile(file);
    const id = selected?.id ?? (await save());
    if (!id) return;
    const ext = file.name.split('.').pop() || 'png';
    const path = `${id}/logo.${ext}`;
    const { error } = await db.storage.from('branding').upload(path, file, { upsert: true, contentType: file.type });
    if (error) {
      await alertDialog('העלאה נכשלה: ' + error.message);
      return;
    }
    await db.from('brands').update({ logo_path: path } as never).eq('id', id);
    patch({ logo_path: path });
    const localUrl = URL.createObjectURL(file);
    setPreviews((p) => ({ ...p, __logo: localUrl }));
    setBrandLogoUrls((p) => ({ ...p, [id]: localUrl }));
    await loadBrands();
  }

  async function uploadAsset(file: File) {
    const id = selected?.id ?? (await save());
    if (!id) return;
    const ext = file.name.split('.').pop() || 'png';
    const path = `${id}/assets/${randomUUID()}.${ext}`;
    const { error } = await db.storage.from('branding').upload(path, file, { contentType: file.type });
    if (error) {
      await alertDialog('העלאה נכשלה: ' + error.message);
      return;
    }
    const { data } = await db
      .from('brand_assets')
      .insert({ brand_id: id, storage_path: path, mime_type: file.type } as never)
      .select('*')
      .single();
    if (data) {
      const a = data as BrandAsset;
      setAssets((cur) => [...cur, a]);
      setPreviews((p) => ({ ...p, [a.id]: URL.createObjectURL(file) }));
    }
  }

  async function removeAsset(a: BrandAsset) {
    await db.storage.from('branding').remove([a.storage_path]);
    await db.from('brand_assets').delete().eq('id', a.id);
    setAssets((cur) => cur.filter((x) => x.id !== a.id));
  }

  async function updateAssetCaption(a: BrandAsset, caption: string) {
    if (caption === (a.caption ?? '')) return;
    await db.from('brand_assets').update({ caption } as never).eq('id', a.id);
    setAssets((cur) => cur.map((x) => (x.id === a.id ? { ...x, caption } : x)));
  }

  async function addTextSource(title: string, content: string) {
    const cleanContent = content.trim();
    if (!cleanContent) return;
    const id = selected?.id ?? (await save());
    if (!id) return;
    const cleanTitle = title.trim() || 'מקור תוכן';
    const { data, error } = await db
      .from('business_text_sources')
      .insert({ brand_id: id, title: cleanTitle, content: cleanContent, source_kind: 'content_only' } as never)
      .select('*')
      .single();
    if (error || !data) {
      await alertDialog('שמירת מקור התוכן נכשלה: ' + (error?.message ?? ''));
      return;
    }
    setTextSources((cur) => [data as BusinessTextSource, ...cur]);
    setNewSourceTitle('');
    setNewSourceContent('');
  }

  async function uploadTextSource(file: File) {
    try {
      let text = '';
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.txt') || lower.endsWith('.md')) {
        text = await file.text();
      } else {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ''));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        const base64 = dataUrl.split(',')[1] ?? '';
        const { data, error } = await db.functions.invoke('process-upload', {
          body: { kind: 'document', base64, mime: file.type, name: file.name },
        });
        if (error || !data?.ok) throw new Error(error?.message ?? data?.error ?? 'עיבוד הקובץ נכשל');
        text = (data.text as string) ?? '';
      }
      await addTextSource(file.name.replace(/\.[^.]+$/, ''), text.slice(0, 40000));
    } catch (error) {
      await alertDialog('עיבוד מקור התוכן נכשל: ' + String(error));
    } finally {
      if (textSourceRef.current) textSourceRef.current.value = '';
    }
  }

  async function removeTextSource(source: BusinessTextSource) {
    await db.from('business_text_sources').delete().eq('id', source.id);
    setTextSources((cur) => cur.filter((x) => x.id !== source.id));
  }

  async function updateTextSource(source: BusinessTextSource, patchValues: Partial<Pick<BusinessTextSource, 'title' | 'content'>>) {
    const title = patchValues.title?.trim();
    const content = patchValues.content?.trim();
    const payload: Partial<Pick<BusinessTextSource, 'title' | 'content'>> = {};
    if (title !== undefined && title && title !== source.title) payload.title = title;
    if (content !== undefined && content && content !== source.content) payload.content = content;
    if (Object.keys(payload).length === 0) return;
    const { error } = await db.from('business_text_sources').update(payload as never).eq('id', source.id);
    if (error) {
      await alertDialog('עדכון מקור התוכן נכשל: ' + error.message);
      return;
    }
    setTextSources((cur) => cur.map((x) => (x.id === source.id ? { ...x, ...payload } : x)));
  }

  async function removeBrand(b: Brand) {
    if (!(await confirmDialog({ message: `למחוק את "${b.name}"? פעולה בלתי הפיכה.`, danger: true, confirmText: 'מחיקה' }))) return;
    await db.from('brands').delete().eq('id', b.id);
    if (selected?.id === b.id) setSelected(null);
    setSelectedIds((s) => {
      const n = new Set(s);
      n.delete(b.id);
      return n;
    });
    await loadBrands();
  }

  // ── multi-select (click / shift+click range / long-press range) ──────────────
  function selectRange(from: number, to: number) {
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    setSelectedIds((s) => {
      const n = new Set(s);
      for (let i = lo; i <= hi; i++) n.add(brands[i].id);
      return n;
    });
  }
  function toggleOne(id: string) {
    setSelectedIds((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function pickRow(index: number, range: boolean) {
    if (range && anchorRef.current !== null) {
      selectRange(anchorRef.current, index);
    } else {
      toggleOne(brands[index].id);
      anchorRef.current = index;
    }
  }
  // long-press = range from anchor to this row (touch-friendly alternative to shift)
  function pressStart(index: number) {
    longPress.current.fired = false;
    longPress.current.timer = window.setTimeout(() => {
      longPress.current.fired = true;
      pickRow(index, true);
    }, 450);
  }
  function pressEnd() {
    if (longPress.current.timer) {
      clearTimeout(longPress.current.timer);
      longPress.current.timer = null;
    }
  }
  function toggleAll() {
    setSelectedIds((s) => (s.size === brands.length ? new Set() : new Set(brands.map((b) => b.id))));
  }

  async function bulkSetActive(active: boolean) {
    const ids = [...selectedIds];
    if (!ids.length) return;
    await db.from('brands').update({ is_active: active } as never).in('id', ids);
    await loadBrands();
  }
  async function bulkDelete() {
    const ids = [...selectedIds];
    if (!ids.length) return;
    if (!(await confirmDialog({ message: `למחוק ${ids.length} מקומות? פעולה בלתי הפיכה.`, danger: true, confirmText: 'מחיקה' }))) return;
    // best-effort: remove their storage folders too
    for (const id of ids) {
      const { data: files } = await db.storage.from('branding').list(id);
      if (files?.length) await db.storage.from('branding').remove(files.map((f) => `${id}/${f.name}`));
      const { data: assetFiles } = await db.storage.from('branding').list(`${id}/assets`);
      if (assetFiles?.length) await db.storage.from('branding').remove(assetFiles.map((f) => `${id}/assets/${f.name}`));
    }
    await db.from('brands').delete().in('id', ids);
    if (selected?.id && ids.includes(selected.id)) setSelected(null);
    setSelectedIds(new Set());
    await loadBrands();
  }

  // ── CSV export / import ──────────────────────────────────────────────────────
  /** Attach each brand's text sources (one query for the whole set). */
  async function withSources(list: Brand[]) {
    const ids = list.map((b) => b.id);
    if (!ids.length) return list.map((b) => ({ ...b, sources: [] }));
    const { data } = await db
      .from('business_text_sources')
      .select('brand_id,title,content')
      .in('brand_id', ids)
      .order('created_at', { ascending: true });
    const byBrand = new Map<string, { title: string; content: string }[]>();
    for (const s of (data ?? []) as { brand_id: string; title: string; content: string }[]) {
      const arr = byBrand.get(s.brand_id) ?? [];
      arr.push({ title: s.title ?? '', content: s.content ?? '' });
      byBrand.set(s.brand_id, arr);
    }
    return list.map((b) => ({ ...b, sources: byBrand.get(b.id) ?? [] }));
  }

  async function exportAll() {
    if (!brands.length) return;
    const selectedBrands = selectedIds.size > 0 ? brands.filter((b) => selectedIds.has(b.id)) : brands;
    downloadCsv('branding', brandsToCsv(await withSources(selectedBrands)));
  }

  async function exportOne(b: Brand) {
    const [withSrc] = await withSources([b]);
    downloadCsv(`branding-${slugForFilename(b.name)}`, brandToCsv(withSrc));
  }

  async function importCsv(file: File) {
    setImporting(true);
    try {
      const text = await file.text();
      const { rows, errors, hasSourceColumns } = parseBrandCsv(text);
      if (!rows.length) {
        await alertDialog('לא נמצאו שורות תקינות בקובץ.\n' + errors.join('\n'));
        return;
      }
      // Match by name (case-insensitive) against existing brands → update, else insert.
      const byName = new Map(brands.map((b) => [b.name.trim().toLowerCase(), b]));
      let inserted = 0;
      let updated = 0;
      const failures: string[] = [];
      for (const row of rows) {
        const payload = {
          name: row.name,
          aliases: row.aliases,
          color_palette: row.color_palette,
          style_notes: row.style_notes || null,
          is_active: row.is_active,
        };
        const existing = byName.get(row.name.trim().toLowerCase());
        let brandId = existing?.id ?? null;
        if (existing) {
          const { error } = await db.from('brands').update(payload as never).eq('id', existing.id);
          if (error) failures.push(`${row.name}: ${error.message}`);
          else updated++;
        } else {
          const { data, error } = await db.from('brands').insert(payload as never).select('id').single();
          if (error || !data) failures.push(`${row.name}: ${error?.message ?? ''}`);
          else {
            brandId = (data as { id: string }).id;
            inserted++;
          }
        }
        // Sync text sources only when the CSV actually declares source_* columns,
        // so a CSV without them never wipes a brand's existing content.
        if (brandId && hasSourceColumns) {
          await db.from('business_text_sources').delete().eq('brand_id', brandId);
          if (row.sources.length) {
            const { error } = await db.from('business_text_sources').insert(
              row.sources.map((s) => ({
                brand_id: brandId,
                title: s.title,
                content: s.content,
                source_kind: 'content_only',
              })) as never
            );
            if (error) failures.push(`${row.name} (מקורות תוכן): ${error.message}`);
          }
        }
      }
      await loadBrands();
      const summary = `ייבוא הסתיים: ${inserted} נוספו, ${updated} עודכנו.`;
      const detail = [...errors, ...failures.map((f) => 'שמירה נכשלה — ' + f)];
      await alertDialog(detail.length ? `${summary}\n\n${detail.join('\n')}` : summary);
    } catch (e) {
      await alertDialog('קריאת הקובץ נכשלה: ' + String(e));
    } finally {
      setImporting(false);
      if (csvRef.current) csvRef.current.value = '';
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold leading-tight tracking-normal">ניהול מותג</h1>
          <p className="mt-1 max-w-xl text-sm leading-6 text-[var(--muted)]">
            {isAdmin
              ? 'עדכנו פרטי מותג, לוגו, צבעים ומקורות תוכן.'
              : 'עדכנו פרטי מסמכים וטפסים רשמיים של המותגים שהוקצו לכם.'}
            {!loading && brands.length > 0 && (
              <span className="font-medium text-[var(--text)]"> · {brands.length} מקומות</span>
            )}
          </p>
        </div>
        {isAdmin && (
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <input
            ref={csvRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              setCsvModalOpen(false);
              e.target.files?.[0] && importCsv(e.target.files[0]);
            }}
          />
          <button
            onClick={() => setCsvModalOpen(true)}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium hover:bg-gray-50"
          >
            הוספה מרובה
          </button>
          <button onClick={() => openBrand(null)} className="rounded-lg bg-brand text-white px-4 py-2 text-sm font-semibold">
            הוספת מקום
          </button>
        </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
        {/* list */}
        <section className="max-h-[45dvh] min-w-0 overflow-auto rounded-xl border border-[var(--border)] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] xl:max-h-none">
          {/* bulk action bar */}
          {isAdmin && selectedIds.size > 0 && (
            <div className="flex items-center justify-between gap-2 bg-gray-50 border-b border-[var(--border)] px-3 py-2 text-sm">
              <span className="text-[var(--muted)]">נבחרו {selectedIds.size}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => bulkSetActive(true)}
                  className="rounded-md border border-brand bg-brand px-3 py-1 text-xs font-medium text-white transition-colors hover:opacity-90"
                >
                  הפעלה
                </button>
                <button
                  onClick={() => bulkSetActive(false)}
                  className="rounded-md border border-[var(--border)] bg-white px-3 py-1 text-xs font-medium text-[var(--muted)] transition-colors hover:bg-gray-100"
                >
                  השבתה
                </button>
                <button
                  onClick={bulkDelete}
                  className="rounded-md border border-red-200 bg-white px-3 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50"
                >
                  מחיקה
                </button>
              </div>
            </div>
          )}
          {loading ? (
            <p className="p-4 text-[var(--muted)]"><Spinner /></p>
          ) : brands.length === 0 ? (
            <p className="p-4 text-[var(--muted)] text-sm">אין מקומות עדיין.</p>
          ) : (
            <table className="w-full text-sm" dir="rtl">
              <thead>
                <tr className="text-[var(--muted)] border-b border-[var(--border)]">
                  <th className="p-2 w-8">
                    {isAdmin && (
                    <input
                      type="checkbox"
                      checked={selectedIds.size === brands.length && brands.length > 0}
                      ref={(el) => {
                        if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < brands.length;
                      }}
                      onChange={toggleAll}
                    />
                    )}
                  </th>
                  <th className="text-start p-2">מקום</th>
                  <th className="hidden p-2 text-start sm:table-cell sm:w-16">סטטוס</th>
                </tr>
              </thead>
              <tbody>
                {brands.map((b, i) => {
                  const checked = selectedIds.has(b.id);
                  return (
                    <tr
                      key={b.id}
                      className={`border-b border-[var(--border)] last:border-0 cursor-pointer select-none ${
                        checked ? 'bg-blue-50' : selected?.id === b.id ? 'bg-gray-100' : 'hover:bg-gray-50'
                      }`}
                    >
                      <td className="p-2 text-center">
                        {isAdmin && (
                        <input
                          type="checkbox"
                          checked={checked}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (longPress.current.fired) {
                              longPress.current.fired = false;
                              return; // long-press already handled range selection
                            }
                            pickRow(i, (e as React.MouseEvent).shiftKey);
                          }}
                          onChange={() => {}}
                          onPointerDown={() => pressStart(i)}
                          onPointerUp={pressEnd}
                          onPointerLeave={pressEnd}
                        />
                        )}
                      </td>
                      <td className="min-w-0 p-2 font-medium" onClick={() => openBrand(b)}>
                        <div className="flex min-w-0 items-center gap-2">
                          <BrandListLogo name={b.name} url={brandLogoUrls[b.id] ?? ''} />
                          <span className="min-w-0 truncate">{b.name}</span>
                        </div>
                      </td>
                      <td className="hidden p-2 sm:table-cell" onClick={() => openBrand(b)}>
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                            b.is_active
                              ? 'bg-green-50 text-green-700'
                              : 'bg-gray-100 text-[var(--muted)]'
                          }`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${b.is_active ? 'bg-green-500' : 'bg-gray-400'}`} />
                          {b.is_active ? 'פעיל' : 'כבוי'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        {/* editor */}
        {selected && (
          <section id="brand-editor" className="scroll-mt-4 mt-4 min-w-0 space-y-4 rounded-xl border border-[var(--border)] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] xl:mt-0">
            <div className="sticky top-0 z-20 -mx-4 -mt-4 flex flex-col gap-2 border-b border-[var(--border)] bg-white p-4 before:absolute before:inset-x-0 before:-top-3 before:h-3 before:bg-white before:content-[''] sm:static sm:mx-0 sm:mt-0 sm:flex-row sm:items-center sm:justify-between sm:border-0 sm:bg-transparent sm:p-0 sm:before:hidden">
              <h2 className="relative z-10 font-semibold">{selected.id ? 'עריכת מקום' : 'מקום חדש'}</h2>
              <div className="relative z-10 flex flex-wrap gap-2">
                {selected.id && (
                  isAdmin && (
                  <button
                    onClick={() => exportOne(selected as Brand)}
                    className="text-xs text-brand px-3 py-2"
                  >
                    הורד CSV
                  </button>
                  )
                )}
                {selected.id && (
                  isAdmin && (
                  <button
                    onClick={() => removeBrand(selected as Brand)}
                    className="text-xs text-red-600 px-3 py-2"
                  >
                    מחיקה
                  </button>
                  )
                )}
                <button onClick={save} className="rounded-lg bg-brand text-white px-4 py-2 text-sm font-semibold">
                  {saving ? 'שומר...' : saved ? 'נשמר ✓' : 'שמירה'}
                </button>
              </div>
            </div>

            <label className="block">
              <span className="block text-sm font-medium mb-1">שם המקום</span>
              <input
                className={input}
                dir="auto"
                value={selected.name ?? ''}
                onChange={(e) => patch({ name: e.target.value })}
                disabled={!isAdmin}
              />
            </label>

            {isAdmin && (
            <>
            <label className="block">
              <span className="block text-sm font-medium mb-1">שמות נרדפים (מופרדים בפסיק)</span>
              <input
                className={input}
                dir="auto"
                placeholder="ק. שמונה, קריית שמונה"
                value={aliasesText}
                onChange={(e) => setAliasesText(e.target.value)}
              />
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={selected.is_active ?? true} onChange={(e) => patch({ is_active: e.target.checked })} />
              מקום פעיל
            </label>

            <label className="block">
              <span className="block text-sm font-medium mb-1">סוג לקוח</span>
              <select
                className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
                value={selected.client_type ?? 'business'}
                onChange={(e) => patch({ client_type: e.target.value as 'business' | 'municipality' })}
              >
                <option value="business">עסק</option>
                <option value="municipality">רשות מקומית / עירייה</option>
              </select>
              <span className="block text-xs text-[var(--muted)] mt-1">
                "רשות מקומית" מפעיל אוטומטית את חוק 9: שפה רשמית, ללא סלנג, ונגישות (WCAG).
              </span>
            </label>

            {/* logo */}
            <div>
              <span className="block text-sm font-medium mb-1">לוגו</span>
              <div className="flex flex-col items-center gap-2 sm:items-start">
                <button
                  type="button"
                  onClick={() => setLogoModalOpen(true)}
                  className="grid h-28 w-28 place-items-center overflow-hidden rounded-2xl border border-[var(--border)] bg-gray-50 transition hover:border-brand hover:bg-brand/5 focus:outline-none focus:ring-2 focus:ring-brand/30 sm:h-32 sm:w-32"
                  aria-label="העלאת לוגו"
                >
                  {previews['__logo'] ? (
                    <img src={previews['__logo']} alt="logo" className="h-full w-full object-contain p-3" />
                  ) : (
                    <span className="text-sm font-semibold text-[var(--muted)]">לוגו</span>
                  )}
                </button>
                <span className="text-xs text-[var(--muted)]">אופציונלי, עד 5MB</span>
              </div>
            </div>

            {/* palette */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium">פלטת צבעים</span>
                <button onClick={addColor} className="text-xs text-brand">+ הוספת צבע</button>
              </div>
              <div className="space-y-2">
                {(selected.color_palette ?? []).map((c, i) => (
                  <div key={i} className="flex flex-nowrap items-center gap-2">
                    <span
                      className="relative h-12 w-14 shrink-0 overflow-hidden rounded-lg border border-[var(--border)] shadow-sm"
                      style={{ backgroundColor: isValidHexColor(c.hex) ? c.hex : '#000000' }}
                      title="לחץ לבחירת צבע מדויק"
                    >
                      <input
                        type="color"
                        value={isValidHexColor(c.hex) ? c.hex : '#000000'}
                        onChange={(e) => updateColor(i, { hex: e.target.value.toUpperCase() })}
                        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                        aria-label={`צבע ${ROLE_LABEL[c.role] ?? 'מותג'}`}
                      />
                    </span>
                    <input
                      className={`${input} ltr !w-24 shrink-0`}
                      value={c.hex}
                      onChange={(e) => updateColor(i, { hex: e.target.value })}
                    />
                    <select className={`${input} flex-1 min-w-0`} value={c.role} onChange={(e) => updateColor(i, { role: e.target.value as BrandColorRole })}>
                      {Object.entries(ROLE_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                    <button onClick={() => removeColor(i)} className="text-xs text-red-600 px-1 shrink-0">הסר</button>
                  </div>
                ))}
              </div>
            </div>

            {/* style notes */}
            <label className="block">
              <span className="block text-sm font-medium mb-1">הנחיות סגנון</span>
              <textarea
                className={`${input} h-24`}
                dir="auto"
                placeholder="טון רשמי אך חמים, פנייה לתושבים..."
                value={selected.style_notes ?? ''}
                onChange={(e) => patch({ style_notes: e.target.value })}
              />
            </label>
            </>
            )}

            <div className="rounded-lg border border-[var(--border)] p-3">
              <div className="mb-3">
                <span className="block text-sm font-semibold">מסמכים וטפסים רשמיים</span>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                  שדות אופציונליים לתבניות PDF רשמיות: טפסים, אישורים, הצהרות והוראות תשלום. השארת שדה ריק לא תחייב אותו בתוצר.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {FORMAL_TEXT_FIELDS.map((field) => {
                  const raw = selected[field.key];
                  const value = typeof raw === 'string' ? raw : '';
                  const className = field.multiline ? `${input} h-24 text-right` : `${input} text-right`;
                  return (
                    <label key={String(field.key)} className={field.multiline ? 'block md:col-span-2' : 'block'}>
                      <span className="mb-1 block text-sm font-medium">{field.label}</span>
                      {field.multiline ? (
                        <textarea
                          className={className}
                          dir="rtl"
                          placeholder={field.placeholder}
                          value={value}
                          onChange={(e) => patchTextField(field.key, e.target.value)}
                        />
                      ) : (
                        <input
                          className={className}
                          dir={field.ltr ? 'ltr' : 'auto'}
                          style={{ textAlign: 'right' }}
                          placeholder={field.placeholder}
                          value={value}
                          onChange={(e) => patchTextField(field.key, e.target.value)}
                        />
                      )}
                    </label>
                  );
                })}

                <label className="block">
                  <span className="mb-1 block text-sm font-medium">סגנון מסמך</span>
                  <select
                    className={input}
                    value={selected.document_style ?? ''}
                    onChange={(e) => patch({ document_style: (e.target.value || null) as Brand['document_style'] })}
                  >
                    <option value="">לא הוגדר</option>
                    {Object.entries(DOCUMENT_STYLE_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium">פונט לכותרות</span>
                  <select
                    className={input}
                    value={selected.title_font_family ?? ''}
                    onChange={(e) => patch({ title_font_family: e.target.value || null })}
                  >
                    <option value="">ברירת מחדל</option>
                    {FONT_OPTIONS.map((font) => (
                      <option key={font.value} value={font.value}>{font.label}</option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium">פונט לטקסט רגיל</span>
                  <select
                    className={input}
                    value={selected.body_font_family ?? ''}
                    onChange={(e) => patch({ body_font_family: e.target.value || null })}
                  >
                    <option value="">ברירת מחדל</option>
                    {FONT_OPTIONS.map((font) => (
                      <option key={font.value} value={font.value}>{font.label}</option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium">שימוש עיקרי</span>
                  <select
                    className={input}
                    value={selected.document_usage ?? ''}
                    onChange={(e) => patch({ document_usage: (e.target.value || null) as Brand['document_usage'] })}
                  >
                    <option value="">לא הוגדר</option>
                    {Object.entries(DOCUMENT_USAGE_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.show_brand_background ?? true}
                    onChange={(e) => patch({ show_brand_background: e.target.checked })}
                  />
                  להציג רקע / סימן מים מותגי במסמכים
                </label>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.show_contact_footer ?? true}
                    onChange={(e) => patch({ show_contact_footer: e.target.checked })}
                  />
                  להציג פרטי קשר בפוטר
                </label>
              </div>
            </div>

            {/* content brain */}
            <div className="rounded-lg border border-[var(--border)] p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <span className="block text-sm font-medium">אזור תוכן</span>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                    חומרים שכל מי ששייך למותג יכול להוסיף ולערוך. המערכת משתמשת בהם לעובדות, מסרים, שירותים וניסוחים בכל התוצרים.
                  </p>
                </div>
                <div className="shrink-0">
                  <input
                    ref={textSourceRef}
                    type="file"
                    accept=".txt,.md,.docx,.pdf,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && uploadTextSource(e.target.files[0])}
                  />
                  <button
                    onClick={() => textSourceRef.current?.click()}
                    className="rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white hover:bg-brand-dark"
                  >
                    + העלאת מסמך תוכן
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <input
                  className={input}
                  dir="rtl"
                  placeholder="שם המקור"
                  value={newSourceTitle}
                  onChange={(e) => setNewSourceTitle(e.target.value)}
                />
                <textarea
                  className={`${input} h-20`}
                  dir="rtl"
                  placeholder="הדבק כאן טקסט עסקי, שירותים, מסרים, FAQ או ניסוחים קיימים"
                  value={newSourceContent}
                  onChange={(e) => setNewSourceContent(e.target.value)}
                />
                <button
                  onClick={() => addTextSource(newSourceTitle, newSourceContent)}
                  className="self-end rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white"
                >
                  הוספה
                </button>
              </div>

              {textSources.length === 0 ? (
                <p className="mt-3 text-xs text-[var(--muted)]">אין עדיין מקורות תוכן.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {textSources.map((source) => (
                    <div key={source.id} className="rounded-lg border border-[var(--border)] p-2">
                      <div className="flex items-center justify-between gap-2">
                        <button onClick={() => removeTextSource(source)} className="text-xs text-red-600">
                          מחיקה
                        </button>
                      </div>
                      <input
                        className={`${input} mt-2 text-xs font-medium`}
                        dir="auto"
                        defaultValue={source.title}
                        onBlur={(e) => updateTextSource(source, { title: e.target.value })}
                      />
                      <textarea
                        className={`${input} mt-2 h-24 text-xs leading-5`}
                        dir="rtl"
                        defaultValue={source.content}
                        onBlur={(e) => updateTextSource(source, { content: e.target.value })}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* assets */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium">אזור עיצוב — תמונות לשימוש בתוצרים</span>
                <input ref={assetRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadAsset(e.target.files[0])} />
                <button
                  onClick={() => assetRef.current?.click()}
                  className="rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white hover:bg-brand-dark"
                >
                  + העלאת תמונה
                </button>
              </div>
              <p className="mb-2 text-xs text-[var(--muted)] leading-5">
                התמונות שיועלו כאן (יחד עם הלוגו) ישמשו לעיצוב, השראה ויזואלית ושילוב בתוצרים — לא כמקור לעובדות או מסרים עסקיים.
                בעת הפקת מצגת, יצורפו קישורים מאובטחים וזמניים לתמונות אלה, כך שניתן להוריד ולהכניס אותן ישירות.
                מומלץ להוסיף תיאור קצר לכל תמונה (למשל "תמונת רחוב מרכזי", "אירוע עירוני") כדי שהמערכת תדע היכן לשבץ אותה.
              </p>
              {assets.length === 0 ? (
                <p className="text-xs text-[var(--muted)]">לא הועלו תמונות עדיין.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {assets.map((a) => (
                    <div key={a.id} className="relative group">
                      <img src={previews[a.id]} alt={a.caption ?? ''} className="h-24 w-full object-cover rounded border border-[var(--border)]" />
                      <button
                        onClick={() => removeAsset(a)}
                        className="absolute top-1 left-1 bg-white/90 text-red-600 text-xs rounded px-1"
                      >
                        מחיקה
                      </button>
                      <input
                        className={`${input} mt-1 text-xs`}
                        dir="auto"
                        placeholder="תיאור התמונה"
                        defaultValue={a.caption ?? ''}
                        onBlur={(e) => updateAssetCaption(a, e.target.value.trim())}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {/* empty state — keeps the two-thirds column inviting instead of blank */}
        {!selected && (
          <section className="flex min-h-[320px] flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border)] bg-white p-8 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand/5 text-brand">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="13.5" cy="6.5" r="1.5" /><circle cx="17.5" cy="10.5" r="1.5" /><circle cx="8.5" cy="7.5" r="1.5" /><circle cx="6.5" cy="12.5" r="1.5" />
                <path d="M12 2C6.5 2 2 6 2 11c0 4.4 3.6 8 8 8 1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.2 0-1.1.9-2 2-2h2.4c3.1 0 5.6-2.5 5.6-5.6C21 5.2 17 2 12 2Z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold">בחרו מקום כדי לערוך</h2>
            <p className="mt-1.5 max-w-sm text-sm leading-6 text-[var(--muted)]">
              {isAdmin
                ? 'לחצו על מקום מהרשימה כדי לערוך את הלוגו, פלטת הצבעים, הנחיות הסגנון, פרטי הטפסים ומקורות התוכן — או צרו מקום חדש.'
                : 'לא נמצאו מותגים שהוקצו לך. מנהל המערכת יכול לשייך אותך למותג כדי שתוכל לערוך את פרטי הטפסים שלו.'}
            </p>
            {isAdmin && (
            <button
              onClick={() => openBrand(null)}
              className="mt-5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark"
            >
              + הוספת מקום
            </button>
            )}
          </section>
        )}
      </div>

      {csvModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-3 backdrop-blur-sm" dir="rtl" onPointerDown={() => setCsvModalOpen(false)}>
          <div
            className="flex w-full max-w-lg flex-col rounded-2xl bg-white shadow-2xl"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--border)] p-4">
              <h2 className="text-lg font-bold">ניהול מקומות מרובים ב-CSV</h2>
              <button type="button" onClick={() => setCsvModalOpen(false)} aria-label="סגירה" className="rounded-full p-1.5 hover:bg-gray-100 text-xl leading-none">×</button>
            </div>
            <div className="p-4 space-y-4">
              <p className="text-sm text-[var(--muted)] leading-relaxed">
                ייצוא וייבוא ב-CSV מאפשרים לעדכן כמה מקומות בו-זמנית או ליצור גיבוי של הנתונים שלכם מחוץ למערכת.
              </p>

              <div className="space-y-3">
                <div className="rounded-lg border border-[var(--border)] p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-sm">ייצוא נתונים</span>
                    <button
                      onClick={() => { exportAll(); setCsvModalOpen(false); }}
                      disabled={!brands.length}
                      className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-semibold hover:bg-gray-200 disabled:opacity-50"
                    >
                      {selectedIds.size > 0 ? `ייצוא נבחרים (${selectedIds.size})` : 'ייצוא הכל'}
                    </button>
                  </div>
                  <p className="text-xs text-[var(--muted)]">הורדת המקומות הקיימים לקובץ. ניתן לערוך את הקובץ באקסל ולהעלות חזרה לעדכון מרוכז.</p>
                </div>

                <div className="rounded-lg border border-[var(--border)] p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-sm">ייבוא מ-CSV</span>
                    <button
                      onClick={() => csvRef.current?.click()}
                      disabled={importing}
                      className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
                    >
                      {importing ? 'מייבא...' : 'ייבוא CSV'}
                    </button>
                  </div>
                  <p className="text-xs text-[var(--muted)]">העלאת קובץ חדש או מעודכן. מקום עם שם שקיים במערכת יעודכן, ושם חדש יתווסף.</p>
                </div>

                <div className="rounded-lg border border-[var(--border)] p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-sm">קובץ לדוגמה</span>
                    <button
                      onClick={() => { downloadCsv('branding-template', brandCsvTemplate()); setCsvModalOpen(false); }}
                      className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-semibold hover:bg-gray-200"
                    >
                      הורדת תבנית
                    </button>
                  </div>
                  <p className="text-xs text-[var(--muted)]">הורדת קובץ ריק עם העמודות הנדרשות כדי להתחיל להזין מקומות חדשים בקלות.</p>
                </div>
              </div>

              <div className="rounded-lg bg-blue-50 p-3 text-xs text-blue-800 leading-5">
                <strong>שימו לב:</strong> ייצוא/ייבוא כולל שם, שמות נרדפים, סטטוס, הנחיות סגנון, צבעי הפלטה ומקורות תוכן (עמודות source_1_title / source_1_content וכו'). לוגו ותמונות אינם נכללים ב-CSV.
              </div>
            </div>
          </div>
        </div>
      )}

      {logoModalOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-4 py-6"
          dir="rtl"
          role="dialog"
          aria-modal="true"
          aria-label="העלאת לוגו"
        >
          <button
            type="button"
            className="absolute inset-0 h-full w-full cursor-default"
            aria-label="סגירת העלאת לוגו"
            onClick={() => setLogoModalOpen(false)}
          />
          <div className="relative flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-white text-right shadow-xl">
            <div className="flex items-start justify-between gap-3 px-5 pb-4 pt-5">
              <div>
                <h2 className="text-lg font-bold text-[var(--text)]">העלאת לוגו</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  גררו תמונה לכאן או בחרו קובץ מהמכשיר. אחרי הבחירה ה-AI יזהה את צבעי המותג אוטומטית.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLogoModalOpen(false)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[var(--border)] text-lg text-[var(--muted)] hover:bg-gray-50"
                aria-label="סגירה"
              >
                ×
              </button>
            </div>

            <div className="overflow-y-auto px-5 pb-5">
              <input
                ref={logoRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => void pickLogo(e.target.files?.[0] ?? null)}
              />

              <div
                onDragEnter={(event) => {
                  event.preventDefault();
                  setLogoDragActive(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={() => setLogoDragActive(false)}
                onDrop={onLogoDrop}
                className={`grid min-h-56 place-items-center rounded-xl border-2 border-dashed p-5 text-center transition ${
                  logoDragActive ? 'border-brand bg-brand/10' : 'border-[var(--border)] bg-gray-50'
                }`}
              >
                <div className="max-w-sm">
                  <div className="mx-auto grid h-28 w-28 place-items-center overflow-hidden rounded-xl border border-[var(--border)] bg-white">
                    {previews['__logo'] ? (
                      <img src={previews['__logo']} alt="לוגו המותג" className="h-full w-full object-contain p-3" />
                    ) : (
                      <span className="text-xs font-semibold text-[var(--muted)]">לוגו</span>
                    )}
                  </div>
                  <div className="mt-4 text-sm font-semibold text-[var(--text)]">גררו תמונת לוגו לכאן</div>
                  <p className="mt-1 text-xs text-[var(--muted)]">PNG, JPG או WEBP, עד 5MB</p>
                  <button
                    type="button"
                    onClick={() => logoRef.current?.click()}
                    className="mt-4 rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
                  >
                    בחירה מהמכשיר
                  </button>
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-brand/20 bg-brand/5 px-4 py-3 text-sm">
                <div className="font-semibold text-brand">זיהוי צבעי מותג עם AI</div>
                {extracting && (
                  <div className="mt-3 rounded-lg border border-brand/10 bg-white px-3 py-3">
                    <div className="flex items-center gap-3">
                      <span className="relative grid h-9 w-9 shrink-0 place-items-center">
                        <span className="absolute inset-0 rounded-full border-2 border-brand/15" />
                        <span className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-brand" />
                        <span className="h-2 w-2 rounded-full bg-brand" />
                      </span>
                      <div>
                        <p className="text-xs font-semibold text-[var(--text)]">מזהה צבעים מהלוגו...</p>
                        <div className="mt-2 flex items-center gap-1.5" aria-hidden="true">
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand [animation-delay:-0.24s]" />
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand [animation-delay:-0.12s]" />
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand" />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {!extracting && !colorSummary && !pendingColors && (
                  <p className="mt-2 text-xs text-[var(--muted)]">הזיהוי יתחיל אוטומטית אחרי בחירת תמונה.</p>
                )}
                {colorSummary && <p className="mt-2 text-xs text-emerald-700">{colorSummary}</p>}
                {colorSummary && !pendingColors && selected?.color_palette?.length ? (
                  <div className="mt-4">
                    <div className="mb-2 text-xs font-semibold text-[var(--text)]">צבעי המותג שנבחרו</div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {selected.color_palette.map((color, index) => (
                        <div key={`${color.role}-${index}`} className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-white px-3 py-2">
                          <span
                            className="h-9 w-10 shrink-0 rounded-md border border-[var(--border)]"
                            style={{ backgroundColor: isValidHexColor(color.hex) ? color.hex : '#000000' }}
                          />
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-[var(--text)]">{ROLE_LABEL[color.role]}</div>
                            <div className="text-xs font-semibold text-[var(--muted)] ltr">{color.hex}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {pendingColors && (
                  <div className="mt-4 space-y-2">
                    {pendingColors.map((color, index) => (
                      <label key={`${color.role}-${index}`} className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-white px-3 py-2">
                        <span
                          className="relative h-12 w-16 shrink-0 overflow-hidden rounded-lg border border-[var(--border)] shadow-sm"
                          style={{ backgroundColor: isValidHexColor(color.hex) ? color.hex : '#000000' }}
                        >
                          <input
                            type="color"
                            value={isValidHexColor(color.hex) ? color.hex : '#000000'}
                            onChange={(event) => updatePendingColor(index, { hex: event.target.value.toUpperCase() })}
                            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                            aria-label={`צבע ${ROLE_LABEL[color.role]}`}
                          />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold text-[var(--text)]">{ROLE_LABEL[color.role]}</div>
                          <input
                            dir="ltr"
                            value={color.hex}
                            onChange={(event) => updatePendingColor(index, { hex: event.target.value })}
                            className="mt-1 w-full rounded-md border border-[var(--border)] px-2 py-1 text-xs font-semibold text-[var(--text)]"
                          />
                        </div>
                      </label>
                    ))}
                    <button
                      type="button"
                      onClick={confirmPendingColors}
                      className="mt-3 w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
                    >
                      אישור צבעי המותג
                    </button>
                  </div>
                )}
              </div>

              <div className="mt-5 flex justify-start gap-3">
                {previews['__logo'] && (
                  <button
                    type="button"
                    onClick={() => setLogoPreviewOpen(true)}
                    className="rounded-lg border border-[var(--border)] px-5 py-2.5 text-sm font-semibold text-[var(--text)] hover:bg-gray-50"
                  >
                    תצוגה גדולה
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setLogoModalOpen(false)}
                  className="rounded-lg border border-[var(--border)] px-5 py-2.5 text-sm font-semibold text-[var(--text)] hover:bg-gray-50"
                >
                  סגירה
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {logoPreviewOpen && previews['__logo'] && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          dir="rtl"
          role="dialog"
          aria-modal="true"
          aria-label="תצוגת לוגו"
          onClick={() => setLogoPreviewOpen(false)}
        >
          <div
            className="relative w-full max-w-4xl rounded-2xl bg-white p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setLogoPreviewOpen(false)}
              className="absolute left-3 top-3 rounded-full border border-[var(--border)] bg-white px-3 py-1 text-sm font-semibold text-[var(--muted)] hover:bg-gray-50"
              aria-label="סגירה"
            >
              סגור
            </button>
            <div className="flex min-h-[60vh] items-center justify-center rounded-xl bg-gray-50 p-4">
              <img
                src={previews['__logo']}
                alt="תצוגת לוגו גדולה"
                className="max-h-[75vh] w-full max-w-full object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BrandListLogo({ name, url }: { name: string; url: string }) {
  return (
    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--border)] bg-white">
      {url ? (
        <img src={url} alt={`לוגו ${name}`} className="h-full w-full object-contain p-1" />
      ) : (
        <span className="px-1 text-center text-sm font-bold text-brand">{name.slice(0, 2)}</span>
      )}
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',').pop() ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function isValidHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}
