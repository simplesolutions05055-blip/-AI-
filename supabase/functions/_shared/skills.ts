import type { DB } from './db.ts';
import { routeSkillsLLM } from './openai.ts';

export type SkillStage = 'brief' | 'image' | 'presentation' | 'text' | 'qa1' | 'qa2';

export interface SkillContext {
  outputType?: string | null;
  clientType?: string | null;
  // Extra skill keys chosen by the LLM router (hybrid layer).
  extraKeys?: string[];
}

interface SkillRow {
  key: string;
  category: string;
  order_index: number;
  applies_to: { stages?: string[]; output_types?: string[]; client_types?: string[] } | null;
}

// A condition list matches when: unspecified/empty (= any), contains '*', the
// actual value is unknown (don't exclude), or it explicitly contains the value.
function condMatches(vals: string[] | undefined, actual: string | null | undefined): boolean {
  if (!Array.isArray(vals) || vals.length === 0) return true;
  if (vals.includes('*')) return true;
  if (actual == null) return true;
  return vals.includes(actual);
}

/**
 * Deterministic selector. Returns the enabled skills relevant to the given
 * stage + context, ordered by order_index. Rules always qualify (subject to
 * their own client/output conditions); non-rule skills need an explicit stage
 * match. extraKeys (from the LLM router) are unioned in.
 */
export async function selectSkills(database: DB, stage: SkillStage, ctx: SkillContext): Promise<SkillRow[]> {
  const { data } = await database
    .from('skills')
    .select('key, category, order_index, applies_to, enabled')
    .eq('enabled', true)
    .order('order_index');
  const rows = (data ?? []) as unknown as (SkillRow & { enabled: boolean })[];
  const extra = new Set(ctx.extraKeys ?? []);

  return rows.filter((s) => {
    const a = s.applies_to ?? {};
    const isRule = s.category === 'rule';
    const stageOk = isRule
      ? true
      : extra.has(s.key) ||
        (Array.isArray(a.stages) && (a.stages.includes('*') || a.stages.includes(stage)));
    return stageOk && condMatches(a.output_types, ctx.outputType) && condMatches(a.client_types, ctx.clientType);
  });
}

/**
 * Builds a system-prompt fragment from the active versions of the skills the
 * selector deems relevant to `stage`+`ctx`, plus the qualifying rules. Returns
 * '' if nothing qualifies or on any error — never breaks the live pipeline.
 */
export async function buildSkillInstructions(
  database: DB,
  stage: SkillStage,
  ctx: SkillContext = {},
): Promise<string> {
  try {
    const selected = await selectSkills(database, stage, ctx);
    if (!selected.length) return '';

    const keys = selected.map((s) => s.key);
    const { data: versions } = await database
      .from('skill_versions')
      .select('skill_key, content')
      .eq('is_active', true)
      .in('skill_key', keys);
    if (!versions?.length) return '';

    const byKey = new Map<string, string>(
      (versions as { skill_key: string; content: string }[]).map((v) => [v.skill_key, v.content]),
    );

    const stageBlocks = selected
      .filter((s) => s.category !== 'rule')
      .map((s) => byKey.get(s.key))
      .filter(Boolean) as string[];
    const ruleBlocks = selected
      .filter((s) => s.category === 'rule')
      .map((s) => byKey.get(s.key))
      .filter(Boolean) as string[];

    const parts: string[] = [];
    if (stageBlocks.length) parts.push(stageBlocks.join('\n\n---\n\n'));
    if (ruleBlocks.length) parts.push('## חוקי ברזל (חלים על כל פעולה, ללא חריגים)\n\n' + ruleBlocks.join('\n\n'));
    if (!parts.length) return '';

    const header =
      '\n\n====================  הנחיות מחייבות מהמסמך המאוחד  ====================\n' +
      'ההנחיות הבאות (סקילים, סוכנים וחוקים) גוברות על כל הנחיה אחרת, וחלות על כל הודעה — ' +
      'במיוחד בהכנת בריף. אכוף את שדות החובה לכל סוג תוצר, שאל שאלת השלמה אחת כשחסר שדה קריטי, ' +
      'ואל תמציא נתונים שאינם במקור.\n' +
      '=======================================================================\n\n';

    const briefContract =
      stage === 'brief'
        ? '\n\n## חוזה פלט מחייב (גובר על כל הנחיה קודמת)\n' +
          '1. זהה את סוג התוצר המדויק (אירוע, מבצע/מכירה, הצעת מחיר, מצגת משקיעים, פוסט מוצר וכו\').\n' +
          '2. החזר שדה נוסף בשם "required_missing": מערך מחרוזות בעברית של שדות החובה לסוג התוצר שעדיין חסרים (לפי טבלת שדות החובה של whatsapp-brief-parser). לדוגמה לאירוע: ["תאריך האירוע", "מיקום מדויק"].\n' +
          '3. אם "required_missing" אינו ריק — אסור להחזיר ready_to_generate. החזר action=collecting_details עם שאלה אחת קצרה שמבקשת את השדות החסרים. זה גובר על כל הנחיה שאומרת "אם הסוג והנושא ברורים החזר מוכן".\n' +
          '4. אל תמציא ערכים לשדות חסרים — שאל עליהם.\n' +
          '5. חוק המותג (חוק 2) + אי-הבדיה (חוק 3): תוצר ויזואלי ממותג (תמונה/גרפיקה/פוסט) חייב להיות משויך ללקוח/רשות מזוהים שמהם נטענים לוגו, צבעי מותג מדויקים ופונט מאושר. אם לא זוהה לקוח/מותג בשיחה — אסור להמציא פלטת צבעים, טון, קהל או לוגו, ואסור להחזיר ready_to_generate. הוסף ל-required_missing את "שיוך ללקוח/מותג" ושאל: "לאיזה לקוח או רשות מיועד הקמפיין?".\n' +
          '6. אם הלקוח שזוהה הוא רשות מקומית/עירייה (חוק 9) — שפה רשמית בלבד, ללא סלנג, והקפדה על נגישות.\n'
        : '';

    return header + parts.join('\n\n') + briefContract;
  } catch (_e) {
    return '';
  }
}

/**
 * Hybrid router entry point: deterministic selection always applies; this adds
 * the LLM layer that picks extra relevant skill keys for an ambiguous request.
 * Returns the chosen keys (and detected subtype) to feed back as ctx.extraKeys.
 * Fails open to an empty result.
 */
export async function routeAmbiguousSkills(
  database: DB,
  text: string,
  model?: string,
): Promise<{ keys: string[]; subtype: string | null; usage: { prompt_tokens: number; completion_tokens: number } }> {
  try {
    const { data } = await database
      .from('skills')
      .select('key, display_name, description, enabled, category')
      .eq('enabled', true);
    const catalog = ((data ?? []) as { key: string; display_name: string; description: string | null; category: string }[])
      .filter((s) => s.category !== 'rule')
      .map((s) => ({ key: s.key, name: s.display_name, description: s.description ?? '' }));
    if (!catalog.length) return { keys: [], subtype: null, usage: { prompt_tokens: 0, completion_tokens: 0 } };
    return await routeSkillsLLM(catalog, text, model);
  } catch (_e) {
    return { keys: [], subtype: null, usage: { prompt_tokens: 0, completion_tokens: 0 } };
  }
}

// Hebrew date / time signals — used by the deterministic backstop below.
const DATE_HINTS =
  /(\d{1,2}[\/.\-]\d{1,2})|יום\s+(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)|מחר(תיים)?|היום|הערב|הלילה|בשעה|\d{1,2}:\d{2}|(ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר)|בתאריך|ה-?\d{1,2}\s+ב/;
// Output types that imply a dated event/sale, where a date is a required field.
const EVENT_HINTS =
  /(אירוע|פסטיבל|הרצא|כנס|השק[הת]|פתיח|יריד|מכיר[הת]|מבצע|הופע|טקס|סדנ|הפנינג|מצעד|תהלוכה|הזמנ)/;

/**
 * Deterministic brief gate. Runs AFTER the model replies and is the final
 * authority on whether a brief may proceed to generation:
 *  - blocks ready_to_generate whenever the model reports required_missing
 *  - code backstop: an event/sale with no date in the conversation is blocked
 *  - rules 2+3: a branded visual with no matched client/brand is blocked
 * Returns the (possibly adjusted) response object. Never throws.
 */
export function applyBriefSkillGate(
  resp: Record<string, unknown> | null | undefined,
  transcript: string,
  opts: { brandMatched?: boolean } = {},
): Record<string, unknown> | null | undefined {
  try {
    if (!resp || typeof resp !== 'object') return resp;
    const brief = (resp.brief as Record<string, unknown>) ?? {};
    const outputType = (brief.output_type as string) ?? (resp.output_type as string) ?? null;

    const missing: string[] = Array.isArray(resp.required_missing)
      ? (resp.required_missing as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : [];

    // Code backstop for the date — the highest-value, must-not-slip check.
    const hay = `${transcript}\n${JSON.stringify(brief)}`;
    const looksLikeEvent = EVENT_HINTS.test(hay);
    const hasDate = DATE_HINTS.test(hay);
    if ((outputType === 'image' || outputType === null) && looksLikeEvent && !hasDate) {
      if (!missing.some((m) => m.includes('תאריך'))) missing.push('תאריך האירוע');
    }

    // Rule 2 (branding) + Rule 3 (no fabrication): a branded visual deliverable
    // must be tied to an identified client/brand. If none matched, never invent
    // a palette/logo — ask which client instead.
    if (outputType === 'image' && opts.brandMatched === false) {
      if (!missing.some((m) => m.includes('מותג') || m.includes('לקוח'))) {
        missing.push('שיוך ללקוח/מותג (למשל: עיריית תל אביב)');
      }
    }

    if (missing.length === 0) return resp;

    const question = `כדי שאכין בריף מדויק חסר לי: ${missing.join(', ')}. אפשר להשלים?`;
    return {
      ...resp,
      action: 'collecting_details',
      ready: false,
      ready_for_generation: false,
      missing_fields: missing,
      required_missing: missing,
      message_to_user: question,
      brief: { ...brief, ready: false },
    };
  } catch (_e) {
    return resp;
  }
}
