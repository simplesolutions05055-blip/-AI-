type ProductionPermissionType = 'text' | 'image' | 'pdf' | 'presentation' | 'quote';
type Role = 'admin' | 'user';

type OutputPermissions = Record<ProductionPermissionType, Record<Role, boolean>>;

const DEFAULT_OUTPUT_PERMISSIONS: OutputPermissions = {
  image: { admin: true, user: true },
  text: { admin: true, user: true },
  presentation: { admin: true, user: true },
  pdf: { admin: true, user: true },
  quote: { admin: true, user: true },
};

const TYPES: ProductionPermissionType[] = ['image', 'text', 'presentation', 'pdf', 'quote'];

export async function assertCanProduce(
  database: any,
  userId: string | null,
  type: ProductionPermissionType,
): Promise<void> {
  if (!userId) throw new PermissionError('login_required');

  const { data: profile, error: profileError } = await database
    .from('profiles')
    .select('role, can_create_outputs, output_permissions')
    .eq('id', userId)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile) throw new PermissionError('profile_required');

  const role: Role = profile.role === 'admin' ? 'admin' : 'user';
  if (role === 'user' && profile.can_create_outputs !== true) {
    throw new PermissionError('output_creation_disabled');
  }

  const { data: setting, error: settingError } = await database
    .from('settings')
    .select('value_json')
    .eq('key', 'output_permissions')
    .maybeSingle();
  if (settingError) throw settingError;

  // Global setting is the baseline; the user's own override (if any) wins per
  // type. Only the user's own role slot is consulted.
  const globalPerms = normalizeOutputPermissions(setting?.value_json);
  const override = profile.output_permissions;
  const overrideRow =
    override && typeof override === 'object' && (override as Record<string, unknown>)[type];
  const userSlot =
    overrideRow && typeof overrideRow === 'object'
      ? (overrideRow as Record<string, unknown>)[role]
      : undefined;
  const allowed = typeof userSlot === 'boolean' ? userSlot : globalPerms[type]?.[role] !== false;
  if (!allowed) {
    throw new PermissionError('output_type_disabled');
  }
}

export class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermissionError';
  }
}

function normalizeOutputPermissions(value: unknown): OutputPermissions {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const next = { ...DEFAULT_OUTPUT_PERMISSIONS };
  for (const type of TYPES) {
    const row = source[type] && typeof source[type] === 'object'
      ? source[type] as Record<string, unknown>
      : {};
    next[type] = {
      admin: typeof row.admin === 'boolean' ? row.admin : DEFAULT_OUTPUT_PERMISSIONS[type].admin,
      user: typeof row.user === 'boolean' ? row.user : DEFAULT_OUTPUT_PERMISSIONS[type].user,
    };
  }
  return next;
}

// Non-throwing variant for the WhatsApp flow: which deliverable types this user
// may create. The bot must offer exactly what the site's permissions allow —
// an unknown/unlinked sender gets nothing.
export async function allowedOutputTypes(
  database: any,
  userId: string | null,
): Promise<Set<ProductionPermissionType>> {
  const allowed = new Set<ProductionPermissionType>();
  if (!userId) return allowed;
  for (const type of TYPES) {
    try {
      await assertCanProduce(database, userId, type);
      allowed.add(type);
    } catch (e) {
      if (!(e instanceof PermissionError)) throw e;
    }
  }
  return allowed;
}

export async function canProduce(
  database: any,
  userId: string | null,
  type: ProductionPermissionType,
): Promise<boolean> {
  try {
    await assertCanProduce(database, userId, type);
    return true;
  } catch (e) {
    if (e instanceof PermissionError) return false;
    throw e;
  }
}

export type { ProductionPermissionType };
