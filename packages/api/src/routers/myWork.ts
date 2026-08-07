/**
 * "My work" — the caller's own queue, and the counts the navigation puts
 * on it (ADR 0014).
 *
 * The dashboard (`analytics.*`) answers "how is the organisation doing"
 * and is gated on `analytics.view`, which most front-line users do not
 * hold. That left the majority of the user base with a menu full of
 * registers and no answer to the only question they open the product
 * with: *what is waiting for me?* This router is that answer.
 *
 * Two deliberate properties:
 *
 *   - **No permission gate.** Every row is keyed on `ctx.auth.userId` —
 *     you can only ever see work assigned to you. A permission check
 *     would be checking whether you are allowed to see your own name.
 *     The one exception is the approvals queue, which is a queue you own
 *     rather than a row you were assigned, so it is folded in only when
 *     the caller holds `inspections.manage`.
 *   - **Cheap.** `counts` is what the menu badge polls, so it is
 *     aggregates only — no row payloads, no joins beyond the one
 *     acknowledgement join that cannot be avoided.
 */
import {
  actions,
  fireLogbookChecks,
  fireRiskAssessments,
  headsUpRecipients,
  headsUps,
  incidents,
  inspections,
  inspectionWorkflowSigners,
  permits,
  riskAssessmentAcknowledgements,
  riskAssessments,
  trainingRecords,
  trainingRequirements,
} from '@forma360/db/schema';
import { grantsAdminAccess, type PermissionKey } from '@forma360/permissions/catalogue';
import { loadUserPermissions } from '@forma360/permissions/requirePermission';
import { OPEN_PERMIT_STATUSES } from '@forma360/shared/permits';
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  lt,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import { z } from 'zod';
import { tenantProcedure } from '../procedures';
import { router } from '../trpc';

/** Inspection statuses that mean "a reviewer still has to decide". */
const AWAITING_REVIEW = ['awaiting_approval', 'awaiting_signature_workflow'] as const;

/** The kinds of row the unified queue can contain. */
export const MY_WORK_KINDS = [
  'action',
  'acknowledgement',
  'signature',
  'inspection',
  'approval',
  // TR-A5: "when does my card expire?" is what nine in ten users want
  // from the training module. Without this their only door is the gap
  // list — a named list of every colleague's shortfalls.
  'training',
] as const;
export type MyWorkKind = (typeof MY_WORK_KINDS)[number];

export interface MyWorkRow {
  kind: MyWorkKind;
  id: string;
  title: string;
  /** Locale-less path; the client prefixes the active locale. */
  href: string;
  dueAt: Date | null;
  overdue: boolean;
}

/**
 * Modules that can put a needs-attention number on the menu. Brand-gated
 * (ADR 0010) so a deployment never spends queries on a module it does
 * not ship, and permission-gated per caller below.
 */
export const NAV_COUNT_MODULES = [
  'incidents',
  'permits',
  'riskAssessments',
  'fireSafety',
  'training',
] as const;
export type NavCountModule = (typeof NAV_COUNT_MODULES)[number];

const NAV_COUNT_PERMISSION: Record<NavCountModule, PermissionKey> = {
  incidents: 'incidents.view',
  permits: 'permits.view',
  riskAssessments: 'riskAssessments.view',
  fireSafety: 'fireSafety.view',
  training: 'training.view',
};

export interface MyWorkRouterDeps {
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
  /**
   * Which of {@link NAV_COUNT_MODULES} this deployment ships. Defaults to
   * all of them; the web app passes the brand catalogue.
   */
  enabledModules?: readonly NavCountModule[];
}

export function createMyWorkRouter(deps: MyWorkRouterDeps = {}) {
  const now = (): Date => deps.now?.() ?? new Date();
  const shipsModule = (module: NavCountModule): boolean =>
    deps.enabledModules === undefined || deps.enabledModules.includes(module);

  /** Does the caller own the approvals queue? */
  async function ownsApprovals(
    db: Parameters<typeof loadUserPermissions>[0],
    tenantId: string,
    userId: string,
  ): Promise<boolean> {
    const perms = await loadUserPermissions(db, tenantId, userId);
    return perms.includes('inspections.manage') || grantsAdminAccess(perms);
  }

  /**
   * The module needs-attention numbers the menu is allowed to show
   * (navigation review, recommendation 1). One batch, so a longer menu
   * costs one request rather than a dozen module `overview` calls.
   *
   * Each number answers "would a practitioner want to open this today":
   * incidents nobody has triaged or whose RIDDOR clock has run out,
   * permits past or near their window, risk assessments and fire records
   * past their review date. Anything the caller cannot view, or the
   * brand does not ship, is simply absent.
   */
  async function moduleAttention(
    db: Parameters<typeof loadUserPermissions>[0],
    tenantId: string,
    permissions: readonly string[],
    at: Date,
  ): Promise<Partial<Record<NavCountModule, number>>> {
    const isAdmin = grantsAdminAccess(permissions);
    const wants = (module: NavCountModule): boolean =>
      shipsModule(module) && (isAdmin || permissions.includes(NAV_COUNT_PERMISSION[module]));

    const out: Partial<Record<NavCountModule, number>> = {};
    const jobs: Array<Promise<void>> = [];

    if (wants('incidents')) {
      jobs.push(
        db
          .select({
            n: count(
              sql`CASE WHEN ${incidents.status} = 'reported'
                        OR ${incidents.riddorRescreenRequired}
                        OR (${incidents.riddorDeadlineAt} IS NOT NULL
                            AND ${incidents.riddorDeadlineAt} < ${at}
                            AND ${incidents.riddorSubmittedAt} IS NULL)
                   THEN 1 END`,
            ),
          })
          .from(incidents)
          .where(
            and(
              eq(incidents.tenantId, tenantId),
              notInArray(incidents.status, ['closed', 'cancelled']),
            ),
          )
          .then((rows) => {
            const n = rows[0]?.n ?? 0;
            if (n > 0) out.incidents = n;
          }),
      );
    }

    if (wants('permits')) {
      jobs.push(
        db
          .select({ status: permits.status, validTo: permits.validTo })
          .from(permits)
          .where(
            and(eq(permits.tenantId, tenantId), inArray(permits.status, [...OPEN_PERMIT_STATUSES])),
          )
          .then((rows) => {
            const soon = new Date(at.getTime() + 60 * 60_000);
            const n = rows.filter((r) => r.validTo !== null && r.validTo <= soon).length;
            if (n > 0) out.permits = n;
          }),
      );
    }

    if (wants('riskAssessments')) {
      jobs.push(
        db
          .select({ n: count() })
          .from(riskAssessments)
          .where(
            and(
              eq(riskAssessments.tenantId, tenantId),
              eq(riskAssessments.status, 'active'),
              lte(riskAssessments.nextReviewAt, at),
            ),
          )
          .then((rows) => {
            const n = rows[0]?.n ?? 0;
            if (n > 0) out.riskAssessments = n;
          }),
      );
    }

    if (wants('fireSafety')) {
      jobs.push(
        Promise.all([
          db
            .select({ n: count() })
            .from(fireLogbookChecks)
            .where(
              and(eq(fireLogbookChecks.tenantId, tenantId), lt(fireLogbookChecks.nextDueAt, at)),
            ),
          db
            .select({ n: count() })
            .from(fireRiskAssessments)
            .where(
              and(
                eq(fireRiskAssessments.tenantId, tenantId),
                lte(fireRiskAssessments.nextReviewAt, at),
              ),
            ),
        ]).then(([checks, fras]) => {
          const n = (checks[0]?.n ?? 0) + (fras[0]?.n ?? 0);
          if (n > 0) out.fireSafety = n;
        }),
      );
    }

    if (wants('training')) {
      jobs.push(
        db
          .select({ n: count() })
          .from(trainingRecords)
          .where(
            and(
              eq(trainingRecords.tenantId, tenantId),
              isNull(trainingRecords.supersededAt),
              isNotNull(trainingRecords.expiresAt),
              lt(trainingRecords.expiresAt, at),
            ),
          )
          .then((rows) => {
            // Expired only. "Expiring soon" is a plan, not an alarm, and a
            // badge that counts both trains people to ignore the number.
            const n = rows[0]?.n ?? 0;
            if (n > 0) out.training = n;
          }),
      );
    }

    await Promise.all(jobs);
    return out;
  }

  const counts = tenantProcedure.query(async ({ ctx }) => {
    const at = now();
    const me = ctx.auth.userId;

    const [actionRows, ackRows, raAckRows, signatureRows, draftRows, canApprove, modules] =
      await Promise.all([
        ctx.db
          .select({
            open: count(),
            overdue: count(
              sql`CASE WHEN ${actions.dueAt} IS NOT NULL AND ${actions.dueAt} < ${at} THEN 1 END`,
            ),
          })
          .from(actions)
          .where(
            and(
              eq(actions.tenantId, ctx.tenantId),
              eq(actions.assigneeUserId, me),
              notInArray(actions.status, ['completed', 'cancelled']),
              isNull(actions.archivedAt),
            ),
          ),
        ctx.db
          .select({ n: count() })
          .from(headsUpRecipients)
          .innerJoin(headsUps, eq(headsUps.id, headsUpRecipients.headsUpId))
          .where(
            and(
              eq(headsUps.tenantId, ctx.tenantId),
              eq(headsUps.status, 'published'),
              eq(headsUps.requireAcknowledgement, true),
              eq(headsUpRecipients.userId, me),
              isNull(headsUpRecipients.acknowledgedAt),
            ),
          ),
        // Risk-assessment sign-offs the caller still owes. Pending is
        // "never acknowledged, or acknowledged an older version" — the
        // re-distribution rule the RA module set (feedback A-1 / M-3).
        ctx.db
          .select({ n: count() })
          .from(riskAssessmentAcknowledgements)
          .where(
            and(
              eq(riskAssessmentAcknowledgements.tenantId, ctx.tenantId),
              eq(riskAssessmentAcknowledgements.userId, me),
              or(
                isNull(riskAssessmentAcknowledgements.acknowledgedAt),
                lt(
                  riskAssessmentAcknowledgements.acknowledgedVersion,
                  riskAssessmentAcknowledgements.versionNumber,
                ),
              ),
            ),
          ),
        ctx.db
          .select({ n: count() })
          .from(inspectionWorkflowSigners)
          .where(
            and(
              eq(inspectionWorkflowSigners.tenantId, ctx.tenantId),
              eq(inspectionWorkflowSigners.signerUserId, me),
              eq(inspectionWorkflowSigners.status, 'pending'),
            ),
          ),
        ctx.db
          .select({ n: count() })
          .from(inspections)
          .where(
            and(
              eq(inspections.tenantId, ctx.tenantId),
              eq(inspections.status, 'in_progress'),
              isNull(inspections.archivedAt),
              or(eq(inspections.conductedBy, me), eq(inspections.createdBy, me)),
            ),
          ),
        ownsApprovals(ctx.db, ctx.tenantId, me),
        loadUserPermissions(ctx.db, ctx.tenantId, me).then((perms) =>
          moduleAttention(ctx.db, ctx.tenantId, perms, at),
        ),
      ]);

    let awaitingApproval = 0;
    if (canApprove) {
      const rows = await ctx.db
        .select({ n: count() })
        .from(inspections)
        .where(
          and(
            eq(inspections.tenantId, ctx.tenantId),
            inArray(inspections.status, [...AWAITING_REVIEW]),
            isNull(inspections.archivedAt),
          ),
        );
      awaitingApproval = rows[0]?.n ?? 0;
    }

    const myOpenActions = actionRows[0]?.open ?? 0;
    const myHeadsUpAcks = ackRows[0]?.n ?? 0;
    const myRaAcks = raAckRows[0]?.n ?? 0;
    // "My acknowledgements" on the menu means everything the caller has
    // been asked to sign: briefings and risk-assessment sign-offs alike.
    const myPendingAcks = myHeadsUpAcks + myRaAcks;
    const mySignatures = signatureRows[0]?.n ?? 0;
    const myDraftInspections = draftRows[0]?.n ?? 0;

    return {
      myOpenActions,
      myOverdueActions: actionRows[0]?.overdue ?? 0,
      myPendingAcks,
      myHeadsUpAcks,
      myRaAcks,
      mySignatures,
      myDraftInspections,
      awaitingApproval,
      /** What the "My work" badge shows — the caller's own rows only. */
      total: myOpenActions + myPendingAcks + mySignatures + myDraftInspections,
      /** Needs-attention numbers per module for the menu (nav review §1). */
      modules,
    };
  });

  const list = tenantProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(50),
          kinds: z.array(z.enum(MY_WORK_KINDS)).optional(),
        })
        .default({ limit: 50 }),
    )
    .query(async ({ ctx, input }) => {
      const at = now();
      const me = ctx.auth.userId;
      const wants = (kind: MyWorkKind): boolean =>
        input.kinds === undefined || input.kinds.includes(kind);

      const rows: MyWorkRow[] = [];

      if (wants('action')) {
        const found = await ctx.db
          .select({
            id: actions.id,
            title: actions.title,
            dueAt: actions.dueAt,
            reference: actions.referenceNumber,
          })
          .from(actions)
          .where(
            and(
              eq(actions.tenantId, ctx.tenantId),
              eq(actions.assigneeUserId, me),
              notInArray(actions.status, ['completed', 'cancelled']),
              isNull(actions.archivedAt),
            ),
          )
          .orderBy(asc(actions.dueAt), desc(actions.id))
          .limit(input.limit);
        for (const r of found) {
          rows.push({
            kind: 'action',
            id: r.id,
            title: r.reference === null ? r.title : `${r.reference} — ${r.title}`,
            href: `/actions/${r.id}`,
            dueAt: r.dueAt,
            overdue: r.dueAt !== null && r.dueAt < at,
          });
        }
      }

      if (wants('acknowledgement')) {
        const found = await ctx.db
          .select({ id: headsUps.id, title: headsUps.title, expiresAt: headsUps.expiresAt })
          .from(headsUpRecipients)
          .innerJoin(headsUps, eq(headsUps.id, headsUpRecipients.headsUpId))
          .where(
            and(
              eq(headsUps.tenantId, ctx.tenantId),
              eq(headsUps.status, 'published'),
              eq(headsUps.requireAcknowledgement, true),
              eq(headsUpRecipients.userId, me),
              isNull(headsUpRecipients.acknowledgedAt),
            ),
          )
          .orderBy(asc(headsUps.expiresAt))
          .limit(input.limit);
        for (const r of found) {
          rows.push({
            kind: 'acknowledgement',
            id: r.id,
            title: r.title,
            href: `/heads-up/${r.id}/view`,
            dueAt: r.expiresAt,
            overdue: r.expiresAt !== null && r.expiresAt < at,
          });
        }

        // Risk-assessment sign-offs are acknowledgements too — the menu
        // promises "My acknowledgements", not "my briefings".
        const raFound = await ctx.db
          .select({
            id: riskAssessments.id,
            title: riskAssessments.title,
            reference: riskAssessments.referenceNumber,
            dueAt: riskAssessmentAcknowledgements.dueAt,
          })
          .from(riskAssessmentAcknowledgements)
          .innerJoin(
            riskAssessments,
            eq(riskAssessments.id, riskAssessmentAcknowledgements.assessmentId),
          )
          .where(
            and(
              eq(riskAssessmentAcknowledgements.tenantId, ctx.tenantId),
              eq(riskAssessmentAcknowledgements.userId, me),
              or(
                isNull(riskAssessmentAcknowledgements.acknowledgedAt),
                lt(
                  riskAssessmentAcknowledgements.acknowledgedVersion,
                  riskAssessmentAcknowledgements.versionNumber,
                ),
              ),
            ),
          )
          .orderBy(asc(riskAssessmentAcknowledgements.dueAt))
          .limit(input.limit);
        for (const r of raFound) {
          rows.push({
            kind: 'acknowledgement',
            id: r.id,
            title: r.reference === null ? r.title : `${r.reference} — ${r.title}`,
            href: `/risk-assessments/${r.id}`,
            dueAt: r.dueAt,
            overdue: r.dueAt !== null && r.dueAt < at,
          });
        }
      }

      if (wants('signature')) {
        const found = await ctx.db
          .select({
            id: inspections.id,
            title: inspections.title,
            position: inspectionWorkflowSigners.position,
          })
          .from(inspectionWorkflowSigners)
          .innerJoin(inspections, eq(inspections.id, inspectionWorkflowSigners.inspectionId))
          .where(
            and(
              eq(inspectionWorkflowSigners.tenantId, ctx.tenantId),
              eq(inspectionWorkflowSigners.signerUserId, me),
              eq(inspectionWorkflowSigners.status, 'pending'),
            ),
          )
          .limit(input.limit);
        for (const r of found) {
          rows.push({
            kind: 'signature',
            id: r.id,
            title: r.title,
            href: `/inspections/${r.id}/status`,
            dueAt: null,
            overdue: false,
          });
        }
      }

      // TR-A5: the caller's OWN training, so a standard user has a
      // personal door into the module instead of only the org-wide gap
      // list. Scoped to `me` by construction — it can never surface a
      // colleague's shortfall.
      if (wants('training')) {
        const found = await ctx.db
          .select({
            id: trainingRecords.id,
            requirementName: trainingRequirements.name,
            expiresAt: trainingRecords.expiresAt,
            leadDays: trainingRequirements.renewalLeadDays,
          })
          .from(trainingRecords)
          .innerJoin(
            trainingRequirements,
            eq(trainingRecords.requirementId, trainingRequirements.id),
          )
          .where(
            and(
              eq(trainingRecords.tenantId, ctx.tenantId),
              eq(trainingRecords.userId, me),
              isNull(trainingRecords.supersededAt),
              isNull(trainingRequirements.archivedAt),
              isNotNull(trainingRecords.expiresAt),
            ),
          )
          .orderBy(asc(trainingRecords.expiresAt))
          .limit(input.limit);
        for (const r of found) {
          if (r.expiresAt === null) continue;
          // Only surface what is actually worth acting on: inside the
          // requirement's own chase window, or already lapsed.
          const dueMs = r.expiresAt.getTime() - at.getTime();
          if (dueMs > r.leadDays * 86_400_000) continue;
          rows.push({
            kind: 'training',
            id: r.id,
            title: r.requirementName,
            href: `/training/me`,
            dueAt: r.expiresAt,
            overdue: r.expiresAt < at,
          });
        }
      }

      if (wants('inspection')) {
        const found = await ctx.db
          .select({
            id: inspections.id,
            title: inspections.title,
            startedAt: inspections.startedAt,
          })
          .from(inspections)
          .where(
            and(
              eq(inspections.tenantId, ctx.tenantId),
              eq(inspections.status, 'in_progress'),
              isNull(inspections.archivedAt),
              or(eq(inspections.conductedBy, me), eq(inspections.createdBy, me)),
            ),
          )
          .orderBy(desc(inspections.startedAt))
          .limit(input.limit);
        for (const r of found) {
          rows.push({
            kind: 'inspection',
            id: r.id,
            title: r.title,
            href: `/inspections/${r.id}`,
            dueAt: null,
            overdue: false,
          });
        }
      }

      if (wants('approval') && (await ownsApprovals(ctx.db, ctx.tenantId, me))) {
        const found = await ctx.db
          .select({ id: inspections.id, title: inspections.title })
          .from(inspections)
          .where(
            and(
              eq(inspections.tenantId, ctx.tenantId),
              inArray(inspections.status, [...AWAITING_REVIEW]),
              isNull(inspections.archivedAt),
            ),
          )
          .limit(input.limit);
        for (const r of found) {
          rows.push({
            kind: 'approval',
            id: r.id,
            title: r.title,
            href: `/approvals/${r.id}`,
            dueAt: null,
            overdue: false,
          });
        }
      }

      // Overdue first, then by due date, then undated. A single sort over
      // the merged set — the queue is "what is late", not "what is an
      // action"; grouping by module would bury the one overdue row under
      // thirty tidy ones.
      rows.sort((a, b) => {
        if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
        if (a.dueAt === null && b.dueAt === null) return 0;
        if (a.dueAt === null) return 1;
        if (b.dueAt === null) return -1;
        return a.dueAt.getTime() - b.dueAt.getTime();
      });

      return { rows: rows.slice(0, input.limit), truncated: rows.length > input.limit };
    });

  return router({ counts, list });
}
