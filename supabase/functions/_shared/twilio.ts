// Twilio access for Edge Functions — creds from Supabase secrets.
const sid = () => Deno.env.get('TWILIO_ACCOUNT_SID')!;
const token = () => Deno.env.get('TWILIO_AUTH_TOKEN')!;
const from = () => Deno.env.get('TWILIO_WHATSAPP_FROM')!;

export type WhatsAppInteractiveOption = {
  id: string;
  title: string;
  description?: string;
};

export type WhatsAppInteractive = {
  kind: 'quick_reply' | 'list_picker';
  body: string;
  button?: string;
  options: WhatsAppInteractiveOption[];
};

function basicAuth(): string {
  return 'Basic ' + btoa(`${sid()}:${token()}`);
}

/**
 * Validate X-Twilio-Signature (spec §7.3): base64(HMAC-SHA1(authToken,
 * fullUrl + each sorted param key immediately followed by its value)).
 */
export async function validateSignature(
  signature: string | null,
  url: string,
  params: Record<string, string>
): Promise<boolean> {
  if (!signature) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(token()),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return expected === signature;
}

// WhatsApp rejects messages over ~1600 chars. Split long bodies on paragraph/
// word boundaries so a long agent question or template never silently fails.
const WA_MAX_CHARS = 1500;
export function splitForWhatsApp(body: string, max = WA_MAX_CHARS): string[] {
  if (body.length <= max) return [body];
  const chunks: string[] = [];
  let rest = body;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = rest.lastIndexOf(' ', max);
    if (cut < max * 0.5) cut = max;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

async function postMessage(form: URLSearchParams): Promise<string> {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid()}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: basicAuth(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  if (!res.ok) throw new Error(`Twilio send ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.sid;
}

export async function interactiveFingerprint(content: WhatsAppInteractive): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(content));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).slice(0, 12)
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Content resources do not require Meta approval when used inside the active
// 24-hour WhatsApp session. They are created once and their SID is cached in
// the settings table by worker.sendOut.
export async function createWhatsAppInteractiveContent(
  content: WhatsAppInteractive,
  fingerprint: string,
): Promise<string> {
  const type = content.kind === 'list_picker'
    ? {
        'twilio/list-picker': {
          body: content.body.slice(0, 1024),
          button: (content.button || 'בחירת אפשרות').slice(0, 20),
          items: content.options.slice(0, 10).map((option) => ({
            item: option.title.slice(0, 24),
            id: option.id.slice(0, 200),
            description: (option.description || option.title).slice(0, 72),
          })),
        },
      }
    : {
        'twilio/quick-reply': {
          body: content.body.slice(0, 1024),
          actions: content.options.slice(0, 3).map((option) => ({
            type: 'QUICK_REPLY',
            title: option.title.slice(0, 20),
            id: option.id.slice(0, 200),
          })),
        },
      };
  const res = await fetch('https://content.twilio.com/v1/Content', {
    method: 'POST',
    headers: { Authorization: basicAuth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      friendly_name: `primeos_${content.kind}_${fingerprint}`,
      language: 'he',
      types: type,
    }),
  });
  if (!res.ok) throw new Error(`Twilio content create ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (!data.sid) throw new Error('Twilio content create returned no SID');
  return data.sid as string;
}

export async function sendWhatsAppContent(to: string, contentSid: string): Promise<string> {
  const target = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
  return postMessage(new URLSearchParams({ From: from(), To: target, ContentSid: contentSid }));
}

export async function sendWhatsApp(to: string, body: string): Promise<string> {
  const target = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
  const parts = splitForWhatsApp(body);
  let lastSid = '';
  for (const part of parts) {
    lastSid = await postMessage(new URLSearchParams({ From: from(), To: target, Body: part }));
  }
  return lastSid;
}

// Send a media message (image/PDF) — mediaUrl must be publicly fetchable by
// Twilio (a Supabase signed URL works). Optional caption in `body`.
export async function sendWhatsAppMedia(to: string, mediaUrl: string, body?: string): Promise<string> {
  const target = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
  const form = new URLSearchParams({ From: from(), To: target, MediaUrl: mediaUrl });
  if (body) form.set('Body', body.slice(0, 1500));
  return postMessage(form);
}

// Send an approved Meta/WhatsApp template (Content API) — the only way to reach
// a user outside the 24h service window. `vars` fills the template's {{1}} slots.
export async function sendWhatsAppTemplate(
  to: string,
  contentSid: string,
  vars: Record<string, string> = {}
): Promise<string> {
  const target = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
  const form = new URLSearchParams({ From: from(), To: target, ContentSid: contentSid });
  if (Object.keys(vars).length) form.set('ContentVariables', JSON.stringify(vars));
  return postMessage(form);
}

export async function downloadMedia(
  mediaUrl: string
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const res = await fetch(mediaUrl, { headers: { Authorization: basicAuth() } });
  if (!res.ok) throw new Error(`Twilio media ${res.status}`);
  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    contentType: res.headers.get('content-type') ?? 'application/octet-stream',
  };
}
