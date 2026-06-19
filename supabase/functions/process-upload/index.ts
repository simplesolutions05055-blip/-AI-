import { unzipSync, strFromU8 } from 'npm:fflate@0.8.2';
import { db } from '../_shared/db.ts';
import { transcribeAudio, describeImage } from '../_shared/openai.ts';
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

// Extract plain text from a .docx (which is a zip of XML parts). We read
// word/document.xml, turn paragraph/break tags into newlines and strip the
// remaining XML, then decode the handful of XML entities Word emits.
function extractDocxText(base64: string): string {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const files = unzipSync(bytes);
  const docXml = files['word/document.xml'];
  if (!docXml) return '';
  const xml = strFromU8(docXml);
  return xml
    .replace(/<w:p[ >]/g, '\n<w:p ')
    .replace(/<w:br\s*\/?>/g, '\n')
    .replace(/<w:tab\s*\/?>/g, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

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
      // Only .docx reaches the backend; .txt/.md are read on the client.
      text = extractDocxText(base64);
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
