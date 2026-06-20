/**
 * Brand import/export as CSV — a flat, spreadsheet-friendly format the admin can
 * download, edit in Excel/Google Sheets, and re-upload to add or update brands.
 *
 * Binary assets (logo, gallery images) can't live in a CSV, so they are left out:
 * the CSV round-trips only the editable text fields. Re-importing never touches
 * a brand's existing logo/assets.
 *
 * Multi-value fields are encoded with semicolons:
 *   - aliases:  "ק. שמונה; קריית שמונה"
 *   - colors:   each role gets its own column (color_primary … color_text)
 *
 * Text content sources (the "אזור תוכן" brain) live in their own table and are
 * encoded as repeating column pairs: source_1_title, source_1_content,
 * source_2_title, source_2_content, … You can add as many pairs as you like in
 * the spreadsheet — the importer reads every source_N_* pair it finds.
 */
import type { Brand, BrandColor, BrandColorRole } from '@/types/db';

const COLOR_ROLES: BrandColorRole[] = ['primary', 'secondary', 'accent', 'background', 'text'];

export interface BrandTextSource {
  title: string;
  content: string;
}

/** A brand plus its attached text sources, ready to serialize to CSV. */
export type BrandExport = Brand & { sources?: BrandTextSource[] };

/** Row shape parsed from / written to CSV. */
export interface BrandCsvRow {
  name: string;
  aliases: string[];
  is_active: boolean;
  style_notes: string;
  color_palette: BrandColor[];
  sources: BrandTextSource[];
}

const BASE_HEADERS = [
  'name',
  'aliases',
  'is_active',
  'style_notes',
  ...COLOR_ROLES.map((r) => `color_${r}`),
];

function sourceHeaders(count: number): string[] {
  const out: string[] = [];
  for (let i = 1; i <= count; i++) out.push(`source_${i}_title`, `source_${i}_content`);
  return out;
}

// ── CSV primitives (RFC-4180-ish: quote fields with comma/quote/newline) ───────
function escapeCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function toCsv(rows: string[][]): string {
  // Prepend a UTF-8 BOM so Excel opens Hebrew correctly.
  return '﻿' + rows.map((r) => r.map(escapeCell).join(',')).join('\r\n') + '\r\n';
}

/** Parse CSV text into a matrix of cells, honoring quotes and escaped quotes. */
function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  // flush trailing cell/row if file doesn't end with a newline
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// ── export ─────────────────────────────────────────────────────────────────
function brandToCells(b: BrandExport, sourceCount: number): string[] {
  const colorByRole = new Map<BrandColorRole, string>();
  for (const c of b.color_palette ?? []) {
    if (!colorByRole.has(c.role)) colorByRole.set(c.role, c.hex);
  }
  const sources = b.sources ?? [];
  const sourceCells: string[] = [];
  for (let i = 0; i < sourceCount; i++) {
    sourceCells.push(sources[i]?.title ?? '', sources[i]?.content ?? '');
  }
  return [
    b.name ?? '',
    (b.aliases ?? []).join('; '),
    b.is_active === false ? 'no' : 'yes',
    b.style_notes ?? '',
    ...COLOR_ROLES.map((r) => colorByRole.get(r) ?? ''),
    ...sourceCells,
  ];
}

export function brandsToCsv(brands: BrandExport[]): string {
  const sourceCount = brands.reduce((m, b) => Math.max(m, b.sources?.length ?? 0), 0);
  const headers = [...BASE_HEADERS, ...sourceHeaders(sourceCount)];
  return toCsv([headers, ...brands.map((b) => brandToCells(b, sourceCount))]);
}

export function brandToCsv(b: BrandExport): string {
  return brandsToCsv([b]);
}

/** A ready-to-fill example CSV with the header and a couple of sample rows. */
export function brandCsvTemplate(): string {
  const headers = [...BASE_HEADERS, ...sourceHeaders(2)];
  return toCsv([
    headers,
    [
      'עיריית קריית שמונה', 'ק. שמונה; קריית שמונה', 'yes', 'טון רשמי אך חמים, פנייה לתושבים',
      '#1A4D9C', '#F2A900', '#E11D48', '#FFFFFF', '#111827',
      'שירותי העירייה', 'גביית ארנונה, אגף החינוך, מוקד 106, רישוי עסקים ותחבורה ציבורית.',
      'מסרים מרכזיים', 'עיר גדלה ומתפתחת בצפון, קהילה חמה ושירות מהיר לתושב.',
    ],
    [
      'מתנ"ס לדוגמה', 'מתנס; מרכז קהילתי', 'yes', 'טון ידידותי וקליל',
      '#0F766E', '#F59E0B', '', '#FFFFFF', '#1F2937',
      'חוגים ופעילויות', 'חוגי ספורט, אומנות ומחול לכל הגילאים, קייטנות בחופשות.',
      '', '',
    ],
  ]);
}

// ── import ─────────────────────────────────────────────────────────────────
function parseBool(v: string): boolean {
  const s = v.trim().toLowerCase();
  return !['no', 'false', '0', 'כבוי', 'לא', 'off'].includes(s);
}

function normHex(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  const hex = s.startsWith('#') ? s : `#${s}`;
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toUpperCase() : null;
}

export interface BrandCsvParseResult {
  rows: BrandCsvRow[];
  errors: string[];
  /** True when the CSV declares any source_N_* columns, so import should sync sources. */
  hasSourceColumns: boolean;
}

/** Parse an uploaded CSV into brand rows, tolerating reordered/extra columns. */
export function parseBrandCsv(text: string): BrandCsvParseResult {
  const matrix = parseCsv(text);
  const errors: string[] = [];
  if (matrix.length < 2) {
    return { rows: [], errors: ['הקובץ ריק או חסרה בו שורת כותרת.'], hasSourceColumns: false };
  }
  const header = matrix[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  if (idx('name') === -1) {
    return { rows: [], errors: ['חסרה עמודת "name" בכותרת הקובץ.'], hasSourceColumns: false };
  }
  // Discover every source_N index present in the header (any order, any count).
  const sourceNums = new Set<number>();
  for (const h of header) {
    const m = h.match(/^source_(\d+)_(title|content)$/);
    if (m) sourceNums.add(Number(m[1]));
  }
  const sortedSourceNums = [...sourceNums].sort((a, b) => a - b);
  const rows: BrandCsvRow[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const cells = matrix[r];
    const at = (name: string) => {
      const i = idx(name);
      return i === -1 ? '' : (cells[i] ?? '');
    };
    const name = at('name').trim();
    if (!name) {
      errors.push(`שורה ${r + 1}: חסר שם מקום — דולגה.`);
      continue;
    }
    const aliases = at('aliases')
      .split(/[;,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const palette: BrandColor[] = [];
    for (const role of COLOR_ROLES) {
      const hex = normHex(at(`color_${role}`));
      if (hex) palette.push({ hex, role });
      else if (at(`color_${role}`).trim()) {
        errors.push(`שורה ${r + 1}: צבע לא תקין בעמודה color_${role} — דולג.`);
      }
    }
    const sources: BrandTextSource[] = [];
    for (const n of sortedSourceNums) {
      const title = at(`source_${n}_title`).trim();
      const content = at(`source_${n}_content`).trim();
      if (!content) continue; // an empty content cell means "no source here"
      sources.push({ title: title || 'מקור תוכן', content });
    }
    rows.push({
      name,
      aliases,
      is_active: parseBool(at('is_active') || 'yes'),
      style_notes: at('style_notes').trim(),
      color_palette: palette,
      sources,
    });
  }
  return { rows, errors, hasSourceColumns: sortedSourceNums.length > 0 };
}

/** Trigger a browser download of CSV text. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Safe filename slug for a brand name (keeps Hebrew, strips path-hostile chars). */
export function slugForFilename(name: string): string {
  return (name || 'brand').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 60) || 'brand';
}
