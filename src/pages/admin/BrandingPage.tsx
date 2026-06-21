import { useEffect, useRef, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
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

const input = 'w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm';

const ROLE_LABEL: Record<BrandColorRole, string> = {
  primary: 'ראשי',
  secondary: 'משני',
  accent: 'הדגשה',
  background: 'רקע',
  text: 'טקסט',
};

const emptyBrand = (): Partial<Brand> => ({
  name: '',
  aliases: [],
  color_palette: [],
  style_notes: '',
  is_active: true,
  client_type: 'business',
});

export default function BrandingPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Partial<Brand> | null>(null);
  const [assets, setAssets] = useState<BrandAsset[]>([]);
  const [textSources, setTextSources] = useState<BusinessTextSource[]>([]);
  const [newSourceTitle, setNewSourceTitle] = useState('');
  const [newSourceContent, setNewSourceContent] = useState('');
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [aliasesText, setAliasesText] = useState('');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const anchorRef = useRef<number | null>(null);
  const longPress = useRef<{ timer: number | null; fired: boolean }>({ timer: null, fired: false });
  const logoRef = useRef<HTMLInputElement>(null);
  const assetRef = useRef<HTMLInputElement>(null);
  const textSourceRef = useRef<HTMLInputElement>(null);
  const csvRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const db = createSupabaseBrowserClient();

  async function loadBrands() {
    const { data } = await db.from('brands').select('*').order('created_at', { ascending: false });
    setBrands((data ?? []) as Brand[]);
    setLoading(false);
  }

  useEffect(() => {
    loadBrands();
  }, []);

  async function signedUrl(path: string) {
    const { data } = await db.storage.from('branding').createSignedUrl(path, 600);
    return data?.signedUrl ?? '';
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
      const next: Record<string, string> = {};
      if (b.logo_path) next['__logo'] = await signedUrl(b.logo_path);
      for (const a of list) next[a.id] = await signedUrl(a.storage_path);
      setPreviews(next);
    }
  }

  function patch(p: Partial<Brand>) {
    setSelected((cur) => ({ ...(cur ?? {}), ...p }));
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
      alert('שם מקום חובה');
      return null;
    }
    setSaving(true);
    const aliases = aliasesText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const row = {
      name: selected.name.trim(),
      aliases,
      color_palette: selected.color_palette ?? [],
      style_notes: selected.style_notes ?? null,
      is_active: selected.is_active ?? true,
      client_type: selected.client_type ?? 'business',
      logo_path: selected.logo_path ?? null,
    };
    let id = selected.id ?? null;
    if (id) {
      const { data, error } = await db.from('brands').update(row as never).eq('id', id).select('id');
      if (error) {
        alert('שמירה נכשלה: ' + error.message);
        setSaving(false);
        return null;
      }
      if (!data || data.length === 0) {
        alert('השמירה לא בוצעה — ככל הנראה אין הרשאת מנהל (RLS).');
        setSaving(false);
        return null;
      }
    } else {
      const { data, error } = await db.from('brands').insert(row as never).select('id').single();
      if (error || !data) {
        alert('שמירה נכשלה: ' + (error?.message ?? ''));
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
  // ── extract dominant colors from a logo (client-side canvas, no service) ─────
  function extractColors(file: File) {
    setExtracting(true);
    const img = new Image();
    img.onload = () => {
      const W = 64;
      const H = Math.max(1, Math.round((img.height / img.width) * W));
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (!ctx) return setExtracting(false);
      ctx.drawImage(img, 0, 0, W, H);
      const { data } = ctx.getImageData(0, 0, W, H);
      const buckets = new Map<string, { r: number; g: number; b: number; n: number }>();
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a < 128) continue; // skip transparent
        const r = data[i], g = data[i + 1], b = data[i + 2];
        // quantize to 32-steps to group near colors
        const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
        const e = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
        e.r += r; e.g += g; e.b += b; e.n += 1;
        buckets.set(key, e);
      }
      const top = [...buckets.values()]
        .sort((a, z) => z.n - a.n)
        .slice(0, 4)
        .map((e) => {
          const hex = (v: number) => Math.round(v / e.n).toString(16).padStart(2, '0');
          return `#${hex(e.r)}${hex(e.g)}${hex(e.b)}`.toUpperCase();
        });
      const roles: BrandColorRole[] = ['primary', 'secondary', 'accent', 'background'];
      patch({ color_palette: top.map((hex, i) => ({ hex, role: roles[i] ?? 'accent' })) });
      setExtracting(false);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => setExtracting(false);
    img.src = URL.createObjectURL(file);
  }

  async function uploadLogo(file: File) {
    setLogoFile(file);
    const id = selected?.id ?? (await save());
    if (!id) return;
    const ext = file.name.split('.').pop() || 'png';
    const path = `${id}/logo.${ext}`;
    const { error } = await db.storage.from('branding').upload(path, file, { upsert: true, contentType: file.type });
    if (error) return alert('העלאה נכשלה: ' + error.message);
    await db.from('brands').update({ logo_path: path } as never).eq('id', id);
    patch({ logo_path: path });
    setPreviews((p) => ({ ...p, __logo: URL.createObjectURL(file) }));
    await loadBrands();
  }

  async function uploadAsset(file: File) {
    const id = selected?.id ?? (await save());
    if (!id) return;
    const ext = file.name.split('.').pop() || 'png';
    const path = `${id}/assets/${crypto.randomUUID()}.${ext}`;
    const { error } = await db.storage.from('branding').upload(path, file, { contentType: file.type });
    if (error) return alert('העלאה נכשלה: ' + error.message);
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
      alert('שמירת מקור התוכן נכשלה: ' + (error?.message ?? ''));
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
      alert('עיבוד מקור התוכן נכשל: ' + String(error));
    } finally {
      if (textSourceRef.current) textSourceRef.current.value = '';
    }
  }

  async function removeTextSource(source: BusinessTextSource) {
    await db.from('business_text_sources').delete().eq('id', source.id);
    setTextSources((cur) => cur.filter((x) => x.id !== source.id));
  }

  async function removeBrand(b: Brand) {
    if (!confirm(`למחוק את "${b.name}"? פעולה בלתי הפיכה.`)) return;
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
    if (!confirm(`למחוק ${ids.length} מקומות? פעולה בלתי הפיכה.`)) return;
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
        alert('לא נמצאו שורות תקינות בקובץ.\n' + errors.join('\n'));
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
      alert(detail.length ? `${summary}\n\n${detail.join('\n')}` : summary);
    } catch (e) {
      alert('קריאת הקובץ נכשלה: ' + String(e));
    } finally {
      setImporting(false);
      if (csvRef.current) csvRef.current.value = '';
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">מיתוג</h1>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={csvRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])}
          />
          <button
            onClick={() => downloadCsv('branding-template', brandCsvTemplate())}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium hover:bg-gray-50"
          >
            CSV לדוגמה
          </button>
          <button
            onClick={exportAll}
            disabled={!brands.length}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            {selectedIds.size > 0 ? `ייצוא נבחרים (${selectedIds.size})` : 'ייצוא הכל'}
          </button>
          <button
            onClick={() => csvRef.current?.click()}
            disabled={importing}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            {importing ? 'מייבא...' : 'ייבוא CSV'}
          </button>
          <button onClick={() => openBrand(null)} className="rounded-lg bg-brand text-white px-4 py-2 text-sm font-semibold">
            הוסף מקום
          </button>
        </div>
      </div>
      <p className="text-xs text-[var(--muted)] -mt-3 leading-5">
        ייצוא/ייבוא כולל שם, שמות נרדפים, סטטוס, הנחיות סגנון, צבעי הפלטה ומקורות תוכן
        (עמודות source_1_title / source_1_content וכן הלאה — אפשר להוסיף כמה שרוצים). לוגו ותמונות אינם נכללים ב-CSV.
        בייבוא, מקום עם שם קיים יעודכן, ושם חדש יתווסף.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* list */}
        <section className="bg-white rounded-xl border border-[var(--border)] lg:col-span-1 overflow-x-auto min-w-0">
          {/* bulk action bar */}
          {selectedIds.size > 0 && (
            <div className="flex items-center justify-between gap-2 bg-gray-50 border-b border-[var(--border)] px-3 py-2 text-sm">
              <span className="text-[var(--muted)]">נבחרו {selectedIds.size}</span>
              <div className="flex gap-3">
                <button onClick={() => bulkSetActive(true)} className="text-brand">הפעל</button>
                <button onClick={() => bulkSetActive(false)} className="text-[var(--muted)]">השבת</button>
                <button onClick={bulkDelete} className="text-red-600">מחק</button>
              </div>
            </div>
          )}
          {loading ? (
            <p className="p-4 text-[var(--muted)]">טוען...</p>
          ) : brands.length === 0 ? (
            <p className="p-4 text-[var(--muted)] text-sm">אין מקומות עדיין.</p>
          ) : (
            <table className="w-full text-sm" dir="rtl">
              <thead>
                <tr className="text-[var(--muted)] border-b border-[var(--border)]">
                  <th className="p-2 w-8">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === brands.length && brands.length > 0}
                      ref={(el) => {
                        if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < brands.length;
                      }}
                      onChange={toggleAll}
                    />
                  </th>
                  <th className="text-start p-2">מקום</th>
                  <th className="text-start p-2 w-16">סטטוס</th>
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
                      </td>
                      <td className="p-2 font-medium" onClick={() => openBrand(b)}>
                        {b.name}
                      </td>
                      <td className="p-2" onClick={() => openBrand(b)}>
                        <span className={`text-xs ${b.is_active ? 'text-green-600' : 'text-[var(--muted)]'}`}>
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
          <section className="bg-white rounded-xl border border-[var(--border)] p-4 lg:col-span-2 space-y-4 min-w-0">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{selected.id ? 'עריכת מקום' : 'מקום חדש'}</h2>
              <div className="flex gap-2">
                {selected.id && (
                  <button
                    onClick={() => exportOne(selected as Brand)}
                    className="text-xs text-brand px-3 py-2"
                  >
                    הורד CSV
                  </button>
                )}
                {selected.id && (
                  <button
                    onClick={() => removeBrand(selected as Brand)}
                    className="text-xs text-red-600 px-3 py-2"
                  >
                    מחיקה
                  </button>
                )}
                <button onClick={save} className="rounded-lg bg-brand text-white px-4 py-2 text-sm font-semibold">
                  {saving ? 'שומר...' : saved ? 'נשמר ✓' : 'שמירה'}
                </button>
              </div>
            </div>

            <label className="block">
              <span className="block text-sm font-medium mb-1">שם המקום</span>
              <input className={input} dir="auto" value={selected.name ?? ''} onChange={(e) => patch({ name: e.target.value })} />
            </label>

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
              <div className="flex items-center gap-3">
                {previews['__logo'] && (
                  <img src={previews['__logo']} alt="logo" className="h-16 w-16 object-contain rounded border border-[var(--border)]" />
                )}
                <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} />
                <button onClick={() => logoRef.current?.click()} className="text-sm text-brand">
                  {previews['__logo'] ? 'החלף לוגו' : 'העלה לוגו'}
                </button>
                {logoFile && (
                  <button onClick={() => extractColors(logoFile)} className="text-sm text-brand" disabled={extracting}>
                    {extracting ? 'מחלץ...' : 'חלץ צבעים מהלוגו'}
                  </button>
                )}
              </div>
              <p className="text-xs text-[var(--muted)] mt-1">חילוץ צבעים זמין מיד אחרי בחירת קובץ לוגו חדש.</p>
            </div>

            {/* palette */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium">פלטת צבעים</span>
                <button onClick={addColor} className="text-xs text-brand">+ הוסף צבע</button>
              </div>
              <div className="space-y-2">
                {(selected.color_palette ?? []).map((c, i) => (
                  <div key={i} className="flex flex-nowrap items-center gap-2">
                    <input
                      type="color"
                      value={c.hex}
                      onChange={(e) => updateColor(i, { hex: e.target.value })}
                      className="h-9 w-11 rounded border border-[var(--border)] shrink-0 cursor-pointer p-0.5"
                      title="לחץ לבחירת צבע מדויק"
                    />
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

            {/* content brain */}
            <div className="rounded-lg border border-[var(--border)] p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <span className="block text-sm font-medium">אזור תוכן</span>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                    חומרים שהמערכת לוקחת מהם מה להגיד בלבד. עיצוב, צבעים ופונטים מתוך המסמכים האלה לא ישפיעו על התוצר.
                  </p>
                </div>
                <div className="shrink-0">
                  <input
                    ref={textSourceRef}
                    type="file"
                    accept=".txt,.md,.docx,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && uploadTextSource(e.target.files[0])}
                  />
                  <button
                    onClick={() => textSourceRef.current?.click()}
                    className="rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white hover:bg-brand-dark"
                  >
                    + העלה מסמך תוכן
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
                  הוסף
                </button>
              </div>

              {textSources.length === 0 ? (
                <p className="mt-3 text-xs text-[var(--muted)]">אין עדיין מקורות תוכן.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {textSources.map((source) => (
                    <div key={source.id} className="rounded-lg border border-[var(--border)] p-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{source.title}</span>
                        <button onClick={() => removeTextSource(source)} className="text-xs text-red-600">
                          מחק
                        </button>
                      </div>
                      <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-[var(--muted)]">
                        {source.content}
                      </p>
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
                  + העלה תמונה
                </button>
              </div>
              <p className="mb-2 text-xs text-[var(--muted)] leading-5">
                התמונות שתעלה כאן (יחד עם הלוגו) ישמשו לעיצוב, השראה ויזואלית ושילוב בתוצרים — לא כמקור לעובדות או מסרים עסקיים.
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
                        מחק
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
      </div>
    </div>
  );
}
