// Builds a real, branded Hebrew (RTL) PPTX from the deck's slide content using
// Claude's official `pptx` Agent Skill running in Anthropic's code-execution
// sandbox. The ANTHROPIC_API_KEY is a Supabase secret and never reaches the
// browser.
//
// The Claude code-execution run takes 1–3 minutes — longer than a synchronous
// Edge Function request survives (the gateway times out ~150s). So this runs
// ASYNCHRONOUSLY:
//   action 'start'  → kicks the job off in the background (EdgeRuntime.waitUntil),
//                     returns { jobId } immediately.
//   action 'status' → reads the job's status file from storage; when done,
//                     returns the PPTX as base64.
// Job state + the produced file live in the `outputs` bucket under pptx-jobs/.
import Anthropic from 'npm:@anthropic-ai/sdk@0.65.0';
import { db } from '../_shared/db.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MODEL = 'claude-sonnet-4-6';
const BETAS = ['code-execution-2025-08-25', 'files-api-2025-04-14', 'skills-2025-10-02'];
const BUCKET = 'outputs';
const jobDir = (jobId: string) => `pptx-jobs/${jobId}`;

type Database = ReturnType<typeof db>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function bytesFromDataUrl(dataUrl: string): { bytes: Uint8Array; mime: string } {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  const mime = m?.[1] ?? 'image/png';
  const bin = atob(m?.[2] ?? '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, mime };
}

function encodeBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

function collectFileIds(node: unknown, out: Set<string>) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collectFileIds(item, out);
    return;
  }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === 'file_id' && typeof v === 'string') out.add(v);
    else collectFileIds(v, out);
  }
}

function buildPrompt(opts: {
  inputText: string;
  brandName?: string | null;
  palette?: Array<{ hex?: string; role?: string }> | null;
  numImages: number;
}): string {
  const paletteLine = (opts.palette ?? [])
    .filter((c) => c?.hex)
    .map((c) => `${c.role ?? 'צבע'}: ${c.hex}`)
    .join(', ');
  return [
    'צור מצגת PowerPoint מקצועית בעברית מתוך התוכן שמופיע למטה.',
    'דרישות עיצוב מחייבות:',
    '- יחס 16:9.',
    '- כתיבה וכיוון מימין לשמאל (RTL): הגדר לכל run את rtl=True, ויישר את כל הטקסט לימין (alignment = PP_ALIGN.RIGHT).',
    '- שתמש בפונט עברי קריא (למשל "Arial" או "David").',
    '- מעט טקסט בכל שקופית, היררכיית טקסט ברורה, כותרת + עד 3-4 נקודות.',
    '- עיצוב נקי ומודרני, מעניין ושונה לאורך השקפים, עם צורות ומספרים גדולים היכן שמתאים.',
    '- אל תשתמש בתבנית PowerPoint קיימת — בנה את כל העיצוב מאפס.',
    opts.brandName ? `- התאם את הטון והסגנון למותג "${opts.brandName}".` : '',
    paletteLine ? `- פלטת צבעי המותג: ${paletteLine}. השתמש בהם בכותרות, ברקעים ובהדגשות.` : '',
    opts.numImages > 0
      ? `- צורפו ${opts.numImages} תמונות מותג (התמונה הראשונה היא בדרך כלל הלוגו). שבץ את הלוגו בשקופית השער ובפינות, ואת שאר התמונות בשקפי התוכן המתאימים.`
      : '',
    '',
    'שמור את הקובץ הסופי בפורמט .pptx.',
    '',
    '=== תוכן השקופיות ===',
    opts.inputText,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

async function writeStatus(database: Database, jobId: string, status: Record<string, unknown>) {
  await database.storage.from(BUCKET).upload(`${jobDir(jobId)}/status.json`, new Blob([JSON.stringify(status)]), {
    contentType: 'application/json',
    upsert: true,
  });
}

// The long-running job — runs in the background after the start response is sent.
async function runJob(database: Database, apiKey: string, jobId: string, payload: any) {
  try {
    await writeStatus(database, jobId, { status: 'processing' });
    const inputText = String(payload?.inputText ?? '').trim();
    const brandName = typeof payload?.brandName === 'string' ? payload.brandName : null;
    const palette = Array.isArray(payload?.palette) ? payload.palette : null;
    const images: Array<{ dataUrl: string }> = Array.isArray(payload?.images) ? payload.images.slice(0, 8) : [];

    const client = new Anthropic({ apiKey });

    const fileIds: string[] = [];
    for (let i = 0; i < images.length; i++) {
      try {
        const { bytes, mime } = bytesFromDataUrl(images[i].dataUrl);
        const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : 'png';
        const file = new File([bytes], `brand-${i}.${ext}`, { type: mime });
        const uploaded = await client.beta.files.upload({ file, betas: ['files-api-2025-04-14'] });
        if (uploaded?.id) fileIds.push(uploaded.id);
      } catch (_e) {
        /* best-effort */
      }
    }

    const prompt = buildPrompt({ inputText, brandName, palette, numImages: fileIds.length });
    const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }];
    for (const id of fileIds) content.push({ type: 'container_upload', file_id: id });

    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      betas: BETAS,
      container: { skills: [{ type: 'anthropic', skill_id: 'pptx', version: 'latest' }] },
      tools: [{ type: 'code_execution_20250825', name: 'code_execution' }],
      messages: [{ role: 'user', content }],
    } as never);

    const final = await stream.finalMessage();

    const ids = new Set<string>();
    collectFileIds(final.content, ids);
    for (const id of fileIds) ids.delete(id);

    let pptxBytes: Uint8Array | null = null;
    let pptxName = 'presentation.pptx';
    for (const id of ids) {
      try {
        const meta = await client.beta.files.retrieveMetadata(id, { betas: ['files-api-2025-04-14'] });
        const name = String((meta as { filename?: string })?.filename ?? '');
        if (!name.toLowerCase().endsWith('.pptx')) continue;
        const dl = await client.beta.files.download(id, { betas: ['files-api-2025-04-14'] });
        pptxBytes = new Uint8Array(await dl.arrayBuffer());
        pptxName = name;
        break;
      } catch (_e) {
        /* try next */
      }
    }

    if (!pptxBytes) {
      await writeStatus(database, jobId, { status: 'error', error: 'Claude לא יצר קובץ PPTX. נסו שוב או צמצמו תוכן.' });
      return;
    }

    await database.storage.from(BUCKET).upload(`${jobDir(jobId)}/deck.pptx`, pptxBytes, {
      contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      upsert: true,
    });
    await writeStatus(database, jobId, { status: 'done', fileName: pptxName });
  } catch (error) {
    await writeStatus(database, jobId, { status: 'error', error: String((error as { message?: string })?.message ?? error) });
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'Missing ANTHROPIC_API_KEY (Supabase secret)' }, 500);

  const database = db();
  try {
    const payload = await req.json();
    const action = payload?.action;
    const jobId = String(payload?.jobId ?? '').trim();
    if (!jobId) return json({ error: 'jobId required' }, 400);

    if (action === 'start') {
      if (!String(payload?.inputText ?? '').trim()) return json({ error: 'inputText required' }, 400);
      // Kick the job off in the background; respond immediately so the client
      // isn't holding a request open past the gateway timeout.
      (globalThis as any).EdgeRuntime?.waitUntil(runJob(database, apiKey, jobId, payload));
      return json({ ok: true, jobId, status: 'processing' });
    }

    if (action === 'status') {
      const { data, error } = await database.storage.from(BUCKET).download(`${jobDir(jobId)}/status.json`);
      if (error || !data) return json({ ok: true, status: 'processing' });
      const state = JSON.parse(await data.text());
      if (state.status === 'done') {
        const { data: file } = await database.storage.from(BUCKET).download(`${jobDir(jobId)}/deck.pptx`);
        if (!file) return json({ ok: true, status: 'processing' });
        const bytes = new Uint8Array(await file.arrayBuffer());
        return json({ ok: true, status: 'done', fileName: state.fileName ?? 'presentation.pptx', pptxBase64: encodeBase64(bytes) });
      }
      return json({ ok: true, status: state.status ?? 'processing', error: state.error ?? null });
    }

    return json({ error: 'Unknown action (expected "start" or "status")' }, 400);
  } catch (error) {
    return json({ error: String((error as { message?: string })?.message ?? error) }, 500);
  }
});
