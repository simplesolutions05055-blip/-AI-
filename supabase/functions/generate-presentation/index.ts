import { db } from '../_shared/db.ts';
import { generatePresentationOutline, generateDeckSlides, generateQuote, generateImage, generateImageWithReferences } from '../_shared/openai.ts';
import { getSetting, logEvent, recordUsageAndCost, estimateTextCost, estimateImageCost } from '../_shared/util.ts';
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
    const { brief, requestId, format, prompts, slideIndexes, captions, openai_key } = await req.json();
    const overrideKey = typeof openai_key === 'string' && openai_key.trim() ? openai_key.trim() : undefined;

    // 'images' mode: generate up to 3 AI images from explicit prompts (built by
    // the client from the deck's slides + brand palette) and return them as
    // base64. Used to embed AI visuals into the downloadable deck. When a
    // requestId is supplied we also persist each image to the outputs bucket and
    // record it in deck_ai_images, so the /revise screen can show and reuse them
    // for the next deck export without regenerating.
    if (format === 'images') {
      const list = Array.isArray(prompts) ? prompts.slice(0, 3) : [];
      if (!list.length) {
        return new Response(JSON.stringify({ error: 'prompts array required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const idxList = Array.isArray(slideIndexes) ? slideIndexes : [];
      const capList = Array.isArray(captions) ? captions : [];
      const aiModelsImg = await getSetting<{ image_model?: string; image_size?: string; image_quality?: string }>(database, 'ai_models');
      const brandId = (brief as { brand_id?: string } | null)?.brand_id ?? null;
      const logoReference = await loadBrandLogoReference(database, brandId);
      const images: Array<{ base64: string; mime: string; storagePath: string | null }> = [];
      for (let k = 0; k < list.length; k++) {
        const prompt = withLogoReferenceDirective(String(list[k] || 'תמונה'), !!logoReference);
        const generated = logoReference
          ? await generateImageWithReferences(prompt, [logoReference], {
              model: aiModelsImg?.image_model,
              size: aiModelsImg?.image_size || '1024x1024',
              quality: aiModelsImg?.image_quality || 'auto',
            })
          : await generateImage(prompt, {
              model: aiModelsImg?.image_model,
              size: aiModelsImg?.image_size || '1024x1024',
              quality: aiModelsImg?.image_quality || 'auto',
            });
        const { base64, mime } = generated;
        let storagePath: string | null = null;
        if (requestId) {
          try {
            const ext = (mime || 'image/png').includes('jpeg') ? 'jpg' : 'png';
            const path = `deck-ai/${requestId}/${Date.now()}-${k}.${ext}`;
            const { error: upErr } = await database.storage
              .from('outputs')
              .upload(path, decodeBase64(base64), { contentType: mime || 'image/png', upsert: true });
            if (!upErr) {
              storagePath = path;
              await database.from('deck_ai_images').insert({
                request_id: requestId,
                slide_index: Number(idxList[k] ?? 0) || 0,
                prompt,
                caption: capList[k] ? String(capList[k]) : null,
                storage_path: path,
                mime_type: mime || 'image/png',
              });
            }
          } catch (_e) {
            // Persistence is best-effort: a storage hiccup must not fail the deck.
          }
        }
        images.push({ base64, mime, storagePath });
      }
      await recordUsageAndCost(database, requestId ?? null, {
        provider: 'openai',
        model: aiModelsImg?.image_model || 'gpt-image-1',
        input: 0,
        output: 0,
        cost: estimateImageCost(images.length),
      });
      await logEvent(database, {
        action: 'deck_ai_images_generated',
        metadata: { count: images.length, request_id: requestId ?? null },
      });
      return new Response(JSON.stringify({ ok: true, images }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!brief || typeof brief !== 'object') {
      return new Response(JSON.stringify({ error: 'brief object required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 'deck' mode: return rich structured 10-slide content for the PDF renderer.
    if (format === 'deck') {
      const aiModelsDeck = await getSetting<{ system_message?: string; text_model?: string }>(database, 'ai_models');

      // Ground the deck in the brand's full Business Brain: pull every linked
      // text source (facts, messaging, services) + the brand kit, and fold them
      // into the brief so the model writes real per-slide copy from this content
      // — not generic placeholders.
      const deckBrandId = (brief as { brand_id?: string }).brand_id ?? null;
      if (deckBrandId) {
        const [{ data: deckBrand }, { data: deckTextSources }] = await Promise.all([
          database
            .from('brands')
            .select('name, color_palette, style_notes, is_active, client_type')
            .eq('id', deckBrandId)
            .single(),
          database
            .from('business_text_sources')
            .select('title, content, source_kind')
            .eq('brand_id', deckBrandId)
            .order('created_at', { ascending: false })
            .limit(12),
        ]);
        const deckBrain = buildBusinessBrainContext(deckBrand, deckTextSources ?? []);
        if (deckBrain.content) (brief as Record<string, unknown>).business_content_context = deckBrain.content;
        if (deckBrain.visual) (brief as Record<string, unknown>).brand_guidelines = deckBrain.visual;
      }

      // Use a dedicated deck-writer prompt — NOT the conversational WhatsApp
      // agent persona (ai_models.system_message), which forces its own chat JSON
      // shape and buries the slides under brief.presentation_spec.
      const { slides, usage } = await generateDeckSlides(fallbackSystemMessage, brief);
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

    // 'quote' mode: structured Hebrew price-quote JSON for the quote PDF renderer.
    if (format === 'quote') {
      const aiModelsQuote = await getSetting<{ text_model?: string }>(database, 'ai_models');

      // Ground the quote in the brand's Business Brain (facts/services), same as deck.
      const quoteBrandId = (brief as { brand_id?: string }).brand_id ?? null;
      let quoteBrandName: string | null = null;
      let quoteBrandColors: string[] = [];
      if (quoteBrandId) {
        const [{ data: qBrand }, { data: qSources }] = await Promise.all([
          database.from('brands').select('name, color_palette, style_notes, is_active, client_type').eq('id', quoteBrandId).single(),
          database.from('business_text_sources').select('title, content, source_kind').eq('brand_id', quoteBrandId).order('created_at', { ascending: false }).limit(12),
        ]);
        const qBrain = buildBusinessBrainContext(qBrand, qSources ?? []);
        if (qBrain.content) (brief as Record<string, unknown>).business_content_context = qBrain.content;
        if (qBrain.visual) (brief as Record<string, unknown>).brand_guidelines = qBrain.visual;
        quoteBrandName = (qBrand as { name?: string } | null)?.name ?? null;
        quoteBrandColors = ((qBrand as { color_palette?: Array<{ hex?: string }> } | null)?.color_palette ?? [])
          .map((c) => c?.hex)
          .filter((hex): hex is string => typeof hex === 'string' && /^#?[0-9a-fA-F]{3,8}$/.test(hex.trim()))
          .map((hex) => (hex.trim().startsWith('#') ? hex.trim() : `#${hex.trim()}`));
      }

      const { quote, usage } = await generateQuote(fallbackSystemMessage, brief, overrideKey);

      // Attach branding so the PDF renderer + on-screen preview can use the brand's
      // logo and palette (logo is inlined as a data URL so html2canvas can rasterize
      // it without a CORS round-trip).
      if (quoteBrandId) {
        const logoRef = await loadBrandLogoReference(database, quoteBrandId);
        (quote as Record<string, unknown>).brand = {
          name: quoteBrandName,
          logo_data_url: logoRef ? `data:${logoRef.mime};base64,${logoRef.base64}` : null,
          colors: quoteBrandColors,
        };
      }
      await recordUsageAndCost(database, requestId ?? null, {
        provider: 'openai',
        model: aiModelsQuote?.text_model || 'gpt-4o',
        input: usage?.prompt_tokens ?? 0,
        output: usage?.completion_tokens ?? 0,
        cost: estimateTextCost(usage?.prompt_tokens ?? 0, usage?.completion_tokens ?? 0),
      });
      await logEvent(database, {
        action: 'simulator_quote_generated',
        metadata: { request_id: requestId ?? null },
      });
      return new Response(JSON.stringify({ ok: true, quote }), {
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

    // Collect time-limited (tokenized) signed URLs to the brand's assets
    // (logo + graphic examples) so they can be pulled into the presentation.
    const SIGNED_URL_TTL = 60 * 60 * 24 * 7; // 7 days
    const assetLines: string[] = [];
    if (brandId) {
      try {
        const { data: brand } = await database
          .from('brands')
          .select('name, logo_path')
          .eq('id', brandId)
          .single();
        const { data: assets } = await database
          .from('brand_assets')
          .select('storage_path, caption')
          .eq('brand_id', brandId);

        const items: Array<{ path: string; caption: string }> = [];
        let logoSignedUrl: string | null = null;
        if (brand?.logo_path) items.push({ path: brand.logo_path as string, caption: 'לוגו רשמי' });
        for (const a of (assets as Array<{ storage_path: string; caption: string | null }>) ?? []) {
          items.push({ path: a.storage_path, caption: a.caption || 'תמונת מיתוג' });
        }

        for (const item of items) {
          const { data: signed } = await database.storage
            .from('branding')
            .createSignedUrl(item.path, SIGNED_URL_TTL);
          if (signed?.signedUrl) {
            assetLines.push(`- ${item.caption}: ${signed.signedUrl}`);
            if (item.caption === 'לוגו רשמי') logoSignedUrl = signed.signedUrl;
          }
        }

        if (brand?.logo_path) {
          (brief as Record<string, unknown>).brand_logo_url = logoSignedUrl;
          (brief as Record<string, unknown>).brand_logo_name = brand.name ?? null;
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

    // OpenAI out of quota/billing → 402 with a specific code so the client can
    // show a clear "credit ran out" message (and offer a one-off key) instead of
    // a generic 500.
    const msg = String(error);
    if (/insufficient_quota|exceeded your current quota|\b429\b|billing/i.test(msg)) {
      return new Response(JSON.stringify({ error: 'openai_quota', message: msg }), {
        status: 402,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function loadBrandLogoReference(
  database: ReturnType<typeof db>,
  brandId: string | null
): Promise<{ base64: string; mime: string; name: string } | null> {
  if (!brandId) return null;
  const { data: brand } = await database
    .from('brands')
    .select('name, logo_path')
    .eq('id', brandId)
    .maybeSingle();
  if (!brand?.logo_path) return null;
  const { data: file, error } = await database.storage.from('branding').download(brand.logo_path as string);
  if (error || !file) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = file.type || (String(brand.logo_path).toLowerCase().endsWith('.jpg') ? 'image/jpeg' : 'image/png');
  return {
    base64: encodeBase64(bytes),
    mime,
    name: `${brand.name || 'brand'}-official-logo.${mime.includes('jpeg') ? 'jpg' : 'png'}`,
  };
}

function withLogoReferenceDirective(prompt: string, hasLogoReference: boolean): string {
  if (!hasLogoReference) return prompt;
  return [
    prompt,
    'מצורפת תמונת רפרנס של הלוגו הרשמי של המותג. השתמש אך ורק בלוגו הזה, ללא המצאת סמל חלופי וללא ציור מחדש של לוגו אחר. שלב אותו כחלק טבעי, שקוף או חצי-שקוף, בתוך הקומפוזיציה.',
  ].join('\n\n');
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function encodeBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
