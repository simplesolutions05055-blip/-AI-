// PrimeOS design rules - one source for every output (graphics, documents, decks, videos).
// Derived from the PrimeOS design rulebook (12 principles, 1080 type sizes, 60/30/10 colour, 10 styles, QA score)
// and the document/deck and video specifications. Copied into each edge function by `npm run sync:design`.
import { paletteRoles, contrast } from './palette.ts';

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

/* ---------------- Hebrew fonts the image model knows (never Frank Ruhl Libre) ---------------- */
export const FONTS = ['Heebo', 'Assistant', 'Rubik', 'Secular One', 'Alef', 'Karantina', 'Suez One', 'Miriam Libre'];
export const FONT_HE: Record<string, string> = { Heebo: 'Heebo (נקי, רשמי)', Assistant: 'Assistant (קל, קריא)', Rubik: 'Rubik (עגול, ידידותי)', 'Secular One': 'Secular One (כותרות בולטות)', Alef: 'Alef (הומני, דוקומנטרי)', Karantina: 'Karantina (צר, פוסטרי)', 'Suez One': 'Suez One (כבד, יוקרתי)', 'Miriam Libre': 'Miriam Libre (קלאסי)' };
// heading / body pairing per style; a brand may pin one font for everything
export const STYLE_FONTS: Record<string, [string, string]> = {
  documentary: ['Alef', 'Heebo'], official: ['Heebo', 'Heebo'], comic: ['Karantina', 'Rubik'], satire: ['Karantina', 'Heebo'], marketing: ['Secular One', 'Assistant'],
  info: ['Assistant', 'Assistant'], representative: ['Suez One', 'Assistant'], light: ['Rubik', 'Assistant'], service: ['Heebo', 'Heebo'], editorial: ['Suez One', 'Heebo'],
};
export const fontOf = (f: unknown): string => (typeof f === 'string' && FONTS.includes(f) ? f : '');
export function fontsFor(style: string, brandFont?: unknown): [string, string] {
  const f = fontOf(brandFont);
  if (f) return [f, f];
  return STYLE_FONTS[styleOf(style)] ?? ['Heebo', 'Heebo'];
}
export function typographyEn(style: string, brandFont?: unknown) {
  const [h, b] = fontsFor(style, brandFont);
  return `TYPOGRAPHY - headline in the Hebrew typeface "${h}" (heavy weight), all other text in "${b}" (regular / medium). Name these typefaces in the prompt. No other typeface.`;
}
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
export function designDirective(o: { style?: string; palette?: string; colors?: unknown[]; roles?: Record<string, string>; fmt?: 'square' | 'portrait' | 'landscape'; photos?: number; logo?: boolean; font?: unknown }) {
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
${typographyEn(styleOf(o.style), o.font)}
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
export function qaPrompt(o: { brief: string; texts: string[]; style: string; colors?: unknown[]; roles?: Record<string, string>; kit?: boolean; note?: string }) {
  const r = paletteRoles((o.colors ?? []) as string[], o.roles ?? {});
  const st = STYLES[styleOf(o.style)];
  return `Brief (Hebrew): ${o.brief}
Intended style: ${styleOf(o.style)} - ${st.en}
Texts that must appear exactly: ${o.texts.map((t) => `"${t}"`).join(' ; ')}
Brand roles: base ${r.base}, secondary ${r.secondary}, accent ${r.accent}, light ${r.light}.
Rules: ${graphicRulesEn('square')}
${o.kit ? KIT_QA_EN + '\n' : ''}${o.note ? `CHANGE REQUEST from the user (Hebrew): "${o.note}". The graphic must visibly apply this request. If it was not applied, score at most 40 and say so first in "redo" and in "issues".\n` : ''}
Score each part (max in brackets): ${QA_PARTS.map(([k, he, max]) => `${k} (${max}) ${he}`).join(', ')}.
Return JSON: {"score":0-100,"parts":{"mobile":0,"hierarchy":0,"composition":0,"imagery":0,"brand":0,"access":0,"originality":0},"issues":["short Hebrew sentence per problem, most important first, max 5"],"redo":"English art-direction note for a second attempt, max 60 words, empty if score >= ${QA_PASS}","stop":false,"stopWhy":""${o.kit ? ',"skeleton":{"logo":true,"tag":true,"headline":true,"sub":true,"motif":true,"details":true,"cta":true,"photo":true}' : ''}}
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

/* ---------------- video effects library (what the director may use to make a message concrete) ---------------- */
export const VIDEO_FX_LIB: { id: string; he: string; use: string }[] = [
  { id: 'steps', he: 'שלבים ממוספרים', use: 'תהליך של 2-5 שלבים (איך נרשמים, איך מדווחים)' },
  { id: 'check', he: 'רשימת וי', use: 'דרישות, מה להביא, יתרונות' },
  { id: 'calendar', he: 'כרטיס תאריך', use: 'מועד אירוע, תחילת הרשמה, תאריך יעד' },
  { id: 'pin', he: 'סיכת מיקום', use: 'מקום האירוע, כתובת, נקודת שירות' },
  { id: 'compare', he: 'לפני / אחרי', use: 'שיפור, שינוי בשירות, שדרוג' },
  { id: 'stat', he: 'מספר שרץ', use: 'נתון מרכזי אחד' },
  { id: 'mockup:phone', he: 'מוקאפ טלפון', use: 'אפליקציה עירונית, אתר, שירות דיגיטלי (הלוגו על המסך)' },
  { id: 'studio', he: 'רקע סטודיו', use: 'כל סצנת טקסט, רשימה או נתון: לבן פנינה חלק, טקסט כהה' },
  { id: 'confetti', he: 'קונפטי', use: 'חגיגה, זכייה, פתיחה' },
  { id: 'rays', he: 'קרני אור', use: 'הכרזה, רגע שיא' },
  { id: 'spotlight', he: 'זרקור', use: 'מיקוד בפרט אחד' },
  { id: 'sparkle', he: 'נצנוץ', use: 'הישג, פרימיום, תודה' },
];

/* ---------------- video ---------------- */
export const VIDEO_RULES_HE = `חוקי הפקה מחייבים:
- זהה סגנון לפי המטרה (אירוע, הודעת שירות, הסבר, סיכום, ברכה) וקבע קצב ואנרגיה בהתאם. חירום ושיבושים: שקט, ברור, בלי אפקטים.
- מסר אחד לסצנה. טקסט על המסך עד 2 שורות, עד 5 מילים בשורה, בתוך אזור בטוח (לא ב-10% העליונים והתחתונים ב-9x16). כתוביות עד 2 שורות, מתחת לאמצע.
- היררכיה: כותרת גדולה אחת לסצנה, שורת משנה קטנה אחת לכל היותר. בלי שני סגנונות טקסט באותה סצנה.
- עומס: עד 3 אלמנטים נעים במקביל. מעבר אחד בין סצנות, אותו סוג מעבר לאורך הסרטון למעט רגע שיא אחד. אפקטים גלובליים עד 2.
- צבע: רקעים בצבע הבסיס או הבהיר של המותג, הדגשה בצבע האקסנט בלבד. בלי גרדיאנט ניאון.
- תמונות וסרטונים נשארים בהירים וחדים: tint עד 0.2, בלי שכבת צבע על כל הפריים. סצנת טקסט בלבד על רקע studio (לבן פנינה), לא על גרדיאנט כהה.
- המחשה: תאריך ב-calendar, מקום ב-pin, תהליך ב-steps, דרישות ב-check, שינוי ב-compare, אפליקציה ב-mockup:phone. מספרים ב-stat.
- רק עובדות מהבריף. בלי תאריך, שעה, מקום או מספר שלא נמסרו.`;

/* ---------------- brand kit: the organisation's graphic language, derived once from its logo ---------------- */
// Learned from 24 municipal graphics (6 cities): every post follows one fixed skeleton; what changes per organisation is
// derived from the logo alone - colours, the motif shape, where the logo sits, one of three composition templates,
// the icon style and the headline treatment. The kit is derived by a vision model when the logo is uploaded and saved
// on the organisation; the designer only fills the skeleton.
export interface BrandKit {
  motif: { shape: string; en: string; he: string };
  logoPos: 'top-center' | 'top-right' | 'top-left';
  template: 'panel' | 'fullbleed' | 'bands';
  icons: 'line-circle' | 'solid-circle' | 'solid';
  headline: 'colored' | 'bands';
  hot: string;        // the warm/vivid logo colour for the keyword and the button
  colorsEn: string;   // short EN description of the logo colours
  summary: string;    // one Hebrew sentence for the user
  at?: string;
}
export const KIT_TEMPLATES: Record<BrandKit['template'], { he: string; en: string }> = {
  panel: { he: 'פאנל בהיר + תמונה בצד', en: 'LIGHT PANEL + SIDE PHOTO: a white or near-white panel takes 50-60% of the width on the text side and holds the whole skeleton; the photo fills the other side full height and meets the panel with a soft organic curve or a soft diagonal fade (never a hard straight line). Motif shapes in two corners of the panel.' },
  fullbleed: { he: 'תמונה מלאה, טקסט על שמיים', en: 'FULL-BLEED PHOTO: the photograph fills the whole canvas and is lit so its upper 45-55% is a bright, quiet area (sky, bright wall, haze) where the skeleton sits; the person or subject is in the lower part on one side. A soft white glow may sit behind the text block. Motif shapes cut two opposite corners.' },
  bands: { he: 'כותרת על פסי צבע מוטים', en: 'SKEWED COLOUR BANDS: a light panel on the text side with a soft diagonal edge toward the photo; each headline line is white text on its own filled band in a logo colour (one band per line, bands skewed 3-6 degrees, stacked tight), the key line on the hot colour. Motif shapes scattered small along the edges.' },
};
export const KIT_ICONS: Record<BrandKit['icons'], string> = {
  'line-circle': 'thin line icons in the base colour inside pale circles, a tiny motif shape tucked beside each icon',
  'solid-circle': 'white solid icons inside filled circles, each circle a different logo colour',
  solid: 'solid icons in the base colour, no circles',
};
export const KIT_SCAN_HE = 'מזהה את השפה הגרפית מהלוגו';
export const KIT_SCAN = `You analyse a municipality's logo to derive its social-media graphic language. Answer with JSON only:
{"motif":{"shape":"leaf|arrow|sail|ray|bubble|ring|wave|star|tower|other","en":"the motif as a reusable decorative element in 6-12 English words (e.g. 'thick quarter-ring arcs in the logo colours', 'small rounded leaves')","he":"2-4 מילים בעברית"},
"logoPos":"top-center|top-right|top-left","template":"panel|fullbleed|bands","icons":"line-circle|solid-circle|solid","headline":"colored|bands","hot":"#hex of the warmest / most vivid logo colour (magenta, red, orange, yellow, lime); if none, the most saturated one","colorsEn":"the logo colours in 8-15 English words with hex values","summary":"משפט אחד בעברית: המוטיב, התבנית וצבע ההדגשה"}
Rules: template 'bands' only for a bold multi-colour logo with sharp or angular shapes; 'fullbleed' for a logo with light, airy or sea/sun shapes; otherwise 'panel'. headline 'bands' only with template 'bands'. icons 'solid-circle' when the logo has 3+ vivid colours, 'line-circle' for a calm 1-2 colour logo, 'solid' for a dark single-colour emblem. logoPos 'top-center' unless the logo is a wide horizontal lockup (then 'top-right').`;

export const SKELETON_EN = `FIXED SKELETON (every element, in this order, top to bottom on the text side; nothing else):
1. LOGO: the attached logo, large (10-14% of the canvas height), unchanged, at the logo position given. No other emblem, crest or invented logo anywhere.
2. TAG: a small filled pill with a tiny icon (megaphone / info) and the tag text, white text on a logo colour.
3. HEADLINE: 1-3 lines in the headline typeface given (heavy weight), 110-160px on 1080, tight leading. Headline treatment as given. The key word(s) in the hot colour.
4. SUB LINE: one line, 36-44px, regular weight, dark base colour.
5. MOTIF RULE: a short decorative rule or arc under the headline block, drawn from the motif in the logo colours.
6. DETAILS: date / time / place as pills or rows with a calendar / clock / pin icon, 28-34px; and, when icon items are given, a row of 3-4 icons with 2-4 word labels in the icon style given (a white bar with thin dividers is fine).
7. CALL TO ACTION: one rounded, fully filled button in the hot colour, white text 34-40px, with an arrow in a small white circle.
8. PHOTO: one photoreal photograph (40-100% of the canvas by the template), golden-hour or full sun, an Israeli street / square / park / mall, one or two people in focus with a mood that fits the message. The organisation's branding is embedded in the scene: a vest, helmet, sign, bin, flag or chalkboard in the logo colours (no readable text on them). When the message has a clear object (heat: thermometer; garbage: clock or bin; power: lightning; registration: phone; roadworks: cone), one large illustrated object of it sits beside the headline.
MOTIF: the logo's own shape repeated as large decorative elements cutting two corners and as 2-3 small 'sparks' near the headline, in the logo colours, semi-transparent where over the photo. Only the logo colours (+ red for emergencies). No other hue, no gradients on text, no stock shapes unrelated to the logo.
EMERGENCY VARIANT (service notices, hazards, outages): identical skeleton; the tag, key word and button turn red (#E0202A), a warning triangle or siren icon joins the tag, and the button may become a white bar "emergency phone" row. Photo of crews at work, calm, no damage or injuries.
UNIFORMITY: a festival and an outage from the same organisation must look like two posts of one series - same logo position, same template, same motif, same icon style, same button.`;

export function kitDirective(kit: BrandKit, o: { colors?: unknown[]; roles?: Record<string, string>; emergency?: boolean; fmt?: 'square' | 'portrait' | 'landscape'; photos?: number; style?: string; palette?: string; font?: unknown }) {
  const r = paletteRoles((o.colors ?? []) as string[], o.roles ?? {});
  const tpl = KIT_TEMPLATES[kit.template] ?? KIT_TEMPLATES.panel;
  const hot = /^#[0-9a-f]{6}$/i.test(kit.hot || '') ? kit.hot : r.accent;
  const hotText = contrast(hot, '#FFFFFF') >= 3 ? '#FFFFFF' : r.base;
  const hotOnLight = contrast(hot, r.light) >= 3;
  return `BRAND KIT (derived from this organisation's logo - follow exactly):
LOGO COLOURS - ${kit.colorsEn}. Base (type, dark elements): ${r.base}. Hot colour (key word, button, tag): ${hot}; text ON the hot colour is ${hotText}. ${hotOnLight ? '' : `The hot colour is too light for text on the light ground: the key word gets a filled hot band behind ${r.base} text instead of hot-coloured letters. `}Light ground: ${r.light}.
MOTIF - ${kit.motif?.en ?? 'soft rounded shapes'} (shape: ${kit.motif?.shape ?? 'other'}).
LOGO POSITION - ${kit.logoPos ?? 'top-center'} of the text side.
TEMPLATE - ${tpl.en}
HEADLINE - ${kit.headline === 'bands' ? 'white text on skewed filled bands, one band per line, the key line on the hot colour' : 'coloured text on the light ground: base colour, with the key word(s) in the hot colour (2-3 logo colours by line at most)'}.
ICONS - ${KIT_ICONS[kit.icons] ?? KIT_ICONS['line-circle']}.
${o.emergency ? 'THIS IS AN EMERGENCY / SERVICE NOTICE: apply the emergency variant.' : 'Regular post: warm, optimistic, premium-app feel.'}
${o.photos ? `Use the ${o.photos} attached photo(s) as the photo of the skeleton, embedding the branding treatment only if natural.` : 'No photo attached: create the photo as described in the skeleton.'}
${o.style && !o.emergency ? `ART DIRECTION of the style "${styleOf(o.style)}" - ${STYLES[styleOf(o.style)].en}\nPALETTE MODE - ${PALETTE_MODES[(o.palette && PALETTE_MODES[o.palette as PaletteMode] ? o.palette : STYLES[styleOf(o.style)].palette) as PaletteMode].en}\nWithin the brand kit, follow this art direction for mood, imagery and typography.` : ''}
${typographyEn(o.style ?? 'official', o.font)}
${SKELETON_EN}
${graphicRulesEn(o.fmt ?? 'square')}`;
}
export const KIT_QA_EN = `SKELETON CHECK: this organisation uses a fixed skeleton. Report in "skeleton" which parts are present: logo (the real logo, not an invented crest), tag pill, headline with a hot-colour key word, sub line, motif rule/shapes from the logo, details or icon row, filled CTA button with arrow, photo with embedded branding. Each missing part is an issue and costs 6-10 points; an invented crest or logo instead of the real one is a stop.`;

/* ---------------- event posters: the same skeleton, festival energy ---------------- */
export const EVENT_EN = `EVENT POSTER MODE: this graphic sells an event, so it must feel big and festive: the event name is the hero, set as large as the canvas allows (140-180px on 1080), with the stage tag (coming soon / two days to go / today) as a bold pill above it. Date, time and place in three clear pills with icons. One hero photo full of people, lights and movement (festival, concert, crowd, fireworks, stage) at golden hour or night with warm lights; confetti, light rays or bokeh sparkles in the logo colours are welcome as motif sparks. If an event logo is attached, it sits large above or beside the headline; the organisation's logo stays smaller in its usual place. Keep the fixed skeleton, the brand colours and the Hebrew texts exactly; the energy comes from scale, light and the photo, not from extra words.`;

