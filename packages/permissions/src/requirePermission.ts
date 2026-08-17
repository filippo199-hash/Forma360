/**
 * Permission-loading primitives used by the `requirePermission(perm)` tRPC
 * middleware. The middleware itself lives in `@forma360/api` — this file
 * stays DB-only so it can be shared by scripts, tests, and workers without
 * pulling tRPC into those bundles.
 */
import { permissionSets, user } from '@forma360/db/schema';
import type { Database } from '@forma360/db/client';
import { and, eq, isNull } from 'drizzle-orm';
import { grantsAdminAccess, isPermissionKey, type PermissionKey } from './catalogue';

/**
 * Is this (tenant, user) still entitled to act?
 *
 * False when the row is missing, belongs to another tenant, or has been
 * deactivated (which `users.anonymise` also stamps). This is THE revocation
 * boundary, and it is deliberately a live read rather than anything carried
 * on the session: better-auth holds sessions in Redis secondary storage with
 * a 90-day window and a 5-minute cookie cache, so a token in the wild
 * outlives any storage-side delete we attempt. Deactivating a user used to
 * stamp a date and nothing else, which left a terminated administrator with
 * full read/write access until their cookie expired — up to three months.
 *
 * Call it wherever a session is turned into an actor. Cost is one
 * primary-key lookup on an already-hot row.
 */
export async function isUserActive(
  db: Database,
  tenantId: string,
  userId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.id, userId), eq(user.tenantId, tenantId), isNull(user.deactivatedAt)))
    .limit(1);
  return rows.length > 0;
}

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
    // A deactivated user holds no permissions. `countAdmins` and
    // `usersHoldingPermission` already filtered on this; the hot path that
    // actually gates access did not, so a deactivated account kept every key
    // it had. Losing the filter here re-opens that hole.
    .where(and(eq(user.id, userId), eq(user.tenantId, tenantId), isNull(user.deactivatedAt)))
    .limit(1);
  const row = rows[0];
  if (row === undefined) return [];
  return row.permissions.filter(isPermissionKey);
}

/**
 * Pure predicate. Use for UI "is this button enabled?" without a DB trip.
 * Administrators (holders of `org.settings`) implicitly hold every catalogue
 * key — otherwise a permission-set snapshot taken before a new module existed
 * would lock admins out of it.
 */
export function hasPermission(perms: ReadonlyArray<string>, required: PermissionKey): boolean {
  return perms.includes(required) || grantsAdminAccess(perms);
}
