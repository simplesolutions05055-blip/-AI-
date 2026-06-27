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
): Promise<string> {
  const db = createSupabaseBrowserClient();
  const key = openaiKey ?? sessionOpenAiKey();
  const { data, error } = await db.functions.invoke('generate-presentation', {
    body: { brief, requestId, format: 'social_caption', platform, openai_key: key || undefined },
  });
  if (error) throw error;
  const caption = (data as { caption?: string } | null)?.caption;
  if (typeof caption !== 'string' || !caption.trim()) throw new Error('לא הוחזר טקסט לפרסום');
  return caption.trim();
}
