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

export async function sendText(to: string, body: string): Promise<string> {
  assertNotGroup(to, 'send text');
  return await smartsend.sendText(to, body);
}

export async function sendFile(to: string, mediaUrl: string, caption?: string): Promise<string> {
  assertNotGroup(to, 'send media');
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
