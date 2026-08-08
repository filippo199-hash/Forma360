/**
 * Risk Assessments router (FreeHS module B1).
 *
 * HSE five-step model: identify hazards → who might be harmed and how →
 * evaluate risks and controls → record findings → review. Design goals from
 * the practitioner spec, tightened by feedback round 2:
 *   - hierarchy of control is structural: every control carries a tier
 *     (eliminate → substitute → engineering → administrative → ppe) and a
 *     hazard whose controls are PPE-only cannot publish without a
 *     justification on at least one of those controls;
 *   - initial AND residual risk are scored (1–5 × 1–5) against per-row
 *     matrix thresholds (+ optional severity floors, P-4) so the effect of
 *     controls is visible;
 *   - residual risk is reconciled against the controls (P-1/P-2): residual
 *     can never exceed initial, needs at least one control to exist, and a
 *     high/critical residual needs a tolerability note or a planned control;
 *   - every `planned` control generates a CAPA action at publish time with
 *     an explicitly chosen assignee + due date (P-3) — never a silent
 *     "publisher / 7 days" default;
 *   - publish is a signed act (M-2): the caller must actively confirm the
 *     assessor statement, and each publish freezes an immutable version
 *     snapshot (A-1/M-3) that acknowledgements reference;
 *   - the review clock anchors to publish, not creation (M-1);
 *   - distribution + acknowledgement rows record who has read WHICH
 *     version; a republish re-opens everyone's acknowledgement (A-1) and
 *     the Heads Up share path records the same rows (A-2).
 *
 * Brand gating (ADR 0010): the module ships only where the brand catalogue
 * enables it. The router is built with `{ enabled }` wired from the active
 * brand; every procedure refuses when disabled so the API surface matches
 * the navigation.
 */
import {
  actions,
  AFFECTED_GROUP_PRESETS,
  CONTROL_STATUSES,
  CONTROL_TIERS,
  headsUpRecipients,
  PERSON_SPECIFIC_KINDS,
  REVIEW_OUTCOMES,
  REVIEW_TRIGGERS,
  RISK_ASSESSMENT_TYPES,
  type RaEventKind,
  type RaVersionContent,
  riskAssessmentAcknowledgements,
  riskAssessmentEvents,
  riskAssessmentControls,
  riskAssessmentHazards,
  riskAssessmentReviews,
  riskAssessments,
  riskAssessmentVersions,
  sites,
  tenantRiskMatrixSettings,
  user,
} from '@forma360/db/schema';
import type { Database } from '@forma360/db/client';
import { appLink } from '@forma360/shared/app-link';
import { newId } from '@forma360/shared/id';
import type { SendTemplatedEmail } from '@forma360/shared/email';
import {
  bandFor,
  bandRank,
  DEFAULT_RISK_MATRIX,
  isValidMatrixConfig,
  RISK_BAND_LEVELS,
  scoreFor,
  worstBand,
  type RiskMatrixConfig,
} from '@forma360/shared/risk-matrix';
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { nextReferenceValue } from '../reference-counter';
import { requirePermission, tenantProcedure } from '../procedures';
import { router } from '../trpc';

export interface RiskAssessmentsRouterDeps {
  /** Wired from the brand module catalogue (ADR 0010). */
  enabled: boolean;
  /**
   * Renders the assessment to a PDF in R2 and returns its object key —
   * wired to `@forma360/render`'s `renderRiskAssessmentPdf` in the web
   * app. Optional so tests and non-web callers can omit it; the
   * `renderPdf` / `prepareHeadsUpAttachment` procedures refuse when absent.
   */
  renderPdf?: (input: {
    tenantId: string;
    assessmentId: string;
  }) => Promise<{ key: string; bytes: number; stub: boolean }>;
  /**
   * Distribution notification emails (feedback A-3). Optional: absent in
   * non-web callers — distribution still records rows, it just cannot
   * notify.
   */
  sendEmail?: SendTemplatedEmail;
  /** Base URL for links inside notification emails. */
  appUrl?: string;
}

const score = z.number().int().min(1).max(5);

const createInput = z.object({
  title: z.string().min(1).max(200),
  activity: z.string().max(2000).default(''),
  type: z.enum(RISK_ASSESSMENT_TYPES).default('standing'),
  siteId: z.string().length(26).optional(),
  locationText: z.string().max(500).optional(),
});

const updateInput = z.object({
  assessmentId: z.string().length(26),
  title: z.string().min(1).max(200).optional(),
  activity: z.string().max(2000).optional(),
  siteId: z.string().length(26).nullable().optional(),
  locationText: z.string().max(500).nullable().optional(),
  assessorUserId: z.string().nullable().optional(),
  reviewFrequencyMonths: z.number().int().min(1).max(60).nullable().optional(),
  nextReviewAt: z.coerce.date().nullable().optional(),
});

const hazardInput = z.object({
  assessmentId: z.string().length(26),
  hazard: z.string().min(1).max(500),
  harmDescription: z.string().max(2000).default(''),
  affectedGroups: z.array(z.string().min(1).max(100)).max(20).default([]),
  initialLikelihood: score.nullable().optional(),
  initialSeverity: score.nullable().optional(),
  existingControls: z.string().max(4000).default(''),
  residualLikelihood: score.nullable().optional(),
  residualSeverity: score.nullable().optional(),
  residualJustification: z.string().max(2000).default(''),
});

const controlInput = z.object({
  hazardId: z.string().length(26),
  description: z.string().min(1).max(1000),
  tier: z.enum(CONTROL_TIERS),
  status: z.enum(CONTROL_STATUSES).default('in_place'),
  ppeJustification: z.string().max(1000).nullable().optional(),
});

/**
 * Publish is a signed act (M-2): `confirmSignOff` must be literally true,
 * and every planned control that will become an action needs an explicit
 * owner + due date (P-3).
 */
const publishInput = z.object({
  assessmentId: z.string().length(26),
  confirmSignOff: z.literal(true),
  actionAssignments: z
    .array(
      z.object({
        controlId: z.string().length(26),
        assigneeUserId: z.string().min(1).max(100),
        dueAt: z.coerce.date(),
      }),
    )
    .max(200)
    .default([]),
});

const matrixSettingsInput = z.object({
  lowMax: z.number().int().min(1).max(23),
  mediumMax: z.number().int().min(2).max(24),
  highMax: z.number().int().min(3).max(24),
  severityFloors: z
    .record(z.enum(['1', '2', '3', '4', '5']), z.enum(['medium', 'high', 'critical']))
    .default({}),
  /**
   * Also push the new matrix onto open drafts (published versions always
   * keep the snapshot they were signed against).
   */
  applyToDrafts: z.boolean().default(false),
});

/** Load an assessment row scoped to the tenant or throw NOT_FOUND. */
async function loadAssessment(db: Database, tenantId: string, assessmentId: string) {
  const rows = await db
    .select()
    .from(riskAssessments)
    .where(and(eq(riskAssessments.id, assessmentId), eq(riskAssessments.tenantId, tenantId)))
    .limit(1);
  const assessment = rows[0];
  if (assessment === undefined) {
    throw new TRPCError({ code: 'NOT_FOUND' });
  }
  return assessment;
}

/**
 * Load a site scoped to the tenant or throw. The FK alone only proves the
 * site exists — this is what stops a crafted request linking an assessment
 * to another tenant's site.
 */
async function loadSiteInTenant(db: Database, tenantId: string, siteId: string) {
  const rows = await db
    .select({ id: sites.id, name: sites.name })
    .from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.tenantId, tenantId)))
    .limit(1);
  const site = rows[0];
  if (site === undefined) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'unknown-site' });
  }
  return site;
}

/** Resolve site names for a set of assessment rows (list/get display). */
async function siteNamesById(
  db: Database,
  tenantId: string,
  siteIds: ReadonlyArray<string>,
): Promise<Map<string, string>> {
  if (siteIds.length === 0) return new Map();
  const rows = await db
    .select({ id: sites.id, name: sites.name })
    .from(sites)
    .where(and(eq(sites.tenantId, tenantId), inArray(sites.id, [...siteIds])));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Load a hazard scoped to the tenant or throw NOT_FOUND. */
async function loadHazard(db: Database, tenantId: string, hazardId: string) {
  const rows = await db
    .select()
    .from(riskAssessmentHazards)
    .where(
      and(eq(riskAssessmentHazards.id, hazardId), eq(riskAssessmentHazards.tenantId, tenantId)),
    )
    .limit(1);
  const hazard = rows[0];
  if (hazard === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
  return hazard;
}

/**
 * Bump the parent assessment's updatedAt + contentUpdatedAt. Every hazard
 * / control mutation goes through here — contentUpdatedAt newer than the
 * current version row is what flags "unpublished changes" (A-1/M-3).
 */
async function touch(db: Database, assessmentId: string): Promise<void> {
  const now = new Date();
  await db
    .update(riskAssessments)
    .set({ updatedAt: now, contentUpdatedAt: now })
    .where(eq(riskAssessments.id, assessmentId));
}

/** Append one immutable change-log row. Never updated or deleted. */
async function logEvent(
  db: Database,
  entry: {
    tenantId: string;
    assessmentId: string;
    actorUserId: string;
    kind: RaEventKind;
    detail?: string;
  },
): Promise<void> {
  await db.insert(riskAssessmentEvents).values({
    id: newId(),
    tenantId: entry.tenantId,
    assessmentId: entry.assessmentId,
    actorUserId: entry.actorUserId,
    kind: entry.kind,
    detail: entry.detail ?? '',
  });
}

/** The tenant's matrix settings, or the shipped default. */
async function loadTenantMatrix(db: Database, tenantId: string): Promise<RiskMatrixConfig> {
  const rows = await db
    .select()
    .from(tenantRiskMatrixSettings)
    .where(eq(tenantRiskMatrixSettings.tenantId, tenantId))
    .limit(1);
  const row = rows[0];
  if (row === undefined) return { ...DEFAULT_RISK_MATRIX };
  return {
    lowMax: row.lowMax,
    mediumMax: row.mediumMax,
    highMax: row.highMax,
    severityFloors: row.severityFloors,
  };
}

/** SQL fragment: this acknowledgement row is still pending. */
function ackPendingCondition() {
  return or(
    isNull(riskAssessmentAcknowledgements.acknowledgedAt),
    sql`coalesce(${riskAssessmentAcknowledgements.acknowledgedVersion}, 0) < ${riskAssessmentAcknowledgements.versionNumber}`,
  );
}

type HazardRow = typeof riskAssessmentHazards.$inferSelect;
type ControlRow = typeof riskAssessmentControls.$inferSelect;

/**
 * Publish-time validation of the scored record (P-1 / P-2 / the PPE
 * hierarchy rule). Throws PRECONDITION_FAILED with a stable message key
 * the UI maps to copy.
 */
function validateHazardsForPublish(
  hazards: ReadonlyArray<HazardRow>,
  controls: ReadonlyArray<ControlRow>,
  matrix: RiskMatrixConfig,
): void {
  const unscored = hazards.filter(
    (h) =>
      h.initialLikelihood === null ||
      h.initialSeverity === null ||
      h.residualLikelihood === null ||
      h.residualSeverity === null,
  );
  if (unscored.length > 0) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'unscored-hazards' });
  }

  for (const h of hazards) {
    const hazardControls = controls.filter((c) => c.hazardId === h.id);
    const initial = scoreFor(h.initialLikelihood, h.initialSeverity);
    const residual = scoreFor(h.residualLikelihood, h.residualSeverity);

    // P-1: controls cannot increase risk — a residual above initial is a
    // typo or a misunderstanding, never a valid record.
    if (initial !== null && residual !== null && residual > initial) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'residual-above-initial' });
    }

    // P-2: the residual is "risk WITH controls" — scoring it while listing
    // no controls at all (structured or free-text existing controls) makes
    // the number aspirational data entry.
    const hasAnyControl = hazardControls.length > 0 || h.existingControls.trim().length > 0;
    if (residual !== null && !hasAnyControl) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'residual-needs-controls' });
    }

    // P-2 (second half): a residual that STAYS high/critical needs either a
    // planned control (the further action) or an explicit tolerability note.
    const residualBand = bandFor(h.residualLikelihood, h.residualSeverity, matrix);
    const hasPlanned = hazardControls.some((c) => c.status === 'planned');
    if (
      bandRank(residualBand) >= bandRank('high') &&
      !hasPlanned &&
      h.residualJustification.trim().length === 0
    ) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'high-residual-needs-justification',
      });
    }

    // Hierarchy-of-control rule: PPE cannot be the whole answer without
    // justification. A hazard whose controls are exclusively PPE-tier
    // needs a ppeJustification on at least one of them.
    if (hazardControls.length === 0) continue;
    const allPpe = hazardControls.every((c) => c.tier === 'ppe');
    const hasJustification = hazardControls.some(
      (c) => c.ppeJustification !== null && c.ppeJustification.trim().length > 0,
    );
    if (allPpe && !hasJustification) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'ppe-only-needs-justification',
      });
    }
  }
}

/** Map the hazard's residual band to the generated action's priority. */
function priorityForBand(band: ReturnType<typeof bandFor>): 'medium' | 'high' | 'critical' {
  if (band === 'critical') return 'critical';
  if (band === 'high') return 'high';
  return 'medium';
}

export function createRiskAssessmentsRouter(deps: RiskAssessmentsRouterDeps) {
  function assertEnabled(): void {
    if (!deps.enabled) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'module-disabled' });
    }
  }

  return router({
    /** Preset "who might be harmed" groups the UI offers as chips. */
    presets: tenantProcedure.use(requirePermission('riskAssessments.view')).query(() => {
      assertEnabled();
      return { affectedGroups: AFFECTED_GROUP_PRESETS, reviewTriggers: REVIEW_TRIGGERS };
    }),

    list: tenantProcedure
      .use(requirePermission('riskAssessments.view'))
      .input(
        z
          .object({
            status: z.enum(['all', 'draft', 'active', 'archived']).default('all'),
            type: z.enum(['all', ...RISK_ASSESSMENT_TYPES]).default('all'),
          })
          .default({ status: 'all', type: 'all' }),
      )
      .query(async ({ ctx, input }) => {
        assertEnabled();
        const conditions = [eq(riskAssessments.tenantId, ctx.tenantId)];
        if (input.status === 'all') {
          conditions.push(isNull(riskAssessments.archivedAt));
        } else {
          conditions.push(eq(riskAssessments.status, input.status));
        }
        if (input.type !== 'all') {
          conditions.push(eq(riskAssessments.type, input.type));
        }
        const rows = await ctx.db
          .select()
          .from(riskAssessments)
          .where(and(...conditions))
          .orderBy(desc(riskAssessments.updatedAt));

        const ids = rows.map((r) => r.id);
        const hazardRows = ids.length
          ? await ctx.db
              .select({
                assessmentId: riskAssessmentHazards.assessmentId,
                residualLikelihood: riskAssessmentHazards.residualLikelihood,
                residualSeverity: riskAssessmentHazards.residualSeverity,
              })
              .from(riskAssessmentHazards)
              .where(inArray(riskAssessmentHazards.assessmentId, ids))
          : [];
        const ackRows = ids.length
          ? await ctx.db
              .select({
                assessmentId: riskAssessmentAcknowledgements.assessmentId,
                acknowledgedAt: riskAssessmentAcknowledgements.acknowledgedAt,
                acknowledgedVersion: riskAssessmentAcknowledgements.acknowledgedVersion,
                versionNumber: riskAssessmentAcknowledgements.versionNumber,
              })
              .from(riskAssessmentAcknowledgements)
              /**
               * RA-D05: a leaver was counted as outstanding forever.
               *
               * The reminder worker filters `isNull(user.deactivatedAt)`,
               * so a deactivated user is never chased — while this count
               * included them. The assessment read "1 of 2 acknowledged"
               * permanently: nobody nudged, the number unable to reach
               * 100%, and a compliance figure wrong in the direction that
               * makes a manager look bad for something they cannot fix.
               *
               * Neither half was wrong alone; together they produced a
               * state nobody chose. Training already made this call —
               * leavers drop out of the matrix without taking the evidence
               * with them. The acknowledgement ROWS are untouched, so the
               * record of who was asked and who confirmed survives; they
               * simply stop counting toward a total nobody can move.
               */
              .innerJoin(user, eq(user.id, riskAssessmentAcknowledgements.userId))
              .where(
                and(
                  inArray(riskAssessmentAcknowledgements.assessmentId, ids),
                  isNull(user.deactivatedAt),
                ),
              )
          : [];

        const siteNames = await siteNamesById(
          ctx.db,
          ctx.tenantId,
          rows.map((r) => r.siteId).filter((v): v is string => v !== null),
        );

        const now = new Date();
        return rows.map((r) => {
          const hazards = hazardRows.filter((h) => h.assessmentId === r.id);
          const maxResidual = hazards.reduce((max, h) => {
            const s = scoreFor(h.residualLikelihood, h.residualSeverity) ?? 0;
            return Math.max(max, s);
          }, 0);
          const residualBand = worstBand(
            hazards.map((h) => ({
              likelihood: h.residualLikelihood,
              severity: h.residualSeverity,
            })),
            r.matrix,
          );
          const acks = ackRows.filter((a) => a.assessmentId === r.id);
          return {
            ...r,
            siteName: r.siteId !== null ? (siteNames.get(r.siteId) ?? null) : null,
            hazardCount: hazards.length,
            maxResidualScore: maxResidual,
            maxResidualBand: residualBand,
            ackTotal: acks.length,
            ackDone: acks.filter(
              (a) => a.acknowledgedAt !== null && (a.acknowledgedVersion ?? 0) >= a.versionNumber,
            ).length,
            // M-1: the review clock only means something once the
            // assessment has been live — drafts never show "review due".
            reviewDue: r.status === 'active' && r.nextReviewAt !== null && r.nextReviewAt <= now,
          };
        });
      }),

    /** Active assessments the current user has been asked to acknowledge. */
    listMyPending: tenantProcedure
      .use(requirePermission('riskAssessments.view'))
      .query(async ({ ctx }) => {
        assertEnabled();
        const rows = await ctx.db
          .select({
            assessmentId: riskAssessmentAcknowledgements.assessmentId,
            distributedAt: riskAssessmentAcknowledgements.distributedAt,
            dueAt: riskAssessmentAcknowledgements.dueAt,
            versionNumber: riskAssessmentAcknowledgements.versionNumber,
            title: riskAssessments.title,
            referenceNumber: riskAssessments.referenceNumber,
          })
          .from(riskAssessmentAcknowledgements)
          .innerJoin(
            riskAssessments,
            eq(riskAssessments.id, riskAssessmentAcknowledgements.assessmentId),
          )
          .where(
            and(
              eq(riskAssessmentAcknowledgements.tenantId, ctx.tenantId),
              eq(riskAssessmentAcknowledgements.userId, ctx.auth.userId),
              ackPendingCondition(),
              eq(riskAssessments.status, 'active'),
            ),
          );
        return rows;
      }),

    get: tenantProcedure
      .use(requirePermission('riskAssessments.view'))
      .input(z.object({ assessmentId: z.string().length(26) }))
      .query(async ({ ctx, input }) => {
        assertEnabled();
        const assessment = await loadAssessment(ctx.db, ctx.tenantId, input.assessmentId);
        const hazards = await ctx.db
          .select()
          .from(riskAssessmentHazards)
          .where(eq(riskAssessmentHazards.assessmentId, assessment.id))
          .orderBy(asc(riskAssessmentHazards.sortOrder), asc(riskAssessmentHazards.createdAt));
        const controls = await ctx.db
          .select()
          .from(riskAssessmentControls)
          .where(eq(riskAssessmentControls.assessmentId, assessment.id))
          .orderBy(asc(riskAssessmentControls.createdAt));
        const reviews = await ctx.db
          .select()
          .from(riskAssessmentReviews)
          .where(eq(riskAssessmentReviews.assessmentId, assessment.id))
          .orderBy(desc(riskAssessmentReviews.reviewedAt));
        const acks = await ctx.db
          .select({
            userId: riskAssessmentAcknowledgements.userId,
            distributedAt: riskAssessmentAcknowledgements.distributedAt,
            acknowledgedAt: riskAssessmentAcknowledgements.acknowledgedAt,
            acknowledgedVersion: riskAssessmentAcknowledgements.acknowledgedVersion,
            versionNumber: riskAssessmentAcknowledgements.versionNumber,
            dueAt: riskAssessmentAcknowledgements.dueAt,
            userName: user.name,
            userEmail: user.email,
            /**
             * RA-D05, the other half. The roll-call KEEPS the leaver —
             * hiding the row would erase the evidence that they were
             * distributed to, which is the thing the record exists for —
             * but flags them, so a reader can see why that line will never
             * turn green. The `list` count excludes them; this does not.
             */
            userDeactivatedAt: user.deactivatedAt,
          })
          .from(riskAssessmentAcknowledgements)
          .leftJoin(user, eq(user.id, riskAssessmentAcknowledgements.userId))
          .where(eq(riskAssessmentAcknowledgements.assessmentId, assessment.id));
        const creatorRows = await ctx.db
          .select({ name: user.name })
          .from(user)
          .where(eq(user.id, assessment.createdBy))
          .limit(1);
        const linkedActions = await ctx.db
          .select({
            id: actions.id,
            referenceNumber: actions.referenceNumber,
            title: actions.title,
            status: actions.status,
            dueAt: actions.dueAt,
          })
          .from(actions)
          .where(
            and(
              eq(actions.tenantId, ctx.tenantId),
              eq(actions.sourceType, 'risk_assessment'),
              eq(actions.sourceId, assessment.id),
            ),
          );
        const linkedVariantRows = await ctx.db
          .select({
            id: riskAssessments.id,
            title: riskAssessments.title,
            personSpecificFor: riskAssessments.personSpecificFor,
            status: riskAssessments.status,
            forkedFromParentAt: riskAssessments.forkedFromParentAt,
          })
          .from(riskAssessments)
          .where(
            and(
              eq(riskAssessments.tenantId, ctx.tenantId),
              eq(riskAssessments.parentAssessmentId, assessment.id),
            ),
          );
        // A-4: a variant "drifts" once the parent's content changes after
        // the fork (and vice versa — the parent page flags its variants).
        const linkedVariants = linkedVariantRows.map((v) => ({
          ...v,
          driftsFromParent:
            v.forkedFromParentAt !== null && assessment.contentUpdatedAt > v.forkedFromParentAt,
        }));
        let parentInfo: {
          id: string;
          title: string;
          referenceNumber: string | null;
          status: string;
          changedSinceFork: boolean;
        } | null = null;
        if (assessment.parentAssessmentId !== null) {
          const parentRows = await ctx.db
            .select({
              id: riskAssessments.id,
              title: riskAssessments.title,
              referenceNumber: riskAssessments.referenceNumber,
              status: riskAssessments.status,
              contentUpdatedAt: riskAssessments.contentUpdatedAt,
            })
            .from(riskAssessments)
            .where(
              and(
                eq(riskAssessments.id, assessment.parentAssessmentId),
                eq(riskAssessments.tenantId, ctx.tenantId),
              ),
            )
            .limit(1);
          const parent = parentRows[0];
          if (parent !== undefined) {
            parentInfo = {
              id: parent.id,
              title: parent.title,
              referenceNumber: parent.referenceNumber,
              status: parent.status,
              changedSinceFork:
                assessment.forkedFromParentAt !== null &&
                parent.contentUpdatedAt > assessment.forkedFromParentAt,
            };
          }
        }
        const events = await ctx.db
          .select({
            id: riskAssessmentEvents.id,
            kind: riskAssessmentEvents.kind,
            detail: riskAssessmentEvents.detail,
            createdAt: riskAssessmentEvents.createdAt,
            actorName: user.name,
          })
          .from(riskAssessmentEvents)
          .leftJoin(user, eq(user.id, riskAssessmentEvents.actorUserId))
          .where(eq(riskAssessmentEvents.assessmentId, assessment.id))
          .orderBy(desc(riskAssessmentEvents.createdAt))
          .limit(100);
        const versions = await ctx.db
          .select({
            id: riskAssessmentVersions.id,
            versionNumber: riskAssessmentVersions.versionNumber,
            signedOffBy: riskAssessmentVersions.signedOffBy,
            signedOffByName: riskAssessmentVersions.signedOffByName,
            signedOffAt: riskAssessmentVersions.signedOffAt,
            actionsCreated: riskAssessmentVersions.actionsCreated,
            createdAt: riskAssessmentVersions.createdAt,
          })
          .from(riskAssessmentVersions)
          .where(eq(riskAssessmentVersions.assessmentId, assessment.id))
          .orderBy(desc(riskAssessmentVersions.versionNumber));
        const currentVersionRow = versions.find(
          (v) => v.versionNumber === assessment.currentVersion,
        );
        const siteNames = await siteNamesById(
          ctx.db,
          ctx.tenantId,
          assessment.siteId !== null ? [assessment.siteId] : [],
        );
        // Variant drift (C-16 → A-4): superseded by `parentInfo.
        // changedSinceFork` above — fork-anchored via forkedFromParentAt,
        // so touching the CHILD never masks a parent change the way a
        // plain updatedAt comparison would.
        return {
          assessment,
          siteName: assessment.siteId !== null ? (siteNames.get(assessment.siteId) ?? null) : null,
          events,
          createdByName: creatorRows[0]?.name ?? null,
          hazards: hazards.map((h) => ({
            ...h,
            controls: controls.filter((c) => c.hazardId === h.id),
          })),
          reviews,
          acknowledgements: acks,
          versions,
          // A-1: content edited after the current version was signed —
          // readers are still acknowledging the published version.
          hasUnpublishedChanges:
            assessment.status === 'active' &&
            currentVersionRow !== undefined &&
            assessment.contentUpdatedAt > currentVersionRow.createdAt,
          linkedVariants,
          parentInfo,
          linkedActions,
          myAcknowledgement: acks.find((a) => a.userId === ctx.auth.userId) ?? null,
        };
      }),

    /** One frozen version — "the assessment as in force on {date}" (M-3). */
    getVersion: tenantProcedure
      .use(requirePermission('riskAssessments.view'))
      .input(
        z.object({ assessmentId: z.string().length(26), versionNumber: z.number().int().min(1) }),
      )
      .query(async ({ ctx, input }) => {
        assertEnabled();
        const assessment = await loadAssessment(ctx.db, ctx.tenantId, input.assessmentId);
        const rows = await ctx.db
          .select()
          .from(riskAssessmentVersions)
          .where(
            and(
              eq(riskAssessmentVersions.assessmentId, assessment.id),
              eq(riskAssessmentVersions.versionNumber, input.versionNumber),
            ),
          )
          .limit(1);
        const version = rows[0];
        if (version === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
        return { version };
      }),

    create: tenantProcedure
      .use(requirePermission('riskAssessments.create'))
      .input(createInput)
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        if (input.siteId !== undefined) {
          await loadSiteInTenant(ctx.db, ctx.tenantId, input.siteId);
        }
        const id = newId();
        const n = await nextReferenceValue(ctx.db, ctx.tenantId, 'riskAssessment');
        const referenceNumber = `RA-${String(n).padStart(4, '0')}`;
        // P-4: snapshot the tenant's matrix so this row keeps stable bands
        // even if the tenant edits their matrix later.
        const matrix = await loadTenantMatrix(ctx.db, ctx.tenantId);
        // M-1: no next-review date yet — the review clock starts at
        // publish. The 12-month default frequency is kept so publish can
        // compute the first due date.
        await ctx.db.insert(riskAssessments).values({
          id,
          tenantId: ctx.tenantId,
          referenceNumber,
          title: input.title,
          activity: input.activity,
          type: input.type,
          ...(input.siteId !== undefined ? { siteId: input.siteId } : {}),
          ...(input.locationText !== undefined ? { locationText: input.locationText } : {}),
          assessorUserId: ctx.auth.userId,
          matrix,
          reviewFrequencyMonths: 12,
          createdBy: ctx.auth.userId,
        });
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          assessmentId: id,
          actorUserId: ctx.auth.userId,
          kind: 'created',
          detail: input.title,
        });
        ctx.logger.info({ assessmentId: id }, '[riskAssessments] created');
        return { assessmentId: id, referenceNumber };
      }),

    update: tenantProcedure
      .use(requirePermission('riskAssessments.manage'))
      .input(updateInput)
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const assessment = await loadAssessment(ctx.db, ctx.tenantId, input.assessmentId);
        if (assessment.archivedAt !== null) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'archived' });
        }
        const { assessmentId: _id, ...patch } = input;
        // Resolve (and tenant-check) the target site up front so the event
        // detail can carry the human-readable name.
        const nextSite =
          patch.siteId !== undefined && patch.siteId !== null
            ? await loadSiteInTenant(ctx.db, ctx.tenantId, patch.siteId)
            : null;
        // Header text + site are CONTENT (they appear on the signed
        // record); review scheduling + assessor are metadata.
        const contentChanged =
          (patch.title !== undefined && patch.title !== assessment.title) ||
          (patch.activity !== undefined && patch.activity !== assessment.activity) ||
          (patch.siteId !== undefined && patch.siteId !== assessment.siteId) ||
          (patch.locationText !== undefined && patch.locationText !== assessment.locationText);
        const now = new Date();
        await ctx.db
          .update(riskAssessments)
          .set({
            ...(patch.title !== undefined ? { title: patch.title } : {}),
            ...(patch.activity !== undefined ? { activity: patch.activity } : {}),
            ...(patch.siteId !== undefined ? { siteId: patch.siteId } : {}),
            ...(patch.locationText !== undefined ? { locationText: patch.locationText } : {}),
            ...(patch.assessorUserId !== undefined ? { assessorUserId: patch.assessorUserId } : {}),
            ...(patch.reviewFrequencyMonths !== undefined
              ? { reviewFrequencyMonths: patch.reviewFrequencyMonths }
              : {}),
            ...(patch.nextReviewAt !== undefined ? { nextReviewAt: patch.nextReviewAt } : {}),
            ...(contentChanged ? { contentUpdatedAt: now } : {}),
            updatedAt: now,
          })
          .where(eq(riskAssessments.id, assessment.id));
        if (patch.title !== undefined && patch.title !== assessment.title) {
          await logEvent(ctx.db, {
            tenantId: ctx.tenantId,
            assessmentId: assessment.id,
            actorUserId: ctx.auth.userId,
            kind: 'title_changed',
            detail: patch.title,
          });
        }
        if (patch.siteId !== undefined && patch.siteId !== assessment.siteId) {
          await logEvent(ctx.db, {
            tenantId: ctx.tenantId,
            assessmentId: assessment.id,
            actorUserId: ctx.auth.userId,
            kind: 'site_changed',
            detail: nextSite?.name ?? '',
          });
        }
        return { ok: true };
      }),

    /**
     * Move an active (or archived) assessment back to draft — the status
     * lever the practitioner asked for. Activation stays exclusive to
     * `publish` so its validations can never be bypassed.
     */
    moveToDraft: tenantProcedure
      .use(requirePermission('riskAssessments.manage'))
      .input(z.object({ assessmentId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const assessment = await loadAssessment(ctx.db, ctx.tenantId, input.assessmentId);
        if (assessment.status === 'draft' && assessment.archivedAt === null) {
          return { ok: true };
        }
        await ctx.db
          .update(riskAssessments)
          .set({ status: 'draft', archivedAt: null, updatedAt: new Date() })
          .where(eq(riskAssessments.id, assessment.id));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          assessmentId: assessment.id,
          actorUserId: ctx.auth.userId,
          kind: 'moved_to_draft',
        });
        return { ok: true };
      }),

    /**
     * Render the assessment to a PDF in R2 (viewer-accessible — this
     * backs the "Download PDF" button, M-4). Returns the object key; the
     * download route exchanges it for a signed URL.
     */
    renderPdf: tenantProcedure
      .use(requirePermission('riskAssessments.view'))
      .input(z.object({ assessmentId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        if (deps.renderPdf === undefined) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'render-unavailable' });
        }
        const assessment = await loadAssessment(ctx.db, ctx.tenantId, input.assessmentId);
        const rendered = await deps.renderPdf({
          tenantId: ctx.tenantId,
          assessmentId: assessment.id,
        });
        const stem = assessment.referenceNumber ?? 'risk-assessment';
        return {
          storageKey: rendered.key,
          filename: `${stem}.pdf`,
          sizeBytes: rendered.bytes,
          stub: rendered.stub,
        };
      }),

    /**
     * Render the assessment to a PDF in R2 so "Share via Heads Up" can
     * attach it. Only for ACTIVE assessments (T-4: sharing never
     * publishes a draft as a side effect — publish is its own signed act).
     */
    prepareHeadsUpAttachment: tenantProcedure
      .use(requirePermission('riskAssessments.manage'))
      .input(z.object({ assessmentId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        if (deps.renderPdf === undefined) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'render-unavailable' });
        }
        const assessment = await loadAssessment(ctx.db, ctx.tenantId, input.assessmentId);
        if (assessment.status !== 'active') {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'not-active' });
        }
        const rendered = await deps.renderPdf({
          tenantId: ctx.tenantId,
          assessmentId: assessment.id,
        });
        const stem = assessment.referenceNumber ?? 'risk-assessment';
        return {
          storageKey: rendered.key,
          filename: `${stem}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: rendered.bytes,
          stub: rendered.stub,
        };
      }),

    addHazard: tenantProcedure
      .use(requirePermission('riskAssessments.manage'))
      .input(hazardInput)
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const assessment = await loadAssessment(ctx.db, ctx.tenantId, input.assessmentId);
        if (assessment.archivedAt !== null) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'archived' });
        }
        const id = newId();
        const sortRows = await ctx.db
          .select({ maxSort: sql<number>`coalesce(max(${riskAssessmentHazards.sortOrder}), -1)` })
          .from(riskAssessmentHazards)
          .where(eq(riskAssessmentHazards.assessmentId, assessment.id));
        const maxSort = Number(sortRows[0]?.maxSort ?? -1);
        await ctx.db.insert(riskAssessmentHazards).values({
          id,
          tenantId: ctx.tenantId,
          assessmentId: assessment.id,
          sortOrder: maxSort + 1,
          hazard: input.hazard,
          harmDescription: input.harmDescription,
          affectedGroups: input.affectedGroups,
          initialLikelihood: input.initialLikelihood ?? null,
          initialSeverity: input.initialSeverity ?? null,
          existingControls: input.existingControls,
          residualLikelihood: input.residualLikelihood ?? null,
          residualSeverity: input.residualSeverity ?? null,
          residualJustification: input.residualJustification,
        });
        await touch(ctx.db, assessment.id);
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          assessmentId: assessment.id,
          actorUserId: ctx.auth.userId,
          kind: 'hazard_added',
          detail: input.hazard,
        });
        return { hazardId: id };
      }),

    updateHazard: tenantProcedure
      .use(requirePermission('riskAssessments.manage'))
      .input(hazardInput.partial().extend({ hazardId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const hazard = await loadHazard(ctx.db, ctx.tenantId, input.hazardId);
        await ctx.db
          .update(riskAssessmentHazards)
          .set({
            ...(input.hazard !== undefined ? { hazard: input.hazard } : {}),
            ...(input.harmDescription !== undefined
              ? { harmDescription: input.harmDescription }
              : {}),
            ...(input.affectedGroups !== undefined ? { affectedGroups: input.affectedGroups } : {}),
            ...(input.initialLikelihood !== undefined
              ? { initialLikelihood: input.initialLikelihood }
              : {}),
            ...(input.initialSeverity !== undefined
              ? { initialSeverity: input.initialSeverity }
              : {}),
            ...(input.existingControls !== undefined
              ? { existingControls: input.existingControls }
              : {}),
            ...(input.residualLikelihood !== undefined
              ? { residualLikelihood: input.residualLikelihood }
              : {}),
            ...(input.residualSeverity !== undefined
              ? { residualSeverity: input.residualSeverity }
              : {}),
            ...(input.residualJustification !== undefined
              ? { residualJustification: input.residualJustification }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(riskAssessmentHazards.id, hazard.id));
        await touch(ctx.db, hazard.assessmentId);
        return { ok: true };
      }),

    removeHazard: tenantProcedure
      .use(requirePermission('riskAssessments.manage'))
      .input(z.object({ hazardId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const hazard = await loadHazard(ctx.db, ctx.tenantId, input.hazardId);
        // An assessment must always keep at least one hazard.
        const countRows = await ctx.db
          .select({ n: sql<number>`count(*)` })
          .from(riskAssessmentHazards)
          .where(eq(riskAssessmentHazards.assessmentId, hazard.assessmentId));
        if (Number(countRows[0]?.n ?? 0) <= 1) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'last-hazard' });
        }
        await ctx.db.delete(riskAssessmentHazards).where(eq(riskAssessmentHazards.id, hazard.id));
        await touch(ctx.db, hazard.assessmentId);
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          assessmentId: hazard.assessmentId,
          actorUserId: ctx.auth.userId,
          kind: 'hazard_removed',
          detail: hazard.hazard,
        });
        return { ok: true };
      }),

    addControl: tenantProcedure
      .use(requirePermission('riskAssessments.manage'))
      .input(controlInput)
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const hazard = await loadHazard(ctx.db, ctx.tenantId, input.hazardId);
        const id = newId();
        await ctx.db.insert(riskAssessmentControls).values({
          id,
          tenantId: ctx.tenantId,
          assessmentId: hazard.assessmentId,
          hazardId: hazard.id,
          description: input.description,
          tier: input.tier,
          status: input.status,
          ppeJustification: input.ppeJustification ?? null,
        });
        await touch(ctx.db, hazard.assessmentId);
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          assessmentId: hazard.assessmentId,
          actorUserId: ctx.auth.userId,
          kind: 'control_added',
          detail: input.description,
        });
        return { controlId: id };
      }),

    updateControl: tenantProcedure
      .use(requirePermission('riskAssessments.manage'))
      .input(controlInput.partial().extend({ controlId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const rows = await ctx.db
          .select()
          .from(riskAssessmentControls)
          .where(
            and(
              eq(riskAssessmentControls.id, input.controlId),
              eq(riskAssessmentControls.tenantId, ctx.tenantId),
            ),
          )
          .limit(1);
        const control = rows[0];
        if (control === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
        await ctx.db
          .update(riskAssessmentControls)
          .set({
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.tier !== undefined ? { tier: input.tier } : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
            ...(input.ppeJustification !== undefined
              ? { ppeJustification: input.ppeJustification }
              : {}),
          })
          .where(eq(riskAssessmentControls.id, control.id));
        await touch(ctx.db, control.assessmentId);
        return { ok: true };
      }),

    removeControl: tenantProcedure
      .use(requirePermission('riskAssessments.manage'))
      .input(z.object({ controlId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const rows = await ctx.db
          .select()
          .from(riskAssessmentControls)
          .where(
            and(
              eq(riskAssessmentControls.id, input.controlId),
              eq(riskAssessmentControls.tenantId, ctx.tenantId),
            ),
          )
          .limit(1);
        const control = rows[0];
        if (control === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
        await ctx.db
          .delete(riskAssessmentControls)
          .where(eq(riskAssessmentControls.id, control.id));
        await touch(ctx.db, control.assessmentId);
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          assessmentId: control.assessmentId,
          actorUserId: ctx.auth.userId,
          kind: 'control_removed',
          detail: control.description,
        });
        return { ok: true };
      }),

    /**
     * Publish: validates the five-step record is complete and coherent
     * (P-1/P-2 + the PPE rule), requires the assessor's active sign-off
     * (M-2) and an owner + due date for every action that will be created
     * (P-3), freezes an immutable version snapshot (A-1/M-3), anchors the
     * review clock (M-1), then activates the assessment and generates the
     * CAPA actions (idempotent). A republish with content changes re-opens
     * every acknowledgement against the new version.
     */
    publish: tenantProcedure
      .use(requirePermission('riskAssessments.manage'))
      .input(publishInput)
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const assessment = await loadAssessment(ctx.db, ctx.tenantId, input.assessmentId);
        if (assessment.archivedAt !== null) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'archived' });
        }
        const hazards = await ctx.db
          .select()
          .from(riskAssessmentHazards)
          .where(eq(riskAssessmentHazards.assessmentId, assessment.id))
          .orderBy(asc(riskAssessmentHazards.sortOrder), asc(riskAssessmentHazards.createdAt));
        if (hazards.length === 0) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'no-hazards' });
        }
        const controls = await ctx.db
          .select()
          .from(riskAssessmentControls)
          .where(eq(riskAssessmentControls.assessmentId, assessment.id))
          .orderBy(asc(riskAssessmentControls.createdAt));

        validateHazardsForPublish(hazards, controls, assessment.matrix);

        // P-3: every planned control that will become an action needs an
        // explicit, valid owner and a due date.
        const pendingControls = controls.filter(
          (c) => c.status === 'planned' && c.actionId === null,
        );
        const assignmentByControl = new Map(
          input.actionAssignments.map((a) => [a.controlId, a] as const),
        );
        const missing = pendingControls.filter((c) => !assignmentByControl.has(c.id));
        if (missing.length > 0) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'actions-need-assignees' });
        }
        if (pendingControls.length > 0) {
          const assigneeIds = [
            ...new Set(
              pendingControls.map((c) => assignmentByControl.get(c.id)?.assigneeUserId ?? ''),
            ),
          ].filter((v) => v.length > 0);
          const validAssignees = await ctx.db
            .select({ id: user.id })
            .from(user)
            .where(
              and(
                eq(user.tenantId, ctx.tenantId),
                inArray(user.id, assigneeIds),
                isNull(user.deactivatedAt),
              ),
            );
          if (validAssignees.length !== assigneeIds.length) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'invalid-assignee' });
          }
          const dayMs = 24 * 60 * 60 * 1000;
          const tooEarly = pendingControls.some((c) => {
            const a = assignmentByControl.get(c.id);
            return a !== undefined && a.dueAt.getTime() < Date.now() - dayMs;
          });
          if (tooEarly) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'invalid-due-date' });
          }
        }

        // Versioning (A-1/M-3): a new immutable snapshot is only cut when
        // the content actually changed since the current version —
        // re-activating an unchanged assessment (draft → active round
        // trip) must not reopen anyone's acknowledgement.
        const latestVersionRows =
          assessment.currentVersion > 0
            ? await ctx.db
                .select({ createdAt: riskAssessmentVersions.createdAt })
                .from(riskAssessmentVersions)
                .where(
                  and(
                    eq(riskAssessmentVersions.assessmentId, assessment.id),
                    eq(riskAssessmentVersions.versionNumber, assessment.currentVersion),
                  ),
                )
                .limit(1)
            : [];
        const latestVersionAt = latestVersionRows[0]?.createdAt;
        const contentChanged =
          assessment.currentVersion === 0 ||
          latestVersionAt === undefined ||
          assessment.contentUpdatedAt > latestVersionAt;

        // Claim action reference numbers before the tx — the counter helper
        // takes the pool-backed Database. A rolled-back publish wastes a few
        // numbers, which is fine (references are labels, not invariants).
        const actionRefs = new Map<string, string>();
        for (const control of pendingControls) {
          const n = await nextReferenceValue(ctx.db, ctx.tenantId, 'action');
          actionRefs.set(control.id, `AC-${String(n).padStart(6, '0')}`);
        }

        const signerRows = await ctx.db
          .select({ name: user.name })
          .from(user)
          .where(eq(user.id, ctx.auth.userId))
          .limit(1);
        const signerName = signerRows[0]?.name ?? null;

        const siteName =
          assessment.siteId !== null
            ? ((await siteNamesById(ctx.db, ctx.tenantId, [assessment.siteId])).get(
                assessment.siteId,
              ) ?? null)
            : null;

        const now = new Date();
        const newVersionNumber = contentChanged
          ? assessment.currentVersion + 1
          : assessment.currentVersion;

        const createdActionIds: string[] = [];
        await ctx.db.transaction(async (tx) => {
          for (const control of pendingControls) {
            const actionId = newId();
            const hazard = hazards.find((h) => h.id === control.hazardId);
            const assignment = assignmentByControl.get(control.id);
            if (assignment === undefined) continue; // validated above
            const residualBand =
              hazard !== undefined
                ? bandFor(hazard.residualLikelihood, hazard.residualSeverity, assessment.matrix)
                : 'medium';
            await tx.insert(actions).values({
              id: actionId,
              tenantId: ctx.tenantId,
              sourceType: 'risk_assessment',
              sourceId: assessment.id,
              sourceItemId: control.id,
              referenceNumber: actionRefs.get(control.id) ?? null,
              title: `Implement control: ${control.description}`,
              description: `Raised by risk assessment ${assessment.referenceNumber ?? assessment.id} (${assessment.title})${hazard !== undefined ? ` — hazard: ${hazard.hazard}` : ''}.`,
              status: 'open',
              // P-3: owner + due date come from the publish dialog;
              // priority follows the hazard's residual band.
              assigneeUserId: assignment.assigneeUserId,
              priority: priorityForBand(residualBand),
              dueAt: assignment.dueAt,
              createdBy: ctx.auth.userId,
            });
            await tx
              .update(riskAssessmentControls)
              .set({ actionId })
              .where(eq(riskAssessmentControls.id, control.id));
            createdActionIds.push(actionId);
          }

          if (contentChanged) {
            // Freeze the exact content being signed (M-2/M-3).
            const content: RaVersionContent = {
              title: assessment.title,
              activity: assessment.activity,
              type: assessment.type,
              siteId: assessment.siteId,
              siteName,
              locationText: assessment.locationText,
              matrix: assessment.matrix,
              hazards: hazards.map((h) => ({
                hazard: h.hazard,
                harmDescription: h.harmDescription,
                affectedGroups: h.affectedGroups,
                initialLikelihood: h.initialLikelihood,
                initialSeverity: h.initialSeverity,
                existingControls: h.existingControls,
                residualLikelihood: h.residualLikelihood,
                residualSeverity: h.residualSeverity,
                residualJustification: h.residualJustification,
                controls: controls
                  .filter((c) => c.hazardId === h.id)
                  .map((c) => ({
                    description: c.description,
                    tier: c.tier,
                    status: c.status,
                    ppeJustification: c.ppeJustification,
                  })),
              })),
            };
            await tx.insert(riskAssessmentVersions).values({
              id: newId(),
              tenantId: ctx.tenantId,
              assessmentId: assessment.id,
              versionNumber: newVersionNumber,
              content,
              signedOffBy: ctx.auth.userId,
              signedOffByName: signerName,
              signedOffAt: now,
              actionsCreated: createdActionIds.length,
              createdAt: now,
            });

            // A-1: everyone previously asked to acknowledge is now being
            // asked to acknowledge the NEW version — their earlier
            // acknowledgement stays on record against the old version.
            if (newVersionNumber > 1) {
              await tx
                .update(riskAssessmentAcknowledgements)
                .set({ versionNumber: newVersionNumber, redistributed: true })
                .where(eq(riskAssessmentAcknowledgements.assessmentId, assessment.id));
            }

            // M-1: the "suitable and sufficient" clock starts (or
            // restarts) at go-live of this content.
            let nextReviewAt = assessment.nextReviewAt;
            if (assessment.reviewFrequencyMonths !== null) {
              nextReviewAt = new Date(now);
              nextReviewAt.setMonth(nextReviewAt.getMonth() + assessment.reviewFrequencyMonths);
            }
            await tx
              .update(riskAssessments)
              .set({
                status: 'active',
                publishedAt: now,
                currentVersion: newVersionNumber,
                nextReviewAt,
                updatedAt: now,
              })
              .where(eq(riskAssessments.id, assessment.id));
          } else {
            // Unchanged content returning to force — same version, same
            // acknowledgements, same review clock.
            await tx
              .update(riskAssessments)
              .set({ status: 'active', updatedAt: now })
              .where(eq(riskAssessments.id, assessment.id));
          }
        });
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          assessmentId: assessment.id,
          actorUserId: ctx.auth.userId,
          kind: 'published',
          detail: `v${newVersionNumber}${contentChanged ? '' : ' (unchanged)'} · ${createdActionIds.length} action(s)`,
        });
        ctx.logger.info(
          {
            assessmentId: assessment.id,
            version: newVersionNumber,
            actionsCreated: createdActionIds.length,
          },
          '[riskAssessments] published',
        );
        return {
          ok: true,
          actionsCreated: createdActionIds.length,
          version: newVersionNumber,
          reacknowledgementRequested: contentChanged && newVersionNumber > 1,
        };
      }),

    archive: tenantProcedure
      .use(requirePermission('riskAssessments.manage'))
      .input(z.object({ assessmentId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const assessment = await loadAssessment(ctx.db, ctx.tenantId, input.assessmentId);
        await ctx.db
          .update(riskAssessments)
          .set({ status: 'archived', archivedAt: new Date(), updatedAt: new Date() })
          .where(eq(riskAssessments.id, assessment.id));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          assessmentId: assessment.id,
          actorUserId: ctx.auth.userId,
          kind: 'archived',
        });
        return { ok: true };
      }),

    recordReview: tenantProcedure
      .use(requirePermission('riskAssessments.manage'))
      .input(
        z.object({
          assessmentId: z.string().length(26),
          trigger: z.enum(REVIEW_TRIGGERS),
          outcome: z.enum(REVIEW_OUTCOMES),
          note: z.string().max(2000).default(''),
          nextReviewAt: z.coerce.date().nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const assessment = await loadAssessment(ctx.db, ctx.tenantId, input.assessmentId);
        if (assessment.archivedAt !== null) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'archived' });
        }
        const now = new Date();
        let nextReviewAt = input.nextReviewAt ?? null;
        if (nextReviewAt === null && assessment.reviewFrequencyMonths !== null) {
          nextReviewAt = new Date(now);
          nextReviewAt.setMonth(nextReviewAt.getMonth() + assessment.reviewFrequencyMonths);
        }
        await ctx.db.transaction(async (tx) => {
          await tx.insert(riskAssessmentReviews).values({
            id: newId(),
            tenantId: ctx.tenantId,
            assessmentId: assessment.id,
            trigger: input.trigger,
            outcome: input.outcome,
            note: input.note,
            reviewedBy: ctx.auth.userId,
            reviewedAt: now,
          });
          await tx
            .update(riskAssessments)
            .set({
              lastReviewedAt: now,
              lastReviewedBy: ctx.auth.userId,
              nextReviewAt,
              updatedAt: now,
            })
            .where(eq(riskAssessments.id, assessment.id));
        });
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          assessmentId: assessment.id,
          actorUserId: ctx.auth.userId,
          kind: 'review_recorded',
          detail: input.trigger,
        });
        return { ok: true, nextReviewAt };
      }),

    /**
     * Distribute to users; re-distribution resets their acknowledgement.
     * Sends a notification email per recipient (A-3) and records the
     * acknowledgement deadline when one is given.
     */
    distribute: tenantProcedure
      .use(requirePermission('riskAssessments.manage'))
      .input(
        z.object({
          assessmentId: z.string().length(26),
          userIds: z.array(z.string().min(1)).min(1).max(500),
          dueAt: z.coerce.date().nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const assessment = await loadAssessment(ctx.db, ctx.tenantId, input.assessmentId);
        if (assessment.status !== 'active') {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'not-active' });
        }
        const tenantUsers = await ctx.db
          // DOC-A01: locale, so the link follows the reader.
          .select({ id: user.id, name: user.name, email: user.email, locale: user.locale })
          .from(user)
          .where(and(eq(user.tenantId, ctx.tenantId), inArray(user.id, input.userIds)));
        if (tenantUsers.length !== input.userIds.length) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'unknown-users' });
        }
        const now = new Date();
        const versionNumber = Math.max(1, assessment.currentVersion);
        const dueAt = input.dueAt ?? null;
        for (const u of tenantUsers) {
          await ctx.db
            .insert(riskAssessmentAcknowledgements)
            .values({
              tenantId: ctx.tenantId,
              assessmentId: assessment.id,
              userId: u.id,
              distributedAt: now,
              versionNumber,
              dueAt,
            })
            .onConflictDoUpdate({
              target: [
                riskAssessmentAcknowledgements.assessmentId,
                riskAssessmentAcknowledgements.userId,
              ],
              set: {
                distributedAt: now,
                acknowledgedAt: null,
                acknowledgedVersion: null,
                versionNumber,
                dueAt,
                lastReminderAt: null,
                redistributed: true,
              },
            });
        }
        // A-3: the recipient hears about it by email, not only via an
        // in-app banner the next time they happen to log in. Best-effort —
        // a failed email never fails the distribution record.
        if (deps.sendEmail !== undefined) {
          const appUrl = deps.appUrl ?? '';
          for (const u of tenantUsers) {
            if (u.email.length === 0) continue;
            try {
              await deps.sendEmail({
                to: u.email,
                /**
                 * RA-D04: this module's own reminder worker already passed
                 * a locale; `distribute` passed none. So the chase-up mail
                 * arrived in Polish and the ORIGINAL request — the one
                 * asking somebody to read and acknowledge a legal document
                 * — arrived in English and landed them on an English page.
                 */
                ...(u.locale !== null ? { locale: u.locale } : {}),
                templateKey: 'risk-assessment-distributed',
                variables: {
                  recipientName: u.name,
                  title: assessment.title,
                  referenceNumber: assessment.referenceNumber ?? '',
                  // A bare value or the house placeholder — never an
                  // English phrase interpolated into a translated body.
                  dueDate: dueAt !== null ? dueAt.toISOString().slice(0, 10) : '—',
                  viewUrl: appLink(appUrl, u.locale, `/risk-assessments/${assessment.id}`),
                },
              });
            } catch (err) {
              ctx.logger.warn(
                { err, assessmentId: assessment.id, userId: u.id },
                '[riskAssessments] distribution email failed',
              );
            }
          }
        }
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          assessmentId: assessment.id,
          actorUserId: ctx.auth.userId,
          kind: 'distributed',
          detail: String(tenantUsers.length),
        });
        return { ok: true, distributed: tenantUsers.length };
      }),

    /**
     * A-2: the Heads Up share path must not be a silent gap — after the
     * composer publishes the heads-up, this records the same
     * acknowledgement rows "Distribute" would, for exactly the recipients
     * the heads-up resolved. Existing rows are left untouched (the
     * heads-up is an extra channel, not a re-request).
     */
    distributeFromHeadsUp: tenantProcedure
      .use(requirePermission('riskAssessments.manage'))
      .input(
        z.object({
          assessmentId: z.string().length(26),
          headsUpId: z.string().length(26),
          dueAt: z.coerce.date().nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const assessment = await loadAssessment(ctx.db, ctx.tenantId, input.assessmentId);
        if (assessment.status !== 'active') {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'not-active' });
        }
        const recipients = await ctx.db
          .select({ userId: headsUpRecipients.userId })
          .from(headsUpRecipients)
          .where(
            and(
              eq(headsUpRecipients.tenantId, ctx.tenantId),
              eq(headsUpRecipients.headsUpId, input.headsUpId),
            ),
          );
        const now = new Date();
        const versionNumber = Math.max(1, assessment.currentVersion);
        let added = 0;
        for (const r of recipients) {
          const inserted = await ctx.db
            .insert(riskAssessmentAcknowledgements)
            .values({
              tenantId: ctx.tenantId,
              assessmentId: assessment.id,
              userId: r.userId,
              distributedAt: now,
              versionNumber,
              dueAt: input.dueAt ?? null,
            })
            .onConflictDoNothing()
            .returning({ userId: riskAssessmentAcknowledgements.userId });
          added += inserted.length;
        }
        if (recipients.length > 0) {
          await logEvent(ctx.db, {
            tenantId: ctx.tenantId,
            assessmentId: assessment.id,
            actorUserId: ctx.auth.userId,
            kind: 'distributed',
            detail: `heads-up · ${recipients.length}`,
          });
        }
        return { ok: true, recipients: recipients.length, added };
      }),

    acknowledge: tenantProcedure
      .use(requirePermission('riskAssessments.view'))
      .input(z.object({ assessmentId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const rows = await ctx.db
          .update(riskAssessmentAcknowledgements)
          .set({
            acknowledgedAt: new Date(),
            // The version they are acknowledging is the one they were
            // asked for — recorded so "read & understood" stays tied to
            // content (A-1).
            acknowledgedVersion: sql`${riskAssessmentAcknowledgements.versionNumber}`,
          })
          .where(
            and(
              eq(riskAssessmentAcknowledgements.assessmentId, input.assessmentId),
              eq(riskAssessmentAcknowledgements.tenantId, ctx.tenantId),
              eq(riskAssessmentAcknowledgements.userId, ctx.auth.userId),
            ),
          )
          .returning({ versionNumber: riskAssessmentAcknowledgements.versionNumber });
        const row = rows[0];
        if (row === undefined) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'not-distributed-to-you' });
        }
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          assessmentId: input.assessmentId,
          actorUserId: ctx.auth.userId,
          kind: 'acknowledged',
          detail: `v${row.versionNumber}`,
        });
        return { ok: true };
      }),

    /** The tenant's matrix configuration (P-4). */
    getMatrixSettings: tenantProcedure
      .use(requirePermission('riskAssessments.view'))
      .query(async ({ ctx }) => {
        assertEnabled();
        const matrix = await loadTenantMatrix(ctx.db, ctx.tenantId);
        return {
          lowMax: matrix.lowMax,
          mediumMax: matrix.mediumMax,
          highMax: matrix.highMax,
          severityFloors: matrix.severityFloors ?? {},
          bands: RISK_BAND_LEVELS,
        };
      }),

    /**
     * Edit the tenant matrix (P-4): band thresholds + severity floors
     * ("severity 5 ⇒ minimum band high"). New assessments snapshot the
     * new matrix; open drafts follow only when `applyToDrafts` is set;
     * published versions always keep the snapshot they were signed with.
     */
    updateMatrixSettings: tenantProcedure
      .use(requirePermission('org.settings'))
      .input(matrixSettingsInput)
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const config: RiskMatrixConfig = {
          lowMax: input.lowMax,
          mediumMax: input.mediumMax,
          highMax: input.highMax,
          severityFloors: input.severityFloors,
        };
        if (!isValidMatrixConfig(config)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'invalid-matrix' });
        }
        const now = new Date();
        await ctx.db
          .insert(tenantRiskMatrixSettings)
          .values({
            tenantId: ctx.tenantId,
            lowMax: input.lowMax,
            mediumMax: input.mediumMax,
            highMax: input.highMax,
            severityFloors: input.severityFloors,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [tenantRiskMatrixSettings.tenantId],
            set: {
              lowMax: input.lowMax,
              mediumMax: input.mediumMax,
              highMax: input.highMax,
              severityFloors: input.severityFloors,
              updatedAt: now,
            },
          });
        let draftsUpdated = 0;
        if (input.applyToDrafts) {
          const updated = await ctx.db
            .update(riskAssessments)
            .set({ matrix: config, updatedAt: now })
            .where(
              and(
                eq(riskAssessments.tenantId, ctx.tenantId),
                eq(riskAssessments.status, 'draft'),
                isNull(riskAssessments.archivedAt),
              ),
            )
            .returning({ id: riskAssessments.id });
          draftsUpdated = updated.length;
        }
        ctx.logger.info(
          { tenantId: ctx.tenantId, draftsUpdated },
          '[riskAssessments] matrix settings updated',
        );
        return { ok: true, draftsUpdated };
      }),

    /**
     * Create a linked person-specific variant (young person / new &
     * expectant mother): duplicates the assessment + hazards + controls as
     * a draft child so the assessor tailors it rather than starting blank.
     */
    createPersonSpecific: tenantProcedure
      .use(requirePermission('riskAssessments.create'))
      .input(
        z.object({
          assessmentId: z.string().length(26),
          kind: z.enum(PERSON_SPECIFIC_KINDS),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const parent = await loadAssessment(ctx.db, ctx.tenantId, input.assessmentId);
        const hazards = await ctx.db
          .select()
          .from(riskAssessmentHazards)
          .where(eq(riskAssessmentHazards.assessmentId, parent.id));
        const controls = await ctx.db
          .select()
          .from(riskAssessmentControls)
          .where(eq(riskAssessmentControls.assessmentId, parent.id));

        const id = newId();
        const n = await nextReferenceValue(ctx.db, ctx.tenantId, 'riskAssessment');
        const now = new Date();
        await ctx.db.transaction(async (tx) => {
          await tx.insert(riskAssessments).values({
            id,
            tenantId: ctx.tenantId,
            referenceNumber: `RA-${String(n).padStart(4, '0')}`,
            title: parent.title,
            activity: parent.activity,
            type: parent.type,
            siteId: parent.siteId,
            locationText: parent.locationText,
            assessorUserId: ctx.auth.userId,
            personSpecificFor: input.kind,
            parentAssessmentId: parent.id,
            // A-4: remember the fork point so both sides can flag drift.
            forkedFromParentAt: now,
            matrix: parent.matrix,
            reviewFrequencyMonths: parent.reviewFrequencyMonths,
            createdBy: ctx.auth.userId,
          });
          for (const h of hazards) {
            const newHazardId = newId();
            await tx.insert(riskAssessmentHazards).values({
              ...h,
              id: newHazardId,
              assessmentId: id,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
            for (const c of controls.filter((c) => c.hazardId === h.id)) {
              await tx.insert(riskAssessmentControls).values({
                ...c,
                id: newId(),
                assessmentId: id,
                hazardId: newHazardId,
                actionId: null,
                createdAt: new Date(),
              });
            }
          }
        });
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          assessmentId: parent.id,
          actorUserId: ctx.auth.userId,
          kind: 'variant_created',
          detail: input.kind,
        });
        return { assessmentId: id };
      }),
  });
}
