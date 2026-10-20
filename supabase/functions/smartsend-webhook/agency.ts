// PrimeOS agency: one agent per job, supervisors above them.
// Every agent is a prompt module with one responsibility; a supervisor (reviewer) sees only the brief and the result,
// never the producer's reasoning, and returns a score, concrete issues and a corrected result when it can.
// The producers live in generate / image / video.ts; this file holds the registry and the review prompts so the
// chain is visible in one place.
import { DOC_RULES_HE, DECK_RULES_HE, VIDEO_RULES_HE, QA_PASS } from './design.ts';

export interface Agent { id: string; he: string; does: string; level: 'producer' | 'reviewer' | 'supervisor'; where: string }
export const AGENTS: Agent[] = [
  { id: 'brand-rules', he: 'חוקי מותג', does: 'מלוגו ורשימת צבעים מפיק תפקידי צבע (בסיס, משני, הדגשה, רקע) לכל תוצר', level: 'producer', where: 'palette.ts paletteRoles / printRoles / videoColors' },
  { id: 'style-picker', he: 'בוחר סגנון', does: 'מהבריף, המחלקה והמטרה בוחר אחד מעשרת סגנונות הגרפיקה ומצב פלטה', level: 'producer', where: 'generate: graphic / series / event (STYLE_PICK_HE)' },
  { id: 'copywriter', he: 'קופירייטר', does: 'כותב את הטקסטים: כותרת, שורת משנה, פרטים, קריאה לפעולה, טקסט פוסט, האשטגים. רק עובדות מהבריף', level: 'producer', where: 'generate: graphic / post / series / event' },
  { id: 'hebrew-proof', he: 'עורך לשון', does: 'מתקן דקדוק, כתיב, התאמה ופיסוק בלי לשנות תוכן', level: 'reviewer', where: 'generate: proof()' },
  { id: 'graphic-director', he: 'אמן הגרפיקה', does: 'מתרגם סגנון, תפקידי צבע, חוקים מספריים וטקסטים להנחיית עיצוב אחת למודל התמונה', level: 'producer', where: 'image: DESIGNER + designDirective' },
  { id: 'image-proof', he: 'מגיה תמונות', does: 'קורא את העברית שנכתבה בתמונה ומשווה לטקסטים שנדרשו; מסמן שורות שגויות עם מיקום לתיקון ממוסך', level: 'reviewer', where: 'image: proofImage' },
  { id: 'graphic-reviewer', he: 'בודק גרפיקה', does: 'ציון 0-100 לפי הרובריקה, בעיות בעברית, הנחיה לניסיון נוסף, עצירה על עובדה מומצאת או קטין', level: 'supervisor', where: 'image: qaReview (QA_SYS)' },
  { id: 'doc-architect', he: 'אדריכל מסמכים', does: 'בוחר סוג מסמך וכותב אותו לפי המבנה הקבוע של הסוג', level: 'producer', where: 'generate: doc2 (DOC_RULES_HE)' },
  { id: 'deck-architect', he: 'אדריכל מצגות', does: 'בונה את סיפור המצגת: מסר אחד לשקף, סוג פריסה, תרשים רק ממספרים שנמסרו', level: 'producer', where: 'generate: deck2 (DECK_RULES_HE)' },
  { id: 'video-director', he: 'במאי וידאו', does: 'בריף הפקה מלא: סצנות, מקורות חזותיים, טקסט על המסך, קריינות, מוזיקה, מעברים', level: 'producer', where: 'generate: vbrief (DIRECTOR_SYS + VIDEO_RULES_HE)' },
  { id: 'content-reviewer', he: 'בודק תוכן', does: 'עובר על מסמך, מצגת או בריף וידאו מול הבריף והחוקים: עובדות, מבנה, אורכים, עברית. מחזיר ציון, בעיות וגרסה מתוקנת', level: 'supervisor', where: 'generate: reviewContent()' },
  { id: 'render-qc', he: 'בקר רינדור', does: 'אחרי הרינדור: קובץ קיים, אורך, רזולוציה, פריימים ריקים', level: 'reviewer', where: 'api/video.ts status (בבנייה)' },
];

export const REVIEW_SYS = `אתה בקר איכות עצמאי של סוכנות תוכן לרשויות מקומיות. לא ראית איך התוצר נוצר. אתה מקבל בריף ותוצר, ובודק אותם בקפדנות:
1. עובדות: כל תאריך, שעה, מקום, מספר, שם ומחיר בתוצר חייב להופיע בבריף או ב"פרטים ידועים". שם הארגון והמחלקה הם הקשר ידוע ומותרים תמיד. מה שלא מופיע - שגיאה חמורה (stop).
2. מבנה וחוקים: לפי החוקים שמצורפים.
3. עברית: תקנית, לשון רבים, מקף רגיל, בלי סלנג, בלי מילים שבלי ניקוד נקראות לא נכון.
4. בהירות: מסר אחד ברור, בלי חזרות.
אתה מחזיר JSON בלבד.`;

export function reviewPrompt(kind: 'doc' | 'deck' | 'video', brief: string, result: unknown) {
  const rules = kind === 'doc' ? DOC_RULES_HE : kind === 'deck' ? DECK_RULES_HE : VIDEO_RULES_HE;
  const extra = kind === 'video' ? '\nבווידאו בדוק גם: say לכל היותר dur*2.2 מילים; שורות עד 5 מילים ועד 2 שורות; text.pos לא bottom/lower כשיש כתוביות; לפחות מחצית הסצנות עם ai/stock/stockv/upload/mockup; items קיימים כשהסגנון steps/check/calendar/pin/compare.' : '';
  return `הבריף:
${brief}

החוקים:
${rules}${extra}

התוצר (JSON):
${JSON.stringify(result).slice(0, 24000)}

החזר JSON בלבד:
{"score":0-100,"issues":["בעיה קצרה, החשובות קודם, עד 6"],"stop":false,"stopWhy":"","fixed":<התוצר המלא באותו מבנה בדיוק עם התיקונים, או null אם אין מה לתקן>}
score ${QA_PASS} ומעלה = תקין. stop=true רק על עובדה שלא בבריף או מידע מטעה. ב-fixed תקן רק מה שצריך, בלי לקצר ובלי לשנות מפתחות.`;
}
