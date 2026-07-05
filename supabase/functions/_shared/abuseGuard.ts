import type { DB } from './db.ts';
import { getSettingOr, logEvent, round4 } from './util.ts';

type Actor = {
  userId?: string | null;
  brandId?: string | null;
  phone?: string | null;
  sessionId?: string | null;
  ip?: string | null;
  requestId?: string | null;
};

type LimitSpec = {
  window_seconds: number;
  max: number;
};

type AbuseSettings = {
  message_per_minute?: LimitSpec;
  message_per_24h?: LimitSpec;
  ai_per_hour?: LimitSpec;
  ai_per_day?: LimitSpec;
  ai_per_brand_day?: LimitSpec;
  media_ai_per_hour?: LimitSpec;
  max_prompt_chars?: number;
  max_upload_bytes?: number;
  max_parallel_requests_per_actor?: number;
  max_request_cost_usd?: number | null;
  max_daily_cost_usd_per_actor?: number | null;
  allow_client_openai_key?: boolean;
};

const DEFAULTS: Required<Omit<AbuseSettings,
  'max_request_cost_usd' | 'max_daily_cost_usd_per_actor'
>> & Pick<AbuseSettings, 'max_request_cost_usd' | 'max_daily_cost_usd_per_actor'> = {
  message_per_minute: { window_seconds: 60, max: 12 },
  message_per_24h: { window_seconds: 86400, max: 80 },
  ai_per_hour: { window_seconds: 3600, max: 12 },
  ai_per_day: { window_seconds: 86400, max: 40 },
  ai_per_brand_day: { window_seconds: 86400, max: 120 },
  media_ai_per_hour: { window_seconds: 3600, max: 8 },
  max_prompt_chars: 12000,
  max_upload_bytes: 10 * 1024 * 1024,
  max_parallel_requests_per_actor: 1,
  max_request_cost_usd: 1.5,
  max_daily_cost_usd_per_actor: 8,
  allow_client_openai_key: false,
};

export class AbuseGuardError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 429) {
    super(message);
    this.name = 'AbuseGuardError';
    this.code = code;
    this.status = status;
  }
}

export async function abuseSettings(database: DB): Promise<typeof DEFAULTS> {
  const configured = await getSettingOr<AbuseSettings>(database, 'abuse_limits', {});
  return {
    ...DEFAULTS,
    ...configured,
    message_per_minute: { ...DEFAULTS.message_per_minute, ...(configured.message_per_minute ?? {}) },
    message_per_24h: { ...DEFAULTS.message_per_24h, ...(configured.message_per_24h ?? {}) },
    ai_per_hour: { ...DEFAULTS.ai_per_hour, ...(configured.ai_per_hour ?? {}) },
    ai_per_day: { ...DEFAULTS.ai_per_day, ...(configured.ai_per_day ?? {}) },
    ai_per_brand_day: { ...DEFAULTS.ai_per_brand_day, ...(configured.ai_per_brand_day ?? {}) },
    media_ai_per_hour: { ...DEFAULTS.media_ai_per_hour, ...(configured.media_ai_per_hour ?? {}) },
  };
}

export function actorKey(actor: Actor): string {
  if (actor.userId) return `user:${actor.userId}`;
  if (actor.phone) return `phone:${actor.phone}`;
  if (actor.sessionId) return `session:${actor.sessionId}`;
  if (actor.ip) return `ip:${actor.ip}`;
  return 'anonymous';
}

export function brandKey(brandId?: string | null): string | null {
  return brandId ? `brand:${brandId}` : null;
}

async function countEvents(database: DB, key: string, eventType: string, windowSeconds: number): Promise<number> {
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const { count } = await database
    .from('rate_limit_events')
    .select('id', { count: 'exact', head: true })
    .eq('phone_number', key)
    .eq('event_type', eventType)
    .gte('created_at', since);
  return count ?? 0;
}

async function recordEvent(database: DB, key: string, eventType: string): Promise<void> {
  await database.from('rate_limit_events').insert({ phone_number: key, event_type: eventType });
}

async function enforceLimit(
  database: DB,
  actor: Actor,
  key: string,
  eventType: string,
  spec: LimitSpec,
): Promise<void> {
  const current = await countEvents(database, key, eventType, spec.window_seconds);
  if (current >= spec.max) {
    await logEvent(database, {
      requestId: actor.requestId ?? null,
      severity: 'warning',
      action: 'abuse_guard_rate_limited',
      metadata: { key, eventType, current, max: spec.max, window_seconds: spec.window_seconds },
    });
    throw new AbuseGuardError('rate_limited', 'הגעת למגבלת שימוש זמנית. נסה שוב מאוחר יותר.');
  }
}

export async function enforceMessageLimit(database: DB, actor: Actor): Promise<void> {
  const settings = await abuseSettings(database);
  const key = actorKey(actor);
  await enforceLimit(database, actor, key, 'message_minute', settings.message_per_minute);
  await enforceLimit(database, actor, key, 'message_day', settings.message_per_24h);
  await recordEvent(database, key, 'message_minute');
  await recordEvent(database, key, 'message_day');
}

export async function enforceAiLimit(
  database: DB,
  actor: Actor,
  opts: { kind?: 'generation' | 'media' | 'utility'; estimatedCost?: number; promptChars?: number } = {},
): Promise<void> {
  const settings = await abuseSettings(database);
  const key = actorKey(actor);
  if ((opts.promptChars ?? 0) > settings.max_prompt_chars) {
    throw new AbuseGuardError('prompt_too_long', 'הבקשה ארוכה מדי. קצר אותה ונסה שוב.', 413);
  }
  await enforceLimit(database, actor, key, 'ai_hour', settings.ai_per_hour);
  await enforceLimit(database, actor, key, 'ai_day', settings.ai_per_day);
  if (opts.kind === 'media') {
    await enforceLimit(database, actor, key, 'media_ai_hour', settings.media_ai_per_hour);
  }
  const bKey = brandKey(actor.brandId);
  if (bKey) await enforceLimit(database, actor, bKey, 'ai_brand_day', settings.ai_per_brand_day);
  await enforceDailyCost(database, actor, settings.max_daily_cost_usd_per_actor);
  await recordEvent(database, key, 'ai_hour');
  await recordEvent(database, key, 'ai_day');
  if (opts.kind === 'media') await recordEvent(database, key, 'media_ai_hour');
  if (bKey) await recordEvent(database, bKey, 'ai_brand_day');
  await logEvent(database, {
    requestId: actor.requestId ?? null,
    action: 'abuse_guard_ai_allowed',
    metadata: { key, brand: actor.brandId ?? null, kind: opts.kind ?? 'generation', estimatedCost: opts.estimatedCost ?? null },
  });
}

export async function enforcePromptLength(
  database: DB,
  actor: Actor,
  promptChars: number,
): Promise<void> {
  const settings = await abuseSettings(database);
  if (promptChars <= settings.max_prompt_chars) return;
  await logEvent(database, {
    requestId: actor.requestId ?? null,
    severity: 'warning',
    action: 'abuse_guard_prompt_too_long',
    metadata: { promptChars, max: settings.max_prompt_chars, actor: actorKey(actor) },
  });
  throw new AbuseGuardError('prompt_too_long', 'הבקשה ארוכה מדי. קצר אותה ונסה שוב.', 413);
}

export async function enforceDailyCost(
  database: DB,
  actor: Actor,
  maxCost: number | null | undefined,
): Promise<void> {
  if (maxCost == null) return;
  const since = new Date(Date.now() - 86400000).toISOString();
  let query = database
    .from('requests')
    .select('estimated_cost')
    .gte('created_at', since);
  if (actor.userId) query = query.eq('created_by', actor.userId);
  else if (actor.brandId) query = query.eq('brand_id', actor.brandId);
  else return;
  const { data } = await query;
  const total = (data ?? []).reduce((sum: number, row: { estimated_cost?: number | string | null }) => {
    return sum + Number(row.estimated_cost ?? 0);
  }, 0);
  if (total >= maxCost) {
    await logEvent(database, {
      requestId: actor.requestId ?? null,
      severity: 'warning',
      action: 'abuse_guard_daily_cost_limited',
      metadata: { total: round4(total), maxCost, actor: actorKey(actor) },
    });
    throw new AbuseGuardError('daily_budget_exceeded', 'מכסת השימוש היומית נוצלה. פנה למנהל המערכת.');
  }
}

export async function enforceRequestCost(database: DB, requestId: string): Promise<void> {
  const settings = await abuseSettings(database);
  if (settings.max_request_cost_usd == null) return;
  const { data: request } = await database
    .from('requests')
    .select('estimated_cost')
    .eq('id', requestId)
    .maybeSingle();
  if (Number(request?.estimated_cost ?? 0) >= settings.max_request_cost_usd) {
    await logEvent(database, {
      requestId,
      severity: 'warning',
      action: 'abuse_guard_request_cost_limited',
      metadata: { estimated_cost: request?.estimated_cost ?? 0, maxCost: settings.max_request_cost_usd },
    });
    throw new AbuseGuardError('request_budget_exceeded', 'הבקשה הגיעה למכסת העלות המותרת.');
  }
}

export async function enforceParallelRequestLimit(
  database: DB,
  actor: Actor,
  excludeRequestId?: string | null,
): Promise<void> {
  const settings = await abuseSettings(database);
  if (!settings.max_parallel_requests_per_actor || (!actor.userId && !actor.brandId)) return;
  let query = database
    .from('requests')
    .select('id', { count: 'exact', head: true })
    .in('status', ['queued', 'processing', 'quality_check', 'regenerating']);
  if (actor.userId) query = query.eq('created_by', actor.userId);
  else if (actor.brandId) query = query.eq('brand_id', actor.brandId);
  if (excludeRequestId) query = query.neq('id', excludeRequestId);
  const { count } = await query;
  if ((count ?? 0) >= settings.max_parallel_requests_per_actor) {
    await logEvent(database, {
      requestId: actor.requestId ?? null,
      severity: 'warning',
      action: 'abuse_guard_parallel_limited',
      metadata: { actor: actorKey(actor), count, max: settings.max_parallel_requests_per_actor },
    });
    throw new AbuseGuardError('parallel_request_limited', 'יש כבר בקשה בטיפול. אפשר להמשיך אחרי שהיא תסתיים.');
  }
}

export async function rejectClientOpenAiKeyIfDisabled(database: DB, key: unknown): Promise<void> {
  if (typeof key !== 'string' || !key.trim()) return;
  const settings = await abuseSettings(database);
  if (!settings.allow_client_openai_key) {
    await logEvent(database, { severity: 'warning', action: 'client_openai_key_rejected' });
    throw new AbuseGuardError('client_openai_key_disabled', 'שימוש במפתח OpenAI מהלקוח חסום בפרודקשיין.', 403);
  }
}

export async function loadRequestActor(database: DB, requestId: string): Promise<Actor> {
  const { data } = await database
    .from('requests')
    .select('id, created_by, brand_id, conversations!requests_conversation_id_fkey(whatsapp_from)')
    .eq('id', requestId)
    .maybeSingle();
  const conv = data?.conversations as { whatsapp_from?: string | null } | null;
  return {
    requestId,
    userId: (data?.created_by as string | null) ?? null,
    brandId: (data?.brand_id as string | null) ?? null,
    phone: conv?.whatsapp_from ?? null,
  };
}
