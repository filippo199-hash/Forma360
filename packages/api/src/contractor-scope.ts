/**
 * Data-level scoping for external contractor portal users.
 *
 * A portal contractor user (a row in `contractor_users`) is granted tenant-wide
 * `inspections.view` / `issues.view` / `actions.view` by their activities, but
 * must only see records tied to their OWN contractor. Inspections/issues/actions
 * carry no `contractorId` column — the only reliable bridge is authorship, so
 * "their own records" = authored (or, for actions, assigned) by any user of the
 * same contractor. Internal users return `null` here and are unrestricted by
 * this mechanism (they are still bound by permissions + access rules).
 *
 * Closes the gap `contractor-activities.ts` flagged as "a later refinement".
 */
import type { Database } from '@forma360/db/client';
import { contractorUsers } from '@forma360/db/schema';
import { and, eq } from 'drizzle-orm';

export interface ContractorScope {
  contractorId: string;
  /** Every portal-user id belonging to the caller's contractor (≥ 1: the caller). */
  userIds: string[];
}

/**
 * Resolve the caller's contractor scope, or `null` if they are an internal user.
 * One indexed lookup on `contractor_users.userId` for the common (internal)
 * case; a second query only when the caller is actually a portal user.
 */
export async function loadContractorScope(
  db: Database,
  tenantId: string,
  userId: string,
): Promise<ContractorScope | null> {
  const meRows = await db
    .select({ contractorId: contractorUsers.contractorId })
    .from(contractorUsers)
    .where(and(eq(contractorUsers.tenantId, tenantId), eq(contractorUsers.userId, userId)))
    .limit(1);
  const me = meRows[0];
  if (me === undefined) return null;

  const userRows = await db
    .select({ userId: contractorUsers.userId })
    .from(contractorUsers)
    .where(
      and(
        eq(contractorUsers.tenantId, tenantId),
        eq(contractorUsers.contractorId, me.contractorId),
      ),
    );
  return { contractorId: me.contractorId, userIds: userRows.map((r) => r.userId) };
}
