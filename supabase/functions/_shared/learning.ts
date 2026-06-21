import type { DB } from './db.ts';
import { extractRuleLLM } from './openai.ts';

// ── Skill 10 — Learning Agent ───────────────────────────────────────────────

/** Inject a client's learned rules into a brief/QA prompt. '' if none. */
export async function loadLearnedRules(database: DB, brandId: string | null): Promise<string> {
  if (!brandId) return '';
  try {
    const { data } = await database
      .from('brand_learned_rules')
      .select('rule_text')
      .eq('brand_id', brandId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(40);
    const rules = ((data ?? []) as { rule_text: string }[]).map((r) => r.rule_text).filter(Boolean);
    if (!rules.length) return '';
    return (
      '\n\n## כללים שנלמדו מתיקוני הלקוח (סקיל 10 — חובה לאכוף)\n' +
      'אלה כללים שנגזרו מתיקונים קודמים של אותו לקוח. אסור לחזור על הטעויות האלה:\n' +
      rules.map((r) => `- ${r}`).join('\n')
    );
  } catch {
    return '';
  }
}

/** Convert a correction comment into a rule and store it for the brand. */
export async function extractAndStoreRule(
  database: DB,
  brandId: string,
  comment: string,
  contentType?: string | null,
): Promise<void> {
  try {
    if (!comment?.trim()) return;
    const { rule } = await extractRuleLLM(comment);
    if (!rule) return;
    const { data: existing } = await database
      .from('brand_learned_rules')
      .select('id')
      .eq('brand_id', brandId)
      .eq('rule_text', rule)
      .eq('is_active', true)
      .limit(1);
    if (existing?.length) return; // de-dupe identical rules
    await database.from('brand_learned_rules').insert({
      brand_id: brandId,
      rule_text: rule,
      source_comment: comment.slice(0, 2000),
      content_type: contentType ?? null,
    });
  } catch {
    /* learning must never break the pipeline */
  }
}

// ── Rule 5 — Template Lock ───────────────────────────────────────────────────

export async function loadActiveTemplateLock(
  database: DB,
  brandId: string | null,
  contentType: string | null,
): Promise<Record<string, unknown> | null> {
  if (!brandId || !contentType) return null;
  try {
    const { data } = await database
      .from('template_locks')
      .select('template_json')
      .eq('brand_id', brandId)
      .eq('content_type', contentType)
      .eq('is_active', true)
      .maybeSingle();
    return (data?.template_json as Record<string, unknown>) ?? null;
  } catch {
    return null;
  }
}

export function buildTemplateLockBlock(lock: Record<string, unknown> | null): string {
  if (!lock || Object.keys(lock).length === 0) return '';
  return (
    '\n\n## תבנית נעולה (חוק 5 — אחידות)\n' +
    'קיימת תבנית מאושרת ללקוח זה לסוג התוצר. השתמש בה כברירת מחדל, אלא אם הלקוח ביקש סטייה מפורשת:\n' +
    JSON.stringify(lock)
  );
}

/**
 * Lock a template once the last 3 same-type deliveries for the client were
 * approved with zero change rounds (rule 5). No-op if already locked.
 */
export async function maybeLockTemplate(
  database: DB,
  brandId: string | null,
  contentType: string | null,
  briefSnapshot: Record<string, unknown>,
): Promise<void> {
  if (!brandId || !contentType) return;
  try {
    const { data: existing } = await database
      .from('template_locks')
      .select('id')
      .eq('brand_id', brandId)
      .eq('content_type', contentType)
      .eq('is_active', true)
      .limit(1);
    if (existing?.length) return;

    const { data: recent } = await database
      .from('requests')
      .select('id, revision_round')
      .eq('brand_id', brandId)
      .eq('output_type', contentType)
      .in('status', ['sent', 'approved'])
      .order('created_at', { ascending: false })
      .limit(3);
    const rows = (recent ?? []) as { id: string; revision_round: number | null }[];
    if (rows.length < 3) return;
    if (rows.some((r) => (r.revision_round ?? 0) > 0)) return; // a change broke the streak

    const template = {
      style: briefSnapshot.style ?? null,
      dimensions: briefSnapshot.dimensions ?? null,
      must_include: briefSnapshot.must_include ?? null,
      layout: briefSnapshot.layout ?? null,
    };
    await database.from('template_locks').insert({
      brand_id: brandId,
      content_type: contentType,
      template_json: template,
      locked_from: rows.map((r) => r.id),
    });
  } catch {
    /* never break the pipeline */
  }
}
