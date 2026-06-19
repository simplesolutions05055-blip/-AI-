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

export async function generatePresentationOutline(systemPrompt: string, brief: unknown) {
  const { content, usage } = await chat(
    [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `אנחנו לא מייצרים PPTX. הפק מבנה מצגת בעברית RTL הכולל: כותרת לכל שקף, תוכן מלא לכל שקף, הנחיות עיצוב, ו-Prompt מוכן להדבקה ב-NotebookLM. בריף:\n${JSON.stringify(
          brief,
          null,
          2
        )}`,
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
