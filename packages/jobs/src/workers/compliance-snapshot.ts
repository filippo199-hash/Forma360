/**
 * Compliance snapshot worker (Phase 8).
 *
 * For a given framework, loads all active (non-archived) rules, reads their
 * latest evaluation status, and upserts a compliance_snapshots row for today.
 *
 * score_pct = (compliant_count / total_rules) * 100, where total_rules
 * includes only rules that have at least one evaluation. Rules that have
 * never been evaluated count as 'not_evaluable' and are included in
 * total_rules for correctness.
 */
import type { Logger } from '@forma360/shared/logger';
import type { Job } from 'bullmq';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '@forma360/db/schema';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { newId } from '@forma360/shared/id';
import {
  complianceFrameworks,
  complianceRules,
  complianceEvaluations,
  complianceSnapshots,
  type ComplianceStatus,
} from '@forma360/db/schema';
import type { ComplianceSnapshotPayload } from '../queues';

type Db = NodePgDatabase<typeof schema>;

export function createComplianceSnapshotHandler(db: Db, logger: Logger) {
  return async function handleComplianceSnapshot(
    job: Job<ComplianceSnapshotPayload>,
  ): Promise<{ scorePct: number; totalRules: number }> {
    const { tenantId, frameworkId } = job.data;
    const log = logger.child({
      job_id: job.id,
      queue: job.queueName,
      tenantId,
      frameworkId,
    });

    // Verify framework exists and belongs to this tenant
    const fwRows = await db
      .select({ id: complianceFrameworks.id })
      .from(complianceFrameworks)
      .where(
        and(eq(complianceFrameworks.tenantId, tenantId), eq(complianceFrameworks.id, frameworkId)),
      )
      .limit(1);
    if (fwRows.length === 0) {
      log.warn('[compliance-snapshot] framework not found');
      return { scorePct: 0, totalRules: 0 };
    }

    // Load all active rules for this framework
    const activeRules = await db
      .select({ id: complianceRules.id })
      .from(complianceRules)
      .where(
        and(
          eq(complianceRules.tenantId, tenantId),
          eq(complianceRules.frameworkId, frameworkId),
          isNull(complianceRules.archivedAt),
        ),
      );

    const totalRules = activeRules.length;
    if (totalRules === 0) {
      log.info('[compliance-snapshot] no active rules — writing zero snapshot');
      await upsertSnapshot(db, frameworkId, tenantId, {
        scorePct: 0,
        totalRules: 0,
        compliantCount: 0,
        dueSoonCount: 0,
        nonCompliantCount: 0,
        notEvaluableCount: 0,
      });
      return { scorePct: 0, totalRules: 0 };
    }

    // For each rule, get the latest evaluation status
    const statusCounts: Record<ComplianceStatus, number> = {
      compliant: 0,
      due_soon: 0,
      non_compliant: 0,
      not_evaluable: 0,
    };

    for (const rule of activeRules) {
      const latestEval = await db
        .select({ status: complianceEvaluations.status })
        .from(complianceEvaluations)
        .where(
          and(
            eq(complianceEvaluations.ruleId, rule.id),
            eq(complianceEvaluations.tenantId, tenantId),
          ),
        )
        .orderBy(desc(complianceEvaluations.evaluatedAt))
        .limit(1);

      const statusVal = latestEval[0]?.status ?? 'not_evaluable';
      const key = statusVal as ComplianceStatus;
      statusCounts[key] = (statusCounts[key] ?? 0) + 1;
    }

    const scorePct =
      totalRules > 0 ? Math.round((statusCounts.compliant / totalRules) * 100 * 10) / 10 : 0;

    await upsertSnapshot(db, frameworkId, tenantId, {
      scorePct,
      totalRules,
      compliantCount: statusCounts.compliant,
      dueSoonCount: statusCounts.due_soon,
      nonCompliantCount: statusCounts.non_compliant,
      notEvaluableCount: statusCounts.not_evaluable,
    });

    log.info(
      { scorePct, totalRules, ...statusCounts },
      '[compliance-snapshot] snapshot upserted',
    );
    return { scorePct, totalRules };
  };
}

interface SnapshotCounts {
  scorePct: number;
  totalRules: number;
  compliantCount: number;
  dueSoonCount: number;
  nonCompliantCount: number;
  notEvaluableCount: number;
}

async function upsertSnapshot(
  db: Db,
  frameworkId: string,
  tenantId: string,
  counts: SnapshotCounts,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const id = newId();
  await db
    .insert(complianceSnapshots)
    .values({
      id,
      frameworkId,
      tenantId,
      snapshottedAt: today,
      scorePct: String(counts.scorePct),
      totalRules: counts.totalRules,
      compliantCount: counts.compliantCount,
      dueSoonCount: counts.dueSoonCount,
      nonCompliantCount: counts.nonCompliantCount,
      notEvaluableCount: counts.notEvaluableCount,
    })
    .onConflictDoUpdate({
      target: [complianceSnapshots.frameworkId, complianceSnapshots.snapshottedAt],
      set: {
        scorePct: String(counts.scorePct),
        totalRules: counts.totalRules,
        compliantCount: counts.compliantCount,
        dueSoonCount: counts.dueSoonCount,
        nonCompliantCount: counts.nonCompliantCount,
        notEvaluableCount: counts.notEvaluableCount,
      },
    });
}
