// PrimeOS video renderer: renders a director plan (video/src) with Remotion inside a Vercel Sandbox.
// POST { action:'start', plan, upload, url }            -> { sandboxId, cmdId }
// POST { action:'status', sandboxId, cmdId, upload, url } -> { stage, progress, url? }
// header x-primeos-token. `upload` is a signed storage upload URL (v2-api upload.sign), `url` its public URL.
// The finished mp4 goes from the sandbox straight to storage; nothing large passes through this function.
import path from 'node:path';
import { Sandbox } from '@vercel/sandbox';
import { addBundleToSandbox, createSandbox, getRenderProgress } from '@remotion/vercel';

const SUPA_URL = process.env.VITE_SUPABASE_URL || 'https://tgropjisnheppsxejfdn.supabase.co';
const SUPA_ANON = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_uwGM_HAjV28gchyFZHqZGg_9LjXwIJ-';
const OUT = '/tmp/prime.mp4';
const UP_PREFIX = `${SUPA_URL}/storage/v1/object/upload/sign/v2-content/`;
const PUB_PREFIX = `${SUPA_URL}/storage/v1/object/public/v2-content/`;
const json = (b: unknown, s = 200) => Response.json(b, { status: s, headers: { 'cache-control': 'no-store' } });

async function api(token: string, action: string, payload: unknown = {}) {
  const r = await fetch(`${SUPA_URL}/functions/v1/v2-api`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: SUPA_ANON, authorization: `Bearer ${SUPA_ANON}`, 'x-primeos-token': token },
    body: JSON.stringify({ action, payload }),
  });
  return r.ok ? await r.json() : null;
}
async function whoami(token: string) { const j = (await api(token, 'whoami')) as { kind: string } | null; return j?.kind ?? null; }
// the video seconds of the subscription: taken once per output slot (a restart of the same slot is free)
async function quotaTake(token: string, kind: string, qty: number, ref: string) {
  if (kind === 'admin') return null;
  return (await api(token, 'quota.take', { kind: 'vsec', qty, src: 'web', ref })) as { ok?: boolean; error?: string; used?: number; limit?: number; left?: number; reset?: string } | null;
}

// media the sandbox may fetch: our storage and the stock/AI providers the director uses
const HOSTS = [new URL(SUPA_URL).host, 'images.pexels.com', 'videos.pexels.com', 'v3.fal.media', 'fal.media', 'cdn.higgsfield.ai'];
const okSrc = (s: unknown) => {
  if (typeof s !== 'string' || s.length > 2000) return false;
  if (/^fonts\/[\w .-]+$/.test(s)) return true;
  try { const u = new URL(s); return u.protocol === 'https:' && HOSTS.some((h) => u.host === h || u.host.endsWith('.' + h)); } catch { return false; }
};
const num = (v: unknown, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const str = (v: unknown, n = 160) => (typeof v === 'string' ? v.slice(0, n) : undefined);

const cleanWords = (a: unknown) => (Array.isArray(a) ? a.slice(0, 600).filter((w: any) => typeof w?.w === 'string').map((w: any) => ({ w: w.w.slice(0, 40), s: num(w.s, 0, 95, 0), e: num(w.e, 0, 95, 0) })) : []);

const cleanOutro = (o: any) => {
  if (!o || typeof o !== 'object') return undefined;
  const st = o.sting && typeof o.sting === 'object' ? { logo: okSrc(o.sting.logo) ? o.sting.logo : undefined, motion: ['reveal', 'zoom', 'spin'].includes(o.sting.motion) ? o.sting.motion : 'reveal', bg: /^#[0-9a-f]{6}$/i.test(o.sting.bg ?? '') ? o.sting.bg : undefined } : undefined;
  return { cta: str(o.cta, 60), dur: num(o.dur, 0, 6, 3.2), details: Array.isArray(o.details) ? o.details.slice(0, 4).map((d: any) => ({ icon: str(d?.icon, 20), text: str(d?.text, 60) ?? '' })) : [], sting: st };
};
// keeps the plan inside the engine's limits: 90 seconds, sane sizes, allowed media only
export function cleanPlan(p: any) {
  if (!p || typeof p !== 'object' || !Array.isArray(p.scenes) || !p.scenes.length) throw new Error('bad_plan');
  const scenes = p.scenes.slice(0, 30).map((s: any) => {
    const v = s?.visual ?? {};
    const visual = { ...v, kind: ['image', 'video', 'gradient', 'color', 'studio', 'mockup'].includes(v.kind) ? v.kind : 'gradient', tint: v.tint == null ? undefined : num(v.tint, 0, 0.3, 0.12) };
    if (visual.src && !okSrc(visual.src)) { delete visual.src; visual.kind = 'gradient'; }
    const t = s?.text;
    const text = t && Array.isArray(t.lines) ? { ...t, lines: t.lines.slice(0, 6).map((l: unknown) => str(l, 90) ?? ''), kicker: str(t.kicker, 60), sub: str(t.sub, 140), items: Array.isArray(t.items) ? t.items.slice(0, 6).map((x: any) => ({ t: str(x?.t, 80) ?? '', sub: str(x?.sub, 80) })) : undefined } : undefined;
    const vo = s?.voice;
    const voice = vo && okSrc(vo.src) ? { src: vo.src, at: num(vo.at, 0, 3, 0.25), vol: num(vo.vol, 0, 1.5, 1), words: cleanWords(vo.words) } : undefined;
    return { ...s, dur: num(s?.dur, 0.8, 20, 3), visual, text, voice };
  });
  let total = scenes.reduce((a: number, s: any) => a + s.dur, 0) + num(p.outro?.dur, 0, 6, 3.2);
  if (total > 90) { const k = 88 / total; scenes.forEach((s: any) => (s.dur = Math.max(0.8, s.dur * k))); total = 90; }
  const audio: any = {};
  if (okSrc(p.audio?.voice?.src)) audio.voice = { src: p.audio.voice.src, vol: num(p.audio.voice.vol, 0, 1.5, 1), start: num(p.audio.voice.start, 0, 5, 0.3) };
  if (okSrc(p.audio?.music?.src)) audio.music = { src: p.audio.music.src, vol: p.audio.music.vol == null ? undefined : num(p.audio.music.vol, 0, 1, 0.2) };
  const words = cleanWords(p.captions?.words);
  const logo = okSrc(p.brand?.logo) ? p.brand.logo : undefined;
  return {
    ...p,
    format: ['9x16', '1x1', '4x5', '16x9'].includes(p.format) ? p.format : '9x16',
    fps: 30,
    scale: p.scale === 2 ? 2 : 1,
    brand: { ...p.brand, org: str(p.brand?.org, 80) ?? '', logo, colors: { deep: '#0B1F3A', main: '#1F5FBF', accent: '#FFC93C', light: '#BFD7FF', ...(p.brand?.colors ?? {}) } },
    scenes,
    outro: cleanOutro(p.outro),
    audio,
    captions: { style: ['karaoke', 'pop', 'clean', 'none'].includes(p.captions?.style) ? p.captions.style : 'karaoke', pos: p.captions?.pos === 'center' ? 'center' : 'bottom', words },
  };
}

const okUpload = (u: unknown): u is string => typeof u === 'string' && u.startsWith(UP_PREFIX) && u.length < 2000;
const okUrl = (u: unknown): u is string => typeof u === 'string' && u.startsWith(PUB_PREFIX) && u.length < 600 && !/[\s'"]/.test(u);

async function start(body: any, token: string, kind: string) {
  if (!okUpload(body.upload) || !okUrl(body.url)) return json({ error: 'bad_target' }, 400);
  let plan;
  try { plan = cleanPlan(body.plan); } catch { return json({ error: 'bad_plan' }, 400); }
  const secs = Math.ceil(plan.scenes.reduce((a: number, s: any) => a + s.dur, 0) + (plan.outro?.dur ?? 0));
  const q = await quotaTake(token, kind, secs, 'video:' + body.url.slice(PUB_PREFIX.length).slice(0, 100));
  if (q && q.ok === false) return json({ error: 'quota', kind: 'vsec', used: q.used, limit: q.limit, left: q.left, reset: q.reset }, 402);
  const sandbox = await createSandbox({ resources: { vcpus: 8 } });
  try {
    // the library creates the bundle's sub folders but not the bundle root itself
    await sandbox.mkDir('remotion-bundle').catch(() => {});
    await addBundleToSandbox({ sandbox, bundleDir: path.join(process.cwd(), 'api/_video/bundle') });
    // detached render without Vercel Blob (the library insists on Blob for detached mode): run its own
    // render script with the same config it would build; status() uploads the mp4 to storage afterwards
    const cfg = {
      serveUrl: '/vercel/sandbox/remotion-bundle', compositionId: 'Prime', inputProps: { plan }, outputLocation: OUT, codec: 'h264',
      crf: 18, imageFormat: null, pixelFormat: null, envVariables: {}, frameRange: null, everyNthFrame: 1, proResProfile: null, chromiumOptions: {},
      scale: 1, preferLossless: false, enforceAudioTrack: true, disallowParallelEncoding: false, disableSharedMemoryCapture: false, concurrency: null,
      metadata: null, licenseKey: null, videoBitrate: null, audioBitrate: '192k', encodingMaxRate: null, encodingBufferSize: null, muted: false,
      numberOfGifLoops: null, x264Preset: 'medium', gopSize: null, colorSpace: 'default', jpegQuality: 92, audioCodec: null, logLevel: 'info',
      timeoutInMilliseconds: 120000, forSeamlessAacConcatenation: false, separateAudioTo: null, hardwareAcceleration: 'disable',
      offthreadVideoCacheSizeInBytes: null, mediaCacheSizeInBytes: null, offthreadVideoThreads: null, chromeMode: 'headless-shell',
      browserExecutable: null, binariesDirectory: null, repro: false, sampleRate: 48000, vercelBlob: null,
    };
    const cmd = await sandbox.runCommand({ cmd: 'node', args: ['render-video.mjs', JSON.stringify(cfg)], detached: true });
    await sandbox.extendTimeout(40 * 60 * 1000).catch(() => {});
    const r = { sandboxId: sandbox.sandboxId, cmdId: cmd.cmdId };
    return json({ ok: true, sandboxId: r.sandboxId, cmdId: r.cmdId });
  } catch (e: any) {
    await sandbox.stop().catch(() => {});
    return json({ error: 'render_start_failed', detail: String(e?.message || e).slice(0, 300) }, 500);
  }
}

async function status(body: any) {
  const { sandboxId, cmdId } = body;
  if (typeof sandboxId !== 'string' || typeof cmdId !== 'string' || !okUpload(body.upload) || !okUrl(body.url)) return json({ error: 'bad_request' }, 400);
  const p: any = await getRenderProgress({ sandboxId, cmdId });
  if (p.stage === 'done') {
    const sb = await Sandbox.get({ sandboxId });
    const up = await sb.runCommand({ cmd: 'curl', args: ['-sS', '-f', '-X', 'PUT', '-H', 'content-type: video/mp4', '-H', 'x-upsert: true', '--data-binary', `@${OUT}`, body.upload] });
    if (up.exitCode !== 0) return json({ stage: 'error', message: 'upload_failed', detail: (await up.stderr()).slice(0, 200) });
    await sb.stop().catch(() => {});
    return json({ stage: 'done', progress: 1, url: body.url, size: p.size });
  }
  if (p.stage === 'expired') {
    // already uploaded by an earlier poll and the sandbox was stopped
    const h = await fetch(body.url, { method: 'HEAD' }).catch(() => null);
    return json(h?.ok ? { stage: 'done', progress: 1, url: body.url } : { stage: 'expired' });
  }
  if (p.stage === 'error') {
    await Sandbox.get({ sandboxId }).then((s) => s.stop()).catch(() => {});
    return json({ stage: 'error', message: String(p.message || '').slice(0, 300) });
  }
  return json({ stage: p.stage, progress: p.overallProgress ?? 0, frames: p.progress?.renderedFrames });
}

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const token = req.headers.get('x-primeos-token')?.trim() ?? '';
    const kind = token ? await whoami(token) : null;
    if (!kind) return json({ error: 'invalid_token' }, 401);
    let body: any;
    try { body = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }
    try {
      if (body.action === 'start') return await start(body, token, kind);
      if (body.action === 'status') return await status(body);
      return json({ error: 'unknown_action' }, 400);
    } catch (e: any) {
      return json({ error: 'video_failed', detail: String(e?.message || e).slice(0, 300) }, 500);
    }
  },
};
