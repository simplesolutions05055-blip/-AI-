// Twilio WhatsApp Business API client — reachable through whatsapp.ts when
// WHATSAPP_PROVIDER=twilio. The message shapes and the length splitter stay in
// whatsappText.ts (transport-agnostic); this module is Twilio wire protocol only.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   TWILIO_ACCOUNT_SID   — ACxxxxxxxx
//   TWILIO_AUTH_TOKEN    — signs outbound calls AND validates inbound webhooks
//   TWILIO_WHATSAPP_FROM — the registered sender, "whatsapp:+15559299898"
//   TWILIO_WEBHOOK_URL   — the exact public URL Twilio is configured to POST to,
//                          used verbatim in the signature check
import { safeFetch } from './safeFetch.ts';
import { splitForWhatsApp } from './whatsappText.ts';

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

// Channel health, answered in GREEN-API's vocabulary so the shared alerting and
// the admin UI need no provider branch: the account resource is the cheapest
// call that proves both credentials and a live account.
//   'authorized' — account active
//   'blocked'    — suspended/closed account
//   'notAuthorized' — bad or missing credentials
export async function getAccountState(): Promise<string> {
  if (!Deno.env.get('TWILIO_ACCOUNT_SID') || !Deno.env.get('TWILIO_AUTH_TOKEN')) {
    return 'notAuthorized';
  }
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid()}.json`, {
    headers: { Authorization: basicAuth() },
  });
  if (res.status === 401 || res.status === 403) return 'notAuthorized';
  if (!res.ok) throw new Error(`Twilio account fetch ${res.status}`);
  const data = await res.json().catch(() => ({}));
  return data?.status === 'active' ? 'authorized' : 'blocked';
}

async function postMessage(form: URLSearchParams): Promise<string> {
  // Ask Twilio to report back what happened to this message.
  //
  // Without StatusCallback, Twilio never tells us anything after the API call
  // returns a SID — the console showed "There were no HTTP Requests logged for
  // this event" while every reply was silently failing with 63112 (Meta had
  // disabled the WhatsApp Business Account). Our database said "sent" the whole
  // time. The callback is what makes twilio-webhook's recordDeliveryStatus fire.
  //
  // It MUST be the exact same URL the inbound webhook uses: the signature is
  // computed over the URL, and twilio-webhook validates against
  // TWILIO_WEBHOOK_URL verbatim. A different URL here would fail that check and
  // every callback would be rejected with a 403.
  const statusCallback = Deno.env.get('TWILIO_WEBHOOK_URL');
  if (statusCallback && !form.has('StatusCallback')) {
    form.set('StatusCallback', statusCallback);
  }

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
  // mediaUrl arrives on the webhook body. This request carries our Twilio Basic
  // auth, so an unvalidated host would be handed live credentials — the SSRF
  // guard is what keeps that from being a one-request account takeover.
  const res = await safeFetch(mediaUrl, { headers: { Authorization: basicAuth() } });
  if (!res.ok) throw new Error(`Twilio media ${res.status}`);
  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    contentType: res.headers.get('content-type') ?? 'application/octet-stream',
  };
}
