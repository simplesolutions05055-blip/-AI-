// Client helper for the social scheduling flow. When the produced output is an
// image, the brief is the only source of the post's wording, so we ask the Edge
// function to turn the brief into a ready-to-publish Facebook/Instagram caption
// that pre-fills the "כיתוב לפרסום" field.
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { getSessionOpenAiKey } from '@/lib/aiSessionKey';

export type SocialPlatform = 'facebook' | 'instagram';

export async function fetchSocialCaption(
  brief: unknown,
  platform: SocialPlatform,
  requestId: string | null,
  openaiKey?: string | null,
  // When provided, the Edge function persists the caption onto this outputs row
  // (text_content), so the post text survives reloads without a client-side write.
  outputId?: string | null,
): Promise<string> {
  const db = createSupabaseBrowserClient();
  const key = openaiKey ?? getSessionOpenAiKey();
  const { data, error } = await db.functions.invoke('generate-presentation', {
    body: { brief, requestId, format: 'social_caption', platform, openai_key: key || undefined, output_id: outputId || undefined },
  });
  if (error) throw error;
  const caption = (data as { caption?: string } | null)?.caption;
  if (typeof caption !== 'string' || !caption.trim()) throw new Error('לא הוחזר טקסט לפרסום');
  return caption.trim();
}

// AI-revise an existing post text per the user's feedback (same flow as image
// corrections: write what to change, get an updated version). Persisted onto the
// outputs row when outputId is given.
export async function reviseSocialCaption(
  currentCaption: string,
  feedback: string,
  brief: unknown,
  requestId: string | null,
  outputId?: string | null,
): Promise<string> {
  const db = createSupabaseBrowserClient();
  const { data, error } = await db.functions.invoke('generate-presentation', {
    body: {
      brief,
      requestId,
      format: 'social_caption',
      platform: 'facebook',
      current_caption: currentCaption,
      feedback,
      output_id: outputId || undefined,
      openai_key: getSessionOpenAiKey() || undefined,
    },
  });
  if (error) throw error;
  const caption = (data as { caption?: string } | null)?.caption;
  if (typeof caption !== 'string' || !caption.trim()) throw new Error('לא הוחזר טקסט מעודכן');
  return caption.trim();
}

// Persist a manual edit of the post text (no AI call).
export async function saveSocialCaption(caption: string, outputId: string, requestId: string | null): Promise<void> {
  const db = createSupabaseBrowserClient();
  const { error } = await db.functions.invoke('generate-presentation', {
    body: {
      brief: {},
      requestId,
      format: 'social_caption',
      save_only: true,
      current_caption: caption,
      output_id: outputId,
    },
  });
  if (error) throw error;
}
