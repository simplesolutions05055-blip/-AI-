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
  presentation: { admin: true, user: true },
  pdf: { admin: true, user: true },
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
