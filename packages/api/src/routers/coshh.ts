/**
 * COSHH router (FreeHS module B2) — Control of Substances Hazardous to
 * Health. A live inventory of every hazardous substance on site, its
 * assessment, its controls, and the exposure it creates.
 *
 * Design goals from the practitioner spec:
 *   - the inventory is maintainable by whoever receives the deliveries:
 *     adding a substance is one SDS upload (the AI reader pre-fills the
 *     hazard profile) plus a couple of confirmations;
 *   - the safety data sheet is versioned and carries a review-by date so
 *     stale sheets prompt instead of rotting (`sdsStatus` on every list row);
 *   - special regimes are structural: carcinogen / mutagen / asthmagen are
 *     inferred from H statements, biological agents / lead / asbestos-referral
 *     are explicit flags, and a CMR substance cannot publish an assessment
 *     while substitution is still `not_assessed` (substitution first);
 *   - hierarchy of control is enforced at publish: an assessment whose
 *     controls are RPE/PPE-only needs a justification on at least one;
 *   - `planned` controls generate actions at publish, exactly once;
 *   - exposure monitoring results snapshot their WEL comparison at record
 *     time (`exceedsWel`, null = not comparable — never a silent pass);
 *   - LEV thorough examination & test defaults to the statutory 14-month
 *     interval; a failed test takes the unit out of service;
 *   - storage incompatibility warnings are computed per site from the
 *     locations' storage classes;
 *   - every meaningful mutation appends to `coshh_events` — evidence, not
 *     state.
 *
 * Brand gating (ADR 0010): built with `{ enabled }` wired from the active
 * brand's module catalogue; every procedure refuses when disabled.
 *
 * Deliberate v1 gaps (documented, not accidental): no email digests for
 * due SDS reviews / LEV tests (the in-app overview + list badges carry the
 * prompts; a worker digest is scheduled with the notifications work), no
 * dependents-registry resolver (the registry's module union is closed —
 * same status as risk assessments), and AI endpoints live in the web app
 * (`/api/ai/coshh-*`), not in tRPC, so this router stays deterministic.
 */
import {
  actions,
  COSHH_ASSESSMENT_KINDS,
  COSHH_CONTROL_STATUSES,
  COSHH_CONTROL_TIERS,
  COSHH_EXPOSED_GROUP_PRESETS,
  COSHH_QUANTITY_UNITS,
  coshhAssessmentControls,
  coshhAssessments,
  coshhEvents,
  coshhExposureMonitoring,
  coshhHealthSurveillance,
  coshhLevTests,
  coshhLevUnits,
  coshhSdsDocuments,
  coshhSubstanceLocations,
  coshhSubstances,
  DURATION_BANDS,
  EXPOSURE_ROUTES,
  FREQUENCY_BANDS,
  LEV_STATUSES,
  LEV_TEST_RESULTS,
  QUANTITY_BANDS,
  SAMPLE_TYPES,
  sites,
  SUBSTITUTION_STATUSES,
  user,
  type CoshhEventEntityType,
  type CoshhEventKind,
  type CoshhSdsDocument,
} from '@forma360/db/schema';
import type { Database } from '@forma360/db/client';
import {
  DEFAULT_ASSESSMENT_REVIEW_MONTHS,
  DEFAULT_SDS_REVIEW_MONTHS,
  exceedsWel,
  GHS_PICTOGRAMS,
  hStatementSchema,
  inferRegimeFlags,
  MONITORING_PERIODS,
  PHYSICAL_FORMS,
  pStatementSchema,
  SIGNAL_WORDS,
  STATUTORY_LEV_TEST_INTERVAL_MONTHS,
  STORAGE_CLASSES,
  storageClassesConflict,
  substitutionPriority,
  WEL_UNITS,
  welSchema,
  type SubstitutionPriority,
} from '@forma360/shared/coshh';
import { newId } from '@forma360/shared/id';
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { nextReferenceValue } from '../reference-counter';
import { requirePermission, tenantProcedure } from '../procedures';
import { router } from '../trpc';

export interface CoshhRouterDeps {
  /** Wired from the brand module catalogue (ADR 0010). */
  enabled: boolean;
}

export type SdsStatus = 'missing' | 'review_due' | 'current';

/** Derive the SDS prompt state from the current sheet (or its absence). */
function sdsStatusFor(current: CoshhSdsDocument | undefined, now: Date): SdsStatus {
  if (current === undefined) return 'missing';
  if (current.reviewByDate !== null && current.reviewByDate <= now) return 'review_due';
  return 'current';
}

function addMonths(base: Date, months: number): Date {
  const out = new Date(base);
  out.setMonth(out.getMonth() + months);
  return out;
}

/** Load a substance scoped to the tenant or throw NOT_FOUND. */
async function loadSubstance(db: Database, tenantId: string, substanceId: string) {
  const rows = await db
    .select()
    .from(coshhSubstances)
    .where(and(eq(coshhSubstances.id, substanceId), eq(coshhSubstances.tenantId, tenantId)))
    .limit(1);
  const substance = rows[0];
  if (substance === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
  return substance;
}

/** Load an assessment scoped to the tenant or throw NOT_FOUND. */
async function loadAssessment(db: Database, tenantId: string, assessmentId: string) {
  const rows = await db
    .select()
    .from(coshhAssessments)
    .where(and(eq(coshhAssessments.id, assessmentId), eq(coshhAssessments.tenantId, tenantId)))
    .limit(1);
  const assessment = rows[0];
  if (assessment === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
  return assessment;
}

/** Load a LEV unit scoped to the tenant or throw NOT_FOUND. */
async function loadLevUnit(db: Database, tenantId: string, levUnitId: string) {
  const rows = await db
    .select()
    .from(coshhLevUnits)
    .where(and(eq(coshhLevUnits.id, levUnitId), eq(coshhLevUnits.tenantId, tenantId)))
    .limit(1);
  const unit = rows[0];
  if (unit === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
  return unit;
}

/**
 * Load a site scoped to the tenant or throw. The FK alone only proves the
 * site exists — this is what stops a crafted request linking a location to
 * another tenant's site.
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

/** Bump the parent substance's updatedAt. */
async function touchSubstance(db: Database, substanceId: string): Promise<void> {
  await db
    .update(coshhSubstances)
    .set({ updatedAt: new Date() })
    .where(eq(coshhSubstances.id, substanceId));
}

/** Append one immutable change-log row. Never updated or deleted. */
async function logEvent(
  db: Database,
  entry: {
    tenantId: string;
    entityType: CoshhEventEntityType;
    entityId: string;
    actorUserId: string;
    kind: CoshhEventKind;
    detail?: string;
  },
): Promise<void> {
  await db.insert(coshhEvents).values({
    id: newId(),
    tenantId: entry.tenantId,
    entityType: entry.entityType,
    entityId: entry.entityId,
    actorUserId: entry.actorUserId,
    kind: entry.kind,
    detail: entry.detail ?? '',
  });
}

const locationInput = z.object({
  siteId: z.string().length(26).optional(),
  locationText: z.string().max(500).default(''),
  quantity: z.number().positive().nullable().optional(),
  unit: z.enum(COSHH_QUANTITY_UNITS).nullable().optional(),
  storageClass: z.enum(STORAGE_CLASSES).nullable().optional(),
  storageNotes: z.string().max(1000).default(''),
});

const sdsFileInput = z.object({
  storageKey: z.string().min(1).max(500),
  filename: z.string().min(1).max(300),
  mimeType: z.string().min(1).max(100),
  sizeBytes: z.number().int().positive(),
  issueDate: z.coerce.date().nullable().optional(),
  /** AI extraction snapshot, already validated by sdsExtractionSchema shape. */
  extraction: z.unknown().optional(),
});

const substanceCreateInput = z.object({
  name: z.string().min(1).max(300),
  supplier: z.string().max(300).default(''),
  productIdentifier: z.string().max(200).default(''),
  physicalForm: z.enum(PHYSICAL_FORMS).nullable().optional(),
  usageDescription: z.string().max(2000).default(''),
  signalWord: z.enum(SIGNAL_WORDS).nullable().optional(),
  hazardClassification: z.array(z.string().min(1).max(120)).max(30).default([]),
  hStatements: z.array(hStatementSchema).max(40).default([]),
  pStatements: z.array(pStatementSchema).max(60).default([]),
  pictograms: z.array(z.enum(GHS_PICTOGRAMS)).max(9).default([]),
  workplaceExposureLimits: z.array(welSchema).max(20).default([]),
  isBiologicalAgent: z.boolean().default(false),
  containsLead: z.boolean().default(false),
  asbestosReferral: z.boolean().default(false),
  sdsReviewMonths: z.number().int().min(6).max(120).default(DEFAULT_SDS_REVIEW_MONTHS),
  /** Skip the case-insensitive duplicate-name guard (CO-E10). */
  allowDuplicate: z.boolean().default(false),
  initialLocation: locationInput.optional(),
  initialSds: sdsFileInput.optional(),
});

const substanceUpdateInput = z.object({
  substanceId: z.string().length(26),
  name: z.string().min(1).max(300).optional(),
  supplier: z.string().max(300).optional(),
  productIdentifier: z.string().max(200).optional(),
  physicalForm: z.enum(PHYSICAL_FORMS).nullable().optional(),
  usageDescription: z.string().max(2000).optional(),
  signalWord: z.enum(SIGNAL_WORDS).nullable().optional(),
  hazardClassification: z.array(z.string().min(1).max(120)).max(30).optional(),
  hStatements: z.array(hStatementSchema).max(40).optional(),
  pStatements: z.array(pStatementSchema).max(60).optional(),
  pictograms: z.array(z.enum(GHS_PICTOGRAMS)).max(9).optional(),
  workplaceExposureLimits: z.array(welSchema).max(20).optional(),
  isCarcinogen: z.boolean().optional(),
  isMutagen: z.boolean().optional(),
  isAsthmagen: z.boolean().optional(),
  isBiologicalAgent: z.boolean().optional(),
  containsLead: z.boolean().optional(),
  asbestosReferral: z.boolean().optional(),
  sdsReviewMonths: z.number().int().min(6).max(120).optional(),
});

const assessmentUpdateInput = z.object({
  assessmentId: z.string().length(26),
  taskDescription: z.string().min(1).max(2000).optional(),
  routesOfExposure: z.array(z.enum(EXPOSURE_ROUTES)).max(5).optional(),
  personsExposed: z.array(z.string().min(1).max(100)).max(20).optional(),
  personsCount: z.number().int().min(0).max(100000).nullable().optional(),
  quantityBand: z.enum(QUANTITY_BANDS).nullable().optional(),
  frequencyBand: z.enum(FREQUENCY_BANDS).nullable().optional(),
  durationBand: z.enum(DURATION_BANDS).nullable().optional(),
  levRequired: z.boolean().optional(),
  healthSurveillanceRequired: z.boolean().optional(),
  exposureMonitoringRequired: z.boolean().optional(),
  emergencyNotes: z.string().max(4000).optional(),
  plainSummary: z.string().max(8000).optional(),
  assessorUserId: z.string().nullable().optional(),
  reviewFrequencyMonths: z.number().int().min(1).max(60).nullable().optional(),
  nextReviewAt: z.coerce.date().nullable().optional(),
});

const controlInput = z.object({
  assessmentId: z.string().length(26),
  tier: z.enum(COSHH_CONTROL_TIERS),
  description: z.string().min(1).max(1000),
  status: z.enum(COSHH_CONTROL_STATUSES).default('in_place'),
  ppeJustification: z.string().max(1000).nullable().optional(),
  // RPE detail (C-8): respirator type, assigned protection factor, and
  // when the wearer's face-fit was last confirmed. Meaningful for
  // tier='rpe'; stored as given.
  rpeType: z.string().max(200).nullable().optional(),
  rpeApf: z.number().int().min(1).max(10_000).nullable().optional(),
  faceFitConfirmedAt: z.coerce.date().nullable().optional(),
});

export function createCoshhRouter(deps: CoshhRouterDeps) {
  function assertEnabled(): void {
    if (!deps.enabled) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'module-disabled' });
    }
  }

  const substances = router({
    list: tenantProcedure
      .use(requirePermission('coshh.view'))
      .input(
        z
          .object({
            status: z.enum(['active', 'archived', 'all']).default('active'),
            siteId: z.string().length(26).optional(),
            search: z.string().max(200).optional(),
          })
          .default({ status: 'active' }),
      )
      .query(async ({ ctx, input }) => {
        assertEnabled();
        const conditions = [eq(coshhSubstances.tenantId, ctx.tenantId)];
        if (input.status !== 'all') {
          conditions.push(eq(coshhSubstances.status, input.status));
        }
        if (input.search !== undefined && input.search.trim().length > 0) {
          conditions.push(
            sql`lower(${coshhSubstances.name}) like ${`%${input.search.trim().toLowerCase()}%`}`,
          );
        }
        if (input.siteId !== undefined) {
          const atSite = await ctx.db
            .select({ substanceId: coshhSubstanceLocations.substanceId })
            .from(coshhSubstanceLocations)
            .where(
              and(
                eq(coshhSubstanceLocations.tenantId, ctx.tenantId),
                eq(coshhSubstanceLocations.siteId, input.siteId),
              ),
            );
          const ids = [...new Set(atSite.map((r) => r.substanceId))];
          if (ids.length === 0) return [];
          conditions.push(inArray(coshhSubstances.id, ids));
        }

        const rows = await ctx.db
          .select()
          .from(coshhSubstances)
          .where(and(...conditions))
          .orderBy(desc(coshhSubstances.updatedAt));
        const ids = rows.map((r) => r.id);
        if (ids.length === 0) return [];

        const [locationRows, sdsRows, assessmentRows, exceedRows, surveillanceDueRows] =
          await Promise.all([
            ctx.db
              .select({
                substanceId: coshhSubstanceLocations.substanceId,
                siteId: coshhSubstanceLocations.siteId,
              })
              .from(coshhSubstanceLocations)
              .where(inArray(coshhSubstanceLocations.substanceId, ids)),
            ctx.db
              .select()
              .from(coshhSdsDocuments)
              .where(
                and(
                  inArray(coshhSdsDocuments.substanceId, ids),
                  eq(coshhSdsDocuments.isCurrent, true),
                ),
              ),
            ctx.db
              .select({
                substanceId: coshhAssessments.substanceId,
                status: coshhAssessments.status,
                nextReviewAt: coshhAssessments.nextReviewAt,
              })
              .from(coshhAssessments)
              .where(inArray(coshhAssessments.substanceId, ids)),
            ctx.db
              .select({ substanceId: coshhExposureMonitoring.substanceId })
              .from(coshhExposureMonitoring)
              .where(
                and(
                  inArray(coshhExposureMonitoring.substanceId, ids),
                  eq(coshhExposureMonitoring.exceedsWel, true),
                ),
              ),
            ctx.db
              .select({ substanceId: coshhHealthSurveillance.substanceId })
              .from(coshhHealthSurveillance)
              .where(
                and(
                  inArray(coshhHealthSurveillance.substanceId, ids),
                  isNull(coshhHealthSurveillance.endedAt),
                  lte(coshhHealthSurveillance.nextDueAt, new Date()),
                ),
              ),
          ]);

        const siteNames = await siteNamesById(
          ctx.db,
          ctx.tenantId,
          locationRows.map((l) => l.siteId).filter((v): v is string => v !== null),
        );

        const now = new Date();
        return rows.map((r) => {
          const locations = locationRows.filter((l) => l.substanceId === r.id);
          const currentSds = sdsRows.find((d) => d.substanceId === r.id);
          const rowAssessments = assessmentRows.filter((a) => a.substanceId === r.id);
          const active = rowAssessments.filter((a) => a.status === 'active');
          const flags = {
            carcinogen: r.isCarcinogen,
            mutagen: r.isMutagen,
            asthmagen: r.isAsthmagen,
          };
          return {
            ...r,
            locationCount: locations.length,
            siteNames: [
              ...new Set(
                locations
                  .map((l) => (l.siteId !== null ? siteNames.get(l.siteId) : null))
                  .filter((v): v is string => v !== null && v !== undefined),
              ),
            ],
            sdsStatus: sdsStatusFor(currentSds, now),
            assessmentCount: rowAssessments.length,
            activeAssessmentCount: active.length,
            assessmentReviewDue: active.some(
              (a) => a.nextReviewAt !== null && a.nextReviewAt <= now,
            ),
            hasWelExceedance: exceedRows.some((e) => e.substanceId === r.id),
            surveillanceDue: surveillanceDueRows.some((s) => s.substanceId === r.id),
            substitutionPriority: substitutionPriority(
              flags,
              r.hStatements.map((h) => h.code),
            ) satisfies SubstitutionPriority,
          };
        });
      }),

    /**
     * Distinct suppliers this tenant has already recorded, most-used
     * first — feeds the supplier autocomplete on the add-substance form.
     */
    supplierSuggestions: tenantProcedure
      .use(requirePermission('coshh.view'))
      .query(async ({ ctx }) => {
        assertEnabled();
        const rows = await ctx.db
          .select({ supplier: coshhSubstances.supplier })
          .from(coshhSubstances)
          .where(
            and(eq(coshhSubstances.tenantId, ctx.tenantId), sql`${coshhSubstances.supplier} <> ''`),
          )
          .groupBy(coshhSubstances.supplier)
          .orderBy(desc(sql`count(*)`), coshhSubstances.supplier)
          .limit(50);
        return rows.map((r) => r.supplier);
      }),

    get: tenantProcedure
      .use(requirePermission('coshh.view'))
      .input(z.object({ substanceId: z.string().length(26) }))
      .query(async ({ ctx, input }) => {
        assertEnabled();
        const substance = await loadSubstance(ctx.db, ctx.tenantId, input.substanceId);

        const [locations, sdsDocuments, assessments, monitoring] = await Promise.all([
          ctx.db
            .select()
            .from(coshhSubstanceLocations)
            .where(eq(coshhSubstanceLocations.substanceId, substance.id))
            .orderBy(asc(coshhSubstanceLocations.createdAt)),
          ctx.db
            .select()
            .from(coshhSdsDocuments)
            .where(eq(coshhSdsDocuments.substanceId, substance.id))
            .orderBy(desc(coshhSdsDocuments.version)),
          ctx.db
            .select()
            .from(coshhAssessments)
            .where(eq(coshhAssessments.substanceId, substance.id))
            .orderBy(desc(coshhAssessments.updatedAt)),
          ctx.db
            .select()
            .from(coshhExposureMonitoring)
            .where(eq(coshhExposureMonitoring.substanceId, substance.id))
            .orderBy(desc(coshhExposureMonitoring.sampledAt)),
        ]);

        const assessmentIds = assessments.map((a) => a.id);
        const controls = assessmentIds.length
          ? await ctx.db
              .select()
              .from(coshhAssessmentControls)
              .where(inArray(coshhAssessmentControls.assessmentId, assessmentIds))
              .orderBy(asc(coshhAssessmentControls.createdAt))
          : [];

        const eventConditions = [
          and(eq(coshhEvents.entityType, 'substance'), eq(coshhEvents.entityId, substance.id)),
        ];
        if (assessmentIds.length > 0) {
          eventConditions.push(
            and(
              eq(coshhEvents.entityType, 'assessment'),
              inArray(coshhEvents.entityId, assessmentIds),
            ),
          );
        }
        const events = await ctx.db
          .select()
          .from(coshhEvents)
          .where(and(eq(coshhEvents.tenantId, ctx.tenantId), or(...eventConditions)))
          .orderBy(desc(coshhEvents.createdAt))
          .limit(100);

        // Incompatibility warnings: other substances stored at the same site
        // whose storage class conflicts with one of ours (CO-E17).
        const mySiteIds = [
          ...new Set(locations.map((l) => l.siteId).filter((v): v is string => v !== null)),
        ];
        const storageConflicts: Array<{
          siteId: string;
          siteName: string | null;
          myStorageClass: string;
          otherSubstanceId: string;
          otherSubstanceName: string;
          otherStorageClass: string;
        }> = [];
        if (mySiteIds.length > 0) {
          const neighbours = await ctx.db
            .select({
              substanceId: coshhSubstanceLocations.substanceId,
              siteId: coshhSubstanceLocations.siteId,
              storageClass: coshhSubstanceLocations.storageClass,
              name: coshhSubstances.name,
              status: coshhSubstances.status,
            })
            .from(coshhSubstanceLocations)
            .innerJoin(coshhSubstances, eq(coshhSubstances.id, coshhSubstanceLocations.substanceId))
            .where(
              and(
                eq(coshhSubstanceLocations.tenantId, ctx.tenantId),
                inArray(coshhSubstanceLocations.siteId, mySiteIds),
              ),
            );
          const names = await siteNamesById(ctx.db, ctx.tenantId, mySiteIds);
          for (const mine of locations) {
            if (mine.siteId === null || mine.storageClass === null) continue;
            for (const other of neighbours) {
              if (other.substanceId === substance.id) continue;
              if (other.status === 'archived') continue;
              if (other.siteId !== mine.siteId || other.storageClass === null) continue;
              if (!storageClassesConflict(mine.storageClass, other.storageClass)) continue;
              const dup = storageConflicts.some(
                (c) => c.siteId === mine.siteId && c.otherSubstanceId === other.substanceId,
              );
              if (dup) continue;
              storageConflicts.push({
                siteId: mine.siteId,
                siteName: names.get(mine.siteId) ?? null,
                myStorageClass: mine.storageClass,
                otherSubstanceId: other.substanceId,
                otherSubstanceName: other.name,
                otherStorageClass: other.storageClass,
              });
            }
          }
        }

        const siteNames = await siteNamesById(ctx.db, ctx.tenantId, mySiteIds);
        const now = new Date();
        const currentSds = sdsDocuments.find((d) => d.isCurrent);
        const flags = {
          carcinogen: substance.isCarcinogen,
          mutagen: substance.isMutagen,
          asthmagen: substance.isAsthmagen,
        };
        return {
          substance,
          locations: locations.map((l) => ({
            ...l,
            siteName: l.siteId !== null ? (siteNames.get(l.siteId) ?? null) : null,
          })),
          sdsDocuments,
          sdsStatus: sdsStatusFor(currentSds, now),
          assessments: assessments.map((a) => ({
            ...a,
            controls: controls.filter((c) => c.assessmentId === a.id),
            reviewDue: a.nextReviewAt !== null && a.nextReviewAt <= now,
          })),
          monitoring,
          events,
          storageConflicts,
          substitutionPriority: substitutionPriority(
            flags,
            substance.hStatements.map((h) => h.code),
          ) satisfies SubstitutionPriority,
        };
      }),

    create: tenantProcedure
      .use(requirePermission('coshh.create'))
      .input(substanceCreateInput)
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const name = input.name.trim();
        if (!input.allowDuplicate) {
          const dup = await ctx.db
            .select({ id: coshhSubstances.id, name: coshhSubstances.name })
            .from(coshhSubstances)
            .where(
              and(
                eq(coshhSubstances.tenantId, ctx.tenantId),
                sql`lower(${coshhSubstances.name}) = ${name.toLowerCase()}`,
              ),
            )
            .limit(1);
          if (dup[0] !== undefined) {
            throw new TRPCError({ code: 'CONFLICT', message: 'duplicate-name' });
          }
        }
        if (input.initialLocation?.siteId !== undefined) {
          await loadSiteInTenant(ctx.db, ctx.tenantId, input.initialLocation.siteId);
        }

        const id = newId();
        const n = await nextReferenceValue(ctx.db, ctx.tenantId, 'coshhSubstance');
        const referenceNumber = `CS-${String(n).padStart(4, '0')}`;
        const hCodes = input.hStatements.map((h) => h.code);
        const inferred = inferRegimeFlags(hCodes);

        await ctx.db.insert(coshhSubstances).values({
          id,
          tenantId: ctx.tenantId,
          referenceNumber,
          name,
          supplier: input.supplier,
          productIdentifier: input.productIdentifier,
          physicalForm: input.physicalForm ?? null,
          usageDescription: input.usageDescription,
          signalWord: input.signalWord ?? null,
          hazardClassification: input.hazardClassification,
          hStatements: input.hStatements,
          pStatements: input.pStatements,
          pictograms: input.pictograms,
          workplaceExposureLimits: input.workplaceExposureLimits,
          isCarcinogen: inferred.carcinogen,
          isMutagen: inferred.mutagen,
          isAsthmagen: inferred.asthmagen,
          isBiologicalAgent: input.isBiologicalAgent,
          containsLead: input.containsLead,
          asbestosReferral: input.asbestosReferral,
          sdsReviewMonths: input.sdsReviewMonths,
          createdBy: ctx.auth.userId,
        });

        if (input.initialLocation !== undefined) {
          await ctx.db.insert(coshhSubstanceLocations).values({
            id: newId(),
            tenantId: ctx.tenantId,
            substanceId: id,
            siteId: input.initialLocation.siteId ?? null,
            locationText: input.initialLocation.locationText,
            quantity: input.initialLocation.quantity ?? null,
            unit: input.initialLocation.unit ?? null,
            storageClass: input.initialLocation.storageClass ?? null,
            storageNotes: input.initialLocation.storageNotes,
          });
        }

        if (input.initialSds !== undefined) {
          const issueDate = input.initialSds.issueDate ?? null;
          await ctx.db.insert(coshhSdsDocuments).values({
            id: newId(),
            tenantId: ctx.tenantId,
            substanceId: id,
            version: 1,
            storageKey: input.initialSds.storageKey,
            filename: input.initialSds.filename,
            mimeType: input.initialSds.mimeType,
            sizeBytes: input.initialSds.sizeBytes,
            issueDate,
            reviewByDate: addMonths(issueDate ?? new Date(), input.sdsReviewMonths),
            extraction: (input.initialSds.extraction ?? null) as never,
            isCurrent: true,
            createdBy: ctx.auth.userId,
          });
        }

        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'substance',
          entityId: id,
          actorUserId: ctx.auth.userId,
          kind: 'created',
          detail: name,
        });
        ctx.logger.info({ substanceId: id }, '[coshh] substance created');
        return { substanceId: id, referenceNumber };
      }),

    update: tenantProcedure
      .use(requirePermission('coshh.manage'))
      .input(substanceUpdateInput)
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const substance = await loadSubstance(ctx.db, ctx.tenantId, input.substanceId);
        if (substance.archivedAt !== null) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'archived' });
        }
        const { substanceId: _id, ...patch } = input;
        // Re-infer the H-statement-derived regime flags when the statements
        // change and the caller didn't set the flags explicitly — a new SDS
        // must never silently drop a carcinogen flag.
        const inferred =
          patch.hStatements !== undefined
            ? inferRegimeFlags(patch.hStatements.map((h) => h.code))
            : null;
        await ctx.db
          .update(coshhSubstances)
          .set({
            ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
            ...(patch.supplier !== undefined ? { supplier: patch.supplier } : {}),
            ...(patch.productIdentifier !== undefined
              ? { productIdentifier: patch.productIdentifier }
              : {}),
            ...(patch.physicalForm !== undefined ? { physicalForm: patch.physicalForm } : {}),
            ...(patch.usageDescription !== undefined
              ? { usageDescription: patch.usageDescription }
              : {}),
            ...(patch.signalWord !== undefined ? { signalWord: patch.signalWord } : {}),
            ...(patch.hazardClassification !== undefined
              ? { hazardClassification: patch.hazardClassification }
              : {}),
            ...(patch.hStatements !== undefined ? { hStatements: patch.hStatements } : {}),
            ...(patch.pStatements !== undefined ? { pStatements: patch.pStatements } : {}),
            ...(patch.pictograms !== undefined ? { pictograms: patch.pictograms } : {}),
            ...(patch.workplaceExposureLimits !== undefined
              ? { workplaceExposureLimits: patch.workplaceExposureLimits }
              : {}),
            ...(patch.isCarcinogen !== undefined
              ? { isCarcinogen: patch.isCarcinogen }
              : inferred !== null
                ? { isCarcinogen: inferred.carcinogen || substance.isCarcinogen }
                : {}),
            ...(patch.isMutagen !== undefined
              ? { isMutagen: patch.isMutagen }
              : inferred !== null
                ? { isMutagen: inferred.mutagen || substance.isMutagen }
                : {}),
            ...(patch.isAsthmagen !== undefined
              ? { isAsthmagen: patch.isAsthmagen }
              : inferred !== null
                ? { isAsthmagen: inferred.asthmagen || substance.isAsthmagen }
                : {}),
            ...(patch.isBiologicalAgent !== undefined
              ? { isBiologicalAgent: patch.isBiologicalAgent }
              : {}),
            ...(patch.containsLead !== undefined ? { containsLead: patch.containsLead } : {}),
            ...(patch.asbestosReferral !== undefined
              ? { asbestosReferral: patch.asbestosReferral }
              : {}),
            ...(patch.sdsReviewMonths !== undefined
              ? { sdsReviewMonths: patch.sdsReviewMonths }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(coshhSubstances.id, substance.id));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'substance',
          entityId: substance.id,
          actorUserId: ctx.auth.userId,
          kind: 'updated',
        });
        return { ok: true };
      }),

    setSubstitution: tenantProcedure
      .use(requirePermission('coshh.manage'))
      .input(
        z.object({
          substanceId: z.string().length(26),
          status: z.enum(SUBSTITUTION_STATUSES),
          notes: z.string().max(2000).default(''),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const substance = await loadSubstance(ctx.db, ctx.tenantId, input.substanceId);
        await ctx.db
          .update(coshhSubstances)
          .set({
            substitutionStatus: input.status,
            substitutionNotes: input.notes,
            updatedAt: new Date(),
          })
          .where(eq(coshhSubstances.id, substance.id));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'substance',
          entityId: substance.id,
          actorUserId: ctx.auth.userId,
          kind: 'substitution_updated',
          detail: input.status,
        });
        return { ok: true };
      }),

    archive: tenantProcedure
      .use(requirePermission('coshh.manage'))
      .input(z.object({ substanceId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const substance = await loadSubstance(ctx.db, ctx.tenantId, input.substanceId);
        await ctx.db
          .update(coshhSubstances)
          .set({ status: 'archived', archivedAt: new Date(), updatedAt: new Date() })
          .where(eq(coshhSubstances.id, substance.id));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'substance',
          entityId: substance.id,
          actorUserId: ctx.auth.userId,
          kind: 'archived',
        });
        return { ok: true };
      }),
  });

  const locations = router({
    add: tenantProcedure
      .use(requirePermission('coshh.manage'))
      .input(locationInput.extend({ substanceId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const substance = await loadSubstance(ctx.db, ctx.tenantId, input.substanceId);
        if (input.siteId !== undefined) {
          await loadSiteInTenant(ctx.db, ctx.tenantId, input.siteId);
        }
        const id = newId();
        await ctx.db.insert(coshhSubstanceLocations).values({
          id,
          tenantId: ctx.tenantId,
          substanceId: substance.id,
          siteId: input.siteId ?? null,
          locationText: input.locationText,
          quantity: input.quantity ?? null,
          unit: input.unit ?? null,
          storageClass: input.storageClass ?? null,
          storageNotes: input.storageNotes,
        });
        await touchSubstance(ctx.db, substance.id);
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'substance',
          entityId: substance.id,
          actorUserId: ctx.auth.userId,
          kind: 'location_added',
          detail: input.locationText,
        });
        return { locationId: id };
      }),

    update: tenantProcedure
      .use(requirePermission('coshh.manage'))
      .input(locationInput.partial().extend({ locationId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const rows = await ctx.db
          .select()
          .from(coshhSubstanceLocations)
          .where(
            and(
              eq(coshhSubstanceLocations.id, input.locationId),
              eq(coshhSubstanceLocations.tenantId, ctx.tenantId),
            ),
          )
          .limit(1);
        const location = rows[0];
        if (location === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
        if (input.siteId !== undefined) {
          await loadSiteInTenant(ctx.db, ctx.tenantId, input.siteId);
        }
        await ctx.db
          .update(coshhSubstanceLocations)
          .set({
            ...(input.siteId !== undefined ? { siteId: input.siteId } : {}),
            ...(input.locationText !== undefined ? { locationText: input.locationText } : {}),
            ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
            ...(input.unit !== undefined ? { unit: input.unit } : {}),
            ...(input.storageClass !== undefined ? { storageClass: input.storageClass } : {}),
            ...(input.storageNotes !== undefined ? { storageNotes: input.storageNotes } : {}),
            updatedAt: new Date(),
          })
          .where(eq(coshhSubstanceLocations.id, location.id));
        await touchSubstance(ctx.db, location.substanceId);
        return { ok: true };
      }),

    remove: tenantProcedure
      .use(requirePermission('coshh.manage'))
      .input(z.object({ locationId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const rows = await ctx.db
          .select()
          .from(coshhSubstanceLocations)
          .where(
            and(
              eq(coshhSubstanceLocations.id, input.locationId),
              eq(coshhSubstanceLocations.tenantId, ctx.tenantId),
            ),
          )
          .limit(1);
        const location = rows[0];
        if (location === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
        await ctx.db
          .delete(coshhSubstanceLocations)
          .where(eq(coshhSubstanceLocations.id, location.id));
        await touchSubstance(ctx.db, location.substanceId);
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'substance',
          entityId: location.substanceId,
          actorUserId: ctx.auth.userId,
          kind: 'location_removed',
          detail: location.locationText,
        });
        return { ok: true };
      }),
  });

  const sds = router({
    attach: tenantProcedure
      .use(requirePermission('coshh.manage'))
      .input(sdsFileInput.extend({ substanceId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const substance = await loadSubstance(ctx.db, ctx.tenantId, input.substanceId);
        const versionRows = await ctx.db
          .select({ maxVersion: sql<number>`coalesce(max(${coshhSdsDocuments.version}), 0)` })
          .from(coshhSdsDocuments)
          .where(eq(coshhSdsDocuments.substanceId, substance.id));
        const version = Number(versionRows[0]?.maxVersion ?? 0) + 1;
        const issueDate = input.issueDate ?? null;
        const id = newId();
        await ctx.db.transaction(async (tx) => {
          await tx
            .update(coshhSdsDocuments)
            .set({ isCurrent: false })
            .where(eq(coshhSdsDocuments.substanceId, substance.id));
          await tx.insert(coshhSdsDocuments).values({
            id,
            tenantId: ctx.tenantId,
            substanceId: substance.id,
            version,
            storageKey: input.storageKey,
            filename: input.filename,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            issueDate,
            reviewByDate: addMonths(issueDate ?? new Date(), substance.sdsReviewMonths),
            extraction: (input.extraction ?? null) as never,
            isCurrent: true,
            createdBy: ctx.auth.userId,
          });
        });
        await touchSubstance(ctx.db, substance.id);
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'substance',
          entityId: substance.id,
          actorUserId: ctx.auth.userId,
          kind: 'sds_attached',
          detail: `v${version}`,
        });
        return { sdsDocumentId: id, version };
      }),

    /**
     * "Checked with the supplier — this sheet is still the latest": pushes
     * the review-by date forward without uploading a new file (CO-E15).
     */
    confirmCurrent: tenantProcedure
      .use(requirePermission('coshh.manage'))
      .input(z.object({ substanceId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const substance = await loadSubstance(ctx.db, ctx.tenantId, input.substanceId);
        const updated = await ctx.db
          .update(coshhSdsDocuments)
          .set({ reviewByDate: addMonths(new Date(), substance.sdsReviewMonths) })
          .where(
            and(
              eq(coshhSdsDocuments.substanceId, substance.id),
              eq(coshhSdsDocuments.isCurrent, true),
            ),
          )
          .returning({ id: coshhSdsDocuments.id });
        if (updated.length === 0) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'no-sds' });
        }
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'substance',
          entityId: substance.id,
          actorUserId: ctx.auth.userId,
          kind: 'sds_confirmed_current',
        });
        return { ok: true };
      }),
  });

  const assessments = router({
    create: tenantProcedure
      .use(requirePermission('coshh.create'))
      .input(
        z.object({
          substanceId: z.string().length(26),
          taskDescription: z.string().min(1).max(2000),
          kind: z.enum(COSHH_ASSESSMENT_KINDS).default('standing'),
          /** PF-10: offline-queue idempotency key (point-of-work flow). */
          clientRequestId: z.string().length(26).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const substance = await loadSubstance(ctx.db, ctx.tenantId, input.substanceId);
        if (substance.archivedAt !== null) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'archived' });
        }
        if (input.clientRequestId !== undefined) {
          const dup = (
            await ctx.db
              .select({
                id: coshhAssessments.id,
                referenceNumber: coshhAssessments.referenceNumber,
              })
              .from(coshhAssessments)
              .where(
                and(
                  eq(coshhAssessments.tenantId, ctx.tenantId),
                  eq(coshhAssessments.clientRequestId, input.clientRequestId),
                ),
              )
              .limit(1)
          )[0];
          if (dup !== undefined) {
            return {
              assessmentId: dup.id,
              referenceNumber: dup.referenceNumber ?? '',
              deduped: true,
            };
          }
        }
        const id = newId();
        const n = await nextReferenceValue(ctx.db, ctx.tenantId, 'coshhAssessment');
        const referenceNumber = `COSHH-${String(n).padStart(4, '0')}`;
        await ctx.db.insert(coshhAssessments).values({
          id,
          tenantId: ctx.tenantId,
          substanceId: substance.id,
          referenceNumber,
          taskDescription: input.taskDescription,
          kind: input.kind,
          clientRequestId: input.clientRequestId ?? null,
          assessorUserId: ctx.auth.userId,
          reviewFrequencyMonths: DEFAULT_ASSESSMENT_REVIEW_MONTHS,
          nextReviewAt: addMonths(new Date(), DEFAULT_ASSESSMENT_REVIEW_MONTHS),
          createdBy: ctx.auth.userId,
        });
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'assessment',
          entityId: id,
          actorUserId: ctx.auth.userId,
          kind: 'assessment_created',
          detail: input.taskDescription,
        });
        return { assessmentId: id, referenceNumber };
      }),

    update: tenantProcedure
      .use(requirePermission('coshh.manage'))
      .input(assessmentUpdateInput)
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const assessment = await loadAssessment(ctx.db, ctx.tenantId, input.assessmentId);
        if (assessment.archivedAt !== null) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'archived' });
        }
        const { assessmentId: _id, ...patch } = input;
        await ctx.db
          .update(coshhAssessments)
          .set({
            ...(patch.taskDescription !== undefined
              ? { taskDescription: patch.taskDescription }
              : {}),
            ...(patch.routesOfExposure !== undefined
              ? { routesOfExposure: patch.routesOfExposure }
              : {}),
            ...(patch.personsExposed !== undefined ? { personsExposed: patch.personsExposed } : {}),
            ...(patch.personsCount !== undefined ? { personsCount: patch.personsCount } : {}),
            ...(patch.quantityBand !== undefined ? { quantityBand: patch.quantityBand } : {}),
            ...(patch.frequencyBand !== undefined ? { frequencyBand: patch.frequencyBand } : {}),
            ...(patch.durationBand !== undefined ? { durationBand: patch.durationBand } : {}),
            ...(patch.levRequired !== undefined ? { levRequired: patch.levRequired } : {}),
            ...(patch.healthSurveillanceRequired !== undefined
              ? { healthSurveillanceRequired: patch.healthSurveillanceRequired }
              : {}),
            ...(patch.exposureMonitoringRequired !== undefined
              ? { exposureMonitoringRequired: patch.exposureMonitoringRequired }
              : {}),
            ...(patch.emergencyNotes !== undefined ? { emergencyNotes: patch.emergencyNotes } : {}),
            ...(patch.plainSummary !== undefined ? { plainSummary: patch.plainSummary } : {}),
            ...(patch.assessorUserId !== undefined ? { assessorUserId: patch.assessorUserId } : {}),
            ...(patch.reviewFrequencyMonths !== undefined
              ? { reviewFrequencyMonths: patch.reviewFrequencyMonths }
              : {}),
            ...(patch.nextReviewAt !== undefined ? { nextReviewAt: patch.nextReviewAt } : {}),
            updatedAt: new Date(),
          })
          .where(eq(coshhAssessments.id, assessment.id));
        return { ok: true };
      }),

    addControl: tenantProcedure
      .use(requirePermission('coshh.manage'))
      .input(controlInput)
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const assessment = await loadAssessment(ctx.db, ctx.tenantId, input.assessmentId);
        const id = newId();
        await ctx.db.insert(coshhAssessmentControls).values({
          id,
          tenantId: ctx.tenantId,
          assessmentId: assessment.id,
          tier: input.tier,
          description: input.description,
          status: input.status,
          ppeJustification: input.ppeJustification ?? null,
          rpeType: input.rpeType ?? null,
          rpeApf: input.rpeApf ?? null,
          faceFitConfirmedAt: input.faceFitConfirmedAt ?? null,
        });
        // Content changed — moves updatedAt past lastPublishedAt so the
        // "changed since publish" prompt fires on active assessments.
        await ctx.db
          .update(coshhAssessments)
          .set({ updatedAt: new Date() })
          .where(eq(coshhAssessments.id, assessment.id));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'assessment',
          entityId: assessment.id,
          actorUserId: ctx.auth.userId,
          kind: 'control_added',
          detail: input.description,
        });
        return { controlId: id };
      }),

    updateControl: tenantProcedure
      .use(requirePermission('coshh.manage'))
      .input(
        controlInput
          .omit({ assessmentId: true })
          .partial()
          .extend({ controlId: z.string().length(26) }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const rows = await ctx.db
          .select()
          .from(coshhAssessmentControls)
          .where(
            and(
              eq(coshhAssessmentControls.id, input.controlId),
              eq(coshhAssessmentControls.tenantId, ctx.tenantId),
            ),
          )
          .limit(1);
        const control = rows[0];
        if (control === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
        await ctx.db
          .update(coshhAssessmentControls)
          .set({
            ...(input.tier !== undefined ? { tier: input.tier } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
            ...(input.ppeJustification !== undefined
              ? { ppeJustification: input.ppeJustification }
              : {}),
            ...(input.rpeType !== undefined ? { rpeType: input.rpeType } : {}),
            ...(input.rpeApf !== undefined ? { rpeApf: input.rpeApf } : {}),
            ...(input.faceFitConfirmedAt !== undefined
              ? { faceFitConfirmedAt: input.faceFitConfirmedAt }
              : {}),
          })
          .where(eq(coshhAssessmentControls.id, control.id));
        await ctx.db
          .update(coshhAssessments)
          .set({ updatedAt: new Date() })
          .where(eq(coshhAssessments.id, control.assessmentId));
        return { ok: true };
      }),

    removeControl: tenantProcedure
      .use(requirePermission('coshh.manage'))
      .input(z.object({ controlId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const rows = await ctx.db
          .select()
          .from(coshhAssessmentControls)
          .where(
            and(
              eq(coshhAssessmentControls.id, input.controlId),
              eq(coshhAssessmentControls.tenantId, ctx.tenantId),
            ),
          )
          .limit(1);
        const control = rows[0];
        if (control === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
        await ctx.db
          .delete(coshhAssessmentControls)
          .where(eq(coshhAssessmentControls.id, control.id));
        await ctx.db
          .update(coshhAssessments)
          .set({ updatedAt: new Date() })
          .where(eq(coshhAssessments.id, control.assessmentId));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'assessment',
          entityId: control.assessmentId,
          actorUserId: ctx.auth.userId,
          kind: 'control_removed',
          detail: control.description,
        });
        return { ok: true };
      }),

    /**
     * Publish: validates the assessment is suitable and sufficient —
     * routes of exposure recorded, at least one control, RPE/PPE-only
     * reliance justified, and (for carcinogens / mutagens) substitution
     * considered first — then activates it and generates an action per
     * planned control (idempotent).
     */
    publish: tenantProcedure
      .use(requirePermission('coshh.manage'))
      .input(z.object({ assessmentId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const assessment = await loadAssessment(ctx.db, ctx.tenantId, input.assessmentId);
        if (assessment.archivedAt !== null) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'archived' });
        }
        const substance = await loadSubstance(ctx.db, ctx.tenantId, assessment.substanceId);
        if (assessment.routesOfExposure.length === 0) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'no-routes' });
        }
        const controls = await ctx.db
          .select()
          .from(coshhAssessmentControls)
          .where(eq(coshhAssessmentControls.assessmentId, assessment.id));
        if (controls.length === 0) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'no-controls' });
        }
        // Hierarchy of control: RPE / other PPE cannot be the whole answer
        // without justification (CO-E18).
        const allPpe = controls.every((c) => c.tier === 'rpe' || c.tier === 'ppe');
        const hasJustification = controls.some(
          (c) => c.ppeJustification !== null && c.ppeJustification.trim().length > 0,
        );
        if (allPpe && !hasJustification) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'ppe-only-needs-justification',
          });
        }
        // Substitution first: a carcinogen / mutagen assessment cannot go
        // active while substitution has not even been considered (CO-E19).
        if (
          (substance.isCarcinogen || substance.isMutagen) &&
          substance.substitutionStatus === 'not_assessed'
        ) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'substitution-not-considered',
          });
        }

        // Claim action reference numbers before the tx (a rolled-back
        // publish wastes a few numbers, which is fine — references are
        // labels, not invariants).
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
            await tx.insert(actions).values({
              id: actionId,
              tenantId: ctx.tenantId,
              sourceType: 'coshh_assessment',
              sourceId: assessment.id,
              sourceItemId: control.id,
              referenceNumber: actionRefs.get(control.id) ?? null,
              title: `Implement control: ${control.description}`,
              description: `Raised by COSHH assessment ${assessment.referenceNumber ?? assessment.id} for ${substance.name} — task: ${assessment.taskDescription}.`,
              status: 'open',
              assigneeUserId: ctx.auth.userId,
              // Exposure-control gaps on a CMR substance are urgent by default.
              priority: substance.isCarcinogen || substance.isMutagen ? 'high' : 'medium',
              dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              createdBy: ctx.auth.userId,
            });
            await tx
              .update(coshhAssessmentControls)
              .set({ actionId })
              .where(eq(coshhAssessmentControls.id, control.id));
            createdActionIds.push(actionId);
          }
          const now = new Date();
          await tx
            .update(coshhAssessments)
            .set({
              status: 'active',
              publishedAt: assessment.publishedAt ?? now,
              // Assessor sign-off (C-21): every publish stamps who attested.
              publishedBy: ctx.auth.userId,
              // Every publish (incl. republish) — the reference point for
              // "changed since publish" (C-15).
              lastPublishedAt: now,
              updatedAt: now,
            })
            .where(eq(coshhAssessments.id, assessment.id));
        });
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'assessment',
          entityId: assessment.id,
          actorUserId: ctx.auth.userId,
          kind: 'published',
          detail: String(createdActionIds.length),
        });
        ctx.logger.info(
          { assessmentId: assessment.id, actionsCreated: createdActionIds.length },
          '[coshh] assessment published',
        );
        return { ok: true, actionsCreated: createdActionIds.length };
      }),

    moveToDraft: tenantProcedure
      .use(requirePermission('coshh.manage'))
      .input(z.object({ assessmentId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const assessment = await loadAssessment(ctx.db, ctx.tenantId, input.assessmentId);
        if (assessment.status === 'draft' && assessment.archivedAt === null) {
          return { ok: true };
        }
        await ctx.db
          .update(coshhAssessments)
          .set({ status: 'draft', archivedAt: null, updatedAt: new Date() })
          .where(eq(coshhAssessments.id, assessment.id));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'assessment',
          entityId: assessment.id,
          actorUserId: ctx.auth.userId,
          kind: 'moved_to_draft',
        });
        return { ok: true };
      }),

    recordReview: tenantProcedure
      .use(requirePermission('coshh.manage'))
      .input(
        z.object({
          assessmentId: z.string().length(26),
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
          nextReviewAt = addMonths(now, assessment.reviewFrequencyMonths);
        }
        await ctx.db
          .update(coshhAssessments)
          .set({
            lastReviewedAt: now,
            lastReviewedBy: ctx.auth.userId,
            nextReviewAt,
            updatedAt: now,
          })
          .where(eq(coshhAssessments.id, assessment.id));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'assessment',
          entityId: assessment.id,
          actorUserId: ctx.auth.userId,
          kind: 'review_recorded',
          detail: input.note,
        });
        return { ok: true, nextReviewAt };
      }),
  });

  const monitoring = router({
    record: tenantProcedure
      .use(requirePermission('coshh.manage'))
      .input(
        z.object({
          substanceId: z.string().length(26),
          agent: z.string().min(1).max(200),
          sampledAt: z.coerce.date(),
          sampleType: z.enum(SAMPLE_TYPES).default('personal'),
          period: z.enum(MONITORING_PERIODS),
          resultValue: z.number().nonnegative(),
          resultUnit: z.enum(WEL_UNITS),
          notes: z.string().max(2000).default(''),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const substance = await loadSubstance(ctx.db, ctx.tenantId, input.substanceId);
        // Snapshot the WEL comparison at record time (CO-E21). Null when the
        // substance has no matching limit or the units differ — surfaced as
        // "not comparable", never a silent pass.
        const wel = substance.workplaceExposureLimits.find(
          (w) => w.agent.trim().toLowerCase() === input.agent.trim().toLowerCase(),
        );
        const exceeds =
          wel !== undefined
            ? exceedsWel(
                { value: input.resultValue, unit: input.resultUnit, period: input.period },
                wel,
              )
            : null;
        const id = newId();
        await ctx.db.insert(coshhExposureMonitoring).values({
          id,
          tenantId: ctx.tenantId,
          substanceId: substance.id,
          agent: input.agent.trim(),
          sampledAt: input.sampledAt,
          sampleType: input.sampleType,
          period: input.period,
          resultValue: input.resultValue,
          resultUnit: input.resultUnit,
          exceedsWel: exceeds,
          notes: input.notes,
          recordedBy: ctx.auth.userId,
        });
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'substance',
          entityId: substance.id,
          actorUserId: ctx.auth.userId,
          kind: 'monitoring_recorded',
          detail: `${input.agent}: ${input.resultValue} ${input.resultUnit}`,
        });
        return { monitoringId: id, exceedsWel: exceeds };
      }),
  });

  const lev = router({
    list: tenantProcedure
      .use(requirePermission('coshh.view'))
      .input(
        z
          .object({ includeDecommissioned: z.boolean().default(false) })
          .default({ includeDecommissioned: false }),
      )
      .query(async ({ ctx, input }) => {
        assertEnabled();
        const rows = await ctx.db
          .select()
          .from(coshhLevUnits)
          .where(eq(coshhLevUnits.tenantId, ctx.tenantId))
          .orderBy(asc(coshhLevUnits.name));
        const filtered = input.includeDecommissioned
          ? rows
          : rows.filter((u) => u.status !== 'decommissioned');
        const unitIds = filtered.map((u) => u.id);
        const tests = unitIds.length
          ? await ctx.db
              .select()
              .from(coshhLevTests)
              .where(inArray(coshhLevTests.levUnitId, unitIds))
              .orderBy(desc(coshhLevTests.testedAt))
          : [];
        const siteNames = await siteNamesById(
          ctx.db,
          ctx.tenantId,
          filtered.map((u) => u.siteId).filter((v): v is string => v !== null),
        );
        const now = new Date();
        return filtered.map((u) => {
          const latest = tests.find((t) => t.levUnitId === u.id);
          return {
            ...u,
            siteName: u.siteId !== null ? (siteNames.get(u.siteId) ?? null) : null,
            latestResult: latest?.result ?? null,
            testCount: tests.filter((t) => t.levUnitId === u.id).length,
            overdue:
              u.status !== 'decommissioned' && u.nextTestDueAt !== null && u.nextTestDueAt <= now,
          };
        });
      }),

    tests: tenantProcedure
      .use(requirePermission('coshh.view'))
      .input(z.object({ levUnitId: z.string().length(26) }))
      .query(async ({ ctx, input }) => {
        assertEnabled();
        const unit = await loadLevUnit(ctx.db, ctx.tenantId, input.levUnitId);
        return ctx.db
          .select()
          .from(coshhLevTests)
          .where(eq(coshhLevTests.levUnitId, unit.id))
          .orderBy(desc(coshhLevTests.testedAt));
      }),

    create: tenantProcedure
      .use(requirePermission('coshh.manage'))
      .input(
        z.object({
          name: z.string().min(1).max(300),
          siteId: z.string().length(26).optional(),
          locationText: z.string().max(500).default(''),
          description: z.string().max(2000).default(''),
          testIntervalMonths: z
            .number()
            .int()
            .min(1)
            .max(STATUTORY_LEV_TEST_INTERVAL_MONTHS)
            .default(STATUTORY_LEV_TEST_INTERVAL_MONTHS),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        if (input.siteId !== undefined) {
          await loadSiteInTenant(ctx.db, ctx.tenantId, input.siteId);
        }
        const id = newId();
        // A new unit's first thorough examination is due one interval from
        // registration — the register never shows "no test needed".
        await ctx.db.insert(coshhLevUnits).values({
          id,
          tenantId: ctx.tenantId,
          name: input.name,
          siteId: input.siteId ?? null,
          locationText: input.locationText,
          description: input.description,
          testIntervalMonths: input.testIntervalMonths,
          nextTestDueAt: addMonths(new Date(), input.testIntervalMonths),
          createdBy: ctx.auth.userId,
        });
        return { levUnitId: id };
      }),

    update: tenantProcedure
      .use(requirePermission('coshh.manage'))
      .input(
        z.object({
          levUnitId: z.string().length(26),
          name: z.string().min(1).max(300).optional(),
          siteId: z.string().length(26).nullable().optional(),
          locationText: z.string().max(500).optional(),
          description: z.string().max(2000).optional(),
          testIntervalMonths: z
            .number()
            .int()
            .min(1)
            .max(STATUTORY_LEV_TEST_INTERVAL_MONTHS)
            .optional(),
          status: z.enum(LEV_STATUSES).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const unit = await loadLevUnit(ctx.db, ctx.tenantId, input.levUnitId);
        if (input.siteId !== undefined && input.siteId !== null) {
          await loadSiteInTenant(ctx.db, ctx.tenantId, input.siteId);
        }
        const interval = input.testIntervalMonths ?? unit.testIntervalMonths;
        await ctx.db
          .update(coshhLevUnits)
          .set({
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.siteId !== undefined ? { siteId: input.siteId } : {}),
            ...(input.locationText !== undefined ? { locationText: input.locationText } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.testIntervalMonths !== undefined
              ? {
                  testIntervalMonths: input.testIntervalMonths,
                  nextTestDueAt: addMonths(unit.lastTestAt ?? new Date(), interval),
                }
              : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
            updatedAt: new Date(),
          })
          .where(eq(coshhLevUnits.id, unit.id));
        return { ok: true };
      }),

    recordTest: tenantProcedure
      .use(requirePermission('coshh.manage'))
      .input(
        z.object({
          levUnitId: z.string().length(26),
          testedAt: z.coerce.date(),
          result: z.enum(LEV_TEST_RESULTS),
          examiner: z.string().max(300).default(''),
          defectsSummary: z.string().max(4000).default(''),
          reportStorageKey: z.string().max(500).nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const unit = await loadLevUnit(ctx.db, ctx.tenantId, input.levUnitId);
        const id = newId();
        await ctx.db.insert(coshhLevTests).values({
          id,
          tenantId: ctx.tenantId,
          levUnitId: unit.id,
          testedAt: input.testedAt,
          result: input.result,
          examiner: input.examiner,
          defectsSummary: input.defectsSummary,
          reportStorageKey: input.reportStorageKey ?? null,
          recordedBy: ctx.auth.userId,
        });
        // Recompute the schedule from the latest examination on record (a
        // back-dated historical test must not shorten the next due date),
        // and take the unit out of service when the latest result is a fail.
        const latestRows = await ctx.db
          .select()
          .from(coshhLevTests)
          .where(eq(coshhLevTests.levUnitId, unit.id))
          .orderBy(desc(coshhLevTests.testedAt))
          .limit(1);
        const latest = latestRows[0];
        if (latest !== undefined) {
          await ctx.db
            .update(coshhLevUnits)
            .set({
              lastTestAt: latest.testedAt,
              nextTestDueAt: addMonths(latest.testedAt, unit.testIntervalMonths),
              ...(latest.result === 'fail' ? { status: 'out_of_service' as const } : {}),
              updatedAt: new Date(),
            })
            .where(eq(coshhLevUnits.id, unit.id));
        }
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'lev_unit',
          entityId: unit.id,
          actorUserId: ctx.auth.userId,
          kind: 'lev_test_recorded',
          detail: input.result,
        });
        return { testId: id };
      }),
  });

  /**
   * Health surveillance register (COSHH Reg 11 — C-11/C-19). Enrol the
   * exposed person against the substance, keep the recall date, record
   * each check. Rows end, never delete: the record must survive.
   */
  const surveillance = router({
    list: tenantProcedure
      .use(requirePermission('coshh.view'))
      .input(z.object({ substanceId: z.string().length(26) }))
      .query(async ({ ctx, input }) => {
        assertEnabled();
        const substance = await loadSubstance(ctx.db, ctx.tenantId, input.substanceId);
        const rows = await ctx.db
          .select({
            id: coshhHealthSurveillance.id,
            userId: coshhHealthSurveillance.userId,
            userName: user.name,
            intervalMonths: coshhHealthSurveillance.intervalMonths,
            startedAt: coshhHealthSurveillance.startedAt,
            lastCheckAt: coshhHealthSurveillance.lastCheckAt,
            nextDueAt: coshhHealthSurveillance.nextDueAt,
            notes: coshhHealthSurveillance.notes,
            endedAt: coshhHealthSurveillance.endedAt,
          })
          .from(coshhHealthSurveillance)
          .leftJoin(user, eq(user.id, coshhHealthSurveillance.userId))
          .where(eq(coshhHealthSurveillance.substanceId, substance.id))
          .orderBy(asc(coshhHealthSurveillance.nextDueAt));
        const now = new Date();
        return rows.map((r) => ({
          ...r,
          due: r.endedAt === null && r.nextDueAt <= now,
        }));
      }),

    enroll: tenantProcedure
      .use(requirePermission('coshh.manage'))
      .input(
        z.object({
          substanceId: z.string().length(26),
          userId: z.string().min(1),
          intervalMonths: z.number().int().min(1).max(60).default(12),
          notes: z.string().max(1000).default(''),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const substance = await loadSubstance(ctx.db, ctx.tenantId, input.substanceId);
        // One live enrolment per person per substance.
        const existing = await ctx.db
          .select({ id: coshhHealthSurveillance.id })
          .from(coshhHealthSurveillance)
          .where(
            and(
              eq(coshhHealthSurveillance.substanceId, substance.id),
              eq(coshhHealthSurveillance.userId, input.userId),
              isNull(coshhHealthSurveillance.endedAt),
            ),
          )
          .limit(1);
        if (existing[0] !== undefined) {
          throw new TRPCError({ code: 'CONFLICT', message: 'already-enrolled' });
        }
        const id = newId();
        const nextDueAt = new Date();
        nextDueAt.setMonth(nextDueAt.getMonth() + input.intervalMonths);
        await ctx.db.insert(coshhHealthSurveillance).values({
          id,
          tenantId: ctx.tenantId,
          substanceId: substance.id,
          userId: input.userId,
          intervalMonths: input.intervalMonths,
          nextDueAt,
          notes: input.notes,
          createdBy: ctx.auth.userId,
        });
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'substance',
          entityId: substance.id,
          actorUserId: ctx.auth.userId,
          kind: 'surveillance_enrolled',
          detail: input.userId,
        });
        return { enrolmentId: id };
      }),

    recordCheck: tenantProcedure
      .use(requirePermission('coshh.manage'))
      .input(
        z.object({
          enrolmentId: z.string().length(26),
          checkedAt: z.coerce.date().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const rows = await ctx.db
          .select()
          .from(coshhHealthSurveillance)
          .where(
            and(
              eq(coshhHealthSurveillance.id, input.enrolmentId),
              eq(coshhHealthSurveillance.tenantId, ctx.tenantId),
            ),
          )
          .limit(1);
        const enrolment = rows[0];
        if (enrolment === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
        if (enrolment.endedAt !== null) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'ended' });
        }
        const checkedAt = input.checkedAt ?? new Date();
        const nextDueAt = new Date(checkedAt);
        nextDueAt.setMonth(nextDueAt.getMonth() + enrolment.intervalMonths);
        await ctx.db
          .update(coshhHealthSurveillance)
          .set({ lastCheckAt: checkedAt, nextDueAt })
          .where(eq(coshhHealthSurveillance.id, enrolment.id));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'substance',
          entityId: enrolment.substanceId,
          actorUserId: ctx.auth.userId,
          kind: 'surveillance_check_recorded',
          detail: enrolment.userId,
        });
        return { ok: true, nextDueAt };
      }),

    end: tenantProcedure
      .use(requirePermission('coshh.manage'))
      .input(z.object({ enrolmentId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const rows = await ctx.db
          .select()
          .from(coshhHealthSurveillance)
          .where(
            and(
              eq(coshhHealthSurveillance.id, input.enrolmentId),
              eq(coshhHealthSurveillance.tenantId, ctx.tenantId),
            ),
          )
          .limit(1);
        const enrolment = rows[0];
        if (enrolment === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
        if (enrolment.endedAt !== null) return { ok: true };
        await ctx.db
          .update(coshhHealthSurveillance)
          .set({ endedAt: new Date() })
          .where(eq(coshhHealthSurveillance.id, enrolment.id));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'substance',
          entityId: enrolment.substanceId,
          actorUserId: ctx.auth.userId,
          kind: 'surveillance_ended',
          detail: enrolment.userId,
        });
        return { ok: true };
      }),
  });

  return router({
    /** Enum vocabulary for the UI — chips, selects and hierarchy prompts. */
    presets: tenantProcedure.use(requirePermission('coshh.view')).query(() => {
      assertEnabled();
      return {
        exposureRoutes: EXPOSURE_ROUTES,
        exposedGroups: COSHH_EXPOSED_GROUP_PRESETS,
        quantityBands: QUANTITY_BANDS,
        frequencyBands: FREQUENCY_BANDS,
        durationBands: DURATION_BANDS,
        controlTiers: COSHH_CONTROL_TIERS,
        storageClasses: STORAGE_CLASSES,
        quantityUnits: COSHH_QUANTITY_UNITS,
        pictograms: GHS_PICTOGRAMS,
        welUnits: WEL_UNITS,
        statutoryLevIntervalMonths: STATUTORY_LEV_TEST_INTERVAL_MONTHS,
      };
    }),

    /** The needs-attention counters the module home leads with. */
    overview: tenantProcedure.use(requirePermission('coshh.view')).query(async ({ ctx }) => {
      assertEnabled();
      const now = new Date();
      const activeSubstances = await ctx.db
        .select({ id: coshhSubstances.id })
        .from(coshhSubstances)
        .where(
          and(eq(coshhSubstances.tenantId, ctx.tenantId), eq(coshhSubstances.status, 'active')),
        );
      const activeIds = activeSubstances.map((s) => s.id);

      let sdsMissing = 0;
      let sdsDue = 0;
      if (activeIds.length > 0) {
        const currentSheets = await ctx.db
          .select()
          .from(coshhSdsDocuments)
          .where(
            and(
              inArray(coshhSdsDocuments.substanceId, activeIds),
              eq(coshhSdsDocuments.isCurrent, true),
            ),
          );
        for (const id of activeIds) {
          const status = sdsStatusFor(
            currentSheets.find((d) => d.substanceId === id),
            now,
          );
          if (status === 'missing') sdsMissing += 1;
          if (status === 'review_due') sdsDue += 1;
        }
      }

      const dueAssessments = await ctx.db
        .select({ id: coshhAssessments.id })
        .from(coshhAssessments)
        .where(
          and(
            eq(coshhAssessments.tenantId, ctx.tenantId),
            eq(coshhAssessments.status, 'active'),
            isNotNull(coshhAssessments.nextReviewAt),
            lte(coshhAssessments.nextReviewAt, now),
          ),
        );

      const levUnits = await ctx.db
        .select()
        .from(coshhLevUnits)
        .where(eq(coshhLevUnits.tenantId, ctx.tenantId));
      const levDue = levUnits.filter(
        (u) => u.status !== 'decommissioned' && u.nextTestDueAt !== null && u.nextTestDueAt <= now,
      ).length;
      const levOutOfService = levUnits.filter((u) => u.status === 'out_of_service').length;

      const exceedances = activeIds.length
        ? await ctx.db
            .select({ id: coshhExposureMonitoring.id })
            .from(coshhExposureMonitoring)
            .where(
              and(
                eq(coshhExposureMonitoring.tenantId, ctx.tenantId),
                eq(coshhExposureMonitoring.exceedsWel, true),
                inArray(coshhExposureMonitoring.substanceId, activeIds),
              ),
            )
        : [];

      // Storage conflicts across the whole inventory, counted as pairs.
      const allLocations = await ctx.db
        .select({
          substanceId: coshhSubstanceLocations.substanceId,
          siteId: coshhSubstanceLocations.siteId,
          storageClass: coshhSubstanceLocations.storageClass,
        })
        .from(coshhSubstanceLocations)
        .where(eq(coshhSubstanceLocations.tenantId, ctx.tenantId));
      const activeSet = new Set(activeIds);
      const bySite = new Map<string, Array<{ substanceId: string; storageClass: string }>>();
      for (const l of allLocations) {
        if (l.siteId === null || l.storageClass === null) continue;
        if (!activeSet.has(l.substanceId)) continue;
        const list = bySite.get(l.siteId) ?? [];
        list.push({ substanceId: l.substanceId, storageClass: l.storageClass });
        bySite.set(l.siteId, list);
      }
      let storageConflicts = 0;
      for (const list of bySite.values()) {
        const seen = new Set<string>();
        for (let i = 0; i < list.length; i++) {
          for (let j = i + 1; j < list.length; j++) {
            const a = list[i];
            const b = list[j];
            if (a === undefined || b === undefined) continue;
            if (a.substanceId === b.substanceId) continue;
            if (!storageClassesConflict(a.storageClass as never, b.storageClass as never)) {
              continue;
            }
            const key = [a.substanceId, b.substanceId].sort().join(':');
            if (seen.has(key)) continue;
            seen.add(key);
            storageConflicts += 1;
          }
        }
      }

      return {
        substances: activeIds.length,
        sdsMissing,
        sdsDue,
        assessmentsDue: dueAssessments.length,
        levDue,
        levOutOfService,
        welExceedances: exceedances.length,
        storageConflicts,
      };
    }),

    substances,
    locations,
    sds,
    assessments,
    monitoring,
    lev,
    surveillance,
  });
}
