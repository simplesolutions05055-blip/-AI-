// Smart Send (smartsend.co.il) WhatsApp transport.
//
// Public Make.com API contract:
//   POST /integrations/make/messages/send-text
//   x-organization-id: <organization id>
//   { phoneNumber, message }
//
// Secrets (Supabase -> Edge Functions -> Secrets):
//   SMARTSEND_ORGANIZATION_ID - workspace id supplied by Smart Send
//   SMARTSEND_API_URL         - optional API origin override
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

function endpoint(): string {
  const base = (Deno.env.get('SMARTSEND_API_URL') || DEFAULT_API_URL).replace(/\/$/, '');
  return `${base}/integrations/make/messages/send-text`;
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
  // The current Make API exposes free-text and approved-template endpoints but
  // no free-form media endpoint. Never silently send only the caption.
  void to;
  void mediaUrl;
  void caption;
  throw new Error('Smart Send Make API has no free-form media endpoint configured');
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
