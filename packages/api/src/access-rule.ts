/**
 * DB-backed access-rule evaluation shared across routers.
 *
 * `resolveAccessRule` (from `@forma360/permissions/access`) is pure — this
 * wraps it with the tenant's stored rule row + the caller's live group/site
 * membership, so a template AND the inspections conducted from it can gate
 * reads by the same rule (extends the B3 template-content gate to inspection
 * instances). A missing / invalidated rule denies non-managers, matching the
 * `list` filter semantics. Managers bypass — callers check that themselves.
 */
import type { Database } from '@forma360/db/client';
import { accessRules, groupMembers, siteMembers } from '@forma360/db/schema';
import { resolveAccessRule } from '@forma360/permissions/access';
import { and, eq } from 'drizzle-orm';

export interface CallerAccessSnapshot {
  groupIds: string[];
  siteIds: string[];
}

/** The caller's current group + site membership, for access-rule evaluation. */
export async function loadCallerAccessSnapshot(
  db: Database,
  tenantId: string,
  userId: string,
): Promise<CallerAccessSnapshot> {
  const [groups, sites] = await Promise.all([
    db
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(and(eq(groupMembers.tenantId, tenantId), eq(groupMembers.userId, userId))),
    db
      .select({ siteId: siteMembers.siteId })
      .from(siteMembers)
      .where(and(eq(siteMembers.tenantId, tenantId), eq(siteMembers.userId, userId))),
  ]);
  return { groupIds: groups.map((g) => g.groupId), siteIds: sites.map((s) => s.siteId) };
}

/**
 * Whether the caller satisfies a stored access rule. A missing or invalidated
 * rule returns false (deny). Pass a preloaded `snapshot` to avoid re-querying
 * memberships when checking many rules for one caller.
 */
export async function callerSatisfiesAccessRule(
  db: Database,
  tenantId: string,
  userId: string,
  accessRuleId: string,
  snapshot?: CallerAccessSnapshot,
): Promise<boolean> {
  const ruleRows = await db
    .select()
    .from(accessRules)
    .where(and(eq(accessRules.tenantId, tenantId), eq(accessRules.id, accessRuleId)))
    .limit(1);
  const rule = ruleRows[0];
  if (rule === undefined) return false;
  const snap = snapshot ?? (await loadCallerAccessSnapshot(db, tenantId, userId));
  return resolveAccessRule(
    {
      id: rule.id,
      groupIds: rule.groupIds,
      siteIds: rule.siteIds,
      invalidatedAt: rule.invalidatedAt,
    },
    snap,
  );
}
