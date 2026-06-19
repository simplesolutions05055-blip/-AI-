import { createAdminClient } from '@/lib/supabase/admin';
import type { LogSeverity } from '@/types/db';

type SupabaseClient = ReturnType<typeof createAdminClient>;

export async function logEvent(
  db: SupabaseClient,
  params: {
    requestId?: string | null;
    severity?: LogSeverity;
    action: string;
    message?: string;
    metadata?: Record<string, unknown>;
  }
) {
  await db.from('logs').insert({
    request_id: params.requestId ?? null,
    severity: params.severity ?? 'info',
    action: params.action,
    message: params.message ?? null,
    metadata: params.metadata ?? null,
  });
}
