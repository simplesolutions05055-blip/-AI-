import { db } from '../_shared/db.ts';
import { generateImage } from '../_shared/openai.ts';
import { getSetting, logEvent, recordUsageAndCost, estimateImageCost } from '../_shared/util.ts';
import { AbuseGuardError, enforceAiLimit, enforceRequestCost, loadRequestActor } from '../_shared/abuseGuard.ts';

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
    const { prompt, size, quality, requestId } = await req.json();
    if (!prompt || typeof prompt !== 'string') {
      return new Response(JSON.stringify({ error: 'prompt required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (requestId) {
      const actor = await loadRequestActor(database, requestId);
      await enforceRequestCost(database, requestId);
      await enforceAiLimit(database, actor, { kind: 'generation', promptChars: prompt.length, estimatedCost: estimateImageCost(1) });
    } else {
      await enforceAiLimit(database, { ip: req.headers.get('x-forwarded-for') ?? req.headers.get('cf-connecting-ip') }, {
        kind: 'generation',
        promptChars: prompt.length,
        estimatedCost: estimateImageCost(1),
      });
    }

    const aiModels = await getSetting<{
      text_model?: string;
      image_model?: string;
      image_size?: string;
      image_quality?: string;
      system_message?: string;
    }>(database, 'ai_models');
    const model = aiModels?.image_model || 'gpt-image-2';
    const image = await generateImage(prompt, {
      model,
      size: size || aiModels?.image_size || '1024x1024',
      quality: quality || aiModels?.image_quality || 'auto',
      systemMessage: aiModels?.system_message,
    });

    await recordUsageAndCost(database, requestId ?? null, {
      provider: 'openai',
      model: image.model,
      output: 1,
      cost: estimateImageCost(1),
    });

    await logEvent(database, {
      action: 'simulator_image_generated',
      metadata: { model: image.model, size: size || '1024x1024', quality: quality || 'auto', request_id: requestId ?? null },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        model: image.model,
        mime: image.mime,
        base64: image.base64,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    if (error instanceof AbuseGuardError) {
      return new Response(JSON.stringify({ error: error.message, code: error.code }), {
        status: error.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    await logEvent(database, {
      severity: 'error',
      action: 'simulator_image_generation_failed',
      message: String(error),
    });

    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
