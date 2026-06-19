import { createAdminClient } from '@/lib/supabase/admin';
import type {
  ApprovalSetting,
  EmailSettings,
  OutputType,
  RateLimitSetting,
  WhatsappTemplates,
} from '@/types/db';

type SupabaseClient = ReturnType<typeof createAdminClient>;

export async function getSetting<T>(db: SupabaseClient, key: string): Promise<T | null> {
  const { data } = await db.from('settings').select('value_json').eq('key', key).maybeSingle();
  return (data?.value_json as T) ?? null;
}

export async function getWhatsappTemplates(db: SupabaseClient): Promise<WhatsappTemplates> {
  return (await getSetting<WhatsappTemplates>(db, 'whatsapp_templates'))!;
}

export async function getEmailSettings(db: SupabaseClient): Promise<EmailSettings> {
  return (await getSetting<EmailSettings>(db, 'email_settings'))!;
}

export async function getRateLimits(db: SupabaseClient): Promise<RateLimitSetting> {
  return (await getSetting<RateLimitSetting>(db, 'rate_limits'))!;
}

/** Resolve whether an output type requires manual approval (spec §8). */
export async function requiresManualApproval(
  db: SupabaseClient,
  outputType: OutputType
): Promise<boolean> {
  const setting = await getSetting<ApprovalSetting>(db, 'approval_mode');
  if (!setting) return true;
  if (setting.mode === 'manual') return true;
  if (setting.mode === 'automatic') return false;
  const key = outputType === 'presentation' ? 'text' : outputType;
  return setting.by_type[key as 'text' | 'image' | 'pdf'] === 'manual';
}

export async function getActiveSystemPrompt(db: SupabaseClient): Promise<string> {
  const { data } = await db
    .from('system_prompt_versions')
    .select('content')
    .eq('is_active', true)
    .maybeSingle();
  return data?.content ?? '';
}

export async function getMaxRounds(db: SupabaseClient): Promise<number> {
  const s = await getSetting<{ max: number }>(db, 'question_rounds');
  return s?.max ?? 3;
}

export async function getMaxAttempts(db: SupabaseClient): Promise<number> {
  const s = await getSetting<{ max: number }>(db, 'generation_attempts');
  return s?.max ?? 3;
}
