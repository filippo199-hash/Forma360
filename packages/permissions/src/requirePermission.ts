/**
 * Permission-loading primitives used by the `requirePermission(perm)` tRPC
 * middleware. The middleware itself lives in `@forma360/api` — this file
 * stays DB-only so it can be shared by scripts, tests, and workers without
 * pulling tRPC into those bundles.
 */
import { permissionSets, user } from '@forma360/db/schema';
import type { Database } from '@forma360/db/client';
import { and, eq } from 'drizzle-orm';
import { isPermissionKey, type PermissionKey } from './catalogue';

/**
 * Load the permission list for the given (tenant, user). Unknown keys in
 * the stored JSON are dropped silently — if a deprecated catalogue entry
 * lingers in an old permission set, we do NOT grant phantom access.
 * Returns an empty array when the user is missing or cross-tenant.
 */
export async function loadUserPermissions(
  db: Database,
  tenantId: string,
  userId: string,
): Promise<readonly PermissionKey[]> {
  const rows = await db
    .select({ permissions: permissionSets.permissions })
    .from(user)
    .innerJoin(permissionSets, eq(user.permissionSetId, permissionSets.id))
    .where(and(eq(user.id, userId), eq(user.tenantId, tenantId)))
    .limit(1);
  const row = rows[0];
  if (row === undefined) return [];
  return row.permissions.filter(isPermissionKey);
}

/** Pure predicate. Use for UI "is this button enabled?" without a DB trip. */
export function hasPermission(perms: ReadonlyArray<string>, required: PermissionKey): boolean {
  return perms.includes(required);
}
