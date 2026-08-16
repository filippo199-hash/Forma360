/**
 * Fire Safety router (FreeHS module B4) — the fire risk assessment, the
 * fire safety arrangements, and the recurring checks that keep them true.
 *
 * Design goals from the practitioner spec:
 *   - fire is where the practitioner is most likely to be the named
 *     Responsible Person, so the FRA is reviewable rather than
 *     rewritable: publish stamps who attested it, reviews append to an
 *     immutable log with the trigger that prompted them, and every
 *     content change lands in the event log;
 *   - the module carries the relentless calendar: each building's
 *     profile (residential, height, storeys, installed systems) seeds
 *     the statutory check schedule — weekly alarm tests, monthly
 *     emergency lighting, extinguisher servicing, sprinkler / damper /
 *     riser regimes — and the high-rise duties from the Fire Safety
 *     (England) Regulations 2022 (secure information box, firefighting
 *     lift, wayfinding signage);
 *   - fire doors are inspectable assets: quarterly common-parts and
 *     annual flat-entrance cadences apply automatically in residential
 *     buildings above eleven metres;
 *   - significant findings that need remedial work generate actions at
 *     publish, exactly once; failed logbook checks and defective door
 *     inspections can raise actions the same way;
 *   - drills record evacuation times, muster rolls and lessons learned,
 *     and satisfy the drill schedule in the same stroke;
 *   - PEEPs and marshal rows are ended, never deleted — the record of
 *     who was covered, and when, survives;
 *   - every meaningful mutation appends to `fire_events` — evidence,
 *     not state.
 *
 * Brand gating (ADR 0010): built with `{ enabled }` wired from the active
 * brand's module catalogue; every procedure refuses when disabled.
 *
 * Deliberate v1 gaps (documented, not accidental): the hot-work /
 * ignition-source permit interface lands with the permits module (this
 * module holds no permit state to avoid a second source of truth);
 * marshal cover vs shifts and leave links to the Training module in
 * Phase 10 (training dates are carried locally until then); no email
 * digests for due checks (the in-app overview + due list carry the
 * prompts; a worker digest is scheduled with the notifications work);
 * and no dependents-registry resolver (the registry's module union is
 * closed — same status as risk assessments and COSHH).
 */
import {
  actions,
  assets,
  FIRE_CHECK_RESULTS,
  FIRE_DOOR_OUTCOMES,
  FIRE_MARSHAL_ROLES,
  FRA_REVIEW_OUTCOMES,
  FRA_REVIEW_TRIGGERS,
  FRA_STATUSES,
  fireBuildings,
  fireDoorInspections,
  fireDoors,
  fireDrills,
  fireEvents,
  fireFraReviews,
  fireLogbookChecks,
  fireLogbookEntries,
  fireMarshals,
  firePeeps,
  fireFraVersions,
  fireRiskAssessments,
  fireSafetySettings,
  trainingRequirements,
  fireSignificantFindings,
  sites,
  user,
  type FireBuilding,
  type FireEventEntityType,
  type FireEventKind,
  type FireLogbookCheck,
} from '@forma360/db/schema';
import type { Database } from '@forma360/db/client';
import {
  addMonthsClamped,
  buildingDocumentSchema,
  CHECK_FREQUENCIES,
  checkDisplayStatus,
  DEFAULT_PEEP_REVIEW_MONTHS,
  doorChecklistSchema,
  doorDisplayStatus,
  doorDueStatus,
  doorInspectionIntervalMonths,
  FIRE_CHECK_TYPE_SPECS,
  FIRE_CHECK_TYPES,
  FIRE_DOOR_LOCATION_KINDS,
  FRA_FINDING_CATEGORIES,
  FRA_FINDING_PRIORITIES,
  FRA_METHODOLOGIES,
  FRA_RISK_RATINGS,
  buildFraVersionContent,
  drillActionPriority,
  drillConcerns,
  isAbove11mResidential,
  isHighRiseResidential,
  marshalCompetence,
  marshalTrainingStatus,
  nextDueDate,
  requiredCheckTypesFor,
  suggestedFraReviewMonths,
  type CheckDisplayStatus,
  type CheckDueStatus,
  type FireBuildingProfile,
  type FireCheckType,
  type MarshalCompetence,
} from '@forma360/shared/fire-safety';
import { loadMarshalRequirementIds, resolveMarshalCompetence } from '../marshal-competence';
import { appLink } from '@forma360/shared/app-link';
import { newId } from '@forma360/shared/id';
import { usersHoldingPermission } from '@forma360/permissions/holders';
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, inArray, isNull, lte, ne } from 'drizzle-orm';
import { z } from 'zod';
import { nextReferenceValue } from '../reference-counter';
import { assertUsersInTenant } from '../tenant-guards';
import { emailEnabledFor, loadNotificationPrefs, notifyInApp } from '../notify';
import { requirePermission, tenantProcedure } from '../procedures';
import { router } from '../trpc';

export interface FireSafetyRouterDeps {
  /** Wired from the brand module catalogue (ADR 0010). */
  enabled: boolean;
  /** Base URL for links in alert emails; absent = relative links. */
  appUrl?: string;
  /**
   * FRA → PDF (HSE review FS-5). Optional: absent in non-web callers —
   * `fras.renderPdf` refuses when unwired rather than half-rendering.
   */
  renderPdf?: (input: {
    tenantId: string;
    fraId: string;
  }) => Promise<{ key: string; bytes: number; cached: boolean; stub: boolean }>;
  /**
   * Fire drill → PDF (the drill record as a filable logbook page).
   * Optional: absent in non-web callers — `drills.renderPdf` refuses
   * when unwired rather than half-rendering.
   */
  renderDrillPdf?: (input: {
    tenantId: string;
    drillId: string;
  }) => Promise<{ key: string; bytes: number; cached: boolean; stub: boolean }>;
  /**
   * Building → PEEP night pack PDF (care persona): current PEEPs +
   * marshal roster as one printable sheet for the night desk. Optional:
   * absent in non-web callers — `buildings.renderNightPackPdf` refuses
   * when unwired rather than half-rendering.
   */
  renderNightPackPdf?: (input: {
    tenantId: string;
    buildingId: string;
  }) => Promise<{ key: string; bytes: number; cached: boolean; stub: boolean }>;
  /**
   * Escalation email dispatch (HSE review FS-6): an intolerable FRA
   * publish alerts every `fireSafety.manage` holder. Optional — tests
   * stub it; the web wiring provides the real dispatcher.
   */
  sendAlertEmail?: (input: {
    to: string;
    /**
     * DOC-A01: the recipient's language, so the body follows the link.
     * `string | undefined` rather than `| null` to match `TemplatedEmail`
     * under exactOptionalPropertyTypes — the call site spreads it in only
     * when a locale exists.
     */
    locale?: string | undefined;
    templateKey: string;
    variables: Record<string, string>;
  }) => Promise<unknown>;
}

/** The statutory-duty summary every building read returns. */
export interface FireDutyProfile {
  highRiseResidential: boolean;
  above11mResidential: boolean;
  requiredCheckTypes: FireCheckType[];
}

function profileOf(building: FireBuilding): FireBuildingProfile {
  return {
    isResidential: building.isResidential,
    heightMetres: building.heightMetres,
    storeys: building.storeys,
    hasFireAlarm: building.hasFireAlarm,
    hasEmergencyLighting: building.hasEmergencyLighting,
    hasSprinklers: building.hasSprinklers,
    hasDampers: building.hasDampers,
    hasRisers: building.hasRisers,
  };
}

function dutyProfileOf(building: FireBuilding): FireDutyProfile {
  const profile = profileOf(building);
  return {
    highRiseResidential: isHighRiseResidential(profile),
    above11mResidential: isAbove11mResidential(profile),
    requiredCheckTypes: requiredCheckTypesFor(profile),
  };
}

/** Load a building scoped to the tenant or throw NOT_FOUND. */
async function loadBuilding(db: Database, tenantId: string, buildingId: string) {
  const rows = await db
    .select()
    .from(fireBuildings)
    .where(and(eq(fireBuildings.id, buildingId), eq(fireBuildings.tenantId, tenantId)))
    .limit(1);
  const building = rows[0];
  if (building === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
  return building;
}

/** Load an FRA scoped to the tenant or throw NOT_FOUND. */
async function loadFra(db: Database, tenantId: string, fraId: string) {
  const rows = await db
    .select()
    .from(fireRiskAssessments)
    .where(and(eq(fireRiskAssessments.id, fraId), eq(fireRiskAssessments.tenantId, tenantId)))
    .limit(1);
  const fra = rows[0];
  if (fra === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
  return fra;
}

/** Load a door scoped to the tenant or throw NOT_FOUND. */
async function loadDoor(db: Database, tenantId: string, doorId: string) {
  const rows = await db
    .select()
    .from(fireDoors)
    .where(and(eq(fireDoors.id, doorId), eq(fireDoors.tenantId, tenantId)))
    .limit(1);
  const door = rows[0];
  if (door === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
  return door;
}

/** Load a PEEP scoped to the tenant or throw NOT_FOUND. */
async function loadPeep(db: Database, tenantId: string, peepId: string) {
  const rows = await db
    .select()
    .from(firePeeps)
    .where(and(eq(firePeeps.id, peepId), eq(firePeeps.tenantId, tenantId)))
    .limit(1);
  const peep = rows[0];
  if (peep === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
  return peep;
}

/**
 * Load a site scoped to the tenant or throw. The FK alone only proves the
 * site exists — this is what stops a crafted request linking a building to
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

/** Append one immutable change-log row. Never updated or deleted. */
async function logEvent(
  db: Database,
  entry: {
    tenantId: string;
    entityType: FireEventEntityType;
    entityId: string;
    actorUserId: string;
    kind: FireEventKind;
    detail?: string;
  },
): Promise<void> {
  await db.insert(fireEvents).values({
    id: newId(),
    tenantId: entry.tenantId,
    entityType: entry.entityType,
    entityId: entry.entityId,
    actorUserId: entry.actorUserId,
    kind: entry.kind,
    detail: entry.detail ?? '',
  });
}

/**
 * Reconcile a building's auto-seeded check schedule with its current
 * profile. Adds missing applicable checks, re-activates auto checks that
 * became applicable again, deactivates auto checks that no longer apply.
 * Manual checks are never touched. Idempotent.
 */
async function syncAutoChecks(
  db: Database,
  tenantId: string,
  building: FireBuilding,
  now: Date,
): Promise<{ added: number; deactivated: number }> {
  const required = new Set<FireCheckType>(requiredCheckTypesFor(profileOf(building)));
  const existing = await db
    .select()
    .from(fireLogbookChecks)
    .where(eq(fireLogbookChecks.buildingId, building.id));
  const byType = new Map(existing.map((c) => [c.checkType, c]));

  let added = 0;
  let deactivated = 0;

  for (const type of required) {
    const current = byType.get(type);
    if (current === undefined) {
      const frequency = FIRE_CHECK_TYPE_SPECS[type].defaultFrequency;
      await db.insert(fireLogbookChecks).values({
        id: newId(),
        tenantId,
        buildingId: building.id,
        checkType: type,
        frequency,
        source: 'auto',
        active: true,
        // The first cycle starts from setup — the calendar begins when
        // the logbook does.
        nextDueAt: nextDueDate(now, frequency),
      });
      added += 1;
    } else if (!current.active && current.source === 'auto' && current.dismissedAt === null) {
      // A dismissed row was REMOVED by a manager — a profile edit must
      // not resurrect it. Plain deactivations (profile made the check
      // inapplicable) do come back when the profile re-applies.
      await db
        .update(fireLogbookChecks)
        .set({
          active: true,
          nextDueAt: nextDueDate(current.lastDoneAt ?? now, current.frequency),
          updatedAt: now,
        })
        .where(eq(fireLogbookChecks.id, current.id));
      added += 1;
    }
  }

  for (const check of existing) {
    // Custom checks are always manual, but the guard also narrows the
    // row's LogbookCheckType to a catalogue FireCheckType.
    if (
      check.source === 'auto' &&
      check.active &&
      check.checkType !== 'custom' &&
      !required.has(check.checkType)
    ) {
      await db
        .update(fireLogbookChecks)
        .set({ active: false, updatedAt: now })
        .where(eq(fireLogbookChecks.id, check.id));
      deactivated += 1;
    }
  }

  return { added, deactivated };
}

/**
 * Stamp an FRA's content clock (HSE review FS-7). Compared against
 * `publishedAt`: an active FRA whose content moved after sign-off is
 * flagged attestation-stale until the RP re-attests (re-publishes).
 */
/**
 * FS-G05: refuse a content change that has no signed copy behind it.
 *
 * Editing a LIVE assessment in place is deliberate and documented — ADR
 * 0011 §1 chose it for risk assessments, and FS-E29 asserts it here: the
 * amber "attestation stale" banner is the whole point. What made it unsafe
 * was that the working row was the only copy in existence, so an edit to a
 * signed FRA destroyed the evidence of what was signed.
 *
 * Now a published FRA always has a frozen version, so the edit is safe by
 * construction. This guard catches the one remaining case: an FRA carrying
 * a sign-off stamp from BEFORE this migration, which has `currentVersion`
 * 0 and therefore no snapshot to fall back on. Those must be re-published
 * (re-attested) before their content can move again — the alternative is
 * to keep silently destroying the only copy of a statutory document.
 */
function assertFraContentEditable(fra: { publishedAt: Date | null; currentVersion: number }): void {
  if (fra.publishedAt !== null && fra.currentVersion === 0) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'signed-without-snapshot',
    });
  }
}

/**
 * FS-X01: refuse a hand-typed competence date once the tenant has said
 * which training requirement is the fire-marshal ticket.
 *
 * The fields cannot simply be removed — Training (B7) is brand-gated, so on
 * a deployment without it these dates are the only way to record marshal
 * competence at all. But they must not stay freely writable once a
 * designation exists: a value the system will immediately label "unbacked"
 * is a lie with a footnote, and accepting it silently teaches people to
 * keep maintaining both registers, which is the whole defect.
 *
 * Clearing to `null` is ALWAYS allowed — that is how an administrator
 * retires a legacy unbacked date.
 */
async function assertMarshalDatesAllowed(
  db: Database,
  tenantId: string,
  input: { trainedAt?: Date | null | undefined; trainingExpiresAt?: Date | null | undefined },
): Promise<void> {
  const settingDates = input.trainedAt != null || input.trainingExpiresAt != null;
  if (!settingDates) return;
  const designated = await loadMarshalRequirementIds(db, tenantId);
  if (designated.length > 0) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'training-matrix-is-source',
    });
  }
}

async function touchFraContent(db: Database, fraId: string, now: Date): Promise<void> {
  await db
    .update(fireRiskAssessments)
    .set({ contentUpdatedAt: now, updatedAt: now })
    .where(eq(fireRiskAssessments.id, fraId));
}

function checkWithStatus(check: FireLogbookCheck, now: Date) {
  return {
    ...check,
    // FS-1: the calendar never shows a failed check as green — a 'fail'
    // holds the red state regardless of the advanced due date.
    dueStatus: checkDisplayStatus(
      check.nextDueAt,
      check.frequency,
      check.lastResult,
      now,
    ) satisfies CheckDisplayStatus,
  };
}

/** Door interval, months — regime-derived unless the door overrides it. */
function doorIntervalMonths(
  door: { locationKind: (typeof FIRE_DOOR_LOCATION_KINDS)[number]; override: number | null },
  building: FireBuilding,
): number {
  return doorInspectionIntervalMonths(door.locationKind, profileOf(building), door.override);
}

/**
 * NR3-10: one verdict per marshal row. Account-backed marshals get the
 * matrix-reconciled verdict (FS-X01); free-text marshals can never be
 * matrix-backed, so their verdict comes from the pure decision with no
 * governing record — `local`+unbacked on a designated tenant, `none`
 * otherwise. Never let a free-text row read as training-verified.
 */
function marshalVerdict(
  m: { userId: string | null; trainedAt: Date | null; trainingExpiresAt: Date | null },
  competence: ReadonlyMap<string | null, MarshalCompetence>,
  designated: boolean,
  now: Date,
): MarshalCompetence {
  if (m.userId !== null) {
    return (
      competence.get(m.userId) ?? {
        status: marshalTrainingStatus(m, now),
        source: 'none',
        unbacked: false,
        conflictsWithLocal: false,
      }
    );
  }
  return marshalCompetence(m, null, now, designated);
}

/**
 * Whether the tenant designated marshal tickets (FS-X01) — only needed
 * when free-text marshal rows are present, so callers gate the query.
 */
async function marshalDesignationExists(db: Database, tenantId: string): Promise<boolean> {
  return (await loadMarshalRequirementIds(db, tenantId)).length > 0;
}

async function userNamesById(
  db: Database,
  tenantId: string,
  userIds: ReadonlyArray<string | null>,
): Promise<Map<string, string>> {
  const distinct = [...new Set(userIds)].filter((v): v is string => v !== null && v.length > 0);
  if (distinct.length === 0) return new Map();
  const rows = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(and(eq(user.tenantId, tenantId), inArray(user.id, distinct)));
  return new Map(rows.map((r) => [r.id, r.name]));
}

// ─── Zod inputs ─────────────────────────────────────────────────────────────

const buildingFieldsInput = {
  name: z.string().min(1).max(300),
  siteId: z.string().length(26).nullable().optional(),
  address: z.string().max(1000).default(''),
  useDescription: z.string().max(2000).default(''),
  isResidential: z.boolean().default(false),
  heightMetres: z.number().positive().max(1000).nullable().optional(),
  storeys: z.number().int().min(1).max(200).nullable().optional(),
  hasFireAlarm: z.boolean().default(true),
  hasEmergencyLighting: z.boolean().default(true),
  hasSprinklers: z.boolean().default(false),
  hasDampers: z.boolean().default(false),
  hasRisers: z.boolean().default(false),
  externalWallSystem: z.string().max(4000).default(''),
  compartmentationNotes: z.string().max(4000).default(''),
  meansOfEscapeNotes: z.string().max(4000).default(''),
  serviceRisersNotes: z.string().max(4000).default(''),
  secureInfoBoxLocation: z.string().max(500).default(''),
  infoDocuments: z.array(buildingDocumentSchema).max(50).default([]),
};

const buildingUpdateInput = z.object({
  buildingId: z.string().length(26),
  name: z.string().min(1).max(300).optional(),
  siteId: z.string().length(26).nullable().optional(),
  address: z.string().max(1000).optional(),
  useDescription: z.string().max(2000).optional(),
  isResidential: z.boolean().optional(),
  heightMetres: z.number().positive().max(1000).nullable().optional(),
  storeys: z.number().int().min(1).max(200).nullable().optional(),
  hasFireAlarm: z.boolean().optional(),
  hasEmergencyLighting: z.boolean().optional(),
  hasSprinklers: z.boolean().optional(),
  hasDampers: z.boolean().optional(),
  hasRisers: z.boolean().optional(),
  externalWallSystem: z.string().max(4000).optional(),
  compartmentationNotes: z.string().max(4000).optional(),
  meansOfEscapeNotes: z.string().max(4000).optional(),
  serviceRisersNotes: z.string().max(4000).optional(),
  secureInfoBoxLocation: z.string().max(500).optional(),
  infoDocuments: z.array(buildingDocumentSchema).max(50).optional(),
  requiresMarshalCover: z.boolean().optional(),
  marshalTarget: z.number().int().min(1).max(50).optional(),
});

const fraUpdateInput = z.object({
  fraId: z.string().length(26),
  title: z.string().min(1).max(300).optional(),
  buildingId: z.string().length(26).nullable().optional(),
  premisesDescription: z.string().max(4000).optional(),
  methodology: z.enum(FRA_METHODOLOGIES).optional(),
  responsiblePersonName: z.string().max(300).optional(),
  assessorUserId: z.string().nullable().optional(),
  assessorName: z.string().max(300).optional(),
  personsAtRisk: z.array(z.string().min(1).max(100)).max(20).optional(),
  maxOccupancy: z.number().int().min(0).max(1_000_000).nullable().optional(),
  sleepingOccupants: z.boolean().optional(),
  ignitionSources: z.string().max(8000).optional(),
  fuelSources: z.string().max(8000).optional(),
  oxygenSources: z.string().max(8000).optional(),
  evaluationNotes: z.string().max(8000).optional(),
  riskRating: z.enum(FRA_RISK_RATINGS).nullable().optional(),
  reviewFrequencyMonths: z.number().int().min(1).max(60).nullable().optional(),
});

const findingInput = z.object({
  fraId: z.string().length(26),
  category: z.enum(FRA_FINDING_CATEGORIES),
  priority: z.enum(FRA_FINDING_PRIORITIES).default('medium'),
  description: z.string().min(1).max(4000),
  requiresAction: z.boolean().default(true),
});

export function createFireSafetyRouter(deps: FireSafetyRouterDeps) {
  function assertEnabled(): void {
    if (!deps.enabled) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'module-disabled' });
    }
  }

  const buildings = router({
    list: tenantProcedure
      .use(requirePermission('fireSafety.view'))
      .input(
        z
          .object({
            status: z.enum(['active', 'archived', 'all']).default('active'),
            search: z.string().max(200).optional(),
            /** Scope the estate to one site (multi-site FM view). */
            siteId: z.string().length(26).optional(),
          })
          .default({ status: 'active' }),
      )
      .query(async ({ ctx, input }) => {
        assertEnabled();
        const conditions = [eq(fireBuildings.tenantId, ctx.tenantId)];
        if (input.status !== 'all') {
          conditions.push(eq(fireBuildings.status, input.status));
        }
        if (input.siteId !== undefined) {
          conditions.push(eq(fireBuildings.siteId, input.siteId));
        }
        const joined = await ctx.db
          .select({ building: fireBuildings, siteName: sites.name })
          .from(fireBuildings)
          .leftJoin(sites, eq(fireBuildings.siteId, sites.id))
          .where(and(...conditions))
          .orderBy(asc(fireBuildings.name));
        const rows = joined.map((r) => ({ ...r.building, siteName: r.siteName }));
        const search = input.search?.trim().toLowerCase();
        const filtered =
          search !== undefined && search.length > 0
            ? rows.filter((r) => r.name.toLowerCase().includes(search))
            : rows;
        const ids = filtered.map((r) => r.id);
        if (ids.length === 0) return [];

        const now = new Date();
        const [checks, doors, fras] = await Promise.all([
          ctx.db
            .select()
            .from(fireLogbookChecks)
            .where(
              and(inArray(fireLogbookChecks.buildingId, ids), eq(fireLogbookChecks.active, true)),
            ),
          ctx.db
            .select()
            .from(fireDoors)
            .where(and(inArray(fireDoors.buildingId, ids), eq(fireDoors.status, 'active'))),
          ctx.db
            .select({
              id: fireRiskAssessments.id,
              buildingId: fireRiskAssessments.buildingId,
              status: fireRiskAssessments.status,
              riskRating: fireRiskAssessments.riskRating,
              nextReviewAt: fireRiskAssessments.nextReviewAt,
            })
            .from(fireRiskAssessments)
            .where(
              and(
                eq(fireRiskAssessments.tenantId, ctx.tenantId),
                inArray(fireRiskAssessments.buildingId, ids),
              ),
            ),
        ]);

        const buildingById = new Map(filtered.map((b) => [b.id, b]));
        return filtered.map((building) => {
          const duty = dutyProfileOf(building);
          const buildingChecks = checks.filter((c) => c.buildingId === building.id);
          let checksOverdue = 0;
          let checksDueSoon = 0;
          let checksFailed = 0;
          for (const check of buildingChecks) {
            const status = checkDisplayStatus(
              check.nextDueAt,
              check.frequency,
              check.lastResult,
              now,
            );
            if (status === 'failed') checksFailed += 1;
            else if (status === 'overdue') checksOverdue += 1;
            else if (status === 'due_soon') checksDueSoon += 1;
          }
          let doorsOverdue = 0;
          let doorsFailed = 0;
          for (const door of doors.filter((d) => d.buildingId === building.id)) {
            const parent = buildingById.get(door.buildingId);
            if (parent === undefined) continue;
            const interval = doorIntervalMonths(
              { locationKind: door.locationKind, override: door.inspectionIntervalMonthsOverride },
              parent,
            );
            const status = doorDisplayStatus(
              door.nextInspectionDueAt,
              interval,
              door.lastOutcome,
              now,
            );
            if (status === 'failed') doorsFailed += 1;
            else if (status === 'overdue') doorsOverdue += 1;
          }
          const buildingFras = fras.filter((f) => f.buildingId === building.id);
          const activeFra = buildingFras.find((f) => f.status === 'active');
          return {
            ...building,
            duty,
            checksOverdue,
            checksDueSoon,
            checksFailed,
            doorsOverdue,
            doorsFailed,
            doorCount: doors.filter((d) => d.buildingId === building.id).length,
            hasActiveFra: activeFra !== undefined,
            activeFraRating: activeFra?.riskRating ?? null,
            fraReviewDue:
              activeFra?.nextReviewAt !== null &&
              activeFra?.nextReviewAt !== undefined &&
              activeFra.nextReviewAt <= now,
          };
        });
      }),

    get: tenantProcedure
      .use(requirePermission('fireSafety.view'))
      .input(z.object({ buildingId: z.string().length(26) }))
      .query(async ({ ctx, input }) => {
        assertEnabled();
        const building = await loadBuilding(ctx.db, ctx.tenantId, input.buildingId);
        const now = new Date();

        const [checks, doors, drills, peeps, marshals, fras, entries, events] = await Promise.all([
          ctx.db
            .select()
            .from(fireLogbookChecks)
            .where(
              and(
                eq(fireLogbookChecks.buildingId, building.id),
                isNull(fireLogbookChecks.dismissedAt),
              ),
            )
            .orderBy(asc(fireLogbookChecks.nextDueAt)),
          ctx.db
            .select()
            .from(fireDoors)
            .where(eq(fireDoors.buildingId, building.id))
            .orderBy(asc(fireDoors.doorRef)),
          ctx.db
            .select()
            .from(fireDrills)
            .where(eq(fireDrills.buildingId, building.id))
            .orderBy(desc(fireDrills.conductedAt))
            .limit(20),
          ctx.db
            .select()
            .from(firePeeps)
            .where(eq(firePeeps.buildingId, building.id))
            .orderBy(asc(firePeeps.personName)),
          ctx.db
            .select()
            .from(fireMarshals)
            .where(eq(fireMarshals.buildingId, building.id))
            .orderBy(asc(fireMarshals.createdAt)),
          ctx.db
            .select()
            .from(fireRiskAssessments)
            .where(eq(fireRiskAssessments.buildingId, building.id))
            .orderBy(desc(fireRiskAssessments.updatedAt)),
          ctx.db
            .select()
            .from(fireLogbookEntries)
            .where(eq(fireLogbookEntries.buildingId, building.id))
            .orderBy(desc(fireLogbookEntries.performedAt))
            .limit(30),
          ctx.db
            .select()
            .from(fireEvents)
            .where(
              and(
                eq(fireEvents.tenantId, ctx.tenantId),
                eq(fireEvents.entityType, 'building'),
                eq(fireEvents.entityId, building.id),
              ),
            )
            .orderBy(desc(fireEvents.createdAt))
            .limit(50),
        ]);

        const siteName =
          building.siteId !== null
            ? ((
                await ctx.db
                  .select({ name: sites.name })
                  .from(sites)
                  .where(and(eq(sites.id, building.siteId), eq(sites.tenantId, ctx.tenantId)))
                  .limit(1)
              )[0]?.name ?? null)
            : null;

        const names = await userNamesById(ctx.db, ctx.tenantId, [
          ...marshals.map((m) => m.userId),
          ...entries.map((e) => e.performedBy),
        ]);

        // FS-X01: this is the read the building page renders. `marshals.list`
        // reconciled against the training matrix and this one did not, so the
        // marshals tab — the surface a fire officer actually inspects — kept
        // showing the hand-typed local dates. One fact, one verdict, every
        // read.
        const marshalCompetenceById = await resolveMarshalCompetence(
          ctx.db,
          ctx.tenantId,
          marshals,
          now,
        );
        const marshalDesignated =
          marshals.some((m) => m.userId === null) &&
          (await marshalDesignationExists(ctx.db, ctx.tenantId));

        return {
          ...building,
          siteName,
          duty: dutyProfileOf(building),
          checks: checks.map((c) => checkWithStatus(c, now)),
          doors: doors.map((door) => {
            const interval = doorIntervalMonths(
              { locationKind: door.locationKind, override: door.inspectionIntervalMonthsOverride },
              building,
            );
            return {
              ...door,
              intervalMonths: interval,
              dueStatus:
                door.status === 'active'
                  ? doorDisplayStatus(door.nextInspectionDueAt, interval, door.lastOutcome, now)
                  : ('ok' satisfies CheckDisplayStatus),
            };
          }),
          drills,
          peeps,
          marshals: marshals.map((m) => {
            const c = marshalVerdict(m, marshalCompetenceById, marshalDesignated, now);
            return {
              ...m,
              userName:
                m.userId !== null
                  ? (names.get(m.userId) ?? null)
                  : m.personName !== ''
                    ? m.personName
                    : null,
              trainingStatus: c.status,
              competenceSource: c.source,
              unbacked: c.unbacked,
              conflictsWithLocal: c.conflictsWithLocal,
            };
          }),
          fras,
          recentEntries: entries.map((e) => ({
            ...e,
            performedByName: names.get(e.performedBy) ?? null,
          })),
          events,
        };
      }),

    create: tenantProcedure
      .use(requirePermission('fireSafety.create'))
      .input(z.object(buildingFieldsInput))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        if (input.siteId !== null && input.siteId !== undefined) {
          await loadSiteInTenant(ctx.db, ctx.tenantId, input.siteId);
        }
        const id = newId();
        const now = new Date();
        await ctx.db.insert(fireBuildings).values({
          id,
          tenantId: ctx.tenantId,
          name: input.name,
          siteId: input.siteId ?? null,
          address: input.address,
          useDescription: input.useDescription,
          isResidential: input.isResidential,
          heightMetres: input.heightMetres ?? null,
          storeys: input.storeys ?? null,
          hasFireAlarm: input.hasFireAlarm,
          hasEmergencyLighting: input.hasEmergencyLighting,
          hasSprinklers: input.hasSprinklers,
          hasDampers: input.hasDampers,
          hasRisers: input.hasRisers,
          externalWallSystem: input.externalWallSystem,
          compartmentationNotes: input.compartmentationNotes,
          meansOfEscapeNotes: input.meansOfEscapeNotes,
          serviceRisersNotes: input.serviceRisersNotes,
          secureInfoBoxLocation: input.secureInfoBoxLocation,
          infoDocuments: input.infoDocuments,
          createdBy: ctx.auth.userId,
        });
        const building = await loadBuilding(ctx.db, ctx.tenantId, id);
        const seeded = await syncAutoChecks(ctx.db, ctx.tenantId, building, now);
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'building',
          entityId: id,
          actorUserId: ctx.auth.userId,
          kind: 'created',
          detail: building.name,
        });
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'building',
          entityId: id,
          actorUserId: ctx.auth.userId,
          kind: 'checks_seeded',
          detail: String(seeded.added),
        });
        ctx.logger.info(
          { buildingId: id, checksSeeded: seeded.added },
          '[fireSafety] building created',
        );
        return { id, checksSeeded: seeded.added };
      }),

    update: tenantProcedure
      .use(requirePermission('fireSafety.manage'))
      .input(buildingUpdateInput)
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const building = await loadBuilding(ctx.db, ctx.tenantId, input.buildingId);
        if (building.archivedAt !== null) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'archived' });
        }
        if (input.siteId !== null && input.siteId !== undefined) {
          await loadSiteInTenant(ctx.db, ctx.tenantId, input.siteId);
        }
        const patch = input;
        const now = new Date();
        await ctx.db
          .update(fireBuildings)
          .set({
            ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
            ...(patch.siteId !== undefined ? { siteId: patch.siteId } : {}),
            ...(patch.address !== undefined ? { address: patch.address } : {}),
            ...(patch.useDescription !== undefined ? { useDescription: patch.useDescription } : {}),
            ...(patch.isResidential !== undefined ? { isResidential: patch.isResidential } : {}),
            ...(patch.heightMetres !== undefined ? { heightMetres: patch.heightMetres } : {}),
            ...(patch.storeys !== undefined ? { storeys: patch.storeys } : {}),
            ...(patch.hasFireAlarm !== undefined ? { hasFireAlarm: patch.hasFireAlarm } : {}),
            ...(patch.hasEmergencyLighting !== undefined
              ? { hasEmergencyLighting: patch.hasEmergencyLighting }
              : {}),
            ...(patch.hasSprinklers !== undefined ? { hasSprinklers: patch.hasSprinklers } : {}),
            ...(patch.hasDampers !== undefined ? { hasDampers: patch.hasDampers } : {}),
            ...(patch.hasRisers !== undefined ? { hasRisers: patch.hasRisers } : {}),
            ...(patch.externalWallSystem !== undefined
              ? { externalWallSystem: patch.externalWallSystem }
              : {}),
            ...(patch.compartmentationNotes !== undefined
              ? { compartmentationNotes: patch.compartmentationNotes }
              : {}),
            ...(patch.meansOfEscapeNotes !== undefined
              ? { meansOfEscapeNotes: patch.meansOfEscapeNotes }
              : {}),
            ...(patch.serviceRisersNotes !== undefined
              ? { serviceRisersNotes: patch.serviceRisersNotes }
              : {}),
            ...(patch.secureInfoBoxLocation !== undefined
              ? { secureInfoBoxLocation: patch.secureInfoBoxLocation }
              : {}),
            ...(patch.infoDocuments !== undefined ? { infoDocuments: patch.infoDocuments } : {}),
            ...(patch.requiresMarshalCover !== undefined
              ? { requiresMarshalCover: patch.requiresMarshalCover }
              : {}),
            ...(patch.marshalTarget !== undefined ? { marshalTarget: patch.marshalTarget } : {}),
            updatedAt: now,
          })
          .where(eq(fireBuildings.id, building.id));
        // Profile changes move statutory duties — reconcile the calendar
        // in the same stroke.
        const updated = await loadBuilding(ctx.db, ctx.tenantId, building.id);
        const synced = await syncAutoChecks(ctx.db, ctx.tenantId, updated, now);
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'building',
          entityId: building.id,
          actorUserId: ctx.auth.userId,
          kind: 'updated',
        });
        return { ok: true, checksAdded: synced.added, checksDeactivated: synced.deactivated };
      }),

    /** Re-sync the auto-seeded calendar with the current profile. */
    setupChecks: tenantProcedure
      .use(requirePermission('fireSafety.manage'))
      .input(z.object({ buildingId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const building = await loadBuilding(ctx.db, ctx.tenantId, input.buildingId);
        if (building.archivedAt !== null) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'archived' });
        }
        const result = await syncAutoChecks(ctx.db, ctx.tenantId, building, new Date());
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'building',
          entityId: building.id,
          actorUserId: ctx.auth.userId,
          kind: 'checks_seeded',
          detail: String(result.added),
        });
        return result;
      }),

    archive: tenantProcedure
      .use(requirePermission('fireSafety.manage'))
      .input(z.object({ buildingId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const building = await loadBuilding(ctx.db, ctx.tenantId, input.buildingId);
        if (building.archivedAt !== null) return { ok: true };
        const now = new Date();
        await ctx.db.transaction(async (tx) => {
          await tx
            .update(fireBuildings)
            .set({ status: 'archived', archivedAt: now, updatedAt: now })
            .where(eq(fireBuildings.id, building.id));
          // The calendar stops with the building; history stays readable.
          await tx
            .update(fireLogbookChecks)
            .set({ active: false, updatedAt: now })
            .where(eq(fireLogbookChecks.buildingId, building.id));
        });
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'building',
          entityId: building.id,
          actorUserId: ctx.auth.userId,
          kind: 'archived',
        });
        return { ok: true };
      }),

    /**
     * The PEEP night pack as a document — current PEEPs, marshal roster
     * and secure-info-box location on one printable sheet for the night
     * desk. Renders via the shared Puppeteer pipeline into R2; the
     * exports route delivers it. Mirrors `drills.renderPdf`. Kept behind
     * `fireSafety.view` with no share-token path: assistance needs are
     * health-adjacent (see the FRA PDF's treatment).
     */
    renderNightPackPdf: tenantProcedure
      .use(requirePermission('fireSafety.view'))
      .input(z.object({ buildingId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        if (deps.renderNightPackPdf === undefined) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'render-unavailable' });
        }
        // Tenant check before handing the id to the renderer.
        await loadBuilding(ctx.db, ctx.tenantId, input.buildingId);
        const rendered = await deps.renderNightPackPdf({
          tenantId: ctx.tenantId,
          buildingId: input.buildingId,
        });
        return {
          storageKey: rendered.key,
          filename: 'night-pack.pdf',
          sizeBytes: rendered.bytes,
          stub: rendered.stub,
        };
      }),
  });

  const fras = router({
    list: tenantProcedure
      .use(requirePermission('fireSafety.view'))
      .input(
        z
          .object({
            status: z.enum([...FRA_STATUSES, 'all'] as const).default('all'),
            buildingId: z.string().length(26).optional(),
          })
          .default({ status: 'all' }),
      )
      .query(async ({ ctx, input }) => {
        assertEnabled();
        const conditions = [eq(fireRiskAssessments.tenantId, ctx.tenantId)];
        if (input.status !== 'all') {
          conditions.push(eq(fireRiskAssessments.status, input.status));
        }
        if (input.buildingId !== undefined) {
          conditions.push(eq(fireRiskAssessments.buildingId, input.buildingId));
        }
        const rows = await ctx.db
          .select()
          .from(fireRiskAssessments)
          .where(and(...conditions))
          .orderBy(desc(fireRiskAssessments.updatedAt));
        const ids = rows.map((r) => r.id);
        if (ids.length === 0) return [];
        const findings = await ctx.db
          .select({
            id: fireSignificantFindings.id,
            fraId: fireSignificantFindings.fraId,
            resolvedAt: fireSignificantFindings.resolvedAt,
          })
          .from(fireSignificantFindings)
          .where(inArray(fireSignificantFindings.fraId, ids));
        const buildingIds = rows.map((r) => r.buildingId).filter((v): v is string => v !== null);
        const buildingNames =
          buildingIds.length > 0
            ? new Map(
                (
                  await ctx.db
                    .select({ id: fireBuildings.id, name: fireBuildings.name })
                    .from(fireBuildings)
                    .where(inArray(fireBuildings.id, [...new Set(buildingIds)]))
                ).map((b) => [b.id, b.name]),
              )
            : new Map<string, string>();
        const now = new Date();
        return rows.map((fra) => {
          const fraFindings = findings.filter((f) => f.fraId === fra.id);
          return {
            ...fra,
            buildingName:
              fra.buildingId !== null ? (buildingNames.get(fra.buildingId) ?? null) : null,
            findingCount: fraFindings.length,
            openFindingCount: fraFindings.filter((f) => f.resolvedAt === null).length,
            reviewDue:
              fra.status === 'active' && fra.nextReviewAt !== null && fra.nextReviewAt <= now,
          };
        });
      }),

    get: tenantProcedure
      .use(requirePermission('fireSafety.view'))
      .input(z.object({ fraId: z.string().length(26) }))
      .query(async ({ ctx, input }) => {
        assertEnabled();
        const fra = await loadFra(ctx.db, ctx.tenantId, input.fraId);
        const [findings, reviews, events] = await Promise.all([
          ctx.db
            .select()
            .from(fireSignificantFindings)
            .where(eq(fireSignificantFindings.fraId, fra.id))
            .orderBy(
              asc(fireSignificantFindings.sortOrder),
              asc(fireSignificantFindings.createdAt),
            ),
          ctx.db
            .select()
            .from(fireFraReviews)
            .where(eq(fireFraReviews.fraId, fra.id))
            .orderBy(desc(fireFraReviews.reviewedAt)),
          ctx.db
            .select()
            .from(fireEvents)
            .where(
              and(
                eq(fireEvents.tenantId, ctx.tenantId),
                eq(fireEvents.entityType, 'fra'),
                eq(fireEvents.entityId, fra.id),
              ),
            )
            .orderBy(desc(fireEvents.createdAt))
            .limit(50),
        ]);
        const building =
          fra.buildingId !== null
            ? ((
                await ctx.db
                  .select({ id: fireBuildings.id, name: fireBuildings.name })
                  .from(fireBuildings)
                  .where(eq(fireBuildings.id, fra.buildingId))
                  .limit(1)
              )[0] ?? null)
            : null;
        const names = await userNamesById(
          ctx.db,
          ctx.tenantId,
          [fra.publishedBy, fra.assessorUserId].filter((v): v is string => v !== null),
        );
        return {
          ...fra,
          building,
          findings,
          reviews,
          events,
          publishedByName: fra.publishedBy !== null ? (names.get(fra.publishedBy) ?? null) : null,
          // FS-7: the signature only covers the content it signed.
          attestationStale:
            fra.status === 'active' &&
            fra.publishedAt !== null &&
            fra.contentUpdatedAt !== null &&
            fra.contentUpdatedAt.getTime() > fra.publishedAt.getTime(),
        };
      }),

    create: tenantProcedure
      .use(requirePermission('fireSafety.create'))
      .input(
        z.object({
          title: z.string().min(1).max(300),
          buildingId: z.string().length(26).nullable().optional(),
          methodology: z.enum(FRA_METHODOLOGIES).default('pas79'),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        if (input.buildingId !== null && input.buildingId !== undefined) {
          await loadBuilding(ctx.db, ctx.tenantId, input.buildingId);
        }
        const n = await nextReferenceValue(ctx.db, ctx.tenantId, 'fireRiskAssessment');
        const id = newId();
        await ctx.db.insert(fireRiskAssessments).values({
          id,
          tenantId: ctx.tenantId,
          buildingId: input.buildingId ?? null,
          referenceNumber: `FRA-${String(n).padStart(4, '0')}`,
          title: input.title,
          methodology: input.methodology,
          assessorUserId: ctx.auth.userId,
          createdBy: ctx.auth.userId,
        });
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'fra',
          entityId: id,
          actorUserId: ctx.auth.userId,
          kind: 'created',
          detail: input.title,
        });
        return { id };
      }),

    update: tenantProcedure
      .use(requirePermission('fireSafety.create'))
      .input(fraUpdateInput)
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const fra = await loadFra(ctx.db, ctx.tenantId, input.fraId);
        if (fra.archivedAt !== null) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'archived' });
        }
        assertFraContentEditable(fra);
        if (input.buildingId !== null && input.buildingId !== undefined) {
          await loadBuilding(ctx.db, ctx.tenantId, input.buildingId);
        }
        const patch = input;
        const changed = Object.entries(patch)
          .filter(([key, value]) => key !== 'fraId' && value !== undefined)
          .map(([key]) => key)
          .sort();
        await ctx.db
          .update(fireRiskAssessments)
          .set({
            ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
            ...(patch.buildingId !== undefined ? { buildingId: patch.buildingId } : {}),
            ...(patch.premisesDescription !== undefined
              ? { premisesDescription: patch.premisesDescription }
              : {}),
            ...(patch.methodology !== undefined ? { methodology: patch.methodology } : {}),
            ...(patch.responsiblePersonName !== undefined
              ? { responsiblePersonName: patch.responsiblePersonName }
              : {}),
            ...(patch.assessorUserId !== undefined ? { assessorUserId: patch.assessorUserId } : {}),
            ...(patch.assessorName !== undefined ? { assessorName: patch.assessorName } : {}),
            ...(patch.personsAtRisk !== undefined ? { personsAtRisk: patch.personsAtRisk } : {}),
            ...(patch.maxOccupancy !== undefined ? { maxOccupancy: patch.maxOccupancy } : {}),
            ...(patch.sleepingOccupants !== undefined
              ? { sleepingOccupants: patch.sleepingOccupants }
              : {}),
            ...(patch.ignitionSources !== undefined
              ? { ignitionSources: patch.ignitionSources }
              : {}),
            ...(patch.fuelSources !== undefined ? { fuelSources: patch.fuelSources } : {}),
            ...(patch.oxygenSources !== undefined ? { oxygenSources: patch.oxygenSources } : {}),
            ...(patch.evaluationNotes !== undefined
              ? { evaluationNotes: patch.evaluationNotes }
              : {}),
            ...(patch.riskRating !== undefined ? { riskRating: patch.riskRating } : {}),
            ...(patch.reviewFrequencyMonths !== undefined
              ? { reviewFrequencyMonths: patch.reviewFrequencyMonths }
              : {}),
            contentUpdatedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(fireRiskAssessments.id, fra.id));
        if (changed.length > 0) {
          await logEvent(ctx.db, {
            tenantId: ctx.tenantId,
            entityType: 'fra',
            entityId: fra.id,
            actorUserId: ctx.auth.userId,
            kind: 'updated',
            detail: changed.join(','),
          });
        }
        return { ok: true };
      }),

    addFinding: tenantProcedure
      .use(requirePermission('fireSafety.create'))
      .input(findingInput)
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const fra = await loadFra(ctx.db, ctx.tenantId, input.fraId);
        if (fra.archivedAt !== null) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'archived' });
        }
        // The findings ARE the assessment's content — the schema comment
        // names them alongside the narrative and the rating.
        assertFraContentEditable(fra);
        const existing = await ctx.db
          .select({ sortOrder: fireSignificantFindings.sortOrder })
          .from(fireSignificantFindings)
          .where(eq(fireSignificantFindings.fraId, fra.id))
          .orderBy(desc(fireSignificantFindings.sortOrder))
          .limit(1);
        const id = newId();
        await ctx.db.insert(fireSignificantFindings).values({
          id,
          tenantId: ctx.tenantId,
          fraId: fra.id,
          sortOrder: (existing[0]?.sortOrder ?? -1) + 1,
          category: input.category,
          priority: input.priority,
          description: input.description,
          requiresAction: input.requiresAction,
        });
        await touchFraContent(ctx.db, fra.id, new Date());
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'fra',
          entityId: fra.id,
          actorUserId: ctx.auth.userId,
          kind: 'finding_added',
          detail: input.category,
        });
        return { id };
      }),

    updateFinding: tenantProcedure
      .use(requirePermission('fireSafety.create'))
      .input(
        z.object({
          findingId: z.string().length(26),
          category: z.enum(FRA_FINDING_CATEGORIES).optional(),
          priority: z.enum(FRA_FINDING_PRIORITIES).optional(),
          description: z.string().min(1).max(4000).optional(),
          requiresAction: z.boolean().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const rows = await ctx.db
          .select()
          .from(fireSignificantFindings)
          .where(
            and(
              eq(fireSignificantFindings.id, input.findingId),
              eq(fireSignificantFindings.tenantId, ctx.tenantId),
            ),
          )
          .limit(1);
        const finding = rows[0];
        if (finding === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
        const fra = await loadFra(ctx.db, ctx.tenantId, finding.fraId);
        if (fra.archivedAt !== null) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'archived' });
        }
        assertFraContentEditable(fra);
        await ctx.db
          .update(fireSignificantFindings)
          .set({
            ...(input.category !== undefined ? { category: input.category } : {}),
            ...(input.priority !== undefined ? { priority: input.priority } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.requiresAction !== undefined ? { requiresAction: input.requiresAction } : {}),
            updatedAt: new Date(),
          })
          .where(eq(fireSignificantFindings.id, finding.id));
        await touchFraContent(ctx.db, fra.id, new Date());
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'fra',
          entityId: fra.id,
          actorUserId: ctx.auth.userId,
          kind: 'finding_updated',
        });
        return { ok: true };
      }),

    removeFinding: tenantProcedure
      .use(requirePermission('fireSafety.create'))
      .input(z.object({ findingId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const rows = await ctx.db
          .select()
          .from(fireSignificantFindings)
          .where(
            and(
              eq(fireSignificantFindings.id, input.findingId),
              eq(fireSignificantFindings.tenantId, ctx.tenantId),
            ),
          )
          .limit(1);
        const finding = rows[0];
        if (finding === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
        /**
         * FS-G05, the worst of the four and unnamed by the audit: this
         * procedure never loaded the FRA at all, so it had neither a status
         * check NOR an `archivedAt` one. Any finding recorded with
         * `requiresAction: false` — every observation noted but not
         * remediated — could be HARD-DELETED off a live signed FRA, and the
         * `finding_removed` event carries only the category, not the text.
         * The words were simply gone.
         *
         * The author did reason about evidence and reached for `actionId`
         * as the proxy; the missing half is that a finding on a SIGNED
         * assessment is evidence whether or not it raised an action.
         */
        const fra = await loadFra(ctx.db, ctx.tenantId, finding.fraId);
        if (fra.archivedAt !== null) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'archived' });
        }
        assertFraContentEditable(fra);
        // A finding that already generated an action is evidence — it can
        // be resolved but not removed.
        if (finding.actionId !== null) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'has-action' });
        }
        await ctx.db
          .delete(fireSignificantFindings)
          .where(eq(fireSignificantFindings.id, finding.id));
        await touchFraContent(ctx.db, finding.fraId, new Date());
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'fra',
          entityId: finding.fraId,
          actorUserId: ctx.auth.userId,
          kind: 'finding_removed',
          detail: finding.category,
        });
        return { ok: true };
      }),

    resolveFinding: tenantProcedure
      .use(requirePermission('fireSafety.create'))
      .input(z.object({ findingId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const rows = await ctx.db
          .select()
          .from(fireSignificantFindings)
          .where(
            and(
              eq(fireSignificantFindings.id, input.findingId),
              eq(fireSignificantFindings.tenantId, ctx.tenantId),
            ),
          )
          .limit(1);
        const finding = rows[0];
        if (finding === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
        if (finding.resolvedAt !== null) return { ok: true };
        const now = new Date();
        await ctx.db
          .update(fireSignificantFindings)
          .set({ resolvedAt: now, resolvedBy: ctx.auth.userId, updatedAt: now })
          .where(eq(fireSignificantFindings.id, finding.id));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'fra',
          entityId: finding.fraId,
          actorUserId: ctx.auth.userId,
          kind: 'finding_resolved',
          detail: finding.category,
        });
        return { ok: true };
      }),

    /**
     * Publish = the Responsible Person attests the assessment is
     * suitable and sufficient. Requires the evaluation to be complete
     * (risk rating + named RP) and either recorded significant findings
     * or an explicit "no significant findings" confirmation. Findings
     * needing remedial work generate actions here, exactly once.
     */
    publish: tenantProcedure
      .use(requirePermission('fireSafety.manage'))
      .input(
        z.object({
          fraId: z.string().length(26),
          confirmNoSignificantFindings: z.boolean().default(false),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const fra = await loadFra(ctx.db, ctx.tenantId, input.fraId);
        if (fra.archivedAt !== null) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'archived' });
        }
        if (fra.riskRating === null) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'no-risk-rating' });
        }
        // Narrowed once, so the version snapshot below does not need a cast.
        const riskRating = fra.riskRating;
        if (fra.responsiblePersonName.trim().length === 0) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'no-responsible-person' });
        }
        // FS-4: "suitable and sufficient" needs an assessment behind it —
        // people at risk, the fire triangle, and the evaluation are the
        // assessment. A signed FRA with these blank is not defensible
        // under Article 9 of the Fire Safety Order.
        if (fra.personsAtRisk.length === 0) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'no-persons-at-risk' });
        }
        if (fra.ignitionSources.trim().length === 0) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'no-ignition-sources' });
        }
        if (fra.fuelSources.trim().length === 0) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'no-fuel-sources' });
        }
        if (fra.oxygenSources.trim().length === 0) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'no-oxygen-sources' });
        }
        if (fra.evaluationNotes.trim().length === 0) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'no-evaluation' });
        }
        const findings = await ctx.db
          .select()
          .from(fireSignificantFindings)
          .where(eq(fireSignificantFindings.fraId, fra.id));
        if (findings.length === 0 && !input.confirmNoSignificantFindings) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'no-findings' });
        }
        // FS-6: "intolerable" means the premises should not be occupied
        // until the risk is reduced — publishing it demands at least one
        // unresolved finding on an action path. The loudest rating can't
        // be the quietest publish.
        if (fra.riskRating === 'intolerable') {
          const actionable = findings.some(
            (f) => f.resolvedAt === null && (f.requiresAction || f.actionId !== null),
          );
          if (!actionable) {
            throw new TRPCError({
              code: 'PRECONDITION_FAILED',
              message: 'intolerable-needs-action',
            });
          }
        }

        const building =
          fra.buildingId !== null ? await loadBuilding(ctx.db, ctx.tenantId, fra.buildingId) : null;

        // Claim action reference numbers before the tx (a rolled-back
        // publish wastes a few numbers, which is fine — references are
        // labels, not invariants).
        const pending = findings.filter(
          (f) => f.requiresAction && f.actionId === null && f.resolvedAt === null,
        );
        const actionRefs = new Map<string, string>();
        for (const finding of pending) {
          const n = await nextReferenceValue(ctx.db, ctx.tenantId, 'action');
          actionRefs.set(finding.id, `AC-${String(n).padStart(6, '0')}`);
        }

        // Needed by the version snapshot below AND by the intolerable alert,
        // so it is resolved once before the transaction.
        const publisherName =
          (await userNamesById(ctx.db, ctx.tenantId, [ctx.auth.userId])).get(ctx.auth.userId) ??
          null;

        const createdActionIds: string[] = [];
        await ctx.db.transaction(async (tx) => {
          for (const finding of pending) {
            const actionId = newId();
            await tx.insert(actions).values({
              id: actionId,
              tenantId: ctx.tenantId,
              sourceType: 'fire_risk_assessment',
              sourceId: fra.id,
              sourceItemId: finding.id,
              referenceNumber: actionRefs.get(finding.id) ?? null,
              title: `Fire safety finding: ${finding.description.slice(0, 200)}`,
              description: `Raised by fire risk assessment ${fra.referenceNumber ?? fra.id}${building !== null ? ` for ${building.name}` : ''} — category: ${finding.category}.`,
              status: 'open',
              assigneeUserId: ctx.auth.userId,
              priority: finding.priority,
              dueAt: new Date(
                Date.now() + (finding.priority === 'high' ? 7 : 30) * 24 * 60 * 60 * 1000,
              ),
              siteId: building?.siteId ?? null,
              createdBy: ctx.auth.userId,
            });
            await tx
              .update(fireSignificantFindings)
              .set({ actionId })
              .where(eq(fireSignificantFindings.id, finding.id));
            createdActionIds.push(actionId);
          }
          const now = new Date();
          const frequency = fra.reviewFrequencyMonths ?? suggestedFraReviewMonths(fra.riskRating);
          const nextReviewAt = addMonthsClamped(now, frequency);

          /**
           * FS-G05: freeze what is being signed.
           *
           * `publish` used to flip a status flag on a mutable row, and four
           * procedures could then rewrite that row — including its risk
           * rating, and including hard-deleting a significant finding —
           * under a LOWER permission tier than could publish it. The
           * Responsible Person who attested "suitable and sufficient" under
           * Article 9 could not afterwards demonstrate what they attested,
           * because no copy of it existed anywhere.
           *
           * Supersede n BEFORE inserting n+1: the partial unique index
           * `fire_fra_versions_current_idx` makes "exactly one current
           * signed version" a database fact, and unique indexes are checked
           * per statement rather than at commit.
           */
          await tx
            .update(fireFraVersions)
            .set({ supersededAt: now })
            .where(and(eq(fireFraVersions.fraId, fra.id), isNull(fireFraVersions.supersededAt)));
          const versionNumber = fra.currentVersion + 1;
          // Re-read the findings inside the tx: `pending` above just gave
          // them their action ids, and the snapshot must carry those.
          const frozenFindings = await tx
            .select()
            .from(fireSignificantFindings)
            .where(eq(fireSignificantFindings.fraId, fra.id))
            .orderBy(asc(fireSignificantFindings.sortOrder));
          await tx.insert(fireFraVersions).values({
            id: newId(),
            tenantId: ctx.tenantId,
            fraId: fra.id,
            versionNumber,
            content: buildFraVersionContent({
              // `riskRating` is non-null here: the `no-risk-rating` guard at
              // the top of `publish` refuses otherwise.
              fra: { ...fra, riskRating },
              buildingName: building?.name ?? null,
              nextReviewAt,
              findings: frozenFindings,
            }),
            signedOffBy: ctx.auth.userId,
            signedOffByName: publisherName,
            signedOffAt: now,
            actionsCreated: createdActionIds.length,
          });

          // FS-7: every publish is a fresh attestation — the signature
          // covers the content as of NOW, so both clocks reset together.
          await tx
            .update(fireRiskAssessments)
            .set({
              status: 'active',
              publishedAt: now,
              publishedBy: ctx.auth.userId,
              contentUpdatedAt: now,
              currentVersion: versionNumber,
              reviewFrequencyMonths: frequency,
              nextReviewAt,
              updatedAt: now,
            })
            .where(eq(fireRiskAssessments.id, fra.id));
        });
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'fra',
          entityId: fra.id,
          actorUserId: ctx.auth.userId,
          kind: fra.status === 'active' ? 'reattested' : 'published',
          detail: String(createdActionIds.length),
        });
        // FS-6: an intolerable publish alerts every fireSafety.manage
        // holder immediately. Email failure never rolls back the publish
        // — the record stands; the alert is best-effort and logged. Both
        // channels are per-user muteable (settings → notifications):
        // notifyInApp checks the inapp pref itself, and the bell row is
        // written whether or not an email dispatcher is wired.
        const sendAlertEmail = deps.sendAlertEmail;
        if (fra.riskRating === 'intolerable') {
          try {
            const holders = await usersHoldingPermission(ctx.db, ctx.tenantId, 'fireSafety.manage');
            const prefsById = await loadNotificationPrefs(
              ctx.db,
              ctx.tenantId,
              holders.map((h) => h.userId),
            );
            for (const h of holders) {
              await notifyInApp(
                ctx.db,
                {
                  tenantId: ctx.tenantId,
                  userId: h.userId,
                  kind: 'fra_intolerable',
                  title: `${fra.title}${building !== null ? ` for ${building.name}` : ''}`,
                  body: fra.referenceNumber ?? '',
                  href: `/fire-safety/fra/${fra.id}`,
                },
                prefsById.get(h.userId) ?? {},
              );
            }
            if (sendAlertEmail !== undefined) {
              await Promise.all(
                holders
                  .filter((h) => emailEnabledFor(prefsById, h.userId, 'fra_intolerable'))
                  .map((h) =>
                    sendAlertEmail({
                      to: h.email,
                      ...(h.locale !== null ? { locale: h.locale } : {}),
                      templateKey: 'fra-intolerable-alert',
                      variables: {
                        recipientName: h.name,
                        title: fra.title,
                        referenceNumber: fra.referenceNumber ?? '',
                        buildingLine: building !== null ? ` for ${building.name}` : '',
                        publishedByName: publisherName ?? 'a colleague',
                        // DOC-A01, eleventh instance — and in a ROUTER, where
                        // the worker sweep in app-link.test.ts cannot see it.
                        // Every holder got an /en/ link regardless of their
                        // language; `h.locale` was right here all along.
                        viewUrl: appLink(deps.appUrl ?? '', h.locale, `/fire-safety/fra/${fra.id}`),
                      },
                    }),
                  ),
              );
            }
          } catch (err) {
            ctx.logger.warn(
              { fraId: fra.id, err: err instanceof Error ? err.message : String(err) },
              '[fireSafety] intolerable alert email failed',
            );
          }
        }
        ctx.logger.info(
          { fraId: fra.id, actionsCreated: createdActionIds.length },
          '[fireSafety] FRA published',
        );
        return { ok: true, actionsCreated: createdActionIds.length };
      }),

    /**
     * The FRA as a document (HSE review FS-5) — the file the Responsible
     * Person hands to the managing agent or the enforcing authority.
     * Renders via the shared Puppeteer pipeline into R2; the exports
     * route 302s to a signed URL.
     */
    renderPdf: tenantProcedure
      .use(requirePermission('fireSafety.view'))
      .input(z.object({ fraId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        if (deps.renderPdf === undefined) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'render-unavailable' });
        }
        const fra = await loadFra(ctx.db, ctx.tenantId, input.fraId);
        const rendered = await deps.renderPdf({ tenantId: ctx.tenantId, fraId: fra.id });
        return {
          storageKey: rendered.key,
          filename: `${fra.referenceNumber ?? 'fire-risk-assessment'}.pdf`,
          sizeBytes: rendered.bytes,
          stub: rendered.stub,
        };
      }),

    moveToDraft: tenantProcedure
      .use(requirePermission('fireSafety.manage'))
      .input(z.object({ fraId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const fra = await loadFra(ctx.db, ctx.tenantId, input.fraId);
        if (fra.archivedAt !== null) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'archived' });
        }
        await ctx.db
          .update(fireRiskAssessments)
          .set({ status: 'draft', updatedAt: new Date() })
          .where(eq(fireRiskAssessments.id, fra.id));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'fra',
          entityId: fra.id,
          actorUserId: ctx.auth.userId,
          kind: 'moved_to_draft',
        });
        return { ok: true };
      }),

    archive: tenantProcedure
      .use(requirePermission('fireSafety.manage'))
      .input(z.object({ fraId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const fra = await loadFra(ctx.db, ctx.tenantId, input.fraId);
        if (fra.archivedAt !== null) return { ok: true };
        const now = new Date();
        await ctx.db
          .update(fireRiskAssessments)
          .set({ status: 'archived', archivedAt: now, updatedAt: now })
          .where(eq(fireRiskAssessments.id, fra.id));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'fra',
          entityId: fra.id,
          actorUserId: ctx.auth.userId,
          kind: 'archived',
        });
        return { ok: true };
      }),

    /**
     * The step-5 spine: reviews append, they never rewrite. `confirmed`
     * re-attests the assessment as-is; `updated` records that content
     * was revised (the edits themselves flow through `update`, each one
     * event-logged).
     */
    recordReview: tenantProcedure
      .use(requirePermission('fireSafety.create'))
      .input(
        z.object({
          fraId: z.string().length(26),
          trigger: z.enum(FRA_REVIEW_TRIGGERS),
          outcome: z.enum(FRA_REVIEW_OUTCOMES),
          note: z.string().max(4000).default(''),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const fra = await loadFra(ctx.db, ctx.tenantId, input.fraId);
        if (fra.archivedAt !== null) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'archived' });
        }
        if (fra.status !== 'active') {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'not-active' });
        }
        const now = new Date();
        const frequency = fra.reviewFrequencyMonths ?? suggestedFraReviewMonths(fra.riskRating);
        await ctx.db.transaction(async (tx) => {
          await tx.insert(fireFraReviews).values({
            id: newId(),
            tenantId: ctx.tenantId,
            fraId: fra.id,
            trigger: input.trigger,
            outcome: input.outcome,
            note: input.note,
            reviewedBy: ctx.auth.userId,
            reviewedAt: now,
          });
          await tx
            .update(fireRiskAssessments)
            .set({
              lastReviewedAt: now,
              lastReviewedBy: ctx.auth.userId,
              nextReviewAt: addMonthsClamped(now, frequency),
              updatedAt: now,
            })
            .where(eq(fireRiskAssessments.id, fra.id));
        });
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'fra',
          entityId: fra.id,
          actorUserId: ctx.auth.userId,
          kind: 'review_recorded',
          detail: `${input.trigger}:${input.outcome}`,
        });
        return { ok: true };
      }),

    /**
     * Ad-hoc action raised while conducting an FRA (the publish flow
     * still auto-generates one per unresolved significant finding —
     * this is for work the assessor spots that isn't a finding, or
     * can't wait for publish). `sourceItemId` stays null so multiple
     * ad-hoc actions on one FRA never collide with the finding-keyed
     * dedup index.
     */
    raiseAction: tenantProcedure
      .use(requirePermission('fireSafety.create'))
      .input(
        z.object({
          fraId: z.string().length(26),
          title: z.string().min(1).max(300),
          description: z.string().max(4000).default(''),
          priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
          assigneeUserId: z.string().min(1).max(64).optional(),
          dueAt: z.string().datetime().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const fra = await loadFra(ctx.db, ctx.tenantId, input.fraId);
        if (fra.archivedAt !== null) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'archived' });
        }
        if (input.assigneeUserId !== undefined) {
          await assertUsersInTenant(ctx.db, ctx.tenantId, [input.assigneeUserId]);
        }
        const building =
          fra.buildingId !== null ? await loadBuilding(ctx.db, ctx.tenantId, fra.buildingId) : null;
        const n = await nextReferenceValue(ctx.db, ctx.tenantId, 'action');
        const actionId = newId();
        await ctx.db.insert(actions).values({
          id: actionId,
          tenantId: ctx.tenantId,
          sourceType: 'fire_risk_assessment',
          sourceId: fra.id,
          sourceItemId: null,
          referenceNumber: `AC-${String(n).padStart(6, '0')}`,
          title: input.title,
          description:
            input.description !== ''
              ? input.description
              : `Raised during fire risk assessment ${fra.referenceNumber ?? fra.id}${building !== null ? ` for ${building.name}` : ''}.`,
          status: 'open',
          assigneeUserId: input.assigneeUserId ?? ctx.auth.userId,
          priority: input.priority,
          dueAt: input.dueAt !== undefined ? new Date(input.dueAt) : null,
          siteId: building?.siteId ?? null,
          createdBy: ctx.auth.userId,
        });
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'fra',
          entityId: fra.id,
          actorUserId: ctx.auth.userId,
          kind: 'action_raised',
          detail: input.title.slice(0, 200),
        });
        return { actionId };
      }),
  });

  const logbook = router({
    /** The building's calendar with live due status. */
    checks: tenantProcedure
      .use(requirePermission('fireSafety.view'))
      .input(z.object({ buildingId: z.string().length(26) }))
      .query(async ({ ctx, input }) => {
        assertEnabled();
        const building = await loadBuilding(ctx.db, ctx.tenantId, input.buildingId);
        const rows = await ctx.db
          .select()
          .from(fireLogbookChecks)
          .where(
            and(
              eq(fireLogbookChecks.buildingId, building.id),
              isNull(fireLogbookChecks.dismissedAt),
            ),
          )
          .orderBy(asc(fireLogbookChecks.nextDueAt));
        const now = new Date();
        return rows.map((c) => checkWithStatus(c, now));
      }),

    /**
     * PF-17: everything the fire logbook knows about ONE maintained asset —
     * the checks targeting it and their recorded entries. This is the join
     * the review found missing ("service history of extinguisher #12 spans
     * two systems that can't be joined"); the asset detail page renders it
     * as a "Fire safety history" section.
     */
    assetHistory: tenantProcedure
      .use(requirePermission('fireSafety.view'))
      .input(z.object({ assetId: z.string().length(26) }))
      .query(async ({ ctx, input }) => {
        assertEnabled();
        const checks = await ctx.db
          .select({
            check: fireLogbookChecks,
            buildingName: fireBuildings.name,
          })
          .from(fireLogbookChecks)
          .innerJoin(fireBuildings, eq(fireLogbookChecks.buildingId, fireBuildings.id))
          .where(
            and(
              eq(fireLogbookChecks.tenantId, ctx.tenantId),
              eq(fireLogbookChecks.assetId, input.assetId),
            ),
          );
        if (checks.length === 0) return { checks: [], entries: [] };
        const now = new Date();
        const checkIds = checks.map((c) => c.check.id);
        const entryRows = await ctx.db
          .select()
          .from(fireLogbookEntries)
          .where(
            and(
              eq(fireLogbookEntries.tenantId, ctx.tenantId),
              inArray(fireLogbookEntries.checkId, checkIds),
            ),
          )
          .orderBy(desc(fireLogbookEntries.performedAt))
          .limit(200);
        return {
          checks: checks.map((c) => ({
            ...checkWithStatus(c.check, now),
            buildingName: c.buildingName,
          })),
          entries: entryRows,
        };
      }),

    /** Add a manual check or adjust frequency / assignee / active flag. */
    upsertCheck: tenantProcedure
      .use(requirePermission('fireSafety.manage'))
      .input(
        z.object({
          buildingId: z.string().length(26),
          checkType: z.enum(FIRE_CHECK_TYPES),
          frequency: z.enum(CHECK_FREQUENCIES).optional(),
          assignedToUserId: z.string().nullable().optional(),
          notes: z.string().max(2000).optional(),
          active: z.boolean().optional(),
          /** PF-17: the maintained asset this check concerns (extinguishers…). */
          assetId: z.string().length(26).nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const building = await loadBuilding(ctx.db, ctx.tenantId, input.buildingId);
        if (building.archivedAt !== null) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'archived' });
        }
        if (input.assetId != null) {
          const assetRows = await ctx.db
            .select({ id: assets.id })
            .from(assets)
            .where(and(eq(assets.tenantId, ctx.tenantId), eq(assets.id, input.assetId)))
            .limit(1);
          if (assetRows[0] === undefined) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'asset-not-found' });
          }
        }
        const existing = (
          await ctx.db
            .select()
            .from(fireLogbookChecks)
            .where(
              and(
                eq(fireLogbookChecks.buildingId, building.id),
                eq(fireLogbookChecks.checkType, input.checkType),
              ),
            )
            .limit(1)
        )[0];
        const now = new Date();
        if (existing === undefined) {
          const frequency =
            input.frequency ?? FIRE_CHECK_TYPE_SPECS[input.checkType].defaultFrequency;
          const id = newId();
          await ctx.db.insert(fireLogbookChecks).values({
            id,
            tenantId: ctx.tenantId,
            buildingId: building.id,
            checkType: input.checkType,
            frequency,
            source: 'manual',
            active: input.active ?? true,
            assignedToUserId: input.assignedToUserId ?? null,
            notes: input.notes ?? '',
            assetId: input.assetId ?? null,
            nextDueAt: nextDueDate(now, frequency),
          });
          await logEvent(ctx.db, {
            tenantId: ctx.tenantId,
            entityType: 'logbook_check',
            entityId: id,
            actorUserId: ctx.auth.userId,
            kind: 'created',
            detail: input.checkType,
          });
          return { id, created: true };
        }
        const patch: Partial<typeof existing> = {};
        if (input.frequency !== undefined && input.frequency !== existing.frequency) {
          patch.frequency = input.frequency;
          // Rebase the cycle on the last completed check, not on today —
          // changing cadence must not silently grant an extension.
          patch.nextDueAt = nextDueDate(existing.lastDoneAt ?? now, input.frequency);
        }
        if (input.assignedToUserId !== undefined) patch.assignedToUserId = input.assignedToUserId;
        if (input.notes !== undefined) patch.notes = input.notes;
        if (input.active !== undefined) patch.active = input.active;
        if (input.assetId !== undefined) patch.assetId = input.assetId;
        if (Object.keys(patch).length > 0) {
          await ctx.db
            .update(fireLogbookChecks)
            .set({ ...patch, updatedAt: now })
            .where(eq(fireLogbookChecks.id, existing.id));
          await logEvent(ctx.db, {
            tenantId: ctx.tenantId,
            entityType: 'logbook_check',
            entityId: existing.id,
            actorUserId: ctx.auth.userId,
            kind: 'check_updated',
            detail: input.checkType,
          });
        }
        return { id: existing.id, created: false };
      }),

    /**
     * Edit ONE check row by id: cadence, an explicit next-due override,
     * assignee, notes, linked asset and (custom rows only) the label.
     * Frequency-only changes keep the rebase rule (cycle re-anchored on
     * the last completed check); an explicit `nextDueAt` wins over it.
     * Editing a dismissed row puts it back on the calendar.
     */
    updateCheck: tenantProcedure
      .use(requirePermission('fireSafety.manage'))
      .input(
        z.object({
          checkId: z.string().length(26),
          frequency: z.enum(CHECK_FREQUENCIES).optional(),
          nextDueAt: z.coerce.date().optional(),
          /** Custom rows only — catalogue rows keep their i18n'd type name. */
          label: z.string().min(1).max(200).optional(),
          assignedToUserId: z.string().nullable().optional(),
          assetId: z.string().length(26).nullable().optional(),
          notes: z.string().max(2000).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const check = (
          await ctx.db
            .select()
            .from(fireLogbookChecks)
            .where(
              and(
                eq(fireLogbookChecks.tenantId, ctx.tenantId),
                eq(fireLogbookChecks.id, input.checkId),
              ),
            )
            .limit(1)
        )[0];
        if (check === undefined) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'check-not-found' });
        }
        const building = await loadBuilding(ctx.db, ctx.tenantId, check.buildingId);
        if (building.archivedAt !== null) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'archived' });
        }
        if (input.label !== undefined && check.checkType !== 'custom') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'label-on-catalogue-check' });
        }
        if (input.assetId != null) {
          const assetRows = await ctx.db
            .select({ id: assets.id })
            .from(assets)
            .where(and(eq(assets.tenantId, ctx.tenantId), eq(assets.id, input.assetId)))
            .limit(1);
          if (assetRows[0] === undefined) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'asset-not-found' });
          }
        }
        const now = new Date();
        const patch: Partial<typeof check> = {};
        if (input.frequency !== undefined && input.frequency !== check.frequency) {
          patch.frequency = input.frequency;
          // Rebase the cycle on the last completed check, not on today —
          // changing cadence must not silently grant an extension.
          patch.nextDueAt = nextDueDate(check.lastDoneAt ?? now, input.frequency);
        }
        // An explicit next-due override always wins over the rebase.
        if (input.nextDueAt !== undefined) patch.nextDueAt = input.nextDueAt;
        if (input.label !== undefined) patch.label = input.label;
        if (input.assignedToUserId !== undefined) patch.assignedToUserId = input.assignedToUserId;
        if (input.assetId !== undefined) patch.assetId = input.assetId;
        if (input.notes !== undefined) patch.notes = input.notes;
        if (check.dismissedAt !== null) {
          // Editing a removed row is the deliberate act of bringing it back.
          patch.dismissedAt = null;
          patch.active = true;
        }
        if (Object.keys(patch).length > 0) {
          await ctx.db
            .update(fireLogbookChecks)
            .set({ ...patch, updatedAt: now })
            .where(eq(fireLogbookChecks.id, check.id));
          await logEvent(ctx.db, {
            tenantId: ctx.tenantId,
            entityType: 'logbook_check',
            entityId: check.id,
            actorUserId: ctx.auth.userId,
            kind: 'check_updated',
            detail: check.checkType,
          });
        }
        return { id: check.id };
      }),

    /**
     * Take a check off the calendar. Never a hard delete — the recorded
     * history survives — and the `dismissedAt` stamp stops
     * `syncAutoChecks` from resurrecting the row on the next profile
     * edit. `updateCheck` on a dismissed row brings it back.
     */
    removeCheck: tenantProcedure
      .use(requirePermission('fireSafety.manage'))
      .input(z.object({ checkId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const check = (
          await ctx.db
            .select()
            .from(fireLogbookChecks)
            .where(
              and(
                eq(fireLogbookChecks.tenantId, ctx.tenantId),
                eq(fireLogbookChecks.id, input.checkId),
              ),
            )
            .limit(1)
        )[0];
        if (check === undefined) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'check-not-found' });
        }
        const now = new Date();
        await ctx.db
          .update(fireLogbookChecks)
          .set({ active: false, dismissedAt: now, updatedAt: now })
          .where(eq(fireLogbookChecks.id, check.id));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'logbook_check',
          entityId: check.id,
          actorUserId: ctx.auth.userId,
          kind: 'check_updated',
          detail: `removed:${check.checkType}`,
        });
        return { ok: true };
      }),

    /**
     * Add a manager-defined check the catalogue doesn't know about
     * (`checkType='custom'`, named by its `label`). Any number of custom
     * checks may coexist on one building — the building × type unique
     * index is partial and skips 'custom'.
     */
    addCustomCheck: tenantProcedure
      .use(requirePermission('fireSafety.manage'))
      .input(
        z.object({
          buildingId: z.string().length(26),
          label: z.string().min(1).max(200),
          frequency: z.enum(CHECK_FREQUENCIES),
          firstDueAt: z.coerce.date().optional(),
          assetId: z.string().length(26).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const building = await loadBuilding(ctx.db, ctx.tenantId, input.buildingId);
        if (building.archivedAt !== null) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'archived' });
        }
        if (input.assetId !== undefined) {
          const assetRows = await ctx.db
            .select({ id: assets.id })
            .from(assets)
            .where(and(eq(assets.tenantId, ctx.tenantId), eq(assets.id, input.assetId)))
            .limit(1);
          if (assetRows[0] === undefined) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'asset-not-found' });
          }
        }
        const now = new Date();
        const id = newId();
        await ctx.db.insert(fireLogbookChecks).values({
          id,
          tenantId: ctx.tenantId,
          buildingId: building.id,
          checkType: 'custom',
          label: input.label,
          frequency: input.frequency,
          source: 'manual',
          active: true,
          assetId: input.assetId ?? null,
          nextDueAt: input.firstDueAt ?? nextDueDate(now, input.frequency),
        });
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'logbook_check',
          entityId: id,
          actorUserId: ctx.auth.userId,
          kind: 'created',
          detail: `custom:${input.label}`,
        });
        return { id };
      }),

    /**
     * Record a performed check — the logbook's whole purpose. Appends
     * the evidence row, advances the schedule, and (optionally) raises
     * an action when the check found problems.
     */
    recordEntry: tenantProcedure
      .use(requirePermission('fireSafety.record'))
      .input(
        z.object({
          buildingId: z.string().length(26),
          /**
           * Resolve the schedule row by id — the only unambiguous key
           * once several custom checks coexist, and the only way to
           * record against a custom check at all.
           */
          checkId: z.string().length(26).optional(),
          /**
           * Legacy path, kept for back-compat: the offline queue replays
           * payloads recorded before `checkId` existed. One of `checkId`
           * / `checkType` is required.
           */
          checkType: z.enum(FIRE_CHECK_TYPES).optional(),
          result: z.enum(FIRE_CHECK_RESULTS),
          performedAt: z.coerce.date().optional(),
          callPointRef: z.string().max(200).default(''),
          notes: z.string().max(4000).default(''),
          defectsSummary: z.string().max(4000).default(''),
          /**
           * FS-2: a failed safety check defaults to raising a follow-up
           * action — silence is the opt-out, not the default.
           */
          raiseAction: z.boolean().default(true),
          /**
           * PF-10: offline-queue idempotency key. A retried submission with
           * the same key returns the already-recorded entry instead of
           * double-recording the check.
           */
          clientRequestId: z.string().length(26).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const building = await loadBuilding(ctx.db, ctx.tenantId, input.buildingId);
        if (building.archivedAt !== null) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'archived' });
        }
        const performedAt = input.performedAt ?? new Date();
        if (performedAt.getTime() > Date.now() + 60 * 1000) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'future-date' });
        }
        if (input.clientRequestId !== undefined) {
          const dup = (
            await ctx.db
              .select({ id: fireLogbookEntries.id, actionId: fireLogbookEntries.actionId })
              .from(fireLogbookEntries)
              .where(
                and(
                  eq(fireLogbookEntries.tenantId, ctx.tenantId),
                  eq(fireLogbookEntries.clientRequestId, input.clientRequestId),
                ),
              )
              .limit(1)
          )[0];
          if (dup !== undefined) return { id: dup.id, actionId: dup.actionId, deduped: true };
        }
        let schedule: FireLogbookCheck | undefined;
        if (input.checkId !== undefined) {
          schedule = (
            await ctx.db
              .select()
              .from(fireLogbookChecks)
              .where(
                and(
                  eq(fireLogbookChecks.tenantId, ctx.tenantId),
                  eq(fireLogbookChecks.id, input.checkId),
                  eq(fireLogbookChecks.buildingId, building.id),
                ),
              )
              .limit(1)
          )[0];
          if (schedule === undefined) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'check-not-found' });
          }
        } else if (input.checkType !== undefined) {
          schedule = (
            await ctx.db
              .select()
              .from(fireLogbookChecks)
              .where(
                and(
                  eq(fireLogbookChecks.buildingId, building.id),
                  eq(fireLogbookChecks.checkType, input.checkType),
                ),
              )
              .limit(1)
          )[0];
        }
        // Entries can exist without a schedule row (checkType path), but
        // the call must name SOME check.
        const checkType = schedule?.checkType ?? input.checkType;
        if (checkType === undefined) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'check-required' });
        }
        const checkDisplayName =
          schedule !== undefined && schedule.checkType === 'custom' && schedule.label !== ''
            ? schedule.label
            : checkType.replace(/_/g, ' ');

        const wantsAction = input.raiseAction && input.result !== 'pass';
        const actionRef = wantsAction
          ? `AC-${String(await nextReferenceValue(ctx.db, ctx.tenantId, 'action')).padStart(6, '0')}`
          : null;

        const entryId = newId();
        let actionId: string | null = null;
        await ctx.db.transaction(async (tx) => {
          await tx.insert(fireLogbookEntries).values({
            id: entryId,
            tenantId: ctx.tenantId,
            buildingId: building.id,
            checkId: schedule?.id ?? null,
            checkType,
            performedAt,
            performedBy: ctx.auth.userId,
            result: input.result,
            callPointRef: input.callPointRef,
            notes: input.notes,
            defectsSummary: input.defectsSummary,
            clientRequestId: input.clientRequestId ?? null,
          });
          if (wantsAction) {
            actionId = newId();
            await tx.insert(actions).values({
              id: actionId,
              tenantId: ctx.tenantId,
              sourceType: 'fire_logbook_entry',
              sourceId: entryId,
              referenceNumber: actionRef,
              title: `Fire safety check defect: ${checkDisplayName} — ${building.name}`,
              description: input.defectsSummary.length > 0 ? input.defectsSummary : input.notes,
              status: 'open',
              assigneeUserId: ctx.auth.userId,
              priority: input.result === 'fail' ? 'high' : 'medium',
              dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              siteId: building.siteId,
              createdBy: ctx.auth.userId,
            });
            await tx
              .update(fireLogbookEntries)
              .set({ actionId })
              .where(eq(fireLogbookEntries.id, entryId));
          }
          if (
            schedule !== undefined &&
            (schedule.lastDoneAt === null || schedule.lastDoneAt < performedAt)
          ) {
            await tx
              .update(fireLogbookChecks)
              .set({
                lastDoneAt: performedAt,
                lastResult: input.result,
                nextDueAt: nextDueDate(performedAt, schedule.frequency),
                updatedAt: new Date(),
              })
              .where(eq(fireLogbookChecks.id, schedule.id));
          }
        });
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'building',
          entityId: building.id,
          actorUserId: ctx.auth.userId,
          kind: 'check_recorded',
          detail: `${checkType}:${input.result}`,
        });
        return { id: entryId, actionId };
      }),

    /** The logbook evidence view — filterable, newest first. */
    entries: tenantProcedure
      .use(requirePermission('fireSafety.view'))
      .input(
        z
          .object({
            buildingId: z.string().length(26).optional(),
            checkType: z.enum(FIRE_CHECK_TYPES).optional(),
            limit: z.number().int().min(1).max(500).default(200),
          })
          .default({ limit: 200 }),
      )
      .query(async ({ ctx, input }) => {
        assertEnabled();
        const conditions = [eq(fireLogbookEntries.tenantId, ctx.tenantId)];
        if (input.buildingId !== undefined) {
          conditions.push(eq(fireLogbookEntries.buildingId, input.buildingId));
        }
        if (input.checkType !== undefined) {
          conditions.push(eq(fireLogbookEntries.checkType, input.checkType));
        }
        const rows = await ctx.db
          .select()
          .from(fireLogbookEntries)
          .where(and(...conditions))
          .orderBy(desc(fireLogbookEntries.performedAt))
          .limit(input.limit);
        const names = await userNamesById(
          ctx.db,
          ctx.tenantId,
          rows.map((r) => r.performedBy),
        );
        const buildingNames = new Map(
          (
            await ctx.db
              .select({ id: fireBuildings.id, name: fireBuildings.name })
              .from(fireBuildings)
              .where(eq(fireBuildings.tenantId, ctx.tenantId))
          ).map((b) => [b.id, b.name]),
        );
        return rows.map((r) => ({
          ...r,
          performedByName: names.get(r.performedBy) ?? null,
          buildingName: buildingNames.get(r.buildingId) ?? null,
        }));
      }),

    /**
     * The tenant-wide "what needs doing" list: every active check on a
     * live building that is due soon or overdue, soonest first.
     */
    due: tenantProcedure.use(requirePermission('fireSafety.view')).query(async ({ ctx }) => {
      assertEnabled();
      const rows = await ctx.db
        .select({
          check: fireLogbookChecks,
          buildingName: fireBuildings.name,
          buildingStatus: fireBuildings.status,
        })
        .from(fireLogbookChecks)
        .innerJoin(fireBuildings, eq(fireLogbookChecks.buildingId, fireBuildings.id))
        .where(
          and(
            eq(fireLogbookChecks.tenantId, ctx.tenantId),
            eq(fireLogbookChecks.active, true),
            eq(fireBuildings.status, 'active'),
          ),
        )
        .orderBy(asc(fireLogbookChecks.nextDueAt));
      const now = new Date();
      return rows
        .map(({ check, buildingName }) => ({
          ...checkWithStatus(check, now),
          buildingName,
        }))
        .filter((c) => c.dueStatus !== 'ok');
    }),
  });

  const doors = router({
    list: tenantProcedure
      .use(requirePermission('fireSafety.view'))
      .input(z.object({ buildingId: z.string().length(26) }))
      .query(async ({ ctx, input }) => {
        assertEnabled();
        const building = await loadBuilding(ctx.db, ctx.tenantId, input.buildingId);
        const rows = await ctx.db
          .select()
          .from(fireDoors)
          .where(eq(fireDoors.buildingId, building.id))
          .orderBy(asc(fireDoors.doorRef));
        const now = new Date();
        return rows.map((door) => {
          const interval = doorIntervalMonths(
            { locationKind: door.locationKind, override: door.inspectionIntervalMonthsOverride },
            building,
          );
          return {
            ...door,
            intervalMonths: interval,
            dueStatus:
              door.status === 'active'
                ? doorDueStatus(door.nextInspectionDueAt, interval, now)
                : ('ok' satisfies CheckDueStatus),
          };
        });
      }),

    create: tenantProcedure
      .use(requirePermission('fireSafety.create'))
      .input(
        z.object({
          buildingId: z.string().length(26),
          doorRef: z.string().min(1).max(200),
          locationKind: z.enum(FIRE_DOOR_LOCATION_KINDS).default('other'),
          floor: z.string().max(100).default(''),
          description: z.string().max(1000).default(''),
          ratingMinutes: z.number().int().min(15).max(240).nullable().optional(),
          selfClosing: z.boolean().default(true),
          inspectionIntervalMonthsOverride: z.number().int().min(1).max(24).nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const building = await loadBuilding(ctx.db, ctx.tenantId, input.buildingId);
        if (building.archivedAt !== null) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'archived' });
        }
        const now = new Date();
        const interval = doorIntervalMonths(
          {
            locationKind: input.locationKind,
            override: input.inspectionIntervalMonthsOverride ?? null,
          },
          building,
        );
        const id = newId();
        await ctx.db.insert(fireDoors).values({
          id,
          tenantId: ctx.tenantId,
          buildingId: building.id,
          doorRef: input.doorRef,
          locationKind: input.locationKind,
          floor: input.floor,
          description: input.description,
          ratingMinutes: input.ratingMinutes ?? null,
          selfClosing: input.selfClosing,
          inspectionIntervalMonthsOverride: input.inspectionIntervalMonthsOverride ?? null,
          nextInspectionDueAt: addMonthsClamped(now, interval),
          createdBy: ctx.auth.userId,
        });
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'door',
          entityId: id,
          actorUserId: ctx.auth.userId,
          kind: 'created',
          detail: input.doorRef,
        });
        return { id };
      }),

    /**
     * Bulk door register import (HSE review FS-12) — a 200-door block is
     * one paste, not 200 form submissions. Duplicate refs (within the
     * paste or against the live register, case-insensitive) are skipped
     * and reported, never silently overwritten.
     */
    bulkCreate: tenantProcedure
      .use(requirePermission('fireSafety.create'))
      .input(
        z.object({
          buildingId: z.string().length(26),
          doors: z
            .array(
              z.object({
                doorRef: z.string().min(1).max(200),
                floor: z.string().max(100).default(''),
                locationKind: z.enum(FIRE_DOOR_LOCATION_KINDS).default('other'),
                ratingMinutes: z.number().int().min(15).max(240).nullable().optional(),
                selfClosing: z.boolean().default(true),
              }),
            )
            .min(1)
            .max(500),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const building = await loadBuilding(ctx.db, ctx.tenantId, input.buildingId);
        if (building.archivedAt !== null) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'archived' });
        }
        const now = new Date();
        const existing = await ctx.db
          .select({ doorRef: fireDoors.doorRef })
          .from(fireDoors)
          .where(and(eq(fireDoors.buildingId, building.id), eq(fireDoors.status, 'active')));
        const taken = new Set(existing.map((d) => d.doorRef.toLowerCase()));
        const values: Array<typeof fireDoors.$inferInsert> = [];
        const skipped: string[] = [];
        for (const row of input.doors) {
          const key = row.doorRef.toLowerCase();
          if (taken.has(key)) {
            skipped.push(row.doorRef);
            continue;
          }
          taken.add(key);
          const interval = doorIntervalMonths(
            { locationKind: row.locationKind, override: null },
            building,
          );
          values.push({
            id: newId(),
            tenantId: ctx.tenantId,
            buildingId: building.id,
            doorRef: row.doorRef,
            locationKind: row.locationKind,
            floor: row.floor,
            ratingMinutes: row.ratingMinutes ?? null,
            selfClosing: row.selfClosing,
            nextInspectionDueAt: addMonthsClamped(now, interval),
            createdBy: ctx.auth.userId,
          });
        }
        if (values.length > 0) {
          await ctx.db.insert(fireDoors).values(values);
        }
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'building',
          entityId: building.id,
          actorUserId: ctx.auth.userId,
          kind: 'doors_bulk_added',
          detail: `${values.length} added, ${skipped.length} skipped`,
        });
        return { created: values.length, skipped };
      }),

    update: tenantProcedure
      .use(requirePermission('fireSafety.create'))
      .input(
        z.object({
          doorId: z.string().length(26),
          doorRef: z.string().min(1).max(200).optional(),
          locationKind: z.enum(FIRE_DOOR_LOCATION_KINDS).optional(),
          floor: z.string().max(100).optional(),
          description: z.string().max(1000).optional(),
          ratingMinutes: z.number().int().min(15).max(240).nullable().optional(),
          selfClosing: z.boolean().optional(),
          inspectionIntervalMonthsOverride: z.number().int().min(1).max(24).nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const door = await loadDoor(ctx.db, ctx.tenantId, input.doorId);
        if (door.archivedAt !== null) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'archived' });
        }
        const building = await loadBuilding(ctx.db, ctx.tenantId, door.buildingId);
        const now = new Date();
        // A regime-relevant change (location kind or override) moves the
        // cadence — recompute from the last inspection, not from today.
        const regimeChanged =
          (input.locationKind !== undefined && input.locationKind !== door.locationKind) ||
          (input.inspectionIntervalMonthsOverride !== undefined &&
            input.inspectionIntervalMonthsOverride !== door.inspectionIntervalMonthsOverride);
        const rebasedDue = regimeChanged
          ? addMonthsClamped(
              door.lastInspectedAt ?? now,
              doorIntervalMonths(
                {
                  locationKind: input.locationKind ?? door.locationKind,
                  override:
                    input.inspectionIntervalMonthsOverride !== undefined
                      ? input.inspectionIntervalMonthsOverride
                      : door.inspectionIntervalMonthsOverride,
                },
                building,
              ),
            )
          : null;
        await ctx.db
          .update(fireDoors)
          .set({
            ...(input.doorRef !== undefined ? { doorRef: input.doorRef.trim() } : {}),
            ...(input.locationKind !== undefined ? { locationKind: input.locationKind } : {}),
            ...(input.floor !== undefined ? { floor: input.floor } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.ratingMinutes !== undefined ? { ratingMinutes: input.ratingMinutes } : {}),
            ...(input.selfClosing !== undefined ? { selfClosing: input.selfClosing } : {}),
            ...(input.inspectionIntervalMonthsOverride !== undefined
              ? { inspectionIntervalMonthsOverride: input.inspectionIntervalMonthsOverride }
              : {}),
            ...(rebasedDue !== null ? { nextInspectionDueAt: rebasedDue } : {}),
            updatedAt: now,
          })
          .where(eq(fireDoors.id, door.id));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'door',
          entityId: door.id,
          actorUserId: ctx.auth.userId,
          kind: 'updated',
        });
        return { ok: true };
      }),

    archive: tenantProcedure
      .use(requirePermission('fireSafety.manage'))
      .input(z.object({ doorId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const door = await loadDoor(ctx.db, ctx.tenantId, input.doorId);
        if (door.archivedAt !== null) return { ok: true };
        const now = new Date();
        await ctx.db
          .update(fireDoors)
          .set({ status: 'archived', archivedAt: now, updatedAt: now })
          .where(eq(fireDoors.id, door.id));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'door',
          entityId: door.id,
          actorUserId: ctx.auth.userId,
          kind: 'archived',
          detail: door.doorRef,
        });
        return { ok: true };
      }),

    recordInspection: tenantProcedure
      .use(requirePermission('fireSafety.record'))
      .input(
        z.object({
          doorId: z.string().length(26),
          outcome: z.enum(FIRE_DOOR_OUTCOMES),
          inspectedAt: z.coerce.date().optional(),
          checklist: doorChecklistSchema.optional(),
          defectsSummary: z.string().max(4000).default(''),
          /** FS-2 — see logbook.recordEntry. */
          raiseAction: z.boolean().default(true),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const door = await loadDoor(ctx.db, ctx.tenantId, input.doorId);
        if (door.archivedAt !== null) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'archived' });
        }
        const building = await loadBuilding(ctx.db, ctx.tenantId, door.buildingId);
        const inspectedAt = input.inspectedAt ?? new Date();
        if (inspectedAt.getTime() > Date.now() + 60 * 1000) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'future-date' });
        }

        const wantsAction = input.raiseAction && input.outcome !== 'pass';
        const actionRef = wantsAction
          ? `AC-${String(await nextReferenceValue(ctx.db, ctx.tenantId, 'action')).padStart(6, '0')}`
          : null;

        const inspectionId = newId();
        let actionId: string | null = null;
        const interval = doorIntervalMonths(
          { locationKind: door.locationKind, override: door.inspectionIntervalMonthsOverride },
          building,
        );
        await ctx.db.transaction(async (tx) => {
          await tx.insert(fireDoorInspections).values({
            id: inspectionId,
            tenantId: ctx.tenantId,
            doorId: door.id,
            inspectedAt,
            inspectedBy: ctx.auth.userId,
            outcome: input.outcome,
            checklist: input.checklist ?? null,
            defectsSummary: input.defectsSummary,
          });
          if (wantsAction) {
            actionId = newId();
            await tx.insert(actions).values({
              id: actionId,
              tenantId: ctx.tenantId,
              sourceType: 'fire_door_inspection',
              sourceId: inspectionId,
              referenceNumber: actionRef,
              title: `Fire door defect: ${door.doorRef} — ${building.name}`,
              description: input.defectsSummary,
              status: 'open',
              assigneeUserId: ctx.auth.userId,
              priority: input.outcome === 'fail' ? 'high' : 'medium',
              dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              siteId: building.siteId,
              createdBy: ctx.auth.userId,
            });
            await tx
              .update(fireDoorInspections)
              .set({ actionId })
              .where(eq(fireDoorInspections.id, inspectionId));
          }
          if (door.lastInspectedAt === null || door.lastInspectedAt < inspectedAt) {
            await tx
              .update(fireDoors)
              .set({
                lastInspectedAt: inspectedAt,
                lastOutcome: input.outcome,
                nextInspectionDueAt: addMonthsClamped(inspectedAt, interval),
                updatedAt: new Date(),
              })
              .where(eq(fireDoors.id, door.id));
          }
        });
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'door',
          entityId: door.id,
          actorUserId: ctx.auth.userId,
          kind: 'inspection_recorded',
          detail: `${door.doorRef}:${input.outcome}`,
        });
        return { id: inspectionId, actionId };
      }),

    inspections: tenantProcedure
      .use(requirePermission('fireSafety.view'))
      .input(z.object({ doorId: z.string().length(26) }))
      .query(async ({ ctx, input }) => {
        assertEnabled();
        const door = await loadDoor(ctx.db, ctx.tenantId, input.doorId);
        const rows = await ctx.db
          .select()
          .from(fireDoorInspections)
          .where(eq(fireDoorInspections.doorId, door.id))
          .orderBy(desc(fireDoorInspections.inspectedAt));
        const names = await userNamesById(
          ctx.db,
          ctx.tenantId,
          rows.map((r) => r.inspectedBy),
        );
        return rows.map((r) => ({ ...r, inspectedByName: names.get(r.inspectedBy) ?? null }));
      }),
  });

  const drills = router({
    list: tenantProcedure
      .use(requirePermission('fireSafety.view'))
      .input(z.object({ buildingId: z.string().length(26).optional() }).default({}))
      .query(async ({ ctx, input }) => {
        assertEnabled();
        const conditions = [eq(fireDrills.tenantId, ctx.tenantId)];
        if (input.buildingId !== undefined) {
          conditions.push(eq(fireDrills.buildingId, input.buildingId));
        }
        const rows = await ctx.db
          .select({ drill: fireDrills, buildingName: fireBuildings.name })
          .from(fireDrills)
          .innerJoin(fireBuildings, eq(fireDrills.buildingId, fireBuildings.id))
          .where(and(...conditions))
          .orderBy(desc(fireDrills.conductedAt))
          .limit(200);
        const names = await userNamesById(
          ctx.db,
          ctx.tenantId,
          rows.map((r) => r.drill.conductedBy),
        );
        return rows.map(({ drill, buildingName }) => ({
          ...drill,
          buildingName,
          conductedByName: names.get(drill.conductedBy) ?? null,
        }));
      }),

    /**
     * The drill as a document — a branded, filable record of one drill
     * for the logbook file. Renders via the shared Puppeteer pipeline
     * into R2; the exports route delivers it. Mirrors `fras.renderPdf`.
     */
    renderPdf: tenantProcedure
      .use(requirePermission('fireSafety.view'))
      .input(z.object({ drillId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        if (deps.renderDrillPdf === undefined) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'render-unavailable' });
        }
        const rows = await ctx.db
          .select({ id: fireDrills.id })
          .from(fireDrills)
          .where(and(eq(fireDrills.tenantId, ctx.tenantId), eq(fireDrills.id, input.drillId)))
          .limit(1);
        if (rows[0] === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
        const rendered = await deps.renderDrillPdf({
          tenantId: ctx.tenantId,
          drillId: input.drillId,
        });
        return {
          storageKey: rendered.key,
          filename: 'fire-drill.pdf',
          sizeBytes: rendered.bytes,
          stub: rendered.stub,
        };
      }),

    /** Record a drill — and satisfy the drill schedule in the same stroke. */
    record: tenantProcedure
      .use(requirePermission('fireSafety.record'))
      .input(
        z.object({
          buildingId: z.string().length(26),
          conductedAt: z.coerce.date().optional(),
          evacuationSeconds: z
            .number()
            .int()
            .min(0)
            .max(24 * 60 * 60)
            .nullable()
            .optional(),
          peoplePresent: z.number().int().min(0).max(1_000_000).nullable().optional(),
          peopleAccountedFor: z.number().int().min(0).max(1_000_000).nullable().optional(),
          rollComplete: z.boolean().default(false),
          /** BUG-07: judged against this; omit when no target is set. */
          evacuationTargetSeconds: z
            .number()
            .int()
            .min(0)
            .max(24 * 60 * 60)
            .nullable()
            .optional(),
          notes: z.string().max(4000).default(''),
          lessonsLearned: z.string().max(4000).default(''),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const building = await loadBuilding(ctx.db, ctx.tenantId, input.buildingId);
        if (building.archivedAt !== null) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'archived' });
        }
        const conductedAt = input.conductedAt ?? new Date();
        if (conductedAt.getTime() > Date.now() + 60 * 1000) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'future-date' });
        }
        if (
          input.peoplePresent !== null &&
          input.peoplePresent !== undefined &&
          input.peopleAccountedFor !== null &&
          input.peopleAccountedFor !== undefined &&
          input.peopleAccountedFor > input.peoplePresent
        ) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'roll-exceeds-present' });
        }
        const id = newId();
        // BUG-07: a drill that went badly must leave something for somebody to
        // do. A failed logbook check already raises an action; the drill — the
        // more consequential test — recorded the problem and raised nothing.
        const concerns = drillConcerns({
          rollComplete: input.rollComplete,
          peoplePresent: input.peoplePresent ?? null,
          peopleAccountedFor: input.peopleAccountedFor ?? null,
          evacuationSeconds: input.evacuationSeconds ?? null,
          evacuationTargetSeconds: input.evacuationTargetSeconds ?? null,
        });
        let drillActionId: string | null = null;
        const drillActionRef =
          concerns.length > 0
            ? `AC-${String(await nextReferenceValue(ctx.db, ctx.tenantId, 'action')).padStart(6, '0')}`
            : null;
        await ctx.db.transaction(async (tx) => {
          await tx.insert(fireDrills).values({
            id,
            tenantId: ctx.tenantId,
            buildingId: building.id,
            conductedAt,
            conductedBy: ctx.auth.userId,
            evacuationSeconds: input.evacuationSeconds ?? null,
            peoplePresent: input.peoplePresent ?? null,
            peopleAccountedFor: input.peopleAccountedFor ?? null,
            rollComplete: input.rollComplete,
            evacuationTargetSeconds: input.evacuationTargetSeconds ?? null,
            notes: input.notes,
            lessonsLearned: input.lessonsLearned,
          });
          if (concerns.length > 0) {
            drillActionId = newId();
            const reasonText = concerns.map((c) => c.replace(/_/g, ' ')).join('; ');
            await tx.insert(actions).values({
              id: drillActionId,
              tenantId: ctx.tenantId,
              sourceType: 'fire_logbook_entry',
              sourceId: id,
              referenceNumber: drillActionRef,
              title: `Fire drill follow-up: ${reasonText} — ${building.name}`,
              description:
                input.lessonsLearned.length > 0
                  ? input.lessonsLearned
                  : input.notes.length > 0
                    ? input.notes
                    : `Drill on ${conductedAt.toISOString().slice(0, 10)} raised: ${reasonText}.`,
              status: 'open',
              assigneeUserId: ctx.auth.userId,
              priority: drillActionPriority(concerns),
              dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              siteId: building.siteId,
              createdBy: ctx.auth.userId,
            });
            await tx
              .update(fireDrills)
              .set({ actionId: drillActionId })
              .where(eq(fireDrills.id, id));
          }
          const schedule = (
            await tx
              .select()
              .from(fireLogbookChecks)
              .where(
                and(
                  eq(fireLogbookChecks.buildingId, building.id),
                  eq(fireLogbookChecks.checkType, 'fire_drill'),
                ),
              )
              .limit(1)
          )[0];
          if (
            schedule !== undefined &&
            (schedule.lastDoneAt === null || schedule.lastDoneAt < conductedAt)
          ) {
            await tx
              .update(fireLogbookChecks)
              .set({
                lastDoneAt: conductedAt,
                nextDueAt: nextDueDate(conductedAt, schedule.frequency),
                updatedAt: new Date(),
              })
              .where(eq(fireLogbookChecks.id, schedule.id));
          }
        });
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'drill',
          entityId: id,
          actorUserId: ctx.auth.userId,
          kind: 'drill_recorded',
          detail: input.evacuationSeconds !== null ? String(input.evacuationSeconds ?? '') : '',
        });
        return { id };
      }),
  });

  const peeps = router({
    list: tenantProcedure
      .use(requirePermission('fireSafety.view'))
      .input(
        z
          .object({
            buildingId: z.string().length(26).optional(),
            includeEnded: z.boolean().default(false),
          })
          .default({ includeEnded: false }),
      )
      .query(async ({ ctx, input }) => {
        assertEnabled();
        const conditions = [eq(firePeeps.tenantId, ctx.tenantId)];
        if (input.buildingId !== undefined) {
          conditions.push(eq(firePeeps.buildingId, input.buildingId));
        }
        if (!input.includeEnded) {
          conditions.push(isNull(firePeeps.endedAt));
        }
        const rows = await ctx.db
          .select()
          .from(firePeeps)
          .where(and(...conditions))
          .orderBy(asc(firePeeps.personName));
        const now = new Date();
        return rows.map((p) => ({
          ...p,
          reviewDue: p.endedAt === null && p.nextReviewAt <= now,
        }));
      }),

    create: tenantProcedure
      .use(requirePermission('fireSafety.create'))
      .input(
        z.object({
          buildingId: z.string().length(26).nullable().optional(),
          userId: z.string().nullable().optional(),
          personName: z.string().min(1).max(300),
          assistanceNeeds: z.string().max(4000).default(''),
          planSummary: z.string().max(8000).default(''),
          buddyName: z.string().max(300).default(''),
          equipmentNeeded: z.string().max(2000).default(''),
          reviewFrequencyMonths: z
            .number()
            .int()
            .min(1)
            .max(60)
            .default(DEFAULT_PEEP_REVIEW_MONTHS),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        if (input.buildingId !== null && input.buildingId !== undefined) {
          await loadBuilding(ctx.db, ctx.tenantId, input.buildingId);
        }
        const id = newId();
        const now = new Date();
        await ctx.db.insert(firePeeps).values({
          id,
          tenantId: ctx.tenantId,
          buildingId: input.buildingId ?? null,
          userId: input.userId ?? null,
          personName: input.personName,
          assistanceNeeds: input.assistanceNeeds,
          planSummary: input.planSummary,
          buddyName: input.buddyName,
          equipmentNeeded: input.equipmentNeeded,
          reviewFrequencyMonths: input.reviewFrequencyMonths,
          nextReviewAt: addMonthsClamped(now, input.reviewFrequencyMonths),
          createdBy: ctx.auth.userId,
        });
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'peep',
          entityId: id,
          actorUserId: ctx.auth.userId,
          kind: 'created',
          detail: input.personName,
        });
        return { id };
      }),

    update: tenantProcedure
      .use(requirePermission('fireSafety.create'))
      .input(
        z.object({
          peepId: z.string().length(26),
          buildingId: z.string().length(26).nullable().optional(),
          personName: z.string().min(1).max(300).optional(),
          assistanceNeeds: z.string().max(4000).optional(),
          planSummary: z.string().max(8000).optional(),
          buddyName: z.string().max(300).optional(),
          equipmentNeeded: z.string().max(2000).optional(),
          reviewFrequencyMonths: z.number().int().min(1).max(60).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const peep = await loadPeep(ctx.db, ctx.tenantId, input.peepId);
        if (peep.endedAt !== null) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'ended' });
        }
        if (input.buildingId !== null && input.buildingId !== undefined) {
          await loadBuilding(ctx.db, ctx.tenantId, input.buildingId);
        }
        await ctx.db
          .update(firePeeps)
          .set({
            ...(input.buildingId !== undefined ? { buildingId: input.buildingId } : {}),
            ...(input.personName !== undefined ? { personName: input.personName.trim() } : {}),
            ...(input.assistanceNeeds !== undefined
              ? { assistanceNeeds: input.assistanceNeeds }
              : {}),
            ...(input.planSummary !== undefined ? { planSummary: input.planSummary } : {}),
            ...(input.buddyName !== undefined ? { buddyName: input.buddyName } : {}),
            ...(input.equipmentNeeded !== undefined
              ? { equipmentNeeded: input.equipmentNeeded }
              : {}),
            ...(input.reviewFrequencyMonths !== undefined
              ? { reviewFrequencyMonths: input.reviewFrequencyMonths }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(firePeeps.id, peep.id));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'peep',
          entityId: peep.id,
          actorUserId: ctx.auth.userId,
          kind: 'updated',
        });
        return { ok: true };
      }),

    recordReview: tenantProcedure
      .use(requirePermission('fireSafety.create'))
      .input(z.object({ peepId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const peep = await loadPeep(ctx.db, ctx.tenantId, input.peepId);
        if (peep.endedAt !== null) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'ended' });
        }
        const now = new Date();
        await ctx.db
          .update(firePeeps)
          .set({
            lastReviewedAt: now,
            nextReviewAt: addMonthsClamped(now, peep.reviewFrequencyMonths),
            updatedAt: now,
          })
          .where(eq(firePeeps.id, peep.id));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'peep',
          entityId: peep.id,
          actorUserId: ctx.auth.userId,
          kind: 'peep_review_recorded',
        });
        return { ok: true };
      }),

    /** End (never delete) — the record of who was covered survives. */
    end: tenantProcedure
      .use(requirePermission('fireSafety.manage'))
      .input(z.object({ peepId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const peep = await loadPeep(ctx.db, ctx.tenantId, input.peepId);
        if (peep.endedAt !== null) return { ok: true };
        const now = new Date();
        await ctx.db
          .update(firePeeps)
          .set({ endedAt: now, updatedAt: now })
          .where(eq(firePeeps.id, peep.id));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'peep',
          entityId: peep.id,
          actorUserId: ctx.auth.userId,
          kind: 'peep_ended',
          detail: peep.personName,
        });
        return { ok: true };
      }),
  });

  const marshals = router({
    list: tenantProcedure
      .use(requirePermission('fireSafety.view'))
      .input(
        z
          .object({
            buildingId: z.string().length(26).optional(),
            includeEnded: z.boolean().default(false),
          })
          .default({ includeEnded: false }),
      )
      .query(async ({ ctx, input }) => {
        assertEnabled();
        const conditions = [eq(fireMarshals.tenantId, ctx.tenantId)];
        if (input.buildingId !== undefined) {
          conditions.push(eq(fireMarshals.buildingId, input.buildingId));
        }
        if (!input.includeEnded) {
          conditions.push(isNull(fireMarshals.endedAt));
        }
        const rows = await ctx.db
          .select()
          .from(fireMarshals)
          .where(and(...conditions))
          .orderBy(asc(fireMarshals.createdAt));
        const names = await userNamesById(
          ctx.db,
          ctx.tenantId,
          rows.map((r) => r.userId),
        );
        const now = new Date();
        // FS-X01: the training matrix is the register that holds
        // certificates, verification status and evidence. Where it has an
        // answer it IS the answer — not "best of the two", because a record
        // saying expired against a hand-typed date saying in-date must not
        // render green.
        const competence = await resolveMarshalCompetence(ctx.db, ctx.tenantId, rows, now);
        const designated =
          rows.some((m) => m.userId === null) &&
          (await marshalDesignationExists(ctx.db, ctx.tenantId));
        return rows.map((m) => {
          const c = marshalVerdict(m, competence, designated, now);
          return {
            ...m,
            userName:
              m.userId !== null
                ? (names.get(m.userId) ?? null)
                : m.personName !== ''
                  ? m.personName
                  : null,
            trainingStatus: c.status,
            /** 'training' | 'local' | 'none' — where the verdict came from. */
            competenceSource: c.source,
            /** A date somebody typed with no training record behind it. */
            unbacked: c.unbacked,
            conflictsWithLocal: c.conflictsWithLocal,
          };
        });
      }),

    add: tenantProcedure
      .use(requirePermission('fireSafety.manage'))
      .input(
        z
          .object({
            buildingId: z.string().length(26),
            /** Account-backed marshal — mutually exclusive with personName. */
            userId: z.string().min(1).optional(),
            /** NR3-10: a marshal with no account, named as typed. */
            personName: z.string().min(1).max(300).optional(),
            role: z.enum(FIRE_MARSHAL_ROLES).default('marshal'),
            area: z.string().max(300).default(''),
            trainedAt: z.coerce.date().nullable().optional(),
            trainingExpiresAt: z.coerce.date().nullable().optional(),
            notes: z.string().max(2000).default(''),
          })
          .refine((v) => (v.userId === undefined) !== (v.personName === undefined), {
            message: 'user-or-person-name',
          }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const building = await loadBuilding(ctx.db, ctx.tenantId, input.buildingId);
        if (building.archivedAt !== null) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'archived' });
        }
        await assertMarshalDatesAllowed(ctx.db, ctx.tenantId, input);
        const personName = input.personName?.trim() ?? '';
        if (input.userId !== undefined) {
          // The user must be a member of this tenant.
          const member = (
            await ctx.db
              .select({ id: user.id })
              .from(user)
              .where(and(eq(user.id, input.userId), eq(user.tenantId, ctx.tenantId)))
              .limit(1)
          )[0];
          if (member === undefined) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'unknown-user' });
          }
        } else if (personName === '') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'user-or-person-name' });
        }
        // One active row per person per building — end the old one first.
        // Free-text marshals dedupe on the typed name: no account id exists.
        const active = (
          await ctx.db
            .select({ id: fireMarshals.id })
            .from(fireMarshals)
            .where(
              and(
                eq(fireMarshals.buildingId, building.id),
                input.userId !== undefined
                  ? eq(fireMarshals.userId, input.userId)
                  : and(isNull(fireMarshals.userId), eq(fireMarshals.personName, personName)),
                isNull(fireMarshals.endedAt),
              ),
            )
            .limit(1)
        )[0];
        if (active !== undefined) {
          throw new TRPCError({ code: 'CONFLICT', message: 'already-marshal' });
        }
        const id = newId();
        await ctx.db.insert(fireMarshals).values({
          id,
          tenantId: ctx.tenantId,
          buildingId: building.id,
          userId: input.userId ?? null,
          personName,
          role: input.role,
          area: input.area,
          trainedAt: input.trainedAt ?? null,
          trainingExpiresAt: input.trainingExpiresAt ?? null,
          notes: input.notes,
          createdBy: ctx.auth.userId,
        });
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'marshal',
          entityId: id,
          actorUserId: ctx.auth.userId,
          kind: 'marshal_added',
          detail: personName,
        });
        return { id };
      }),

    update: tenantProcedure
      .use(requirePermission('fireSafety.manage'))
      .input(
        z.object({
          marshalId: z.string().length(26),
          role: z.enum(FIRE_MARSHAL_ROLES).optional(),
          area: z.string().max(300).optional(),
          trainedAt: z.coerce.date().nullable().optional(),
          trainingExpiresAt: z.coerce.date().nullable().optional(),
          notes: z.string().max(2000).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const rows = await ctx.db
          .select()
          .from(fireMarshals)
          .where(and(eq(fireMarshals.id, input.marshalId), eq(fireMarshals.tenantId, ctx.tenantId)))
          .limit(1);
        const marshal = rows[0];
        if (marshal === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
        if (marshal.endedAt !== null) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'ended' });
        }
        await assertMarshalDatesAllowed(ctx.db, ctx.tenantId, input);
        await ctx.db
          .update(fireMarshals)
          .set({
            ...(input.role !== undefined ? { role: input.role } : {}),
            ...(input.area !== undefined ? { area: input.area } : {}),
            ...(input.trainedAt !== undefined ? { trainedAt: input.trainedAt } : {}),
            ...(input.trainingExpiresAt !== undefined
              ? { trainingExpiresAt: input.trainingExpiresAt }
              : {}),
            ...(input.notes !== undefined ? { notes: input.notes } : {}),
            updatedAt: new Date(),
          })
          .where(eq(fireMarshals.id, marshal.id));
        return { ok: true };
      }),

    end: tenantProcedure
      .use(requirePermission('fireSafety.manage'))
      .input(z.object({ marshalId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const rows = await ctx.db
          .select()
          .from(fireMarshals)
          .where(and(eq(fireMarshals.id, input.marshalId), eq(fireMarshals.tenantId, ctx.tenantId)))
          .limit(1);
        const marshal = rows[0];
        if (marshal === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
        if (marshal.endedAt !== null) return { ok: true };
        const now = new Date();
        await ctx.db
          .update(fireMarshals)
          .set({ endedAt: now, updatedAt: now })
          .where(eq(fireMarshals.id, marshal.id));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          entityType: 'marshal',
          entityId: marshal.id,
          actorUserId: ctx.auth.userId,
          kind: 'marshal_ended',
        });
        return { ok: true };
      }),

    /**
     * Coverage per active building: how many marshals are in date, who
     * is expiring soon, and which buildings have nobody — the gap the
     * practitioner has to fill before the next shift.
     */
    coverage: tenantProcedure.use(requirePermission('fireSafety.view')).query(async ({ ctx }) => {
      assertEnabled();
      const buildings = await ctx.db
        .select({
          id: fireBuildings.id,
          name: fireBuildings.name,
          requiresMarshalCover: fireBuildings.requiresMarshalCover,
          marshalTarget: fireBuildings.marshalTarget,
        })
        .from(fireBuildings)
        .where(and(eq(fireBuildings.tenantId, ctx.tenantId), eq(fireBuildings.status, 'active')))
        .orderBy(asc(fireBuildings.name));
      const rows = await ctx.db
        .select()
        .from(fireMarshals)
        .where(and(eq(fireMarshals.tenantId, ctx.tenantId), isNull(fireMarshals.endedAt)));
      const now = new Date();
      // FS-X01: `gap` is the module's only marshal control, and it was
      // satisfiable by typing a date. It now runs on the reconciled verdict.
      const competence = await resolveMarshalCompetence(ctx.db, ctx.tenantId, rows, now);
      const designated =
        rows.some((m) => m.userId === null) &&
        (await marshalDesignationExists(ctx.db, ctx.tenantId));
      const verdict = (m: (typeof rows)[number]) => marshalVerdict(m, competence, designated, now);
      return buildings.map((building) => {
        const members = rows.filter((m) => m.buildingId === building.id);
        const verdicts = members.map(verdict);
        const statuses = verdicts.map((v) => v.status);
        const inDate = statuses.filter((s) => s === 'in_date' || s === 'expiring_soon').length;
        return {
          buildingId: building.id,
          buildingName: building.name,
          requiresMarshalCover: building.requiresMarshalCover,
          marshalTarget: building.marshalTarget,
          marshalCount: members.length,
          inDateCount: inDate,
          expiringSoonCount: statuses.filter((s) => s === 'expiring_soon').length,
          /**
           * Marshals asserted competent by a date nobody can corroborate.
           * They still count toward `inDateCount` — silently discounting
           * them would flip live registers red overnight — but the number
           * is surfaced so the gap between the two registers is visible
           * instead of invisible.
           */
          unbackedCount: verdicts.filter((v) => v.unbacked).length,
          // FS-8: a gap is only a gap where cover is required, and the
          // building's own minimum is the bar — not "at least one,
          // everywhere".
          gap: building.requiresMarshalCover && inDate < building.marshalTarget,
        };
      });
    }),
  });

  /** The needs-attention strip: everything that rotted since last visit. */
  const overview = tenantProcedure
    .use(requirePermission('fireSafety.view'))
    .input(
      z
        .object({
          /**
           * Scope every aggregate to buildings on this site (the per-site
           * compliance roll-up). FRAs / PEEPs / marshals not attached to a
           * building on the site are excluded — a tenant-wide FRA has no
           * site to roll up under.
           */
          siteId: z.string().length(26).optional(),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      assertEnabled();
      const now = new Date();
      const siteCondition =
        input.siteId !== undefined ? [eq(fireBuildings.siteId, input.siteId)] : [];
      const [checkRows, doorRows, fraRows, peepRows, marshalJoined, activeBuildings] =
        await Promise.all([
          ctx.db
            .select({ check: fireLogbookChecks, buildingStatus: fireBuildings.status })
            .from(fireLogbookChecks)
            .innerJoin(fireBuildings, eq(fireLogbookChecks.buildingId, fireBuildings.id))
            .where(
              and(
                eq(fireLogbookChecks.tenantId, ctx.tenantId),
                eq(fireLogbookChecks.active, true),
                eq(fireBuildings.status, 'active'),
                ...siteCondition,
              ),
            ),
          ctx.db
            .select({ door: fireDoors, building: fireBuildings })
            .from(fireDoors)
            .innerJoin(fireBuildings, eq(fireDoors.buildingId, fireBuildings.id))
            .where(
              and(
                eq(fireDoors.tenantId, ctx.tenantId),
                eq(fireDoors.status, 'active'),
                eq(fireBuildings.status, 'active'),
                ...siteCondition,
              ),
            ),
          ctx.db
            .select({
              id: fireRiskAssessments.id,
              status: fireRiskAssessments.status,
              riskRating: fireRiskAssessments.riskRating,
              nextReviewAt: fireRiskAssessments.nextReviewAt,
            })
            .from(fireRiskAssessments)
            .leftJoin(fireBuildings, eq(fireRiskAssessments.buildingId, fireBuildings.id))
            .where(
              and(
                eq(fireRiskAssessments.tenantId, ctx.tenantId),
                ne(fireRiskAssessments.status, 'archived'),
                ...siteCondition,
              ),
            ),
          ctx.db
            .select({ nextReviewAt: firePeeps.nextReviewAt })
            .from(firePeeps)
            .leftJoin(fireBuildings, eq(firePeeps.buildingId, fireBuildings.id))
            .where(
              and(
                eq(firePeeps.tenantId, ctx.tenantId),
                isNull(firePeeps.endedAt),
                lte(firePeeps.nextReviewAt, now),
                ...siteCondition,
              ),
            ),
          ctx.db
            .select({ marshal: fireMarshals })
            .from(fireMarshals)
            .innerJoin(fireBuildings, eq(fireMarshals.buildingId, fireBuildings.id))
            .where(
              and(
                eq(fireMarshals.tenantId, ctx.tenantId),
                isNull(fireMarshals.endedAt),
                ...siteCondition,
              ),
            ),
          ctx.db
            .select({
              id: fireBuildings.id,
              requiresMarshalCover: fireBuildings.requiresMarshalCover,
              marshalTarget: fireBuildings.marshalTarget,
            })
            .from(fireBuildings)
            .where(
              and(
                eq(fireBuildings.tenantId, ctx.tenantId),
                eq(fireBuildings.status, 'active'),
                ...siteCondition,
              ),
            ),
        ]);
      const marshalRows = marshalJoined.map((r) => r.marshal);

      let checksOverdue = 0;
      let checksDueSoon = 0;
      let checksFailed = 0;
      for (const { check } of checkRows) {
        const status = checkDisplayStatus(check.nextDueAt, check.frequency, check.lastResult, now);
        if (status === 'failed') checksFailed += 1;
        else if (status === 'overdue') checksOverdue += 1;
        else if (status === 'due_soon') checksDueSoon += 1;
      }

      let doorsOverdue = 0;
      let doorsFailed = 0;
      for (const { door, building } of doorRows) {
        const interval = doorIntervalMonths(
          { locationKind: door.locationKind, override: door.inspectionIntervalMonthsOverride },
          building,
        );
        const status = doorDisplayStatus(door.nextInspectionDueAt, interval, door.lastOutcome, now);
        if (status === 'failed') doorsFailed += 1;
        else if (status === 'overdue') doorsOverdue += 1;
      }

      const frasReviewDue = fraRows.filter(
        (f) => f.status === 'active' && f.nextReviewAt !== null && f.nextReviewAt <= now,
      ).length;
      const frasDraft = fraRows.filter((f) => f.status === 'draft').length;
      // FS-6: an intolerable assessment is a needs-attention item in its
      // own right, not a quiet row in a list.
      const frasIntolerable = fraRows.filter(
        (f) => f.status === 'active' && f.riskRating === 'intolerable',
      ).length;

      // Marshal coverage gaps: active buildings with nobody in date.
      const marshalsByBuilding = new Map<string, number>();
      for (const m of marshalRows) {
        const status = marshalTrainingStatus(m, now);
        if (status === 'in_date' || status === 'expiring_soon') {
          marshalsByBuilding.set(m.buildingId, (marshalsByBuilding.get(m.buildingId) ?? 0) + 1);
        }
      }
      const marshalGaps = activeBuildings.filter(
        (b) => b.requiresMarshalCover && (marshalsByBuilding.get(b.id) ?? 0) < b.marshalTarget,
      ).length;
      const marshalsExpiringSoon = marshalRows.filter(
        (m) => marshalTrainingStatus(m, now) === 'expiring_soon',
      ).length;

      return {
        checksOverdue,
        checksDueSoon,
        checksFailed,
        doorsOverdue,
        doorsFailed,
        frasReviewDue,
        frasDraft,
        frasIntolerable,
        peepReviewsDue: peepRows.length,
        marshalGaps,
        marshalsExpiringSoon,
      };
    });

  /**
   * FS-X01: which training requirements count as a fire-marshal ticket.
   *
   * Empty is the default and means "no designation" — the pre-FS-X01
   * behaviour — so the fix ships inert and no tenant's marshals change
   * state until an administrator deliberately makes the link.
   */
  const settings = router({
    get: tenantProcedure.use(requirePermission('fireSafety.view')).query(async ({ ctx }) => {
      assertEnabled();
      return { marshalRequirementIds: await loadMarshalRequirementIds(ctx.db, ctx.tenantId) };
    }),
    setMarshalRequirements: tenantProcedure
      .use(requirePermission('fireSafety.manage'))
      .input(z.object({ requirementIds: z.array(z.string().length(26)).max(20) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const ids = [...new Set(input.requirementIds)];
        // Ground rule 4: a requirement id from another tenant would
        // designate a ticket nobody here can hold, quietly making every
        // marshal unbacked.
        if (ids.length > 0) {
          const found = await ctx.db
            .select({ id: trainingRequirements.id })
            .from(trainingRequirements)
            .where(
              and(
                eq(trainingRequirements.tenantId, ctx.tenantId),
                inArray(trainingRequirements.id, ids),
                isNull(trainingRequirements.archivedAt),
              ),
            );
          if (found.length !== ids.length) {
            throw new TRPCError({
              code: 'NOT_FOUND',
              message: 'training-requirement-not-found',
            });
          }
        }
        const now = new Date();
        await ctx.db
          .insert(fireSafetySettings)
          .values({
            tenantId: ctx.tenantId,
            marshalRequirementIds: ids,
            updatedBy: ctx.auth.userId,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: fireSafetySettings.tenantId,
            set: { marshalRequirementIds: ids, updatedBy: ctx.auth.userId, updatedAt: now },
          });
        return { ok: true as const };
      }),
  });

  return router({
    buildings,
    fras,
    settings,
    logbook,
    doors,
    drills,
    peeps,
    marshals,
    overview,
  });
}
