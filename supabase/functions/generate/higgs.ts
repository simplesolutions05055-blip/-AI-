// AI video clips through Higgsfield (one key, several video models).
// A clip is made from a still we already designed (image-to-video), so the look stays the organisation's.
// The provider keeps files for about 7 days: every finished clip is copied to our storage at once.
const env = (k: string) => Deno.env.get(k) ?? '';
const BASE = 'https://api.higgsfield.ai';

// input limits read from the provider's own validation answers (1.11.2026)
export const CLIP_MODELS: Record<string, { path: string; res: string; min: number; max: number; usd: number; he: string }> = {
  kling: { path: 'kling-video/v4.0/image-to-video', res: '720p', min: 3, max: 30, usd: 0.157, he: 'Kling 4.0' },
  seedance: { path: 'bytedance/seedance-2.5/image-to-video', res: '720p', min: 4, max: 30, usd: 0.206, he: 'Seedance 2.5' },
  minimax: { path: 'minimax/h3/image-to-video', res: '2K', min: 5, max: 15, usd: 0.13, he: 'MiniMax H3' },
  wan: { path: 'alibaba/wan-3.0-prime/image-to-video', res: '720p', min: 2, max: 30, usd: 0.027, he: 'Wan 3.0 Prime' },
};
export const clipModel = (m?: string) => (CLIP_MODELS[String(m)] ? String(m) : CLIP_MODELS[env('HIGGSFIELD_VIDEO_MODEL')] ? env('HIGGSFIELD_VIDEO_MODEL') : 'kling');
export const clipSeconds = (model: string, want: number) => { const M = CLIP_MODELS[clipModel(model)]; return Math.max(M.min, Math.min(M.max, Math.ceil(+want || 5))); };
const ASPECT: Record<string, string> = { '9x16': '9:16', '16x9': '16:9', '1x1': '1:1', '4x5': '3:4' };
const head = () => ({ authorization: 'Key ' + env('HIGGSFIELD_API_KEY'), 'content-type': 'application/json' });

// what every clip must keep: real motion of the still, nothing written, nothing invented on screen
const RULES = 'Animate this exact photo with natural, realistic motion. Keep the same people, place, colors and framing. Smooth cinematic camera. No text, no letters, no logos, no captions, no watermarks, no new objects.';

export async function clipSubmit(p: { image: string; prompt: string; sec: number; format: string; model?: string }) {
  if (!env('HIGGSFIELD_API_KEY')) throw new Error('clips_not_configured');
  if (!/^https:\/\//.test(p.image)) throw new Error('bad_image');
  const model = clipModel(p.model);
  const M = CLIP_MODELS[model];
  const sec = clipSeconds(model, p.sec);
  const body: Record<string, unknown> = { prompt: (String(p.prompt || '').slice(0, 900) + '\n' + RULES).trim(), image_url: p.image, duration: sec, aspect_ratio: ASPECT[p.format] ?? '9:16', resolution: M.res, generate_audio: false };
  const r = await fetch(`${BASE}/${M.path}`, { method: 'POST', headers: { ...head(), 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error('clip_submit_' + r.status + ':' + t.slice(0, 200));
  const j = JSON.parse(t);
  if (!j.request_id) throw new Error('clip_no_id');
  return { id: String(j.request_id), model, sec };
}

// wait | done (with the provider url) | failed
export async function clipStatus(id: string) {
  if (!/^[0-9a-f-]{20,60}$/i.test(id)) throw new Error('bad_id');
  const r = await fetch(`${BASE}/requests/${id}/status`, { headers: head() });
  const t = await r.text();
  if (!r.ok) return { state: r.status === 404 ? 'failed' : 'wait', why: 'status_' + r.status };
  const j = JSON.parse(t);
  const st = String(j.status ?? '');
  if (st === 'completed') {
    const url = j.video?.url ?? (Array.isArray(j.videos) ? j.videos[0]?.url : '') ?? '';
    return url ? { state: 'done', url: String(url) } : { state: 'failed', why: 'no_video' };
  }
  if (['failed', 'nsfw', 'canceled', 'cancelled'].includes(st)) return { state: 'failed', why: st };
  return { state: 'wait' };
}

// the finished clip moves to our storage (the provider deletes its copy)
export async function clipStore(d: any, org: string, url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('clip_download_' + r.status);
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.length < 1000) throw new Error('clip_empty');
  const path = `vid/${org || 'admin'}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-clip.mp4`;
  const up = await d.storage.from('v2-content').upload(path, bytes, { contentType: 'video/mp4', upsert: true });
  if (up.error) throw new Error('storage_failed');
  return d.storage.from('v2-content').getPublicUrl(path).data.publicUrl as string;
}
