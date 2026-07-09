const MAX_TITLE_LENGTH = 80;
const MAX_SUBJECT_LENGTH = 96;

const TITLE_KEYS = [
  'title',
  'deliverable_title',
  'output_title',
  'topic',
  'event_name',
  'campaign_name',
  'product_name',
  'offer_title',
  'name',
  'goal',
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

export function deliverableReadyHeading(title: string, outputType?: string | null): string {
  const cleanTitle = limitOneLineTitle(title, MAX_TITLE_LENGTH) || 'התוצר שלך';
  switch (outputType) {
    case 'presentation':
      return `המצגת ${cleanTitle} מוכנה`;
    case 'image':
      return `התמונה ${cleanTitle} מוכנה`;
    case 'pdf':
      return `המסמך ${cleanTitle} מוכן`;
    case 'text':
      return `התוכן ${cleanTitle} מוכן`;
    default:
      return `${cleanTitle} - התוצר מוכן`;
  }
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
    if (typeof value === 'string') {
      const title = titleCandidate(value, key === 'goal');
      if (title) return title;
    }
  }
  return '';
}

function titleCandidate(value: string, isGoal: boolean): string {
  const clean = oneLine(value);
  if (!clean) return '';
  if (isGoal && looksLikeLongBrief(value, clean)) {
    const heading = headingFromMarkdown(value);
    return heading ? stripIdeaLeadIn(heading) : '';
  }
  return stripIdeaLeadIn(clean);
}

// The holidays calendar seeds a production with a prompt like
// "צרו רעיון לתוכן עבור האירוע/החג: חג הסיגד. תאריך: ...". The deliverable is
// the event itself, not the "create an idea" instruction — so when that lead-in
// survives into the goal, title the deck after the event (or date) name only.
function stripIdeaLeadIn(value: string): string {
  const match = value.match(
    /^\s*צ(?:רו|ור)\s+רעיון\s+לתוכן\s+עבור\s+(?:האירוע\s*\/\s*החג|התאריך)\s*:?\s*(.+)$/,
  );
  if (!match) return value;
  const name = match[1].split(/[.\n]/)[0].trim();
  return name || value;
}

function looksLikeLongBrief(raw: string, clean: string): boolean {
  return raw.includes('\n') || /[#*_`\[]/.test(raw) || clean.length > MAX_TITLE_LENGTH * 1.5;
}

function headingFromMarkdown(value: string): string {
  const firstHeading = value
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .find((line) => line && !/^(\*\*)?(מתי|איפה|מארגנת|קהל|תאריך|שעה)(\*\*)?:/.test(line));
  return firstHeading ? oneLine(firstHeading) : '';
}

function oneLine(value: unknown): string {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/^\s*#+\s*/g, '')
    .replace(/\[[^\]]*\]:\s*\S+.*$/g, '')
    .replace(/\[[^\]]+\]\([^)]+\)/g, '')
    .replace(/[“”"']/g, '')
    .replace(/[*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
