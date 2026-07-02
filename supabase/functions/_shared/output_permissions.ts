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
    .select('role, can_create_outputs')
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

  const permissions = normalizeOutputPermissions(setting?.value_json);
  if (permissions[type]?.[role] === false) {
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
