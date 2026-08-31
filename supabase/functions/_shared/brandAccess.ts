// Brand access control — the one place that answers "may this user touch this
// brand?".
//
// Why this exists: brand selection used to be pure text matching against every
// active brand in the system (`brands` where is_active), with no reference to
// who was asking. A user linked only to Tel Aviv could type "מגדל העמק" into
// WhatsApp and the request would be stamped with the other authority's
// brand_id. Everything downstream keys off brand_id, so that single unchecked
// match pulled another tenant's learned rules, business brain and brand kit
// into the prompt — and let a correction from an outsider be written back as a
// permanent rule on their brand.
//
// The membership table (`user_brands`) already existed and was populated; the
// generation pipeline simply never asked it. This module is that question.
//
// Fail-closed by design: no user, no membership row, or a failed lookup all
// resolve to "no brands". A brand is never granted because a check errored.
import { type DB } from './db.ts';

/** Brands this user is linked to. Empty means: touch nothing. */
export async function allowedBrandIds(
  database: DB,
  userId: string | null | undefined,
): Promise<string[]> {
  if (!userId) return [];
  const { data, error } = await database
    .from('user_brands')
    .select('brand_id')
    .eq('user_id', userId);
  if (error) return [];
  return [...new Set(
    ((data ?? []) as Array<{ brand_id: string | null }>)
      .map((row) => row.brand_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  )];
}

export async function isBrandAllowed(
  database: DB,
  userId: string | null | undefined,
  brandId: string | null | undefined,
): Promise<boolean> {
  if (!brandId) return false;
  return (await allowedBrandIds(database, userId)).includes(brandId);
}

/**
 * Narrow a candidate brand list to what this user may use, before any name or
 * alias matching runs. Filtering the candidates (rather than checking the
 * winner afterwards) means a foreign brand can never win a match in the first
 * place, so it cannot be suggested, confirmed, or written to.
 */
export function filterBrandsForUser<T extends { id: string }>(
  brands: T[],
  allowed: string[],
): T[] {
  if (!allowed.length) return [];
  const permitted = new Set(allowed);
  return brands.filter((brand) => permitted.has(brand.id));
}
