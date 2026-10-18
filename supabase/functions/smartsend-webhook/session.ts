// Conversation memory per phone: the last result, a brief waiting for a yes, recent photos, approvals waiting.
import type { DB } from './common.ts';

export async function sessionOf(d: DB, phone: string) {
  const { data } = await d.from('v2_wa_sessions').select('*').eq('phone', phone).maybeSingle();
  return (data?.state ?? {}) as Record<string, any>;
}
export async function remember(d: DB, phone: string, patch: Record<string, unknown>, ids?: { org_id: string; member_id: string }) {
  const cur = await sessionOf(d, phone);
  const next: Record<string, unknown> = { ...cur, ...patch };
  for (const k of Object.keys(patch)) if (patch[k] === null) delete next[k];
  await d.from('v2_wa_sessions').upsert({ phone, ...(ids ?? {}), state: next, updated_at: new Date().toISOString() });
  return next;
}
