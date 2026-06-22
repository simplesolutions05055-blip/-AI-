// Edge Function: edit-image — revise an existing image output (img2img).
// Takes the source output + the user's feedback, runs an OpenAI image edit, and
// stores the result as a NEW production-form request/output so it shows up in the
// Files screen and request history like any other deliverable.
import { db } from '../_shared/db.ts';
import { editImage } from '../_shared/openai.ts';
import { getSetting, logEvent, recordUsageAndCost, estimateImageCost } from '../_shared/util.ts';

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
    if (!sourceRequestId) return json({ error: 'request_id required' }, 400);
    if (!feedback) return json({ error: 'feedback required' }, 400);

    // Latest image output of the source request.
    const { data: output } = await database
      .from('outputs')
      .select('storage_path, mime_type, output_type')
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
      .select('structured_brief, brand_id')
      .eq('id', sourceRequestId)
      .single();
    const sourceBrief = (sourceReq?.structured_brief ?? {}) as Record<string, unknown>;

    // Pull the source bytes from storage and base64-encode for OpenAI.
    const { data: file, error: dlError } = await database.storage.from('outputs').download(output.storage_path);
    if (dlError || !file) return json({ error: 'failed to read source image' }, 500);
    const sourceBase64 = encodeBase64(new Uint8Array(await file.arrayBuffer()));
    const sourceMime = output.mime_type || 'image/png';

    const aiModels = await getSetting<{ image_model?: string; image_size?: string; system_message?: string }>(
      database,
      'ai_models',
    );

    const editPrompt = [
      'ערוך את התמונה הקיימת לפי המשוב הבא, תוך שמירה על הקומפוזיציה הכללית והסגנון המקורי ושינוי רק מה שהתבקש.',
      `משוב המשתמש: ${feedback}`,
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
    });

    // Persist as a fresh production-form request + output.
    const { data: conversation, error: convError } = await database
      .from('conversations')
      .insert({ whatsapp_from: 'production-form', status: 'active', simulated: false })
      .select('id')
      .single();
    if (convError || !conversation) throw convError ?? new Error('conversation create failed');

    const newBrief = {
      ...sourceBrief,
      ready: true,
      source: 'image_edit',
      parent_request_id: sourceRequestId,
      edit_feedback: feedback,
    };

    const { data: newReq, error: reqError } = await database
      .from('requests')
      .insert({
        conversation_id: conversation.id,
        brand_id: sourceReq?.brand_id ?? null,
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

    const { error: outError } = await database.from('outputs').insert({
      request_id: newReq.id,
      output_type: 'image',
      storage_path: storagePath,
      mime_type: edited.mime,
      version: 1,
    });
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
      metadata: { parent_request_id: sourceRequestId, model: edited.model },
    });

    return json({ request_id: newReq.id, storage_path: storagePath, base64: edited.base64, mime: edited.mime });
  } catch (e) {
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
