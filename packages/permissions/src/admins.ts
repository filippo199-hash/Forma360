/**
 * Admin-count utilities for the S-E02 last-admin guard.
 *
 * A user is an **administrator** iff their permission set contains
 * `org.settings` (see `grantsAdminAccess` in `./catalogue`). This file
 * answers two questions application code needs repeatedly:
 *
 *   - How many *active* admins does this tenant have right now?
 *   - If the given user is downgraded / reassigned / deactivated, how
 *     many active admins will remain?
 *
 * A value of 0 for the second answer is the condition the router blocks.
 */
import { permissionSets, user } from '@forma360/db/schema';
import type { Database } from '@forma360/db/client';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { grantsAdminAccess } from './catalogue';

/**
 * Count the active admins in a tenant. "Active" = not deactivated.
 */
export async function countAdmins(db: Database, tenantId: string): Promise<number> {
  // One round-trip: join user → permission_sets, filter by tenant +
  // not-deactivated + contains org.settings in the JSON array.
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(user)
    .innerJoin(permissionSets, eq(user.permissionSetId, permissionSets.id))
    .where(
      and(
        eq(user.tenantId, tenantId),
        isNull(user.deactivatedAt),
        sql`${permissionSets.permissions} @> '["org.settings"]'::jsonb`,
      ),
    );
  return rows[0]?.count ?? 0;
}

/**
 * Would the given mutation leave the tenant with fewer admins than `min`?
 * `afterPermissions` is the new permission list the target user would hold
 * (or `null` when the target is being deactivated).
 *
 * The function loads the current admin count and adjusts by ±1 based on
 * whether the target was an admin before and whether they would be one
 * after. Returns true when the mutation would break the invariant.
 */
export async function wouldDropBelowMinAdmins(
  db: Database,
  input: {
    tenantId: string;
    /** User the mutation targets. */
    targetUserId: string;
    /** Permission-set keys the target will hold after the mutation, or null when deactivating. */
    afterPermissions: readonly string[] | null;
    /** Minimum admins required; defaults to 1. */
    min?: number;
  },
): Promise<boolean> {
  const min = input.min ?? 1;

  const current = await db
    .select({
      permissions: permissionSets.permissions,
      deactivatedAt: user.deactivatedAt,
    })
    .from(user)
    .innerJoin(permissionSets, eq(user.permissionSetId, permissionSets.id))
    .where(and(eq(user.tenantId, input.tenantId), eq(user.id, input.targetUserId)))
    .limit(1);

  const currentRow = current[0];
  const wasAdmin =
    currentRow !== undefined &&
    currentRow.deactivatedAt === null &&
    grantsAdminAccess(currentRow.permissions);
  const willBeAdmin = input.afterPermissions !== null && grantsAdminAccess(input.afterPermissions);

  const total = await countAdmins(db, input.tenantId);
  const delta = (willBeAdmin ? 1 : 0) - (wasAdmin ? 1 : 0);
  const after = total + delta;
  return after < min;
}
