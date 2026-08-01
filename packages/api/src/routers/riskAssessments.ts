/**
 * Risk Assessments router (FreeHS module B1).
 *
 * HSE five-step model: identify hazards → who might be harmed and how →
 * evaluate risks and controls → record findings → review. Design goals from
 * the practitioner spec:
 *   - hierarchy of control is structural: every control carries a tier
 *     (eliminate → substitute → engineering → administrative → ppe) and a
 *     hazard whose controls are PPE-only cannot publish without a
 *     justification on at least one of those controls;
 *   - initial AND residual risk are scored (1–5 × 1–5) against per-row
 *     matrix thresholds so the effect of controls is visible;
 *   - every `planned` control generates a CAPA action at publish time
 *     (idempotent via `actionId` + the actions source unique index);
 *   - dynamic / point-of-work assessments are a `type`, distinct from the
 *     standing assessment;
 *   - person-specific variants (young persons, new & expectant mothers)
 *     are linked child assessments;
 *   - reviews are an append-only log with an explicit trigger; the header
 *     carries the schedule (frequency + next due);
 *   - distribution + acknowledgement rows record who has actually read it.
 *
 * Brand gating (ADR 0010): the module ships only where the brand catalogue
 * enables it. The router is built with `{ enabled }` wired from the active
 * brand; every procedure refuses when disabled so the API surface matches
 * the navigation.
 *
 * Deliberate v1 gaps (documented, not accidental): no dependents-registry
 * resolver (the registry's module union is closed — extending it touches
 * the admin cascade UI and is scheduled with the entitlements work), no
 * per-tenant matrix editor UI (thresholds are snapshotted per row and
 * default to 5×5 low≤4 / medium≤9 / high≤15 / critical>15).
 */
import {
  actions,
  AFFECTED_GROUP_PRESETS,
  CONTROL_STATUSES,
  CONTROL_TIERS,
  PERSON_SPECIFIC_KINDS,
  REVIEW_OUTCOMES,
  REVIEW_TRIGGERS,
  RISK_ASSESSMENT_TYPES,
  riskAssessmentAcknowledgements,
  riskAssessmentControls,
  riskAssessmentHazards,
  riskAssessmentReviews,
  riskAssessments,
  user,
} from '@forma360/db/schema';
import type { Database } from '@forma360/db/client';
import { newId } from '@forma360/shared/id';
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { nextReferenceValue } from '../reference-counter';
import { requirePermission, tenantProcedure } from '../procedures';
import { router } from '../trpc';

export interface RiskAssessmentsRouterDeps {
  /** Wired from the brand module catalogue (ADR 0010). */
  enabled: boolean;
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
});

const controlInput = z.object({
  hazardId: z.string().length(26),
  description: z.string().min(1).max(1000),
  tier: z.enum(CONTROL_TIERS),
  status: z.enum(CONTROL_STATUSES).default('in_place'),
  ppeJustification: z.string().max(1000).nullable().optional(),
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

/** Bump the parent assessment's updatedAt. */
async function touch(db: Database, assessmentId: string): Promise<void> {
  await db
    .update(riskAssessments)
    .set({ updatedAt: new Date() })
    .where(eq(riskAssessments.id, assessmentId));
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
              })
              .from(riskAssessmentAcknowledgements)
              .where(inArray(riskAssessmentAcknowledgements.assessmentId, ids))
          : [];

        const now = new Date();
        return rows.map((r) => {
          const hazards = hazardRows.filter((h) => h.assessmentId === r.id);
          const maxResidual = hazards.reduce((max, h) => {
            const s =
              h.residualLikelihood !== null && h.residualSeverity !== null
                ? h.residualLikelihood * h.residualSeverity
                : 0;
            return Math.max(max, s);
          }, 0);
          const acks = ackRows.filter((a) => a.assessmentId === r.id);
          return {
            ...r,
            hazardCount: hazards.length,
            maxResidualScore: maxResidual,
            ackTotal: acks.length,
            ackDone: acks.filter((a) => a.acknowledgedAt !== null).length,
            reviewDue: r.nextReviewAt !== null && r.nextReviewAt <= now,
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
              isNull(riskAssessmentAcknowledgements.acknowledgedAt),
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
            userName: user.name,
            userEmail: user.email,
          })
          .from(riskAssessmentAcknowledgements)
          .leftJoin(user, eq(user.id, riskAssessmentAcknowledgements.userId))
          .where(eq(riskAssessmentAcknowledgements.assessmentId, assessment.id));
        const linkedVariants = await ctx.db
          .select({
            id: riskAssessments.id,
            title: riskAssessments.title,
            personSpecificFor: riskAssessments.personSpecificFor,
            status: riskAssessments.status,
          })
          .from(riskAssessments)
          .where(
            and(
              eq(riskAssessments.tenantId, ctx.tenantId),
              eq(riskAssessments.parentAssessmentId, assessment.id),
            ),
          );
        return {
          assessment,
          hazards: hazards.map((h) => ({
            ...h,
            controls: controls.filter((c) => c.hazardId === h.id),
          })),
          reviews,
          acknowledgements: acks,
          linkedVariants,
          myAcknowledgement: acks.find((a) => a.userId === ctx.auth.userId) ?? null,
        };
      }),

    create: tenantProcedure
      .use(requirePermission('riskAssessments.create'))
      .input(createInput)
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const id = newId();
        const n = await nextReferenceValue(ctx.db, ctx.tenantId, 'riskAssessment');
        const referenceNumber = `RA-${String(n).padStart(4, '0')}`;
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
          createdBy: ctx.auth.userId,
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
            updatedAt: new Date(),
          })
          .where(eq(riskAssessments.id, assessment.id));
        return { ok: true };
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
        });
        await touch(ctx.db, assessment.id);
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
        await ctx.db.delete(riskAssessmentHazards).where(eq(riskAssessmentHazards.id, hazard.id));
        await touch(ctx.db, hazard.assessmentId);
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
        return { ok: true };
      }),

    /**
     * Publish: validates the five-step record is complete, enforces the
     * PPE-only justification rule, then activates the assessment and
     * generates a CAPA action for every planned control (idempotent).
     */
    publish: tenantProcedure
      .use(requirePermission('riskAssessments.manage'))
      .input(z.object({ assessmentId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const assessment = await loadAssessment(ctx.db, ctx.tenantId, input.assessmentId);
        if (assessment.archivedAt !== null) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'archived' });
        }
        const hazards = await ctx.db
          .select()
          .from(riskAssessmentHazards)
          .where(eq(riskAssessmentHazards.assessmentId, assessment.id));
        if (hazards.length === 0) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'no-hazards' });
        }
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
        const controls = await ctx.db
          .select()
          .from(riskAssessmentControls)
          .where(eq(riskAssessmentControls.assessmentId, assessment.id));
        // Hierarchy-of-control rule: PPE cannot be the whole answer without
        // justification. A hazard whose controls are exclusively PPE-tier
        // needs a ppeJustification on at least one of them.
        for (const h of hazards) {
          const hazardControls = controls.filter((c) => c.hazardId === h.id);
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

        // Claim action reference numbers before the tx — the counter helper
        // takes the pool-backed Database. A rolled-back publish wastes a few
        // numbers, which is fine (references are labels, not invariants).
        const pendingControls = controls.filter(
          (c) => c.status === 'planned' && c.actionId === null,
        );
        const actionRefs = new Map<string, string>();
        for (const control of pendingControls) {
          const n = await nextReferenceValue(ctx.db, ctx.tenantId, 'action');
          actionRefs.set(control.id, `AC-${String(n).padStart(6, '0')}`);
        }

        const createdActionIds: string[] = [];
        await ctx.db.transaction(async (tx) => {
          for (const control of pendingControls) {
            const actionId = newId();
            const hazard = hazards.find((h) => h.id === control.hazardId);
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
              createdBy: ctx.auth.userId,
            });
            await tx
              .update(riskAssessmentControls)
              .set({ actionId })
              .where(eq(riskAssessmentControls.id, control.id));
            createdActionIds.push(actionId);
          }
          await tx
            .update(riskAssessments)
            .set({
              status: 'active',
              publishedAt: assessment.publishedAt ?? new Date(),
              updatedAt: new Date(),
            })
            .where(eq(riskAssessments.id, assessment.id));
        });
        ctx.logger.info(
          { assessmentId: assessment.id, actionsCreated: createdActionIds.length },
          '[riskAssessments] published',
        );
        return { ok: true, actionsCreated: createdActionIds.length };
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
        return { ok: true, nextReviewAt };
      }),

    /** Distribute to users; re-distribution resets their acknowledgement. */
    distribute: tenantProcedure
      .use(requirePermission('riskAssessments.manage'))
      .input(
        z.object({
          assessmentId: z.string().length(26),
          userIds: z.array(z.string().min(1)).min(1).max(500),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const assessment = await loadAssessment(ctx.db, ctx.tenantId, input.assessmentId);
        if (assessment.status !== 'active') {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'not-active' });
        }
        const tenantUsers = await ctx.db
          .select({ id: user.id })
          .from(user)
          .where(and(eq(user.tenantId, ctx.tenantId), inArray(user.id, input.userIds)));
        if (tenantUsers.length !== input.userIds.length) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'unknown-users' });
        }
        const now = new Date();
        for (const u of tenantUsers) {
          await ctx.db
            .insert(riskAssessmentAcknowledgements)
            .values({
              tenantId: ctx.tenantId,
              assessmentId: assessment.id,
              userId: u.id,
              distributedAt: now,
            })
            .onConflictDoUpdate({
              target: [
                riskAssessmentAcknowledgements.assessmentId,
                riskAssessmentAcknowledgements.userId,
              ],
              set: { distributedAt: now, acknowledgedAt: null, redistributed: true },
            });
        }
        return { ok: true, distributed: tenantUsers.length };
      }),

    acknowledge: tenantProcedure
      .use(requirePermission('riskAssessments.view'))
      .input(z.object({ assessmentId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const rows = await ctx.db
          .update(riskAssessmentAcknowledgements)
          .set({ acknowledgedAt: new Date() })
          .where(
            and(
              eq(riskAssessmentAcknowledgements.assessmentId, input.assessmentId),
              eq(riskAssessmentAcknowledgements.tenantId, ctx.tenantId),
              eq(riskAssessmentAcknowledgements.userId, ctx.auth.userId),
            ),
          )
          .returning({ userId: riskAssessmentAcknowledgements.userId });
        if (rows.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'not-distributed-to-you' });
        }
        return { ok: true };
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
            matrix: parent.matrix,
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
        return { assessmentId: id };
      }),
  });
}
