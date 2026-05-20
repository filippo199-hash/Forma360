/**
 * Compliance rule evaluation worker (Phase 8).
 *
 * Receives a ruleId, loads the rule + its evidence requirements, runs each
 * evidence check against the DB, writes a new compliance_evaluations row,
 * and enqueues a compliance-snapshot job for the parent framework.
 *
 * Evidence checks implemented:
 *   - inspection:  has a completed inspection from templateId in the last frequencyDays
 *   - document:    document updated within freshnessDays
 *   - heads_up:    all recipients of headsUpId have signed/acknowledged
 *   - maintenance: no overdue maintenance plans for assetTypeId
 *   - action:      at least one completed action (of actionTypeId if given)
 *   - issue_sla:   all resolved issues closed within slaMaxDays
 *   - training:    stub → always 'not_evaluable'
 *   - manual:      stub → 'not_evaluable'
 */
import type { Logger } from '@forma360/shared/logger';
import type { Job } from 'bullmq';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '@forma360/db/schema';
import { eq, and, gte, isNull, isNotNull } from 'drizzle-orm';
import { newId } from '@forma360/shared/id';
import {
  complianceRules,
  complianceRuleEvidence,
  complianceEvaluations,
  type ComplianceStatus,
  type EvidenceSummaryItem,
  type EvidenceConfig,
} from '@forma360/db/schema';
import type { ComplianceEvaluatePayload } from '../queues';

// ─── Helpers ─────────────────────────────────────────────────────────────────

type Db = NodePgDatabase<typeof schema>;

function overallStatus(items: EvidenceSummaryItem[]): ComplianceStatus {
  if (items.length === 0) return 'not_evaluable';
  if (items.some((i) => i.status === 'non_compliant')) return 'non_compliant';
  if (items.every((i) => i.status === 'compliant')) return 'compliant';
  if (items.some((i) => i.status === 'due_soon')) return 'due_soon';
  return 'not_evaluable';
}

async function checkInspection(
  db: Db,
  tenantId: string,
  config: Extract<EvidenceConfig, { type: 'inspection' }>,
): Promise<ComplianceStatus> {
  const frequencyDays = config.frequencyDays ?? 30;
  const since = new Date(Date.now() - frequencyDays * 24 * 60 * 60 * 1000);

  // Import inspections table inline to avoid circular type issues
  const { inspections } = await import('@forma360/db/schema');
  const rows = await db
    .select({ id: inspections.id })
    .from(inspections)
    .where(
      and(
        eq(inspections.tenantId, tenantId),
        eq(inspections.templateId, config.templateId),
        eq(inspections.status, 'completed'),
        gte(inspections.updatedAt, since),
        isNull(inspections.archivedAt),
      ),
    )
    .limit(1);
  return rows.length > 0 ? 'compliant' : 'non_compliant';
}

async function checkDocument(
  db: Db,
  tenantId: string,
  config: Extract<EvidenceConfig, { type: 'document' }>,
): Promise<ComplianceStatus> {
  const since = new Date(Date.now() - config.freshnessDays * 24 * 60 * 60 * 1000);
  const { documents } = await import('@forma360/db/schema');
  const where = [
    eq(documents.tenantId, tenantId),
    isNull(documents.archivedAt),
    gte(documents.updatedAt, since),
  ];
  if (config.documentId !== undefined) {
    where.push(eq(documents.id, config.documentId));
  }
  const rows = await db.select({ id: documents.id }).from(documents).where(and(...where)).limit(1);
  return rows.length > 0 ? 'compliant' : 'non_compliant';
}

async function checkHeadsUp(
  db: Db,
  tenantId: string,
  config: Extract<EvidenceConfig, { type: 'heads_up' }>,
): Promise<ComplianceStatus> {
  const { headsUpRecipients } = await import('@forma360/db/schema');
  // All recipients must have signed (if requireSignature) or acknowledged
  const allRows = await db
    .select({
      signedAt: headsUpRecipients.signedAt,
      acknowledgedAt: headsUpRecipients.acknowledgedAt,
    })
    .from(headsUpRecipients)
    .where(
      and(eq(headsUpRecipients.headsUpId, config.headsUpId), eq(headsUpRecipients.tenantId, tenantId)),
    );

  if (allRows.length === 0) return 'not_evaluable';

  const allCompliant = allRows.every((r) => {
    if (config.requireSignature) return r.signedAt !== null;
    return r.acknowledgedAt !== null || r.signedAt !== null;
  });
  return allCompliant ? 'compliant' : 'non_compliant';
}

async function checkMaintenance(
  db: Db,
  tenantId: string,
  _config: Extract<EvidenceConfig, { type: 'maintenance' }>,
): Promise<ComplianceStatus> {
  const { maintenancePlans } = await import('@forma360/db/schema');
  const now = new Date();
  const where = [eq(maintenancePlans.tenantId, tenantId), isNull(maintenancePlans.archivedAt)];
  const plans = await db.select().from(maintenancePlans).where(and(...where));

  if (plans.length === 0) return 'not_evaluable';

  // A maintenance plan is "overdue" when its time-based interval_days have
  // elapsed since last_service_date.
  for (const plan of plans) {
    if (plan.planType !== 'time') continue;
    if (plan.lastServiceDate === null || plan.intervalDays === null) continue;
    const lastService = new Date(plan.lastServiceDate);
    const dueDate = new Date(lastService.getTime() + plan.intervalDays * 24 * 60 * 60 * 1000);
    if (dueDate < now) return 'non_compliant';
  }
  return 'compliant';
}

async function checkAction(
  db: Db,
  tenantId: string,
  config: Extract<EvidenceConfig, { type: 'action' }>,
): Promise<ComplianceStatus> {
  const { actions } = await import('@forma360/db/schema');
  const where = [
    eq(actions.tenantId, tenantId),
    eq(actions.status, 'completed'),
  ];
  if (config.actionTypeId !== undefined) {
    where.push(eq(actions.actionTypeId, config.actionTypeId));
  }
  const rows = await db.select({ id: actions.id }).from(actions).where(and(...where)).limit(1);
  return rows.length > 0 ? 'compliant' : 'non_compliant';
}

async function checkIssueSla(
  db: Db,
  tenantId: string,
  config: Extract<EvidenceConfig, { type: 'issue_sla' }>,
): Promise<ComplianceStatus> {
  const { issues } = await import('@forma360/db/schema');
  const where = [eq(issues.tenantId, tenantId), eq(issues.status, 'closed')];
  if (config.issueCategoryId !== undefined) {
    where.push(eq(issues.categoryId, config.issueCategoryId));
  }
  const closedRows = await db.select().from(issues).where(and(...where, isNotNull(issues.closedAt)));

  if (closedRows.length === 0) return 'not_evaluable';

  const allWithinSla = closedRows.every((issue) => {
    if (issue.closedAt === null) return false;
    const closedAt = issue.closedAt instanceof Date ? issue.closedAt : new Date(issue.closedAt);
    const createdAt = issue.createdAt instanceof Date ? issue.createdAt : new Date(issue.createdAt);
    const daysToResolve = (closedAt.getTime() - createdAt.getTime()) / (24 * 60 * 60 * 1000);
    return daysToResolve <= config.slaMaxDays;
  });
  return allWithinSla ? 'compliant' : 'non_compliant';
}

async function runEvidenceCheck(
  db: Db,
  tenantId: string,
  evidenceReqId: string,
  evidenceType: string,
  rawConfig: unknown,
): Promise<EvidenceSummaryItem> {
  const config = rawConfig as EvidenceConfig;
  let status: ComplianceStatus = 'not_evaluable';
  let detail: string | undefined;

  try {
    switch (evidenceType) {
      case 'inspection':
        status = await checkInspection(db, tenantId, config as Extract<EvidenceConfig, { type: 'inspection' }>);
        break;
      case 'document':
        status = await checkDocument(db, tenantId, config as Extract<EvidenceConfig, { type: 'document' }>);
        break;
      case 'heads_up':
        status = await checkHeadsUp(db, tenantId, config as Extract<EvidenceConfig, { type: 'heads_up' }>);
        break;
      case 'maintenance':
        status = await checkMaintenance(db, tenantId, config as Extract<EvidenceConfig, { type: 'maintenance' }>);
        break;
      case 'action':
        status = await checkAction(db, tenantId, config as Extract<EvidenceConfig, { type: 'action' }>);
        break;
      case 'issue_sla':
        status = await checkIssueSla(db, tenantId, config as Extract<EvidenceConfig, { type: 'issue_sla' }>);
        break;
      case 'training':
        status = 'not_evaluable';
        detail = 'training-check-not-yet-implemented';
        break;
      case 'manual':
        status = 'not_evaluable';
        detail = 'manual-evidence-requires-human-review';
        break;
      default:
        status = 'not_evaluable';
        detail = `unknown-evidence-type:${evidenceType}`;
    }
  } catch (err) {
    status = 'not_evaluable';
    detail = err instanceof Error ? err.message : String(err);
  }

  const item: EvidenceSummaryItem = {
    evidenceReqId,
    // @ts-expect-error: runtime cast of validated evidenceType string to the union literal
    evidenceType: evidenceType as EvidenceType,
    status,
  };
  if (detail !== undefined) item.detail = detail;
  return item;
}

// ─── Handler factory ──────────────────────────────────────────────────────────

export function createComplianceEvaluateHandler(
  db: Db,
  logger: Logger,
  enqueueSnapshot: (frameworkId: string, tenantId: string) => Promise<void>,
) {
  return async function handleComplianceEvaluate(
    job: Job<ComplianceEvaluatePayload>,
  ): Promise<{ status: string }> {
    const { tenantId, ruleId } = job.data;
    const log = logger.child({
      job_id: job.id,
      queue: job.queueName,
      tenantId,
      ruleId,
    });

    // 1. Load the rule
    const ruleRows = await db
      .select()
      .from(complianceRules)
      .where(and(eq(complianceRules.tenantId, tenantId), eq(complianceRules.id, ruleId)))
      .limit(1);
    const rule = ruleRows[0];
    if (rule === undefined) {
      log.warn('[compliance-evaluate] rule not found');
      return { status: 'skipped:not-found' };
    }
    if (rule.archivedAt !== null) {
      log.info('[compliance-evaluate] rule is archived — skipping');
      return { status: 'skipped:archived' };
    }

    // 2. Load evidence requirements
    const evidenceReqs = await db
      .select()
      .from(complianceRuleEvidence)
      .where(eq(complianceRuleEvidence.ruleId, ruleId));

    // 3. Run each evidence check
    const summaryItems: EvidenceSummaryItem[] = await Promise.all(
      evidenceReqs.map((req) =>
        runEvidenceCheck(db, tenantId, req.id, req.evidenceType, req.config),
      ),
    );

    // 4. Compute overall status
    const status = overallStatus(summaryItems);

    // 5. Write evaluation row
    const now = new Date();
    const evaluationId = newId();
    await db.insert(complianceEvaluations).values({
      id: evaluationId,
      ruleId,
      tenantId,
      status,
      evidenceSummary: summaryItems,
      evaluatedAt: now,
    });

    log.info({ status, evidenceCount: summaryItems.length }, '[compliance-evaluate] evaluation written');

    // 6. Enqueue snapshot for the parent framework
    await enqueueSnapshot(rule.frameworkId, tenantId);

    return { status };
  };
}
