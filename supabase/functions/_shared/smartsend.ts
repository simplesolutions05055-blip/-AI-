// Smart Send (smartsend.co.il) WhatsApp transport.
//
// Public Make.com API contract:
//   POST /integrations/make/messages/send-text
//   x-organization-id: <organization id>
//   { phoneNumber, message }
//
//   POST /integrations/make/messages/send-template-base64
//   x-organization-id: <organization id>
//   { phoneNumber, templateName, fileData, fileName }
//
// Probing the Make host on 2026-08-31 returned "route not found" for every
// other messages/* path, so these two are the whole surface: send-text is the
// only free-form route and send-template-base64 is the only one that carries a
// file. Media therefore requires an approved WhatsApp template with a media
// header; its name comes from SMARTSEND_MEDIA_TEMPLATE.
//
// Secrets (Supabase -> Edge Functions -> Secrets):
//   SMARTSEND_ORGANIZATION_ID - workspace id supplied by Smart Send
//   SMARTSEND_API_URL         - optional API origin override
//   SMARTSEND_MEDIA_TEMPLATE  - approved template name with a media header
import { splitForWhatsApp } from './whatsappText.ts';
import { safeFetch } from './safeFetch.ts';

const DEFAULT_API_URL = 'https://api.smartsend.co.il';

function apiKey(): string {
  const value = (
    Deno.env.get('SMARTSEND_ORGANIZATION_ID') || Deno.env.get('SMARTSEND_API_KEY')
  )?.trim();
  if (!value) throw new Error('SMARTSEND_ORGANIZATION_ID not configured - cannot send WhatsApp');
  return value;
}

function apiBase(): string {
  return (Deno.env.get('SMARTSEND_API_URL') || DEFAULT_API_URL).replace(/\/$/, '');
}

function endpoint(): string {
  return `${apiBase()}/integrations/make/messages/send-text`;
}

function mediaEndpoint(): string {
  return `${apiBase()}/integrations/make/messages/send-template-base64`;
}

function mediaTemplate(): string | null {
  return Deno.env.get('SMARTSEND_MEDIA_TEMPLATE')?.trim() || null;
}

// 10MB matches MAX_MEDIA_BYTES for inbound media and WhatsApp's own ceiling.
const MAX_OUTBOUND_MEDIA_BYTES = 10 * 1024 * 1024;

function toBase64(bytes: Uint8Array): string {
  // Chunked so a multi-megabyte file cannot blow the argument limit of
  // String.fromCharCode the way a single spread would.
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fileNameFor(mediaUrl: string, contentType: string): string {
  const fromPath = new URL(mediaUrl).pathname.split('/').pop() ?? '';
  if (/\.[a-z0-9]{2,5}$/i.test(fromPath)) return fromPath;
  const ext = contentType.split(';')[0].trim().split('/')[1] || 'bin';
  return `output.${ext === 'jpeg' ? 'jpg' : ext}`;
}

export function toPhone(to: string): string {
  const digits = to.replace(/^whatsapp:/i, '').replace(/@c\.us$/i, '').replace(/\D/g, '');
  if (!digits) throw new Error('cannot derive a Smart Send phone number from WhatsApp target');
  return digits;
}

async function post(payload: { phoneNumber: string; message: string }): Promise<string> {
  const res = await fetch(endpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-organization-id': apiKey(),
    },
    body: JSON.stringify(payload),
  });
  const responseText = await res.text();
  if (!res.ok) {
    // Never include request data or the API key in errors/logs.
    throw new Error(`Smart Send send failed (${res.status}): ${responseText.slice(0, 300)}`);
  }
  return `smartsend-${crypto.randomUUID()}`;
}

export async function sendText(to: string, body: string): Promise<string> {
  const phone = toPhone(to);
  let lastId = '';
  for (const message of splitForWhatsApp(body)) {
    lastId = await post({ phoneNumber: phone, message });
  }
  return lastId;
}

export async function sendFile(to: string, mediaUrl: string, caption?: string): Promise<string> {
  const template = mediaTemplate();
  if (!template) {
    // Never silently send only the caption: the caller logs this and falls back
    // to a text message, which is honest about the image not being attached.
    throw new Error(
      'Smart Send media send needs an approved template - set SMARTSEND_MEDIA_TEMPLATE',
    );
  }
  const phone = toPhone(to);
  // Upload the bytes rather than handing Smart Send a URL. A Supabase signed URL
  // expires (and WhatsApp re-fetches media later), which is what produced the
  // InvalidJWT failures; base64 has no such window.
  const { bytes, contentType } = await downloadMedia(mediaUrl);
  if (bytes.byteLength > MAX_OUTBOUND_MEDIA_BYTES) {
    throw new Error(`Smart Send media too large (${bytes.byteLength} bytes)`);
  }
  const res = await fetch(mediaEndpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-organization-id': apiKey(),
    },
    body: JSON.stringify({
      phoneNumber: phone,
      templateName: template,
      fileData: toBase64(bytes),
      fileName: fileNameFor(mediaUrl, contentType),
    }),
  });
  const responseText = await res.text();
  if (!res.ok) {
    // Never include request data or the API key in errors/logs.
    throw new Error(`Smart Send media send failed (${res.status}): ${responseText.slice(0, 300)}`);
  }
  const sid = `smartsend-${crypto.randomUUID()}`;
  // The template body is fixed by WhatsApp approval, so the caption cannot ride
  // along with the file. Send it as its own message right after.
  if (caption?.trim()) await post({ phoneNumber: phone, message: caption });
  return sid;
}

export async function downloadMedia(
  mediaUrl: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  // URL comes from an untrusted webhook payload. safeFetch blocks private and
  // otherwise unsafe destinations before following the provider's URL.
  const res = await safeFetch(mediaUrl);
  if (!res.ok) throw new Error(`Smart Send media download failed (${res.status})`);
  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    contentType: res.headers.get('content-type') ?? 'application/octet-stream',
  };
}

// Smart Send's public OpenAction API has no authenticated health endpoint.
// This state means configuration exists, not that a live delivery was tested.
export async function getState(): Promise<string> {
  return (Deno.env.get('SMARTSEND_ORGANIZATION_ID') || Deno.env.get('SMARTSEND_API_KEY'))?.trim()
    ? 'authorized'
    : 'notAuthorized';
}
