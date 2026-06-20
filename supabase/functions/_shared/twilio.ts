// Twilio access for Edge Functions — creds from Supabase secrets.
const sid = () => Deno.env.get('TWILIO_ACCOUNT_SID')!;
const token = () => Deno.env.get('TWILIO_AUTH_TOKEN')!;
const from = () => Deno.env.get('TWILIO_WHATSAPP_FROM')!;

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

export async function sendWhatsApp(to: string, body: string): Promise<string> {
  const target = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
  const parts = splitForWhatsApp(body);
  let lastSid = '';
  for (const part of parts) {
    lastSid = await postMessage(new URLSearchParams({ From: from(), To: target, Body: part }));
  }
  return lastSid;
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
