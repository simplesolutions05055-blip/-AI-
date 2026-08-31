// WhatsApp transport switch — the ONE module the engine imports.
//
// Smart Send is the only live gateway. The old Twilio and GREEN-API modules stay
// in the repository as dead historical code, but this switch deliberately has
// no route to them. Changing an environment variable cannot reactivate them.
//
// Provider differences the caller must know about:
//   * GROUPS — GREEN-API can post into a WhatsApp group ("<id>@g.us"); the
//     Twilio Business API cannot. Group sends throw under 'twilio' instead of
//     failing silently, and the group webhook path only exists on GREEN-API.
//   * 24h WINDOW — Twilio may only send free-form text inside the 24-hour
//     service window opened by the user's last inbound message. Outside it
//     Meta rejects the send and only an approved template goes through.
import * as smartsend from './smartsend.ts';
import { db } from './db.ts';

export type WhatsAppProvider = 'smartsend';

export function whatsappProvider(): WhatsAppProvider {
  return 'smartsend';
}

function assertNotGroup(to: string, what: string) {
  if (to.endsWith('@g.us') || to.startsWith('group:')) {
    throw new Error(
      `Smart Send provider cannot ${what} to a WhatsApp group`,
    );
  }
}

export const CUSTOMER_SERVICE_WINDOW_HOURS = 23;

/**
 * Fail-closed outbound safety gate.
 *
 * Free-form WhatsApp messages are allowed only after this exact recipient sent
 * an inbound message during our stricter 23-hour window. Provider/API success
 * is never used as permission: missing rows and database errors both block.
 */
export async function assertRecentInbound(to: string, now = new Date()): Promise<void> {
  const phone = smartsend.toPhone(to);
  const canonicalTarget = `whatsapp:+${phone}`;
  const database = db();
  const { data: conversations, error: conversationError } = await database
    .from('conversations')
    .select('id')
    .eq('whatsapp_from', canonicalTarget);

  if (conversationError) {
    throw new Error('WhatsApp 23h safety check failed - send blocked');
  }
  const conversationIds = (conversations ?? []).map((row) => row.id as string);
  if (!conversationIds.length) {
    throw new Error('WhatsApp 23h window closed - send blocked');
  }

  const cutoff = new Date(now.getTime() - CUSTOMER_SERVICE_WINDOW_HOURS * 60 * 60 * 1000)
    .toISOString();
  const { data: recentInbound, error: messageError } = await database
    .from('messages')
    .select('id')
    .in('conversation_id', conversationIds)
    .eq('direction', 'inbound')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (messageError) {
    throw new Error('WhatsApp 23h safety check failed - send blocked');
  }
  if (!recentInbound) {
    throw new Error('WhatsApp 23h window closed - send blocked');
  }
}

export async function sendText(to: string, body: string): Promise<string> {
  assertNotGroup(to, 'send text');
  await assertRecentInbound(to);
  return await smartsend.sendText(to, body);
}

export async function sendFile(to: string, mediaUrl: string, caption?: string): Promise<string> {
  assertNotGroup(to, 'send media');
  await assertRecentInbound(to);
  return await smartsend.sendFile(to, mediaUrl, caption);
}

// Inbound media. Under GREEN-API the notification carries a public downloadUrl;
// under Twilio the MediaUrl needs the account's basic auth.
export async function downloadMedia(
  mediaUrl: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  return await smartsend.downloadMedia(mediaUrl);
}

// Channel health, in GREEN-API's vocabulary so the existing
// `greenapi_instance_state` setting, alerting and admin UI keep working:
// 'authorized' means the gateway answers and the sender is usable.
export async function getChannelState(): Promise<string> {
  return await smartsend.getState();
}
