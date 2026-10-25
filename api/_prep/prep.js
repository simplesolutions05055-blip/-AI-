// The preparation script that runs inside a Vercel Sandbox (node 24) for the "edit an existing video" path.
// Kept as a string so the API function ships it without bundling tricks. It installs ffmpeg, and for every clip
// writes: info (duration, size, fps, sound), a 480p/5fps analysis proxy, the sound alone, scene cuts, silences and
// thumbnails. Each file goes to storage through a signed upload URL; a summary JSON closes the run.
export const PREP_SCRIPT = String.raw`
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const job = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const note = (t) => { try { writeFileSync('progress.txt', t); } catch {} console.log(t); };
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts });

note('installing ffmpeg');
let FF = '', FP = '';
try {
  execFileSync('npm', ['i', '--no-audit', '--no-fund', '--silent', 'ffmpeg-static@5.2.0', 'ffprobe-static@3.1.0'], { stdio: 'inherit' });
  const req = createRequire(import.meta.url);
  FF = req('ffmpeg-static'); FP = req('ffprobe-static').path;
} catch (e) { console.error('ffmpeg install failed', e && e.message); process.exit(2); }

async function put(path, upload, type) {
  const body = readFileSync(path);
  for (let k = 0; k < 3; k++) {
    const r = await fetch(upload, { method: 'PUT', headers: { 'content-type': type, 'x-upsert': 'true' }, body });
    if (r.ok) return body.length;
    await new Promise((res) => setTimeout(res, 1500 * (k + 1)));
  }
  throw new Error('upload failed ' + path);
}
async function get(url, path) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('download failed ' + r.status);
  writeFileSync(path, Buffer.from(await r.arrayBuffer()));
}
const probe = (f) => JSON.parse(sh(FP, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', f]).stdout || '{}');
const nums = (re, txt) => { const out = []; let m; while ((m = re.exec(txt))) out.push(+m[1]); return out; };

const summary = { clips: [] };
for (let i = 0; i < job.clips.length; i++) {
  const c = job.clips[i];
  const dir = 'c' + i; mkdirSync(dir, { recursive: true });
  const src = dir + '/src';
  note('clip ' + (i + 1) + '/' + job.clips.length + ': download');
  await get(c.url, src);
  const info = probe(src);
  const v = (info.streams || []).find((s) => s.codec_type === 'video') || {};
  const a = (info.streams || []).find((s) => s.codec_type === 'audio');
  const dur = +(info.format && info.format.duration) || 0;
  const rot = Math.abs(+(((v.side_data_list || []).find((x) => x.rotation != null) || {}).rotation || v.tags && v.tags.rotate || 0));
  const w = rot === 90 || rot === 270 ? v.height : v.width, h = rot === 90 || rot === 270 ? v.width : v.height;
  const fpsS = String(v.avg_frame_rate || v.r_frame_rate || '30/1').split('/');
  const fps = +fpsS[0] / (+fpsS[1] || 1);
  const out = { i, name: c.name || '', url: c.url, sec: +dur.toFixed(2), w, h, fps: +fps.toFixed(2), audio: !!a, files: {} };
  note('clip ' + (i + 1) + ': proxy');
  const prox = dir + '/proxy.mp4';
  sh(FF, ['-y', '-loglevel', 'error', '-i', src, '-vf', 'scale=-2:480,fps=5', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p', ...(a ? ['-c:a', 'aac', '-ac', '1', '-b:a', '48k'] : ['-an']), '-movflags', '+faststart', prox]);
  if (existsSync(prox) && c.out.proxy) { await put(prox, c.out.proxy.upload, 'video/mp4'); out.files.proxy = c.out.proxy.url; }
  if (a && c.out.audio) {
    note('clip ' + (i + 1) + ': sound');
    const au = dir + '/audio.mp3';
    sh(FF, ['-y', '-loglevel', 'error', '-i', src, '-vn', '-ac', '1', '-ar', '22050', '-b:a', '64k', au]);
    if (existsSync(au)) { await put(au, c.out.audio.upload, 'audio/mpeg'); out.files.audio = c.out.audio.url; }
    // a cleaned copy of the sound for the edit (wind, hum and hiss down, speech band kept, even loudness): used when the
    // voice-isolation service is not available. Full length, so it stays aligned with the clip's own time.
    if (c.out.clean) {
      const cl = dir + '/clean.m4a';
      sh(FF, ['-y', '-loglevel', 'error', '-i', src, '-vn', '-af', 'highpass=f=85,lowpass=f=11000,afftdn=nr=14:nf=-30:tn=1,loudnorm=I=-16:TP=-1.5:LRA=11', '-ac', '2', '-ar', '48000', '-c:a', 'aac', '-b:a', '160k', cl]);
      if (existsSync(cl)) { await put(cl, c.out.clean.upload, 'audio/mp4'); out.files.clean = c.out.clean.url; }
    }
    // the loudness of the sound: how much of the clip is quiet (useful to know what is worth keeping)
    const sil = sh(FF, ['-i', src, '-vn', '-af', 'silencedetect=noise=-35dB:d=0.6', '-f', 'null', '-']).stderr || '';
    const starts = nums(/silence_start: ([\d.]+)/g, sil), ends = nums(/silence_end: ([\d.]+)/g, sil);
    out.silence = starts.map((s, k) => [+s.toFixed(2), +(ends[k] != null ? ends[k] : dur).toFixed(2)]);
    const quiet = out.silence.reduce((t, x) => t + (x[1] - x[0]), 0);
    out.quietRatio = dur ? +(quiet / dur).toFixed(2) : 1;
  } else { out.silence = []; out.quietRatio = 1; }
  note('clip ' + (i + 1) + ': scenes');
  const sc = sh(FF, ['-i', prox, '-an', '-vf', "select='gt(scene,0.32)',showinfo", '-f', 'null', '-']).stderr || '';
  out.cuts = nums(/pts_time:([\d.]+)/g, sc).map((t) => +t.toFixed(2)).filter((t, k, arr) => k === 0 || t - arr[k - 1] > 0.8).slice(0, 60);
  note('clip ' + (i + 1) + ': thumbnails');
  const n = Math.max(1, Math.min(job.thumbs || 12, Math.round(dur / 2)));
  const every = Math.max(0.5, dur / n);
  sh(FF, ['-y', '-loglevel', 'error', '-i', src, '-vf', 'fps=1/' + every.toFixed(3) + ',scale=320:-2', '-q:v', '4', '-frames:v', String(n), dir + '/t%02d.jpg']);
  out.thumbs = [];
  const files = readdirSync(dir).filter((f) => /^t\d+\.jpg$/.test(f)).sort();
  for (let k = 0; k < files.length; k++) {
    const key = 't' + k;
    if (!c.out[key]) break;
    await put(dir + '/' + files[k], c.out[key].upload, 'image/jpeg');
    out.thumbs.push({ t: +(k * every + every / 2).toFixed(1), url: c.out[key].url });
  }
  summary.clips.push(out);
  // free the disk for the next clip
  try { sh('rm', ['-f', src]); } catch {}
}
note('summary');
writeFileSync('summary.json', JSON.stringify(summary));
await put('summary.json', job.summaryUpload, 'application/json');
note('done');
`;
