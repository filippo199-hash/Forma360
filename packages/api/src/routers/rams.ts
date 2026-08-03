/**
 * RAMS router — Risk Assessment & Method Statement (FreeHS module B6).
 * ADR 0014.
 *
 * The gap this module closes is the *method statement*, not the risk
 * assessment: FreeHS already has a strong, versioned, signed-off RA
 * module, and because the method statement had to live in Word the RA
 * was being retyped alongside it — so the RA module was bypassed. The
 * design consequences run through everything here:
 *
 *   - **The method statement references the RA, it never restates it.**
 *     Steps carry `hazardRefs` pointing at a hazard inside a bound RA
 *     *version*. One source of truth.
 *   - **Binding is by RA version, not RA id**, so a pack is stable. Only
 *     PUBLISHED versions may back an issued pack (RS-E04).
 *   - **Issue freezes everything** into `rams_pack_versions.content`
 *     (ADR 0007's snapshot model, exactly as inspections pin a template
 *     version). A later RA revision never silently changes an issued
 *     pack (RS-E07).
 *   - **Re-issue creates version n+1 and invalidates briefings against
 *     version n** (RS-E08) — the Heads Up signature-invalidation
 *     behaviour, which reviewers praised.
 *   - **The issue gate** (§6.1) refuses a pack that is two unrelated
 *     documents stapled together: a bound hazard whose residual band is
 *     at/above the threshold must be addressed by at least one step
 *     (RS-E05).
 *   - **Briefings are append-only** and always name a version (RS-E09) —
 *     that is what answers "what was in force on the day, and who had
 *     been briefed on that exact version".
 *
 * Authoring effort is the adoption risk, so the module leans hard on
 * autofill: the seeded library gives eight trade skeletons,
 * `createPack` can start from a template *or* clone a previous pack
 * wholesale (bindings, documents and all — "same as the Riverside job"),
 * and `suggestBindings` ranks the tenant's own published RAs and COSHH
 * assessments against the job so binding is a click rather than a
 * search.
 *
 * Brand gating (ADR 0010): built with `{ enabled }` wired from the
 * active brand; every procedure refuses when disabled so the API surface
 * matches the navigation.
 */
import {
  contractorDocuments,
  contractors,
  coshhAssessments,
  coshhSubstances,
  documents,
  methodStatements,
  methodStatementVersions,
  ramsBriefings,
  ramsClientLinks,
  ramsEvents,
  ramsPackCoshh,
  ramsPackDocuments,
  ramsPackRiskAssessments,
  ramsPacks,
  ramsPackVersions,
  ramsReviews,
  RAMS_DOCUMENT_KINDS,
  riskAssessments,
  riskAssessmentVersions,
  sites,
  user,
  type PackVersionCoshh,
  type PackVersionDocument,
  type PackVersionRiskAssessment,
  type RamsEventKind,
  type RamsPackVersionContent,
} from '@forma360/db/schema';
import type { Database } from '@forma360/db/client';
import { newId } from '@forma360/shared/id';
import type { SendTemplatedEmail } from '@forma360/shared/email';
import {
  BRIEFEE_CATEGORIES,
  BRIEFEE_KINDS,
  canTransitionMethodStatement,
  canTransitionPack,
  DEFAULT_METHOD_STATEMENT_TEMPLATES,
  emptyMethodStatementContent,
  evaluateIssueGate,
  formatMethodStatementReference,
  formatRamsPackReference,
  METHOD_STATEMENT_STATUSES,
  METHOD_STATEMENT_TRADES,
  methodStatementContentSchema,
  RAMS_PACK_STATUSES,
  REVIEW_ITEM_VERDICTS,
  REVIEW_OUTCOMES,
  resequenceSteps,
  reviewAcceptanceValid,
  reviewHasFailures,
  snapshotReviewChecklist,
  type BoundRaVersion,
  type MethodStatementContent,
  type ReviewChecklistEntry,
} from '@forma360/shared/rams';
import { worstBand } from '@forma360/shared/risk-matrix';
import type { RaVersionContent } from '@forma360/db/schema';
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { nextReferenceValue } from '../reference-counter';
import { publicProcedure, requirePermission, tenantProcedure } from '../procedures';
import { router } from '../trpc';

export interface RamsRouterDeps {
  /** Wired from the brand module catalogue (ADR 0010). */
  enabled: boolean;
  /**
   * Renders a pack version to a PDF in R2 and returns its object key —
   * wired to `@forma360/render`'s `renderRamsPdf` in the web app.
   * Optional so tests and non-web callers can omit it; `renderPdf`
   * refuses when absent.
   */
  renderPdf?: (input: {
    tenantId: string;
    packId: string;
    packVersionId: string;
  }) => Promise<{ key: string; bytes: number; stub: boolean }>;
  /** Opaque share-token generator — `generateShareToken` in production. */
  generateShareToken?: () => string;
  /** Absolute public share URL builder — `buildShareUrl` in production. */
  buildShareUrl?: (token: string) => string;
  /** Client-issue notification emails. Optional; absent in tests. */
  sendEmail?: SendTemplatedEmail;
  appUrl?: string;
  /** Injectable clock so expiry / validity tests stay deterministic. */
  now?: () => Date;
}

/**
 * The attestation the author confirms at issue. Snapshotted onto the
 * version row so the printed record carries the exact wording that was
 * agreed to — the RA module's M-2 lesson: the attestation appears on
 * EVERY issue, not only when something else triggered a dialog.
 */
export const RAMS_AUTHOR_ATTESTATION =
  'I confirm that I have prepared or reviewed this risk assessment and method statement, ' +
  'that it is suitable and sufficient for the work described, that the sequence of work and ' +
  'the control measures are those that will actually be followed, and that it will be briefed ' +
  'to everyone carrying out the work before they start.';

// ─── Input schemas ──────────────────────────────────────────────────────────

const id26 = z.string().length(26);

const jobContextInput = z.object({
  title: z.string().trim().min(1).max(200),
  clientName: z.string().trim().max(200).default(''),
  siteId: id26.nullable().optional(),
  locationText: z.string().trim().max(500).default(''),
  plannedFrom: z.coerce.date().nullable().optional(),
  plannedTo: z.coerce.date().nullable().optional(),
  supervisorUserId: z.string().max(64).nullable().optional(),
  supervisorName: z.string().trim().max(200).default(''),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Load the bound RA versions in the shape the issue gate needs. Also
 * reports whether every binding resolves to a PUBLISHED version — a
 * binding whose `raVersionId` is null (assessment never published) or
 * whose assessment has since been archived fails RS-E04.
 */
async function loadBoundRaVersions(
  db: Database,
  tenantId: string,
  packId: string,
): Promise<{ versions: BoundRaVersion[]; allPublished: boolean }> {
  const bindings = await db
    .select({
      assessmentId: ramsPackRiskAssessments.assessmentId,
      raVersionId: ramsPackRiskAssessments.raVersionId,
      sortOrder: ramsPackRiskAssessments.sortOrder,
    })
    .from(ramsPackRiskAssessments)
    .where(
      and(
        eq(ramsPackRiskAssessments.tenantId, tenantId),
        eq(ramsPackRiskAssessments.packId, packId),
      ),
    )
    .orderBy(asc(ramsPackRiskAssessments.sortOrder));

  if (bindings.length === 0) return { versions: [], allPublished: true };

  const versionIds = bindings
    .map((b) => b.raVersionId)
    .filter((v): v is string => v !== null && v !== undefined);
  const allPublished = versionIds.length === bindings.length;
  if (versionIds.length === 0) return { versions: [], allPublished: false };

  const rows = await db
    .select({
      id: riskAssessmentVersions.id,
      assessmentId: riskAssessmentVersions.assessmentId,
      versionNumber: riskAssessmentVersions.versionNumber,
      content: riskAssessmentVersions.content,
      referenceNumber: riskAssessments.referenceNumber,
    })
    .from(riskAssessmentVersions)
    .innerJoin(riskAssessments, eq(riskAssessments.id, riskAssessmentVersions.assessmentId))
    .where(
      and(
        eq(riskAssessmentVersions.tenantId, tenantId),
        inArray(riskAssessmentVersions.id, versionIds),
      ),
    );

  const byId = new Map(rows.map((r) => [r.id, r]));
  const versions: BoundRaVersion[] = [];
  for (const binding of bindings) {
    if (binding.raVersionId === null) continue;
    const row = byId.get(binding.raVersionId);
    if (row === undefined) continue;
    const content: RaVersionContent = row.content;
    versions.push({
      raVersionId: row.id,
      assessmentId: row.assessmentId,
      referenceNumber: row.referenceNumber,
      title: content.title,
      versionNumber: row.versionNumber,
      matrix: content.matrix,
      hazards: content.hazards.map((h, index) => ({
        index,
        hazard: h.hazard,
        residualLikelihood: h.residualLikelihood,
        residualSeverity: h.residualSeverity,
      })),
    });
  }
  // A binding that resolved to nothing (cross-tenant / deleted version)
  // is as bad as an unpublished one — never let it pass silently.
  return { versions, allPublished: allPublished && versions.length === bindings.length };
}

/** Summarise a bound RA version for the frozen snapshot. */
function summariseRaVersion(v: BoundRaVersion): PackVersionRiskAssessment {
  const band = worstBand(
    v.hazards.map((h) => ({ likelihood: h.residualLikelihood, severity: h.residualSeverity })),
    v.matrix,
  );
  return {
    raVersionId: v.raVersionId,
    assessmentId: v.assessmentId,
    referenceNumber: v.referenceNumber,
    title: v.title,
    versionNumber: v.versionNumber,
    worstResidualBand: band,
    hazardCount: v.hazards.length,
  };
}

/** Append-only event log write. */
async function logEvent(
  db: Database,
  input: {
    tenantId: string;
    actorUserId: string;
    kind: RamsEventKind;
    packId?: string | null;
    methodStatementId?: string | null;
    reviewId?: string | null;
    detail?: string;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(ramsEvents).values({
    id: newId(),
    tenantId: input.tenantId,
    packId: input.packId ?? null,
    methodStatementId: input.methodStatementId ?? null,
    reviewId: input.reviewId ?? null,
    actorUserId: input.actorUserId,
    kind: input.kind,
    detail: input.detail ?? '',
    payload: input.payload ?? {},
  });
}

/** Display name for a user id, falling back to the id itself. */
async function displayName(db: Database, tenantId: string, userId: string): Promise<string> {
  const rows = await db
    .select({ name: user.name, email: user.email })
    .from(user)
    .where(and(eq(user.tenantId, tenantId), eq(user.id, userId)))
    .limit(1);
  const row = rows[0];
  if (row === undefined) return userId;
  return row.name !== null && row.name.trim().length > 0 ? row.name : row.email;
}

/** Tokenise for the lightweight relevance ranking used by `suggestBindings`. */
function tokenise(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
}

function overlapScore(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let hits = 0;
  for (const token of b) if (a.has(token)) hits += 1;
  return hits;
}

export function createRamsRouter(deps: RamsRouterDeps) {
  const now = (): Date => deps.now?.() ?? new Date();

  function assertEnabled(): void {
    if (!deps.enabled) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'module-disabled' });
    }
  }

  /** Load a pack scoped to the tenant, or 404. RS-E15. */
  async function loadPack(db: Database, tenantId: string, packId: string) {
    const rows = await db
      .select()
      .from(ramsPacks)
      .where(and(eq(ramsPacks.tenantId, tenantId), eq(ramsPacks.id, packId)))
      .limit(1);
    const pack = rows[0];
    if (pack === undefined) throw new TRPCError({ code: 'NOT_FOUND', message: 'pack-not-found' });
    return pack;
  }

  /** Load a method statement scoped to the tenant, or 404. RS-E15. */
  async function loadMethodStatement(db: Database, tenantId: string, methodStatementId: string) {
    const rows = await db
      .select()
      .from(methodStatements)
      .where(
        and(eq(methodStatements.tenantId, tenantId), eq(methodStatements.id, methodStatementId)),
      )
      .limit(1);
    const ms = rows[0];
    if (ms === undefined)
      throw new TRPCError({ code: 'NOT_FOUND', message: 'method-statement-not-found' });
    return ms;
  }

  // ─── Method statements + the library ──────────────────────────────────────

  const methodStatementsRouter = router({
    list: tenantProcedure
      .use(requirePermission('rams.view'))
      .input(
        z
          .object({
            templatesOnly: z.boolean().default(false),
            trade: z.enum(METHOD_STATEMENT_TRADES).optional(),
            status: z.enum(METHOD_STATEMENT_STATUSES).optional(),
            includeArchived: z.boolean().default(false),
            search: z.string().trim().max(200).optional(),
            limit: z.number().int().min(1).max(200).default(50),
          })
          .default({}),
      )
      .query(async ({ ctx, input }) => {
        assertEnabled();
        const where = [eq(methodStatements.tenantId, ctx.tenantId)];
        if (input.templatesOnly) where.push(eq(methodStatements.isTemplate, true));
        if (input.trade !== undefined) where.push(eq(methodStatements.trade, input.trade));
        if (input.status !== undefined) where.push(eq(methodStatements.status, input.status));
        if (!input.includeArchived) where.push(isNull(methodStatements.archivedAt));
        if (input.search !== undefined && input.search.length > 0) {
          where.push(sql`lower(${methodStatements.title}) like ${`%${input.search.toLowerCase()}%`}`);
        }
        const rows = await ctx.db
          .select({
            id: methodStatements.id,
            referenceNumber: methodStatements.referenceNumber,
            title: methodStatements.title,
            trade: methodStatements.trade,
            status: methodStatements.status,
            isTemplate: methodStatements.isTemplate,
            isSeeded: methodStatements.isSeeded,
            currentVersion: methodStatements.currentVersion,
            publishedAt: methodStatements.publishedAt,
            archivedAt: methodStatements.archivedAt,
            updatedAt: methodStatements.updatedAt,
            draftContent: methodStatements.draftContent,
          })
          .from(methodStatements)
          .where(and(...where))
          .orderBy(desc(methodStatements.updatedAt))
          .limit(input.limit);

        return rows.map((r) => ({
          id: r.id,
          referenceNumber: r.referenceNumber,
          title: r.title,
          trade: r.trade,
          status: r.status,
          isTemplate: r.isTemplate,
          isSeeded: r.isSeeded,
          currentVersion: r.currentVersion,
          publishedAt: r.publishedAt,
          archivedAt: r.archivedAt,
          updatedAt: r.updatedAt,
          stepCount: r.draftContent.steps.length,
        }));
      }),

    get: tenantProcedure
      .use(requirePermission('rams.view'))
      .input(z.object({ methodStatementId: id26 }))
      .query(async ({ ctx, input }) => {
        assertEnabled();
        const ms = await loadMethodStatement(ctx.db, ctx.tenantId, input.methodStatementId);
        const versions = await ctx.db
          .select({
            id: methodStatementVersions.id,
            versionNumber: methodStatementVersions.versionNumber,
            publishedBy: methodStatementVersions.publishedBy,
            publishedByName: methodStatementVersions.publishedByName,
            publishedAt: methodStatementVersions.publishedAt,
          })
          .from(methodStatementVersions)
          .where(
            and(
              eq(methodStatementVersions.tenantId, ctx.tenantId),
              eq(methodStatementVersions.methodStatementId, ms.id),
            ),
          )
          .orderBy(desc(methodStatementVersions.versionNumber));
        return { methodStatement: ms, versions };
      }),

    getVersion: tenantProcedure
      .use(requirePermission('rams.view'))
      .input(z.object({ versionId: id26 }))
      .query(async ({ ctx, input }) => {
        assertEnabled();
        const rows = await ctx.db
          .select()
          .from(methodStatementVersions)
          .where(
            and(
              eq(methodStatementVersions.tenantId, ctx.tenantId),
              eq(methodStatementVersions.id, input.versionId),
            ),
          )
          .limit(1);
        const version = rows[0];
        if (version === undefined)
          throw new TRPCError({ code: 'NOT_FOUND', message: 'version-not-found' });
        return version;
      }),

    create: tenantProcedure
      .use(requirePermission('rams.create'))
      .input(
        z.object({
          title: z.string().trim().min(1).max(200),
          trade: z.enum(METHOD_STATEMENT_TRADES).default('other'),
          isTemplate: z.boolean().default(false),
          /** Start from an existing method statement (library or otherwise). */
          fromMethodStatementId: id26.optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        let content: MethodStatementContent = emptyMethodStatementContent();
        if (input.fromMethodStatementId !== undefined) {
          const source = await loadMethodStatement(
            ctx.db,
            ctx.tenantId,
            input.fromMethodStatementId,
          );
          // Published source → take the published version's content;
          // otherwise the working draft. Duplicating never mutates the
          // source (RS-E18).
          if (source.currentVersion > 0) {
            const rows = await ctx.db
              .select({ content: methodStatementVersions.content })
              .from(methodStatementVersions)
              .where(
                and(
                  eq(methodStatementVersions.tenantId, ctx.tenantId),
                  eq(methodStatementVersions.methodStatementId, source.id),
                  eq(methodStatementVersions.versionNumber, source.currentVersion),
                ),
              )
              .limit(1);
            content = rows[0]?.content ?? source.draftContent;
          } else {
            content = source.draftContent;
          }
        }

        const id = newId();
        const reference = formatMethodStatementReference(
          await nextReferenceValue(ctx.db, ctx.tenantId, 'methodStatement'),
        );
        await ctx.db.insert(methodStatements).values({
          id,
          tenantId: ctx.tenantId,
          referenceNumber: reference,
          title: input.title,
          trade: input.trade,
          status: 'draft',
          isTemplate: input.isTemplate,
          isSeeded: false,
          ownerUserId: ctx.auth.userId,
          // Re-parse so a cloned blob is re-validated at this boundary.
          draftContent: methodStatementContentSchema.parse(content),
          createdBy: ctx.auth.userId,
        });
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          actorUserId: ctx.auth.userId,
          kind:
            input.fromMethodStatementId !== undefined
              ? 'method_statement_duplicated'
              : 'method_statement_created',
          methodStatementId: id,
          detail: input.title,
        });
        return { methodStatementId: id, referenceNumber: reference };
      }),

    saveDraft: tenantProcedure
      .use(requirePermission('rams.create'))
      .input(
        z.object({
          methodStatementId: id26,
          title: z.string().trim().min(1).max(200).optional(),
          trade: z.enum(METHOD_STATEMENT_TRADES).optional(),
          isTemplate: z.boolean().optional(),
          content: methodStatementContentSchema.optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const ms = await loadMethodStatement(ctx.db, ctx.tenantId, input.methodStatementId);
        if (ms.archivedAt !== null) {
          throw new TRPCError({ code: 'CONFLICT', message: 'method-statement-archived' });
        }
        await ctx.db
          .update(methodStatements)
          .set({
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.trade !== undefined ? { trade: input.trade } : {}),
            ...(input.isTemplate !== undefined ? { isTemplate: input.isTemplate } : {}),
            ...(input.content !== undefined
              ? { draftContent: { ...input.content, steps: resequenceSteps(input.content.steps) } }
              : {}),
            updatedAt: now(),
          })
          .where(
            and(eq(methodStatements.tenantId, ctx.tenantId), eq(methodStatements.id, ms.id)),
          );
        return { ok: true as const };
      }),

    publish: tenantProcedure
      .use(requirePermission('rams.create'))
      .input(z.object({ methodStatementId: id26 }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const ms = await loadMethodStatement(ctx.db, ctx.tenantId, input.methodStatementId);
        if (ms.archivedAt !== null) {
          throw new TRPCError({ code: 'CONFLICT', message: 'method-statement-archived' });
        }
        if (!canTransitionMethodStatement(ms.status, 'published')) {
          throw new TRPCError({ code: 'CONFLICT', message: 'illegal-transition' });
        }
        if (ms.draftContent.steps.length === 0) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'no-steps' });
        }

        const versionNumber = ms.currentVersion + 1;
        const at = now();
        const name = await displayName(ctx.db, ctx.tenantId, ctx.auth.userId);
        await ctx.db.insert(methodStatementVersions).values({
          id: newId(),
          tenantId: ctx.tenantId,
          methodStatementId: ms.id,
          versionNumber,
          content: ms.draftContent,
          publishedBy: ctx.auth.userId,
          publishedByName: name,
          publishedAt: at,
        });
        await ctx.db
          .update(methodStatements)
          .set({ status: 'published', currentVersion: versionNumber, publishedAt: at, updatedAt: at })
          .where(and(eq(methodStatements.tenantId, ctx.tenantId), eq(methodStatements.id, ms.id)));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          actorUserId: ctx.auth.userId,
          kind: 'method_statement_published',
          methodStatementId: ms.id,
          detail: `v${versionNumber}`,
          payload: { versionNumber },
        });
        return { versionNumber };
      }),

    archive: tenantProcedure
      .use(requirePermission('rams.manage'))
      .input(z.object({ methodStatementId: id26 }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const ms = await loadMethodStatement(ctx.db, ctx.tenantId, input.methodStatementId);
        if (ms.archivedAt !== null) return { ok: true as const };
        if (!canTransitionMethodStatement(ms.status, 'archived')) {
          throw new TRPCError({ code: 'CONFLICT', message: 'illegal-transition' });
        }
        const at = now();
        await ctx.db
          .update(methodStatements)
          .set({ status: 'archived', archivedAt: at, updatedAt: at })
          .where(and(eq(methodStatements.tenantId, ctx.tenantId), eq(methodStatements.id, ms.id)));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          actorUserId: ctx.auth.userId,
          kind: 'method_statement_archived',
          methodStatementId: ms.id,
        });
        return { ok: true as const };
      }),

    /**
     * Seed the starter library. Idempotent — the same stance as
     * `seedDefaultPermissionSets` and the permit-type catalogue: call it
     * from any new-tenant flow, and safely again from the UI's "restore
     * starter templates" affordance.
     */
    seedLibrary: tenantProcedure
      .use(requirePermission('rams.manage'))
      .mutation(async ({ ctx }) => {
        assertEnabled();
        const existing = await ctx.db
          .select({ id: methodStatements.id })
          .from(methodStatements)
          .where(
            and(eq(methodStatements.tenantId, ctx.tenantId), eq(methodStatements.isSeeded, true)),
          )
          .limit(1);
        if (existing.length > 0) return { seeded: 0 };

        const at = now();
        let seeded = 0;
        for (const template of DEFAULT_METHOD_STATEMENT_TEMPLATES) {
          const content = methodStatementContentSchema.parse({
            scopeOfWorks: template.scopeOfWorks,
            steps: template.steps.map((s, index) => ({
              id: `seed-${index + 1}`,
              sequence: index + 1,
              title: s.title,
              description: s.description,
              ppe: s.ppe,
              ...(s.holdPoint !== undefined
                ? { holdPoint: { kind: s.holdPoint.kind, description: s.holdPoint.description } }
                : {}),
            })),
            emergency: template.emergency,
            logistics: template.logistics,
          });
          const id = newId();
          const reference = formatMethodStatementReference(
            await nextReferenceValue(ctx.db, ctx.tenantId, 'methodStatement'),
          );
          await ctx.db.insert(methodStatements).values({
            id,
            tenantId: ctx.tenantId,
            referenceNumber: reference,
            title: template.title,
            trade: template.trade,
            // Seeded starters land published so a pack can be built from
            // them immediately — the whole point is zero setup.
            status: 'published',
            isTemplate: true,
            isSeeded: true,
            ownerUserId: ctx.auth.userId,
            draftContent: content,
            currentVersion: 1,
            publishedAt: at,
            createdBy: ctx.auth.userId,
          });
          await ctx.db.insert(methodStatementVersions).values({
            id: newId(),
            tenantId: ctx.tenantId,
            methodStatementId: id,
            versionNumber: 1,
            content,
            publishedBy: ctx.auth.userId,
            publishedByName: 'System',
            publishedAt: at,
          });
          seeded += 1;
        }
        return { seeded };
      }),
  });

  // ─── Packs ────────────────────────────────────────────────────────────────

  const packsRouter = router({
    list: tenantProcedure
      .use(requirePermission('rams.view'))
      .input(
        z
          .object({
            status: z.enum(RAMS_PACK_STATUSES).optional(),
            siteId: id26.optional(),
            search: z.string().trim().max(200).optional(),
            includeArchived: z.boolean().default(false),
            limit: z.number().int().min(1).max(200).default(50),
          })
          .default({}),
      )
      .query(async ({ ctx, input }) => {
        assertEnabled();
        const where = [eq(ramsPacks.tenantId, ctx.tenantId)];
        if (input.status !== undefined) where.push(eq(ramsPacks.status, input.status));
        if (input.siteId !== undefined) where.push(eq(ramsPacks.siteId, input.siteId));
        if (!input.includeArchived) where.push(isNull(ramsPacks.archivedAt));
        if (input.search !== undefined && input.search.length > 0) {
          const q = `%${input.search.toLowerCase()}%`;
          const clause = or(
            sql`lower(${ramsPacks.title}) like ${q}`,
            sql`lower(coalesce(${ramsPacks.referenceNumber}, '')) like ${q}`,
            sql`lower(${ramsPacks.clientName}) like ${q}`,
          );
          if (clause !== undefined) where.push(clause);
        }

        const rows = await ctx.db
          .select({
            id: ramsPacks.id,
            referenceNumber: ramsPacks.referenceNumber,
            title: ramsPacks.title,
            status: ramsPacks.status,
            clientName: ramsPacks.clientName,
            siteId: ramsPacks.siteId,
            siteName: sites.name,
            locationText: ramsPacks.locationText,
            plannedFrom: ramsPacks.plannedFrom,
            plannedTo: ramsPacks.plannedTo,
            currentVersion: ramsPacks.currentVersion,
            issuedAt: ramsPacks.issuedAt,
            updatedAt: ramsPacks.updatedAt,
          })
          .from(ramsPacks)
          .leftJoin(sites, eq(sites.id, ramsPacks.siteId))
          .where(and(...where))
          .orderBy(desc(ramsPacks.updatedAt))
          .limit(input.limit);

        // Briefing counts against the CURRENT version, so the register
        // shows "3 briefed / 2 outstanding on v2" without a second call.
        const packIds = rows.map((r) => r.id);
        const briefedByPack = new Map<string, number>();
        if (packIds.length > 0) {
          const counts = await ctx.db
            .select({
              packId: ramsBriefings.packId,
              versionNumber: ramsBriefings.versionNumber,
              n: sql<number>`count(*)::int`,
            })
            .from(ramsBriefings)
            .where(
              and(
                eq(ramsBriefings.tenantId, ctx.tenantId),
                inArray(ramsBriefings.packId, packIds),
              ),
            )
            .groupBy(ramsBriefings.packId, ramsBriefings.versionNumber);
          const currentByPack = new Map(rows.map((r) => [r.id, r.currentVersion]));
          for (const c of counts) {
            if (c.versionNumber === currentByPack.get(c.packId)) {
              briefedByPack.set(c.packId, Number(c.n));
            }
          }
        }

        return rows.map((r) => ({ ...r, briefedOnCurrentVersion: briefedByPack.get(r.id) ?? 0 }));
      }),

    /**
     * The register's needs-attention strip — the four things that
     * actually need a human: packs sitting in draft, issued packs with
     * nobody briefed on the current version, client acceptances still
     * pending, and third-party reviews awaiting a decision or expiring.
     */
    overview: tenantProcedure
      .use(requirePermission('rams.view'))
      .query(async ({ ctx }) => {
        assertEnabled();
        const at = now();
        const soon = new Date(at.getTime() + 30 * 86_400_000);

        const [draftRow] = await ctx.db
          .select({ n: sql<number>`count(*)::int` })
          .from(ramsPacks)
          .where(
            and(
              eq(ramsPacks.tenantId, ctx.tenantId),
              eq(ramsPacks.status, 'draft'),
              isNull(ramsPacks.archivedAt),
            ),
          );

        const issued = await ctx.db
          .select({ id: ramsPacks.id, currentVersion: ramsPacks.currentVersion })
          .from(ramsPacks)
          .where(
            and(
              eq(ramsPacks.tenantId, ctx.tenantId),
              eq(ramsPacks.status, 'issued'),
              isNull(ramsPacks.archivedAt),
            ),
          );
        let awaitingBriefing = 0;
        if (issued.length > 0) {
          const counts = await ctx.db
            .select({
              packId: ramsBriefings.packId,
              versionNumber: ramsBriefings.versionNumber,
              n: sql<number>`count(*)::int`,
            })
            .from(ramsBriefings)
            .where(
              and(
                eq(ramsBriefings.tenantId, ctx.tenantId),
                inArray(
                  ramsBriefings.packId,
                  issued.map((p) => p.id),
                ),
              ),
            )
            .groupBy(ramsBriefings.packId, ramsBriefings.versionNumber);
          const key = (p: string, v: number): string => `${p}:${v}`;
          const have = new Set(counts.map((c) => key(c.packId, c.versionNumber)));
          awaitingBriefing = issued.filter(
            (p) => !have.has(key(p.id, p.currentVersion)),
          ).length;
        }

        const [pendingAcceptance] = await ctx.db
          .select({ n: sql<number>`count(*)::int` })
          .from(ramsClientLinks)
          .where(
            and(
              eq(ramsClientLinks.tenantId, ctx.tenantId),
              eq(ramsClientLinks.decision, 'pending'),
              isNull(ramsClientLinks.revokedAt),
            ),
          );

        const [pendingReviews] = await ctx.db
          .select({ n: sql<number>`count(*)::int` })
          .from(ramsReviews)
          .where(and(eq(ramsReviews.tenantId, ctx.tenantId), eq(ramsReviews.outcome, 'pending')));

        const [expiringReviews] = await ctx.db
          .select({ n: sql<number>`count(*)::int` })
          .from(ramsReviews)
          .where(
            and(
              eq(ramsReviews.tenantId, ctx.tenantId),
              inArray(ramsReviews.outcome, ['accepted', 'accepted_with_conditions']),
              isNotNull(ramsReviews.validTo),
              sql`${ramsReviews.validTo} <= ${soon}`,
            ),
          );

        return {
          draftPacks: Number(draftRow?.n ?? 0),
          awaitingBriefing,
          pendingClientAcceptance: Number(pendingAcceptance?.n ?? 0),
          pendingReviews: Number(pendingReviews?.n ?? 0),
          expiringReviews: Number(expiringReviews?.n ?? 0),
        };
      }),

    get: tenantProcedure
      .use(requirePermission('rams.view'))
      .input(z.object({ packId: id26 }))
      .query(async ({ ctx, input }) => {
        assertEnabled();
        const pack = await loadPack(ctx.db, ctx.tenantId, input.packId);

        const [site] =
          pack.siteId === null
            ? []
            : await ctx.db
                .select({ id: sites.id, name: sites.name })
                .from(sites)
                .where(and(eq(sites.tenantId, ctx.tenantId), eq(sites.id, pack.siteId)))
                .limit(1);

        const { versions: boundRas, allPublished } = await loadBoundRaVersions(
          ctx.db,
          ctx.tenantId,
          pack.id,
        );

        const coshhRows = await ctx.db
          .select({
            id: ramsPackCoshh.id,
            coshhAssessmentId: ramsPackCoshh.coshhAssessmentId,
            substanceId: ramsPackCoshh.substanceId,
            taskDescription: coshhAssessments.taskDescription,
            referenceNumber: coshhAssessments.referenceNumber,
            substanceName: coshhSubstances.name,
          })
          .from(ramsPackCoshh)
          .innerJoin(coshhAssessments, eq(coshhAssessments.id, ramsPackCoshh.coshhAssessmentId))
          .leftJoin(coshhSubstances, eq(coshhSubstances.id, ramsPackCoshh.substanceId))
          .where(
            and(eq(ramsPackCoshh.tenantId, ctx.tenantId), eq(ramsPackCoshh.packId, pack.id)),
          )
          .orderBy(asc(ramsPackCoshh.sortOrder));

        const docRows = await ctx.db
          .select()
          .from(ramsPackDocuments)
          .where(
            and(
              eq(ramsPackDocuments.tenantId, ctx.tenantId),
              eq(ramsPackDocuments.packId, pack.id),
            ),
          )
          .orderBy(asc(ramsPackDocuments.sortOrder));

        const versions = await ctx.db
          .select({
            id: ramsPackVersions.id,
            versionNumber: ramsPackVersions.versionNumber,
            issuedBy: ramsPackVersions.issuedBy,
            issuedByName: ramsPackVersions.issuedByName,
            issuedAt: ramsPackVersions.issuedAt,
            supersededAt: ramsPackVersions.supersededAt,
          })
          .from(ramsPackVersions)
          .where(
            and(eq(ramsPackVersions.tenantId, ctx.tenantId), eq(ramsPackVersions.packId, pack.id)),
          )
          .orderBy(desc(ramsPackVersions.versionNumber));

        const briefings = await ctx.db
          .select()
          .from(ramsBriefings)
          .where(and(eq(ramsBriefings.tenantId, ctx.tenantId), eq(ramsBriefings.packId, pack.id)))
          .orderBy(desc(ramsBriefings.briefedAt));

        const clientLinks = await ctx.db
          .select()
          .from(ramsClientLinks)
          .where(
            and(eq(ramsClientLinks.tenantId, ctx.tenantId), eq(ramsClientLinks.packId, pack.id)),
          )
          .orderBy(desc(ramsClientLinks.createdAt));

        const events = await ctx.db
          .select()
          .from(ramsEvents)
          .where(and(eq(ramsEvents.tenantId, ctx.tenantId), eq(ramsEvents.packId, pack.id)))
          .orderBy(desc(ramsEvents.createdAt))
          .limit(200);

        const gate = evaluateIssueGate({
          content: pack.draftContent,
          raVersions: boundRas,
          allRaVersionsPublished: allPublished,
          // The preview shows the content gate; the attestation is a
          // property of the issue call, not of the pack.
          attestationConfirmed: true,
        });

        return {
          pack,
          site: site ?? null,
          riskAssessments: boundRas,
          allRaVersionsPublished: allPublished,
          coshh: coshhRows,
          documents: docRows,
          versions,
          briefings: briefings.map((b) => ({
            ...b,
            current: b.versionNumber === pack.currentVersion,
          })),
          clientLinks,
          events,
          issueGate: gate,
        };
      }),

    getVersion: tenantProcedure
      .use(requirePermission('rams.view'))
      .input(z.object({ packVersionId: id26 }))
      .query(async ({ ctx, input }) => {
        assertEnabled();
        const rows = await ctx.db
          .select()
          .from(ramsPackVersions)
          .where(
            and(
              eq(ramsPackVersions.tenantId, ctx.tenantId),
              eq(ramsPackVersions.id, input.packVersionId),
            ),
          )
          .limit(1);
        const version = rows[0];
        if (version === undefined)
          throw new TRPCError({ code: 'NOT_FOUND', message: 'version-not-found' });
        const briefings = await ctx.db
          .select()
          .from(ramsBriefings)
          .where(
            and(
              eq(ramsBriefings.tenantId, ctx.tenantId),
              eq(ramsBriefings.packVersionId, version.id),
            ),
          )
          .orderBy(asc(ramsBriefings.briefedAt));
        return { version, briefings };
      }),

    /**
     * Start a pack. Three motions, all of which exist to avoid a blank
     * page (spec §6.1): from a library method statement, by cloning a
     * previous pack wholesale — bindings, COSHH, documents and step
     * content, which is the commonest real motion ("same as the
     * Riverside job") — or blank.
     */
    create: tenantProcedure
      .use(requirePermission('rams.create'))
      .input(
        jobContextInput.extend({
          methodStatementId: id26.optional(),
          /** Clone everything from an existing pack. */
          fromPackId: id26.optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();

        let content: MethodStatementContent = emptyMethodStatementContent();
        let methodStatementId: string | null = input.methodStatementId ?? null;
        let sourcePack: Awaited<ReturnType<typeof loadPack>> | null = null;

        if (input.fromPackId !== undefined) {
          sourcePack = await loadPack(ctx.db, ctx.tenantId, input.fromPackId);
          content = sourcePack.draftContent;
          methodStatementId = sourcePack.methodStatementId;
        } else if (input.methodStatementId !== undefined) {
          const ms = await loadMethodStatement(ctx.db, ctx.tenantId, input.methodStatementId);
          if (ms.currentVersion > 0) {
            const rows = await ctx.db
              .select({ content: methodStatementVersions.content })
              .from(methodStatementVersions)
              .where(
                and(
                  eq(methodStatementVersions.tenantId, ctx.tenantId),
                  eq(methodStatementVersions.methodStatementId, ms.id),
                  eq(methodStatementVersions.versionNumber, ms.currentVersion),
                ),
              )
              .limit(1);
            content = rows[0]?.content ?? ms.draftContent;
          } else {
            content = ms.draftContent;
          }
        }

        const packId = newId();
        const reference = formatRamsPackReference(
          await nextReferenceValue(ctx.db, ctx.tenantId, 'ramsPack'),
        );

        await ctx.db.insert(ramsPacks).values({
          id: packId,
          tenantId: ctx.tenantId,
          referenceNumber: reference,
          title: input.title,
          status: 'draft',
          clientName: input.clientName,
          siteId: input.siteId ?? null,
          locationText: input.locationText,
          plannedFrom: input.plannedFrom ?? null,
          plannedTo: input.plannedTo ?? null,
          authorUserId: ctx.auth.userId,
          supervisorUserId: input.supervisorUserId ?? null,
          supervisorName: input.supervisorName,
          methodStatementId,
          draftContent: methodStatementContentSchema.parse(content),
          createdBy: ctx.auth.userId,
        });

        // Clone the bindings too — a pack cloned without its RAs is a
        // blank page with extra steps.
        if (sourcePack !== null) {
          const ras = await ctx.db
            .select()
            .from(ramsPackRiskAssessments)
            .where(
              and(
                eq(ramsPackRiskAssessments.tenantId, ctx.tenantId),
                eq(ramsPackRiskAssessments.packId, sourcePack.id),
              ),
            );
          for (const ra of ras) {
            await ctx.db.insert(ramsPackRiskAssessments).values({
              id: newId(),
              tenantId: ctx.tenantId,
              packId,
              assessmentId: ra.assessmentId,
              raVersionId: ra.raVersionId,
              sortOrder: ra.sortOrder,
            });
          }
          const coshhBindings = await ctx.db
            .select()
            .from(ramsPackCoshh)
            .where(
              and(
                eq(ramsPackCoshh.tenantId, ctx.tenantId),
                eq(ramsPackCoshh.packId, sourcePack.id),
              ),
            );
          for (const c of coshhBindings) {
            await ctx.db.insert(ramsPackCoshh).values({
              id: newId(),
              tenantId: ctx.tenantId,
              packId,
              coshhAssessmentId: c.coshhAssessmentId,
              substanceId: c.substanceId,
              sortOrder: c.sortOrder,
            });
          }
          const docs = await ctx.db
            .select()
            .from(ramsPackDocuments)
            .where(
              and(
                eq(ramsPackDocuments.tenantId, ctx.tenantId),
                eq(ramsPackDocuments.packId, sourcePack.id),
              ),
            );
          for (const d of docs) {
            await ctx.db.insert(ramsPackDocuments).values({
              id: newId(),
              tenantId: ctx.tenantId,
              packId,
              kind: d.kind,
              title: d.title,
              documentId: d.documentId,
              storageKey: d.storageKey,
              filename: d.filename,
              sortOrder: d.sortOrder,
              addedBy: ctx.auth.userId,
            });
          }
        }

        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          actorUserId: ctx.auth.userId,
          kind: 'pack_created',
          packId,
          detail: input.title,
          payload: {
            fromPackId: input.fromPackId ?? null,
            methodStatementId,
          },
        });

        return { packId, referenceNumber: reference };
      }),

    update: tenantProcedure
      .use(requirePermission('rams.create'))
      .input(jobContextInput.partial().extend({ packId: id26 }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const pack = await loadPack(ctx.db, ctx.tenantId, input.packId);
        if (pack.status !== 'draft' && pack.status !== 'issued') {
          throw new TRPCError({ code: 'CONFLICT', message: 'pack-not-editable' });
        }
        await ctx.db
          .update(ramsPacks)
          .set({
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.clientName !== undefined ? { clientName: input.clientName } : {}),
            ...(input.siteId !== undefined ? { siteId: input.siteId } : {}),
            ...(input.locationText !== undefined ? { locationText: input.locationText } : {}),
            ...(input.plannedFrom !== undefined ? { plannedFrom: input.plannedFrom } : {}),
            ...(input.plannedTo !== undefined ? { plannedTo: input.plannedTo } : {}),
            ...(input.supervisorUserId !== undefined
              ? { supervisorUserId: input.supervisorUserId }
              : {}),
            ...(input.supervisorName !== undefined
              ? { supervisorName: input.supervisorName }
              : {}),
            updatedAt: now(),
          })
          .where(and(eq(ramsPacks.tenantId, ctx.tenantId), eq(ramsPacks.id, pack.id)));
        return { ok: true as const };
      }),

    saveDraft: tenantProcedure
      .use(requirePermission('rams.create'))
      .input(z.object({ packId: id26, content: methodStatementContentSchema }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const pack = await loadPack(ctx.db, ctx.tenantId, input.packId);
        if (pack.status !== 'draft' && pack.status !== 'issued') {
          throw new TRPCError({ code: 'CONFLICT', message: 'pack-not-editable' });
        }
        await ctx.db
          .update(ramsPacks)
          .set({
            draftContent: { ...input.content, steps: resequenceSteps(input.content.steps) },
            updatedAt: now(),
          })
          .where(and(eq(ramsPacks.tenantId, ctx.tenantId), eq(ramsPacks.id, pack.id)));
        return { ok: true as const };
      }),

    /**
     * Bind a risk assessment. Always binds the assessment's CURRENT
     * published version — binding by version is what keeps an issued
     * pack stable (spec §10.1).
     */
    bindRiskAssessment: tenantProcedure
      .use(requirePermission('rams.create'))
      .input(z.object({ packId: id26, assessmentId: id26 }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const pack = await loadPack(ctx.db, ctx.tenantId, input.packId);

        const raRows = await ctx.db
          .select({
            id: riskAssessments.id,
            title: riskAssessments.title,
            currentVersion: riskAssessments.currentVersion,
            archivedAt: riskAssessments.archivedAt,
          })
          .from(riskAssessments)
          .where(
            and(eq(riskAssessments.tenantId, ctx.tenantId), eq(riskAssessments.id, input.assessmentId)),
          )
          .limit(1);
        const ra = raRows[0];
        if (ra === undefined)
          throw new TRPCError({ code: 'NOT_FOUND', message: 'risk-assessment-not-found' });
        if (ra.archivedAt !== null)
          throw new TRPCError({ code: 'CONFLICT', message: 'risk-assessment-archived' });

        let raVersionId: string | null = null;
        if (ra.currentVersion > 0) {
          const vRows = await ctx.db
            .select({ id: riskAssessmentVersions.id })
            .from(riskAssessmentVersions)
            .where(
              and(
                eq(riskAssessmentVersions.tenantId, ctx.tenantId),
                eq(riskAssessmentVersions.assessmentId, ra.id),
                eq(riskAssessmentVersions.versionNumber, ra.currentVersion),
              ),
            )
            .limit(1);
          raVersionId = vRows[0]?.id ?? null;
        }

        const [maxOrder] = await ctx.db
          .select({ n: sql<number>`coalesce(max(${ramsPackRiskAssessments.sortOrder}), -1)::int` })
          .from(ramsPackRiskAssessments)
          .where(
            and(
              eq(ramsPackRiskAssessments.tenantId, ctx.tenantId),
              eq(ramsPackRiskAssessments.packId, pack.id),
            ),
          );

        await ctx.db
          .insert(ramsPackRiskAssessments)
          .values({
            id: newId(),
            tenantId: ctx.tenantId,
            packId: pack.id,
            assessmentId: ra.id,
            raVersionId,
            sortOrder: Number(maxOrder?.n ?? -1) + 1,
          })
          .onConflictDoNothing();

        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          actorUserId: ctx.auth.userId,
          kind: 'ra_bound',
          packId: pack.id,
          detail: ra.title,
          payload: { assessmentId: ra.id, raVersionId },
        });
        return { raVersionId, published: raVersionId !== null };
      }),

    unbindRiskAssessment: tenantProcedure
      .use(requirePermission('rams.create'))
      .input(z.object({ packId: id26, assessmentId: id26 }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const pack = await loadPack(ctx.db, ctx.tenantId, input.packId);
        await ctx.db
          .delete(ramsPackRiskAssessments)
          .where(
            and(
              eq(ramsPackRiskAssessments.tenantId, ctx.tenantId),
              eq(ramsPackRiskAssessments.packId, pack.id),
              eq(ramsPackRiskAssessments.assessmentId, input.assessmentId),
            ),
          );
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          actorUserId: ctx.auth.userId,
          kind: 'ra_unbound',
          packId: pack.id,
          payload: { assessmentId: input.assessmentId },
        });
        return { ok: true as const };
      }),

    bindCoshh: tenantProcedure
      .use(requirePermission('rams.create'))
      .input(z.object({ packId: id26, coshhAssessmentId: id26 }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const pack = await loadPack(ctx.db, ctx.tenantId, input.packId);
        const rows = await ctx.db
          .select({
            id: coshhAssessments.id,
            substanceId: coshhAssessments.substanceId,
            taskDescription: coshhAssessments.taskDescription,
          })
          .from(coshhAssessments)
          .where(
            and(
              eq(coshhAssessments.tenantId, ctx.tenantId),
              eq(coshhAssessments.id, input.coshhAssessmentId),
            ),
          )
          .limit(1);
        const assessment = rows[0];
        if (assessment === undefined)
          throw new TRPCError({ code: 'NOT_FOUND', message: 'coshh-assessment-not-found' });

        const [maxOrder] = await ctx.db
          .select({ n: sql<number>`coalesce(max(${ramsPackCoshh.sortOrder}), -1)::int` })
          .from(ramsPackCoshh)
          .where(
            and(eq(ramsPackCoshh.tenantId, ctx.tenantId), eq(ramsPackCoshh.packId, pack.id)),
          );

        await ctx.db
          .insert(ramsPackCoshh)
          .values({
            id: newId(),
            tenantId: ctx.tenantId,
            packId: pack.id,
            coshhAssessmentId: assessment.id,
            substanceId: assessment.substanceId,
            sortOrder: Number(maxOrder?.n ?? -1) + 1,
          })
          .onConflictDoNothing();

        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          actorUserId: ctx.auth.userId,
          kind: 'coshh_bound',
          packId: pack.id,
          detail: assessment.taskDescription,
          payload: { coshhAssessmentId: assessment.id },
        });
        return { ok: true as const };
      }),

    unbindCoshh: tenantProcedure
      .use(requirePermission('rams.create'))
      .input(z.object({ packId: id26, coshhAssessmentId: id26 }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const pack = await loadPack(ctx.db, ctx.tenantId, input.packId);
        await ctx.db
          .delete(ramsPackCoshh)
          .where(
            and(
              eq(ramsPackCoshh.tenantId, ctx.tenantId),
              eq(ramsPackCoshh.packId, pack.id),
              eq(ramsPackCoshh.coshhAssessmentId, input.coshhAssessmentId),
            ),
          );
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          actorUserId: ctx.auth.userId,
          kind: 'coshh_unbound',
          packId: pack.id,
          payload: { coshhAssessmentId: input.coshhAssessmentId },
        });
        return { ok: true as const };
      }),

    addDocument: tenantProcedure
      .use(requirePermission('rams.create'))
      .input(
        z
          .object({
            packId: id26,
            kind: z.enum(RAMS_DOCUMENT_KINDS).default('other'),
            title: z.string().trim().max(300).default(''),
            documentId: id26.optional(),
            storageKey: z.string().trim().max(500).optional(),
            filename: z.string().trim().max(300).default(''),
          })
          .refine(
            (v) => (v.documentId === undefined) !== (v.storageKey === undefined),
            'exactly one of documentId / storageKey is required',
          ),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const pack = await loadPack(ctx.db, ctx.tenantId, input.packId);

        let title = input.title;
        if (input.documentId !== undefined) {
          // Documents are referenced, not copied — and must be ours.
          const rows = await ctx.db
            .select({ id: documents.id, name: documents.name })
            .from(documents)
            .where(and(eq(documents.tenantId, ctx.tenantId), eq(documents.id, input.documentId)))
            .limit(1);
          const doc = rows[0];
          if (doc === undefined)
            throw new TRPCError({ code: 'NOT_FOUND', message: 'document-not-found' });
          if (title.length === 0) title = doc.name;
        }

        const [maxOrder] = await ctx.db
          .select({ n: sql<number>`coalesce(max(${ramsPackDocuments.sortOrder}), -1)::int` })
          .from(ramsPackDocuments)
          .where(
            and(
              eq(ramsPackDocuments.tenantId, ctx.tenantId),
              eq(ramsPackDocuments.packId, pack.id),
            ),
          );

        const id = newId();
        await ctx.db.insert(ramsPackDocuments).values({
          id,
          tenantId: ctx.tenantId,
          packId: pack.id,
          kind: input.kind,
          title,
          documentId: input.documentId ?? null,
          storageKey: input.storageKey ?? null,
          filename: input.filename,
          sortOrder: Number(maxOrder?.n ?? -1) + 1,
          addedBy: ctx.auth.userId,
        });
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          actorUserId: ctx.auth.userId,
          kind: 'document_added',
          packId: pack.id,
          detail: title,
        });
        return { documentRowId: id };
      }),

    removeDocument: tenantProcedure
      .use(requirePermission('rams.create'))
      .input(z.object({ packId: id26, documentRowId: id26 }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const pack = await loadPack(ctx.db, ctx.tenantId, input.packId);
        await ctx.db
          .delete(ramsPackDocuments)
          .where(
            and(
              eq(ramsPackDocuments.tenantId, ctx.tenantId),
              eq(ramsPackDocuments.packId, pack.id),
              eq(ramsPackDocuments.id, input.documentRowId),
            ),
          );
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          actorUserId: ctx.auth.userId,
          kind: 'document_removed',
          packId: pack.id,
        });
        return { ok: true as const };
      }),

    /**
     * Autofill: rank the tenant's own published risk assessments and
     * COSHH assessments against the job so binding is a click rather
     * than a search. Deliberately a deterministic rule (token overlap
     * over title / activity / scope + site match), not a model — the
     * platform computes, the practitioner judges (spec §12).
     */
    suggestBindings: tenantProcedure
      .use(requirePermission('rams.view'))
      .input(z.object({ packId: id26, limit: z.number().int().min(1).max(20).default(6) }))
      .query(async ({ ctx, input }) => {
        assertEnabled();
        const pack = await loadPack(ctx.db, ctx.tenantId, input.packId);

        const jobTokens = tokenise(
          [
            pack.title,
            pack.draftContent.scopeOfWorks,
            pack.locationText,
            ...pack.draftContent.steps.map((s) => `${s.title} ${s.description}`),
          ].join(' '),
        );

        const alreadyBoundRa = new Set(
          (
            await ctx.db
              .select({ assessmentId: ramsPackRiskAssessments.assessmentId })
              .from(ramsPackRiskAssessments)
              .where(
                and(
                  eq(ramsPackRiskAssessments.tenantId, ctx.tenantId),
                  eq(ramsPackRiskAssessments.packId, pack.id),
                ),
              )
          ).map((r) => r.assessmentId),
        );

        const raRows = await ctx.db
          .select({
            id: riskAssessments.id,
            title: riskAssessments.title,
            activity: riskAssessments.activity,
            referenceNumber: riskAssessments.referenceNumber,
            siteId: riskAssessments.siteId,
            currentVersion: riskAssessments.currentVersion,
          })
          .from(riskAssessments)
          .where(
            and(
              eq(riskAssessments.tenantId, ctx.tenantId),
              isNull(riskAssessments.archivedAt),
              // Only published assessments can back an issued pack, so
              // only published assessments are worth suggesting.
              sql`${riskAssessments.currentVersion} > 0`,
            ),
          )
          .limit(300);

        const raSuggestions = raRows
          .filter((r) => !alreadyBoundRa.has(r.id))
          .map((r) => {
            const score =
              overlapScore(jobTokens, tokenise(`${r.title} ${r.activity}`)) +
              (pack.siteId !== null && r.siteId === pack.siteId ? 2 : 0);
            return { ...r, score };
          })
          .filter((r) => r.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, input.limit);

        const alreadyBoundCoshh = new Set(
          (
            await ctx.db
              .select({ id: ramsPackCoshh.coshhAssessmentId })
              .from(ramsPackCoshh)
              .where(
                and(
                  eq(ramsPackCoshh.tenantId, ctx.tenantId),
                  eq(ramsPackCoshh.packId, pack.id),
                ),
              )
          ).map((r) => r.id),
        );

        const coshhRows = await ctx.db
          .select({
            id: coshhAssessments.id,
            taskDescription: coshhAssessments.taskDescription,
            referenceNumber: coshhAssessments.referenceNumber,
            substanceId: coshhAssessments.substanceId,
            substanceName: coshhSubstances.name,
          })
          .from(coshhAssessments)
          .leftJoin(coshhSubstances, eq(coshhSubstances.id, coshhAssessments.substanceId))
          .where(eq(coshhAssessments.tenantId, ctx.tenantId))
          .limit(300);

        const coshhSuggestions = coshhRows
          .filter((r) => !alreadyBoundCoshh.has(r.id))
          .map((r) => ({
            ...r,
            score: overlapScore(
              jobTokens,
              tokenise(`${r.taskDescription} ${r.substanceName ?? ''}`),
            ),
          }))
          .filter((r) => r.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, input.limit);

        return { riskAssessments: raSuggestions, coshh: coshhSuggestions };
      }),

    /**
     * Issue (or re-issue) the pack. Freezes a version, stamps the
     * attestation, and — on re-issue — marks the previous version
     * superseded so its briefings stop counting as current (RS-E08).
     */
    issue: tenantProcedure
      .use(requirePermission('rams.issue'))
      .input(
        z.object({
          packId: id26,
          /** Must be true — the attestation is shown in full before signing. */
          confirmAttestation: z.boolean(),
          /** Optional note explaining a re-issue. */
          reissueNote: z.string().trim().max(1000).default(''),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const pack = await loadPack(ctx.db, ctx.tenantId, input.packId);
        if (!canTransitionPack(pack.status, 'issued')) {
          throw new TRPCError({ code: 'CONFLICT', message: 'illegal-transition' });
        }

        const { versions: boundRas, allPublished } = await loadBoundRaVersions(
          ctx.db,
          ctx.tenantId,
          pack.id,
        );
        const gate = evaluateIssueGate({
          content: pack.draftContent,
          raVersions: boundRas,
          allRaVersionsPublished: allPublished,
          attestationConfirmed: input.confirmAttestation,
        });
        if (gate.errors.length > 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            // The first slug is the headline; the full list travels in
            // the cause so the builder can render the whole checklist.
            message: gate.errors[0] ?? 'issue-gate-failed',
            cause: { errors: gate.errors, unreferenced: gate.unreferenced },
          });
        }

        const at = now();
        const versionNumber = pack.currentVersion + 1;
        const authorName = await displayName(ctx.db, ctx.tenantId, ctx.auth.userId);

        const [site] =
          pack.siteId === null
            ? []
            : await ctx.db
                .select({ name: sites.name })
                .from(sites)
                .where(and(eq(sites.tenantId, ctx.tenantId), eq(sites.id, pack.siteId)))
                .limit(1);

        // Pin the method-statement version, if the pack draws from one.
        let msVersionId: string | null = null;
        let msVersionNumber: number | null = null;
        let msTitle = '';
        if (pack.methodStatementId !== null) {
          const msRows = await ctx.db
            .select({
              id: methodStatements.id,
              title: methodStatements.title,
              currentVersion: methodStatements.currentVersion,
            })
            .from(methodStatements)
            .where(
              and(
                eq(methodStatements.tenantId, ctx.tenantId),
                eq(methodStatements.id, pack.methodStatementId),
              ),
            )
            .limit(1);
          const ms = msRows[0];
          if (ms !== undefined) {
            msTitle = ms.title;
            msVersionNumber = ms.currentVersion > 0 ? ms.currentVersion : null;
            if (msVersionNumber !== null) {
              const vRows = await ctx.db
                .select({ id: methodStatementVersions.id })
                .from(methodStatementVersions)
                .where(
                  and(
                    eq(methodStatementVersions.tenantId, ctx.tenantId),
                    eq(methodStatementVersions.methodStatementId, ms.id),
                    eq(methodStatementVersions.versionNumber, msVersionNumber),
                  ),
                )
                .limit(1);
              msVersionId = vRows[0]?.id ?? null;
            }
          }
        }

        const coshhRows = await ctx.db
          .select({
            assessmentId: coshhAssessments.id,
            substanceId: ramsPackCoshh.substanceId,
            substanceName: coshhSubstances.name,
            referenceNumber: coshhAssessments.referenceNumber,
            taskDescription: coshhAssessments.taskDescription,
          })
          .from(ramsPackCoshh)
          .innerJoin(coshhAssessments, eq(coshhAssessments.id, ramsPackCoshh.coshhAssessmentId))
          .leftJoin(coshhSubstances, eq(coshhSubstances.id, ramsPackCoshh.substanceId))
          .where(and(eq(ramsPackCoshh.tenantId, ctx.tenantId), eq(ramsPackCoshh.packId, pack.id)))
          .orderBy(asc(ramsPackCoshh.sortOrder));

        const docRows = await ctx.db
          .select()
          .from(ramsPackDocuments)
          .where(
            and(
              eq(ramsPackDocuments.tenantId, ctx.tenantId),
              eq(ramsPackDocuments.packId, pack.id),
            ),
          )
          .orderBy(asc(ramsPackDocuments.sortOrder));

        const coshhSnapshot: PackVersionCoshh[] = coshhRows.map((c) => ({
          assessmentId: c.assessmentId,
          substanceId: c.substanceId ?? '',
          substanceName: c.substanceName ?? '',
          referenceNumber: c.referenceNumber,
          taskDescription: c.taskDescription,
          sdsReference: c.referenceNumber ?? '',
        }));

        const documentsSnapshot: PackVersionDocument[] = docRows.map((d) => ({
          id: d.id,
          kind: d.kind,
          title: d.title,
          documentId: d.documentId,
          storageKey: d.storageKey,
          filename: d.filename,
        }));

        const content: RamsPackVersionContent = {
          jobContext: {
            title: pack.title,
            clientName: pack.clientName,
            siteId: pack.siteId,
            siteName: site?.name ?? null,
            locationText: pack.locationText,
            plannedFrom: pack.plannedFrom?.toISOString() ?? null,
            plannedTo: pack.plannedTo?.toISOString() ?? null,
            authorName,
            supervisorName: pack.supervisorName,
          },
          methodStatementId: pack.methodStatementId,
          methodStatementVersionId: msVersionId,
          methodStatementVersionNumber: msVersionNumber,
          methodStatementTitle: msTitle,
          content: pack.draftContent,
          riskAssessments: boundRas.map(summariseRaVersion),
          coshh: coshhSnapshot,
          documents: documentsSnapshot,
        };

        const packVersionId = newId();
        await ctx.db.insert(ramsPackVersions).values({
          id: packVersionId,
          tenantId: ctx.tenantId,
          packId: pack.id,
          versionNumber,
          content,
          issuedBy: ctx.auth.userId,
          issuedByName: authorName,
          issuedAt: at,
          attestationText: RAMS_AUTHOR_ATTESTATION,
        });

        // Re-issue: the previous version is superseded. Its briefings
        // stay readable but stop matching the current version, which is
        // exactly the "everyone is briefed again" behaviour.
        if (pack.currentVersion > 0) {
          await ctx.db
            .update(ramsPackVersions)
            .set({ supersededAt: at })
            .where(
              and(
                eq(ramsPackVersions.tenantId, ctx.tenantId),
                eq(ramsPackVersions.packId, pack.id),
                eq(ramsPackVersions.versionNumber, pack.currentVersion),
              ),
            );
        }

        await ctx.db
          .update(ramsPacks)
          .set({
            status: 'issued',
            currentVersion: versionNumber,
            issuedAt: at,
            authorUserId: ctx.auth.userId,
            updatedAt: at,
          })
          .where(and(eq(ramsPacks.tenantId, ctx.tenantId), eq(ramsPacks.id, pack.id)));

        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          actorUserId: ctx.auth.userId,
          kind: versionNumber === 1 ? 'pack_issued' : 'pack_reissued',
          packId: pack.id,
          detail: input.reissueNote,
          payload: { versionNumber, packVersionId },
        });

        return { packVersionId, versionNumber };
      }),

    withdraw: tenantProcedure
      .use(requirePermission('rams.issue'))
      .input(z.object({ packId: id26, reason: z.string().trim().min(1).max(1000) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const pack = await loadPack(ctx.db, ctx.tenantId, input.packId);
        if (!canTransitionPack(pack.status, 'withdrawn')) {
          throw new TRPCError({ code: 'CONFLICT', message: 'illegal-transition' });
        }
        const at = now();
        await ctx.db
          .update(ramsPacks)
          .set({
            status: 'withdrawn',
            withdrawnAt: at,
            withdrawnBy: ctx.auth.userId,
            withdrawnReason: input.reason,
            updatedAt: at,
          })
          .where(and(eq(ramsPacks.tenantId, ctx.tenantId), eq(ramsPacks.id, pack.id)));
        // A withdrawn pack must stop being accepted by a client too.
        await ctx.db
          .update(ramsClientLinks)
          .set({ revokedAt: at, revokedBy: ctx.auth.userId })
          .where(
            and(
              eq(ramsClientLinks.tenantId, ctx.tenantId),
              eq(ramsClientLinks.packId, pack.id),
              isNull(ramsClientLinks.revokedAt),
            ),
          );
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          actorUserId: ctx.auth.userId,
          kind: 'pack_withdrawn',
          packId: pack.id,
          detail: input.reason,
        });
        return { ok: true as const };
      }),

    cancel: tenantProcedure
      .use(requirePermission('rams.create'))
      .input(z.object({ packId: id26, reason: z.string().trim().min(1).max(1000) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const pack = await loadPack(ctx.db, ctx.tenantId, input.packId);
        if (!canTransitionPack(pack.status, 'cancelled')) {
          throw new TRPCError({ code: 'CONFLICT', message: 'illegal-transition' });
        }
        const at = now();
        await ctx.db
          .update(ramsPacks)
          .set({
            status: 'cancelled',
            cancelledAt: at,
            cancelledReason: input.reason,
            updatedAt: at,
          })
          .where(and(eq(ramsPacks.tenantId, ctx.tenantId), eq(ramsPacks.id, pack.id)));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          actorUserId: ctx.auth.userId,
          kind: 'pack_cancelled',
          packId: pack.id,
          detail: input.reason,
        });
        return { ok: true as const };
      }),

    renderPdf: tenantProcedure
      .use(requirePermission('rams.view'))
      .input(z.object({ packId: id26, packVersionId: id26.optional() }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        if (deps.renderPdf === undefined) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'render-not-wired' });
        }
        const pack = await loadPack(ctx.db, ctx.tenantId, input.packId);
        let packVersionId = input.packVersionId;
        if (packVersionId === undefined) {
          const rows = await ctx.db
            .select({ id: ramsPackVersions.id })
            .from(ramsPackVersions)
            .where(
              and(
                eq(ramsPackVersions.tenantId, ctx.tenantId),
                eq(ramsPackVersions.packId, pack.id),
                eq(ramsPackVersions.versionNumber, pack.currentVersion),
              ),
            )
            .limit(1);
          packVersionId = rows[0]?.id;
        }
        if (packVersionId === undefined) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'pack-not-issued' });
        }
        return deps.renderPdf({ tenantId: ctx.tenantId, packId: pack.id, packVersionId });
      }),
  });

  // ─── Briefings ────────────────────────────────────────────────────────────

  const briefingsRouter = router({
    /**
     * What the brief screen needs in one call: the version to brief, the
     * steps (with hold points), and who has already signed.
     */
    forPack: tenantProcedure
      .use(requirePermission('rams.view'))
      .input(z.object({ packId: id26 }))
      .query(async ({ ctx, input }) => {
        assertEnabled();
        const pack = await loadPack(ctx.db, ctx.tenantId, input.packId);
        const versionRows = await ctx.db
          .select()
          .from(ramsPackVersions)
          .where(
            and(
              eq(ramsPackVersions.tenantId, ctx.tenantId),
              eq(ramsPackVersions.packId, pack.id),
              eq(ramsPackVersions.versionNumber, pack.currentVersion),
            ),
          )
          .limit(1);
        const current = versionRows[0] ?? null;
        const briefings = await ctx.db
          .select()
          .from(ramsBriefings)
          .where(and(eq(ramsBriefings.tenantId, ctx.tenantId), eq(ramsBriefings.packId, pack.id)))
          .orderBy(desc(ramsBriefings.briefedAt));
        return {
          pack,
          currentVersion: current,
          briefings: briefings.map((b) => ({
            ...b,
            current: b.versionNumber === pack.currentVersion,
          })),
          briefedOnCurrent: briefings.filter((b) => b.versionNumber === pack.currentVersion).length,
          briefedOnSuperseded: briefings.filter((b) => b.versionNumber !== pack.currentVersion)
            .length,
        };
      }),

    /**
     * Record one or more briefings in a single call — a tailgate talk is
     * one session with several signatures, passing the phone around. The
     * batch shape is also what makes the offline queue replayable.
     *
     * Append-only: there is no update or delete surface (RS-E09).
     */
    record: tenantProcedure
      .use(requirePermission('rams.brief'))
      .input(
        z.object({
          packId: id26,
          entries: z
            .array(
              z.object({
                kind: z.enum(BRIEFEE_KINDS).default('user'),
                userId: z.string().max(64).optional(),
                name: z.string().trim().min(1).max(200),
                category: z.enum(BRIEFEE_CATEGORIES).default('employee'),
                organisation: z.string().trim().max(200).default(''),
                signatureData: z.string().max(500_000).optional(),
                questionsNote: z.string().trim().max(2000).default(''),
                /** Client-supplied so an offline replay is idempotent. */
                clientRef: z.string().max(64).optional(),
              }),
            )
            .min(1)
            .max(50),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const pack = await loadPack(ctx.db, ctx.tenantId, input.packId);
        if (pack.status !== 'issued') {
          throw new TRPCError({ code: 'CONFLICT', message: 'pack-not-issued' });
        }
        const versionRows = await ctx.db
          .select({ id: ramsPackVersions.id, versionNumber: ramsPackVersions.versionNumber })
          .from(ramsPackVersions)
          .where(
            and(
              eq(ramsPackVersions.tenantId, ctx.tenantId),
              eq(ramsPackVersions.packId, pack.id),
              eq(ramsPackVersions.versionNumber, pack.currentVersion),
            ),
          )
          .limit(1);
        const version = versionRows[0];
        if (version === undefined) {
          throw new TRPCError({ code: 'CONFLICT', message: 'pack-not-issued' });
        }

        const briefedByName = await displayName(ctx.db, ctx.tenantId, ctx.auth.userId);
        const created: string[] = [];

        for (const entry of input.entries) {
          // A briefee with an account must be in OUR tenant (RS-E10).
          if (entry.kind === 'user') {
            if (entry.userId === undefined) {
              throw new TRPCError({ code: 'BAD_REQUEST', message: 'briefee-user-required' });
            }
            const rows = await ctx.db
              .select({ id: user.id })
              .from(user)
              .where(and(eq(user.tenantId, ctx.tenantId), eq(user.id, entry.userId)))
              .limit(1);
            if (rows[0] === undefined) {
              throw new TRPCError({ code: 'NOT_FOUND', message: 'briefee-not-found' });
            }
          }

          const id = newId();
          await ctx.db.insert(ramsBriefings).values({
            id,
            tenantId: ctx.tenantId,
            packId: pack.id,
            packVersionId: version.id,
            versionNumber: version.versionNumber,
            briefeeKind: entry.kind,
            briefeeUserId: entry.kind === 'user' ? (entry.userId ?? null) : null,
            briefeeName: entry.name,
            briefeeCategory: entry.category,
            briefeeOrganisation: entry.organisation,
            briefedBy: ctx.auth.userId,
            briefedByName,
            briefedAt: now(),
            signatureData: entry.signatureData ?? null,
            questionsNote: entry.questionsNote,
          });
          created.push(id);
        }

        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          actorUserId: ctx.auth.userId,
          kind: 'briefing_recorded',
          packId: pack.id,
          detail: `${created.length}`,
          payload: { versionNumber: version.versionNumber, count: created.length },
        });

        return { briefingIds: created, versionNumber: version.versionNumber };
      }),
  });

  // ─── Client issue & acceptance ────────────────────────────────────────────

  const clientRouter = router({
    createLink: tenantProcedure
      .use(requirePermission('rams.issue'))
      .input(
        z.object({
          packId: id26,
          issuedToName: z.string().trim().max(200).default(''),
          issuedToEmail: z.string().email().max(320).optional(),
          expiresInDays: z.number().int().min(1).max(365).default(90),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        if (deps.generateShareToken === undefined || deps.buildShareUrl === undefined) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'share-not-wired' });
        }
        const pack = await loadPack(ctx.db, ctx.tenantId, input.packId);
        if (pack.status !== 'issued') {
          throw new TRPCError({ code: 'CONFLICT', message: 'pack-not-issued' });
        }
        const versionRows = await ctx.db
          .select({ id: ramsPackVersions.id, versionNumber: ramsPackVersions.versionNumber })
          .from(ramsPackVersions)
          .where(
            and(
              eq(ramsPackVersions.tenantId, ctx.tenantId),
              eq(ramsPackVersions.packId, pack.id),
              eq(ramsPackVersions.versionNumber, pack.currentVersion),
            ),
          )
          .limit(1);
        const version = versionRows[0];
        if (version === undefined) {
          throw new TRPCError({ code: 'CONFLICT', message: 'pack-not-issued' });
        }

        const token = deps.generateShareToken();
        const at = now();
        const id = newId();
        await ctx.db.insert(ramsClientLinks).values({
          id,
          tenantId: ctx.tenantId,
          packId: pack.id,
          packVersionId: version.id,
          versionNumber: version.versionNumber,
          token,
          issuedToName: input.issuedToName,
          issuedToEmail: input.issuedToEmail ?? null,
          issuedBy: ctx.auth.userId,
          expiresAt: new Date(at.getTime() + input.expiresInDays * 86_400_000),
        });
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          actorUserId: ctx.auth.userId,
          kind: 'client_link_created',
          packId: pack.id,
          detail: input.issuedToName,
          payload: { versionNumber: version.versionNumber },
        });
        return { linkId: id, token, url: deps.buildShareUrl(token) };
      }),

    revokeLink: tenantProcedure
      .use(requirePermission('rams.issue'))
      .input(z.object({ linkId: id26 }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const rows = await ctx.db
          .select({ id: ramsClientLinks.id, packId: ramsClientLinks.packId })
          .from(ramsClientLinks)
          .where(
            and(eq(ramsClientLinks.tenantId, ctx.tenantId), eq(ramsClientLinks.id, input.linkId)),
          )
          .limit(1);
        const link = rows[0];
        if (link === undefined) throw new TRPCError({ code: 'NOT_FOUND', message: 'link-not-found' });
        await ctx.db
          .update(ramsClientLinks)
          .set({ revokedAt: now(), revokedBy: ctx.auth.userId })
          .where(
            and(eq(ramsClientLinks.tenantId, ctx.tenantId), eq(ramsClientLinks.id, input.linkId)),
          );
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          actorUserId: ctx.auth.userId,
          kind: 'client_link_revoked',
          packId: link.packId,
        });
        return { ok: true as const };
      }),

    /**
     * Public read by token — no session. Revoked / expired tokens are
     * refused (RS-E12), and the response carries only the frozen version
     * content, never the mutable pack row.
     */
    publicGet: publicProcedure
      .input(z.object({ token: z.string().min(10).max(200) }))
      .query(async ({ ctx, input }) => {
        assertEnabled();
        const rows = await ctx.db
          .select({
            linkId: ramsClientLinks.id,
            tenantId: ramsClientLinks.tenantId,
            packId: ramsClientLinks.packId,
            versionNumber: ramsClientLinks.versionNumber,
            expiresAt: ramsClientLinks.expiresAt,
            revokedAt: ramsClientLinks.revokedAt,
            decision: ramsClientLinks.decision,
            decidedAt: ramsClientLinks.decidedAt,
            acceptedByName: ramsClientLinks.acceptedByName,
            acceptedByOrganisation: ramsClientLinks.acceptedByOrganisation,
            decisionComment: ramsClientLinks.decisionComment,
            issuedToName: ramsClientLinks.issuedToName,
            content: ramsPackVersions.content,
            issuedAt: ramsPackVersions.issuedAt,
            issuedByName: ramsPackVersions.issuedByName,
            attestationText: ramsPackVersions.attestationText,
            referenceNumber: ramsPacks.referenceNumber,
            packStatus: ramsPacks.status,
          })
          .from(ramsClientLinks)
          .innerJoin(ramsPackVersions, eq(ramsPackVersions.id, ramsClientLinks.packVersionId))
          .innerJoin(ramsPacks, eq(ramsPacks.id, ramsClientLinks.packId))
          .where(eq(ramsClientLinks.token, input.token))
          .limit(1);
        const link = rows[0];
        if (link === undefined) throw new TRPCError({ code: 'NOT_FOUND', message: 'link-invalid' });
        if (link.revokedAt !== null)
          throw new TRPCError({ code: 'FORBIDDEN', message: 'link-revoked' });
        if (link.expiresAt !== null && link.expiresAt.getTime() < now().getTime()) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'link-expired' });
        }
        return link;
      }),

    /** The client's decision — accept, or request changes. */
    publicDecide: publicProcedure
      .input(
        z.object({
          token: z.string().min(10).max(200),
          decision: z.enum(['accepted', 'changes_requested']),
          acceptedByName: z.string().trim().min(1).max(200),
          acceptedByOrganisation: z.string().trim().max(200).default(''),
          comment: z.string().trim().max(2000).default(''),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const rows = await ctx.db
          .select({
            id: ramsClientLinks.id,
            tenantId: ramsClientLinks.tenantId,
            packId: ramsClientLinks.packId,
            versionNumber: ramsClientLinks.versionNumber,
            expiresAt: ramsClientLinks.expiresAt,
            revokedAt: ramsClientLinks.revokedAt,
          })
          .from(ramsClientLinks)
          .where(eq(ramsClientLinks.token, input.token))
          .limit(1);
        const link = rows[0];
        if (link === undefined) throw new TRPCError({ code: 'NOT_FOUND', message: 'link-invalid' });
        if (link.revokedAt !== null)
          throw new TRPCError({ code: 'FORBIDDEN', message: 'link-revoked' });
        const at = now();
        if (link.expiresAt !== null && link.expiresAt.getTime() < at.getTime()) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'link-expired' });
        }

        await ctx.db
          .update(ramsClientLinks)
          .set({
            decision: input.decision,
            decidedAt: at,
            acceptedByName: input.acceptedByName,
            acceptedByOrganisation: input.acceptedByOrganisation,
            decisionComment: input.comment,
          })
          .where(eq(ramsClientLinks.id, link.id));

        await logEvent(ctx.db, {
          tenantId: link.tenantId,
          actorUserId: 'public',
          kind: input.decision === 'accepted' ? 'client_accepted' : 'client_changes_requested',
          packId: link.packId,
          detail: input.acceptedByName,
          payload: {
            versionNumber: link.versionNumber,
            organisation: input.acceptedByOrganisation,
            comment: input.comment,
          },
        });

        return { ok: true as const };
      }),
  });

  // ─── Third-party review (§9 — the receive side) ───────────────────────────

  const reviewsRouter = router({
    list: tenantProcedure
      .use(requirePermission('rams.view'))
      .input(
        z
          .object({
            outcome: z.enum(REVIEW_OUTCOMES).optional(),
            contractorId: id26.optional(),
            limit: z.number().int().min(1).max(200).default(50),
          })
          .default({}),
      )
      .query(async ({ ctx, input }) => {
        assertEnabled();
        const where = [eq(ramsReviews.tenantId, ctx.tenantId)];
        if (input.outcome !== undefined) where.push(eq(ramsReviews.outcome, input.outcome));
        if (input.contractorId !== undefined)
          where.push(eq(ramsReviews.contractorId, input.contractorId));
        const rows = await ctx.db
          .select({
            id: ramsReviews.id,
            title: ramsReviews.title,
            outcome: ramsReviews.outcome,
            contractorId: ramsReviews.contractorId,
            contractorName: contractors.name,
            siteId: ramsReviews.siteId,
            validFrom: ramsReviews.validFrom,
            validTo: ramsReviews.validTo,
            reviewerUserId: ramsReviews.reviewerUserId,
            reviewedAt: ramsReviews.reviewedAt,
            createdAt: ramsReviews.createdAt,
          })
          .from(ramsReviews)
          .innerJoin(contractors, eq(contractors.id, ramsReviews.contractorId))
          .where(and(...where))
          .orderBy(desc(ramsReviews.createdAt))
          .limit(input.limit);
        const at = now();
        return rows.map((r) => ({
          ...r,
          valid: reviewAcceptanceValid(
            { outcome: r.outcome, validFrom: r.validFrom, validTo: r.validTo },
            at,
          ),
        }));
      }),

    get: tenantProcedure
      .use(requirePermission('rams.view'))
      .input(z.object({ reviewId: id26 }))
      .query(async ({ ctx, input }) => {
        assertEnabled();
        const rows = await ctx.db
          .select()
          .from(ramsReviews)
          .where(and(eq(ramsReviews.tenantId, ctx.tenantId), eq(ramsReviews.id, input.reviewId)))
          .limit(1);
        const review = rows[0];
        if (review === undefined)
          throw new TRPCError({ code: 'NOT_FOUND', message: 'review-not-found' });
        const events = await ctx.db
          .select()
          .from(ramsEvents)
          .where(and(eq(ramsEvents.tenantId, ctx.tenantId), eq(ramsEvents.reviewId, review.id)))
          .orderBy(desc(ramsEvents.createdAt));
        return {
          review,
          events,
          valid: reviewAcceptanceValid(review, now()),
        };
      }),

    /** Log a received pack for review — from the portal or by email. */
    submit: tenantProcedure
      .use(requirePermission('rams.review'))
      .input(
        z.object({
          contractorId: id26,
          contractorDocumentId: id26.optional(),
          title: z.string().trim().min(1).max(200),
          workDescription: z.string().trim().max(2000).default(''),
          siteId: id26.optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const contractorRows = await ctx.db
          .select({ id: contractors.id, name: contractors.name })
          .from(contractors)
          .where(
            and(eq(contractors.tenantId, ctx.tenantId), eq(contractors.id, input.contractorId)),
          )
          .limit(1);
        const contractor = contractorRows[0];
        if (contractor === undefined)
          throw new TRPCError({ code: 'NOT_FOUND', message: 'contractor-not-found' });

        if (input.contractorDocumentId !== undefined) {
          const docRows = await ctx.db
            .select({ id: contractorDocuments.id })
            .from(contractorDocuments)
            .where(
              and(
                eq(contractorDocuments.tenantId, ctx.tenantId),
                eq(contractorDocuments.id, input.contractorDocumentId),
              ),
            )
            .limit(1);
          if (docRows[0] === undefined)
            throw new TRPCError({ code: 'NOT_FOUND', message: 'contractor-document-not-found' });
        }

        const id = newId();
        await ctx.db.insert(ramsReviews).values({
          id,
          tenantId: ctx.tenantId,
          contractorId: contractor.id,
          contractorDocumentId: input.contractorDocumentId ?? null,
          title: input.title,
          workDescription: input.workDescription,
          siteId: input.siteId ?? null,
          outcome: 'pending',
          checklist: snapshotReviewChecklist(),
          submittedBy: ctx.auth.userId,
        });
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          actorUserId: ctx.auth.userId,
          kind: 'review_submitted',
          reviewId: id,
          detail: input.title,
        });
        return { reviewId: id };
      }),

    /**
     * Work the checklist and record the outcome. `accepted` is refused
     * while any item failed — `accepted_with_conditions` is the outlet,
     * and it requires the conditions to be written down.
     */
    decide: tenantProcedure
      .use(requirePermission('rams.review'))
      .input(
        z.object({
          reviewId: id26,
          checklist: z
            .array(
              z.object({
                id: z.string().min(1).max(60),
                verdict: z.enum(REVIEW_ITEM_VERDICTS),
                comment: z.string().trim().max(1000).default(''),
              }),
            )
            .max(40),
          outcome: z.enum(['accepted', 'accepted_with_conditions', 'rejected']),
          conditions: z.string().trim().max(2000).default(''),
          comments: z.string().trim().max(2000).default(''),
          validFrom: z.coerce.date().nullable().optional(),
          validTo: z.coerce.date().nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const rows = await ctx.db
          .select()
          .from(ramsReviews)
          .where(and(eq(ramsReviews.tenantId, ctx.tenantId), eq(ramsReviews.id, input.reviewId)))
          .limit(1);
        const review = rows[0];
        if (review === undefined)
          throw new TRPCError({ code: 'NOT_FOUND', message: 'review-not-found' });

        // Merge the submitted verdicts onto the stored checklist so the
        // labels stay the ones snapshotted at submit time.
        const byId = new Map(input.checklist.map((c) => [c.id, c]));
        const stored: ReviewChecklistEntry[] =
          review.checklist.length > 0 ? review.checklist : snapshotReviewChecklist();
        const merged: ReviewChecklistEntry[] = stored.map((entry) => {
          const submitted = byId.get(entry.id);
          if (submitted === undefined) return entry;
          return { ...entry, verdict: submitted.verdict, comment: submitted.comment };
        });

        if (input.outcome === 'accepted' && reviewHasFailures(merged)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'review-has-failures' });
        }
        if (input.outcome === 'accepted_with_conditions' && input.conditions.length === 0) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'conditions-required' });
        }
        if (input.outcome === 'rejected' && input.comments.length === 0) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'comments-required' });
        }
        if (
          input.validFrom !== undefined &&
          input.validFrom !== null &&
          input.validTo !== undefined &&
          input.validTo !== null &&
          input.validTo.getTime() <= input.validFrom.getTime()
        ) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'validity-window-invalid' });
        }

        const at = now();
        await ctx.db
          .update(ramsReviews)
          .set({
            checklist: merged,
            outcome: input.outcome,
            conditions: input.conditions,
            comments: input.comments,
            validFrom: input.validFrom ?? null,
            validTo: input.validTo ?? null,
            reviewerUserId: ctx.auth.userId,
            reviewedAt: at,
            updatedAt: at,
          })
          .where(and(eq(ramsReviews.tenantId, ctx.tenantId), eq(ramsReviews.id, review.id)));

        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          actorUserId: ctx.auth.userId,
          kind: 'review_decided',
          reviewId: review.id,
          detail: input.outcome,
          payload: {
            outcome: input.outcome,
            validFrom: input.validFrom?.toISOString() ?? null,
            validTo: input.validTo?.toISOString() ?? null,
          },
        });

        return { outcome: input.outcome };
      }),
  });

  return router({
    methodStatements: methodStatementsRouter,
    packs: packsRouter,
    briefings: briefingsRouter,
    client: clientRouter,
    reviews: reviewsRouter,
  });
}
