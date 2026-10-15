// PrimeOS publishing layer.
// The system talks to a generic "publishing provider". Zernio is the first one; another provider
// (or PrimeOS's own Meta / TikTok / Google approvals) is added by writing one more adapter with the
// same shape and switching PUBLISH_PROVIDER. Nothing outside this file knows which provider is used.

// channel keys used by the PrimeOS UI
export type ChKey = 'fb' | 'ig' | 'x' | 'yt' | 'li' | 'tk';
export const CH_KEYS: ChKey[] = ['fb', 'ig', 'x', 'yt', 'li', 'tk'];

export interface Account { id: string; ch: ChKey; name: string; active: boolean; pic?: string | null; followers?: number | null }
export interface Media { url: string; type: 'image' | 'video' }
export interface Target { ch: ChKey; accountId: string }
export interface PostIn { profileId: string; text: string; targets: Target[]; media: Media[]; when: string | null; tz: string; key: string }
export interface PostOut { id: string; status: string; perTarget: { ch: ChKey; status: string; url?: string | null; error?: string | null }[]; error?: string | null }
export interface PubEvent { postId: string; status: string; perTarget: PostOut['perTarget']; error?: string | null; eventId: string; kind: 'post' | 'account' | 'other' }

export interface Provider {
  name: string;
  ensureProfile(externalId: string, name: string, existing?: string | null): Promise<string>;
  connectUrl(profileId: string, ch: ChKey, redirect: string): Promise<string>;
  accounts(profileId: string): Promise<Account[]>;
  disconnect(accountId: string): Promise<void>;
  createPost(p: PostIn): Promise<PostOut>;
  getPost(id: string): Promise<PostOut>;
  cancelPost(id: string): Promise<void>;
  registerWebhook(url: string, secret: string): Promise<string>;
  verify(raw: string, headers: Headers, secret: string): Promise<boolean>;
  parseEvent(body: any): PubEvent;
}

export class PubError extends Error {
  constructor(public code: string, msg?: string) { super(msg ? code + ':' + msg : code); }
}

/* ---------------- Zernio ---------------- */
const ZP: Record<ChKey, string> = { fb: 'facebook', ig: 'instagram', x: 'twitter', yt: 'youtube', li: 'linkedin', tk: 'tiktok' };
const ZK: Record<string, ChKey> = Object.fromEntries(Object.entries(ZP).map(([k, v]) => [v, k as ChKey]));
// final post states: anything else is still on its way
export const FINAL = ['published', 'failed', 'partial', 'cancelled'];

export function zernio(key: string, base = 'https://zernio.com/api/v1'): Provider {
  const req = async (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) => {
    const r = await fetch(base + path, {
      method,
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const txt = await r.text();
    let j: any = null;
    try { j = txt ? JSON.parse(txt) : null; } catch { j = null; }
    if (!r.ok && !(r.status === 409 && j && j.post)) {
      const m = (j && (j.error?.message || j.message || j.error)) || txt.slice(0, 200) || String(r.status);
      throw new PubError('provider_' + r.status, typeof m === 'string' ? m : JSON.stringify(m).slice(0, 200));
    }
    return j ?? {};
  };
  const mapPost = (p: any): PostOut => ({
    id: String(p?._id ?? p?.id ?? ''),
    status: String(p?.status ?? 'scheduled'),
    perTarget: (p?.platforms ?? []).map((x: any) => ({
      ch: ZK[x.platform] ?? x.platform,
      status: String(x.status ?? ''),
      url: x.platformPostUrl ?? null,
      error: x.error?.message ?? x.errorMessage ?? (typeof x.error === 'string' ? x.error : null),
    })),
    error: p?.error?.message ?? (typeof p?.error === 'string' ? p.error : null),
  });
  return {
    name: 'zernio',
    async ensureProfile(externalId, name, existing) {
      if (existing) return existing;
      try {
        const j = await req('POST', '/profiles', { name: name.slice(0, 100), externalId });
        return String(j.profile?._id ?? j.profile?.id);
      } catch (e) {
        // the profile may already exist (externalId is unique) - find it
        const j = await req('GET', '/profiles');
        const hit = (j.profiles ?? []).find((p: any) => p.externalId === externalId);
        if (hit) return String(hit._id ?? hit.id);
        throw e;
      }
    },
    async connectUrl(profileId, ch, redirect) {
      const q = new URLSearchParams({ profileId, redirect_url: redirect });
      const j = await req('GET', `/connect/${ZP[ch]}?${q}`);
      if (!j.authUrl) throw new PubError('provider_no_url');
      return String(j.authUrl);
    },
    async accounts(profileId) {
      const j = await req('GET', `/accounts?${new URLSearchParams({ profileId })}`);
      return (j.accounts ?? [])
        .filter((a: any) => ZK[a.platform] && (!a.profileId || String(a.profileId?._id ?? a.profileId) === profileId))
        .map((a: any) => ({
          id: String(a._id ?? a.id), ch: ZK[a.platform], active: a.isActive !== false,
          name: String(a.displayName || a.selectedPageName || a.username || a.name || ''),
          pic: a.profilePicture ?? a.avatarUrl ?? null,
          followers: typeof a.followersCount === 'number' ? a.followersCount : null,
        }));
    },
    async disconnect(accountId) { await req('DELETE', `/accounts/${encodeURIComponent(accountId)}`); },
    async createPost(p) {
      const hasVideo = p.media.some((m) => m.type === 'video');
      const body: Record<string, unknown> = {
        content: p.text,
        platforms: p.targets.map((t) => ({ platform: ZP[t.ch], accountId: t.accountId })),
        mediaItems: p.media.map((m) => ({ url: m.url, type: m.type })),
      };
      if (p.when) { body.scheduledFor = p.when; body.timezone = p.tz; } else body.publishNow = true;
      if (p.targets.some((t) => t.ch === 'tk')) {
        body.tiktokSettings = {
          privacy_level: 'PUBLIC_TO_EVERYONE', allow_comment: true, content_preview_confirmed: true, express_consent_given: true,
          ...(hasVideo ? { allow_duet: false, allow_stitch: false, media_type: 'video' } : { media_type: 'photo' }),
        };
      }
      const j = await req('POST', '/posts', body, { 'x-request-id': p.key });
      return mapPost(j.post ?? j);
    },
    async getPost(id) { const j = await req('GET', `/posts/${encodeURIComponent(id)}`); return mapPost(j.post ?? j); },
    async cancelPost(id) { await req('DELETE', `/posts/${encodeURIComponent(id)}`); },
    async registerWebhook(url, secret) {
      const j = await req('POST', '/webhooks/settings', {
        name: 'PrimeOS', url, secret,
        events: ['post.published', 'post.partial', 'post.failed', 'post.platform.published', 'post.platform.failed', 'post.cancelled', 'account.connected', 'account.disconnected'],
      });
      return String(j.webhook?._id ?? j._id ?? j.id ?? 'ok');
    },
    async verify(raw, headers, secret) {
      const sig = (headers.get('x-zernio-signature') || headers.get('x-late-signature') || '').trim().toLowerCase();
      if (!sig || !secret) return false;
      const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(raw)));
      const hex = Array.from(mac).map((b) => b.toString(16).padStart(2, '0')).join('');
      if (hex.length !== sig.length) return false;
      let diff = 0;
      for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ sig.charCodeAt(i);
      return diff === 0;
    },
    parseEvent(b) {
      const ev = String(b?.event ?? '');
      const kind = ev.startsWith('post.') ? 'post' : ev.startsWith('account.') ? 'account' : 'other';
      const post = b?.post ?? b?.data?.post ?? b?.data ?? {};
      const out = kind === 'post' ? mapPost(post) : { id: '', status: '', perTarget: [], error: null };
      if (kind === 'post' && !out.id) out.id = String(b?.postId ?? b?.data?.postId ?? '');
      // a single-platform event carries the platform result rather than the whole post
      if (ev === 'post.platform.published' || ev === 'post.platform.failed') {
        const pl = b?.platform ?? b?.data?.platform;
        const ch = ZK[pl?.platform ?? pl] ?? null;
        if (ch && !out.perTarget.some((t) => t.ch === ch)) out.perTarget.push({ ch, status: ev.endsWith('published') ? 'published' : 'failed', url: pl?.platformPostUrl ?? null, error: pl?.error?.message ?? null });
      }
      const st = ev === 'post.published' ? 'published' : ev === 'post.partial' ? 'partial' : ev === 'post.failed' ? 'failed' : ev === 'post.cancelled' ? 'cancelled' : out.status;
      return { postId: out.id, status: st, perTarget: out.perTarget, error: out.error, eventId: String(b?.id ?? ''), kind };
    },
  };
}

// the provider in use; null = publishing not configured yet (the UI says so instead of failing)
export function provider(): Provider | null {
  const want = (Deno.env.get('PUBLISH_PROVIDER') || 'zernio').toLowerCase();
  if (want === 'zernio') {
    const key = (Deno.env.get('ZERNIO_API_KEY') || '').trim();
    return key ? zernio(key, Deno.env.get('ZERNIO_API_URL') || undefined) : null;
  }
  return null;
}

/* ---------------- PrimeOS item -> post ---------------- */
// 'YYYY-MM-DD HH:MM' (Israel time) -> provider local time string, or null when it is now / already past
export function whenOf(pub: unknown, nowMs = Date.now()): string | null {
  if (typeof pub !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(pub)) return null;
  const local = pub.slice(0, 16).replace(' ', 'T') + ':00';
  const ms = Date.parse(local + '+03:00');
  if (!isFinite(ms) || ms <= nowMs + 60_000) return null;
  return local;
}
export function textOf(ui: Record<string, any>): string {
  const body = String(ui.body || ui.t || '');
  // hashtags the text does not already carry
  const list = (Array.isArray(ui.tags) ? ui.tags : []).map((t: string) => (String(t).startsWith('#') ? String(t) : '#' + t).replace(/\s+/g, '_')).filter((t: string) => !body.includes(t));
  const tags = list.length ? '\n\n' + list.join(' ') : '';
  const cta = ui.cta && !body.includes(ui.cta) ? '\n\n' + ui.cta : '';
  return (body + cta + tags).trim().slice(0, 5000);
}
export function mediaOf(ui: Record<string, any>): Media[] {
  const m = ui.media || {};
  if (ui.ty === 'video' && m.url) return [{ url: String(m.url), type: 'video' }];
  if (ui.ty === 'graphic' && m.url && /^https:\/\//.test(m.url)) return [{ url: String(m.url), type: 'image' }];
  return [];
}
// platforms that refuse a post without a picture or a video
export const NEEDS_MEDIA: ChKey[] = ['ig', 'tk', 'yt'];
export const NEEDS_VIDEO: ChKey[] = ['yt'];

export async function sigOf(x: unknown): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(x))));
  return Array.from(d.slice(0, 12)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
