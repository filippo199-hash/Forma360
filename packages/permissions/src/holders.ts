/**
 * Who in a tenant holds a given permission — the recipient list for
 * permission-scoped notifications (the Fire Safety intolerable-FRA
 * alert and due-check digest email the holders of `fireSafety.manage`;
 * future modules follow the same pattern).
 *
 * Admin sets qualify implicitly: `grantsAdminAccess` treats
 * `org.settings` as the superset, matching `requirePermission`.
 */
import { permissionSets, user } from '@forma360/db/schema';
import type { Database } from '@forma360/db/client';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import type { PermissionKey } from './catalogue';

export interface PermissionHolder {
  userId: string;
  name: string;
  email: string;
  /** Preferred email language (PF-20); null = English. */
  locale: string | null;
}

/**
 * Active (non-deactivated) users whose permission set contains `perm`
 * or `org.settings`. Ordered by name for stable notification lists.
 */
export async function usersHoldingPermission(
  db: Database,
  tenantId: string,
  perm: PermissionKey,
): Promise<PermissionHolder[]> {
  const rows = await db
    .select({ userId: user.id, name: user.name, email: user.email, locale: user.locale })
    .from(user)
    .innerJoin(permissionSets, eq(user.permissionSetId, permissionSets.id))
    .where(
      and(
        eq(user.tenantId, tenantId),
        isNull(user.deactivatedAt),
        or(
          sql`${permissionSets.permissions} @> ${JSON.stringify([perm])}::jsonb`,
          sql`${permissionSets.permissions} @> '["org.settings"]'::jsonb`,
        ),
      ),
    )
    .orderBy(user.name);
  return rows;
}
