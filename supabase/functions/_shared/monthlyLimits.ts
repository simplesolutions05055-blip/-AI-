import type { DB } from './db.ts';
import { logEvent } from './util.ts';
import { AbuseGuardError } from './abuseGuard.ts';

// Per-user calendar-month production caps. Configured on the user card
// (profiles.monthly_limits) and surfaced in the client's price quote. A value
// of 0 or a missing key means "unlimited". The window is the calendar month
// (resets on the 1st), NOT a rolling 24h — that rolling cap is enforced
// separately in abuseGuard (rate_limits.generations_per_24h).

export type MonthlyLimitGroup = 'graphics' | 'presentations' | 'documents' | 'uploads';

export type MonthlyLimits = Partial<Record<MonthlyLimitGroup, number>>;

// output_type (text/image/pdf/presentation) → the quota bucket it counts against.
// "graphics" bundles post text + image because the product treats a finished
// post (caption + graphic) as one deliverable.
export function groupForOutputType(outputType: string | null | undefined): MonthlyLimitGroup | null {
  switch (outputType) {
    case 'image':
    case 'text':
      return 'graphics';
    case 'presentation':
      return 'presentations';
    case 'pdf':
      return 'documents';
    default:
      return null;
  }
}

const GROUP_LABEL_HE: Record<MonthlyLimitGroup, string> = {
  graphics: 'גרפיקות',
  presentations: 'מצגות',
  documents: 'מסמכים',
  uploads: 'העלאות',
};

export function normalizeMonthlyLimits(value: unknown): MonthlyLimits {
  const src = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const out: MonthlyLimits = {};
  for (const g of ['graphics', 'presentations', 'documents', 'uploads'] as MonthlyLimitGroup[]) {
    const n = Number(src[g]);
    if (Number.isFinite(n) && n > 0) out[g] = Math.floor(n);
  }
  return out;
}

function startOfCalendarMonthISO(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

// How many requests of the given group the actor has already started this
// calendar month. Mirrors abuseGuard.enforceDailyCost: user-scoped when we know
// the user, else brand-scoped.
export async function monthlyGroupUsage(
  database: DB,
  actor: { userId?: string | null; brandId?: string | null },
  group: MonthlyLimitGroup,
): Promise<number> {
  const since = startOfCalendarMonthISO();
  const types =
    group === 'graphics' ? ['image', 'text']
    : group === 'presentations' ? ['presentation']
    : group === 'documents' ? ['pdf']
    : [];
  if (types.length === 0) return 0;

  let query = database
    .from('requests')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', since)
    .in('output_type', types);
  if (actor.userId) query = query.eq('created_by', actor.userId);
  else if (actor.brandId) query = query.eq('brand_id', actor.brandId);
  else return 0;

  const { count } = await query;
  return count ?? 0;
}

// Full per-group snapshot for the admin user card ("47 / 180").
export async function monthlyUsageSnapshot(
  database: DB,
  actor: { userId?: string | null; brandId?: string | null },
): Promise<Record<MonthlyLimitGroup, number>> {
  const [graphics, presentations, documents] = await Promise.all([
    monthlyGroupUsage(database, actor, 'graphics'),
    monthlyGroupUsage(database, actor, 'presentations'),
    monthlyGroupUsage(database, actor, 'documents'),
  ]);
  return { graphics, presentations, documents, uploads: 0 };
}

// Throws AbuseGuardError when the actor is at/over their cap for this output
// type's group. Callers already catch AbuseGuardError and route the request to
// needs_attention, so no special handling is needed here.
export async function assertMonthlyOutputLimit(
  database: DB,
  actor: { userId?: string | null; brandId?: string | null; requestId?: string | null },
  outputType: string | null | undefined,
): Promise<void> {
  const group = groupForOutputType(outputType);
  if (!group || (!actor.userId && !actor.brandId)) return;

  const scopeId = actor.userId ?? actor.brandId!;
  const { data: limitsRow } = actor.userId
    ? await database.from('profiles').select('monthly_limits').eq('id', actor.userId).maybeSingle()
    : { data: null };

  const limits = normalizeMonthlyLimits((limitsRow as { monthly_limits?: unknown } | null)?.monthly_limits);
  const cap = limits[group] ?? 0;
  if (cap <= 0) return;

  const used = await monthlyGroupUsage(database, actor, group);
  if (used >= cap) {
    await logEvent(database, {
      requestId: actor.requestId ?? null,
      severity: 'warning',
      action: 'monthly_limit_exceeded',
      metadata: { scope: actor.userId ? `user:${scopeId}` : `brand:${scopeId}`, group, used, cap },
    });
    throw new AbuseGuardError(
      'monthly_limit_exceeded',
      `הגעת למכסה החודשית של ${GROUP_LABEL_HE[group]} (${cap}). המכסה מתאפסת בתחילת החודש.`,
    );
  }
}
