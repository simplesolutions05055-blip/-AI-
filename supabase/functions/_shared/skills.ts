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

    return (
      '\n\n====================  הנחיות מחייבות מהמסמך המאוחד  ====================\n' +
      'ההנחיות הבאות (סקילים, סוכנים וחוקים) גוברות על כל הנחיה אחרת, וחלות על כל הודעה — ' +
      'במיוחד בהכנת בריף. אכוף את שדות החובה לכל סוג תוצר, שאל שאלת השלמה אחת כשחסר שדה קריטי, ' +
      'ואל תמציא נתונים שאינם במקור.\n' +
      '=======================================================================\n\n' +
      parts.join('\n\n')
    );
  } catch (_e) {
    return '';
  }
}
