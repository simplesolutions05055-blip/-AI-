// Shared brand-matching + brand-context helpers.
// Used by the WhatsApp worker and the admin Simulator chat so both pipelines
// apply the same place branding (palette + style notes) from the `brands` table.

export function normalizeHe(s: string): string {
  // Strip quotes, punctuation and separators so "לא, זה..." normalises to "לא זה..."
  // (otherwise a trailing comma breaks the yes/no word-boundary checks).
  return s.replace(/[",'׳״.\-?!;:()،]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Levenshtein edit distance (iterative, two-row).
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let cur = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

// Tolerance for a token: ~1 typo per 4 chars, capped.
function tolerance(len: number): number {
  if (len <= 3) return 0;
  if (len <= 5) return 1;
  if (len <= 8) return 2;
  return 3;
}

// Does a single needle word fuzzy-match any inbound word?
function fuzzyWordHit(needleWord: string, inboundWords: string[]): boolean {
  const tol = tolerance(needleWord.length);
  return inboundWords.some((w) => {
    if (Math.abs(w.length - needleWord.length) > tol) return false;
    return editDistance(w, needleWord) <= tol;
  });
}

export interface BrandRow {
  id: string;
  name: string;
  aliases: string[];
}

export type BrandMatch = { id: string; name: string; confidence: 'exact' | 'fuzzy' };

// Find an active brand whose name/alias appears in the given text —
// exact substring first, then fuzzy (per-word edit distance) for typos.
export function matchBrandInText(
  brands: BrandRow[],
  text: string
): BrandMatch | null {
  if (!brands?.length) return null;
  const inboundText = normalizeHe(text);
  if (!inboundText) return null;
  const inboundWords = inboundText.split(' ').filter(Boolean);

  // longest needle first so "קרית שמונה" beats a generic "קרית"
  const candidates = brands
    .flatMap((b) => [b.name, ...(b.aliases ?? [])].map((n) => ({ id: b.id, name: b.name, needle: normalizeHe(n) })))
    .filter((c) => c.needle.length >= 2)
    .sort((a, z) => z.needle.length - a.needle.length);

  // pass 1: exact substring (most reliable)
  for (const c of candidates) {
    if (inboundText.includes(c.needle)) return { id: c.id, name: c.name, confidence: 'exact' };
  }

  // pass 2: fuzzy — every word of the needle must fuzzy-hit some inbound word
  for (const c of candidates) {
    const needleWords = c.needle.split(' ').filter((w) => w.length >= 2);
    if (!needleWords.length) continue;
    if (needleWords.every((w) => fuzzyWordHit(w, inboundWords))) {
      return { id: c.id, name: c.name, confidence: 'fuzzy' };
    }
  }
  return null;
}

export interface BrandKit {
  name: string;
  color_palette: Array<{ hex: string; role: string }> | null;
  style_notes: string | null;
  is_active?: boolean;
}

export interface BusinessTextSource {
  title: string;
  content: string;
  source_kind?: 'content_only' | 'visual_only' | 'brand_rules';
}

// Build separated Business Brain context blocks. Text sources are content-only:
// they may guide facts and wording, but never visual style.
export function buildBusinessBrainContext(
  brand: BrandKit | null,
  textSources: BusinessTextSource[] = []
): { content: string | null; visual: string | null; combined: string | null } {
  const contentLines: string[] = [];
  const visualLines: string[] = [];

  const usableSources = textSources
    .filter((source) => source.source_kind !== 'visual_only' && source.content?.trim())
    .slice(0, 12);
  if (usableSources.length) {
    contentLines.push('## מוח עסקי — אזור תוכן בלבד');
    contentLines.push(
      'המידע הבא מיועד לעובדות, מסרים, שירותים, ניסוחים ותוכן בלבד. אסור להסיק ממנו צבעים, פונטים, קומפוזיציה, סגנון עיצובי, מבנה עמוד או איכות ויזואלית.'
    );
    for (const source of usableSources) {
      const text = source.content.trim().slice(0, 4000);
      contentLines.push(`### ${source.title}\n${text}`);
    }
  }

  if (brand && brand.is_active !== false) {
    const colors = (brand.color_palette ?? [])
      .map((c) => `${c.role}: ${c.hex}`)
      .join(', ');

    visualLines.push(`## מוח עסקי — אזור עיצוב ומיתוג בלבד — ${brand.name}`);
    if (colors) {
      visualLines.push(`פלטת הצבעים הרשמית של המותג (כולל ערכי HEX מדויקים): ${colors}.`);
      visualLines.push(
        'זוהי פלטת הצבעים המחייבת והבלעדית לבריף. בשדה "פלטת צבעים" השתמש אך ורק בצבעים ובערכי ה-HEX האלה. אל תמציא צבעים נוספים.'
      );
    }
    if (brand.style_notes) visualLines.push(`הנחיות סגנון מחייבות של המותג: ${brand.style_notes}`);
    visualLines.push(
      'הנחיות העיצוב מגיעות רק מאזור העיצוב והמיתוג. אין להעתיק עיצוב ממסמכים שהוגדרו כאזור תוכן בלבד.'
    );
  }

  const content = contentLines.length ? contentLines.join('\n\n') : null;
  const visual = visualLines.length ? visualLines.join('\n') : null;
  return {
    content,
    visual,
    combined: [content, visual].filter(Boolean).join('\n\n') || null,
  };
}

// Build a Hebrew brand-guidelines block from a brand kit, fed into generation prompts.
export function buildBrandContext(brand: BrandKit | null): string | null {
  return buildBusinessBrainContext(brand).visual;
}
