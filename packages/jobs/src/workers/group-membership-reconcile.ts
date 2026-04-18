/**
 * Handler for `forma360:group-membership-reconcile` (Phase 1 § 1.3).
 *
 * For each rule-based group in scope:
 *   1. Load the current `group_membership_rules` for the group.
 *   2. Load every active user in the tenant + their custom-field values.
 *   3. For each user, evaluate the rules (evaluateRules).
 *   4. Diff against the current `group_members` rows (addedVia='rule_based').
 *   5. Apply the diff. Manual members (addedVia='manual') are ignored here —
 *      rule-based mode does not allow manual edits anyway, but if the
 *      group's mode was flipped from manual→rule_based the manual rows
 *      are preserved until the admin clears them explicitly.
 *
 * Enforces the 15,000 user cap per rule-based group (G-E02): if the rule
 * evaluation yields more than the cap, the handler stops adding, logs
 * `group-membership-capped`, and finishes with the partial set. The
 * admin-dashboard surface (router: `accessRules.listCappedReconciles` —
 * Phase 2+ scope) reads this log.
 *
 * Idempotent. Safe to re-run.
 */
import type { Database } from '@forma360/db/client';
import {
  customUserFields,
  groupMembers,
  groupMembershipRules,
  groups,
  user,
  userCustomFieldValues,
} from '@forma360/db/schema';
import { evaluateRules, type Rule, type UserFieldSnapshot } from '@forma360/permissions/rules';
import type { Logger } from '@forma360/shared/logger';
import type { Job } from 'bullmq';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { GroupReconcilePayload } from '../queues';

const MAX_USERS_PER_RULE_BASED_GROUP = 15_000;

export interface GroupReconcileDeps {
  db: Database;
  logger: Logger;
}

async function loadUserSnapshots(
  db: Database,
  tenantId: string,
): Promise<Map<string, UserFieldSnapshot>> {
  const users = await db
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.tenantId, tenantId), isNull(user.deactivatedAt)));

  // One round-trip for every value; the evaluator joins them per-user.
  const values = await db
    .select({
      userId: userCustomFieldValues.userId,
      fieldId: userCustomFieldValues.fieldId,
      value: userCustomFieldValues.value,
      type: customUserFields.type,
    })
    .from(userCustomFieldValues)
    .innerJoin(customUserFields, eq(userCustomFieldValues.fieldId, customUserFields.id))
    .where(eq(userCustomFieldValues.tenantId, tenantId));

  const byUser = new Map<string, UserFieldSnapshot>();
  for (const u of users) {
    byUser.set(u.id, { userId: u.id, fields: {} });
  }
  for (const v of values) {
    const snap = byUser.get(v.userId);
    if (snap === undefined) continue;
    // multi_select values are stored JSON-encoded; parse to array.
    if (v.type === 'multi_select') {
      try {
        const parsed = JSON.parse(v.value) as unknown;
        snap.fields[v.fieldId] = Array.isArray(parsed) ? (parsed as string[]) : [];
      } catch {
        snap.fields[v.fieldId] = [];
      }
    } else {
      snap.fields[v.fieldId] = v.value;
    }
  }
  return byUser;
}

async function reconcileOneGroup(
  deps: GroupReconcileDeps,
  tenantId: string,
  groupId: string,
  userSnapshots: Map<string, UserFieldSnapshot>,
): Promise<{ added: number; removed: number; capped: boolean }> {
  const ruleRows = await deps.db
    .select()
    .from(groupMembershipRules)
    .where(
      and(eq(groupMembershipRules.tenantId, tenantId), eq(groupMembershipRules.groupId, groupId)),
    )
    .orderBy(groupMembershipRules.order);

  // `conditions` comes out of jsonb as `{fieldId, operator: string, value}[]`;
  // evaluateRules() silently rejects unknown operators at runtime
  // (returning false), so the cast is safe — the router already validated
  // operator on write via validateRuleConditions.
  const rules: Rule[] = ruleRows.map((r) => ({
    id: r.id,
    order: r.order,
    conditions: r.conditions as Rule['conditions'],
  }));

  // Evaluate every user. Apply the 15k cap (G-E02) deterministically by
  // sorting userIds and taking the first N matches.
  const matches: string[] = [];
  const sortedUsers = [...userSnapshots.values()].sort((a, b) => (a.userId < b.userId ? -1 : 1));
  let capped = false;
  for (const snapshot of sortedUsers) {
    if (!evaluateRules(snapshot, rules)) continue;
    if (matches.length >= MAX_USERS_PER_RULE_BASED_GROUP) {
      capped = true;
      break;
    }
    matches.push(snapshot.userId);
  }
  const matchSet = new Set(matches);

  // Current rule-based members for this group.
  const currentRows = await deps.db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.tenantId, tenantId),
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.addedVia, 'rule_based'),
      ),
    );
  const currentSet = new Set(currentRows.map((r) => r.userId));

  const toAdd = [...matchSet].filter((u) => !currentSet.has(u));
  const toRemove = [...currentSet].filter((u) => !matchSet.has(u));

  if (toAdd.length > 0) {
    await deps.db
      .insert(groupMembers)
      .values(
        toAdd.map((userId) => ({
          tenantId,
          groupId,
          userId,
          addedVia: 'rule_based',
          addedBy: null,
        })),
      )
      .onConflictDoNothing();
  }

  if (toRemove.length > 0) {
    // Only delete rule_based rows — never touch manual membership.
    await deps.db.delete(groupMembers).where(
      and(
        eq(groupMembers.tenantId, tenantId),
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.addedVia, 'rule_based'),
        sql`${groupMembers.userId} IN (${sql.join(
          toRemove.map((u) => sql`${u}`),
          sql`, `,
        )})`,
      ),
    );
  }

  return { added: toAdd.length, removed: toRemove.length, capped };
}

export function createGroupReconcileHandler(deps: GroupReconcileDeps) {
  return async function handleGroupReconcile(job: Job<GroupReconcilePayload>): Promise<void> {
    const { tenantId, groupId } = job.data;
    const log = deps.logger.child({ job_id: job.id, queue: job.queueName, tenantId });
    log.info({ groupId }, '[group-reconcile] starting');

    const snapshots = await loadUserSnapshots(deps.db, tenantId);

    let groupIds: string[];
    if (groupId !== undefined) {
      groupIds = [groupId];
    } else {
      const rows = await deps.db
        .select({ id: groups.id })
        .from(groups)
        .where(
          and(
            eq(groups.tenantId, tenantId),
            eq(groups.membershipMode, 'rule_based'),
            isNull(groups.archivedAt),
          ),
        );
      groupIds = rows.map((r) => r.id);
    }

    for (const id of groupIds) {
      const result = await reconcileOneGroup(deps, tenantId, id, snapshots);
      log.info(
        {
          groupId: id,
          added: result.added,
          removed: result.removed,
          capped: result.capped,
        },
        result.capped ? '[group-reconcile] group-membership-capped' : '[group-reconcile] done',
      );
    }
  };
}
