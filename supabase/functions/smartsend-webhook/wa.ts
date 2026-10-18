// SmartSend WhatsApp transport for the bot: inbound payload, text, images (approved media template).
import { env } from './common.ts';

const base = () => (env('SMARTSEND_API_URL') || 'https://api.smartsend.co.il').replace(/\/$/, '');
const key = () => env('SMARTSEND_ORGANIZATION_ID') || env('SMARTSEND_API_KEY');

export interface InMsg { id: string; phone: string; body: string; mediaUrl: string | null; mediaType: string | null; voice: boolean }

// the provider's payload has moved between field names over time; every known spelling is read
export async function readInbound(raw: unknown): Promise<InMsg | null> {
  const p: any = Array.isArray(raw) ? raw[0] : raw;
  if (!p || typeof p !== 'object' || p.isGroupMessage === true) return null;
  const rm = p.rawMessage && typeof p.rawMessage === 'object' ? p.rawMessage : {};
  const md = p.media && typeof p.media === 'object' ? p.media : {};
  const ph = (v: string) => /^\{\{[\s\S]*\}\}$/.test(v.trim());
  const first = (...vs: unknown[]) => { const v = vs.find((x) => typeof x === 'string' && x.trim() && !ph(x)); return typeof v === 'string' ? v.trim() : null; };
  const type = first(p.message_type)?.toLowerCase() ?? null;
  const isMedia = ['image', 'video', 'file', 'audio'].includes(type ?? '');
  const marker = isMedia ? `[${type}]` : null;
  const tv = (v: unknown) => (typeof v === 'string' && marker && v.trim().toLowerCase() === marker ? null : v);
  const body = first(tv(p.last_message), p.text, p.caption, p.media_caption, p.message, p.body, rm.body, rm.caption, rm.text, md.caption) ?? '';
  const att = first(p.media_url, p.file_url, p.mediaUrl, p.downloadUrl, md.url, md.downloadUrl, rm.mediaUrl, rm.downloadUrl);
  const voiceUrl = first(p.voice_url);
  const mediaUrl = type === 'text' ? null : type === 'audio' ? (voiceUrl ?? att) : isMedia ? att : att ?? (body ? null : voiceUrl);
  const mediaType = mediaUrl ? first(p.message_type, p.media_type, p.mimeType, md.mimeType, rm.mimeType) : null;
  const sender = first(p.phone, p.senderId) ?? '';
  const phone = sender.replace(/^whatsapp:/i, '').replace(/@c\.us$/i, '').replace(/\D/g, '');
  if ((!body && !mediaUrl) || !phone) return null;
  const time = String(p.currentDateTime ?? p.time ?? '');
  const dig = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${sender}\n${time}\n${body}\n${mediaUrl ?? ''}`)));
  const id = 'wa-' + Array.from(dig.slice(0, 16)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return { id, phone, body, mediaUrl, mediaType, voice: !!mediaUrl && (type === 'audio' || mediaUrl === voiceUrl) };
}

async function post(path: string, payload: unknown) {
  const r = await fetch(base() + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-organization-id': key() }, body: JSON.stringify(payload) });
  const t = await r.text();
  if (!r.ok) throw new Error(`smartsend_${r.status}: ${t.slice(0, 200)}`);
  try { const j = JSON.parse(t); if (j && j.success === false) throw new Error('smartsend_rejected: ' + String(j.message ?? '').slice(0, 200)); } catch (e) { if (e instanceof Error && e.message.startsWith('smartsend_rejected')) throw e; }
}

// test mode: replies are collected instead of sent
export const DRY = { on: false, out: [] as string[] };

export async function sendText(phone: string, text: string) {
  if (DRY.on) { DRY.out.push(text); return; }
  const parts: string[] = [];
  let s = String(text ?? '').trim();
  while (s.length > 3500) { const cut = s.lastIndexOf('\n', 3500) > 1000 ? s.lastIndexOf('\n', 3500) : 3500; parts.push(s.slice(0, cut)); s = s.slice(cut).trim(); }
  if (s) parts.push(s);
  for (const m of parts) await post('/integrations/make/messages/send-text', { phoneNumber: phone, message: m });
}

// images ride an approved WhatsApp template with a media header (a free-form media message is not allowed)
export async function sendImage(phone: string, url: string, orgName: string) {
  if (DRY.on) { DRY.out.push('[image] ' + url); return; }
  const r = await fetch(url);
  if (!r.ok) throw new Error('image_download_' + r.status);
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.byteLength > 10 * 1024 * 1024) throw new Error('image_too_big');
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const fileData = btoa(bin);
  const fileName = (new URL(url).pathname.split('/').pop() || 'graphic.jpg').replace(/[^\w.\-]/g, '') || 'graphic.jpg';
  const tries: [string, string[] | undefined][] = [['primeos_deliverable_image_v2', [orgName.slice(0, 60) || 'PrimeOS']], ['primeos_deliverable_image_noname', undefined]];
  const fb = env('SMARTSEND_MEDIA_TEMPLATE_FALLBACK') || env('SMARTSEND_MEDIA_TEMPLATE');
  if (fb) tries.push([fb, undefined]);
  let last: unknown = null;
  for (const [templateName, parameters] of tries) {
    try { await post('/integrations/make/messages/send-template-base64', { phoneNumber: phone, templateName, ...(parameters ? { languageCode: 'he', parameters } : {}), fileData, fileName }); return; }
    catch (e) { last = e; if (!(e instanceof Error) || !/smartsend_4\d\d|rejected/.test(e.message)) throw e; }
  }
  throw last instanceof Error ? last : new Error('image_send_failed');
}

export async function download(url: string): Promise<{ bytes: Uint8Array; type: string }> {
  const u = new URL(url);
  if (u.protocol !== 'https:' || /^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(u.hostname)) throw new Error('bad_media_url');
  const r = await fetch(url);
  if (!r.ok) throw new Error('media_download_' + r.status);
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.byteLength > 50 * 1024 * 1024) throw new Error('media_too_big');
  return { bytes, type: r.headers.get('content-type') ?? 'application/octet-stream' };
}
