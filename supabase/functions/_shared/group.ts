// WhatsApp group-bot layer. A group chat has ONE chat id but MANY senders, so
// each (group, sender) pair gets its own conversation — participants never
// share brief context. The composed routing target "group:<groupId>:<sender>"
// travels through the existing engine as the conversation's whatsapp_from, and
// the outbound layer (worker.ts sendOut / media senders) detects the prefix and
// ships replies to the GROUP via the GREEN-API gateway instead of Twilio.
//
// In a group the bot answers ONLY messages that start with the trigger word
// (e.g. "גרפיקה תכין לי פוסט" or "@גרפיקה ...") — everything else is ignored,
// otherwise the bot would butt into every human conversation.
import { type DB } from './db.ts';
import { getSettingOr } from './util.ts';
import { sendFile, sendText } from './greenapi.ts';

export type GroupSettings = { enabled: boolean; trigger_word: string };

export async function getGroupSettings(database: DB): Promise<GroupSettings> {
  const s = await getSettingOr<GroupSettings>(database, 'whatsapp_group_settings', {
    enabled: false,
    trigger_word: 'גרפיקה',
  });
  return { enabled: s.enabled === true, trigger_word: (s.trigger_word || 'גרפיקה').trim() };
}

// "גרפיקה תכין פוסט" / "@גרפיקה, תכין פוסט" → { matched: true, rest: "תכין פוסט" }
// "מה השעה חברים?" → { matched: false }. Case-insensitive, tolerates @, and
// separator punctuation right after the trigger. A bare trigger ("גרפיקה") maps
// to a greeting so the main menu opens.
export function matchGroupTrigger(body: string, triggerWord: string): { matched: boolean; rest: string } {
  const text = (body ?? '').trim();
  const trigger = triggerWord.trim();
  if (!text || !trigger) return { matched: false, rest: '' };
  const lower = text.toLowerCase();
  const wanted = trigger.toLowerCase();
  let offset = 0;
  if (lower.startsWith('@')) offset = 1;
  if (!lower.slice(offset).startsWith(wanted)) return { matched: false, rest: '' };
  let rest = text.slice(offset + trigger.length);
  // The trigger must end at a word boundary ("גרפיקה," yes, "גרפיקהX" no).
  if (rest && !/^[\s,.:;!?\-–—]/.test(rest)) return { matched: false, rest: '' };
  rest = rest.replace(/^[\s,.:;!?\-–—]+/, '').trim();
  return { matched: true, rest: rest || 'היי' };
}

// ── composed routing target ────────────────────────────────────────────────
// groupId is WhatsApp-style ("120363...@g.us" — never contains ':'); sender is
// digits only. Splitting on ':' is therefore unambiguous.
export function groupTarget(groupId: string, sender: string): string {
  return `group:${groupId}:${sender}`;
}

// Simulated brand group: ONE persistent group chat per brand, shared by every
// user assigned to that brand. Rehearses the real-group experience before a
// real number exists. UUIDs contain no ':' so the composed target stays parseable.
export function brandGroupId(brandId: string): string {
  return `brand-${brandId}@sim.group`;
}

export function isGroupTarget(to: string): boolean {
  return to.startsWith('group:');
}

export function parseGroupTarget(to: string): { groupId: string; sender: string } | null {
  if (!isGroupTarget(to)) return null;
  const [, groupId, sender = ''] = to.split(':');
  return groupId ? { groupId, sender } : null;
}

// One conversation per (group, sender). whatsapp_from carries the composed
// target so findOrCreateConversation-style lookups and the outbound layer both
// work off the same string; group_id/group_sender make admin queries sane.
export async function findOrCreateGroupConversation(
  database: DB,
  groupId: string,
  sender: string,
  simulated: boolean,
  // When the sender is already a known site user (brand-group simulator), link
  // the conversation up front so resolveIdentity picks their name + brand.
  userId?: string | null
) {
  const from = groupTarget(groupId, sender);
  const { data: existing } = await database
    .from('conversations')
    .select('*')
    .eq('whatsapp_from', from)
    .in('status', ['active', 'waiting_for_user', 'soft_closed'])
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return existing;
  const { data: created } = await database
    .from('conversations')
    .insert({
      whatsapp_from: from, status: 'active', simulated,
      group_id: groupId, group_sender: sender,
      ...(userId ? { user_id: userId } : {}),
    })
    .select()
    .single();
  return created ?? null;
}

// ── group senders (real groups only — simulated never reaches here) ──────────
// A group id IS a GREEN-API chatId ("120363...@g.us"), so these are thin
// aliases over the shared client. See greenapi.ts for the credential contract.
export async function sendGroupText(groupId: string, body: string): Promise<string> {
  return await sendText(groupId, body);
}

export async function sendGroupMedia(groupId: string, mediaUrl: string, caption?: string): Promise<string> {
  return await sendFile(groupId, mediaUrl, caption);
}
