// Shared resolution of "which Meta connection and which page/account does this
// post publish to". Used by schedule-social-post, get-meta-connections and the
// WhatsApp flow so every scheduling entry point picks targets the same way.

import type { DB } from './db.ts';

export type MetaPlatform = 'facebook' | 'instagram';

export interface MetaTargetOption {
  // Row id in meta_facebook_pages / meta_instagram_accounts.
  row_id: string;
  // Graph API id (page_id / instagram_id) — what scheduled_social_posts stores.
  target_id: string;
  // Display name (page name / @username).
  name: string;
  picture: string | null;
  is_default: boolean;
}

export interface ResolvedMetaConnection {
  connection_id: string;
  status: string;
  facebook: MetaTargetOption[];
  instagram: MetaTargetOption[];
  // The effective default per platform: the explicitly chosen default, or the
  // single option when only one exists, otherwise null (caller must pick).
  default_facebook: MetaTargetOption | null;
  default_instagram: MetaTargetOption | null;
}

// Find the brand's active Meta connection (brand-scoped first; falls back to a
// connection owned by the given user for connections created before brand
// linking). Returns null when the brand simply isn't connected.
export async function resolveMetaConnection(
  database: DB,
  opts: { brandId?: string | null; userId?: string | null },
): Promise<ResolvedMetaConnection | null> {
  let connection: Record<string, unknown> | null = null;

  if (opts.brandId) {
    const { data } = await database
      .from('meta_connections')
      .select('id, status, default_facebook_page_id, default_instagram_account_id')
      .eq('brand_id', opts.brandId)
      .eq('status', 'active')
      .maybeSingle();
    connection = data as Record<string, unknown> | null;
  }

  if (!connection && opts.userId) {
    const { data } = await database
      .from('meta_connections')
      .select('id, status, default_facebook_page_id, default_instagram_account_id')
      .eq('user_id', opts.userId)
      .eq('status', 'active')
      .order('updated_at', { ascending: false })
      .limit(1);
    connection = (data?.[0] ?? null) as Record<string, unknown> | null;
  }

  if (!connection) return null;

  const connectionId = connection.id as string;
  const defaultPageRowId = (connection.default_facebook_page_id as string | null) ?? null;
  const defaultIgRowId = (connection.default_instagram_account_id as string | null) ?? null;

  const [{ data: pages }, { data: igAccounts }] = await Promise.all([
    database
      .from('meta_facebook_pages')
      .select('id, page_id, page_name, page_picture')
      .eq('connection_id', connectionId)
      .order('page_name'),
    database
      .from('meta_instagram_accounts')
      .select('id, instagram_id, username, profile_picture_url')
      .eq('connection_id', connectionId)
      .order('username'),
  ]);

  const facebook: MetaTargetOption[] = (pages ?? []).map((p: Record<string, unknown>) => ({
    row_id: p.id as string,
    target_id: p.page_id as string,
    name: p.page_name as string,
    picture: (p.page_picture as string | null) ?? null,
    is_default: p.id === defaultPageRowId,
  }));
  const instagram: MetaTargetOption[] = (igAccounts ?? []).map((a: Record<string, unknown>) => ({
    row_id: a.id as string,
    target_id: a.instagram_id as string,
    name: `@${a.username as string}`,
    picture: (a.profile_picture_url as string | null) ?? null,
    is_default: a.id === defaultIgRowId,
  }));

  return {
    connection_id: connectionId,
    status: connection.status as string,
    facebook,
    instagram,
    default_facebook: pickDefault(facebook),
    default_instagram: pickDefault(instagram),
  };
}

function pickDefault(options: MetaTargetOption[]): MetaTargetOption | null {
  const explicit = options.find((o) => o.is_default);
  if (explicit) return explicit;
  return options.length === 1 ? options[0] : null;
}

// Validate that a caller-supplied target id actually belongs to the connection.
export function findTarget(
  resolved: ResolvedMetaConnection,
  platform: MetaPlatform,
  targetId: string,
): MetaTargetOption | null {
  const options = platform === 'facebook' ? resolved.facebook : resolved.instagram;
  return options.find((o) => o.target_id === targetId) ?? null;
}
