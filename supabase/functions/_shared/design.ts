// PrimeOS design rules - one source for every output (graphics, documents, decks, videos).
// Derived from the PrimeOS design rulebook (12 principles, 1080 type sizes, 60/30/10 colour, 10 styles, QA score)
// and the document/deck and video specifications. Copied into each edge function by `npm run sync:design`.
import { paletteRoles } from './palette.ts';

/* ---------------- graphic styles ---------------- */
export interface Style { he: string; when: string; photo: 'must' | 'good' | 'none'; palette: PaletteMode; energy: 'low' | 'mid' | 'high'; en: string }
export type PaletteMode = 'darkTech' | 'lightCivic' | 'boldCreative' | 'warmDoc';
export const STYLES: Record<string, Style> = {
  documentary: { he: 'דוקומנטרי', when: 'סיכום אירוע, התנדבות, עבודות בשטח, תמונות אמיתיות שצורפו', photo: 'must', palette: 'warmDoc', energy: 'low',
    en: 'DOCUMENTARY: one real, candid photograph fills 70-85% of the canvas, minimal processing, natural colour. The headline is restrained, set on a quiet area of the photo or on a narrow solid band at the bottom; the other lines small and quiet in one or two rows. No illustrations, no icons, no tags, no brush strokes, no decorative lines. The photo is the hero; typography steps back.' },
  official: { he: 'רשמי וחד', when: 'הודעת רשות, שינוי בשירות, עדכון דוברות, דבר ראש הרשות', photo: 'none', palette: 'lightCivic', energy: 'low',
    en: 'OFFICIAL: flat, uniform background (light or deep brand base), strong headline as the single focal point, precise detail rows with thin line icons, generous margins, one accent band or rule. No photo unless provided. Institutional, calm, exact.' },
  comic: { he: 'קומי', when: 'פסולת, חניה, קמפיין התנהגות קליל', photo: 'must', palette: 'boldCreative', energy: 'high',
    en: 'COMIC: one person with an amusing, relatable expression in an everyday urban situation, big playful typography (one heavy weight), bold flat colour background block. Humour comes from the situation, never from mocking residents.' },
  satire: { he: 'סאטירי', when: 'רק בבקשה מפורשת: הגזמה חכמה של התנהגות עירונית', photo: 'good', palette: 'boldCreative', energy: 'high',
    en: 'SATIRE: one sharp exaggerated idea that illustrates a civic behaviour, poster-like composition, strong contrast, editorial wit. No humiliation of residents, no misleading information.' },
  marketing: { he: 'שיווקי', when: 'פסטיבל, הופעה, חוגים, נוער, הרשמה', photo: 'good', palette: 'boldCreative', energy: 'high',
    en: 'MARKETING: vivid, energetic, one clear focal subject, a sense of occasion. Bold display headline, a date/place strip, dynamic diagonal or layered shapes used sparingly behind the subject. Strong colour where it carries the message, white or light ground elsewhere.' },
  info: { he: 'אינפורמטיבי', when: 'נתון מרכזי, שלבים, מיחזור, הסבר שירות', photo: 'none', palette: 'lightCivic', energy: 'mid',
    en: 'INFORMATIVE: one dominant number or up to three numbered steps, simple line icons, a clean grid, lots of air. No charts unless the data is given. Typography carries the content; shapes only to group.' },
  representative: { he: 'ייצוגי', when: 'חנוכת מבנה, בעל תפקיד, צילום אדריכלי, פעילות ציבורית', photo: 'must', palette: 'lightCivic', energy: 'low',
    en: 'REPRESENTATIVE: one architectural or professional portrait photograph, little text, restrained typography, a slim brand rule and the emblem. Dignified, premium, quiet.' },
  light: { he: 'קל וזורם', when: 'משפחות, חינוך, תרבות, איכות חיים, קהילה', photo: 'good', palette: 'lightCivic', energy: 'mid',
    en: 'LIGHT & AIRY: bright background, a natural scene or person, soft rounded shapes, lots of negative space, friendly medium-weight headline. Pastel tints of the brand, never heavy blocks.' },
  service: { he: 'הודעת שירות ובטיחות', when: 'חסימת כביש, הפסקת מים, שינוי דחוף, חירום', photo: 'none', palette: 'lightCivic', energy: 'mid',
    en: 'SERVICE NOTICE: maximum hierarchy, zero decoration. A clear header strip, the headline very large, the essential details (when, where, until when) in large rows, one alert accent (an amber or the brand accent) used once. No smiling people, no illustration, no gradients. Everything readable on a phone at a glance.' },
  editorial: { he: 'Editorial Premium', when: 'הישג עירוני, פרויקט דגל, סיכום שנה', photo: 'must', palette: 'darkTech', energy: 'low',
    en: 'EDITORIAL PREMIUM: magazine composition, one excellent photograph, a large elegant headline with tight leading, a small kicker and a thin rule, very few elements. Deep base colour or clean white, one accent. Feels like a cover.' },
};
export const STYLE_IDS = Object.keys(STYLES);
export const styleOf = (id: unknown): string => (typeof id === 'string' && STYLES[id] ? id : 'official');

export const PALETTE_MODES: Record<PaletteMode, { he: string; en: string }> = {
  darkTech: { he: 'כהה', en: 'Deep base colour as the ground (60%), the secondary as panels/typography (30%), the accent only for one or two highlights (10%).' },
  lightCivic: { he: 'בהיר רשמי', en: 'White or the light tint as the ground (60%), the base colour for headline, rules and bands (30%), the accent for one highlight or icon colour (10%).' },
  boldCreative: { he: 'צבעוני', en: 'One vivid colour block or the accent as the ground of one area (up to 40%), white/light elsewhere, the base for typography; a second accent hue allowed once. Still one message, no rainbow.' },
  warmDoc: { he: 'דוקומנטרי חם', en: 'The photograph\'s natural colours are the ground; the brand appears only in a narrow band, the emblem and the headline colour (10-15% of the canvas).' },
};

/* ---------------- numeric rules for the image model ---------------- */
export function graphicRulesEn(fmt: 'square' | 'portrait' | 'landscape' = 'square') {
  const canvas = fmt === 'portrait' ? '1080x1350 or 1080x1920 portrait' : fmt === 'landscape' ? '1920x1080 landscape' : '1080x1080 square';
  return `CANVAS ${canvas}. SAFE MARGIN 72-90px from every edge: no text or logo closer to the edge.
TYPE SCALE (on a 1080px canvas): headline 76-112px, sub-headline 48-64px, essential details 38-54px, small secondary text 32-40px minimum. One type family (two at most), 2-3 weights. Hebrew is right-to-left, right-aligned; keep numbers, times and dates readable inside Hebrew lines.
ONE MESSAGE: one headline, one focal element (a photo, a number or the headline itself), at most two supporting elements. Clear reading order: headline, then details, then call to action.
CONTRAST: body-size text at least 4.5:1 against its background, large text 3:1. Never place text over a busy or bright photo area without a solid or darkened panel behind it. No glow or thin drop shadow as a rescue.
COLOUR: 60/30/10 - one ground colour, one supporting colour, one accent for highlights. Brand colours are an identity accent, never a wash over everything. No neon glows, no gradient on every element.
NO DECORATION: no dashboards, floating screens, charts, arrows, halos, badges or stickers unless they carry the message. Negative space is part of the design.
MOBILE FIRST: the piece must read at phone size. If small text would not read on a phone, make it larger or drop it.`;
}

/* ---------------- the design directive for one graphic ---------------- */
export function designDirective(o: { style?: string; palette?: string; colors?: unknown[]; roles?: Record<string, string>; fmt?: 'square' | 'portrait' | 'landscape'; photos?: number; logo?: boolean }) {
  const st = STYLES[styleOf(o.style)];
  const mode = (o.palette && PALETTE_MODES[o.palette as PaletteMode] ? o.palette : st.palette) as PaletteMode;
  const r = paletteRoles((o.colors ?? []) as string[], o.roles ?? {});
  const photos = o.photos ?? 0;
  const photoLine = st.photo === 'must' && !photos ? 'This style needs one photograph: create one realistic, candid Israeli scene that fits the message (no text in it).'
    : st.photo === 'none' && !photos ? 'No photograph: typography and flat shapes only.'
    : photos ? `Use the ${photos} attached photo(s) as the imagery, prominently and respectfully.` : 'A photograph is optional; use one only if it strengthens the message.';
  return `STYLE - ${st.en}
PALETTE MODE - ${PALETTE_MODES[mode].en}
BRAND ROLES - base (type, bands, deep ground): ${r.base}; secondary: ${r.secondary}; accent (one highlight only): ${r.accent}; light ground: ${r.light}.${r.accentOnLight ? '' : ' The accent is too light for type on a light ground: use it for a shape, a band or an icon, never for body text.'}
IMAGERY - ${photoLine}
${graphicRulesEn(o.fmt ?? 'square')}`;
}

/* ---------------- style picking (Hebrew, for the text model) ---------------- */
export const STYLE_PICK_HE = `בחר סגנון עיצוב אחד מהרשימה, לפי הנושא, המחלקה והמטרה:
${STYLE_IDS.map((id) => `${id} - ${STYLES[id].he}: ${STYLES[id].when}`).join('\n')}
satire רק אם המשתמש ביקש סאטירה במפורש. comic רק לנושא קליל באמת. חירום ושיבושי שירות תמיד service.
ב-documentary, representative ו-editorial הטקסט מינימלי: sub קצרה, details עד פריט אחד, cta עד 3 מילים או ריק.
palette: darkTech | lightCivic | boldCreative | warmDoc (ברירת המחדל של הסגנון מתאימה ברוב המקרים).`;

/* ---------------- QA review (independent reviewer) ---------------- */
export const QA_PARTS = [['mobile', 'קריאות הטקסט בנייד', 25], ['hierarchy', 'היררכיה חזותית והבנת המסר', 20], ['composition', 'קומפוזיציה, מרווחים ואיזון', 15], ['imagery', 'איכות צילום, דמויות ורקעים', 10], ['brand', 'שפה מותגית ועקביות', 10], ['access', 'נגישות וניגודיות', 10], ['originality', 'מקוריות והתאמת הסגנון', 10]] as const;
export const QA_PASS = 80;
export const QA_REDO = 70;
export const QA_SYS = `You are an independent senior design reviewer for official municipal social-media graphics in Hebrew. You have not seen how this graphic was made. Judge only what is in the image against the brief and the rules. Be concrete and short. Answer with JSON only.
Calibration: 85-100 = publish as is; 80-84 = publish, minor notes; 70-79 = acceptable, a resident would not notice a problem; below 70 only for a real problem a resident would notice: unreadable or wrong text, a missing required line, clutter that hides the message, off-brand colours, a dated or unprofessional look. A band that is a bit large, a margin a little under 72px, or one extra icon are notes, not failures. The ten rubric parts must add up to the score.`;
export function qaPrompt(o: { brief: string; texts: string[]; style: string; colors?: unknown[]; roles?: Record<string, string> }) {
  const r = paletteRoles((o.colors ?? []) as string[], o.roles ?? {});
  const st = STYLES[styleOf(o.style)];
  return `Brief (Hebrew): ${o.brief}
Intended style: ${styleOf(o.style)} - ${st.en}
Texts that must appear exactly: ${o.texts.map((t) => `"${t}"`).join(' ; ')}
Brand roles: base ${r.base}, secondary ${r.secondary}, accent ${r.accent}, light ${r.light}.
Rules: ${graphicRulesEn('square')}

Score each part (max in brackets): ${QA_PARTS.map(([k, he, max]) => `${k} (${max}) ${he}`).join(', ')}.
Return JSON: {"score":0-100,"parts":{"mobile":0,"hierarchy":0,"composition":0,"imagery":0,"brand":0,"access":0,"originality":0},"issues":["short Hebrew sentence per problem, most important first, max 5"],"redo":"English art-direction note for a second attempt, max 60 words, empty if score >= ${QA_PASS}","stop":false,"stopWhy":""}
stop=true (regardless of score) when: a fact appears that is not in the brief or texts (date, time, place, number), a minor is the identifiable main subject in a sensitive topic, text is unreadable, or a public symbol/flag with emblem is used. Then stopWhy is one Hebrew sentence.`;
}

/* ---------------- documents ---------------- */
export const DOC_TYPES: Record<string, { he: string; when: string; parts: string[] }> = {
  letter: { he: 'מכתב לתושבים', when: 'פנייה אישית לתושבי אזור, הודעה על עבודות, הזמנה', parts: ['פתיחה ונמען', 'מה קורה ולמה', 'מה זה אומר לתושב', 'מועדים', 'למי פונים', 'חתימה'] },
  notice: { he: 'הודעה רשמית', when: 'הודעת דוברות, החלטה, שינוי בשירות', parts: ['הודעה בשני משפטים', 'פרטים', 'תוקף ומועדים', 'הפניה למידע נוסף'] },
  procedure: { he: 'נוהל', when: 'תהליך עבודה, הנחיות, כללי שימוש', parts: ['מטרה', 'תחולה', 'הגדרות', 'שלבי הנוהל ממוספרים', 'אחריות', 'נספחים/טפסים'] },
  report: { he: 'דוח נתונים', when: 'סיכום תקופה, מדדים, תוצאות', parts: ['תקציר מנהלים', 'מדדים מרכזיים', 'ניתוח לפי נושא', 'מסקנות', 'המלצות', 'מקורות הנתונים'] },
  plan: { he: 'תוכנית / הצעה', when: 'תוכנית עבודה, הצעה לפרויקט, בקשת תקציב', parts: ['רקע וצורך', 'מטרות', 'מה מציעים', 'לוח זמנים', 'תקציב ומשאבים אם נמסרו', 'מדדי הצלחה'] },
  guide: { he: 'חוברת מידע', when: 'מדריך לתושב, שאלות ותשובות, מידע על שירות', parts: ['למי זה מיועד', 'איך זה עובד בשלבים', 'שאלות נפוצות', 'פרטי קשר'] },
};
export const DOC_RULES_HE = `חוקי מסמך:
- סוג מסמך אחד (dtype) מהרשימה, והמבנה שלו קובע את הסעיפים. כותרות סמנטיות, לא קישוט.
- פסקה עד 4 שורות. משפט אחד או שניים לרעיון. טבלה רק לנתונים אמיתיים שנמסרו. גרף רק למספרים שנמסרו.
- רק מה שבבריף ובקבצים: בלי תאריכים, שעות, כתובות, סכומים או שמות מומצאים. כשחסר פרט חיוני, כותבים "[להשלים: ...]".
- עברית תקנית, פנייה בלשון רבים, בלי סלנג. מונחים רשמיים כפי שהארגון כותב אותם.
סוגי מסמך:
${Object.entries(DOC_TYPES).map(([k, v]) => `${k} - ${v.he}: ${v.when}. סעיפים: ${v.parts.join(' / ')}`).join('\n')}`;

/* ---------------- presentations ---------------- */
export const DECK_STYLES: Record<string, { he: string; when: string; en: string }> = {
  exec: { he: 'הנהלה', when: 'ישיבת הנהלה, מועצה, דיון החלטה', en: 'calm, dense with meaning, one number or one decision per slide' },
  project: { he: 'פרויקט', when: 'הצגת פרויקט, סטטוס, תוכנית עבודה', en: 'timeline-led, clear phases, photos of the site' },
  campaign: { he: 'קמפיין', when: 'השקת קמפיין, אירוע, תוכנית שיווק', en: 'bold, visual, large headlines, one image per slide' },
  training: { he: 'הדרכה', when: 'הדרכת עובדים, הסבר נוהל, סדנה', en: 'step by step, one concept per slide, simple diagrams' },
};
export const DECK_RULES_HE = `חוקי מצגת:
- קודם הסיפור: לכל שקף מסר אחד (msg), והשקפים בונים רצף: למה, מה, איך, מה הלאה. הכותרת של השקף היא המסר, לא נושא כללי.
- עד 6 שורות טקסט בשקף, עד 4 נקודות, נקודה עד 10 מילים. תרשים אחד לשקף. מספר רק עם מקור בבריף.
- שקף שער, שקף סיום עם הצעד הבא. בין לבין לפחות שקף אחד חזותי (תמונה גדולה או מספר אחד גדול).
- סגנונות (dstyle): ${Object.entries(DECK_STYLES).map(([k, v]) => `${k} - ${v.he}: ${v.when}`).join(' | ')}.`;

/* ---------------- video ---------------- */
export const VIDEO_RULES_HE = `חוקי הפקה מחייבים:
- זהה סגנון לפי המטרה (אירוע, הודעת שירות, הסבר, סיכום, ברכה) וקבע קצב ואנרגיה בהתאם. חירום ושיבושים: שקט, ברור, בלי אפקטים.
- מסר אחד לסצנה. טקסט על המסך עד 2 שורות, עד 5 מילים בשורה, בתוך אזור בטוח (לא ב-10% העליונים והתחתונים ב-9x16). כתוביות עד 2 שורות, מתחת לאמצע.
- היררכיה: כותרת גדולה אחת לסצנה, שורת משנה קטנה אחת לכל היותר. בלי שני סגנונות טקסט באותה סצנה.
- עומס: עד 3 אלמנטים נעים במקביל. מעבר אחד בין סצנות, אותו סוג מעבר לאורך הסרטון למעט רגע שיא אחד. אפקטים גלובליים עד 2.
- צבע: רקעים בצבע הבסיס או הבהיר של המותג, הדגשה בצבע האקסנט בלבד. בלי גרדיאנט ניאון.
- תמונה מתחת לטקסט תמיד עם tint 0.35-0.6. מספרים ותאריכים ב-typewriter או stamp, לא ב-headline.
- רק עובדות מהבריף. בלי תאריך, שעה, מקום או מספר שלא נמסרו.`;
