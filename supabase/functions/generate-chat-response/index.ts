import { db } from '../_shared/db.ts';
import { runAgentChat } from '../_shared/openai.ts';
import { getSetting, logEvent } from '../_shared/util.ts';
import { buildBrandContext, matchBrandInText, type BrandRow } from '../_shared/brand.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const fallbackSystemMessage = `אתה סוכן AI ארגוני הפועל דרך WhatsApp. החזר JSON תקין בלבד עם action, message_to_user, brief, missing_fields, question_round, ready_for_generation, safety, recommended_review, internal_notes. שאל רק שאלות חיוניות, אל תמציא מידע, ואל תבטיח פעולות שלא בוצעו.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const database = db();

  try {
    const { messages, questionRound } = await req.json();
    if (!Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'messages array required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const aiModels = await getSetting<{
      text_model?: string;
      system_message?: string;
    }>(database, 'ai_models');

    const transcript = messages
      .map((message: { role?: string; body?: string; imageName?: string }) => {
        const role = message.role === 'assistant' ? 'assistant' : 'user';
        const attachment = message.imageName ? ` [קובץ מצורף: ${message.imageName}]` : '';
        return `${role}: ${(message.body ?? '').trim()}${attachment}`;
      })
      .join('\n');

    // Match a place brand from the user's messages and inject its kit
    // (palette + style notes) so the brief respects the DB branding —
    // mirrors the WhatsApp worker pipeline.
    let systemMessage = aiModels?.system_message || fallbackSystemMessage;
    let matchedBrand: { id: string; name: string } | null = null;
    let brandPayload: {
      id: string;
      name: string;
      palette: Array<{ hex: string; role: string }>;
      style_notes: string | null;
    } | null = null;
    try {
      const userText = messages
        .filter((m: { role?: string; body?: string }) => m.role !== 'assistant' && m.body)
        .map((m: { body?: string }) => m.body)
        .join(' ');

      const { data: brands } = await database
        .from('brands')
        .select('id, name, aliases')
        .eq('is_active', true);

      matchedBrand = matchBrandInText((brands as BrandRow[]) ?? [], userText);
      if (matchedBrand) {
        const { data: brand } = await database
          .from('brands')
          .select('name, color_palette, style_notes, is_active')
          .eq('id', matchedBrand.id)
          .single();
        const brandContext = buildBrandContext(brand);
        if (brandContext) {
          systemMessage = `${systemMessage}\n\n${brandContext}`;
        }
        if (brand && brand.is_active !== false) {
          brandPayload = {
            id: matchedBrand.id,
            name: matchedBrand.name,
            palette: (brand.color_palette as Array<{ hex: string; role: string }>) ?? [],
            style_notes: (brand.style_notes as string | null) ?? null,
          };
        }
      }
    } catch (brandError) {
      await logEvent(database, {
        severity: 'warning',
        action: 'simulator_brand_lookup_failed',
        message: String(brandError),
      });
    }

    const result = await runAgentChat(systemMessage, transcript, {
      model: aiModels?.text_model || 'gpt-4o',
      questionRound: Number(questionRound ?? 0),
    });

    await logEvent(database, {
      action: 'simulator_chat_response',
      metadata: {
        model: aiModels?.text_model || 'gpt-4o',
        action: result.response?.action,
        ready_for_generation: result.response?.ready_for_generation,
        brand_id: matchedBrand?.id ?? null,
        brand_name: matchedBrand?.name ?? null,
      },
    });

    return new Response(JSON.stringify({ ok: true, ...result.response, brand: brandPayload }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    await logEvent(database, {
      severity: 'error',
      action: 'simulator_chat_response_failed',
      message: String(error),
    });

    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
