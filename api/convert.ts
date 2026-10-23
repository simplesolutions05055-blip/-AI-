// PrimeOS media convert: an uploaded clip or photo becomes something the video engine (Chromium) can play.
// Phones hand over HEVC .mov / .mp4 and HEIC photos; Chromium renders neither. Here ffmpeg re-encodes
// what needs it (H.264 + AAC, at most 1080 px on the long side; HEIC -> JPEG) and puts the result next to the original.
// POST { url, name }  header x-primeos-token  -> { url, name, converted, reason }
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const config = { maxDuration: 300, memory: 2048 };

const SUPA_URL = process.env.VITE_SUPABASE_URL || 'https://tgropjisnheppsxejfdn.supabase.co';
const SUPA_ANON = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_uwGM_HAjV28gchyFZHqZGg_9LjXwIJ-';
const PUB_PREFIX = `${SUPA_URL}/storage/v1/object/public/v2-content/`;
const run = promisify(execFile);
const json = (b: unknown, s = 200) => Response.json(b, { status: s, headers: { 'cache-control': 'no-store' } });

async function api(token: string, action: string, payload: unknown) {
  const r = await fetch(`${SUPA_URL}/functions/v1/v2-api`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: SUPA_ANON, authorization: `Bearer ${SUPA_ANON}`, 'x-primeos-token': token },
    body: JSON.stringify({ action, payload }),
  });
  const j = (await r.json().catch(() => ({ error: 'bad_response' }))) as any;
  if (!r.ok || j.error) throw Object.assign(new Error(j.error || 'http_' + r.status), { status: r.status });
  return j;
}

// what the file is, from ffmpeg's own probe output (ffmpeg-static ships without ffprobe)
async function probe(ff: string, src: string) {
  const info = await run(ff, ['-hide_banner', '-i', src]).then(() => '', (e: any) => String(e?.stderr || ''));
  const video = /Stream #\d+:\d+.*Video: (\w+)/.exec(info)?.[1]?.toLowerCase() ?? '';
  const audio = /Stream #\d+:\d+.*Audio: (\w+)/.exec(info)?.[1]?.toLowerCase() ?? '';
  const dims = /Video: .*?(\d{2,5})x(\d{2,5})/.exec(info);
  const w = dims ? +dims[1] : 0, h = dims ? +dims[2] : 0;
  const rot = /rotate\s*:\s*(-?\d+)|displaymatrix: rotation of (-?[\d.]+)/.exec(info);
  const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(info);
  const sec = dur ? +dur[1] * 3600 + +dur[2] * 60 + +dur[3] : 0;
  return { video, audio, w, h, rotated: !!rot, sec, isImage: /Input #0, (image2|png_pipe|jpeg_pipe|webp_pipe|gif|heif|avif)/i.test(info) || (video && sec === 0) };
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const token = request.headers.get('x-primeos-token') ?? '';
    if (!token) return json({ error: 'invalid_token' }, 401);
    let body: any;
    try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
    const url = String(body?.url ?? '');
    if (!url.startsWith(PUB_PREFIX)) return json({ error: 'bad_url' }, 400);
    try {
      await api(token, 'whoami', {}); // only a signed-in user converts, and only files of our storage
    } catch (e: any) { return json({ error: 'invalid_token' }, e?.status === 401 ? 401 : 500); }
    const name = String(body?.name ?? url.split('/').pop() ?? 'file');
    const ext = (name.split('.').pop() || '').toLowerCase();
    const dir = mkdtempSync(join(tmpdir(), 'cv-'));
    try {
      const rs = await fetch(url);
      if (!rs.ok) throw new Error('fetch_failed');
      const src = join(dir, 'src.' + (ext || 'bin'));
      writeFileSync(src, Buffer.from(await rs.arrayBuffer()));
      // @ts-ignore ffmpeg-static exports the binary path
      const ff = (await import('ffmpeg-static')).default as string;
      const p = await probe(ff, src);
      const isImage = /^(heic|heif|avif|tiff?|bmp)$/.test(ext) || p.isImage;
      if (isImage) {
        // a photo format browsers do not open becomes a JPEG; browser-native photos are kept as they are
        if (/^(jpe?g|png|webp|gif)$/.test(ext) && !p.rotated) return json({ url, name, converted: false, reason: 'image_ok' });
        const out = join(dir, 'out.jpg');
        await run(ff, ['-y', '-loglevel', 'error', '-i', src, '-vf', "scale='min(2000,iw)':-2", '-q:v', '3', out]);
        const s = await api(token, 'upload.sign', { name: name.replace(/\.[^.]+$/, '') + '.jpg' });
        await putFile(s.upload, readFileSync(out), 'image/jpeg');
        return json({ url: s.url, name: s.url.split('/').pop(), converted: true, reason: 'image_' + (ext || 'unknown') });
      }
      // a clip: H.264 + AAC in an mp4 that starts playing at once; already fine -> untouched
      const fine = ext === 'mp4' && p.video === 'h264' && (!p.audio || p.audio === 'aac') && !p.rotated && Math.max(p.w, p.h) <= 1920;
      if (fine) return json({ url, name, converted: false, reason: 'video_ok' });
      const out = join(dir, 'out.mp4');
      const args = ['-y', '-loglevel', 'error', '-i', src, '-vf', "scale='if(gt(iw,ih),min(1920,iw),-2)':'if(gt(iw,ih),-2,min(1920,ih))'", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
      if (p.audio) args.push('-c:a', 'aac', '-b:a', '128k'); else args.push('-an');
      args.push(out);
      await run(ff, args, { maxBuffer: 1 << 24 });
      const s = await api(token, 'upload.sign', { name: name.replace(/\.[^.]+$/, '') + '.mp4' });
      await putFile(s.upload, readFileSync(out), 'video/mp4');
      return json({ url: s.url, name: s.url.split('/').pop(), converted: true, reason: `video_${p.video || ext}${p.rotated ? '_rotated' : ''}` });
    } catch (e: any) {
      console.error('convert', e?.message || e, String(e?.stderr || '').slice(0, 300));
      return json({ error: 'convert_failed', detail: String(e?.message || e).slice(0, 120) }, 500);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
};

async function putFile(url: string, body: Buffer, type: string) {
  const r = await fetch(url, { method: 'PUT', headers: { 'content-type': type, 'x-upsert': 'true' }, body: new Uint8Array(body) });
  if (!r.ok) throw new Error('upload_failed ' + r.status + ' ' + (await r.text()).slice(0, 200));
}
