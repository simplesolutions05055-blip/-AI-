// Branded Hebrew slide-deck builder. Turns a brief + the brand's images into a
// real, downloadable presentation — either a rasterized RTL PDF (Hebrew renders
// perfectly because the browser draws it) or an editable PPTX (PptxGenJS with
// rtlMode + Heebo). Both run fully client-side.
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas-pro';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { randomUUID } from '@/lib/uuid';

export interface DeckSlide {
  title?: string;
  subtitle?: string | null;
  bullets?: string[];
  body?: string | null;
  image_suggestion?: string | null;
  // An AI-generated image assigned to this slide (preferred over brand images).
  aiImage?: DeckImage;
}

export interface DeckImage {
  caption: string;
  isLogo: boolean;
  dataUrl: string;
  natW?: number;
  natH?: number;
}

export interface DeckBrand {
  name?: string;
  logo_path?: string | null;
  color_palette?: Array<{ hex: string; role: string }> | null;
  style_notes?: string | null;
}

interface DeckPalette {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Read an image's natural pixel dimensions so we can preserve its aspect ratio.
function imageSize(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 0, h: 0 });
    img.src = src;
  });
}

// Fit (natW × natH) inside a box, preserving aspect ratio (letterbox, no stretch).
function fitBox(natW: number | undefined, natH: number | undefined, boxW: number, boxH: number): { w: number; h: number } {
  const ar = natW && natH ? natW / natH : boxW / boxH;
  let w = boxW;
  let h = boxW / ar;
  if (h > boxH) {
    h = boxH;
    w = boxH * ar;
  }
  return { w, h };
}

// Resolve the brand a request was attached to (auto-detected server-side).
export async function fetchRequestBrandId(requestId: string): Promise<string | null> {
  const db = createSupabaseBrowserClient();
  const { data } = await db.from('requests').select('brand_id').eq('id', requestId).maybeSingle();
  return (data as { brand_id?: string | null } | null)?.brand_id ?? null;
}

// Ask the Edge function for rich 10-slide structured content for this brief.
export async function fetchDeckSlides(brief: unknown, requestId: string | null): Promise<DeckSlide[]> {
  const db = createSupabaseBrowserClient();
  const { data, error } = await db.functions.invoke('generate-presentation', {
    body: { brief, requestId, format: 'deck' },
  });
  if (error) throw error;
  const slides = (data as { slides?: DeckSlide[] } | null)?.slides;
  return Array.isArray(slides) ? slides : [];
}

// Split a content sentence/paragraph into separate bullet points.
function splitContent(text: string): string[] {
  const parts = text
    .split(/\s*(?:[•·]|;|\n|(?<=[.!?])\s)\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length ? parts : [text.trim()];
}

// Parse the approved presentation outline (the Markdown the worker already
// produced and the user signed off on) into structured slides. This is the
// reliable source of all 10 slides — no second AI round-trip needed.
//
// Recognised shape (per the worker's outline):
//   #### שקף 1: שער
//   - **כותרת:** ...
//   - **תוכן:** ...
//   - **הנחיות עיצוב:** ...   (ignored — palette comes from the brand)
export function parseOutlineSlides(text: string | null | undefined): DeckSlide[] {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const slides: DeckSlide[] = [];
  let cur: DeckSlide | null = null;
  let stop = false;

  const flush = () => {
    if (cur && ((cur.title && cur.title.length) || (cur.bullets && cur.bullets.length))) {
      slides.push(cur);
    }
    cur = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    // The NotebookLM prompt / asset-links appendix is not slide content.
    if (/notebooklm/i.test(line) || /^#{1,6}\s*(prompt|תמונות מהמיתוג|מקור)/i.test(line)) stop = true;
    if (stop) continue;

    const head = line.match(/^#{2,4}\s*שקף\s*\d+\s*[:\-–.]?\s*(.*)$/);
    if (head) {
      flush();
      const sectionTitle = head[1]?.trim();
      cur = { title: sectionTitle || undefined, bullets: [] };
      continue;
    }
    if (!cur) continue;

    // "- **key:** value" lines
    const kv = line.match(/^[-*]\s*\*\*\s*([^:*]+?)\s*:?\s*\*\*\s*:?\s*(.*)$/);
    if (kv) {
      const key = kv[1].trim();
      const val = kv[2].trim();
      if (/כותר/.test(key)) cur.title = val || cur.title;
      else if (/עיצוב|הנחי|פונט|צבע/.test(key)) { /* design hint — skip */ }
      else if (val) cur.bullets!.push(...splitContent(val));
      continue;
    }

    // plain "- bullet" lines (skip the bold-key lines handled above)
    const b = line.match(/^[-*]\s+(.*)$/);
    if (b && b[1] && !b[1].startsWith('**')) cur.bullets!.push(b[1].trim());
  }
  flush();

  return slides.map((s) => ({ ...s, bullets: (s.bullets ?? []).filter(Boolean) }));
}

// Resolve the slides to render: prefer the Edge function's rich JSON deck when
// available, otherwise fall back to parsing the approved outline text. Whichever
// yields a fuller deck wins, so we never end up with a single slide.
export async function buildDeckSlides(
  brief: unknown,
  requestId: string | null,
  outlineText: string | null,
): Promise<DeckSlide[]> {
  let deck: DeckSlide[] = [];
  try {
    deck = await fetchDeckSlides(brief, requestId);
  } catch {
    deck = [];
  }
  if (deck.length >= 3) return deck;
  const parsed = parseOutlineSlides(outlineText);
  return parsed.length > deck.length ? parsed : deck;
}

// Rewrite a single slide's text content per a free-text instruction, via the
// generate-presentation 'rewrite-slide' Edge Function. Only the text fields
// change — the caller keeps the slide's position and any assigned image.
export async function rewriteDeckSlideContent(
  brief: unknown,
  slide: DeckSlide,
  instruction: string,
  slideNumber: number,
  requestId: string | null,
): Promise<DeckSlide> {
  const db = createSupabaseBrowserClient();
  const { data, error } = await db.functions.invoke('generate-presentation', {
    body: {
      format: 'rewrite-slide',
      brief,
      requestId,
      slideNumber,
      instruction,
      slide: {
        title: slide.title ?? '',
        subtitle: slide.subtitle ?? null,
        bullets: Array.isArray(slide.bullets) ? slide.bullets : [],
        body: slide.body ?? null,
        image_suggestion: slide.image_suggestion ?? null,
      },
    },
  });
  if (error) throw error;
  const out = (data as { slide?: DeckSlide } | null)?.slide;
  if (!out) throw new Error('לא התקבל תוכן מעודכן לשקף');
  // Preserve any image already assigned to this slide; only text changes.
  return { ...slide, ...out };
}

// Build an image-generation prompt for one slide from the brief + brand palette.
function buildAiImagePrompt(brief: any, slide: DeckSlide, palette: string): string {
  return [
    `צור תמונה איכותית ומקצועית למצגת בנושא: ${brief?.topic || brief?.goal || ''}.`,
    slide?.image_suggestion
      ? `התוכן החזותי לשקף "${slide.title || ''}": ${slide.image_suggestion}.`
      : `התמונה ממחישה את השקף "${slide.title || ''}".`,
    palette ? `שלב גוונים התואמים לפלטת המותג: ${palette}.` : '',
    'סגנון נקי, מודרני ואמין. אם יש לוגו מותג זמין, הוא צריך להופיע כחלק אינטגרלי מהתמונה, שקוף או חצי-שקוף, ולא כמדבקה נפרדת.',
    'ללא טקסט נוסף, ללא כיתוב וללא מסגרת.',
  ]
    .filter(Boolean)
    .join(' ');
}

// Generate up to 3 AI images for the deck and align each to a chosen slide.
// Targets content slides (index ≥ 1), preferring those with an image_suggestion.
export async function generateAiImages(
  brief: any,
  slides: DeckSlide[],
  count: number,
  requestId: string | null,
  brand: DeckBrand | null,
): Promise<Array<{ index: number; image: DeckImage }>> {
  const n = Math.max(0, Math.min(3, Math.floor(count || 0)));
  if (!n || slides.length < 2) return [];

  // Candidate slides for an image: content slides (skip the title slide), and —
  // when there are enough — only those that actually suggest a visual. We also
  // drop the last slide (usually summary / Q&A) from the preferred pool.
  const content = slides.map((s, i) => ({ s, i })).filter((x) => x.i >= 1);
  const withSug = content.filter((x) => x.s.image_suggestion);
  const interior = withSug.filter((x) => x.i < slides.length - 1);
  const pool = interior.length >= n ? interior : withSug.length >= n ? withSug : content;

  // Spread the N images at interior fractions (k+1)/(n+1) across the pool, so
  // they land on well-distributed mid-deck slides — never forced to the first
  // slides. Dedupe (rounding can collide), then top up if needed.
  const chosen: Array<{ s: DeckSlide; i: number }> = [];
  const seen = new Set<number>();
  if (pool.length) {
    for (let k = 0; k < n; k++) {
      const frac = (k + 1) / (n + 1);
      const idx = Math.round(frac * (pool.length - 1));
      const cand = pool[idx];
      if (cand && !seen.has(cand.i)) {
        seen.add(cand.i);
        chosen.push(cand);
      }
    }
    for (const c of pool) {
      if (chosen.length >= n) break;
      if (!seen.has(c.i)) {
        seen.add(c.i);
        chosen.push(c);
      }
    }
  }
  chosen.sort((a, b) => a.i - b.i);

  const palette = (brand?.color_palette ?? [])
    .map((c) => `${c.role} ${c.hex}`)
    .join(', ');
  const prompts = chosen.map(({ s }) => buildAiImagePrompt(brief, s, palette));
  const slideIndexes = chosen.map(({ i }) => i);
  const captions = chosen.map(({ s }) => s.title || 'תמונת AI');

  const db = createSupabaseBrowserClient();
  const { data, error } = await db.functions.invoke('generate-presentation', {
    body: { format: 'images', brief, requestId, prompts, slideIndexes, captions },
  });
  if (error) throw error;
  const raws = (data as { images?: Array<{ base64: string; mime: string }> } | null)?.images ?? [];

  const out: Array<{ index: number; image: DeckImage }> = [];
  for (let k = 0; k < raws.length && k < chosen.length; k++) {
    const dataUrl = `data:${raws[k].mime || 'image/png'};base64,${raws[k].base64}`;
    const dim = await imageSize(dataUrl);
    out.push({
      index: chosen[k].i,
      image: { caption: chosen[k].s.title || 'תמונת AI', isLogo: false, dataUrl, natW: dim.w, natH: dim.h },
    });
  }
  return out;
}

// A previously generated + persisted AI image for a deck (deck_ai_images row).
export interface PersistedDeckImage {
  id: string;
  slideIndex: number;
  caption: string;
  previewUrl: string; // signed URL, for thumbnails in the UI
  storagePath: string;
  mimeType: string;
}

// Load the AI images previously generated for a request, newest first, with a
// signed preview URL each. Used by the /revise screen to show and reuse them.
export async function fetchPersistedDeckImages(requestId: string): Promise<PersistedDeckImage[]> {
  const db = createSupabaseBrowserClient();
  const { data } = await db
    .from('deck_ai_images')
    .select('id, slide_index, caption, storage_path, mime_type')
    .eq('request_id', requestId)
    .order('created_at', { ascending: false });
  const rows = (data as Array<{
    id: string;
    slide_index: number;
    caption: string | null;
    storage_path: string;
    mime_type: string | null;
  }>) ?? [];

  const out: PersistedDeckImage[] = [];
  for (const r of rows) {
    const { data: signed } = await db.storage.from('outputs').createSignedUrl(r.storage_path, 600);
    if (!signed?.signedUrl) continue;
    out.push({
      id: r.id,
      slideIndex: r.slide_index ?? 0,
      caption: r.caption || 'תמונת AI',
      previewUrl: signed.signedUrl,
      storagePath: r.storage_path,
      mimeType: r.mime_type || 'image/png',
    });
  }
  return out;
}

function imageOutputCaption(brief: unknown): string {
  if (!brief || typeof brief !== 'object') return 'תמונת AI';
  const data = brief as Record<string, unknown>;
  const value = data.goal || data.topic || data.title || data.prompt;
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 80) : 'תמונת AI';
}

// Load every AI image generated for ANY request of a given brand (newest
// first), each with a signed preview URL. Powers the image picker, where the
// user chooses across all of the brand's AI images — not just this request's.
export async function fetchBrandAiImages(brandId: string): Promise<PersistedDeckImage[]> {
  const db = createSupabaseBrowserClient();
  // Goes through a security-definer RPC: it returns only the brand's AI-image
  // rows (gated by user_brands membership) without granting the caller SELECT
  // on the requests table, so customer email/costs are never exposed.
  const { data, error } = await db.rpc('brand_ai_images', { p_brand_id: brandId } as never);
  if (error) throw error;

  const rows = ((data as Array<{
    id: string;
    slide_index: number;
    caption: string | null;
    storage_path: string;
    mime_type: string | null;
    created_at: string;
    source: 'deck' | 'output';
    brief: unknown;
  }>) ?? []).map((row) => ({
    ...row,
    caption: row.caption ?? imageOutputCaption(row.brief),
  }));

  const out: PersistedDeckImage[] = [];
  const seenPaths = new Set<string>();
  for (const r of rows) {
    if (seenPaths.has(r.storage_path)) continue;
    seenPaths.add(r.storage_path);
    const { data: signed } = await db.storage.from('outputs').createSignedUrl(r.storage_path, 600);
    if (!signed?.signedUrl) continue;
    out.push({
      id: r.id,
      slideIndex: r.slide_index ?? 0,
      caption: r.caption || 'תמונת AI',
      previewUrl: signed.signedUrl,
      storagePath: r.storage_path,
      mimeType: r.mime_type || 'image/png',
    });
  }
  return out;
}

// Inline a persisted image as a self-contained DeckImage (base64 dataUrl) so it
// can be embedded into an exported deck exactly like a freshly generated one.
export async function loadPersistedDeckImage(img: PersistedDeckImage): Promise<DeckImage> {
  const res = await fetch(img.previewUrl);
  const blob = await res.blob();
  const dataUrl = await blobToDataUrl(blob);
  const dim = await imageSize(dataUrl);
  return { caption: img.caption, isLogo: false, dataUrl, natW: dim.w, natH: dim.h };
}

// Pull the brand's logo + images, dedup by path, and inline them as base64 so
// the exported deck is fully self-contained.
export async function fetchBrandImages(
  brandId: string,
): Promise<{ brand: DeckBrand | null; images: DeckImage[] }> {
  const db = createSupabaseBrowserClient();
  const [{ data: brand }, { data: assets }] = await Promise.all([
    db.from('brands').select('name, logo_path, color_palette, style_notes').eq('id', brandId).single(),
    db.from('brand_assets').select('storage_path, caption').eq('brand_id', brandId),
  ]);

  const wanted: Array<{ path: string; caption: string; isLogo: boolean }> = [];
  const brandRow = brand as DeckBrand | null;
  if (brandRow?.logo_path) wanted.push({ path: brandRow.logo_path, caption: 'לוגו', isLogo: true });
  for (const a of (assets as Array<{ storage_path: string; caption: string | null }>) ?? []) {
    wanted.push({ path: a.storage_path, caption: a.caption || 'תמונת מיתוג', isLogo: false });
  }

  const seen = new Set<string>();
  const images: DeckImage[] = [];
  for (const w of wanted) {
    if (seen.has(w.path)) continue;
    seen.add(w.path);
    try {
      const { data: signed } = await db.storage.from('branding').createSignedUrl(w.path, 600);
      if (!signed?.signedUrl) continue;
      const res = await fetch(signed.signedUrl);
      if (!res.ok) continue;
      const blob = await res.blob();
      // Guard against non-image bodies (404/auth error pages return JSON/text):
      // converting those to a data URL yields an <img> that never fires load/error
      // and shows an eternal spinner in the picker.
      if (blob.size === 0 || !blob.type.startsWith('image/')) continue;
      const dataUrl = await blobToDataUrl(blob);
      const dim = await imageSize(dataUrl);
      images.push({ caption: w.caption, isLogo: w.isLogo, dataUrl, natW: dim.w, natH: dim.h });
    } catch {
      // skip images that fail to load
    }
  }
  return { brand: brandRow, images };
}

function resolvePalette(brand: DeckBrand | null, brief: any): DeckPalette {
  const pal: Record<string, string> = {};
  for (const c of (brand?.color_palette ?? brief?.brand_palette ?? []) as Array<{ hex: string; role: string }>) {
    if (c?.role && c?.hex) pal[c.role] = c.hex;
  }
  const primary = pal.primary || '#0b3d91';
  return {
    primary,
    secondary: pal.secondary || '#1a1a1a',
    accent: pal.accent || primary,
    background: pal.background || '#ffffff',
  };
}

// Split the resolved slides into a title slide (slide 1 / "שער") + content. When
// nothing parsed, synthesize a single title slide from the brief.
function splitDeck(rawSlides: DeckSlide[], brief: any): { title: DeckSlide; content: DeckSlide[] } {
  if (rawSlides.length) {
    const [first, ...rest] = rawSlides;
    return {
      title: {
        title: first.title || brief?.topic || brief?.goal || 'מצגת',
        subtitle: first.subtitle ?? first.body ?? first.bullets?.[0] ?? brief?.goal ?? null,
      },
      content: rest,
    };
  }
  return {
    title: { title: brief?.topic || brief?.goal || 'מצגת', subtitle: brief?.goal ?? null },
    content: [],
  };
}

// ── PDF: rasterize each RTL HTML slide via html2canvas, page it into a PDF ──
export async function renderDeckToPdf(
  brief: any,
  brand: DeckBrand | null,
  images: DeckImage[],
  rawSlides: DeckSlide[],
): Promise<Blob> {
  const esc = (s: unknown) =>
    String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const { primary, secondary, accent, background } = resolvePalette(brand, brief);
  const logo = images.find((i) => i.isLogo) || null;
  const contentImages = images.filter((i) => !i.isLogo);
  const { title: titleSlide, content } = splitDeck(rawSlides, brief);

  const W = 1280;
  const H = 720;
  const font = `'Heebo','Assistant','Arial Hebrew',Arial,sans-serif`;
  const logoTag = logo ? `<img class="pd-logo" src="${logo.dataUrl}">` : '';

  // Shrink the title font as it gets longer so it never overflows the slide.
  const tLen = String(titleSlide.title ?? '').length;
  const titleSize = tLen > 80 ? 38 : tLen > 50 ? 48 : tLen > 30 ? 58 : 66;

  const slideHtmls: string[] = [];
  slideHtmls.push(`
    <div class="pd-slide pd-title">
      ${logoTag}
      <div class="pd-bar pd-bar-lg"></div>
      <h1 style="font-size:${titleSize}px">${esc(titleSlide.title)}</h1>
      ${titleSlide.subtitle ? `<p class="pd-sub">${esc(titleSlide.subtitle)}</p>` : ''}
      ${brief?.audience ? `<p class="pd-aud">קהל יעד: ${esc(brief.audience)}</p>` : ''}
    </div>`);

  let imgCursor = 0;
  content.forEach((s, i) => {
    const bullets = Array.isArray(s?.bullets) ? s.bullets : [];
    // Prefer an AI image assigned to this slide; else cycle the brand images.
    const realImg =
      s?.aiImage ??
      (Boolean(s?.image_suggestion) && contentImages.length > 0
        ? contentImages[imgCursor++ % contentImages.length]
        : null);
    // Smaller bullet font when a slide is text-heavy, to avoid overflow.
    const total = bullets.join(' ').length + (s?.body?.length ?? 0);
    const listSize = total > 520 ? 20 : total > 320 ? 24 : 27;
    const bodyHtml = `
      ${s?.subtitle ? `<p class="pd-sub2">${esc(s.subtitle)}</p>` : ''}
      ${bullets.length ? `<ul class="pd-list" style="font-size:${listSize}px">${bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
      ${s?.body ? `<p class="pd-para">${esc(s.body)}</p>` : ''}`;
    slideHtmls.push(`
    <div class="pd-slide">
      ${logoTag}
      <div class="pd-bar"></div>
      <h2>${esc(s?.title || `שקף ${i + 2}`)}</h2>
      <div class="pd-body ${realImg ? 'pd-withimg' : ''}">
        <div class="pd-text">${bodyHtml}</div>
        ${realImg ? `<figure><img src="${realImg.dataUrl}"><figcaption>${esc(realImg.caption)}</figcaption></figure>` : ''}
      </div>
      <div class="pd-foot">${esc(brand?.name ?? '')}</div>
      <div class="pd-num">${i + 2}</div>
    </div>`);
  });

  const css = `
    .pd-slide{width:${W}px;height:${H}px;background:${background};color:${secondary};
      box-sizing:border-box;padding:72px 96px;position:relative;display:flex;flex-direction:column;
      justify-content:center;overflow:hidden;font-family:${font};direction:rtl;text-align:right;letter-spacing:0}
    .pd-logo{position:absolute;top:44px;left:72px;height:74px;object-fit:contain}
    .pd-bar{width:72px;height:9px;background:${accent};border-radius:5px;margin-bottom:22px}
    .pd-bar-lg{width:120px;height:12px;margin-bottom:30px}
    .pd-title{align-items:flex-start;justify-content:center}
    .pd-slide h1{font-weight:800;color:${primary};line-height:1.12;margin:0;max-width:88%}
    .pd-slide h2{font-size:46px;font-weight:800;color:${primary};margin:0 0 26px;line-height:1.15}
    .pd-sub{font-size:28px;margin-top:26px;max-width:80%;line-height:1.55;color:${secondary}}
    .pd-aud{font-size:22px;margin-top:20px;color:${accent};font-weight:700}
    .pd-body{display:flex;gap:48px;align-items:flex-start;line-height:1.6}
    .pd-withimg .pd-text{flex:1}
    .pd-sub2{font-size:26px;font-weight:700;color:${secondary};margin:0 0 16px}
    .pd-list{margin:0;padding:0 30px 0 0;list-style:none}
    .pd-list li{position:relative;margin:0 0 16px;padding-right:30px;line-height:1.5}
    .pd-list li::before{content:'';position:absolute;right:0;top:13px;width:13px;height:13px;background:${accent};border-radius:3px}
    .pd-para{font-size:24px;line-height:1.6;margin:18px 0 0}
    figure{margin:0;display:flex;flex-direction:column;gap:10px;align-items:center}
    .pd-body figure img{max-height:420px;max-width:420px;object-fit:contain;border-radius:14px;border:3px solid ${primary}}
    figcaption{font-size:20px;color:${accent};font-weight:700}
    .pd-foot{position:absolute;bottom:34px;right:96px;font-size:18px;color:${secondary};opacity:.55;font-weight:600}
    .pd-num{position:absolute;bottom:30px;left:96px;font-size:20px;color:${accent};font-weight:800}
  `;

  const container = document.createElement('div');
  container.style.cssText = `position:fixed;left:-99999px;top:0;width:${W}px;`;
  container.innerHTML = `<style>${css}</style>${slideHtmls.join('')}`;
  document.body.appendChild(container);

  try {
    await (document as any).fonts?.ready?.catch?.(() => {});
    await new Promise((r) => setTimeout(r, 120));

    const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [W, H] });
    const els = Array.from(container.querySelectorAll('.pd-slide')) as HTMLElement[];
    for (let i = 0; i < els.length; i++) {
      const canvas = await html2canvas(els[i], { scale: 2, useCORS: true, backgroundColor: background, width: W, height: H });
      const img = canvas.toDataURL('image/jpeg', 0.92);
      if (i > 0) pdf.addPage([W, H], 'landscape');
      pdf.addImage(img, 'JPEG', 0, 0, W, H);
    }
    return pdf.output('blob');
  } finally {
    document.body.removeChild(container);
  }
}

// Build the ready-to-paste NotebookLM prompt, referencing each embedded brand
// image by its number ("תמונה 1") so NotebookLM pulls them into the right slide.
export function buildNotebookLmPrompt(
  brief: any,
  brand: DeckBrand | null,
  images: DeckImage[],
  slides: DeckSlide[],
): string {
  const { primary, secondary, accent } = resolvePalette(brand, brief);
  const logo = images.find((i) => i.isLogo) || null;
  const contentImages = images.filter((i) => !i.isLogo);
  const lines: string[] = [];

  lines.push('צור מצגת בעברית, בפורמט Presenter Slides, באורך ברירת מחדל.');
  lines.push('השתמש רק במקורות המסומנים במחברת זו.');
  lines.push('יישר את כל השקופיות מימין לשמאל (RTL) — טקסט עברי בלבד, מיושר לימין בכל שקופית.');
  lines.push('');
  if (brief?.audience) lines.push(`קהל יעד: ${brief.audience}`);
  if (brief?.goal) lines.push(`מטרה: ${brief.goal}`);
  if (brand?.name) lines.push(`טון וסגנון: בהתאם למותג ${brand.name}.`);
  lines.push('');

  // Image placement: logo in its place, other brand images mapped per slide,
  // exactly as embedded (and numbered) in the brief PDF.
  if (images.length) {
    lines.push('שילוב התמונות (מוטמעות במסמך זה, ממוספרות) — מקם כל אחת במקומה:');
    if (logo) {
      const n = images.indexOf(logo) + 1;
      lines.push(`- תמונה ${n} (לוגו): בשקופית השער ובפינת הכותרת של כל שקופית.`);
    }
    contentImages.forEach((img) => {
      const n = images.indexOf(img) + 1;
      lines.push(`- תמונה ${n} (${img.caption}): שבץ בשקופית התוכן המתאימה לפי הנושא.`);
    });
    lines.push('');
  }

  // Full per-slide content — the AI-written copy, slide by slide.
  if (slides.length) {
    lines.push('תוכן השקופיות (כתוב כל שקופית לפי התוכן הבא):');
    slides.forEach((s, i) => {
      lines.push(`שקופית ${i + 1}: ${s?.title || ''}`.trim());
      if (s?.subtitle) lines.push(`  ${s.subtitle}`);
      for (const b of Array.isArray(s?.bullets) ? s.bullets : []) lines.push(`  • ${b}`);
      if (s?.body) lines.push(`  ${s.body}`);
    });
    lines.push('');
  }

  lines.push('כללי עיצוב:');
  lines.push('- אל תעמיס טקסט. מסר מרכזי אחד לכל שקופית.');
  lines.push('- כל שקופית: כותרת ברורה + עד 3 נקודות קצרות + ויזואל דומיננטי אחד.');
  lines.push(`- פלטת צבעים: ראשי ${primary}, משני ${secondary}, הדגשה ${accent}, הרבה לבן.`);
  return lines.join('\n');
}

// ── NotebookLM brief: an A4 source document (NOT a finished deck). It carries
// the campaign brief, slide structure, the ready prompt, and the brand images
// EMBEDDED inside the PDF (numbered "תמונה N") so NotebookLM reads them in
// context — the only reliable way to feed external images to NotebookLM. The
// "how to use" instructions live in the web UI, deliberately not in the file. ──
export async function renderBriefToPdf(
  brief: any,
  brand: DeckBrand | null,
  images: DeckImage[],
  slides: DeckSlide[],
): Promise<Blob> {
  const esc = (s: unknown) =>
    String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const topic = brief?.topic || brief?.goal || 'מצגת';
  const palette = (brand?.color_palette ?? brief?.brand_palette ?? []) as Array<{ hex: string; role: string }>;
  const promptText = buildNotebookLmPrompt(brief, brand, images, slides);

  const detailRows: Array<[string, string]> = [];
  if (brief?.goal) detailRows.push(['מטרה', brief.goal]);
  if (brief?.audience) detailRows.push(['קהל יעד', brief.audience]);
  if (brief?.style) detailRows.push(['סגנון', brief.style]);
  if (brand?.name) detailRows.push(['מותג', brand.name]);

  // Revision notes are pushed into must_include to STEER regeneration, but they
  // are internal instructions ("תיקון משתמש: …") — never customer-facing content.
  // Strip them so the AI-fix text can't leak onto a slide / into the brief output.
  const isRevisionMarker = (s: string) => /^\s*תיקון(\s+משתמש)?\s*:/.test(s);
  const keyMessages: string[] = (
    Array.isArray(brief?.key_messages)
      ? brief.key_messages
      : Array.isArray(brief?.must_include)
        ? brief.must_include
        : []
  ).filter((m: unknown): m is string => typeof m === 'string' && !isRevisionMarker(m));

  // Each entry is a self-contained block. Blocks are packed onto pages without
  // ever being split, so an image (or any section) is never cut across pages.
  const blocks: string[] = [];

  blocks.push(`<div class="bf-block">
    <div class="bf-kicker">בריף ליצירת מצגת · NotebookLM</div>
    <h1>${esc(topic)}</h1>
  </div>`);

  if (detailRows.length) {
    blocks.push(`<div class="bf-block">
      <h2>פרטי הבריף</h2>
      <table>${detailRows.map(([k, v]) => `<tr><td class="bf-k">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>
    </div>`);
  }

  if (keyMessages.length) {
    blocks.push(`<div class="bf-block">
      <h2>מסרי מפתח</h2>
      <ul>${keyMessages.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
    </div>`);
  }

  if (slides.length) {
    // Intro block for the section, then one block per slide carrying the full
    // AI-written content (so a slide is never split across a page boundary).
    blocks.push(`<div class="bf-block"><h2>תוכן השקופיות</h2>
      <p class="bf-note">התוכן המלא לכל שקופית, שנכתב לפי תוכני המותג. זה הטקסט שייכנס למצגת.</p></div>`);
    slides.forEach((s, i) => {
      const bullets = Array.isArray(s?.bullets) ? s.bullets.filter(Boolean) : [];
      blocks.push(`<div class="bf-block">
        <h3>שקופית ${i + 1} — ${esc(s?.title || '')}</h3>
        ${s?.subtitle ? `<p class="bf-sub">${esc(s.subtitle)}</p>` : ''}
        ${bullets.length ? `<ul>${bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
        ${s?.body ? `<p class="bf-para">${esc(s.body)}</p>` : ''}
      </div>`);
    });
  }

  blocks.push(`<div class="bf-block">
    <h2>הפרומפט ל-NotebookLM</h2>
    <p class="bf-note">העתיקו ל-Studio → Slide Deck. ודאו ש-Output Language = עברית.</p>
    <div class="bf-prompt">${esc(promptText).replace(/\n/g, '<br>')}</div>
  </div>`);

  if (images.length) {
    blocks.push(`<div class="bf-block">
      <h2>התמונות (מוטמעות במסמך)</h2>
      <p class="bf-note">אלו התמונות הזמינות במותג. NotebookLM קורא אותן מתוך ה-PDF — אין צורך להעלות קובצי תמונה בנפרד.</p>
    </div>`);
    // One block per image so a picture is always kept whole on a single page.
    images.forEach((img, i) => {
      blocks.push(`<div class="bf-block">
        <h3>תמונה ${i + 1} — ${esc(img.caption)}</h3>
        <img class="bf-img" src="${img.dataUrl}">
        <div class="bf-cap">${img.isLogo ? 'תפקיד: שקופית השער והכותרות.' : 'תפקיד: ויזואל לשקופית מתאימה.'}</div>
      </div>`);
    });
  } else {
    blocks.push(`<div class="bf-block">
      <h2>התמונות</h2>
      <p>למותג זה אין כרגע תמונות. השקופיות יעוצבו בצבעי המותג בלבד.</p>
    </div>`);
  }

  if (palette.length || brand?.style_notes) {
    const swatches = palette
      .map((c) => `<tr><td class="bf-k">${esc(c.role)}</td><td>${esc(c.hex)}</td></tr>`)
      .join('');
    blocks.push(`<div class="bf-block">
      <h2>נתוני מותג${brand?.name ? ` — ${esc(brand.name)}` : ''}</h2>
      ${palette.length ? `<table>${swatches}</table>` : ''}
      ${brand?.style_notes ? `<p class="bf-para">${esc(brand.style_notes)}</p>` : ''}
    </div>`);
  }

  // A4 @ ~96dpi, with margins. Content is laid out at CONTENT_W and packed into
  // pages by measuring each block.
  const PAGE_W = 794;
  const PAGE_H = 1123;
  const MARGIN = 48;
  const CONTENT_W = PAGE_W - MARGIN * 2;
  const GAP = 14; // vertical gap between blocks (PDF px)
  const font = `'Heebo','Assistant','Arial Hebrew',Arial,sans-serif`;
  // Deliberately minimal: black text on white, thin rules, no color fills.
  const css = `
    .bf-block{width:${CONTENT_W}px;background:#fff;color:#1a1a1a;font-family:${font};direction:rtl;text-align:right;
      box-sizing:border-box;font-size:15px;line-height:1.55}
    .bf-block h1{font-size:26px;font-weight:700;margin:0 0 6px;line-height:1.25}
    .bf-block h2{font-size:19px;font-weight:700;margin:0 0 8px;border-bottom:1px solid #000;padding-bottom:4px}
    .bf-block h3{font-size:16px;font-weight:700;margin:0 0 6px}
    .bf-kicker{font-size:12px;color:#555;margin-bottom:4px}
    .bf-block table{width:100%;border-collapse:collapse;font-size:14px}
    .bf-block td{border:1px solid #999;padding:6px 9px;vertical-align:top}
    .bf-k{font-weight:700;white-space:nowrap;width:120px}
    .bf-block ul{margin:0;padding-right:20px}
    .bf-block li{margin:4px 0}
    .bf-note{font-size:13px;color:#555;margin:0 0 6px}
    .bf-sub{font-size:14px;font-weight:700;margin:0 0 6px}
    .bf-para{font-size:14px;line-height:1.6;margin:6px 0 0}
    .bf-prompt{border:1px solid #999;padding:12px 14px;font-size:13px;line-height:1.7;white-space:pre-wrap}
    .bf-img{max-width:100%;border:1px solid #999;display:block}
    .bf-cap{font-size:12px;color:#555;margin-top:4px}
  `;

  const container = document.createElement('div');
  container.style.cssText = `position:fixed;left:-99999px;top:0;width:${CONTENT_W}px;`;
  container.innerHTML = `<style>${css}</style>${blocks.join('')}`;
  document.body.appendChild(container);

  try {
    await (document as any).fonts?.ready?.catch?.(() => {});
    await new Promise((r) => setTimeout(r, 120));

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: [PAGE_W, PAGE_H] });
    const usableH = PAGE_H - MARGIN * 2;
    const els = Array.from(container.querySelectorAll('.bf-block')) as HTMLElement[];
    let y = MARGIN;
    let first = true;

    for (const el of els) {
      const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff', width: CONTENT_W });
      const blockH = (canvas.height * CONTENT_W) / canvas.width; // height in PDF px
      const img = canvas.toDataURL('image/jpeg', 0.92);

      if (blockH > usableH) {
        // Taller than a full page (e.g. a big image): give it its own page,
        // scaled down to fit — never cut. Mark the page full so the next block
        // starts fresh, without leaving a trailing blank page.
        if (!first) pdf.addPage([PAGE_W, PAGE_H], 'portrait');
        const w = CONTENT_W * (usableH / blockH);
        pdf.addImage(img, 'JPEG', MARGIN + (CONTENT_W - w) / 2, MARGIN, w, usableH);
        y = PAGE_H; // sentinel: current page is full
        first = false;
        continue;
      }

      // Start a new page if this block would overflow the current one.
      if (!first && y + blockH > PAGE_H - MARGIN) {
        pdf.addPage([PAGE_W, PAGE_H], 'portrait');
        y = MARGIN;
      }
      pdf.addImage(img, 'JPEG', MARGIN, y, CONTENT_W, blockH);
      y += blockH + GAP;
      first = false;
    }

    return pdf.output('blob');
  } finally {
    document.body.removeChild(container);
  }
}

// ── PPTX: editable deck via PptxGenJS, RTL + Heebo, brand palette & images ──
export async function renderDeckToPptx(
  brief: any,
  brand: DeckBrand | null,
  images: DeckImage[],
  rawSlides: DeckSlide[],
): Promise<Blob> {
  const PptxGenJS = (await import('pptxgenjs')).default;
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'WIDE', width: 13.33, height: 7.5 });
  pptx.layout = 'WIDE';
  pptx.rtlMode = true;

  const { primary, secondary, accent, background } = resolvePalette(brand, brief);
  const hex = (c: string) => c.replace('#', '').toUpperCase();
  const FONT = 'Heebo';
  const W = 13.33;
  const H = 7.5;
  const M = 0.7; // page margin

  const logo = images.find((i) => i.isLogo) || null;
  const contentImages = images.filter((i) => !i.isLogo);
  const { title: titleSlide, content } = splitDeck(rawSlides, brief);

  const addLogo = (s: any) => {
    if (!logo) return;
    const { w, h } = fitBox(logo.natW, logo.natH, 1.5, 0.72);
    s.addImage({ data: logo.dataUrl, x: 0.5, y: 0.35 + (0.72 - h) / 2, w, h });
  };

  // ── Title slide ──
  const t = pptx.addSlide();
  t.background = { color: hex(background) };
  addLogo(t);
  t.addShape('rect', { x: M, y: 2.35, w: 1.7, h: 0.18, fill: { color: hex(accent) } });
  t.addText(String(titleSlide.title ?? 'מצגת'), {
    x: M, y: 2.7, w: W - M * 2, h: 2.1,
    fontFace: FONT, fontSize: 40, bold: true, color: hex(primary),
    align: 'right', rtlMode: true, valign: 'top', fit: 'shrink',
  });
  if (titleSlide.subtitle) {
    t.addText(String(titleSlide.subtitle), {
      x: M, y: 4.9, w: W - M * 2, h: 1.4,
      fontFace: FONT, fontSize: 20, color: hex(secondary),
      align: 'right', rtlMode: true, valign: 'top', lineSpacingMultiple: 1.4, fit: 'shrink',
    });
  }
  if (brief?.audience) {
    t.addText(`קהל יעד: ${brief.audience}`, {
      x: M, y: 6.4, w: W - M * 2, h: 0.6,
      fontFace: FONT, fontSize: 15, bold: true, color: hex(accent), align: 'right', rtlMode: true,
    });
  }

  // ── Content slides ──
  let imgCursor = 0;
  content.forEach((s, i) => {
    const slide = pptx.addSlide();
    slide.background = { color: hex(background) };
    addLogo(slide);

    slide.addShape('rect', { x: W - M - 1.1, y: 1.32, w: 1.1, h: 0.14, fill: { color: hex(accent) } });
    slide.addText(String(s?.title || `שקף ${i + 2}`), {
      x: M, y: 1.5, w: W - M * 2, h: 0.95,
      fontFace: FONT, fontSize: 28, bold: true, color: hex(primary),
      align: 'right', rtlMode: true, valign: 'top', fit: 'shrink',
    });

    const realImg =
      s?.aiImage ??
      (Boolean(s?.image_suggestion) && contentImages.length > 0
        ? contentImages[imgCursor++ % contentImages.length]
        : null);
    const textW = realImg ? W - M * 2 - 4.4 : W - M * 2;
    const textX = realImg ? M + 4.4 : M;

    // Per-paragraph RTL + right alignment MUST live on each run's options — the
    // top-level addText options don't propagate the paragraph rtl flag when text
    // is an array, which left the bullet squares stuck on the left.
    const para = { align: 'right' as const, rtlMode: true };
    const runs: Array<{ text: string; options?: any }> = [];
    if (s?.subtitle) {
      runs.push({ text: String(s.subtitle), options: { ...para, fontSize: 18, bold: true, color: hex(secondary), breakLine: true, paraSpaceAfter: 10 } });
    }
    for (const b of Array.isArray(s?.bullets) ? s.bullets : []) {
      runs.push({
        text: String(b),
        // Square bullet via OOXML char code — never a literal "•" in the text
        // (PptxGenJS would double it). paraSpaceAfter (not lineSpacing) sets gaps.
        options: { ...para, fontSize: 16, color: hex(secondary), bullet: { code: '25AA', indent: 20 }, breakLine: true, paraSpaceAfter: 8 },
      });
    }
    if (s?.body) {
      runs.push({ text: String(s.body), options: { ...para, fontSize: 15, color: hex(secondary), breakLine: true, paraSpaceBefore: 10, lineSpacingMultiple: 1.3 } });
    }
    if (runs.length) {
      slide.addText(runs as any, {
        x: textX, y: 2.55, w: textW, h: H - 2.55 - 0.9,
        fontFace: FONT, align: 'right', rtlMode: true, valign: 'top', fit: 'shrink',
      });
    }

    if (realImg) {
      // Preserve aspect ratio — fit inside the box and center it (no stretching).
      const boxW = 3.9;
      const boxH = 3.6;
      const { w, h } = fitBox(realImg.natW, realImg.natH, boxW, boxH);
      slide.addImage({ data: realImg.dataUrl, x: M + (boxW - w) / 2, y: 2.7 + (boxH - h) / 2, w, h });
    }

    // footer: brand name + slide number
    if (brand?.name) {
      slide.addText(String(brand.name), { x: M, y: H - 0.55, w: 5, h: 0.4, fontFace: FONT, fontSize: 10, color: hex(secondary), align: 'right', rtlMode: true });
    }
    slide.addText(String(i + 2), { x: W - M - 1, y: H - 0.55, w: 1, h: 0.4, fontFace: FONT, fontSize: 11, bold: true, color: hex(accent), align: 'left' });
  });

  const blob = (await pptx.write({ outputType: 'blob' })) as Blob;
  return blob;
}

// Build a real branded Hebrew PPTX via Claude's pptx skill (generate-pptx-claude
// edge function). Reuses the exact slide content from buildNotebookLmPrompt and
// passes the brand's images (logo first) + palette so Claude can embed them.
export async function generatePptxWithClaude(
  brief: any,
  brand: DeckBrand | null,
  images: DeckImage[],
  slides: DeckSlide[],
): Promise<{ pptx: Blob; fileName: string }> {
  const client = createSupabaseBrowserClient();
  const inputText = buildNotebookLmPrompt(brief, brand, images, slides);
  // Logo first, then content images — keep payload bounded.
  const ordered = [...images].sort((a, b) => Number(b.isLogo) - Number(a.isLogo)).slice(0, 8);
  const palette = (brand?.color_palette ?? (brief?.brand_palette as any) ?? []) as Array<{ hex?: string; role?: string }>;

  // The Claude run takes 1–3 minutes — longer than a synchronous request
  // survives. Start it in the background, then poll for the result.
  const jobId = randomUUID();
  const { error: startErr } = await client.functions.invoke('generate-pptx-claude', {
    body: {
      action: 'start',
      jobId,
      inputText,
      brandName: brand?.name ?? null,
      palette,
      images: ordered.map((i) => ({ dataUrl: i.dataUrl, caption: i.caption })),
    },
  });
  if (startErr) throw startErr;

  type PptxStatus = { status?: string; pptxBase64?: string; fileName?: string; error?: string | null };
  const deadline = Date.now() + 6 * 60 * 1000;
  let res: PptxStatus | null = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    const { data, error } = await client.functions.invoke('generate-pptx-claude', {
      body: { action: 'status', jobId },
    });
    if (error) throw error;
    res = data as PptxStatus;
    if (res?.status === 'done' && res.pptxBase64) break;
    if (res?.status === 'error') throw new Error(res.error || 'יצירת המצגת נכשלה');
  }
  if (!res?.pptxBase64) throw new Error('יצירת המצגת נמשכה זמן רב מדי');
  const bytes = Uint8Array.from(atob(res.pptxBase64), (c) => c.charCodeAt(0));
  const pptx = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  });
  return { pptx, fileName: res.fileName || 'presentation.pptx' };
}

// ═══════════════════════════════════════════════════════════════════════════
// "מצגת עם GPT Images" — per-slide GPT image generation + rich RTL renderers.
// The user picks WHICH slides get an AI image (a 1-based range like "1-5" or
// "1,3,7"), approves each image in a modal, and only then the deck is built.
// ═══════════════════════════════════════════════════════════════════════════

// Parse a 1-based slide-range string ("1-5", "1,3,7", "2 4") into sorted unique
// 0-based indexes into the full slides array (index 0 = the cover slide).
export function parseSlideRange(input: string, max: number): number[] {
  const out = new Set<number>();
  for (const tok of String(input || '').split(/[,\s]+/).filter(Boolean)) {
    const m = tok.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (m) {
      let a = Number(m[1]);
      let b = Number(m[2]);
      if (a > b) [a, b] = [b, a];
      for (let n = a; n <= b; n++) if (n >= 1 && n <= max) out.add(n - 1);
    } else if (/^\d+$/.test(tok)) {
      const n = Number(tok);
      if (n >= 1 && n <= max) out.add(n - 1);
    }
  }
  return [...out].sort((x, y) => x - y);
}

// Cover slides get a dedicated hero prompt (wide, atmospheric, text-free) —
// the regular per-slide prompt is tuned for content slides.
function buildCoverImagePrompt(brief: any, slide: DeckSlide, palette: string): string {
  return [
    `צור תמונת שער (Hero) רחבה ואווירתית למצגת בנושא: ${brief?.topic || brief?.goal || slide?.title || ''}.`,
    'התמונה תשמש כרקע מלא לשקף הפתיחה, ולכן היא צריכה להיות ניתנת לקריאה עם טקסט לבן מעליה — קומפוזיציה נקייה, לא עמוסה.',
    palette ? `שלב גוונים התואמים לפלטת המותג: ${palette}.` : '',
    'סגנון עריכתי מודרני ואיכותי. ללא טקסט, ללא כיתוב, ללא לוגו וללא מסגרת.',
  ]
    .filter(Boolean)
    .join(' ');
}

// Full-slide (NotebookLM-style) prompt: GPT renders the WHOLE slide as one
// designed image — background, graphics, layout AND the Hebrew text baked in.
// No fixed template; every slide gets its own unique design. Text stays crisp
// because current image models render Hebrew accurately at high quality.
function buildFullSlideImagePrompt(brief: any, slide: DeckSlide, palette: string, slideNumber: number): string {
  const bullets = Array.isArray(slide?.bullets) ? slide.bullets : [];
  const lines = [
    'צור שקופית מצגת שלמה ומעוצבת בפורמט 16:9 (רוחבי), בעברית מלאה ומדויקת, מיושרת מימין לשמאל (RTL).',
    'כל השקופית היא תמונה אחת מעוצבת: רקע, גרפיקה, אלמנטים ויזואליים וטקסט קריא — כמו שקופית מקצועית של NotebookLM, לא template אחיד.',
    `כותרת ראשית: «${slide?.title || ''}».`,
  ];
  if (slide?.subtitle) lines.push(`כותרת משנה: «${slide.subtitle}».`);
  if (bullets.length) lines.push('נקודות תוכן: ' + bullets.map((b) => `«${b}»`).join(' ; ') + '.');
  if (slide?.body) lines.push(`טקסט מלווה: «${slide.body}».`);
  if (brief?.topic || brief?.goal) lines.push(`נושא המצגת: ${brief?.topic || brief?.goal}.`);
  lines.push(
    `עיצוב מודרני, נקי ויוקרתי${palette ? `, בהשראת צבעי המותג הבאים כהנחיית סגנון פנימית בלבד: ${palette}` : ''}.`,
    'חשוב: התמונה תוצב במצגת בלי חיתוך ובלי מתיחה. בנה קומפוזיציה מאוזנת, עם שוליים פנימיים נקיים וטקסט שאינו צמוד לקצוות.',
    'חשוב מאוד: כל הטקסט חייב להיות בעברית תקנית ומדויקת בדיוק כפי שנמסר, מיושר לימין, קריא וחד. אל תמציא אותיות ואל תשבש מילים.',
    'אסור להציג על השקף שמות צבעים, קודי צבע, פלטת צבעים, הנחיות עיצוב, מפרט עיצובי או הסברים על העיצוב. השקף חייב להציג רק את תוכן המצגת לקהל.',
    slideNumber === 1 ? 'זהו שקף הפתיחה — כותרת גדולה ובולטת.' : 'שקף תוכן — הדגש את הנקודות בצורה ברורה וקריאה.',
  );
  return lines.join('\n');
}

// Generate one GPT image per selected slide (explicit 0-based indexes chosen by
// the user), persisting each to deck_ai_images. Optional per-slide feedback is
// appended to the prompt (the "regenerate with notes" path in the approval
// modal). In `fullSlide` mode each image IS the whole slide (text baked in),
// rendered on a wide 16:9 high-quality canvas. Returns images aligned to indexes.
export async function generateGptImagesForSlides(
  brief: any,
  slides: DeckSlide[],
  slideIndexes: number[],
  requestId: string | null,
  brand: DeckBrand | null,
  feedback?: Record<number, string>,
  fullSlide = false,
): Promise<Array<{ index: number; image: DeckImage; prompt: string }>> {
  const valid = slideIndexes.filter((i) => i >= 0 && i < slides.length);
  if (!valid.length) return [];

  const palette = (brand?.color_palette ?? [])
    .map((c) => `${c.role} ${c.hex}`)
    .join(', ');
  const prompts = valid.map((i) => {
    const base = fullSlide
      ? buildFullSlideImagePrompt(brief, slides[i], palette, i + 1)
      : i === 0 ? buildCoverImagePrompt(brief, slides[i], palette) : buildAiImagePrompt(brief, slides[i], palette);
    const note = feedback?.[i]?.trim();
    return note ? `${base}\n\nהערות תיקון מהמשתמש (חובה ליישם): ${note}` : base;
  });
  const captions = valid.map((i) => slides[i]?.title || (i === 0 ? 'שער' : `שקף ${i + 1}`));

  const db = createSupabaseBrowserClient();
  const { data, error } = await db.functions.invoke('generate-presentation', {
    // gpt-image-1 does not support a true 16:9 size; landscape output is 3:2.
    // Keep the original image and place it with contain in PPTX/PDF so it is
    // never stretched or cropped.
    body: {
      format: 'images', brief, requestId, prompts, slideIndexes: valid, captions,
      ...(fullSlide ? { imageSize: '1536x1024', imageQuality: 'high' } : {}),
    },
  });
  if (error) throw error;
  const raws = (data as { images?: Array<{ base64: string; mime: string }> } | null)?.images ?? [];

  const out: Array<{ index: number; image: DeckImage; prompt: string }> = [];
  for (let k = 0; k < raws.length && k < valid.length; k++) {
    const dataUrl = `data:${raws[k].mime || 'image/png'};base64,${raws[k].base64}`;
    const dim = await imageSize(dataUrl);
    out.push({
      index: valid[k],
      prompt: prompts[k],
      image: { caption: captions[k], isLogo: false, dataUrl, natW: dim.w, natH: dim.h },
    });
  }
  return out;
}

// ── Rich PPTX: cover = full-bleed GPT image + overlay; content slides with an
// image use a half-half split (image left, text right — RTL reads text first).
// Slides without an image keep the classic title+body layout. ──
export async function renderGptDeckToPptx(
  brief: any,
  brand: DeckBrand | null,
  images: DeckImage[],
  rawSlides: DeckSlide[],
): Promise<Blob> {
  const PptxGenJS = (await import('pptxgenjs')).default;
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'WIDE', width: 13.33, height: 7.5 });
  pptx.layout = 'WIDE';
  pptx.rtlMode = true;

  const { primary, secondary, accent, background } = resolvePalette(brand, brief);
  const hex = (c: string) => c.replace('#', '').toUpperCase();
  const FONT = 'Heebo';
  const W = 13.33;
  const H = 7.5;
  const M = 0.7;

  const logo = images.find((i) => i.isLogo) || null;
  const cover = rawSlides[0];
  const content = rawSlides.slice(1);
  const coverTitle = cover?.title || brief?.topic || brief?.goal || 'מצגת';
  const coverSubtitle = cover?.subtitle ?? cover?.body ?? cover?.bullets?.[0] ?? brief?.goal ?? null;

  const addLogo = (s: any, light = false) => {
    if (!logo) return;
    const { w, h } = fitBox(logo.natW, logo.natH, 1.5, 0.72);
    s.addImage({ data: logo.dataUrl, x: 0.5, y: 0.35 + (0.72 - h) / 2, w, h, ...(light ? {} : {}) });
  };

  // ── Cover ──
  const t = pptx.addSlide();
  if (cover?.aiImage) {
    // Full-bleed hero + dark overlay; title/subtitle in white, right-aligned.
    t.addImage({ data: cover.aiImage.dataUrl, x: 0, y: 0, w: W, h: H, sizing: { type: 'cover', w: W, h: H } });
    t.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: '000000', transparency: 52 }, line: { type: 'none' } });
    addLogo(t, true);
    t.addShape('rect', { x: W - M - 1.7, y: 2.6, w: 1.7, h: 0.18, fill: { color: hex(accent) }, line: { type: 'none' } });
    t.addText(String(coverTitle), {
      x: M, y: 2.95, w: W - M * 2, h: 2.0,
      fontFace: FONT, fontSize: 44, bold: true, color: 'FFFFFF',
      align: 'right', rtlMode: true, valign: 'top', fit: 'shrink',
    });
    if (coverSubtitle) {
      t.addText(String(coverSubtitle), {
        x: M, y: 5.0, w: W - M * 2, h: 1.3,
        fontFace: FONT, fontSize: 20, color: 'F3F4F6',
        align: 'right', rtlMode: true, valign: 'top', lineSpacingMultiple: 1.4, fit: 'shrink',
      });
    }
    if (brief?.audience) {
      t.addText(`קהל יעד: ${brief.audience}`, {
        x: M, y: 6.5, w: W - M * 2, h: 0.55,
        fontFace: FONT, fontSize: 15, bold: true, color: 'FFFFFF', align: 'right', rtlMode: true,
      });
    }
  } else {
    t.background = { color: hex(background) };
    addLogo(t);
    t.addShape('rect', { x: M, y: 2.35, w: 1.7, h: 0.18, fill: { color: hex(accent) }, line: { type: 'none' } });
    t.addText(String(coverTitle), {
      x: M, y: 2.7, w: W - M * 2, h: 2.1,
      fontFace: FONT, fontSize: 40, bold: true, color: hex(primary),
      align: 'right', rtlMode: true, valign: 'top', fit: 'shrink',
    });
    if (coverSubtitle) {
      t.addText(String(coverSubtitle), {
        x: M, y: 4.9, w: W - M * 2, h: 1.4,
        fontFace: FONT, fontSize: 20, color: hex(secondary),
        align: 'right', rtlMode: true, valign: 'top', lineSpacingMultiple: 1.4, fit: 'shrink',
      });
    }
    if (brief?.audience) {
      t.addText(`קהל יעד: ${brief.audience}`, {
        x: M, y: 6.4, w: W - M * 2, h: 0.6,
        fontFace: FONT, fontSize: 15, bold: true, color: hex(accent), align: 'right', rtlMode: true,
      });
    }
  }

  // ── Content slides ──
  content.forEach((s, i) => {
    const slide = pptx.addSlide();
    slide.background = { color: hex(background) };
    const img = s?.aiImage ?? null;
    const split = Boolean(img);

    // Split layout: image fills the left 40%, text lives on the right 60%.
    const IMG_W = 5.3;
    const textX = split ? IMG_W + 0.5 : M;
    const textW = split ? W - IMG_W - 0.5 - M : W - M * 2;

    if (img) {
      slide.addImage({ data: img.dataUrl, x: 0, y: 0, w: IMG_W, h: H, sizing: { type: 'cover', w: IMG_W, h: H } });
      // Thin brand-accent divider between image and text.
      slide.addShape('rect', { x: IMG_W, y: 0, w: 0.07, h: H, fill: { color: hex(accent) }, line: { type: 'none' } });
    }
    if (!split) addLogo(slide);
    else if (logo) {
      const { w, h } = fitBox(logo.natW, logo.natH, 1.2, 0.6);
      slide.addImage({ data: logo.dataUrl, x: textX + 0.1, y: 0.35 + (0.6 - h) / 2, w, h });
    }

    slide.addShape('rect', { x: W - M - 1.1, y: 1.32, w: 1.1, h: 0.14, fill: { color: hex(accent) }, line: { type: 'none' } });
    slide.addText(String(s?.title || `שקף ${i + 2}`), {
      x: textX, y: 1.5, w: textW, h: 0.95,
      fontFace: FONT, fontSize: 27, bold: true, color: hex(primary),
      align: 'right', rtlMode: true, valign: 'top', fit: 'shrink',
    });

    // Per-paragraph RTL + right alignment MUST live on each run's options — the
    // top-level addText options don't propagate the paragraph rtl flag when text
    // is an array (learned the hard way with the classic renderer).
    const para = { align: 'right' as const, rtlMode: true };
    const runs: Array<{ text: string; options?: any }> = [];
    if (s?.subtitle) {
      runs.push({ text: String(s.subtitle), options: { ...para, fontSize: 17, bold: true, color: hex(secondary), breakLine: true, paraSpaceAfter: 10 } });
    }
    for (const b of Array.isArray(s?.bullets) ? s.bullets : []) {
      runs.push({
        text: String(b),
        options: { ...para, fontSize: 15, color: hex(secondary), bullet: { code: '25AA', indent: 20 }, breakLine: true, paraSpaceAfter: 8 },
      });
    }
    if (s?.body) {
      runs.push({ text: String(s.body), options: { ...para, fontSize: 14, color: hex(secondary), breakLine: true, paraSpaceBefore: 10, lineSpacingMultiple: 1.3 } });
    }
    if (runs.length) {
      slide.addText(runs as any, {
        x: textX, y: 2.55, w: textW, h: H - 2.55 - 0.9,
        fontFace: FONT, align: 'right', rtlMode: true, valign: 'top', fit: 'shrink',
      });
    }

    if (brand?.name) {
      slide.addText(String(brand.name), { x: textX, y: H - 0.55, w: 4.5, h: 0.4, fontFace: FONT, fontSize: 10, color: hex(secondary), align: 'right', rtlMode: true });
    }
    slide.addText(String(i + 2), { x: W - M - 1, y: H - 0.55, w: 1, h: 0.4, fontFace: FONT, fontSize: 11, bold: true, color: hex(accent), align: 'left' });
  });

  const blob = (await pptx.write({ outputType: 'blob' })) as Blob;
  return blob;
}

// ── Rich PDF: same three layouts, rasterized from RTL HTML (Hebrew shaping is
// the browser's, so it's always correct). ──
export async function renderGptDeckToPdf(
  brief: any,
  brand: DeckBrand | null,
  images: DeckImage[],
  rawSlides: DeckSlide[],
): Promise<Blob> {
  const esc = (s: unknown) =>
    String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const { primary, secondary, accent, background } = resolvePalette(brand, brief);
  const logo = images.find((i) => i.isLogo) || null;
  const cover = rawSlides[0];
  const content = rawSlides.slice(1);
  const coverTitle = cover?.title || brief?.topic || brief?.goal || 'מצגת';
  const coverSubtitle = cover?.subtitle ?? cover?.body ?? cover?.bullets?.[0] ?? brief?.goal ?? null;

  const W = 1280;
  const H = 720;
  const font = `'Heebo','Assistant','Arial Hebrew',Arial,sans-serif`;
  const logoTag = logo ? `<img class="gd-logo" src="${logo.dataUrl}">` : '';

  const tLen = String(coverTitle ?? '').length;
  const titleSize = tLen > 80 ? 40 : tLen > 50 ? 50 : tLen > 30 ? 60 : 68;

  const slideHtmls: string[] = [];
  if (cover?.aiImage) {
    slideHtmls.push(`
    <div class="gd-slide gd-cover" style="background-image:linear-gradient(rgba(0,0,0,.48),rgba(0,0,0,.48)),url('${cover.aiImage.dataUrl}')">
      ${logoTag}
      <div class="gd-bar gd-bar-lg"></div>
      <h1 style="font-size:${titleSize}px">${esc(coverTitle)}</h1>
      ${coverSubtitle ? `<p class="gd-sub gd-light">${esc(coverSubtitle)}</p>` : ''}
      ${brief?.audience ? `<p class="gd-aud gd-light-strong">קהל יעד: ${esc(brief.audience)}</p>` : ''}
    </div>`);
  } else {
    slideHtmls.push(`
    <div class="gd-slide gd-cover gd-cover-plain">
      ${logoTag}
      <div class="gd-bar gd-bar-lg"></div>
      <h1 style="font-size:${titleSize}px;color:${primary}">${esc(coverTitle)}</h1>
      ${coverSubtitle ? `<p class="gd-sub" style="color:${secondary}">${esc(coverSubtitle)}</p>` : ''}
      ${brief?.audience ? `<p class="gd-aud" style="color:${accent}">קהל יעד: ${esc(brief.audience)}</p>` : ''}
    </div>`);
  }

  content.forEach((s, i) => {
    const bullets = Array.isArray(s?.bullets) ? s.bullets : [];
    const img = s?.aiImage ?? null;
    const total = bullets.join(' ').length + (s?.body?.length ?? 0);
    const listSize = total > 520 ? 19 : total > 320 ? 23 : 26;
    const bodyHtml = `
      ${s?.subtitle ? `<p class="gd-sub2">${esc(s.subtitle)}</p>` : ''}
      ${bullets.length ? `<ul class="gd-list" style="font-size:${listSize}px">${bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
      ${s?.body ? `<p class="gd-para">${esc(s.body)}</p>` : ''}`;
    slideHtmls.push(`
    <div class="gd-slide ${img ? 'gd-split' : ''}">
      ${img ? `<div class="gd-img" style="background-image:url('${img.dataUrl}')"></div>` : ''}
      <div class="gd-content">
        ${logoTag}
        <div class="gd-bar"></div>
        <h2>${esc(s?.title || `שקף ${i + 2}`)}</h2>
        ${bodyHtml}
        <div class="gd-foot">${esc(brand?.name ?? '')}</div>
        <div class="gd-num">${i + 2}</div>
      </div>
    </div>`);
  });

  const css = `
    .gd-slide{width:${W}px;height:${H}px;background:${background};color:${secondary};
      box-sizing:border-box;position:relative;overflow:hidden;font-family:${font};direction:rtl;text-align:right;letter-spacing:0}
    .gd-cover{display:flex;flex-direction:column;justify-content:center;align-items:flex-start;
      padding:72px 96px;background-size:cover;background-position:center;color:#fff}
    .gd-cover-plain{background:${background}}
    .gd-cover h1{font-weight:800;line-height:1.12;margin:0;max-width:88%;color:#fff}
    .gd-cover-plain h1{color:${primary}}
    .gd-logo{position:absolute;top:44px;left:72px;height:74px;object-fit:contain}
    .gd-bar{width:72px;height:9px;background:${accent};border-radius:5px;margin-bottom:22px}
    .gd-bar-lg{width:120px;height:12px;margin-bottom:30px}
    .gd-sub{font-size:28px;margin-top:26px;max-width:80%;line-height:1.55}
    .gd-light{color:#f3f4f6}
    .gd-light-strong{color:#fff}
    .gd-aud{font-size:22px;margin-top:20px;font-weight:700}
    .gd-split{display:flex;flex-direction:row}
    .gd-img{width:40%;height:100%;background-size:cover;background-position:center;border-right:6px solid ${accent};order:2}
    .gd-split .gd-content{width:60%;order:1}
    .gd-content{box-sizing:border-box;padding:72px 96px 72px 64px;position:relative;height:100%;
      display:flex;flex-direction:column;justify-content:flex-start}
    .gd-slide:not(.gd-split) .gd-content{width:100%;padding:72px 96px}
    .gd-content h2{font-size:44px;font-weight:800;color:${primary};margin:0 0 26px;line-height:1.15}
    .gd-sub2{font-size:26px;font-weight:700;color:${secondary};margin:0 0 16px}
    .gd-list{margin:0;padding:0 30px 0 0;list-style:none}
    .gd-list li{position:relative;margin:0 0 16px;padding-right:30px;line-height:1.5}
    .gd-list li::before{content:'';position:absolute;right:0;top:13px;width:13px;height:13px;background:${accent};border-radius:3px}
    .gd-para{font-size:24px;line-height:1.6;margin:18px 0 0}
    .gd-foot{position:absolute;bottom:34px;right:96px;font-size:18px;color:${secondary};opacity:.55;font-weight:600}
    .gd-num{position:absolute;bottom:30px;left:64px;font-size:20px;color:${accent};font-weight:800}
  `;

  const container = document.createElement('div');
  container.style.cssText = `position:fixed;left:-99999px;top:0;width:${W}px;`;
  container.innerHTML = `<style>${css}</style>${slideHtmls.join('')}`;
  document.body.appendChild(container);

  try {
    await (document as any).fonts?.ready?.catch?.(() => {});
    await new Promise((r) => setTimeout(r, 120));

    const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [W, H] });
    const els = Array.from(container.querySelectorAll('.gd-slide')) as HTMLElement[];
    for (let i = 0; i < els.length; i++) {
      const canvas = await html2canvas(els[i], { scale: 2, useCORS: true, backgroundColor: background, width: W, height: H });
      const img = canvas.toDataURL('image/jpeg', 0.92);
      if (i > 0) pdf.addPage([W, H], 'landscape');
      pdf.addImage(img, 'JPEG', 0, 0, W, H);
    }
    return pdf.output('blob');
  } finally {
    document.body.removeChild(container);
  }
}

// ── Full-slide mode: each slide IS one GPT image placed inside the frame
// (NotebookLM-style, text baked in). The deck is just a container — no text
// boxes, no template. `slideImages` are ordered by slide. ──
export async function renderFullSlideDeckToPptx(slideImages: DeckImage[]): Promise<Blob> {
  const PptxGenJS = (await import('pptxgenjs')).default;
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'WIDE', width: 13.33, height: 7.5 });
  pptx.layout = 'WIDE';
  pptx.rtlMode = true;
  for (const img of slideImages) {
    const s = pptx.addSlide();
    const nat = img.natW && img.natH ? { w: img.natW, h: img.natH } : await imageSize(img.dataUrl);
    const box = fitBox(nat.w, nat.h, 13.33, 7.5);
    s.addImage({ data: img.dataUrl, x: (13.33 - box.w) / 2, y: (7.5 - box.h) / 2, w: box.w, h: box.h });
  }
  return (await pptx.write({ outputType: 'blob' })) as Blob;
}

export async function renderFullSlideDeckToPdf(slideImages: DeckImage[]): Promise<Blob> {
  const W = 1280, H = 720;
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [W, H] });
  for (let i = 0; i < slideImages.length; i++) {
    if (i > 0) pdf.addPage([W, H], 'landscape');
    const img = slideImages[i];
    const nat = img.natW && img.natH ? { w: img.natW, h: img.natH } : await imageSize(img.dataUrl);
    const box = fitBox(nat.w, nat.h, W, H);
    pdf.addImage(img.dataUrl, 'PNG', (W - box.w) / 2, (H - box.h) / 2, box.w, box.h);
  }
  return pdf.output('blob');
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
