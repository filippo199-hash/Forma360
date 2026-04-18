/**
 * Advanced access rule resolver.
 *
 * An access rule matches a user iff:
 *   - the rule is not invalidated (G-E06: invalidated rules grant NO access)
 *   - the user belongs to ANY of the rule's groups (or the list is empty,
 *     which matches every group)
 *   - AND the user belongs to ANY of the rule's sites (same empty-list rule)
 *
 * Pure function; every Phase 2+ module (templates, inspections, issues,
 * actions, training) gates access through one of these. Tested heavily so
 * the downstream modules can trust the semantics without re-testing them.
 *
 * Intentionally NOT in this file: loading memberships from the DB. Callers
 * pass in `{ groupIds, siteIds }` snapshots — separating the snapshot from
 * the resolution keeps the function testable without a Drizzle instance.
 */

export interface AccessRuleShape {
  id: string;
  groupIds: readonly string[];
  siteIds: readonly string[];
  /** When non-null the rule is invalidated (G-E06). */
  invalidatedAt: Date | null;
}

export interface UserMembershipSnapshot {
  groupIds: readonly string[];
  siteIds: readonly string[];
}

/**
 * Evaluate an access rule against a user's membership snapshot.
 *
 * Empty `groupIds` / `siteIds` mean "any group" / "any site" — matching
 * the common pattern "Auditors group at Manchester" where only one axis
 * is constrained.
 */
export function resolveAccessRule(rule: AccessRuleShape, user: UserMembershipSnapshot): boolean {
  // Invalidated rules resolve to no access (G-E06). A non-null
  // invalidatedAt is how the Settings dashboard surfaces broken rules
  // for the admin to fix; at runtime, it's deny.
  if (rule.invalidatedAt !== null) return false;

  const groupOk =
    rule.groupIds.length === 0 || rule.groupIds.some((gid) => user.groupIds.includes(gid));
  const siteOk =
    rule.siteIds.length === 0 || rule.siteIds.some((sid) => user.siteIds.includes(sid));

  return groupOk && siteOk;
}
