/**
 * Handler for `forma360:site-membership-reconcile` (Phase 1 § 1.4).
 *
 * Mirror of the group reconcile, against `site_members` +
 * `site_membership_rules`. See group-membership-reconcile.ts for the
 * full rationale; the logic here is byte-for-byte the same modulo the
 * tables.
 */
import type { Database } from '@forma360/db/client';
import {
  customUserFields,
  siteMembers,
  siteMembershipRules,
  sites,
  user,
  userCustomFieldValues,
} from '@forma360/db/schema';
import { evaluateRules, type Rule, type UserFieldSnapshot } from '@forma360/permissions/rules';
import type { Logger } from '@forma360/shared/logger';
import type { Job } from 'bullmq';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { SiteReconcilePayload } from '../queues';

export interface SiteReconcileDeps {
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

async function reconcileOneSite(
  deps: SiteReconcileDeps,
  tenantId: string,
  siteId: string,
  userSnapshots: Map<string, UserFieldSnapshot>,
): Promise<{ added: number; removed: number }> {
  const ruleRows = await deps.db
    .select()
    .from(siteMembershipRules)
    .where(and(eq(siteMembershipRules.tenantId, tenantId), eq(siteMembershipRules.siteId, siteId)))
    .orderBy(siteMembershipRules.order);

  // Jsonb conditions → Rule.conditions. Router validated operator on write.
  const rules: Rule[] = ruleRows.map((r) => ({
    id: r.id,
    order: r.order,
    conditions: r.conditions as Rule['conditions'],
  }));

  const matches = new Set<string>();
  for (const snap of userSnapshots.values()) {
    if (evaluateRules(snap, rules)) matches.add(snap.userId);
  }

  const currentRows = await deps.db
    .select({ userId: siteMembers.userId })
    .from(siteMembers)
    .where(
      and(
        eq(siteMembers.tenantId, tenantId),
        eq(siteMembers.siteId, siteId),
        eq(siteMembers.addedVia, 'rule_based'),
      ),
    );
  const currentSet = new Set(currentRows.map((r) => r.userId));

  const toAdd = [...matches].filter((u) => !currentSet.has(u));
  const toRemove = [...currentSet].filter((u) => !matches.has(u));

  if (toAdd.length > 0) {
    await deps.db
      .insert(siteMembers)
      .values(
        toAdd.map((userId) => ({
          tenantId,
          siteId,
          userId,
          addedVia: 'rule_based',
        })),
      )
      .onConflictDoNothing();
  }

  if (toRemove.length > 0) {
    await deps.db.delete(siteMembers).where(
      and(
        eq(siteMembers.tenantId, tenantId),
        eq(siteMembers.siteId, siteId),
        eq(siteMembers.addedVia, 'rule_based'),
        sql`${siteMembers.userId} IN (${sql.join(
          toRemove.map((u) => sql`${u}`),
          sql`, `,
        )})`,
      ),
    );
  }

  return { added: toAdd.length, removed: toRemove.length };
}

export function createSiteReconcileHandler(deps: SiteReconcileDeps) {
  return async function handleSiteReconcile(job: Job<SiteReconcilePayload>): Promise<void> {
    const { tenantId, siteId } = job.data;
    const log = deps.logger.child({ job_id: job.id, queue: job.queueName, tenantId });
    log.info({ siteId }, '[site-reconcile] starting');

    const snapshots = await loadUserSnapshots(deps.db, tenantId);

    let ids: string[];
    if (siteId !== undefined) {
      ids = [siteId];
    } else {
      const rows = await deps.db
        .select({ id: sites.id })
        .from(sites)
        .where(
          and(
            eq(sites.tenantId, tenantId),
            eq(sites.membershipMode, 'rule_based'),
            isNull(sites.archivedAt),
          ),
        );
      ids = rows.map((r) => r.id);
    }

    for (const id of ids) {
      const result = await reconcileOneSite(deps, tenantId, id, snapshots);
      log.info(
        { siteId: id, added: result.added, removed: result.removed },
        '[site-reconcile] done',
      );
    }
  };
}
