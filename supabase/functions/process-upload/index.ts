import { db } from '../_shared/db.ts';
import { transcribeAudio, describeImage } from '../_shared/openai.ts';
import { extractDocxText, extractPdfText } from '../_shared/extract.ts';
import {
  getSetting,
  logEvent,
  recordUsageAndCost,
  estimateTextCost,
  estimateTranscriptionCost,
} from '../_shared/util.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const database = db();

  try {
    const { kind, base64, mime, name, requestId } = await req.json();
    if (!kind || !base64 || typeof base64 !== 'string') {
      return new Response(JSON.stringify({ error: 'kind and base64 required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // base64 inflates bytes by ~4/3; reject anything above the 25MB ceiling.
    if (base64.length * 0.75 > 25 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: 'file exceeds 25MB limit' }), {
        status: 413,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const aiModels = await getSetting<{
      transcribe_model?: string;
      vision_model?: string;
    }>(database, 'ai_models');

    let text = '';

    if (kind === 'document') {
      // .docx and .pdf reach the backend; .txt/.md are read on the client.
      const isPdf = /pdf/i.test(mime ?? '') || /\.pdf$/i.test(name ?? '');
      text = isPdf ? await extractPdfText(base64) : extractDocxText(base64);
    } else if (kind === 'audio') {
      const model = aiModels?.transcribe_model || 'gpt-4o-transcribe';
      const result = await transcribeAudio(base64, mime || 'audio/mpeg', name || 'audio', { model });
      text = result.text;
      await recordUsageAndCost(database, requestId ?? null, {
        provider: 'openai',
        model,
        output: 0,
        cost: estimateTranscriptionCost(),
      });
    } else if (kind === 'image') {
      const model = aiModels?.vision_model || 'gpt-4o';
      const result = await describeImage(base64, mime || 'image/png', { model });
      text = result.text;
      await recordUsageAndCost(database, requestId ?? null, {
        provider: 'openai',
        model,
        input: result.usage.prompt_tokens,
        output: result.usage.completion_tokens,
        cost: estimateTextCost(result.usage.prompt_tokens, result.usage.completion_tokens),
      });
    } else {
      return new Response(JSON.stringify({ error: `unsupported kind: ${kind}` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    await logEvent(database, {
      action: 'simulator_upload_processed',
      metadata: { kind, name: name ?? null, chars: text.length, request_id: requestId ?? null },
    });

    return new Response(JSON.stringify({ ok: true, kind, text }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    await logEvent(database, {
      severity: 'error',
      action: 'simulator_upload_failed',
      message: String(error),
    });

    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
