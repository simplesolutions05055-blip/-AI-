import { db } from '../_shared/db.ts';
import { runAgentChat } from '../_shared/openai.ts';
import {
  getSetting,
  logEvent,
  ensureSimulatorRequest,
  recordUsageAndCost,
  mapOutputType,
  estimateTextCost,
} from '../_shared/util.ts';
import { buildBusinessBrainContext, matchBrandInText, type BrandRow } from '../_shared/brand.ts';
import { buildSkillInstructions, applyBriefSkillGate, routeAmbiguousSkills } from '../_shared/skills.ts';

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
    const { messages, questionRound, requestId: incomingRequestId } = await req.json();
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
    // Presentation flow: batch all guiding questions into one message, never
    // show a brief while asking, and once enough info exists return a rich
    // 10-slide presentation_spec.
    systemMessage += `\n\nהנחיה למצגות (presentation_kit): כאשר המשתמש מבקש מצגת ואין מספיק מידע, שאל בהודעה אחת בלבד את כל השאלות החיוניות יחד (מטרה, קהל יעד, נקודות/מסרים מרכזיים, קריאה לפעולה) — שאלות קצרות בהודעה אחת, בלי בריף. ברגע שיש מספיק מידע (גם אם המשתמש לא ענה על הכול), החזר action=ready_to_generate עם presentation_spec הכולל slide_count=10 ו-slide_structure של בדיוק 10 שקפים, כאשר לכל שקף יש title ו-content אינפורמטיבי ועשיר בעברית. הסתמך על מה שהמשתמש כתב והרחב אותו לתוכן מלא.`;
    let matchedBrand: { id: string; name: string } | null = null;
    let clientType: string | null = null;
    let brandPayload: {
      id: string;
      name: string;
      palette: Array<{ hex: string; role: string }>;
      style_notes: string | null;
      logo_path: string | null;
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
          .select('name, color_palette, style_notes, is_active, logo_path, client_type')
          .eq('id', matchedBrand.id)
          .single();
        const { data: textSources } = await database
          .from('business_text_sources')
          .select('title, content, source_kind')
          .eq('brand_id', matchedBrand.id)
          .order('created_at', { ascending: false })
          .limit(12);
        clientType = (brand?.client_type as string | null) ?? null;
        const businessBrain = buildBusinessBrainContext(brand, textSources ?? []);
        if (businessBrain.combined) systemMessage = `${systemMessage}\n\n${businessBrain.combined}`;
        if (brand && brand.is_active !== false) {
          brandPayload = {
            id: matchedBrand.id,
            name: matchedBrand.name,
            palette: (brand.color_palette as Array<{ hex: string; role: string }>) ?? [],
            style_notes: (brand.style_notes as string | null) ?? null,
            logo_path: (brand.logo_path as string | null) ?? null,
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

    // Hybrid skill selection: deterministic (stage + client type) always runs;
    // on the first turn an LLM router adds any extra relevant skills for an
    // ambiguous request. Result feeds the editable, admin-managed skill set.
    let extraKeys: string[] = [];
    if (Number(questionRound ?? 0) === 0) {
      const routed = await routeAmbiguousSkills(database, transcript);
      extraKeys = routed.keys;
    }
    systemMessage += await buildSkillInstructions(database, 'brief', { clientType, extraKeys });

    const model = aiModels?.text_model || 'gpt-4o';
    const result = await runAgentChat(systemMessage, transcript, {
      model,
      questionRound: Number(questionRound ?? 0),
    });

    // Deterministic gate: block ready_to_generate while required skill fields
    // are missing (e.g. an event with no date). Final authority, in code.
    result.response = applyBriefSkillGate(result.response, transcript, { brandMatched: !!matchedBrand });

    // Track this simulator conversation as a request and accumulate its cost.
    let requestId: string | null = null;
    try {
      requestId = await ensureSimulatorRequest(database, incomingRequestId);
      if (requestId) {
        const usage = result.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
        await recordUsageAndCost(database, requestId, {
          provider: 'openai',
          model,
          input: usage.prompt_tokens,
          output: usage.completion_tokens,
          cost: estimateTextCost(usage.prompt_tokens, usage.completion_tokens),
        });
        const outputType = mapOutputType(result.response?.brief?.output_type);
        const email = result.response?.brief?.email || null;
        await database
          .from('requests')
          .update({
            ...(outputType ? { output_type: outputType } : {}),
            ...(email ? { customer_email: email } : {}),
          })
          .eq('id', requestId);
      }
    } catch (trackError) {
      await logEvent(database, {
        severity: 'warning',
        action: 'simulator_request_tracking_failed',
        message: String(trackError),
      });
    }

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

    return new Response(JSON.stringify({ ok: true, ...result.response, brand: brandPayload, requestId }), {
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
