// GREEN-API gateway client — the WhatsApp transport for every real (non-simulated)
// conversation, 1:1 and groups alike. Replaces the Twilio WhatsApp Business API.
//
// Credentials go in the request PATH, not a header:
//   POST {apiUrl}/waInstance{idInstance}/{method}/{apiTokenInstance}
// so the URL itself is a secret — never let it reach a log or an error message.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   GREENAPI_ID_INSTANCE — instance id, e.g. 710722688394
//   GREENAPI_TOKEN       — apiTokenInstance
//   GREENAPI_API_URL     — the instance's own host, e.g. https://7107.api.greenapi.com
//
// Two Twilio concepts have NO equivalent here and are gone for good:
//   * the 24-hour service window + approved templates — a WhatsApp Business API
//     rule that does not apply to a linked personal account, so the bot can
//     always reply;
//   * interactive quick-reply / list-picker Content resources — replies now use
//     the numbered-text menu the engine already produces as its fallback.
import { splitForWhatsApp } from './twilio.ts';

function endpoint(method: string): string {
  const base = (Deno.env.get('GREENAPI_API_URL') || 'https://api.green-api.com').replace(/\/$/, '');
  const idInstance = Deno.env.get('GREENAPI_ID_INSTANCE');
  const token = Deno.env.get('GREENAPI_TOKEN');
  if (!idInstance || !token) {
    throw new Error('GREENAPI_ID_INSTANCE / GREENAPI_TOKEN not configured — cannot send WhatsApp');
  }
  return `${base}/waInstance${idInstance}/${method}/${token}`;
}

async function post(method: string, payload: Record<string, unknown>): Promise<string> {
  const res = await fetch(endpoint(method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  // Deliberately omits the URL — it carries the token.
  if (!res.ok) throw new Error(`green-api ${method} failed (${res.status}): ${JSON.stringify(data)}`);
  return (data?.idMessage as string) ?? `greenapi-${crypto.randomUUID()}`;
}

// The engine stores 1:1 targets in the legacy Twilio shape ("whatsapp:+9725...")
// so old conversations keep working; GREEN-API wants "9725...@c.us". Chat ids
// that already arrive in GREEN-API form (a group, or a normalized inbound) pass
// straight through.
export function toChatId(to: string): string {
  if (to.endsWith('@c.us') || to.endsWith('@g.us')) return to;
  const digits = to.replace(/^whatsapp:/, '').replace(/\D/g, '');
  if (!digits) throw new Error(`cannot derive a GREEN-API chatId from: ${to}`);
  return `${digits}@c.us`;
}

// Inverse of toChatId — "9725...@c.us" → "whatsapp:+9725...", the shape the
// engine and the existing `conversations.whatsapp_from` rows use.
export function toWhatsAppFrom(chatId: string): string {
  return `whatsapp:+${chatId.replace(/@c\.us$/, '').replace(/\D/g, '')}`;
}

export async function sendText(to: string, body: string): Promise<string> {
  const chatId = toChatId(to);
  let lastId = '';
  // Long bodies are still chunked: WhatsApp itself rejects oversized messages.
  for (const part of splitForWhatsApp(body)) {
    lastId = await post('sendMessage', { chatId, message: part });
  }
  return lastId;
}

// sendFileByUrl requires a fileName — WhatsApp shows it on documents and uses the
// extension to decide whether the file renders inline as an image.
export async function sendFile(to: string, mediaUrl: string, caption?: string): Promise<string> {
  let fileName = 'file';
  try {
    const last = new URL(mediaUrl).pathname.split('/').pop();
    if (last) fileName = decodeURIComponent(last);
  } catch { /* keep the default */ }
  return await post('sendFileByUrl', {
    chatId: toChatId(to),
    urlFile: mediaUrl,
    fileName,
    caption: caption ?? '',
  });
}

// Inbound media. GREEN-API hands us a ready-to-fetch downloadUrl on the
// notification, so unlike Twilio this needs no credentials.
export async function downloadMedia(
  downloadUrl: string
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error(`green-api media download ${res.status}`);
  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    contentType: res.headers.get('content-type') ?? 'application/octet-stream',
  };
}
