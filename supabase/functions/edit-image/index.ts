// Edge Function: edit-image — revise an existing image output (img2img).
// Takes the source output + the user's feedback, runs an OpenAI image edit, and
// stores the result as a NEW production-form request/output so it shows up in the
// Files screen and request history like any other deliverable.
import { db } from '../_shared/db.ts';
import { editImage } from '../_shared/openai.ts';
import { getSetting, logEvent, recordUsageAndCost, estimateImageCost } from '../_shared/util.ts';
import { AbuseGuardError, enforceAiLimit, enforceRequestCost, loadRequestActor } from '../_shared/abuseGuard.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const RTL_IMAGE_DIRECTIVE =
  'דרישת RTL מחייבת: כל הטקסט העברי בתמונה מיושר לימין ונקרא מימין לשמאל. ' +
  'בכל שורת מידע / יחידת אייקון+תווית האייקון בצד ימין והטקסט זורם משמאלו. ' +
  'אסור פריסה בלוגיקת LTR.';

interface Body {
  request_id?: string;
  feedback?: string;
  // Optional reference image (already uploaded to the outputs bucket by the
  // client) whose subject should be blended into the edited graphic.
  reference_path?: string;
  reference_mime?: string;
  // Attribution for the WhatsApp flow (server-to-server calls carry the
  // identified user); browser calls omit it and inherit the source request's.
  created_by?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  const database = db();
  try {
    const body = (await req.json()) as Body;
    const sourceRequestId = body.request_id;
    const feedback = (body.feedback ?? '').trim();
    const referencePath = (body.reference_path ?? '').trim();
    if (!sourceRequestId) return json({ error: 'request_id required' }, 400);
    if (!feedback && !referencePath) return json({ error: 'feedback required' }, 400);

    // Latest image output of the source request.
    const { data: output } = await database
      .from('outputs')
      .select('storage_path, mime_type, output_type, text_content')
      .eq('request_id', sourceRequestId)
      .eq('output_type', 'image')
      .not('storage_path', 'is', null)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!output?.storage_path) return json({ error: 'source image not found' }, 404);

    // Original brief — fed back in as context so the edit stays on-brand.
    const { data: sourceReq } = await database
      .from('requests')
      .select('structured_brief, brand_id, created_by')
      .eq('id', sourceRequestId)
      .single();
    const sourceBrief = (sourceReq?.structured_brief ?? {}) as Record<string, unknown>;
    const actor = await loadRequestActor(database, sourceRequestId);
    await enforceRequestCost(database, sourceRequestId);
    await enforceAiLimit(database, actor, {
      kind: 'generation',
      promptChars: feedback.length + JSON.stringify(sourceBrief).length,
      estimatedCost: estimateImageCost(1),
    });

    // Pull the source bytes from storage and base64-encode for OpenAI.
    const { data: file, error: dlError } = await database.storage.from('outputs').download(output.storage_path);
    if (dlError || !file) return json({ error: 'failed to read source image' }, 500);
    const sourceBase64 = encodeBase64(new Uint8Array(await file.arrayBuffer()));
    const sourceMime = output.mime_type || 'image/png';

    // Optional reference image uploaded by the client — its subject (a person,
    // a product, a logo) is blended into the edited graphic.
    let reference: { base64: string; mime: string } | null = null;
    if (referencePath) {
      const { data: refFile, error: refError } = await database.storage.from('outputs').download(referencePath);
      if (refError || !refFile) return json({ error: 'failed to read reference image' }, 500);
      reference = {
        base64: encodeBase64(new Uint8Array(await refFile.arrayBuffer())),
        mime: body.reference_mime || refFile.type || 'image/png',
      };
    }

    const aiModels = await getSetting<{ image_model?: string; image_size?: string; system_message?: string }>(
      database,
      'ai_models',
    );

    const editPrompt = [
      'ערוך את התמונה הראשונה (הגרפיקה הקיימת) תוך שמירה על הקומפוזיציה הכללית והסגנון המקורי ושינוי רק מה שהתבקש.',
      feedback ? `משוב המשתמש: ${feedback}` : '',
      reference
        ? 'התמונה השנייה היא תמונת רפרנס שהמשתמש העלה: שלב את הדמות/האובייקט המרכזי ממנה בתוך הגרפיקה באופן טבעי ומכובד, תוך שמירה מדויקת על מראה הדמות/האובייקט כפי שהם ברפרנס.'
        : '',
      sourceBrief.goal ? `מטרת התמונה המקורית: ${sourceBrief.goal}` : '',
      sourceBrief.style ? `סגנון: ${sourceBrief.style}` : '',
      RTL_IMAGE_DIRECTIVE,
    ]
      .filter(Boolean)
      .join('\n\n');

    const edited = await editImage(sourceBase64, sourceMime, editPrompt, {
      model: aiModels?.image_model,
      size: aiModels?.image_size,
      systemMessage: aiModels?.system_message,
      references: reference ? [reference] : undefined,
    });

    // Persist as a fresh production-form request + output.
    const { data: conversation, error: convError } = await database
      .from('conversations')
      .insert({ whatsapp_from: 'production-form', status: 'active', simulated: true })
      .select('id')
      .single();
    if (convError || !conversation) throw convError ?? new Error('conversation create failed');

    const newBrief = {
      ...sourceBrief,
      ready: true,
      source: 'image_edit',
      parent_request_id: sourceRequestId,
      edit_feedback: feedback,
      ...(referencePath ? { edit_reference_path: referencePath } : {}),
    };

    const { data: newReq, error: reqError } = await database
      .from('requests')
      .insert({
        conversation_id: conversation.id,
        brand_id: sourceReq?.brand_id ?? null,
        created_by: body.created_by ?? (sourceReq as { created_by?: string | null } | null)?.created_by ?? null,
        output_type: 'image',
        structured_brief: newBrief,
        status: 'approved',
      })
      .select('id')
      .single();
    if (reqError || !newReq) throw reqError ?? new Error('request create failed');

    const storagePath = `${newReq.id}/v1.png`;
    const { error: upError } = await database.storage
      .from('outputs')
      .upload(storagePath, decodeBase64(edited.base64), { contentType: edited.mime, upsert: true });
    if (upError) throw upError;

    // Carry the social post text forward. An image edit changes pixels, not the
    // post's wording, so the edited version keeps its ready-to-publish caption.
    const { data: newOutput, error: outError } = await database
      .from('outputs')
      .insert({
        request_id: newReq.id,
        output_type: 'image',
        storage_path: storagePath,
        mime_type: edited.mime,
        version: 1,
        text_content: (output as { text_content?: string | null }).text_content ?? null,
      })
      .select('id')
      .single();
    if (outError) throw outError;

    await database
      .from('requests')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', newReq.id);
    await database.from('conversations').update({ status: 'active', current_request_id: null }).eq('id', conversation.id);

    await recordUsageAndCost(database, newReq.id, {
      provider: 'openai',
      model: edited.model,
      output: 1,
      cost: estimateImageCost(1),
    });
    await logEvent(database, {
      requestId: newReq.id,
      action: 'image_edited',
      metadata: { parent_request_id: sourceRequestId, model: edited.model, with_reference: Boolean(referencePath) },
    });

    return json({
      request_id: newReq.id,
      output_id: newOutput?.id ?? null,
      text_content: (output as { text_content?: string | null }).text_content ?? null,
      storage_path: storagePath,
      base64: edited.base64,
      mime: edited.mime,
    });
  } catch (e) {
    if (e instanceof AbuseGuardError) {
      return json({ error: e.message, code: e.code }, e.status);
    }
    await logEvent(database, { severity: 'error', action: 'image_edit_failed', message: String(e) });
    return json({ error: String(e) }, 500);
  }
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
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
