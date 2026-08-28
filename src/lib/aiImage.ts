// Shared AI-image helpers used by both the output-revision flow and the
// scheduled-post editor: sign an output path, edit an existing image request,
// and produce an extra carousel image from a base brief.
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export type AiImage = { requestId: string; storagePath: string; previewUrl: string };

export async function signedOutputUrl(path: string, expiresIn = 3600) {
  const { data } = await createSupabaseBrowserClient().storage.from('outputs').createSignedUrl(path, expiresIn);
  return data?.signedUrl ?? null;
}

// img2img on an existing image request. Returns the new (edited) request.
export async function editImageRequest(requestId: string, feedback: string): Promise<AiImage> {
  const client = createSupabaseBrowserClient();
  const { data, error } = await client.functions.invoke('edit-image', { body: { request_id: requestId, feedback } });
  if (error) throw error;
  const edited = data as { request_id?: string; storage_path?: string; error?: string } | null;
  if (edited?.error) throw new Error(edited.error);
  if (!edited?.request_id || !edited.storage_path) throw new Error('לא התקבלה תמונה מתוקנת');
  const previewUrl = await signedOutputUrl(edited.storage_path);
  if (!previewUrl) throw new Error('התמונה תוקנה אבל לא התקבל קישור תצוגה');
  return { requestId: edited.request_id, storagePath: edited.storage_path, previewUrl };
}

// Runs a fresh image request through the production pipeline and waits for the
// output. `onStatus` reports the current stage for the calling UI.
export async function generateCarouselImage({
  baseBrief,
  baseRequestId,
  brandId,
  slideIndex,
  instruction,
  onStatus,
}: {
  baseBrief: Record<string, unknown>;
  baseRequestId: string | null;
  brandId: string | null;
  slideIndex: number;
  instruction: string;
  onStatus?: (status: string) => void;
}): Promise<AiImage> {
  const client = createSupabaseBrowserClient();
  const note = instruction.trim();
  const brief = {
    ...baseBrief,
    ready: true,
    source: 'carousel_image',
    parent_request_id:
      typeof baseBrief.parent_request_id === 'string' ? baseBrief.parent_request_id : baseRequestId ?? undefined,
    admin_note: [
      baseBrief.admin_note,
      `תמונה מספר ${slideIndex} לפוסט קרוסלה — לשמור על אותו קו עיצובי, צבעוניות ושפה גרפית של התמונה הראשית של הפוסט.`,
      note ? `מה להציג בתמונה הזו: ${note}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  };

  onStatus?.('יוצרים בקשת תמונה');
  const { data: created, error: createError } = await client.functions.invoke('create-production-request', {
    body: { output_type: 'image', brief, customer_email: null, brand_id: brandId },
  });
  if (createError) throw createError;
  const id = (created as { request_id?: string })?.request_id;
  if (!id) throw new Error('לא התקבל מזהה בקשה');

  onStatus?.('מפיקים את התמונה');
  const { error: processError } = await client.functions.invoke('process-request', { body: { request_id: id } });
  if (processError) throw processError;

  for (let i = 0; i < 90; i++) {
    const [{ data: req }, { data: out }] = await Promise.all([
      client.from('requests').select('status, structured_brief').eq('id', id).single(),
      client
        .from('outputs')
        .select('storage_path')
        .eq('request_id', id)
        .eq('output_type', 'image')
        .not('storage_path', 'is', null)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    const path = (out as { storage_path?: string | null } | null)?.storage_path;
    if (path) {
      const previewUrl = await signedOutputUrl(path);
      if (!previewUrl) throw new Error('נוצרה תמונה אבל לא התקבל קישור תצוגה');
      return { requestId: id, storagePath: path, previewUrl };
    }
    const requestRow = req as { status?: string; structured_brief?: { last_error?: string } } | null;
    if (requestRow?.status === 'failed' || requestRow?.status === 'needs_attention') {
      throw new Error(requestRow.structured_brief?.last_error || 'יצירת התמונה נעצרה.');
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error('יצירת התמונה עדיין רצה. אפשר לבדוק את הסטטוס במסך התוצרים.');
}

// Error copy and quota detection live in one place so every AI screen says the
// same thing to the same person. Re-exported here for the existing callers.
export { aiErrorLabel, aiErrorText, isAiQuotaError } from '@/lib/aiErrors';
