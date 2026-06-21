// OpenAI access for Edge Functions — reads OPENAI_API_KEY from Supabase secrets.
const API = 'https://api.openai.com/v1';

const key = () => {
  const k = Deno.env.get('OPENAI_API_KEY');
  if (!k) throw new Error('Missing OPENAI_API_KEY (Supabase secret)');
  return k;
};
const textModel = () => Deno.env.get('OPENAI_TEXT_MODEL') || 'gpt-4o';
const imageModel = () => Deno.env.get('OPENAI_IMAGE_MODEL') || 'gpt-image-2';

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
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
  opts: { json?: boolean; temperature?: number; model?: string } = {}
): Promise<{ content: string; usage: ChatUsage }> {
  const res = await fetch(`${API}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: opts.model || textModel(),
      messages,
      temperature: opts.temperature ?? 0.5,
      ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`OpenAI chat ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return {
    content: data.choices?.[0]?.message?.content ?? '',
    usage: data.usage ?? { prompt_tokens: 0, completion_tokens: 0 },
  };
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
  roundsRemaining: number
) {
  const instruction = `${systemPrompt}

נתח את כל ההודעות מהמשתמש שלהלן והפק JSON בלבד במבנה:
{
  "output_type": "text|image|pdf|presentation|null",
  "goal": "...", "audience": "...", "language": "עברית",
  "must_include": ["..."], "style": "...", "source_materials": "...",
  "dimensions": "...", "customer_email": "...",
  "color_override": "...",
  "ready": true|false, "missing": ["שדות חסרים"],
  "next_question": "השאלה הבאה בעברית או null אם הבריף מוכן"
}
נותרו ${roundsRemaining} סבבי שאלות. אם נגמרו הסבבים, סמן ready=true עם המידע הקיים.
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
    { json: true, temperature: 0.3 }
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

// Generate rich, marketing-grade slide content (exactly 10 slides) as
// structured JSON, expanding the brief/user input into a full deck.
export async function generateDeckSlides(systemPrompt: string, brief: unknown) {
  const { content, usage } = await chat(
    [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `אתה כותב תוכן שיווקי מקצועי בעברית. הפק מצגת אינפורמטיבית ומשכנעת של בדיוק 10 שקפים על בסיס הבריף. הרחב את מה שנמסר לתוכן מלא, עשיר ומעשי — אל תכתוב משפטים ריקים או כלליים. כל שקף חייב להיות אינפורמטיבי ובעל ערך.
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
דרישות: בדיוק 10 שקפים. שקף 1 = פתיחה/כותרת. שקף אחרון = סיכום + קריאה לפעולה. 3-5 נקודות מהותיות בכל שקף תוכן. עברית RTL, טון מותאם לקהל היעד שבבריף. אל תמציא עובדות, נתונים, שמות או תאריכים שלא נמסרו.
בריף:\n${JSON.stringify(brief, null, 2)}`,
      },
    ],
    { json: true, temperature: 0.7 }
  );
  let parsed: { slides?: unknown[] } = {};
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = { slides: [] };
  }
  const slides = Array.isArray(parsed.slides) ? parsed.slides : [];
  return { slides, usage };
}

export async function generateText(systemPrompt: string, brief: unknown, note?: string) {
  const { content, usage } = await chat(
    [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `הפק תוצר טקסטואלי מלא בעברית לפי הבריף הבא:\n${JSON.stringify(brief, null, 2)}${
          note ? `\n\nהערת תיקון מהמנהל: ${note}` : ''
        }`,
      },
    ],
    { temperature: 0.7 }
  );
  return { text: content, usage };
}

export async function generatePresentationOutline(
  systemPrompt: string,
  brief: unknown,
  assetsNote?: string
) {
  const assetInstruction = assetsNote
    ? `\n\nתמונות מהמיתוג של העיר (קישורים זמינים להורדה ישירה):\n${assetsNote}\nשבץ את התמונות הרלוונטיות בשקפים המתאימים: לכל שקף שבו משובצת תמונה, ציין במפורש את כותרת/תיאור התמונה ואת הקישור המלא שלה, כדי שניתן יהיה להוריד ולהכניס אותה למצגת ב-NotebookLM. אל תמציא קישורים — השתמש אך ורק בקישורים שסופקו.`
    : '';
  const { content, usage } = await chat(
    [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `אנחנו לא מייצרים PPTX. הפק מבנה מצגת בעברית RTL הכולל: כותרת לכל שקף, תוכן מלא לכל שקף, הנחיות עיצוב, ו-Prompt מוכן להדבקה ב-NotebookLM. בריף:\n${JSON.stringify(
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
  const res = await fetch(`${API}/images/generations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: finalPrompt,
      size: opts.size || '1024x1024',
      quality: opts.quality || 'auto',
      n: 1,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI image ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI image returned no data');
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
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: safeMime }), `audio.${ext}`);
  form.append('model', opts.model || 'gpt-4o-transcribe');
  const res = await fetch(`${API}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key()}` },
    body: form,
  });
  if (!res.ok) throw new Error(`OpenAI transcription ${res.status}: ${await res.text()}`);
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
  const res = await fetch(`${API}/chat/completions`, {
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
  });
  if (!res.ok) throw new Error(`OpenAI vision ${res.status}: ${await res.text()}`);
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
  const res = await fetch(`${API}/chat/completions`, {
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
  });
  if (!res.ok) throw new Error(`OpenAI vision QA ${res.status}: ${await res.text()}`);
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
