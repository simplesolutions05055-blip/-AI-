const MAX_TITLE_LENGTH = 80;
const MAX_SUBJECT_LENGTH = 96;

const TITLE_KEYS = [
  'title',
  'output_title',
  'deliverable_title',
  'topic',
  'goal',
  'event_name',
  'campaign_name',
  'product_name',
  'offer_title',
  'name',
];

const TYPE_LABELS: Record<string, string> = {
  text: 'תוכן',
  image: 'תמונה',
  pdf: 'מסמך',
  presentation: 'מצגת',
};

const READY_LABELS: Record<string, string> = {
  text: 'התוכן מוכן',
  image: 'התמונה מוכנה',
  pdf: 'המסמך מוכן',
  presentation: 'המצגת מוכנה',
};

export function deliverableTitle(
  brief: Record<string, unknown> | null | undefined,
  outputType?: string | null,
  fallback = 'התוצר שלך',
): string {
  const fromBrief = firstBriefTitle(brief);
  const base = fromBrief || (outputType ? TYPE_LABELS[outputType] : null) || fallback;
  return limitOneLineTitle(base, MAX_TITLE_LENGTH) || fallback;
}

export function deliverableSubject(title: string, outputType?: string | null): string {
  const cleanTitle = limitOneLineTitle(title, MAX_TITLE_LENGTH) || 'התוצר שלך';
  const suffix = (outputType ? READY_LABELS[outputType] : null) || 'התוצר מוכן';
  return limitOneLineTitle(`${cleanTitle} - ${suffix}`, MAX_SUBJECT_LENGTH);
}

export function limitOneLineTitle(value: unknown, max = MAX_TITLE_LENGTH): string {
  const clean = oneLine(value);
  if (!clean) return '';
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1).trimEnd();
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 24 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function firstBriefTitle(brief: Record<string, unknown> | null | undefined): string {
  if (!brief || typeof brief !== 'object') return '';
  for (const key of TITLE_KEYS) {
    const value = brief[key];
    if (typeof value === 'string' && oneLine(value)) return value;
  }
  return '';
}

function oneLine(value: unknown): string {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[“”"']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
