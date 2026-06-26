import { db } from '../_shared/db.ts';
import { logEvent } from '../_shared/util.ts';

// Gamma Generate API (beta) bridge. The Gamma API key is a server-side secret
// (GAMMA_API_KEY) and must never reach the browser, so all calls go through here.
//
// Flow is asynchronous on Gamma's side:
//   action 'start'  → POST a generation, returns { generationId }
//   action 'status' → GET the generation; while pending returns { status }, and
//                     once completed downloads the exported PPTX server-side and
//                     returns it as base64 (avoids browser CORS against Gamma's
//                     file host).
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const GAMMA_BASE = 'https://public-api.gamma.app/v0.2/generations';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function encodeBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// Map a Gamma error body to a 402 quota signal (mirrors the openai_quota pattern)
// or a generic message.
function gammaError(status: number, body: string) {
  if (status === 429 || /credit|quota|insufficient|limit/i.test(body)) {
    return json({ error: 'gamma_quota', message: body }, 402);
  }
  return json({ error: `Gamma API error (${status}): ${body}` }, 502);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const database = db();
  const apiKey = Deno.env.get('GAMMA_API_KEY');
  if (!apiKey) return json({ error: 'Missing GAMMA_API_KEY (Supabase secret)' }, 500);

  try {
    const payload = await req.json();
    const action = payload?.action;

    if (action === 'start') {
      // The client builds the full Gamma request body (deck.ts buildGammaRequestBody)
      // so the JSON it previews is exactly what we forward here. We only validate
      // the essentials and attach the secret API key.
      const body = payload?.gammaBody && typeof payload.gammaBody === 'object' ? payload.gammaBody : null;
      if (!body || !String(body.inputText ?? '').trim()) {
        return json({ error: 'gammaBody with inputText required' }, 400);
      }

      const res = await fetch(GAMMA_BASE, {
        method: 'POST',
        headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) return gammaError(res.status, text);

      const data = JSON.parse(text || '{}');
      const generationId = data?.generationId ?? data?.id;
      if (!generationId) return json({ error: `Unexpected Gamma response: ${text}` }, 502);

      await logEvent(database, { action: 'gamma_generation_started', metadata: { generationId } });
      return json({ ok: true, generationId });
    }

    if (action === 'status') {
      const generationId = String(payload?.generationId ?? '').trim();
      if (!generationId) return json({ error: 'generationId required' }, 400);

      const res = await fetch(`${GAMMA_BASE}/${encodeURIComponent(generationId)}`, {
        headers: { 'X-API-KEY': apiKey },
      });
      const text = await res.text();
      if (!res.ok) return gammaError(res.status, text);

      const data = JSON.parse(text || '{}');
      const status = data?.status ?? 'pending';

      if (status !== 'completed') {
        return json({ ok: true, status, gammaUrl: data?.gammaUrl ?? null });
      }

      // Completed → locate the exported PPTX URL across the shapes Gamma may use.
      const fileUrl: string | null =
        data?.pptxUrl ?? data?.exportUrl ?? data?.export?.pptxUrl ?? data?.urls?.pptx ?? null;
      if (!fileUrl) return json({ error: `Completed but no PPTX URL: ${text}` }, 502);

      // Fetch the file server-side so the browser isn't blocked by Gamma's CORS.
      const fileRes = await fetch(fileUrl);
      if (!fileRes.ok) return json({ error: `PPTX download failed (${fileRes.status})` }, 502);
      const bytes = new Uint8Array(await fileRes.arrayBuffer());

      await logEvent(database, {
        action: 'gamma_generation_completed',
        metadata: { generationId, bytes: bytes.length },
      });
      return json({ ok: true, status: 'completed', gammaUrl: data?.gammaUrl ?? null, pptxBase64: encodeBase64(bytes) });
    }

    return json({ error: 'Unknown action (expected "start" or "status")' }, 400);
  } catch (error) {
    await logEvent(database, { severity: 'error', action: 'gamma_generation_failed', message: String(error) });
    return json({ error: String(error) }, 500);
  }
});
