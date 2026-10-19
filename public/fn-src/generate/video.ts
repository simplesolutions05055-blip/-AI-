// Video director and media production for the Remotion engine (video/src).
// vcaps: which providers have keys. vbrief: Claude analyses the request and returns a brief + a scene plan.
// vvoice: Hebrew narration per scene (ElevenLabs or Google Chirp 3 HD) with word timings for captions.
// vmusic: instrumental track at the exact length (ElevenLabs Music). vstock: Pixabay / Pexels photos and clips.
// Provider keys live only in Supabase secrets; raw provider responses never go back to the browser.

export const env = (k: string) => Deno.env.get(k) ?? '';
export function caps() {
  return { eleven: !!env('ELEVENLABS_API_KEY'), google: !!env('GOOGLE_TTS_API_KEY'), pexels: !!(env('PIXABAY_API_KEY') || env('PEXELS_API_KEY')), higgs: !!env('HIGGSFIELD_API_KEY') };
}

// Hebrew voices. The audition page narrows these to the 2-4 per gender the owner approves (admin_state 'voices').
export interface Voice { id: string; n: string; g: 'm' | 'f'; tone: string; eng: 'eleven' | 'google' }
const G = (v: string, n: string, g: 'm' | 'f', tone: string): Voice => ({ id: 'g:he-IL-Chirp3-HD-' + v, n, g, tone, eng: 'google' });
const E = (v: string, n: string, g: 'm' | 'f', tone: string): Voice => ({ id: 'e:' + v, n, g, tone, eng: 'eleven' });
export const VOICES: Voice[] = [
  G('Charon', 'אורי', 'm', 'עמוק ורציני, מתאים להודעות רשמיות'),
  G('Fenrir', 'גיא', 'm', 'אנרגטי וצעיר, מתאים לאירועים'),
  G('Orus', 'דני', 'm', 'חם ובוטח, מתאים לשירות לתושב'),
  G('Puck', 'עומר', 'm', 'קליל וידידותי'),
  G('Kore', 'נועה', 'f', 'בהיר וברור, מתאים למידע'),
  G('Aoede', 'מאיה', 'f', 'חם ורגשי, מתאים לסיפורים'),
  G('Leda', 'שירה', 'f', 'צעיר ושמח, מתאים לאירועים'),
  G('Zephyr', 'טל', 'f', 'רגוע ומקצועי'),
  E('pNInz6obpgDQGcFmaJgB', 'אדם', 'm', 'עמוק, קריינות פרסומית'),
  E('nPczCjzI2devNBz1zQrb', 'בן', 'm', 'רגוע וסמכותי'),
  E('TX3LPaxmHKxFdv7VOQHJ', 'ליאם', 'm', 'צעיר ונמרץ'),
  E('JBFqnCBsd6RMkjVDRZzb', 'יוסי', 'm', 'מספר סיפורים, חם'),
  E('21m00Tcm4TlvDq8ikWAM', 'רחל', 'f', 'רגוע וברור'),
  E('XrExE9yKIg1WjnnlVkGX', 'מיכל', 'f', 'חם וידידותי'),
  E('pFZP5JQG7iQjIQuC4Bku', 'לילי', 'f', 'עדין ורגשי'),
  E('Xb7hH8MSUJpSbSDYk0k2', 'אליס', 'f', 'בטוח ומקצועי'),
];
export function voicesFor(c = caps(), approved?: string[]) {
  const ok = VOICES.filter((v) => (v.eng === 'eleven' ? c.eleven : c.google));
  return approved?.length ? ok.filter((v) => approved.includes(v.id)) : ok;
}

// ---- video kinds: each one sets the voice delivery, music, pace and visual grammar ----
// tags: ElevenLabs audio tags the director may put in front of a narration line (v3/v4 read them as direction, not words)
// stab: voice stability (low = more expressive and varied, high = steady and even)
export const KINDS: Record<string, { he: string; brief: string; voice: string; tags: string[]; stab: number; music: string; edit: string; avoid: string }> = {
  official: { he: 'רשמי', brief: 'הודעה רשמית, עדכון או הנחיה לתושבים', voice: 'סמכותי, רגוע וברור, קצב מדוד, בלי התלהבות', tags: ['calm', 'confident', 'serious', 'clearly'], stab: 0.7,
    music: 'עדינה וברקע, פסנתר או אמביינט מקצועי, בלי מקצב בולט', edit: 'מעברים נקיים (fade, push, slide), סגנונות headline / lowerThird / list / typewriter / stat, כתוביות clean, אפקטים מינימליים', avoid: 'neon, pop, flash, whip, particles, שפה שיווקית' },
  marketing: { he: 'שיווקי', brief: 'מניע לפעולה: הרשמה, רכישה, השתתפות', voice: 'אנרגטי, משכנע ובטוח, מדגיש את התועלת ואת הקריאה לפעולה', tags: ['excited', 'confident', 'inviting', 'energetic'], stab: 0.4,
    music: 'קצבית ומודרנית, בונה אנרגיה לקראת הקריאה לפעולה', edit: 'חיתוכים מהירים, flash / whip / zoom / slide, סגנונות pop / box / stamp / split, כתוביות pop', avoid: 'קצב איטי, טקסט ארוך' },
  event: { he: 'אירוע', brief: 'הזמנה לאירוע, פסטיבל או מופע', voice: 'חגיגי, שמח ומזמין, כמו הזמנה אישית', tags: ['excited', 'cheerful', 'warmly', 'inviting'], stab: 0.35,
    music: 'שמחה וחגיגית, מתאימה לאופי האירוע, שיא בסיום', edit: 'קצב ער, whip / zoom / slide / flash, stamp לתאריך, typewriter למקום ושעה, particles / shapes', avoid: 'אווירה כבדה' },
  showcase: { he: 'ראווה', brief: 'מציג עשייה, הישגים ואווירה', voice: 'גאה, מעורר השראה וחם', tags: ['proud', 'warmly', 'confident', 'inspired'], stab: 0.5,
    music: 'מעוררת השראה, בנייה הדרגתית, מיתרים או אלקטרוני רך', edit: 'תנועות מצלמה רחבות, fade / push / iris, stat להישגים, cinematic לרגעי שיא, lightLeak', avoid: 'עומס טקסט' },
  greeting: { he: 'ברכה וחג', brief: 'ברכה לחג, למועד או לציון דרך', voice: 'חם, אישי ולבבי, חיוך בקול', tags: ['warmly', 'softly', 'cheerful', 'gently'], stab: 0.45,
    music: 'חמה ומשפחתית, בהשראת אופי החג', edit: 'רך וזורם, fade / iris / push, quote / cinematic / headline, bokeh / lightLeak', avoid: 'מכירה, פרטים טכניים' },
  memorial: { he: 'ממלכתי וזיכרון', brief: 'יום זיכרון, טקס או הודעת אבל', voice: 'שקט, מכובד ואיטי, עם הפסקות, בלי שום התלהבות', tags: ['solemnly', 'softly', 'slowly', 'quietly'], stab: 0.8,
    music: 'פסנתר או מיתרים שקטים מאוד, או בלי מוזיקה', edit: 'איטי, fade בלבד, סצנות ארוכות, cinematic / quote / headline, צבעים מאופקים, letterbox / grain עדין', avoid: 'pop, neon, stamp, flash, whip, zoom, particles, shapes, צבעים צעקניים, סימני קריאה' },
};
export const kindOf = (g: unknown) => KINDS[String(g)] ? String(g) : 'marketing';
const ALL_TAGS = [...new Set(Object.values(KINDS).flatMap((k) => k.tags))];
// keeps only known direction tags, at most 2 per line; anything else in brackets is dropped so it is never spoken
export function cleanSay(t: string) {
  let n = 0;
  return String(t ?? '').replace(/\[([^\]]{0,30})\]/g, (_, x) => { const k = String(x).trim().toLowerCase(); return ALL_TAGS.includes(k) && n++ < 2 ? `[${k}]` : ''; }).replace(/\s{2,}/g, ' ').trim();
}
const untag = (t: string) => String(t ?? '').replace(/\[[^\]]*\]/g, ' ').replace(/\s{2,}/g, ' ').trim();

export const TEXT_STYLES = ['headline', 'pop', 'box', 'typewriter', 'stamp', 'lowerThird', 'stat', 'quote', 'list', 'cinematic', 'outline', 'split', 'neon'];
const FONTS = ['Heebo', 'Rubik', 'Assistant', 'Secular One', 'Suez One', 'Karantina', 'Varela Round', 'Amatic SC', 'Bellefair', 'IBM Plex Sans Hebrew'];

// ---- the director: deep read of the request -> brief for approval + full scene plan ----
export function directorPrompt(p: Record<string, any>, c: ReturnType<typeof caps>, voices: Voice[]) {
  const dur = Math.max(10, Math.min(90, Math.round(+p.duration || 30)));
  const K = KINDS[kindOf(p.goal)];
  const uploads = ((p.media ?? []) as any[]).map((m, i) => `upload:${i} = ${m.v ? 'קטע וידאו' : 'תמונה'} "${m.name ?? ''}"`).join('\n');
  const src: string[] = [];
  if (p.style === 'existing') src.push('"clip:<שנייה בסרטון המקורי>" - קטע מהסרטון שהמשתמש העלה, מתחיל בשנייה שתבחר (סרטון המקור באורך ' + (p.clipSec || 'לא ידוע') + ' שניות)');
  if ((p.media ?? []).length) src.push('"upload:<מספר>" - חומר שהמשתמש העלה (התמונות מצורפות כדי שתראה אותן)');
  if (p.style !== 'anim' && p.style !== 'existing') src.push('"ai:<English image prompt>" - תמונה שתיווצר ב-AI. תאר צילום ריאליסטי בישראל, בלי טקסט בתמונה');
  if (c.pexels && p.style !== 'anim') src.push('"stock:<English search query>" - צילום סטוק אמיתי (מילות חיפוש קצרות באנגלית, 2-4 מילים)', '"stockv:<English search query>" - קטע וידאו סטוק אמיתי (מילות חיפוש קצרות באנגלית)');
  src.push('"gradient" - רקע מונפש בצבעי המותג (מתאים לטקסט גדול, נתונים, רשימות)', '"color" - רקע צבע אחיד כהה');
  const vlist = voices.map((v) => `${v.id} | ${v.n} | ${v.g === 'm' ? 'גבר' : 'אישה'} | ${v.tone}`).join('\n');
  const user = `בקשת הסרטון:
שם: ${p.title || ''}
תיאור: ${p.desc || ''}
סוג הסרטון: ${K.he} - ${K.brief}
קהל יעד: ${p.aud || 'כלל התושבים'}
פורמט: ${p.format || '9x16'}
אורך מבוקש: ${dur} שניות (כולל כרטיס סיום של כ-3 שניות)
סגנון שנבחר: ${{ anim: 'אנימציה גרפית ממותגת (מושן גרפיקס)', existing: 'עריכה של סרטון קיים', ai: 'סרטון מתמונות (חומרי גלם או AI)', auto: 'לבחירתך' }[p.style as string] ?? 'לבחירתך'}
קריינות: ${p.voice === false ? 'לא' : 'כן'}${p.voice !== false && p.voiceId && p.voiceId !== 'auto' ? ' - הקול שנבחר: ' + p.voiceId : ''}
מוזיקת רקע: ${p.music === false ? 'לא' : 'כן'}
${uploads ? 'חומרים שהועלו:\n' + uploads : ''}
${p.change ? '\nזו גרסה מתוקנת של בריף קודם. הבריף הקודם:\n' + JSON.stringify(p.prev ?? {}).slice(0, 6000) + '\nבקשת השינוי של המשתמש: ' + p.change + '\nשמור על כל מה שלא התבקש לשנות.' : ''}

מקורות חזותיים מותרים לסצנה (visual.src):
${src.map((s) => '- ' + s).join('\n')}

סגנונות טקסט על המסך (text.style), כל אחד לתפקיד אחר:
headline - כותרת גדולה, מילים עולות אחת אחרי השנייה | pop - מילים קופצות, מילת מפתח בצבע | box - שורות על פסי צבע | typewriter - מכונת כתיבה, לפרטים (תאריך, שעה, מקום) | stamp - חותמת שנוחתת, לתאריך או הכרזה קצרה | lowerThird - פס שם ותפקיד בתחתית, לדובר/ת | stat - מספר שרץ (value + unit + lines כתווית) | quote - ציטוט עם שם | list - רשימה ממוספרת 2-4 פריטים | cinematic - קולנועי עם פסים שחורים, לרגעים רגשיים | outline - מתאר שמתמלא | split - שורות שנחשפות ממסכה | neon - זוהר, לערב ומסיבות
מיקום text.pos: top | center | bottom | lower. highlight: מילים לצביעה.
מעברים (transition.kind): cut, fade, slide, wipe, push, iris, clockWipe, flip, flash, zoom, whip. dir: left|right|up|down. dur בשניות (0.3-0.8).
אפקטים (fx): grain, vignette, lightLeak, particles, bokeh, shapes, letterbox, scanlines.
תנועת מצלמה (visual.motion): zoomIn, zoomOut, panLeft, panRight, panUp, panDown, drift, static. tint 0-0.7 להכהיה מתחת לטקסט.
גופנים (font.head / font.body): ${FONTS.join(', ')}.
${p.voice !== false ? `קולות זמינים (id | שם | מין | אופי):\n${vlist || '(אין ספק קריינות מחובר - כתוב את הקריינות בכל זאת)'}` : ''}

החזר JSON בלבד במבנה:
{"brief":{"idea":"הקונספט במשפט אחד","style":"שם הסגנון בשתיים-שלוש מילים","look":"השפה החזותית: צבעים, טיפוגרפיה, תנועה ואפקטים - 1-2 משפטים","pace":"קצב העריכה ולמה","music":"איזו מוזיקה ולמה, בעברית","voiceWhy":"למה הקול שנבחר מתאים","delivery":"איך הקריינות נשמעת: טון, רגש וקצב, במשפט אחד"},
"mood":"energetic|emotional|informative|festive|solemn|calm|luxury",
"voice":"id של קול מהרשימה או ריק",
"musicPrompt":"English prompt for an instrumental track: genre, instruments, tempo BPM, energy curve, no vocals",
"font":{"head":"","body":""},
"fx":["אפקטים גלובליים, 0-2"],
"captions":"karaoke|pop|clean|none",
"scenes":[{"dur":3.2,"say":"מה הקריין אומר בסצנה","visual":{"src":"...","motion":"zoomIn","tint":0.4},"text":{"style":"headline","lines":["שורה"],"kicker":"","sub":"","highlight":[],"pos":"bottom"},"transition":{"kind":"fade","dur":0.4},"fx":[]}],
"outro":{"cta":"קריאה לפעולה קצרה","details":[{"text":"פרט קצר"}]},
"caption":"טקסט הפוסט שילווה את הסרטון, 2-3 משפטים","tags":["#האשטג"]}

כללים:
- סכום dur של הסצנות + 3 שניות סיום = ${dur} בערך. סצנה 1.5-6 שניות. ${Math.max(3, Math.round(dur / 4))}-${Math.max(4, Math.round(dur / 2.6))} סצנות.
- כל סצנה שונה מקודמתה בסגנון הטקסט או במעבר. סגנון אחד לא יותר מפעמיים ברצף. בחר סגנונות שמתאימים לתוכן ולא את כולם.
- המעברים לפי האופי: אנרגטי - flash, whip, zoom, slide; רגשי/רשמי - fade, iris, push איטי. עקביות בתוך הסרטון.
- טקסט על המסך קצר: עד 6 מילים בשורה, עד 3 שורות. אסור לשכפל את הקריינות למסך.
- קריאות בלי ניקוד: הטקסט על המסך והקריינות (שמוצגת גם ככתוביות) נקראים בלי ניקוד, לכן רק מילים שאי אפשר לקרוא אחרת. להימנע ממילים שבלי ניקוד נראות כמו מילה אחרת, בעיקר סביל עתידי (תוסט נקרא כמו טוסט, יוסר, תוקם). לנסח אחרת: "הסטת תנועה לרחוב ויצמן", "התנועה תופנה", "הכביש ייסגר". לפני שמחזירים, לעבור על כל שורה ולשאול: האם תושב יכול לקרוא אותה לא נכון?
- הסרטון מסוג "${K.he}". הכל נגזר מזה:
  קריינות: ${K.voice}.
  מוזיקה: ${K.music}.
  עריכה: ${K.edit}.
  להימנע: ${K.avoid}.
${p.voice !== false ? `- רגש בקריינות: אפשר לפתוח שורת say בתג כיוון אחד באנגלית בסוגריים מרובעים, רק מהרשימה: ${K.tags.map((t) => '[' + t + ']').join(' ')}. התג משנה את הטון ולא נקרא בקול. בחר תג לפי הרגש של כל סצנה, ושנה בין סצנות כשהרגש משתנה. בלי תגים אחרים.
` : ''}${p.voice !== false ? '- say: עברית מדוברת וטבעית, לכל היותר dur*2.2 מילים לסצנה. הוסף ניקוד רק למילים שהקריין עלול לקרוא לא נכון (למשל: ספר/סֵפֶר, עיר שמות). מספרים ותאריכים במילים. אפשר say ריק בסצנה שקטה.' : '- say ריק בכל הסצנות.'}
- סצנה ראשונה תופסת תשומת לב בשנייה הראשונה.
- רק פרטים שמופיעים בבקשה או בקבצים. אסור להמציא תאריכים, מקומות, מספרים או שמות.
- מקף רגיל בלבד. ראשי תיבות וקיצורים עם גרשיים עבריים (״) ולא עם מירכאות רגילות, למשל: בע״מ, צה״ל.
- JSON תקין בלבד: בלי מירכאות רגילות בתוך ערכי טקסט.`;
  return user;
}

export const DIRECTOR_SYS = `אתה במאי ועורך וידאו בכיר שמתמחה בסרטונים קצרים לרשתות החברתיות עבור רשויות מקומיות וארגונים בישראל.
לפני כל סרטון אתה מנתח לעומק: מה המטרה, מי הקהל, מה הרגש שצריך לעורר ומה הפעולה שהצופה צריך לעשות. לפי זה אתה בוחר סגנון, קצב, מוזיקה, קול, טיפוגרפיה, מעברים ואפקטים, ומתכנן כל סצנה.
התוצר שלך הוא תוכנית הפקה מדויקת שמנוע רינדור מבצע אחד לאחד.`;

// ---- director plan -> engine plan (src references resolved later by the client) ----
const strip = (s: string) => s.replace(/[\u0591-\u05C7]/g, '');
export function sanitizeBrief(j: any, p: Record<string, any>, voices: Voice[]) {
  const scenes = (Array.isArray(j.scenes) ? j.scenes : []).slice(0, 30).map((s: any) => ({
    dur: Math.max(1.2, Math.min(8, +s.dur || 3)),
    say: p.voice === false ? '' : cleanSay(String(s.say ?? '').slice(0, 300)),
    visual: { src: String(s.visual?.src ?? 'gradient').slice(0, 400), motion: s.visual?.motion, tint: s.visual?.tint },
    text: s.text && Array.isArray(s.text.lines) ? { ...s.text, style: TEXT_STYLES.includes(s.text.style) ? s.text.style : 'headline' } : undefined,
    transition: s.transition,
    fx: Array.isArray(s.fx) ? s.fx.slice(0, 3) : [],
  }));
  if (!scenes.length) throw new Error('invalid_ai_response');
  const voice = voices.find((v) => v.id === (p.voiceId && p.voiceId !== 'auto' ? p.voiceId : j.voice)) ?? voices[0];
  return {
    brief: j.brief ?? {},
    mood: j.mood,
    voice: p.voice === false ? null : voice ? { id: voice.id, n: voice.n, g: voice.g, tone: voice.tone } : null,
    kind: kindOf(p.goal),
    stab: KINDS[kindOf(p.goal)].stab,
    musicPrompt: p.music === false ? '' : String(j.musicPrompt ?? '').slice(0, 600),
    font: { head: FONTS.includes(j.font?.head) ? j.font.head : 'Heebo', body: FONTS.includes(j.font?.body) ? j.font.body : 'Assistant' },
    fx: Array.isArray(j.fx) ? j.fx.slice(0, 2) : [],
    captions: ['karaoke', 'pop', 'clean', 'none'].includes(j.captions) ? j.captions : 'karaoke',
    scenes,
    outro: { cta: String(j.outro?.cta ?? '').slice(0, 60), details: (Array.isArray(j.outro?.details) ? j.outro.details : []).slice(0, 3) },
    caption: String(j.caption ?? ''),
    tags: Array.isArray(j.tags) ? j.tags.slice(0, 6) : [],
  };
}

// ---- storage ----
async function store(d: any, org: string, bytes: Uint8Array, ext: string, type: string) {
  const path = `vid/${org || 'admin'}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const r = await d.storage.from('v2-content').upload(path, bytes, { contentType: type, upsert: true });
  if (r.error) throw new Error('storage_failed');
  return d.storage.from('v2-content').getPublicUrl(path).data.publicUrl as string;
}
const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
// runs fn over items with at most n in flight (provider concurrency limits, edge memory)
async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let at = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (at < items.length) { const i = at++; out[i] = await fn(items[i], i); } }));
  return out;
}

// MP3 length from frame headers (CBR or VBR), no decoder needed
export function mp3Seconds(b: Uint8Array) {
  let i = 0, sec = 0;
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) i = 10 + ((b[6] & 0x7f) << 21 | (b[7] & 0x7f) << 14 | (b[8] & 0x7f) << 7 | (b[9] & 0x7f));
  const BR1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], BR2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] } as Record<number, number[]>;
  while (i + 4 < b.length) {
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) { i++; continue; }
    const ver = (b[i + 1] >> 3) & 3, layer = (b[i + 1] >> 1) & 3, bri = b[i + 2] >> 4, sri = (b[i + 2] >> 2) & 3, pad = (b[i + 2] >> 1) & 1;
    if (ver === 1 || layer !== 1 || bri === 0 || bri === 15 || sri === 3) { i++; continue; }
    const sr = SR[ver][sri], br = (ver === 3 ? BR1 : BR2)[bri] * 1000, spf = ver === 3 ? 1152 : 576;
    const len = Math.floor((spf / 8) * br / sr) + pad;
    if (len < 4) { i++; continue; }
    sec += spf / sr; i += len;
  }
  return sec;
}

// words spread over the clip by length when the provider gives no timings
function spread(text: string, start: number, end: number) {
  const ws = strip(untag(text)).split(/\s+/).filter(Boolean);
  const tot = ws.reduce((a, w) => a + w.length + 1, 0) || 1;
  let t = start;
  return ws.map((w) => { const d = ((w.length + 1) / tot) * (end - start); const o = { w, s: +t.toFixed(2), e: +(t + d).toFixed(2) }; t += d; return o; });
}
// ElevenLabs character alignment -> words
function fromChars(text: string, a: any) {
  const ch: string[] = a?.characters ?? [], st: number[] = a?.character_start_times_seconds ?? [], en: number[] = a?.character_end_times_seconds ?? [];
  const out: { w: string; s: number; e: number }[] = [];
  let cur = '', s0 = 0, e0 = 0, inTag = false;
  ch.forEach((c, i) => {
    // direction tags are not spoken: never shown as caption words
    if (c === '[') { inTag = true; return; }
    if (inTag) { if (c === ']') inTag = false; return; }
    if (/\s/.test(c)) { if (cur) out.push({ w: strip(cur), s: s0, e: e0 }); cur = ''; return; }
    if (!cur) s0 = st[i] ?? e0;
    cur += c; e0 = en[i] ?? s0;
  });
  if (cur) out.push({ w: strip(cur), s: s0, e: e0 });
  return out.filter((w) => w.w).length ? out.filter((w) => w.w) : spread(text, 0.05, (en[en.length - 1] ?? 1) - 0.05);
}

// Eleven v4 first (Hebrew, most natural), v3 as fallback; timestamps when the model returns them
async function ttsEleven(id: string, text: string, stab?: number) {
  const key = env('ELEVENLABS_API_KEY');
  const models = [...new Set([env('ELEVENLABS_MODEL') || 'eleven_v4', 'eleven_v4', 'eleven_v3'])];
  // v3 accepts only 0 / 0.5 / 1 for stability; v4 takes the full range
  const vs = (model: string) => (stab == null ? undefined : { stability: model === 'eleven_v3' ? (stab < 0.35 ? 0 : stab > 0.7 ? 1 : 0.5) : Math.max(0, Math.min(1, stab)), similarity_boost: 0.8 });
  let plain = false; // set when the provider rejects voice settings: retry without them
  const once = (path: string, model: string) => fetch(`https://api.elevenlabs.io/v1/text-to-speech/${id}${path}?output_format=mp3_44100_128`, {
    method: 'POST', headers: { 'xi-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({ text, model_id: model, language_code: 'he', ...(plain || !vs(model) ? {} : { voice_settings: vs(model) }) }),
  });
  // 429 = too many concurrent requests on the plan: wait and retry
  const call = async (path: string, model: string) => {
    for (let k = 0; ; k++) {
      const r = await once(path, model);
      if ((r.status === 400 || r.status === 422) && !plain && stab != null) { plain = true; continue; }
      if (r.status !== 429 || k >= 4) return r;
      await wait(1500 * (k + 1));
    }
  };
  for (const model of models) {
    const r = await call('/with-timestamps', model);
    if (r.ok) { const j = await r.json(); return { model, bytes: b64(j.audio_base64), words: (sec: number) => (j.alignment ? fromChars(text, j.alignment) : spread(text, 0.05, sec - 0.05)) }; }
    const r2 = await call('', model);
    if (r2.ok) return { model, bytes: new Uint8Array(await r2.arrayBuffer()), words: (sec: number) => spread(text, 0.05, sec - 0.05) };
  }
  throw new Error('tts_failed');
}
async function ttsGoogle(name: string, text: string) {
  const r = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${env('GOOGLE_TTS_API_KEY')}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input: { text: untag(text) }, voice: { languageCode: 'he-IL', name }, audioConfig: { audioEncoding: 'MP3', sampleRateHertz: 44100 } }),
  });
  if (!r.ok) throw new Error('tts_failed');
  const j = await r.json();
  return { bytes: b64(j.audioContent), words: (sec: number) => spread(text, 0.05, sec - 0.05) };
}

// one clip per scene: the scene lasts at least as long as its narration
export async function voiceScenes(d: any, org: string, voiceId: string, says: string[], stab?: number) {
  const v = VOICES.find((x) => x.id === voiceId);
  if (!v) throw new Error('unknown_voice');
  if (v.eng === 'eleven' ? !env('ELEVENLABS_API_KEY') : !env('GOOGLE_TTS_API_KEY')) throw new Error('voice_not_configured');
  const raw = v.id.slice(2);
  return await pool(says.slice(0, 30), 2, async (t) => {
    const text = cleanSay(String(t ?? '').slice(0, 400));
    if (!untag(text)) return null;
    const a = v.eng === 'eleven' ? await ttsEleven(raw, text, stab) : await ttsGoogle(raw, text);
    const sec = mp3Seconds(a.bytes) || untag(text).split(/\s+/).length / 2.4;
    return { src: await store(d, org, a.bytes, 'mp3', 'audio/mpeg'), sec: +sec.toFixed(2), words: a.words(sec), model: (a as { model?: string }).model ?? 'google' };
  });
}

export async function musicTrack(d: any, org: string, prompt: string, seconds: number) {
  const key = env('ELEVENLABS_API_KEY');
  if (!key) throw new Error('music_not_configured');
  const ms = Math.round(Math.max(10, Math.min(95, seconds)) * 1000);
  const once = () => fetch('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128', {
    method: 'POST', headers: { 'xi-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: String(prompt).slice(0, 900) + ' Instrumental only, no vocals.', music_length_ms: ms, model_id: 'music_v1', force_instrumental: true }),
  });
  let r = await once();
  for (let k = 0; r.status === 429 && k < 4; k++) { await wait(3000 * (k + 1)); r = await once(); } // plan concurrency limit
  if (!r.ok) throw new Error('music_failed');
  const bytes = new Uint8Array(await r.arrayBuffer());
  return { src: await store(d, org, bytes, 'mp3', 'audio/mpeg'), sec: +mp3Seconds(bytes).toFixed(2) };
}

// Stock: Pixabay (copied into our storage, Pixabay does not allow permanent hotlinking), Pexels when its key exists
export async function stock(d: any, org: string, queries: { q: string; v?: boolean }[], format: string) {
  const pix = env('PIXABAY_API_KEY'), pex = env('PEXELS_API_KEY');
  if (!pix && !pex) throw new Error('stock_not_configured');
  const orient = format === '16x9' ? 'landscape' : format === '1x1' ? 'square' : 'portrait';
  const used = new Set<string>();
  const copy = async (url: string, video: boolean) => {
    const r = await fetch(url);
    if (!r.ok) return null;
    const b = new Uint8Array(await r.arrayBuffer());
    if (b.length > 26_000_000) return null;
    return await store(d, org, b, video ? 'mp4' : 'jpg', video ? 'video/mp4' : 'image/jpeg');
  };
  return await pool(queries.slice(0, 20), 1, async ({ q, v }) => {
    try {
      if (pix) {
        const url = v
          ? `https://pixabay.com/api/videos/?key=${pix}&q=${encodeURIComponent(q.slice(0, 95))}&per_page=8&safesearch=true`
          : `https://pixabay.com/api/?key=${pix}&q=${encodeURIComponent(q.slice(0, 95))}&image_type=photo&per_page=8&safesearch=true${orient === 'portrait' ? '&orientation=vertical' : orient === 'landscape' ? '&orientation=horizontal' : ''}`;
        const r = await fetch(url);
        if (r.ok) {
          const j = await r.json();
          for (const x of j.hits ?? []) {
            // biggest rendition that fits the edge memory budget
            const vf = v ? ['large', 'medium', 'small'].map((k) => x.videos?.[k]).find((f: any) => f?.url && (!f.size || f.size < 24_000_000)) : null;
            const src = v ? vf?.url : (x.largeImageURL || x.webformatURL);
            if (!src || used.has(src)) continue;
            used.add(src);
            const mine = await copy(src, !!v);
            if (mine) return { src: mine, v: !!v, sec: x.duration, credit: x.user ?? '' };
          }
        }
      }
      if (pex) {
        const url = v ? `https://api.pexels.com/videos/search?query=${encodeURIComponent(q)}&orientation=${orient}&per_page=6&size=medium` : `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&orientation=${orient}&per_page=6`;
        const r = await fetch(url, { headers: { authorization: pex } });
        if (!r.ok) return null;
        const j = await r.json();
        if (v) {
          for (const x of j.videos ?? []) {
            const f = (x.video_files ?? []).filter((f: any) => f.file_type === 'video/mp4' && f.width >= 720).sort((a: any, b: any) => Math.abs(a.height - 1920) - Math.abs(b.height - 1920))[0];
            if (f && !used.has(f.link)) { used.add(f.link); return { src: f.link, v: true, sec: x.duration, credit: x.user?.name ?? '' }; }
          }
          return null;
        }
        for (const x of j.photos ?? []) {
          const s = orient === 'portrait' ? x.src?.portrait : orient === 'landscape' ? x.src?.landscape : x.src?.large2x;
          if (s && !used.has(s)) { used.add(s); return { src: s.replace(/\?.*$/, '') + '?auto=compress&cs=tinysrgb&w=1600', v: false, credit: x.photographer ?? '' }; }
        }
      }
      return null;
    } catch { return null; }
  });
}
