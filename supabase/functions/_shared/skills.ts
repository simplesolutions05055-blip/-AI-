import type { DB } from './db.ts';

// Maps each pipeline stage to the skill/agent keys that govern it. Rules
// (category 'rule') are always injected on top of every stage — they are
// guardrails that apply to every message, per the unified spec.
const STAGE_SKILLS: Record<string, string[]> = {
  brief: ['whatsapp-brief-parser', 'agent-brief-intake', 'agent-business-brain'],
  image: ['social-graphics-engine', 'brand-compliance-qa', 'agent-generation'],
  presentation: ['presentation-doc-engine', 'brand-compliance-qa', 'agent-generation'],
  text: ['presentation-doc-engine', 'brand-compliance-qa', 'agent-generation'],
  qa: ['brand-compliance-qa', 'independent-qa-reviewer', 'agent-qa1', 'agent-qa2'],
};

export type SkillStage = keyof typeof STAGE_SKILLS;

/**
 * Builds a system-prompt fragment from the active versions of the skills that
 * govern `stage`, plus every enabled rule. Returns '' if nothing is enabled or
 * on any error — it must never break the live chat/worker pipeline.
 */
export async function buildSkillInstructions(database: DB, stage: SkillStage): Promise<string> {
  try {
    const stageKeys = STAGE_SKILLS[stage] ?? [];

    const { data: skills } = await database
      .from('skills')
      .select('key, category, enabled, order_index')
      .eq('enabled', true)
      .order('order_index');
    if (!skills?.length) return '';

    const wanted = skills.filter(
      (s: { key: string; category: string }) => stageKeys.includes(s.key) || s.category === 'rule',
    );
    if (!wanted.length) return '';

    const wantedKeys = wanted.map((s: { key: string }) => s.key);
    const { data: versions } = await database
      .from('skill_versions')
      .select('skill_key, content')
      .eq('is_active', true)
      .in('skill_key', wantedKeys);
    if (!versions?.length) return '';

    const byKey = new Map<string, string>(
      versions.map((v: { skill_key: string; content: string }) => [v.skill_key, v.content]),
    );

    // Stage skills first (in declared order), then rules (by order_index).
    const stageBlocks = stageKeys.map((k) => byKey.get(k)).filter(Boolean) as string[];
    const ruleBlocks = wanted
      .filter((s: { category: string }) => s.category === 'rule')
      .map((s: { key: string }) => byKey.get(s.key))
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

    // The brief stage gets an explicit, authoritative output contract so the
    // skill's required-fields table actually overrides the base "jump to ready"
    // instruction. The model must compute required_missing from the active
    // whatsapp-brief-parser table; code then hard-blocks on it.
    const briefContract =
      stage === 'brief'
        ? '\n\n## חוזה פלט מחייב (גובר על כל הנחיה קודמת)\n' +
          '1. זהה את סוג התוצר המדויק (אירוע, מבצע/מכירה, הצעת מחיר, מצגת משקיעים, פוסט מוצר וכו\').\n' +
          '2. החזר שדה נוסף בשם "required_missing": מערך מחרוזות בעברית של שדות החובה לסוג התוצר שעדיין חסרים (לפי טבלת שדות החובה של whatsapp-brief-parser). לדוגמה לאירוע: ["תאריך האירוע", "מיקום מדויק"].\n' +
          '3. אם "required_missing" אינו ריק — אסור להחזיר ready_to_generate. החזר action=collecting_details עם שאלה אחת קצרה שמבקשת את השדות החסרים. זה גובר על כל הנחיה שאומרת "אם הסוג והנושא ברורים החזר מוכן".\n' +
          '4. אל תמציא ערכים לשדות חסרים — שאל עליהם.\n'
        : '';

    return header + parts.join('\n\n') + briefContract;
  } catch (_e) {
    return '';
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
 *    and a date question is asked, even if the model tried to skip it
 * Returns the (possibly adjusted) response object. Never throws.
 */
export function applyBriefSkillGate(
  resp: Record<string, unknown> | null | undefined,
  transcript: string,
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
