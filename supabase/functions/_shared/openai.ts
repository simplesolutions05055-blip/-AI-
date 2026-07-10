// OpenAI access for Edge Functions — reads OPENAI_API_KEY from Supabase secrets.
const API = 'https://api.openai.com/v1';

// Optional per-request key override. Set around a single processRequest run so
// the WHOLE generation pipeline (image, text, QA) uses a caller-supplied one-off
// key instead of the project secret. Cleared in a finally by the caller.
let overrideKey: string | null = null;
export function setOpenAiKeyOverride(k: string | null) {
  overrideKey = k && k.trim() ? k.trim() : null;
}
export function clearOpenAiKeyOverride() {
  overrideKey = null;
}

const key = () => {
  const k = overrideKey || Deno.env.get('OPENAI_API_KEY');
  if (!k) throw new Error('Missing OPENAI_API_KEY (Supabase secret)');
  return k;
};
const textModel = () => Deno.env.get('OPENAI_TEXT_MODEL') || 'gpt-4o';
const imageModel = () => Deno.env.get('OPENAI_IMAGE_MODEL') || 'gpt-image-2';

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
}

// OpenAI's per-minute token quota (TPM) is easily exceeded because a single
// generation fires several large gpt-4o calls back-to-back (analyze → generate
// → QA#1 → QA#2). When that happens OpenAI returns HTTP 429 and tells us how
// long to wait ("try again in 5.3s"). Previously we threw immediately, turning
// a transient, self-healing limit into a hard `generation_failed`. This wrapper
// retries 429 (and 500/502/503/529 transient server errors) a few times,
// honoring the wait OpenAI suggests, before giving up.
const MAX_RETRIES = 4;

// Parse the suggested wait (seconds) out of OpenAI's 429 body, e.g.
// "Please try again in 5.372s". Falls back to exponential backoff.
function retryWaitMs(status: number, body: string, attempt: number): number {
  const m = body.match(/try again in ([\d.]+)\s*(ms|s)/i);
  if (m) {
    const n = parseFloat(m[1]);
    const ms = m[2].toLowerCase() === 'ms' ? n : n * 1000;
    // Add a small cushion so we don't land exactly on the reset boundary.
    return Math.min(ms + 300, 30_000);
  }
  // No hint (e.g. 5xx): exponential backoff 1s, 2s, 4s, 8s (cap 10s).
  return Math.min(1000 * 2 ** attempt, 10_000);
}

// fetch() wrapper that retries transient OpenAI failures. The body is produced
// by a thunk so multipart FormData bodies can be rebuilt on each attempt.
async function openAiFetch(
  url: string,
  init: () => RequestInit,
  label: string,
): Promise<Response> {
  let lastBody = '';
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, init());
    if (res.ok) return res;
    const transient = res.status === 429 || res.status === 500 || res.status === 502 || res.status === 503 || res.status === 529;
    lastBody = await res.text();
    if (!transient || attempt === MAX_RETRIES) {
      throw new Error(`OpenAI ${label} ${res.status}: ${lastBody}`);
    }
    const wait = retryWaitMs(res.status, lastBody, attempt);
    console.warn(`OpenAI ${label} ${res.status} (attempt ${attempt + 1}/${MAX_RETRIES}); retrying in ${wait}ms`);
    await new Promise((r) => setTimeout(r, wait));
  }
  // Unreachable, but keeps the type checker happy.
  throw new Error(`OpenAI ${label}: exhausted retries: ${lastBody}`);
}

// Learning Agent (skill 10): turn a client correction into one concrete,
// auto-checkable rule. Returns null when the comment is too vague to be a rule.
export async function extractRuleLLM(
  comment: string,
  model?: string,
): Promise<{ rule: string | null; usage: ChatUsage }> {
  const { content, usage } = await chat(
    [
      {
        role: 'system',
        content:
          'הלקוח ביקש תיקון לתוצר. נסח את ההערה ככלל קבוע אחד, קונקרטי וניתן לבדיקה אוטומטית (משפט פעולה), ' +
          'שימנע מהטעות הזו בעתיד אצל אותו לקוח. אם ההערה כללית/מעורפלת מכדי לנסח ככלל בדיק (למשל "תהיה יותר טוב") — ' +
          'החזר rule=null. החזר JSON בלבד: {"rule": string|null}.',
      },
      { role: 'user', content: (comment ?? '').slice(0, 1000) },
    ],
    { json: true, temperature: 0, model },
  );
  try {
    const p = JSON.parse(content) as { rule?: unknown };
    return { rule: typeof p.rule === 'string' && p.rule.trim() ? p.rule.trim() : null, usage };
  } catch {
    return { rule: null, usage };
  }
}

// Hybrid skill router (LLM layer): given the skill catalog and the request
// text, pick the skill keys relevant to fulfilling it and classify the exact
// content subtype. Used only for ambiguous requests; fails open to [].
export async function routeSkillsLLM(
  catalog: { key: string; name: string; description: string }[],
  text: string,
  model?: string,
): Promise<{ keys: string[]; subtype: string | null; usage: ChatUsage }> {
  const list = catalog.map((c) => `- ${c.key}: ${c.name} — ${c.description}`).join('\n');
  const { content, usage } = await chat(
    [
      {
        role: 'system',
        content:
          'אתה נתב סקילים בצינור הפקת תוכן. מתוך הקטלוג הבא בלבד, בחר את ה-keys של הסקילים הרלוונטיים למילוי הבקשה, וזהה את סוג התוצר המדויק.\n' +
          'החזר JSON בלבד: {"subtype": string, "keys": string[]}. בחר אך ורק keys שמופיעים בקטלוג.\n\nקטלוג:\n' +
          list,
      },
      { role: 'user', content: (text ?? '').slice(0, 2000) },
    ],
    { json: true, temperature: 0, model },
  );
  try {
    const parsed = JSON.parse(content) as { subtype?: unknown; keys?: unknown };
    const allowed = new Set(catalog.map((c) => c.key));
    const keys = Array.isArray(parsed.keys)
      ? (parsed.keys as unknown[]).filter((k): k is string => typeof k === 'string' && allowed.has(k))
      : [];
    return { keys, subtype: typeof parsed.subtype === 'string' ? parsed.subtype : null, usage };
  } catch {
    return { keys: [], subtype: null, usage };
  }
}

async function chat(
  messages: { role: string; content: string }[],
  opts: { json?: boolean; temperature?: number; model?: string; apiKey?: string } = {}
): Promise<{ content: string; usage: ChatUsage }> {
  const res = await openAiFetch(
    `${API}/chat/completions`,
    () => ({
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.apiKey || key()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: opts.model || textModel(),
        messages,
        temperature: opts.temperature ?? 0.5,
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
      }),
    }),
    'chat',
  );
  const data = await res.json();
  return {
    content: data.choices?.[0]?.message?.content ?? '',
    usage: data.usage ?? { prompt_tokens: 0, completion_tokens: 0 },
  };
}

// Classify what the user wants to do with a just-delivered output, so a free
// text like "תחליף את הרקע לכחול" routes straight to the right fix flow
// without menus. Intents depend on the output: image outputs distinguish
// image_fix vs caption_fix; other outputs use content_fix.
export async function classifyPostDeliveryIntent(
  text: string,
  context: { hasImage: boolean; captionSnippet?: string | null }
): Promise<{
  intent: 'image_fix' | 'caption_fix' | 'content_fix' | 'schedule' | 'email_copy' | 'new_request' | 'unclear';
  confidence: number;
  reason: string;
  usage: ChatUsage;
  model: string;
}> {
  const model = textModel();
  const intents = context.hasImage
    ? `"image_fix"   — המשתמש רוצה לשנות משהו בתמונה/גרפיקה עצמה (צבע, רקע, טקסט שמופיע בתוך התמונה, פריסה, לוגו, מידות).
"caption_fix" — המשתמש רוצה לשנות את מלל הפוסט שמלווה את התמונה (ניסוח, אורך, טון, אימוג'ים, האשטגים).
"schedule"    — המשתמש רוצה לתזמן/לפרסם את התוצר לרשתות (פייסבוק/אינסטגרם).
"email_copy"  — המשתמש רוצה לקבל את התוצר לכתובת מייל ("תשלח לי למייל", "אפשר עותק במייל?").
"new_request" — המשתמש מבקש תוצר חדש לגמרי (בריף חדש, נושא אחר).
"unclear"     — אי אפשר לקבוע.`
    : `"content_fix" — המשתמש רוצה לשנות משהו בתוצר שנמסר (תוכן, ניסוח, מבנה, תוספות).
"schedule"    — המשתמש רוצה לתזמן/לפרסם את התוצר לרשתות.
"email_copy"  — המשתמש רוצה לקבל את התוצר לכתובת מייל ("תשלח לי למייל", "אפשר עותק במייל?").
"new_request" — המשתמש מבקש תוצר חדש לגמרי (בריף חדש, נושא אחר).
"unclear"     — אי אפשר לקבוע.`;
  const { content, usage } = await chat(
    [
      {
        role: 'system',
        content: `זה עתה נמסר למשתמש תוצר בוואטסאפ${context.hasImage ? ' (תמונה + טקסט פוסט)' : ''}. סווג את ההודעה הבאה של המשתמש.
החזר JSON בלבד:
{
  "intent": "<אחד מהערכים>",
  "confidence": 0-1,
  "reason": "הסבר קצר"
}

ערכי intent אפשריים:
${intents}

שים לב: בקשת שינוי מנוסחת לרוב כהוראה ("תחליף", "תוסיף", "תקצר", "שנה"). בריף חדש מתאר תוצר שלם אחר ("תכין לי עכשיו הזמנה ל...").`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          user_message: text,
          current_post_text_snippet: (context.captionSnippet ?? '').slice(0, 300) || null,
        }),
      },
    ],
    { json: true, temperature: 0, model }
  );
  const allowed = context.hasImage
    ? ['image_fix', 'caption_fix', 'schedule', 'email_copy', 'new_request', 'unclear']
    : ['content_fix', 'schedule', 'email_copy', 'new_request', 'unclear'];
  try {
    const parsed = JSON.parse(content) as { intent?: unknown; confidence?: unknown; reason?: unknown };
    const intent = allowed.includes(String(parsed.intent))
      ? (String(parsed.intent) as 'image_fix' | 'caption_fix' | 'content_fix' | 'schedule' | 'email_copy' | 'new_request' | 'unclear')
      : 'unclear';
    const confidence = typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0;
    return { intent, confidence, reason: typeof parsed.reason === 'string' ? parsed.reason : '', usage, model };
  } catch {
    return { intent: 'unclear', confidence: 0, reason: 'invalid_json_response', usage, model };
  }
}

export async function classifyResetIntent(
  text: string,
  context: { lastAssistantMessage?: string | null } = {}
): Promise<{ reset: boolean; confidence: number; reason: string; usage: ChatUsage; model: string }> {
  const model = textModel();
  const { content, usage } = await chat(
    [
      {
        role: 'system',
        content: `אתה מסווג כוונת שליטה בשיחת WhatsApp עם סוכן.
החזר JSON בלבד:
{
  "reset": true|false,
  "confidence": 0-1,
  "reason": "הסבר קצר"
}

סמן reset=true רק אם המשתמש מבקש למחוק/לנטוש את הבקשה הנוכחית ולהתחיל בקשה חדשה מהתחלה.
דוגמאות reset=true: "בוא נתחיל מההתחלה", "נתחיל מחדש", "עזוב הכל", "פתח בקשה חדשה", "איפוס".
דוגמאות reset=false: בקשה לכתוב על התחלה חדשה, תיקון לבריף, מענה לשאלה, שאלה כללית, או הודעה לא ברורה.`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          user_message: text,
          last_assistant_message: context.lastAssistantMessage ?? null,
        }),
      },
    ],
    { json: true, temperature: 0, model }
  );

  try {
    const parsed = JSON.parse(content) as { reset?: unknown; confidence?: unknown; reason?: unknown };
    const confidence = typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0;
    return {
      reset: parsed.reset === true,
      confidence,
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
      usage,
      model,
    };
  } catch {
    return { reset: false, confidence: 0, reason: 'invalid_json_response', usage, model };
  }
}

export async function analyzeBrief(
  systemPrompt: string,
  transcript: string,
  roundsRemaining: number,
  apiKey?: string
) {
  const instruction = `${systemPrompt}

נתח את כל ההודעות מהמשתמש שלהלן והפק JSON בלבד במבנה:
{
  "output_type": "text|image|pdf|presentation|null",
  "title": "כותרת תוצר קצרה להצגה ולמייל, 3-8 מילים, שורה אחת, ללא Markdown",
  "goal": "...", "audience": "...", "language": "עברית",
  "must_include": ["..."], "style": "...", "source_materials": "...",
  "dimensions": "...", "customer_email": "...",
  "color_override": "...",
  "ready": true|false, "missing": ["שדות חסרים"],
  "next_question": "השאלה הבאה בעברית או null אם הבריף מוכן"
}
נותרו ${roundsRemaining} סבבי שאלות. אם נגמרו הסבבים, סמן ready=true עם המידע הקיים.
חובה להחזיר title קצר ונקי לכל תוצר מוכן. title הוא שם התוצר להצגה ללקוח ולנושא המייל, לא תיאור מלא. אסור לכלול בו Markdown, כוכביות, קישורים, רשימות, ירידות שורה, "מתי/איפה", או טקסט ארוך. דוגמאות: "צוענייה במגפיים - מופע מוזיקלי", "קמפיין הרשמה לקייטנות", "הצעת מחיר לאתר תדמית".
אם המשתמש מבקש במפורש צבע אחר מזה של המותג (למשל "תעשה את הראשי כחול במקום אדום", "בלי הכתום", "בגוונים ירוקים"), רשום זאת ב-color_override כתיאור חופשי בעברית של מה לשנות; אחרת השאר color_override=null. שינוי כזה גובר על פלטת המותג רק לתוצר הנוכחי.
אם המשתמש מבקש מידות/גודל אחרים (למשל "סטורי 1080x1920", "פוסט מלבני", "באנר רחב"), עדכן את dimensions בהתאם — גם באמצע שיחה, גם אם כבר נקבעו מידות קודם.
אם הטרנסקריפט כולל "הקשר קודם מהשיחה", השתמש בו רק כאשר המשתמש מפנה אליו במפורש או במשתמע במילים כמו "כמו קודם", "אותו קהל", "גם", "המשך", "על אותו אירוע". במקרה כזה השלם פרטים חסרים מההקשר הקודם, למשל קהל יעד, עיר, אירוע, תאריך/זמן או מסרים.
שאל שאלה אחת ממוקדת בלבד אם חסר מידע מהותי ליצירת התוצר.
בתמונות, מידות/יחס תמונה אינם מידע מהותי: אם המשתמש לא ציין מידות, קבע dimensions="מידות מומלצות" או "ריבוע 1:1 לרשתות חברתיות" והמשך. אם המשתמש אומר "מידות מומלצות", סמן ready=true.
אם ההודעה האחרונה של המשתמש לא עונה לשאלה האחרונה של המערכת ואין קשר ברור בין הדברים, אל תנחש. החזר next_question קצר בסגנון: "לא בטוח שהבנתי איך זה קשור לשאלה הקודמת. תוכל לחדד מה תרצה שנעשה?"
חשוב: כתובת מייל אינה חובה ואין לשאול עליה. סמן ready=true ברגע שיש מספיק מידע יצירתי כדי להפיק את התוצר, גם ללא מייל.`;

  const { content, usage } = await chat(
    [
      { role: 'system', content: instruction },
      { role: 'user', content: transcript },
    ],
    { json: true, temperature: 0.3, apiKey }
  );

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = { ready: false, next_question: 'תוכל לפרט מעט יותר מה תרצה שניצור עבורך?' };
  }
  const nextQuestion = parsed.ready === true ? null : ((parsed.next_question as string) || null);
  return { brief: parsed, nextQuestion, usage };
}

// Detect an explicit requested slide count inside a free-text deck prompt
// (e.g. "מצגת של 5 שקפים על..."). Returns null when the user did not specify
// one — the WhatsApp deck flow then asks for it explicitly.
export async function extractSlideCountFromPrompt(
  prompt: string
): Promise<{ count: number | null; usage: ChatUsage; model: string }> {
  const model = textModel();
  const { content, usage } = await chat(
    [
      { role: 'system', content: 'אתה מחלץ פרמטרים מבקשה ליצירת מצגת. החזר JSON תקין בלבד.' },
      {
        role: 'user',
        content: `האם הבקשה הבאה מציינת כמה שקפים המשתמש רוצה במצגת (במפורש, כמו "5 שקפים" או "שני שקפים")?
החזר JSON: {"slide_count": <מספר שלם או null>}
אם לא צוין מספר שקפים בבקשה — החזר null. אל תנחש ואל תמציא ברירת מחדל.

הבקשה:
"""${prompt}"""`,
      },
    ],
    { json: true, temperature: 0, model }
  );
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = {};
  }
  const n = Number(parsed?.slide_count);
  const count = Number.isInteger(n) && n >= 1 && n <= 30 ? n : null;
  return { count, usage, model };
}

// Generate rich, marketing-grade slide content using the exact count requested
// in the brief. A deck with extra slides is not a valid result.
export async function generateDeckSlides(systemPrompt: string, brief: unknown) {
  const requestedSlideCount = requestedDeckSlideCount(brief);
  const { content, usage } = await chat(
    [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `אתה כותב תוכן שיווקי מקצועי בעברית. הפק מצגת אינפורמטיבית ומשכנעת של בדיוק ${requestedSlideCount} שקפים על בסיס הבריף. הרחב את מה שנמסר לתוכן מלא, עשיר ומעשי — אל תכתוב משפטים ריקים או כלליים. כל שקף חייב להיות אינפורמטיבי ובעל ערך לקהל היעד.
החזר JSON תקין בלבד במבנה:
{
  "slides": [
    {
      "title": "כותרת קצרה וחדה",
      "subtitle": "שורת משנה אופציונלית או null",
      "bullets": ["נקודה אינפורמטיבית 1", "נקודה 2", "נקודה 3"],
      "body": "פסקה קצרה משלימה או null",
      "image_suggestion": "תיאור קצר של תמונה מתאימה לשקף או null"
    }
  ]
}
דרישות:
- בדיוק ${requestedSlideCount} שקפים. אין להוסיף שקפים מעבר למספר שהתבקש.
- שקף 1 = פתיחה/כותרת.
- שקף אחרון = סיכום + קריאה לפעולה.
- 3-5 נקודות מהותיות בכל שקף תוכן.
- עברית RTL, טון מותאם לקהל היעד שבבריף.
- אל תמציא עובדות, נתונים, שמות או תאריכים שלא נמסרו.
- אסור להחזיר שקפי מטא או מפרט: בלי "פלטת צבעים", בלי "צבעי מותג", בלי "הנחיות עיצוב", בלי "סגנון עיצובי", בלי "טיפוגרפיה", בלי "קומפוזיציה", בלי "מפרט שקף", בלי הסברים על איך לעצב את המצגת.
- אם בבריף קיימים צבעים, מיתוג, סגנון או הנחיות עיצוב — השתמש בהם רק כרקע פנימי ל-image_suggestion, לא כתוכן שמופיע בשקפים.
- כל title/bullets/body חייבים להיות תוכן שהקהל אמור לראות במצגת עצמה, לא הוראות למעצב ולא תיאור טכני של העיצוב.
בריף:\n${JSON.stringify(brief, null, 2)}`,
      },
    ],
    { json: true, temperature: 0.7 }
  );
  let parsed: any = {};
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = {};
  }
  // The model may return slides directly, or — when a strong conversational
  // system prompt leaks in — nest them under brief.presentation_spec. Accept any.
  const slides =
    (Array.isArray(parsed?.slides) && parsed.slides) ||
    (Array.isArray(parsed?.presentation_spec?.slide_structure) && parsed.presentation_spec.slide_structure) ||
    (Array.isArray(parsed?.brief?.presentation_spec?.slide_structure) && parsed.brief.presentation_spec.slide_structure) ||
    [];
  const sanitized = sanitizeDeckSlides(slides, requestedSlideCount);
  if (sanitized.length !== requestedSlideCount) {
    throw new Error(`התקבלו ${sanitized.length} שקפים במקום ${requestedSlideCount} שהתבקשו.`);
  }
  return { slides: sanitized, usage, raw: content };
}

function requestedDeckSlideCount(brief: unknown): number {
  const source = brief && typeof brief === 'object' ? brief as Record<string, unknown> : {};
  const spec = source.presentation_spec as Record<string, unknown> | undefined;
  const direct = [source.slide_count, source.slideCount, spec?.slide_count]
    .find((value) => value !== undefined && value !== null && String(value).trim() !== '');
  const mustInclude = Array.isArray(source.must_include) ? source.must_include.join(' ') : String(source.must_include ?? '');
  const match = String(direct ?? '').match(/\d+/) ?? mustInclude.match(/מספר\s*שקפים(?:\s*רצוי)?\s*[:：-]?\s*(\d+)/);
  const value = Number(match?.[1] ?? match?.[0]);
  return Number.isInteger(value) && value >= 1 && value <= 30 ? value : 10;
}

// Rewrite the content of ONE deck slide per a free-text instruction from the
// user, without touching the other slides. Used by the GPT-Images deck content
// editor so a user can refine a slide's copy before generating its image.
// Returns the rewritten slide in the same shape as generateDeckSlides items.
export async function rewriteDeckSlide(
  brief: unknown,
  slide: { title?: string; subtitle?: string | null; bullets?: string[]; body?: string | null; image_suggestion?: string | null },
  instruction: string,
  slideNumber: number,
) {
  const current = {
    title: slide?.title ?? '',
    subtitle: slide?.subtitle ?? null,
    bullets: Array.isArray(slide?.bullets) ? slide.bullets : [],
    body: slide?.body ?? null,
    image_suggestion: slide?.image_suggestion ?? null,
  };
  const { content, usage } = await chat(
    [
      {
        role: 'system',
        content:
          'אתה עורך תוכן מצגות מקצועי בעברית RTL. משכתב תוכן של שקף בודד לפי הנחיית המשתמש בלבד, בלי לשנות שקפים אחרים ובלי לחרוג מהנושא.',
      },
      {
        role: 'user',
        content: `להלן תוכן של שקף ${slideNumber} במצגת. שכתב אותו לפי ההנחיה של המשתמש, ושמור על אותו נושא כללי.
הנחיית המשתמש: «${instruction}»

תוכן השקף הנוכחי (JSON):
${JSON.stringify(current, null, 2)}

נושא המצגת: ${(brief as any)?.topic || (brief as any)?.goal || ''}

החזר JSON תקין בלבד באותו מבנה:
{
  "title": "כותרת קצרה וחדה",
  "subtitle": "שורת משנה או null",
  "bullets": ["נקודה 1", "נקודה 2", "נקודה 3"],
  "body": "פסקה קצרה או null",
  "image_suggestion": "תיאור תמונה מתאימה לשקף או null"
}
דרישות:
- עברית תקנית ומדויקת, טון מותאם לקהל.
- יישם את ההנחיה של המשתמש במדויק.
- אל תמציא עובדות, נתונים, שמות או תאריכים שלא נמסרו.
- אסור להחזיר שמות צבעים, קודי צבע, פלטת צבעים, הנחיות עיצוב או מפרט טכני כתוכן — רק תוכן שהקהל אמור לראות בשקף.`,
      },
    ],
    { json: true, temperature: 0.6 }
  );
  let parsed: any = {};
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = {};
  }
  const rewritten = {
    title: typeof parsed?.title === 'string' && parsed.title.trim() ? parsed.title : current.title,
    subtitle: typeof parsed?.subtitle === 'string' ? parsed.subtitle : null,
    bullets: Array.isArray(parsed?.bullets) ? parsed.bullets.filter((b: unknown) => typeof b === 'string' && b.trim()) : current.bullets,
    body: typeof parsed?.body === 'string' ? parsed.body : null,
    image_suggestion: typeof parsed?.image_suggestion === 'string' ? parsed.image_suggestion : current.image_suggestion,
  };
  return { slide: sanitizeDeckSlides([rewritten])[0] ?? rewritten, usage, raw: content };
}

function sanitizeDeckSlides(slides: any[], limit = 10): any[] {
  const metaRe = /פלטת|צבעי?\s*מותג|צבעים?\s*שנבחר|הנחיות?\s*עיצוב|סגנון\s*עיצוב|טיפוגרפ|קומפוזיצ|מפרט\s*שקף|brand\s*color|palette|design\s*guidelines/i;
  return slides
    .filter((slide) => {
      const text = [
        slide?.title,
        slide?.subtitle,
        ...(Array.isArray(slide?.bullets) ? slide.bullets : []),
        slide?.body,
      ].filter(Boolean).join(' ');
      return !metaRe.test(text);
    })
    .slice(0, limit);
}

// Build a structured Hebrew price-quote ("הצעת מחיר") from a free brief. Mirrors
// the Simple Solutions quote layout (header, meta strip, summary, total box,
// numbered component cards, included-checklist, technologies, payment terms,
// terms & conditions, signature). CRITICAL: never invent prices — use ONLY the
// amounts the brief/prompt supplies. Missing price → empty string / "לפי סיכום".
export async function generateQuote(systemPrompt: string, brief: unknown, apiKey?: string) {
  const { content, usage } = await chat(
    [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `אתה כותב הצעת מחיר מקצועית בעברית RTL לפי הבריף. הרחב את התיאור לתוכן מלא, ברור ומשכנע — אך אל תמציא עובדות, היקפים, טכנולוגיות או תאריכים שלא נמסרו.
חוק דומיין קריטי: ההצעה חייבת להתאים בדיוק לנושא הבריף — אירוע, הצגה, מופע, הפקה, כנס, שירות, מוצר, קמפיין וכו'. לעולם אל תניח שמדובר בפרויקט תוכנה / פיתוח אפליקציה / מערכת מחשוב, ואל תשתמש במונחי פיתוח (Frontend, Backend, אפיון מערכת, פלטפורמה דיגיטלית, טכנולוגיות פיתוח) — אלא אם הבריף עוסק במפורש ובאופן חד-משמעי בפיתוח תוכנה. אם הבריף הוא על אירוע/הצגה — ההצעה היא להפקת/ארגון האירוע, והרכיבים הם מרכיבי האירוע (אולם, ציוד, צוות, כרטוס, הסעות, קייטרינג וכו') לפי מה שמופיע בבריף בלבד.
חוק קריטי על מחירים: אל תמציא, אל תחשב ואל תוסיף מחירים. השתמש אך ורק במחירים/סכומים שמופיעים במפורש בבריף. אם לא נמסר מחיר לשדה כלשהו — החזר מחרוזת ריקה "" (לא 0, לא הערכה). אל תפרק מחיר כולל לרכיבים אלא אם הפירוק נמסר בבריף.
החזר JSON תקין בלבד במבנה:
{
  "title": "כותרת ההצעה לפי נושא הבריף",
  "subtitle": "שורת משנה קצרה או null",
  "meta": { "doc": "הצעת מחיר", "date": "תאריך אם נמסר אחרת ''", "project_type": "סוג ההצעה לפי הבריף (למשל 'הפקת אירוע', 'הצגת ילדים', 'שירות')", "platform": "הקשר/מיקום/קטגוריה ראשית לפי הבריף, או '' אם לא רלוונטי" },
  "summary": "פסקת תקציר אחת על מה ההצעה כוללת",
  "headline": { "label": "כותרת לתיבת הסיכום, מותאמת לנושא (למשל 'הפקת האירוע — מחיר כולל')", "sub": "שורת תיאור קצרה", "price": "המחיר הכולל בדיוק כפי שנמסר בבריף או '' אם לא נמסר" },
  "components_title": "כותרת לקטע הרכיבים, מותאמת לנושא (למשל 'מרכיבי האירוע' / 'פירוט ההצעה'). ברירת מחדל: 'פירוט ההצעה'",
  "components": [ { "title": "שם רכיב לפי הבריף", "desc": "תיאור קצר", "price": "מחיר הרכיב אם נמסר בבריף אחרת ''" } ],
  "included_title": "כותרת לקטע הכלול, מותאמת לנושא (למשל 'מה כולל'). ברירת מחדל: 'מה כולל'",
  "included": ["פריט שכלול בהצעה 1", "פריט 2"],
  "ownership_note": "משפט רלוונטי לנושא או null",
  "technologies_title": "כותרת לקטע זה אם רלוונטי, או null",
  "technologies": ["רק אם רלוונטי לנושא — אחרת השאר ריק []"],
  "payment_terms": [ { "title": "תנאי תשלום", "desc": "פירוט" } ],
  "terms": ["תנאי או הגבלה 1", "תנאי 2"],
  "disclaimer": "הערת 'לתשומת לבך' או null",
  "signature": true
}
דרישות: עברית RTL, טון עסקי מקצועי. components בין 3 ל-8 פריטים לפי הבריף ובהתאם לנושאו. included רשימת צ'ק-ליסט קצרה וברורה. השאר technologies ריק [] אם הנושא אינו טכנולוגי. אל תמציא מחירים — חזור על הכלל למעלה.
אם הבריף כולל "previous_quote" ו-"revision_request": קח את previous_quote כבסיס, והחל עליו את השינוי המבוקש ב-revision_request על כל שדה רלוונטי — טקסט, ניסוח, סדר, כותרות, תקציר, רכיבים (components), פריטים כלולים (included), טכנולוגיות, תנאי תשלום ותנאים. השינוי יכול להוסיף, להסיר, לנסח מחדש או לסדר מחדש תוכן — בצע בדיוק את מה שהמשתמש ביקש, גם אם זה מוסיף רכיב או נושא חדש שלא הופיע בבריף המקורי (revision_request גובר על האיסור להמציא היקפים/טכנולוגיות). שמור על שאר השדות שלא נגעת בהם כפי שהם. אל תשנה מחירים אלא אם המשתמש ביקש זאת במפורש ב-revision_request, ולעולם אל תמציא סכום חדש.
בריף:\n${JSON.stringify(brief, null, 2)}`,
      },
    ],
    { json: true, temperature: 0.5, apiKey }
  );
  let parsed: any = {};
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = {};
  }
  return { quote: parsed, usage, raw: content };
}

export async function generateText(systemPrompt: string, brief: unknown, note?: string) {
  const { content, usage } = await chat(
    [
      { role: 'system', content: `${systemPrompt}

אתה כותב תוצר מסוג טקסט/פוסט לרשתות חברתיות, בעיקר פייסבוק/וואטסאפ/אינסטגרם, ולא מסמך עבודה.
החזר רק את גוף הפוסט עצמו בעברית, בלי כותרת "פוסט", בלי הסברים, בלי Markdown ובלי מבנה של מסמך/PDF.

סגנון הכתיבה הרצוי:
- פתיחה קצרה וחזקה שמייצרת עניין, גאווה, שמחה, הזמנה או עדכון ברור.
- טון חיובי, קהילתי, חם, מכבד ומקצועי. כשמדובר ברשות/עירייה: סגנון עירוני-קהילתי שמדגיש עשייה, תושבים, שייכות וגאווה מקומית.
- משפטים קצרים יחסית, זורמים ונוחים לקריאה בפיד או בוואטסאפ.
- גוף הפוסט יתאר בקצרה מה קרה / מה קורה / למה זה חשוב / למי זה מיועד.
- סיום עם תודה, ברכה, הזמנה להשתתפות, קריאה לפעולה או משפט שמחזק קהילה, לפי ההקשר.
- שלב אימוג'ים במידה טבעית, בעיקר בתחילת הפוסט ובסופי משפטים מרכזיים. אל תעמיס.
- אל תכתוב כמו מאמר, בריף, דוח, הצעה, סיכום מנהלים או מסמך PDF.
- אסור להשתמש בכותרות משנה, רשימות, נקודות, סעיפים ממוספרים או תוויות מידע.
- אסור לכתוב תוויות כמו "תאריך האירוע:", "שעה:", "מיקום:", "על ההצגה:", "המסרים המרכזיים:", "פרטים חשובים:", "למי זה מתאים?", "מחירים:", "נגישות:".
- אם יש הרבה פרטים טכניים, שלב רק את החשובים ביותר בתוך משפט טבעי אחד או שניים. אל תפרק אותם לטופס.
- אם הבריף כולל מסרים חינוכיים/ערכיים, אל תכתוב "המסרים המרכזיים". הפוך אותם למשפט טבעי כמו "הצגה צבעונית שמזכירה לילדים כמה חשוב לשתף פעולה, לעזור לאחרים ולא לוותר גם כשמשהו משתבש".
- אל תמציא עובדות, תאריכים, שמות, מחירים, מיקומים או פרטי קשר שלא הופיעו בבריף. אם פרט חסר, נסח סביבו בלי להמציא.
- אורך ברירת מחדל: 2-4 שורות קצרות, בערך 45-80 מילים. רק אם המשתמש ביקש במפורש פוסט מפורט, אפשר להגיע עד כ-100 מילים.

מבנה מומלץ לפוסט עירוני קצר:
שורת פתיחה חגיגית/מזמינה, למשל "מחר זה קורה!", "חוויה לכל המשפחה במגדל העמק", "פותחים את הקיץ עם הרבה שמחה".
אחריה 1-2 משפטים טבעיים בלבד: מה קורה, איפה/מתי אם זה חיוני, ולמה כדאי להגיע.
סיום קצר ומזמין. בלי להפוך את הפוסט למודעה מפורטת.

דוגמת סגנון בלבד, לא להעתיק עובדות:
"חוויה לכל המשפחה במגדל העמק 🎪
הצגת הילדים האהובה מגיעה להיכל התרבות עם סיפור מלא הרפתקאות, חברות והרבה רגעים שילדים אוהבים ❤️
ניפגש ביום שלישי בשעה 17:30 בהיכל התרבות מתנ״ס מגדל העמק לערב שמח ומהנה לכל המשפחה 🎉"` },
      {
        role: 'user',
        content: `כתוב פוסט קצר ומוכן לפרסום בעברית לפי הבריף הבא. חשוב: זה פוסט לרשת חברתית, לא מסמך ולא סיכום עם סעיפים:\n${JSON.stringify(brief, null, 2)}${
          note ? `\n\nהערת תיקון מהמנהל: ${note}` : ''
        }`,
      },
    ],
    { temperature: 0.7 }
  );
  if (!looksLikeBriefJson(content)) return { text: content, usage };

  const retry = await chat(
    [
      {
        role: 'system',
        content: 'כתוב אך ורק פוסט פייסבוק קצר בעברית. אסור להחזיר JSON, אסור להחזיר שדות כמו action/brief/output_type, אסור להשתמש ב-Markdown או ברשימות. החזר 2-4 שורות קצרות בלבד בסגנון עירוני-קהילתי חם וחגיגי.',
      },
      {
        role: 'user',
        content: `זה הבריף. הפוך אותו לפוסט פייסבוק קצר, לא ל-JSON:\n${JSON.stringify(brief, null, 2)}${
          note ? `\n\nהערת תיקון מהמנהל: ${note}` : ''
        }`,
      },
    ],
    { temperature: 0.7 }
  );
  return {
    text: looksLikeBriefJson(retry.content) ? fallbackSocialPostFromBrief(brief) : retry.content,
    usage: {
      prompt_tokens: usage.prompt_tokens + retry.usage.prompt_tokens,
      completion_tokens: usage.completion_tokens + retry.usage.completion_tokens,
    },
  };
}

function looksLikeBriefJson(content: string): boolean {
  const text = content.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  if (!text.startsWith('{')) return false;
  try {
    const parsed = JSON.parse(text);
    return Boolean(parsed && typeof parsed === 'object' && ('action' in parsed || 'brief' in parsed || 'ready_for_generation' in parsed));
  } catch {
    return /"action"\s*:\s*"ready_to_generate"|"brief"\s*:|"output_type"\s*:\s*"text"/.test(text);
  }
}

function fallbackSocialPostFromBrief(brief: unknown): string {
  const b = (brief && typeof brief === 'object' ? brief : {}) as Record<string, unknown>;
  const topic = typeof b.topic === 'string' && b.topic.trim() ? b.topic.trim() : 'אירוע מיוחד במגדל העמק';
  const include = Array.isArray(b.must_include) ? b.must_include.map(String) : [];
  const title = include.find((x) => /סמי|הצג|אירוע|מופע/.test(x)) ?? topic;
  const date = include.find((x) => /יום|202\d|שעה|17:30/.test(x));
  const place = include.find((x) => /היכל|מתנ|מגדל|רחוב/.test(x));
  const details = [date, place].filter(Boolean).join(' ב');
  return [
    `${title} מגיעה למגדל העמק 🎪`,
    'חוויה שמחה ומוזיקלית לילדות ולילדים, עם הרבה הרפתקאות, חברות ורגעים לכל המשפחה ❤️',
    details ? `ניפגש ${details} לערב מהנה ומרגש 🎉` : 'מוזמנים להגיע, ליהנות ולפתוח יחד חוויה משפחתית שמחה 🎉',
  ].join('\n');
}

// Write a ready-to-publish social caption (Facebook / Instagram) from a brief.
// Used when the produced output is an image: the brief is the only source of the
// post's wording, so the model turns it into a finished caption the admin can
// schedule as-is or lightly edit.
export async function generateSocialCaption(
  brief: unknown,
  platform: string,
  apiKey?: string,
  // Revision mode: rewrite an existing caption per the user's feedback instead
  // of drafting a fresh one. Same guardrails (no invented facts).
  revision?: { currentCaption: string; feedback: string },
) {
  const platformLabel = platform === 'instagram' ? 'אינסטגרם' : 'פייסבוק';
  const userContent = revision
    ? `זהו הפוסט הנוכחי שמלווה את התמונה:\n"""\n${revision.currentCaption}\n"""\n\nבקשת שינוי מהמשתמש: ${revision.feedback}\n\nעדכן את הפוסט לפי הבקשה בלבד, ושמור על שאר התוכן, העובדות והטון. החזר רק את הפוסט המעודכן, בלי הסברים.\n\nהבריף המקורי לעיון:\n${JSON.stringify(brief, null, 2)}`
    : `כתוב פוסט ל${platformLabel} שילווה את התמונה, לפי הבריף הבא:\n${JSON.stringify(brief, null, 2)}`;
  const { content, usage } = await chat(
    [
      {
        role: 'system',
        content: `אתה כותב/ת תוכן לרשתות חברתיות. כתוב פוסט אחד מוכן לפרסום ב${platformLabel} בעברית, על בסיס הבריף בלבד.
- החזר רק את גוף הפוסט עצמו — בלי כותרת "פוסט", בלי הסברים ובלי מירכאות עוטפות.
- פתיחה קצרה וחזקה שמייצרת עניין, גאווה, שמחה, הזמנה או עדכון ברור.
- גוף קצר וברור שמתאר מה קרה / מה קורה / למה זה חשוב / למי זה מיועד.
- סיום עם תודה, ברכה, הזמנה להשתתפות, קריאה לפעולה או משפט שמחזק קהילה, לפי ההקשר.
- אם מדובר ברשות/עירייה/קהילה: כתוב בסגנון עירוני-קהילתי, חם, חיובי ומכבד, עם דגש על תושבים, עשייה, שייכות וגאווה מקומית.
- שלב אימוג'ים במידה טבעית. אל תעמיס ואל תהפוך את הפוסט לרשימת האשטגים.
- אסור להשתמש בכותרות משנה, רשימות, נקודות או תוויות כמו "המסרים המרכזיים", "פרטים חשובים", "מחירים", "מיקום".
- פרטים טכניים יופיעו רק בתוך משפטים טבעיים וקצרים.
- שמור על טון וסגנון שמתאימים למותג ולקהל היעד שבבריף.
- אל תמציא עובדות, מחירים, תאריכים או פרטים שלא הופיעו בבריף. אם פרט חסר — נסח בלעדיו.
- אורך מתאים לרשת: כמה משפטים עד פסקה קצרה, לא מסמך ארוך.`,
      },
      {
        role: 'user',
        content: userContent,
      },
    ],
    { temperature: 0.7, apiKey }
  );
  return { text: content.trim(), usage };
}

export async function generateDocumentText(systemPrompt: string, brief: unknown, note?: string) {
  const { content, usage } = await chat(
    [
      { role: 'system', content: `${systemPrompt}

אתה כותב מסמך סופי לעריכה ב-Word, לא בריף ולא הנחיות עיצוב.
החזר רק את תוכן המסמך עצמו בעברית, בפורמט Markdown נקי:
- כותרת ראשית אחת בתחילת המסמך.
- פסקאות מלאות שאפשר להשתמש בהן כמו שהן.
- כותרות משנה ורשימות רק כשזה טבעי למסמך.
- המסמך חייב להיות בהיקף של לפחות עמוד מלא אחד: לפחות 550 מילים בעברית, אלא אם המשתמש ביקש במפורש מסמך קצר יותר.
- כל מידע רלוונטי לאירוע או לנושא שהופיע בבריף חייב להיכנס למסמך: תאריך, שעה, מקום, קהל יעד, מטרות, מסרים, דרישות חובה, פרטי קשר, דגשים, מגבלות וחומרי מקור. אל תקצר על חשבון פרטים רלוונטיים.
- אם יש חומרי מקור או business_content_context, שלב מהם את כל הפרטים הרלוונטיים לתוצר הסופי בלי להפוך את המסמך לסיכום טכני.
- בלי "הנחיות עיצוב", בלי "צבעי מותג", בלי "Footer", בלי הערות למעצב, בלי הסברים על איך לעצב.
- בלי placeholders כמו "[נדרש קלט]" או "נדרש קלט". אם חסר תאריך/מקום/שם, כתוב ניסוח שלא תלוי בפרט החסר או השמט את הפרט.
- אל תכתוב בסוף הערות בסוגריים על מה צריך להשלים לפני הפצה.
- אל תמציא עובדות קונקרטיות שלא הופיעו בבריף.
- הטקסט צריך להיות מסמך עבודה אמיתי, ברור, מקצועי ומוכן להורדה כ-DOCX.` },
      {
        role: 'user',
        content: `הפק מסמך מלא וסופי בעברית לפי הבריף הבא:\n${JSON.stringify(brief, null, 2)}${
          note ? `\n\nהערת תיקון מהמנהל: ${note}` : ''
        }`,
      },
    ],
    { temperature: 0.55 }
  );
  return { text: content, usage };
}

export async function generatePresentationOutline(
  systemPrompt: string,
  brief: unknown,
  assetsNote?: string
) {
  const assetInstruction = assetsNote
    ? `\n\nנכסי מיתוג זמינים להורדה ישירה:\n${assetsNote}\nאם יש קישור של "לוגו רשמי", זהו הנכס המחייב של המותג. השתמש בו במקומות המתאימים למצגת, במיוחד בשקף פתיחה/סגירה או בכותרת/פוטר, וציין במפורש היכן הוא מופיע.\nלכל שקף שבו משובצת תמונה, ציין במפורש את כותרת/תיאור התמונה ואת הקישור המלא שלה. אל תמציא קישורים — השתמש אך ורק בקישורים שסופקו.`
    : '';
  const { content, usage } = await chat(
    [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `הפק מבנה מצגת בעברית RTL הכולל: כותרת לכל שקף, תוכן מלא לכל שקף, והנחיות עיצוב. בריף:\n${JSON.stringify(
          brief,
          null,
          2
        )}${assetInstruction}`,
      },
    ],
    { temperature: 0.6 }
  );
  return { text: content, usage };
}

export async function generateImage(
  prompt: string,
  opts: { model?: string; size?: string; quality?: string; systemMessage?: string } = {}
): Promise<{ base64: string; mime: string; model: string }> {
  const model = opts.model || imageModel();
  const finalPrompt = opts.systemMessage ? `${opts.systemMessage}\n\nבקשת המשתמש:\n${prompt}` : prompt;
  const res = await openAiFetch(
    `${API}/images/generations`,
    () => ({
      method: 'POST',
      headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: finalPrompt,
        size: opts.size || '1024x1024',
        quality: opts.quality || 'auto',
        n: 1,
      }),
    }),
    'image',
  );
  const data = await res.json();
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI image returned no data');
  return { base64: b64, mime: 'image/png', model };
}

export async function generateImageWithReferences(
  prompt: string,
  references: Array<{ base64: string; mime: string; name?: string }>,
  opts: { model?: string; size?: string; quality?: string; systemMessage?: string } = {}
): Promise<{ base64: string; mime: string; model: string }> {
  if (!references.length) return generateImage(prompt, opts);
  const model = opts.model || imageModel();
  const finalPrompt = opts.systemMessage ? `${opts.systemMessage}\n\nבקשת המשתמש:\n${prompt}` : prompt;
  const buildForm = () => {
    const form = new FormData();
    form.append('model', model);
    form.append('prompt', finalPrompt);
    if (opts.size) form.append('size', opts.size);
    if (opts.quality) form.append('quality', opts.quality);
    form.append('n', '1');
    for (const [idx, ref] of references.entries()) {
      const mime = ref.mime || 'image/png';
      const ext = mime.includes('jpeg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png';
      const bytes = Uint8Array.from(atob(ref.base64), (c) => c.charCodeAt(0));
      form.append('image[]', new Blob([bytes], { type: mime }), ref.name || `reference-${idx + 1}.${ext}`);
    }
    return form;
  };
  const res = await openAiFetch(
    `${API}/images/edits`,
    () => ({ method: 'POST', headers: { Authorization: `Bearer ${key()}` }, body: buildForm() }),
    'image reference edit',
  );
  const data = await res.json();
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI image reference edit returned no data');
  return { base64: b64, mime: 'image/png', model };
}

// Edit an existing image (img2img): keep the source as the base and apply the
// requested changes via OpenAI's images/edits endpoint. Used by the "fix this
// output" flow so the user gets a revised version of the SAME image rather than
// an unrelated regeneration.
export async function editImage(
  sourceBase64: string,
  sourceMime: string,
  prompt: string,
  opts: { model?: string; size?: string; systemMessage?: string; references?: Array<{ base64: string; mime: string }> } = {}
): Promise<{ base64: string; mime: string; model: string }> {
  const model = opts.model || imageModel();
  const finalPrompt = opts.systemMessage ? `${opts.systemMessage}\n\nבקשת המשתמש:\n${prompt}` : prompt;
  const toBlob = (base64: string, mime: string) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    return new Blob([bytes], { type: mime || 'image/png' });
  };
  const extFor = (mime: string) => {
    const m = mime || 'image/png';
    return m.includes('jpeg') ? 'jpg' : m.includes('webp') ? 'webp' : 'png';
  };
  const references = opts.references ?? [];
  const buildForm = () => {
    const form = new FormData();
    form.append('model', model);
    form.append('prompt', finalPrompt);
    if (references.length > 0) {
      // With references the image[] array form is required; the first image is
      // the one being edited and the rest supply content to blend in.
      form.append('image[]', toBlob(sourceBase64, sourceMime), `source.${extFor(sourceMime)}`);
      for (const [idx, ref] of references.entries()) {
        form.append('image[]', toBlob(ref.base64, ref.mime), `reference-${idx + 1}.${extFor(ref.mime)}`);
      }
    } else {
      form.append('image', toBlob(sourceBase64, sourceMime), `source.${extFor(sourceMime)}`);
    }
    if (opts.size) form.append('size', opts.size);
    form.append('n', '1');
    return form;
  };
  const res = await openAiFetch(
    `${API}/images/edits`,
    () => ({ method: 'POST', headers: { Authorization: `Bearer ${key()}` }, body: buildForm() }),
    'image edit',
  );
  const data = await res.json();
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI image edit returned no data');
  return { base64: b64, mime: 'image/png', model };
}

// Map a mime/filename to an extension OpenAI's transcription API accepts.
// (Supported: flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm. WhatsApp sends
// .opus which is an Ogg/Opus container, so we present it to OpenAI as .ogg.)
function transcriptionExt(mime: string, filename: string): string {
  const supported = new Set(['flac', 'mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'ogg', 'wav', 'webm']);
  const nameExt = (filename.split('.').pop() ?? '').toLowerCase();
  if (nameExt === 'opus') return 'ogg';
  if (supported.has(nameExt)) return nameExt;
  const m = (mime || '').toLowerCase();
  if (m.includes('opus') || m.includes('ogg')) return 'ogg';
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a';
  if (m.includes('wav')) return 'wav';
  if (m.includes('webm')) return 'webm';
  if (m.includes('flac')) return 'flac';
  return 'mp3';
}

// Transcribe an uploaded audio file with an OpenAI transcription model
// (gpt-4o-transcribe / gpt-4o-mini-transcribe / whisper-1). The model is
// chosen in the admin settings; falls back to gpt-4o-transcribe.
export async function transcribeAudio(
  base64: string,
  mime: string,
  filename: string,
  opts: { model?: string } = {}
): Promise<{ text: string }> {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const ext = transcriptionExt(mime, filename);
  // OpenAI rejects an empty/opus mime; normalize the ogg family to audio/ogg.
  const safeMime = ext === 'ogg' ? 'audio/ogg' : mime || 'audio/mpeg';
  const buildForm = () => {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: safeMime }), `audio.${ext}`);
    form.append('model', opts.model || 'gpt-4o-transcribe');
    return form;
  };
  const res = await openAiFetch(
    `${API}/audio/transcriptions`,
    () => ({ method: 'POST', headers: { Authorization: `Bearer ${key()}` }, body: buildForm() }),
    'transcription',
  );
  const data = await res.json();
  return { text: (data.text as string) ?? '' };
}

// Describe an uploaded image with a vision model so the agent can "understand"
// it. Returns a detailed Hebrew description used as context in the chat.
export async function describeImage(
  base64: string,
  mime: string,
  opts: { model?: string } = {}
): Promise<{ text: string; usage: ChatUsage }> {
  const res = await openAiFetch(
    `${API}/chat/completions`,
    () => ({
      method: 'POST',
      headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: opts.model || 'gpt-4o',
        temperature: 0.2,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'תאר בעברית ובפירוט מה רואים בתמונה: טקסט שמופיע בה, אובייקטים, אנשים, צבעים, סגנון עיצובי וכל פרט שעשוי לעזור להבין את כוונת המשתמש. אם יש טקסט בתמונה — שכתב אותו במדויק.',
              },
              { type: 'image_url', image_url: { url: `data:${mime || 'image/png'};base64,${base64}` } },
            ],
          },
        ],
      }),
    }),
    'vision',
  );
  const data = await res.json();
  return {
    text: (data.choices?.[0]?.message?.content as string) ?? '',
    usage: data.usage ?? { prompt_tokens: 0, completion_tokens: 0 },
  };
}

export async function runQa(systemPrompt: string, brief: unknown, outputDescription: string) {
  const { content, usage } = await chat(
    [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `בצע QA עצמאי על התוצר. בדוק: התאמה לבריף, עברית תקינה, אין מידע מומצא, התוצר ברור ומתאים לסוג שנבחר, אין תוכן אסור.
בדוק במיוחד את הפרדת המוח העסקי:
- business_content_context הוא מקור לתוכן בלבד: עובדות, מסרים, שירותים וניסוחים.
- brand_guidelines / אזור העיצוב הם המקור היחיד לצבעים, סגנון, קומפוזיציה, לוגו והשראה ויזואלית.
- אם נראה שהתוצר העתיק עיצוב, צבעים, מבנה עמוד או סגנון ממסמך תוכן בלבד — סמן ככישלון.
אם output_type הוא pdf/מסמך: התוצר חייב להיות מסמך סופי לעבודה, לא בריף ולא הנחיות למעצב. סמן ככישלון אם יש בו placeholders כמו "[נדרש קלט]", "נדרש קלט", "Footer", "צבעי מותג", "הנחיות עיצוב", או הערות מטא על מה צריך להשלים לפני הפצה.
אם output_type הוא pdf/מסמך: סמן ככישלון אם המסמך קצר מעמוד מלא אחד, פחות מ-550 מילים בעברית, או אם הוא משמיט מידע רלוונטי לאירוע/נושא שהופיע בבריף.
בריף:\n${JSON.stringify(brief)}
תיאור התוצר:\n${outputDescription}
החזר JSON בלבד: {"passed": true|false, "issues": ["..."], "notes": "..."}`,
      },
    ],
    { json: true, temperature: 0 }
  );
  let qa: { passed: boolean; issues: string[]; notes?: string } = { passed: true, issues: [] };
  try {
    qa = JSON.parse(content);
  } catch {
    qa = { passed: false, issues: ['QA parse error'] };
  }
  return { qa, usage };
}

// Vision-based QA for a generated image: the model ACTUALLY sees the rendered
// PNG and reviews it against the brief, instead of guessing from a text
// description (which forced an "I couldn't inspect it → fail" loop). Used for
// both QA layers on images so Rule 4 (two-layer QA) is real, not theatre.
export async function reviewImageQa(
  systemPrompt: string,
  brief: unknown,
  base64: string,
  mime: string
): Promise<{ qa: { passed: boolean; issues: string[]; notes?: string }; usage: ChatUsage }> {
  const res = await openAiFetch(
    `${API}/chat/completions`,
    () => ({
    method: 'POST',
    headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `בצע QA על התמונה המצורפת מול הבריף. אתה רואה את התמונה בפועל — אל תכתוב "לא ניתן לבדוק"; קבע על סמך מה שאתה רואה.
בדוק: כל הפריטים מ-"חייב לכלול" מופיעים ונכונים (תאריך/שם/אירוע), עברית תקינה ומאויתת נכון, יישור RTL (טקסט ואייקונים מימין), התאמה לפלטת הצבעים והסגנון של המותג, ואין מידע מומצא.
בריף:\n${JSON.stringify(brief)}
החזר JSON בלבד: {"passed": true|false, "issues": ["..."], "notes": "..."}`,
            },
            { type: 'image_url', image_url: { url: `data:${mime || 'image/png'};base64,${base64}` } },
          ],
        },
      ],
    }),
    }),
    'vision QA',
  );
  const data = await res.json();
  const usage = data.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
  let qa: { passed: boolean; issues: string[]; notes?: string } = { passed: true, issues: [] };
  try {
    qa = JSON.parse(data.choices?.[0]?.message?.content ?? '{}');
  } catch {
    qa = { passed: false, issues: ['QA parse error'] };
  }
  return { qa, usage };
}
