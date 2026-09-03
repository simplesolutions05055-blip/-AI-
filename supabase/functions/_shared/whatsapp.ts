// WhatsApp transport — the ONE module the engine imports.
//
// Smart Send is the only gateway. The former Twilio transport has been removed
// from the repository entirely, so there is no provider switch and no
// environment variable that can route sends anywhere else.
//
// Provider note: Smart Send cannot post into a WhatsApp group; group sends
// throw rather than fail silently.
import * as smartsend from './smartsend.ts';
import { db } from './db.ts';

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

export async function sendFile(
  to: string,
  mediaUrl: string,
  caption?: string,
  ctx?: smartsend.TemplateContext,
): Promise<string> {
  assertNotGroup(to, 'send media');
  await assertRecentInbound(to);
  return await smartsend.sendFile(to, mediaUrl, caption, ctx);
}

/**
 * Build the media-template parameters (client name, request number) for a
 * request. Falls back to the phone digits when no profile name is on file.
 * Returns undefined only when the request row is gone.
 */
export async function templateContextFor(
  to: string,
  requestId: string | null,
): Promise<smartsend.TemplateContext | undefined> {
  if (!requestId) return undefined;
  const database = db();
  const { data: request } = await database
    .from('requests')
    .select('request_number, created_by')
    .eq('id', requestId)
    .maybeSingle();
  if (!request) return undefined;

  let clientName = smartsend.toPhone(to);
  if (request.created_by) {
    const { data: profile } = await database
      .from('profiles')
      .select('full_name')
      .eq('id', request.created_by)
      .maybeSingle();
    const first = (profile?.full_name as string | null ?? '').trim().split(/\s+/)[0];
    if (first) clientName = first;
  }
  return {
    clientName,
    requestNumber: request.request_number ? `#${request.request_number}` : '—',
  };
}

// Inbound media. Smart Send hands us a downloadable URL on the webhook.
export async function downloadMedia(
  mediaUrl: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  return await smartsend.downloadMedia(mediaUrl);
}
