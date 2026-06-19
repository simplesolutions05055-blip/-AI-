// Shared brand-matching + brand-context helpers.
// Used by the WhatsApp worker and the admin Simulator chat so both pipelines
// apply the same place branding (palette + style notes) from the `brands` table.

export function normalizeHe(s: string): string {
  return s.replace(/["'׳״.\-]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Levenshtein edit distance (iterative, two-row).
function editDistance(a: string, b: string): number {
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

// Find an active brand whose name/alias appears in the given text —
// exact substring first, then fuzzy (per-word edit distance) for typos.
export function matchBrandInText(
  brands: BrandRow[],
  text: string
): { id: string; name: string } | null {
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
    if (inboundText.includes(c.needle)) return { id: c.id, name: c.name };
  }

  // pass 2: fuzzy — every word of the needle must fuzzy-hit some inbound word
  for (const c of candidates) {
    const needleWords = c.needle.split(' ').filter((w) => w.length >= 2);
    if (!needleWords.length) continue;
    if (needleWords.every((w) => fuzzyWordHit(w, inboundWords))) {
      return { id: c.id, name: c.name };
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

// Build a Hebrew brand-guidelines block from a brand kit, fed into generation prompts.
export function buildBrandContext(brand: BrandKit | null): string | null {
  if (!brand || brand.is_active === false) return null;

  const colors = (brand.color_palette ?? [])
    .map((c) => `${c.role}: ${c.hex}`)
    .join(', ');

  const lines = [`## מיתוג מחייב — ${brand.name}`];
  if (colors) {
    lines.push(`פלטת הצבעים הרשמית של המותג (כולל ערכי HEX מדויקים): ${colors}.`);
    lines.push(
      'חשוב מאוד: זוהי פלטת הצבעים המחייבת והבלעדית לבריף. בשדה "פלטת צבעים" השתמש אך ורק בצבעים ובערכי ה-HEX האלה. ' +
        'אל תמציא צבעים נוספים, אל תשתמש בצבעי הדוגמה שמופיעים ב-System Message (כגון #064A7A, #D72638, #FDBB2D), ' +
        'והתעלם מכל דרישה למספר מינימלי של צבעים אם היא סותרת את פלטת המותג. מספר הצבעים בבריף יהיה בדיוק כמספר צבעי המותג.'
    );
  }
  if (brand.style_notes) lines.push(`הנחיות סגנון מחייבות של המותג: ${brand.style_notes}`);
  lines.push('שמור על עקביות מלאה עם זהות המותג, הצבעים, הטון והסגנון. הנחיות המותג גוברות על כל דוגמה גנרית ב-System Message.');
  return lines.join('\n');
}
