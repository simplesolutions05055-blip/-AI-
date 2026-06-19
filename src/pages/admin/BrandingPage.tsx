import { useEffect, useRef, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { formatHebrewDateTime } from '@/lib/format';
import type { Brand, BrandAsset, BrandColor, BrandColorRole } from '@/types/db';

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
});

export default function BrandingPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Partial<Brand> | null>(null);
  const [assets, setAssets] = useState<BrandAsset[]>([]);
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">מיתוג</h1>
        <button onClick={() => openBrand(null)} className="rounded-lg bg-brand text-white px-4 py-2 text-sm font-semibold">
          הוסף מקום
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* list */}
        <section className="bg-white rounded-xl border border-[var(--border)] lg:col-span-1 overflow-x-auto">
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
          <section className="bg-white rounded-xl border border-[var(--border)] p-4 lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{selected.id ? 'עריכת מקום' : 'מקום חדש'}</h2>
              <div className="flex gap-2">
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
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <input
                      type="color"
                      value={c.hex}
                      onChange={(e) => updateColor(i, { hex: e.target.value })}
                      className="h-9 w-12 rounded border border-[var(--border)] shrink-0"
                    />
                    <input
                      className={`${input} ltr w-28 shrink-0`}
                      value={c.hex}
                      onChange={(e) => updateColor(i, { hex: e.target.value })}
                    />
                    <select className={`${input} flex-1 min-w-[6rem]`} value={c.role} onChange={(e) => updateColor(i, { role: e.target.value as BrandColorRole })}>
                      {Object.entries(ROLE_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                    <button onClick={() => removeColor(i)} className="text-xs text-red-600 px-2">הסר</button>
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

            {/* assets */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium">דוגמאות גרפיקה</span>
                <input ref={assetRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadAsset(e.target.files[0])} />
                <button onClick={() => assetRef.current?.click()} className="text-xs text-brand">+ העלה תמונה</button>
              </div>
              {assets.length === 0 ? (
                <p className="text-xs text-[var(--muted)]">אין דוגמאות.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {assets.map((a) => (
                    <div key={a.id} className="relative group">
                      <img src={previews[a.id]} alt="" className="h-24 w-full object-cover rounded border border-[var(--border)]" />
                      <button
                        onClick={() => removeAsset(a)}
                        className="absolute top-1 left-1 bg-white/90 text-red-600 text-xs rounded px-1"
                      >
                        מחק
                      </button>
                      <div className="text-[10px] text-[var(--muted)] ltr">{formatHebrewDateTime(a.created_at)}</div>
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
