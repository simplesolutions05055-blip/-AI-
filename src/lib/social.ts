// Client helper for the social scheduling flow. When the produced output is an
// image, the brief is the only source of the post's wording, so we ask the Edge
// function to turn the brief into a ready-to-publish Facebook/Instagram caption
// that pre-fills the "כיתוב לפרסום" field.
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export type SocialPlatform = 'facebook' | 'instagram';

// Shared with ProductionPage/quote: the session-scoped one-off OpenAI key the
// user may have entered. Forwarded so the call doesn't fall back to a project
// key that might be out of quota.
const SESSION_OPENAI_KEY = 'openai_session_key';
function sessionOpenAiKey(): string | null {
  try {
    return sessionStorage.getItem(SESSION_OPENAI_KEY);
  } catch {
    return null;
  }
}

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
  const key = openaiKey ?? sessionOpenAiKey();
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
      openai_key: sessionOpenAiKey() || undefined,
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
