// WhatsApp transport switch — the ONE module the engine imports.
//
// Two gateways live side by side and are selected at runtime by the
// WHATSAPP_PROVIDER secret:
//   'twilio'   (default) — Twilio WhatsApp Business API, twilio.ts
//   'greenapi'           — GREEN-API linked personal account, greenapi.ts
// Nothing in greenapi.ts was removed; flipping the secret back restores the
// old channel with no code change.
//
// Provider differences the caller must know about:
//   * GROUPS — GREEN-API can post into a WhatsApp group ("<id>@g.us"); the
//     Twilio Business API cannot. Group sends throw under 'twilio' instead of
//     failing silently, and the group webhook path only exists on GREEN-API.
//   * 24h WINDOW — Twilio may only send free-form text inside the 24-hour
//     service window opened by the user's last inbound message. Outside it
//     Meta rejects the send and only an approved template goes through.
import * as greenapi from './greenapi.ts';
import * as twilio from './twilio.ts';

export type WhatsAppProvider = 'twilio' | 'greenapi';

export function whatsappProvider(): WhatsAppProvider {
  const raw = (Deno.env.get('WHATSAPP_PROVIDER') || 'twilio').trim().toLowerCase();
  return raw === 'greenapi' || raw === 'green-api' ? 'greenapi' : 'twilio';
}

function assertNotGroup(to: string, what: string) {
  if (to.endsWith('@g.us') || to.startsWith('group:')) {
    throw new Error(
      `twilio provider cannot ${what} to a WhatsApp group (${to}) — the Business API has no group support. Set WHATSAPP_PROVIDER=greenapi for groups.`,
    );
  }
}

export async function sendText(to: string, body: string): Promise<string> {
  if (whatsappProvider() === 'greenapi') return await greenapi.sendText(to, body);
  assertNotGroup(to, 'send text');
  return await twilio.sendWhatsApp(to, body);
}

export async function sendFile(to: string, mediaUrl: string, caption?: string): Promise<string> {
  if (whatsappProvider() === 'greenapi') return await greenapi.sendFile(to, mediaUrl, caption);
  assertNotGroup(to, 'send media');
  return await twilio.sendWhatsAppMedia(to, mediaUrl, caption);
}

// Inbound media. Under GREEN-API the notification carries a public downloadUrl;
// under Twilio the MediaUrl needs the account's basic auth.
export async function downloadMedia(
  mediaUrl: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  return whatsappProvider() === 'greenapi'
    ? await greenapi.downloadMedia(mediaUrl)
    : await twilio.downloadMedia(mediaUrl);
}

// Channel health, in GREEN-API's vocabulary so the existing
// `greenapi_instance_state` setting, alerting and admin UI keep working:
// 'authorized' means the gateway answers and the sender is usable.
export async function getChannelState(): Promise<string> {
  return whatsappProvider() === 'greenapi'
    ? await greenapi.getStateInstance()
    : await twilio.getAccountState();
}
