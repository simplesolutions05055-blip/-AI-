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

export async function runAgentChat(
  systemPrompt: string,
  transcript: string,
  opts: { model?: string; questionRound?: number } = {}
) {
  const instruction = `${systemPrompt}

הקשר מערכת:
question_round הנוכחי הוא ${opts.questionRound ?? 0}.
נתח את שיחת WhatsApp הבאה והחזר JSON בלבד לפי הפורמט שהוגדר ב־System Message.
בקשת בריף/עיצוב/פוסט/תמונה עבור אירוע קהילתי, עירוני, פעילות ילדים או חירום אזרחי היא מותרת כברירת מחדל. אל תחסום בגלל המילה "חירום" בלבד; חסום רק אם יש בקשה להוראות מזיקות, הטעיה, פאניקה, התחזות או פעולה בלתי חוקית.`;

  const { content, usage } = await chat(
    [
      { role: 'system', content: instruction },
      { role: 'user', content: transcript },
    ],
    { json: true, temperature: 0.2, model: opts.model }
  );

  try {
    return { response: JSON.parse(content), usage };
  } catch {
    return {
      response: {
        action: 'needs_attention',
        message_to_user: 'לא הצלחנו להבין את הבקשה כרגע. הבקשה הועברה לבדיקה.',
        brief: { output_type: null },
        missing_fields: [],
        question_round: opts.questionRound ?? 0,
        ready_for_generation: false,
        safety: { status: 'needs_review', reason: 'invalid_json_response' },
        recommended_review: 'manual',
        internal_notes: 'Model returned invalid JSON',
      },
      usage,
    };
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
  "ready": true|false, "missing": ["שדות חסרים"],
  "next_question": "השאלה הבאה בעברית או null אם הבריף מוכן"
}
נותרו ${roundsRemaining} סבבי שאלות. אם נגמרו הסבבים, סמן ready=true עם המידע הקיים.
שאל שאלה אחת ממוקדת בלבד אם חסר מידע מהותי.`;

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
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mime || 'audio/mpeg' }), filename || 'audio');
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
        content: `בצע QA על התוצר. בדוק: התאמה לבריף, עברית תקינה, אין מידע מומצא, התוצר ברור ומתאים לסוג שנבחר, אין תוכן אסור.
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
