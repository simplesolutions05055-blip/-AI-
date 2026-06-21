import { db } from '../_shared/db.ts';
import { generatePresentationOutline, generateDeckSlides } from '../_shared/openai.ts';
import { getSetting, logEvent, recordUsageAndCost, estimateTextCost } from '../_shared/util.ts';
import { buildBusinessBrainContext } from '../_shared/brand.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const fallbackSystemMessage =
  'אתה סוכן AI ארגוני. הפק חבילת תוכן למצגת בעברית RTL: שם מצגת, מטרה, מבנה שקפים, תוכן מלא לכל שקף, הנחיות עיצוב, ו-Prompt מוכן ל-NotebookLM.';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const database = db();

  try {
    const { brief, requestId, format } = await req.json();
    if (!brief || typeof brief !== 'object') {
      return new Response(JSON.stringify({ error: 'brief object required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 'deck' mode: return rich structured 10-slide content for the PDF renderer.
    if (format === 'deck') {
      const aiModelsDeck = await getSetting<{ system_message?: string; text_model?: string }>(database, 'ai_models');
      const { slides, usage } = await generateDeckSlides(
        aiModelsDeck?.system_message || fallbackSystemMessage,
        brief
      );
      await recordUsageAndCost(database, requestId ?? null, {
        provider: 'openai',
        model: aiModelsDeck?.text_model || 'gpt-4o',
        input: usage?.prompt_tokens ?? 0,
        output: usage?.completion_tokens ?? 0,
        cost: estimateTextCost(usage?.prompt_tokens ?? 0, usage?.completion_tokens ?? 0),
      });
      await logEvent(database, {
        action: 'simulator_deck_generated',
        metadata: { slide_count: slides.length, request_id: requestId ?? null },
      });
      return new Response(JSON.stringify({ ok: true, slides }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Load separated Business Brain context. Text sources guide content only;
    // brand/assets guide visuals only.
    const brandId = (brief as { brand_id?: string }).brand_id ?? null;
    if (brandId) {
      const [{ data: brand }, { data: textSources }] = await Promise.all([
        database
          .from('brands')
          .select('name, color_palette, style_notes, is_active, client_type')
          .eq('id', brandId)
          .single(),
        database
          .from('business_text_sources')
          .select('title, content, source_kind')
          .eq('brand_id', brandId)
          .order('created_at', { ascending: false })
          .limit(12),
      ]);
      const businessBrain = buildBusinessBrainContext(brand, textSources ?? []);
      if (businessBrain.content) (brief as Record<string, unknown>).business_content_context = businessBrain.content;
      if (businessBrain.visual) (brief as Record<string, unknown>).brand_guidelines = businessBrain.visual;
    }

    // Collect time-limited (tokenized) signed URLs to the city's brand images
    // (graphic examples + logo) so they can be pulled into the presentation.
    const SIGNED_URL_TTL = 60 * 60 * 24 * 7; // 7 days
    const assetLines: string[] = [];
    if (brandId) {
      try {
        const { data: brand } = await database
          .from('brands')
          .select('logo_path')
          .eq('id', brandId)
          .single();
        const { data: assets } = await database
          .from('brand_assets')
          .select('storage_path, caption')
          .eq('brand_id', brandId);

        const items: Array<{ path: string; caption: string }> = [];
        if (brand?.logo_path) items.push({ path: brand.logo_path as string, caption: 'לוגו רשמי' });
        for (const a of (assets as Array<{ storage_path: string; caption: string | null }>) ?? []) {
          items.push({ path: a.storage_path, caption: a.caption || 'תמונת מיתוג' });
        }

        for (const item of items) {
          const { data: signed } = await database.storage
            .from('branding')
            .createSignedUrl(item.path, SIGNED_URL_TTL);
          if (signed?.signedUrl) assetLines.push(`- ${item.caption}: ${signed.signedUrl}`);
        }
      } catch (assetError) {
        await logEvent(database, {
          severity: 'warning',
          action: 'simulator_presentation_assets_failed',
          message: String(assetError),
        });
      }
    }

    const aiModels = await getSetting<{ system_message?: string; text_model?: string }>(database, 'ai_models');
    const { text, usage } = await generatePresentationOutline(
      aiModels?.system_message || fallbackSystemMessage,
      brief,
      assetLines.length ? assetLines.join('\n') : undefined
    );

    // Always append an explicit links section so the URLs are present even if
    // the model omits some — these are open, tokenized, time-limited links.
    const textWithAssets = assetLines.length
      ? `${text}\n\n---\n\n## תמונות מהמיתוג (קישורים פתוחים, תקפים ל-7 ימים)\n\n${assetLines.join(
          '\n'
        )}\n\n_הקישורים כוללים טוקן גישה חד-פעמי. ניתן להוריד את התמונות ולהזין אותן ל-NotebookLM._`
      : text;

    await recordUsageAndCost(database, requestId ?? null, {
      provider: 'openai',
      model: aiModels?.text_model || 'gpt-4o',
      input: usage?.prompt_tokens ?? 0,
      output: usage?.completion_tokens ?? 0,
      cost: estimateTextCost(usage?.prompt_tokens ?? 0, usage?.completion_tokens ?? 0),
    });

    await logEvent(database, {
      action: 'simulator_presentation_generated',
      metadata: {
        brand_name: (brief as { brand_name?: string }).brand_name ?? null,
        request_id: requestId ?? null,
        asset_count: assetLines.length,
      },
    });

    return new Response(JSON.stringify({ ok: true, text: textWithAssets }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    await logEvent(database, {
      severity: 'error',
      action: 'simulator_presentation_failed',
      message: String(error),
    });

    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
