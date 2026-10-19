// PrimeOS produce - orchestrates real file production.
// For each job: reserves storage paths with signed upload URLs, sends the batch to the Vercel render
// service (Chromium + ffmpeg), and returns public URLs of the finished files.
// POST { brand, jobs:[{ id, kind, ...render params }] }   header x-primeos-token
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const ORIGINS = ['https://app.primeos.co.il', 'https://ai-mggo.vercel.app', 'http://localhost:5173', 'http://localhost:4173', 'http://localhost:8080'];
const cors = (req: Request) => {
  const o = req.headers.get('origin') ?? '';
  return { 'access-control-allow-origin': ORIGINS.includes(o) ? o : ORIGINS[0], 'access-control-allow-headers': 'content-type, x-primeos-token, apikey, authorization', 'access-control-allow-methods': 'POST, OPTIONS', vary: 'origin' };
};
const json = (req: Request, b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors(req), 'content-type': 'application/json; charset=utf-8' } });
const RENDER_URL = Deno.env.get('PRIMEOS_RENDER_URL') ?? 'https://app.primeos.co.il/api/render';
const OUTS: Record<string, [string, string][]> = {
  graphic: [['main', 'jpg']], doc: [['main', 'pdf'], ['p1', 'jpg']],
  deck: [['main', 'pdf'], ['pptx', 'pptx'], ...Array.from({ length: 12 }, (_, i) => ['s' + (i + 1), 'jpg'] as [string, string])],
  video: [['main', 'mp4']], edit: [['main', 'mp4']],
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405);
  const d = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const token = req.headers.get('x-primeos-token')?.trim() ?? '';
  const { data: t } = await d.from('api_tokens').select('org_id').eq('token', token).maybeSingle();
  const { data: a } = t ? { data: null } : await d.from('admin_tokens').select('admin_id').eq('token', token).maybeSingle();
  if (!t && !a) return json(req, { error: 'invalid_token' }, 401);
  let p: any;
  try { p = await req.json(); } catch { return json(req, { error: 'bad_json' }, 400); }
  const jobs: any[] = (p.jobs ?? []).slice(0, 12);
  const batch = `${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
  const urls: Record<string, Record<string, string>> = {};
  try {
    for (const j of jobs) {
      j.uploads = {};
      urls[j.id] = {};
      for (const [key, ext] of OUTS[j.kind] ?? []) {
        const path = `out/${t?.org_id ?? 'admin'}/${batch}/${j.id}${key === 'main' ? '' : '-' + key}.${ext}`;
        const s = await d.storage.from('v2-content').createSignedUploadUrl(path);
        if (s.error) throw s.error;
        j.uploads[key] = s.data.signedUrl;
        urls[j.id][key] = d.storage.from('v2-content').getPublicUrl(path).data.publicUrl;
      }
    }
    // videos (or explicit async) render in the background; the caller polls status.json / the file urls
    const async = !!p.async || jobs.some((j) => j.kind === 'video' || j.kind === 'edit');
    let statusUrl: string | undefined, statusUpload: string | undefined;
    if (async) {
      const sp = `out/${t?.org_id ?? 'admin'}/${batch}/status.json`;
      const s = await d.storage.from('v2-content').createSignedUploadUrl(sp);
      if (s.error) throw s.error;
      statusUpload = s.data.signedUrl;
      statusUrl = d.storage.from('v2-content').getPublicUrl(sp).data.publicUrl;
    }
    const r = await fetch(RENDER_URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-primeos-token': token }, body: JSON.stringify({ brand: p.brand ?? {}, jobs, async, statusUpload }) });
    const txt = await r.text();
    let res: any;
    try { res = JSON.parse(txt); } catch { throw new Error('render_bad_response ' + r.status + ' ' + txt.slice(0, 200)); }
    if (!r.ok) throw new Error('render_failed ' + r.status + ' ' + (res.error ?? ''));
    if (async) return json(req, { ok: true, batch, pending: true, status: statusUrl, results: jobs.map((j) => ({ id: j.id, urls: urls[j.id] })) });
    return json(req, { ok: true, batch, results: (res.results ?? []).map((x: any) => ({ ...x, urls: x.ok ? urls[x.id] : undefined })) });
  } catch (e) {
    return json(req, { error: e instanceof Error ? e.message : String((e as any)?.message ?? e) }, 500);
  }
});
