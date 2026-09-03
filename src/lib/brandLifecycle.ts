import type { createClient } from '@supabase/supabase-js';

// Brand deletion and readiness helpers shared by the branding screen and the
// users/permissions screen.
//
// Row-level cleanup on brand delete (cancelling scheduled posts, purging the
// request/output history) is done by the `brands_delete_cleanup` DB trigger so
// it can't be half-finished. These helpers cover what the trigger can't: the
// pre-delete impact count shown to the admin, and best-effort storage cleanup.

type DB = ReturnType<typeof createClient>;

export interface BrandDeleteImpact {
  /** Regular users who lose their only brand and get locked out. */
  memberCount: number;
  /** Deliverables that will be permanently deleted. */
  outputCount: number;
  /** Scheduled posts that will be cancelled. */
  scheduledPostCount: number;
}

export async function brandDeleteImpact(db: DB, brandIds: string[]): Promise<BrandDeleteImpact> {
  if (brandIds.length === 0) {
    return { memberCount: 0, outputCount: 0, scheduledPostCount: 0 };
  }
  const [members, outputs, posts] = await Promise.all([
    db.from('user_brands').select('user_id', { count: 'exact', head: true }).in('brand_id', brandIds),
    db.from('outputs').select('id', { count: 'exact', head: true }).in('brand_id', brandIds),
    db
      .from('scheduled_social_posts')
      .select('id', { count: 'exact', head: true })
      .in('brand_id', brandIds)
      .eq('status', 'scheduled'),
  ]);
  return {
    memberCount: members.count ?? 0,
    outputCount: outputs.count ?? 0,
    scheduledPostCount: posts.count ?? 0,
  };
}

const ACTIVE_REQUEST_STATUSES = ['received', 'collecting_details', 'queued', 'processing', 'quality_check'];

/** How many requests this user has still in flight (generation not finished). */
export async function activeRequestCount(db: DB, userId: string): Promise<number> {
  const { count } = await db
    .from('requests')
    .select('id', { count: 'exact', head: true })
    .eq('created_by', userId)
    .in('status', ACTIVE_REQUEST_STATUSES);
  return count ?? 0;
}

/** Human-readable summary of what a brand delete will take down, or '' if nothing. */
export function brandDeleteImpactMessage(impact: BrandDeleteImpact): string {
  const lines: string[] = [];
  if (impact.memberCount > 0) {
    lines.push(
      `${impact.memberCount} משתמשים משויכים למותג הזה — הם ייחסמו מהמערכת עד ששיוך מחדש.`,
    );
  }
  if (impact.outputCount > 0) {
    lines.push(`${impact.outputCount} תוצרים יימחקו לצמיתות.`);
  }
  if (impact.scheduledPostCount > 0) {
    lines.push(`${impact.scheduledPostCount} פוסטים מתוזמנים יבוטלו.`);
  }
  return lines.join('\n');
}

/**
 * Best-effort removal of a brand's storage blobs. Call BEFORE deleting the brand
 * row — once the row (and its requests) are gone the storage paths can't be
 * found. Never throws; storage cleanup must not block the delete.
 */
export async function purgeBrandStorage(db: DB, brandId: string): Promise<void> {
  try {
    const { data: outputs } = await db
      .from('outputs')
      .select('storage_path')
      .eq('brand_id', brandId)
      .not('storage_path', 'is', null);
    const paths = (outputs ?? [])
      .map((o) => (o as { storage_path?: string | null }).storage_path)
      .filter((p): p is string => !!p);
    if (paths.length) {
      await db.storage.from('outputs').remove(paths);
    }
  } catch {
    /* best effort */
  }
  try {
    const { data: files } = await db.storage.from('branding').list(brandId);
    if (files?.length) await db.storage.from('branding').remove(files.map((f) => `${brandId}/${f.name}`));
    const { data: assetFiles } = await db.storage.from('branding').list(`${brandId}/assets`);
    if (assetFiles?.length) {
      await db.storage.from('branding').remove(assetFiles.map((f) => `${brandId}/assets/${f.name}`));
    }
  } catch {
    /* best effort */
  }
}
