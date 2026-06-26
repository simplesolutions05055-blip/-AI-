// Branded Hebrew price-quote ("הצעת מחיר") PDF builder. Mirrors the Simple
// Solutions quote layout from the reference design. Hebrew renders perfectly
// because the browser draws the RTL HTML and html2canvas rasterizes it; the
// block-packing pager (measure each block, never split it across a page) is the
// same proven approach used by renderBriefToPdf — so no box or text is ever cut
// across a page boundary. Runs fully client-side.
//
// CRITICAL: prices are NEVER invented here. We render only the strings the quote
// JSON supplies (which the Edge function fills from the prompt only).
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export interface QuoteComponent {
  title: string;
  desc?: string;
  price?: string;
}

export interface Quote {
  title: string;
  subtitle?: string | null;
  meta?: { doc?: string; date?: string; project_type?: string; platform?: string };
  summary?: string | null;
  headline?: { label?: string; sub?: string; price?: string };
  // Section headings come from the model so they match the brief's domain
  // (event / show / service) instead of fixed software-development wording.
  components_title?: string | null;
  components?: QuoteComponent[];
  included_title?: string | null;
  included?: string[];
  ownership_note?: string | null;
  technologies_title?: string | null;
  technologies?: string[];
  payment_terms?: Array<{ title: string; desc?: string }>;
  terms?: string[];
  disclaimer?: string | null;
  signature?: boolean;
  // Branding (optional). Defaults to the Simple Solutions palette.
  company?: { name?: string; site?: string; cta?: string };
  // Brand kit pulled from the selected brand, filled by the Edge function. When
  // present the renderer shows the logo and themes the WHOLE doc with the brand's
  // design language — the full role-based palette plus the style notes (which pick
  // a flat vs. gradient treatment) — instead of the default blue palette.
  // `palette` (role-aware) is preferred; `colors` is the legacy flat fallback.
  brand?: {
    name?: string | null;
    logo_data_url?: string | null;
    colors?: string[];
    palette?: Array<{ hex: string; role?: string | null }> | null;
    style_notes?: string | null;
  } | null;
}

export interface QuoteTheme {
  navy: string;       // header + total box (brand primary)
  navy2: string;      // gradient end (brand secondary)
  gold: string;       // accent (brand accent)
  lavender: string;   // soft box fill (light surface)
  ink: string;        // body text
  muted: string;      // secondary text
  onNavy: string;     // text drawn over the navy header/total (contrast-picked)
  onNavyMuted: string;// muted text over navy
  onGold: string;     // text drawn over the accent (contrast-picked)
  onLavender: string; // strong text over the soft surface
  flat: boolean;      // true → solid blocks instead of gradients (minimal brands)
}

// Blue palette matching the app (primary #2563EB), not purple.
const DEFAULT_THEME: QuoteTheme = {
  navy: '#1E3A8A',
  navy2: '#2563EB',
  gold: '#C9A14A',
  lavender: '#EFF6FF',
  ink: '#1F2233',
  muted: '#64748B',
  onNavy: '#FFFFFF',
  onNavyMuted: 'rgba(255,255,255,0.82)',
  onGold: '#1E3A8A',
  onLavender: '#1E3A8A',
  flat: false,
};

// Parse a #rrggbb / #rgb hex into [r,g,b]; null if unparseable.
function hexToRgb(hex: string): [number, number, number] | null {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// Mix a hex color toward white by `amount` (0..1) — used to derive the soft
// "lavender" fill from a brand color so the boxes stay light and readable.
export function tint(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const mix = rgb.map((c) => Math.round(c + (255 - c) * amount));
  return `#${mix.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

// Perceived luminance (0..255) — drives contrast decisions.
function lum([r, g, b]: [number, number, number]): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// Pick black or white body text for legible contrast over `hex`.
function readableOn(hex: string, dark = '#1F2233', light = '#FFFFFF'): string {
  const rgb = hexToRgb(hex);
  return rgb && lum(rgb) > 150 ? dark : light;
}

// Rough saturation (0..1) of a hex — used to find the liveliest accent.
function saturation([r, g, b]: [number, number, number]): number {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

// Does the brand's style note ask for a flat / minimal treatment?
function wantsFlat(notes?: string | null): boolean {
  return !!notes && /\b(flat|minimal|clean)\b|שטוח|מינימ|נקי|פלאט/i.test(notes);
}

// Build the full quote theme from a brand's role-based palette + style notes.
// This is the heart of "use the brand's whole design language": every role maps
// to a semantic slot, contrast colors are derived so text stays legible on any
// brand color (light brands included), and the style notes pick flat vs gradient.
// Falls back to a luminance heuristic when roles are missing, and to defaults for
// anything the palette doesn't cover.
export function themeFromBrand(
  palette: Array<{ hex: string; role?: string | null }>,
  styleNotes?: string | null,
): Partial<QuoteTheme> {
  const valid = palette
    .map((c) => ({ hex: c.hex, role: (c.role ?? '').toLowerCase(), rgb: hexToRgb(c.hex) }))
    .filter((c) => c.rgb) as Array<{ hex: string; role: string; rgb: [number, number, number] }>;
  if (!valid.length) return wantsFlat(styleNotes) ? { flat: true } : {};

  const byRole = (r: string) => valid.find((c) => c.role === r)?.hex;
  const sortedDark = [...valid].sort((a, b) => lum(a.rgb) - lum(b.rgb));
  const sortedSat = [...valid].sort((a, b) => saturation(b.rgb) - saturation(a.rgb));

  // primary → navy (header/total). Role first, else the darkest color.
  const navy = byRole('primary') ?? sortedDark[0].hex;
  // secondary → gradient end. Role first, else next-darkest distinct color.
  const navy2 = byRole('secondary') ?? sortedDark.find((c) => c.hex !== navy)?.hex ?? navy;
  // accent → gold highlights. Role first, else the most saturated color that
  // isn't the navy pair (keeps badges/pills from blending into the header).
  const accent =
    byRole('accent') ??
    sortedSat.find((c) => c.hex !== navy && c.hex !== navy2)?.hex ??
    sortedSat[0].hex;
  // text → body ink. Role first, else the app default.
  const ink = byRole('text') ?? DEFAULT_THEME.ink;
  // background → soft surface. Use the brand's light background if it's actually
  // light; otherwise tint the secondary toward white so boxes stay readable.
  const bgRole = byRole('background');
  const bgRoleLight = bgRole && (hexToRgb(bgRole) ? lum(hexToRgb(bgRole)!) > 220 : false);
  const lavender = bgRoleLight ? bgRole! : tint(navy2, 0.9);

  return {
    navy,
    navy2,
    gold: accent,
    lavender,
    ink,
    onNavy: readableOn(navy),
    onNavyMuted: readableOn(navy) === '#FFFFFF' ? 'rgba(255,255,255,0.82)' : 'rgba(0,0,0,0.6)',
    onGold: readableOn(accent),
    onLavender: readableOn(lavender, navy, '#FFFFFF'),
    flat: wantsFlat(styleNotes),
  };
}

// Legacy flat-list entry point (kept for callers that only have hex strings).
// Treats the list as role-less so the heuristic ordering applies.
export function themeFromBrandColors(colors: string[]): Partial<QuoteTheme> {
  return themeFromBrand((colors ?? []).map((hex) => ({ hex })));
}

// Resolve the brand block on a quote into a full theme (palette preferred,
// flat colors as fallback), folding in the style notes.
export function themeFromQuoteBrand(brand: Quote['brand']): Partial<QuoteTheme> {
  if (!brand) return {};
  const palette =
    brand.palette && brand.palette.length
      ? brand.palette
      : (brand.colors ?? []).map((hex) => ({ hex }));
  return themeFromBrand(palette, brand.style_notes);
}

// The session-scoped one-off OpenAI key the user may have entered (shared key
// name with ProductionPage). Read here so EVERY quote path forwards it — without
// it, the call falls back to the project key, which may be out of quota.
const SESSION_OPENAI_KEY = 'openai_session_key';
function sessionOpenAiKey(): string | null {
  try {
    return sessionStorage.getItem(SESSION_OPENAI_KEY);
  } catch {
    return null;
  }
}

// Ask the Edge function for a structured quote built from this brief. An optional
// one-off OpenAI key overrides the project secret; when omitted we fall back to
// the session key automatically.
export async function fetchQuote(
  brief: unknown,
  requestId: string | null,
  openaiKey?: string | null,
): Promise<Quote> {
  const db = createSupabaseBrowserClient();
  const key = openaiKey ?? sessionOpenAiKey();
  const { data, error } = await db.functions.invoke('generate-presentation', {
    body: { brief, requestId, format: 'quote', openai_key: key || undefined },
  });
  if (error) throw error;
  const quote = (data as { quote?: Quote } | null)?.quote;
  if (!quote || typeof quote !== 'object') throw new Error('לא הוחזרה הצעת מחיר תקינה');
  return quote;
}

// Merge the selected brand's palette + style notes into a generated quote, client
// side. The Edge function also attaches these (and inlines the logo), but reading
// them here means the brand's colors theme the quote even before that function is
// redeployed — and never overwrites a logo the Edge function already inlined.
export async function attachBrandToQuote(quote: Quote, brandId: string | null): Promise<Quote> {
  if (!brandId) return quote;
  try {
    const db = createSupabaseBrowserClient();
    const { data } = await db
      .from('brands')
      .select('name, color_palette, style_notes')
      .eq('id', brandId)
      .maybeSingle();
    if (!data) return quote;
    const b = data as { name?: string | null; color_palette?: Array<{ hex?: string; role?: string }> | null; style_notes?: string | null };
    const palette = (b.color_palette ?? []).filter((c) => typeof c?.hex === 'string') as Array<{ hex: string; role?: string }>;
    return {
      ...quote,
      brand: {
        ...(quote.brand ?? {}),
        name: quote.brand?.name ?? b.name ?? null,
        palette,
        colors: palette.map((c) => c.hex),
        style_notes: b.style_notes ?? null,
      },
    };
  } catch {
    return quote;
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Quote → A4 PDF. Each section is a self-contained .q-block; blocks are packed
// onto pages by measuring height, never split — so cards/boxes never get cut. ──
export async function renderQuoteToPdf(quote: Quote, themeOverride?: Partial<QuoteTheme>): Promise<Blob> {
  const brandTheme = themeFromQuoteBrand(quote.brand);
  const t = { ...DEFAULT_THEME, ...brandTheme, ...(themeOverride ?? {}) };
  // Flat brands get solid blocks; gradient brands keep the two-tone sweep.
  const navyBg = t.flat ? t.navy : `linear-gradient(135deg,${t.navy},${t.navy2})`;
  const logoUrl = quote.brand?.logo_data_url || null;
  const esc = (s: unknown) =>
    String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const has = (s: unknown) => typeof s === 'string' && s.trim().length > 0;

  const company = {
    name: quote.company?.name || 'Simple Solutions',
    site: quote.company?.site || 'simple-solution.co.il',
    cta: quote.company?.cta || 'בואו נתחיל לעבוד יחד',
  };
  const meta = quote.meta ?? {};

  const blocks: string[] = [];

  // ── Header (gradient navy, gold badge) ──
  blocks.push(`<div class="q-block q-header">
    <div class="q-head-top">
      <div class="q-badge">${esc(meta.doc || 'הצעת מחיר')}</div>
      ${logoUrl ? `<img class="q-logo-img" src="${logoUrl}" alt="${esc(company.name)}" />` : `<div class="q-logo">${esc(company.name)}</div>`}
    </div>
    <h1>${esc(quote.title || 'הצעת מחיר')}</h1>
    ${has(quote.subtitle) ? `<p class="q-sub">${esc(quote.subtitle)}</p>` : ''}
  </div>`);

  // ── Meta strip (up to 4 cells) ──
  const metaCells: Array<[string, string]> = [];
  if (has(meta.doc)) metaCells.push(['מסמך', meta.doc!]);
  if (has(meta.date)) metaCells.push(['תאריך', meta.date!]);
  if (has(meta.project_type)) metaCells.push(['סוג פרויקט', meta.project_type!]);
  if (has(meta.platform)) metaCells.push(['פלטפורמה', meta.platform!]);
  if (metaCells.length) {
    blocks.push(`<div class="q-block"><div class="q-meta">
      ${metaCells.map(([k, v]) => `<div class="q-meta-cell"><div class="q-meta-k">${esc(k)}</div><div class="q-meta-v">${esc(v)}</div></div>`).join('')}
    </div></div>`);
  }

  // ── Summary ──
  if (has(quote.summary)) {
    blocks.push(`<div class="q-block"><div class="q-soft">${esc(quote.summary)}</div></div>`);
  }

  // ── Total box (only show price if supplied) ──
  if (quote.headline && (has(quote.headline.label) || has(quote.headline.price))) {
    const h = quote.headline;
    blocks.push(`<div class="q-block"><div class="q-total">
      <div class="q-total-text">
        <div class="q-total-label">${esc(h.label || 'מחיר כולל')}</div>
        ${has(h.sub) ? `<div class="q-total-sub">${esc(h.sub)}</div>` : ''}
      </div>
      ${has(h.price) ? `<div class="q-total-price">${esc(h.price)}</div>` : ''}
    </div></div>`);
  }

  // ── Components (numbered cards, 2-up) ──
  const comps = Array.isArray(quote.components) ? quote.components.filter((c) => has(c?.title)) : [];
  if (comps.length) {
    // Pack cards two-per-row, each pair as its own block so a card is never split.
    // The heading rides on the first pair so it can't orphan at a page bottom.
    for (let i = 0; i < comps.length; i += 2) {
      const pair = comps.slice(i, i + 2);
      blocks.push(`<div class="q-block">
        ${i === 0 ? `<h2 class="q-h2">${esc(quote.components_title || 'פירוט ההצעה')}</h2>` : ''}
        <div class="q-cards">
        ${pair.map((c, j) => `<div class="q-card">
          <div class="q-card-num">${i + j + 1}</div>
          <div class="q-card-body">
            <div class="q-card-title">${esc(c.title)}</div>
            ${has(c.desc) ? `<div class="q-card-desc">${esc(c.desc)}</div>` : ''}
            ${has(c.price) ? `<div class="q-card-price">${esc(c.price)}</div>` : ''}
          </div>
        </div>`).join('')}
        ${pair.length === 1 ? '<div class="q-card q-card-ghost"></div>' : ''}
      </div></div>`);
    }
  }

  // ── Included checklist ── chunked so no single block ever exceeds a page
  // (the only way a section could get cut). Heading rides on the first chunk.
  const included = Array.isArray(quote.included) ? quote.included.filter(has) : [];
  if (included.length) {
    for (let i = 0; i < included.length; i += 6) {
      const chunk = included.slice(i, i + 6);
      blocks.push(`<div class="q-block">
        ${i === 0 ? `<h2 class="q-h2">${esc(quote.included_title || 'מה כולל')}</h2>` : ''}
        <div class="q-checks">
          ${chunk.map((x) => `<div class="q-check"><span class="q-tick">✓</span><span>${esc(x)}</span></div>`).join('')}
        </div>
      </div>`);
    }
  }

  // ── Ownership note ──
  if (has(quote.ownership_note)) {
    blocks.push(`<div class="q-block"><div class="q-soft q-soft-strong">${esc(quote.ownership_note)}</div></div>`);
  }

  // ── Technologies (pills) ──
  const tech = Array.isArray(quote.technologies) ? quote.technologies.filter(has) : [];
  if (tech.length) {
    blocks.push(`<div class="q-block">
      <h2 class="q-h2">${esc(quote.technologies_title || 'טכנולוגיות וכלים')}</h2>
      <div class="q-tags">${tech.map((x) => `<span class="q-tag">${esc(x)}</span>`).join('')}</div>
    </div>`);
  }

  // ── Payment terms ──
  const pay = Array.isArray(quote.payment_terms) ? quote.payment_terms.filter((p) => has(p?.title)) : [];
  if (pay.length) {
    blocks.push(`<div class="q-block">
      <h2 class="q-h2">תנאי תשלום</h2>
      <div class="q-cards">
        ${pay.map((p) => `<div class="q-pay">
          <div class="q-pay-title">${esc(p.title)}</div>
          ${has(p.desc) ? `<div class="q-pay-desc">${esc(p.desc)}</div>` : ''}
        </div>`).join('')}
        ${pay.length === 1 ? '<div class="q-pay q-card-ghost"></div>' : ''}
      </div>
    </div>`);
  }

  // ── Terms & conditions ── chunked (same anti-cut reasoning as the checklist).
  const terms = Array.isArray(quote.terms) ? quote.terms.filter(has) : [];
  if (terms.length) {
    for (let i = 0; i < terms.length; i += 6) {
      const chunk = terms.slice(i, i + 6);
      blocks.push(`<div class="q-block">
        ${i === 0 ? '<h2 class="q-h2">תנאים והגבלות</h2>' : ''}
        <ul class="q-bullets">${chunk.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      </div>`);
    }
  }

  // ── Disclaimer ──
  if (has(quote.disclaimer)) {
    blocks.push(`<div class="q-block"><div class="q-note">
      <div class="q-note-title">לתשומת לבך</div>
      <div class="q-note-body">${esc(quote.disclaimer)}</div>
    </div></div>`);
  }

  // ── Signature block ──
  if (quote.signature !== false) {
    blocks.push(`<div class="q-block">
      <h2 class="q-h2">אישור ההצעה וחתימה</h2>
      <div class="q-sign">
        <div class="q-sign-cell"><div class="q-sign-line"></div><div class="q-sign-label">חתימת הלקוח</div></div>
        <div class="q-sign-cell"><div class="q-sign-line"></div><div class="q-sign-label">שם מלא</div></div>
        <div class="q-sign-cell"><div class="q-sign-line"></div><div class="q-sign-label">תאריך</div></div>
      </div>
    </div>`);
  }

  // ── Footer CTA bar ──
  blocks.push(`<div class="q-block q-footer">
    <div class="q-foot-name">
      ${logoUrl ? `<img class="q-foot-logo" src="${logoUrl}" alt="${esc(company.name)}" />` : esc(company.name)}
      <div class="q-foot-site">${esc(company.site)}</div>
    </div>
    <div class="q-cta">${esc(company.cta)}</div>
  </div>`);

  // A4 @ ~96dpi with margins; pack blocks by measured height.
  const PAGE_W = 794;
  const PAGE_H = 1123;
  const MARGIN = 40;
  const CONTENT_W = PAGE_W - MARGIN * 2;
  const GAP = 12;
  const font = `'Heebo','Assistant','Arial Hebrew',Arial,sans-serif`;
  // Soft accent surface for the payment/note boxes, derived from the brand accent
  // so they stay on-brand instead of the old fixed cream.
  const accentSoft = tint(t.gold, 0.86);

  const css = `
    .q-block{width:${CONTENT_W}px;box-sizing:border-box;font-family:${font};direction:rtl;text-align:right;color:${t.ink}}
    .q-h2{font-size:18px;font-weight:800;color:${t.navy};margin:0 0 10px;position:relative;padding-right:14px}
    .q-h2::before{content:'';position:absolute;right:0;top:4px;width:6px;height:18px;background:${t.gold};border-radius:3px}
    .q-header{background:${navyBg};border-radius:16px;padding:28px 32px;color:${t.onNavy}}
    .q-head-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
    .q-logo{font-size:16px;font-weight:800;letter-spacing:1px;color:${t.onNavy}}
    .q-logo-img{max-height:40px;max-width:160px;object-fit:contain;display:block}
    .q-foot-logo{max-height:30px;max-width:140px;object-fit:contain;display:block;margin-bottom:2px}
    .q-badge{background:${t.gold};color:${t.onGold};font-size:12px;font-weight:800;padding:5px 14px;border-radius:20px;
      display:inline-flex;align-items:center;justify-content:center;line-height:1}
    .q-header h1{font-size:30px;font-weight:800;margin:0;line-height:1.2;color:${t.onNavy}}
    .q-sub{font-size:15px;margin:10px 0 0;color:${t.onNavyMuted};line-height:1.5}
    .q-meta{display:flex;gap:10px}
    .q-meta-cell{flex:1;background:${t.lavender};border-radius:10px;padding:10px 12px;text-align:center}
    .q-meta-k{font-size:11px;color:${t.muted};margin-bottom:3px}
    .q-meta-v{font-size:14px;font-weight:700;color:${t.onLavender}}
    .q-soft{background:${t.lavender};border-radius:12px;padding:16px 18px;font-size:14px;line-height:1.65;color:${t.ink}}
    .q-soft-strong{font-weight:700;border-right:4px solid ${t.gold}}
    .q-total{background:${navyBg};border-radius:14px;padding:20px 24px;color:${t.onNavy};
      display:flex;align-items:center;justify-content:space-between;gap:16px}
    .q-total-label{font-size:18px;font-weight:800;color:${t.onNavy}}
    .q-total-sub{font-size:13px;color:${t.onNavyMuted};margin-top:4px;line-height:1.5}
    .q-total-price{font-size:28px;font-weight:800;color:${t.gold};white-space:nowrap}
    .q-cards{display:flex;gap:12px;flex-wrap:wrap}
    .q-card{flex:1 1 calc(50% - 6px);min-width:calc(50% - 6px);background:${t.lavender};border-radius:12px;padding:14px 16px;
      display:flex;gap:12px;align-items:flex-start;box-sizing:border-box}
    .q-card-ghost{background:transparent}
    .q-card-num{flex:none;width:26px;height:26px;border-radius:50%;background:${t.gold};color:${t.onGold};
      font-size:13px;font-weight:800;display:flex;align-items:center;justify-content:center;line-height:1}
    .q-card-title{font-size:14px;font-weight:800;color:${t.onLavender};margin-bottom:3px}
    .q-card-desc{font-size:12.5px;color:${t.muted};line-height:1.5}
    .q-card-price{font-size:13px;font-weight:800;color:${t.gold};margin-top:6px}
    .q-checks{display:flex;flex-wrap:wrap;gap:8px 12px}
    .q-check{flex:1 1 calc(50% - 6px);min-width:calc(50% - 6px);background:${t.lavender};border-radius:9px;
      padding:9px 12px;font-size:13px;display:flex;gap:8px;align-items:flex-start;line-height:1.45;box-sizing:border-box;color:${t.ink}}
    .q-tick{flex:none;width:18px;height:18px;border-radius:50%;background:${t.gold};color:${t.onGold};
      font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;line-height:1}
    .q-tags{display:flex;flex-wrap:wrap;gap:8px}
    .q-tag{background:${t.lavender};color:${t.onLavender};font-size:13px;font-weight:700;padding:6px 14px;border-radius:18px}
    .q-pay{flex:1 1 calc(50% - 6px);min-width:calc(50% - 6px);background:${accentSoft};border:1px solid ${t.gold}55;
      border-radius:12px;padding:14px 16px;box-sizing:border-box}
    .q-pay-title{font-size:14px;font-weight:800;color:${t.navy};margin-bottom:4px}
    .q-pay-desc{font-size:12.5px;color:${t.muted};line-height:1.5}
    .q-bullets{margin:0;padding:0 18px 0 0;font-size:13.5px;line-height:1.7}
    .q-bullets li{margin:4px 0}
    .q-note{background:${accentSoft};border:1px solid ${t.gold}66;border-radius:12px;padding:14px 18px}
    .q-note-title{font-size:14px;font-weight:800;color:${t.navy};margin-bottom:5px}
    .q-note-body{font-size:12.5px;color:${t.ink};line-height:1.6}
    .q-sign{display:flex;gap:18px;margin-top:8px}
    .q-sign-cell{flex:1;text-align:center}
    .q-sign-line{border-bottom:1.5px solid ${t.navy}66;height:34px;margin-bottom:6px}
    .q-sign-label{font-size:12px;color:${t.muted}}
    .q-footer{background:${navyBg};border-radius:14px;padding:18px 24px;color:${t.onNavy};
      display:flex;align-items:center;justify-content:space-between;gap:16px}
    .q-foot-name{font-size:15px;font-weight:800}
    .q-foot-site{font-size:12px;font-weight:500;color:${t.onNavyMuted};margin-top:2px}
    .q-cta{background:${t.gold};color:${t.onGold};font-size:14px;font-weight:800;padding:9px 20px;border-radius:22px}
  `;

  const container = document.createElement('div');
  container.style.cssText = `position:fixed;left:-99999px;top:0;width:${CONTENT_W}px;`;
  container.innerHTML = `<style>${css}</style>${blocks.join('')}`;
  document.body.appendChild(container);

  try {
    await (document as any).fonts?.ready?.catch?.(() => {});
    // Wait for any logo images to decode so html2canvas captures them.
    await Promise.all(
      Array.from(container.querySelectorAll('img')).map((img) =>
        (img as HTMLImageElement).complete
          ? Promise.resolve()
          : new Promise<void>((res) => {
              img.addEventListener('load', () => res(), { once: true });
              img.addEventListener('error', () => res(), { once: true });
            })
      )
    );
    await new Promise((r) => setTimeout(r, 120));

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: [PAGE_W, PAGE_H] });
    const els = Array.from(container.querySelectorAll('.q-block')) as HTMLElement[];
    let y = MARGIN;
    let first = true;

    for (const el of els) {
      const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: null, width: CONTENT_W });
      const blockH = (canvas.height * CONTENT_W) / canvas.width;
      const img = canvas.toDataURL('image/png');

      if (blockH > PAGE_H - MARGIN * 2) {
        // Taller than a page: give it its own page, scaled to fit — never cut.
        if (!first) pdf.addPage([PAGE_W, PAGE_H], 'portrait');
        const usableH = PAGE_H - MARGIN * 2;
        const w = CONTENT_W * (usableH / blockH);
        pdf.addImage(img, 'PNG', MARGIN + (CONTENT_W - w) / 2, MARGIN, w, usableH);
        y = PAGE_H;
        first = false;
        continue;
      }

      if (!first && y + blockH > PAGE_H - MARGIN) {
        pdf.addPage([PAGE_W, PAGE_H], 'portrait');
        y = MARGIN;
      }
      pdf.addImage(img, 'PNG', MARGIN, y, CONTENT_W, blockH);
      y += blockH + GAP;
      first = false;
    }

    return pdf.output('blob');
  } finally {
    document.body.removeChild(container);
  }
}
