import type { OutputType } from '@/types/db';

export type ProductionPermissionType = OutputType | 'quote' | 'upload';
export type OutputPermissionsRole = 'admin' | 'user';

export type OutputPermissions = Record<
  ProductionPermissionType,
  Record<OutputPermissionsRole, boolean>
>;

export const PRODUCTION_PERMISSION_TYPES: Array<{
  type: ProductionPermissionType;
  label: string;
}> = [
  { type: 'image', label: 'תמונה / גרפיקה' },
  { type: 'text', label: 'פוסט / טקסט' },
  { type: 'presentation', label: 'מצגת' },
  { type: 'pdf', label: 'מסמך' },
  { type: 'quote', label: 'הצעת מחיר' },
  { type: 'upload', label: 'העלאת תכנים של המותג' },
];

export const DEFAULT_OUTPUT_PERMISSIONS: OutputPermissions = {
  image: { admin: true, user: true },
  text: { admin: true, user: true },
  presentation: { admin: false, user: false },
  pdf: { admin: false, user: false },
  quote: { admin: true, user: true },
  upload: { admin: true, user: true },
};

export function normalizeOutputPermissions(value: unknown): OutputPermissions {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return PRODUCTION_PERMISSION_TYPES.reduce((next, item) => {
    const row = source[item.type] && typeof source[item.type] === 'object'
      ? source[item.type] as Record<string, unknown>
      : {};
    next[item.type] = {
      admin: typeof row.admin === 'boolean' ? row.admin : DEFAULT_OUTPUT_PERMISSIONS[item.type].admin,
      user: typeof row.user === 'boolean' ? row.user : DEFAULT_OUTPUT_PERMISSIONS[item.type].user,
    };
    return next;
  }, {} as OutputPermissions);
}

export function canProduceType(
  permissions: OutputPermissions,
  type: ProductionPermissionType,
  role: OutputPermissionsRole,
  canCreateOutputs = true,
): boolean {
  if (role === 'user' && !canCreateOutputs) return false;
  return permissions[type]?.[role] !== false;
}

// A per-user override (profiles.output_permissions) layered over the global
// setting. `null`/`undefined` override = pure global. Each type the override
// mentions replaces the global for that type only.
export function mergeUserPermissions(
  global: OutputPermissions,
  override: unknown,
): OutputPermissions {
  const src = override && typeof override === 'object' ? (override as Record<string, unknown>) : null;
  if (!src) return global;
  return PRODUCTION_PERMISSION_TYPES.reduce((next, item) => {
    const row = src[item.type] && typeof src[item.type] === 'object'
      ? (src[item.type] as Record<string, unknown>)
      : null;
    next[item.type] = {
      admin: row && typeof row.admin === 'boolean' ? row.admin : global[item.type].admin,
      user: row && typeof row.user === 'boolean' ? row.user : global[item.type].user,
    };
    return next;
  }, {} as OutputPermissions);
}

// Monthly production quotas (profiles.monthly_limits) — the numbers that feed
// the client's price quote. `graphics` bundles post text + image.
export type MonthlyLimitGroup = 'graphics' | 'presentations' | 'documents' | 'uploads';

export const MONTHLY_LIMIT_GROUPS: Array<{ group: MonthlyLimitGroup; label: string; hint: string }> = [
  { group: 'graphics', label: 'גרפיקות', hint: 'פוסט + תמונה נספרים כתוצר אחד' },
  { group: 'presentations', label: 'מצגות', hint: '' },
  { group: 'documents', label: 'מסמכים והצעות מחיר', hint: '' },
  { group: 'uploads', label: 'העלאות תכני מותג', hint: 'לא נאכף עדיין' },
];

export function normalizeMonthlyLimits(value: unknown): Record<MonthlyLimitGroup, number> {
  const src = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return MONTHLY_LIMIT_GROUPS.reduce((next, { group }) => {
    const n = Number(src[group]);
    next[group] = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    return next;
  }, {} as Record<MonthlyLimitGroup, number>);
}
