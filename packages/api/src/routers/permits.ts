/**
 * Permits router (FreeHS module B3) — Permit to Work & High-Risk
 * Activities. Formal authorisation, control and closure of the activities
 * most likely to kill someone.
 *
 * Design goals from the practitioner spec:
 *   - permit types carry the control requirements: precondition checklist,
 *     gas testing, isolation certificate, rescue plan, authorising
 *     engineer counter-signature, and a maximum validity window. The nine
 *     standard high-risk types seed per tenant on first use and stay
 *     editable (`DEFAULT_PERMIT_TYPES` in `@forma360/shared/permits`);
 *   - the issue guard is the point of the module: a permit cannot be
 *     issued until every snapshotted precondition is confirmed, required
 *     evidence (gas readings, isolation certificate, rescue plan) is on
 *     the record, and the authorising signature is in place. The issuer
 *     can never be the acceptor;
 *   - every signature is a timestamped row-level stamp (authorisedAt /
 *     issuedAt / acceptedAt + user ids) plus an append-only event;
 *   - simultaneous-operations (SIMOPs) conflicts — another open permit at
 *     the same site with an overlapping window — warn before issue and
 *     must be explicitly acknowledged to proceed;
 *   - the lifecycle is a strict state machine (`canTransition`):
 *     suspension for changed conditions, shift handover (drops back to
 *     issued until the incoming acceptor signs on), extension with
 *     re-authorisation, formal cancellation and closure with a four-point
 *     close-out check;
 *   - the live board surfaces every open permit across the estate with
 *     expiry countdowns; the `forma360-permit-expiry-watch` worker
 *     escalates any open permit past its validity window.
 *
 * Brand gating (ADR 0010): built with `{ enabled }` wired from the active
 * brand's module catalogue; every procedure refuses when disabled.
 *
 * Deliberate v1 gaps (documented, not accidental): competence checks
 * against Training records are a precondition checklist line until the
 * Training module (Phase 10) lands; extension does not re-run the SIMOPs
 * check for the lengthened window; no dependents-registry resolver (the
 * registry's module union is closed — same status as risk assessments and
 * COSHH).
 */
import {
  documents,
  permitEvents,
  permits,
  permitTypes,
  ramsPacks,
  ramsPackVersions,
  ramsReviews,
  riskAssessments,
  siteMembers,
  sites,
  user,
  type Permit,
  type PermitEventKind,
  type PermitType,
} from '@forma360/db/schema';
import { reviewAcceptanceValid } from '@forma360/shared/rams';
import type { Database } from '@forma360/db/client';
import {
  allPreconditionsChecked,
  canTransition,
  closureChecksSchema,
  closureComplete,
  DEFAULT_PERMIT_TYPES,
  GAS_READING_UNITS,
  gasGateError,
  gasLimitSchema,
  isOpenPermitStatus,
  MAX_ENTRY_LOG_ROWS,
  MAX_WORKERS_PER_PERMIT,
  OPEN_PERMIT_STATUSES,
  openEntryCount,
  overlaps,
  PERMIT_ATTACHMENT_KINDS,
  PERMIT_CATEGORIES,
  PERMIT_WORKER_ROLES,
  permitIsOverdue,
  permitTypePreconditionSchema,
  readingWithinLimit,
  sameAreaMatch,
  snapshotPreconditions,
  validityWindowError,
  type PermitEntryLogRow,
  type PermitPreconditionState,
  type PermitStatus,
  type PermitWorker,
} from '@forma360/shared/permits';
import { grantsAdminAccess } from '@forma360/permissions/catalogue';
import { newId } from '@forma360/shared/id';
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { nextReferenceValue } from '../reference-counter';
import { requirePermission, tenantProcedure } from '../procedures';
import { router } from '../trpc';

export interface PermitsRouterDeps {
  /** Wired from the brand module catalogue (ADR 0010). */
  enabled: boolean;
  /**
   * PDF renderer for the postable permit record (HSE review PW-6).
   * Optional: absent in non-web callers — `renderPdf` refuses when
   * missing, everything else works.
   */
  renderPdf?: (input: {
    tenantId: string;
    permitId: string;
  }) => Promise<{ key: string; bytes: number; stub: boolean }>;
}

// ─── Scoped loaders ─────────────────────────────────────────────────────────

/** Load a permit scoped to the tenant or throw NOT_FOUND. */
async function loadPermit(db: Database, tenantId: string, permitId: string): Promise<Permit> {
  const rows = await db
    .select()
    .from(permits)
    .where(and(eq(permits.id, permitId), eq(permits.tenantId, tenantId)))
    .limit(1);
  const permit = rows[0];
  if (permit === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
  return permit;
}

/** Load a permit type scoped to the tenant or throw NOT_FOUND. */
async function loadPermitType(db: Database, tenantId: string, typeId: string): Promise<PermitType> {
  const rows = await db
    .select()
    .from(permitTypes)
    .where(and(eq(permitTypes.id, typeId), eq(permitTypes.tenantId, tenantId)))
    .limit(1);
  const type = rows[0];
  if (type === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
  return type;
}

/**
 * Load a site scoped to the tenant or throw. The FK alone only proves the
 * site exists — this is what stops a crafted request pointing a permit at
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

/** Load a user scoped to the tenant or throw — same rationale as sites. */
async function loadUserInTenant(db: Database, tenantId: string, userId: string) {
  const rows = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(and(eq(user.id, userId), eq(user.tenantId, tenantId)))
    .limit(1);
  const found = rows[0];
  if (found === undefined) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'unknown-user' });
  }
  return found;
}

async function userNamesById(
  db: Database,
  tenantId: string,
  userIds: ReadonlyArray<string>,
): Promise<Map<string, string>> {
  const distinct = [...new Set(userIds)].filter((id) => id.length > 0 && id !== 'system');
  if (distinct.length === 0) return new Map();
  const rows = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(and(eq(user.tenantId, tenantId), inArray(user.id, distinct)));
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function siteNamesById(
  db: Database,
  tenantId: string,
  siteIds: ReadonlyArray<string>,
): Promise<Map<string, string>> {
  const distinct = [...new Set(siteIds)];
  if (distinct.length === 0) return new Map();
  const rows = await db
    .select({ id: sites.id, name: sites.name })
    .from(sites)
    .where(and(eq(sites.tenantId, tenantId), inArray(sites.id, distinct)));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Append one immutable audit row. Never updated or deleted. */
async function logEvent(
  db: Database,
  entry: {
    tenantId: string;
    permitId: string;
    actorUserId: string;
    kind: PermitEventKind;
    detail?: string;
  },
): Promise<void> {
  await db.insert(permitEvents).values({
    id: newId(),
    tenantId: entry.tenantId,
    permitId: entry.permitId,
    actorUserId: entry.actorUserId,
    kind: entry.kind,
    detail: entry.detail ?? '',
  });
}

/** Refuse any lifecycle move not in the shared transition matrix. */
function assertTransition(from: PermitStatus, to: PermitStatus): void {
  if (!canTransition(from, to)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'invalid-transition' });
  }
}

/** Load a risk assessment scoped to the tenant or throw (PW-7). */
async function loadRiskAssessmentInTenant(db: Database, tenantId: string, id: string) {
  const rows = await db
    .select({
      id: riskAssessments.id,
      title: riskAssessments.title,
      referenceNumber: riskAssessments.referenceNumber,
      status: riskAssessments.status,
    })
    .from(riskAssessments)
    .where(and(eq(riskAssessments.id, id), eq(riskAssessments.tenantId, tenantId)))
    .limit(1);
  const found = rows[0];
  if (found === undefined) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'unknown-risk-assessment' });
  }
  return found;
}

/** Load a document scoped to the tenant or throw (PW-7). */
async function loadDocumentInTenant(db: Database, tenantId: string, id: string) {
  const rows = await db
    .select({ id: documents.id, name: documents.name })
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.tenantId, tenantId)))
    .limit(1);
  const found = rows[0];
  if (found === undefined) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'unknown-document' });
  }
  return found;
}

/**
 * Site-scoped issuer authority (HSE review PW-12). When the permit
 * belongs to a site whose team is curated (the site has ANY members),
 * lifecycle authority is limited to that team. Admins bypass. Site-less
 * permits and uncurated sites stay open — scoping activates per site the
 * moment its team exists, so tenants that don't use site teams are not
 * locked out.
 */
async function assertSiteAuthority(
  db: Database,
  tenantId: string,
  permit: Pick<Permit, 'siteId'>,
  callerId: string,
  permissions: readonly string[],
): Promise<void> {
  if (permit.siteId === null) return;
  if (grantsAdminAccess(permissions)) return;
  const members = await db
    .select({ userId: siteMembers.userId })
    .from(siteMembers)
    .where(and(eq(siteMembers.tenantId, tenantId), eq(siteMembers.siteId, permit.siteId)));
  if (members.length === 0) return;
  if (!members.some((m) => m.userId === callerId)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'site-scope' });
  }
}

/**
 * Who may record physical checks and evidence (HSE review PW-9): the
 * competent person (permits.create), any issuer authority, admins, and
 * the permit's named acceptor — the person in charge at the face. The
 * issue signature itself stays with `permits.issue`.
 */
function assertCanRecord(
  ctx: { permissions: readonly string[]; auth: { userId: string } },
  permit: Pick<Permit, 'acceptorUserId'>,
): void {
  const allowed =
    ctx.permissions.includes('permits.issue') ||
    ctx.permissions.includes('permits.create') ||
    grantsAdminAccess(ctx.permissions) ||
    permit.acceptorUserId === ctx.auth.userId;
  if (!allowed) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'not-allowed' });
  }
}

export interface PermitConflict {
  permitId: string;
  referenceNumber: string | null;
  title: string;
  status: PermitStatus;
  typeName: string;
  validFrom: Date;
  validTo: Date;
  locationText: string;
  /** True when the normalised location text matches — the loudest warning. */
  sameArea: boolean;
}

/**
 * Simultaneous-operations check: open permits at the same site whose
 * validity window overlaps the given one. Site-less permits never
 * conflict — there is no "same area" to clash in.
 */
async function findConflicts(
  db: Database,
  tenantId: string,
  args: {
    siteId: string | null;
    validFrom: Date;
    validTo: Date;
    locationText: string;
    excludePermitId?: string | undefined;
  },
): Promise<PermitConflict[]> {
  if (args.siteId === null) return [];
  const rows = await db
    .select({
      id: permits.id,
      referenceNumber: permits.referenceNumber,
      title: permits.title,
      status: permits.status,
      validFrom: permits.validFrom,
      validTo: permits.validTo,
      locationText: permits.locationText,
      typeName: permitTypes.name,
    })
    .from(permits)
    .innerJoin(permitTypes, eq(permitTypes.id, permits.permitTypeId))
    .where(
      and(
        eq(permits.tenantId, tenantId),
        eq(permits.siteId, args.siteId),
        inArray(permits.status, [...OPEN_PERMIT_STATUSES]),
      ),
    );
  return rows
    .filter((r) => r.id !== args.excludePermitId)
    .filter((r) => overlaps(args.validFrom, args.validTo, r.validFrom, r.validTo))
    .map((r) => ({
      permitId: r.id,
      referenceNumber: r.referenceNumber,
      title: r.title,
      status: r.status,
      typeName: r.typeName,
      validFrom: r.validFrom,
      validTo: r.validTo,
      locationText: r.locationText,
      // Token-set match (PW-14): reordered or subset wording still flags.
      sameArea: sameAreaMatch(args.locationText, r.locationText),
    }));
}

/**
 * Seed the nine default permit types for a tenant that has none.
 * Serialised on the tenant row lock so two concurrent first reads cannot
 * double-seed. Idempotent.
 */
async function ensureSeededTypes(
  db: Database,
  tenantId: string,
  actorUserId: string,
): Promise<void> {
  const existing = await db
    .select({ id: permitTypes.id })
    .from(permitTypes)
    .where(eq(permitTypes.tenantId, tenantId))
    .limit(1);
  if (existing[0] !== undefined) return;
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`);
    const again = await tx
      .select({ id: permitTypes.id })
      .from(permitTypes)
      .where(eq(permitTypes.tenantId, tenantId))
      .limit(1);
    if (again[0] !== undefined) return;
    await tx.insert(permitTypes).values(
      DEFAULT_PERMIT_TYPES.map((t) => ({
        id: newId(),
        tenantId,
        category: t.category,
        name: t.name,
        requiresAuthoriser: t.requiresAuthoriser,
        requiresGasTesting: t.requiresGasTesting,
        requiresIsolationCertificate: t.requiresIsolationCertificate,
        requiresRescuePlan: t.requiresRescuePlan,
        // `requiresRiskAssessment` and `requiresRamsPack` deliberately
        // take the column default (false): turning either on for the
        // seeded catalogue would change the issue gate under existing
        // tenants. Both are opt-in per type.
        maxDurationHours: t.maxDurationHours,
        preconditions: t.preconditions,
        gasLimits: t.gasLimits,
        gasTestMaxAgeMinutes: t.gasTestMaxAgeMinutes,
        isSystem: true,
        createdBy: actorUserId,
      })),
    );
  });
}

/** Attachment kinds that satisfy an evidence requirement. */
function hasAttachmentOfKind(permit: Permit, kind: string): boolean {
  return permit.attachments.some((a) => a.kind === kind);
}

/** Why a `requiresRamsPack` type refuses to issue. RAMS spec §10.2. */
type RamsGateError = 'rams-pack-required' | 'rams-pack-not-issued' | 'rams-acceptance-expired';

/**
 * The RAMS gate (RS-E14). A permit whose type demands an accepted safe
 * system of work may be backed by either side of the module:
 *   - an OWN pack: the linked `rams_pack_versions` row must belong to a
 *     pack that is currently `issued` (a withdrawn or superseded pack
 *     stops backing the permit);
 *   - a THIRD-PARTY pack: the linked `rams_reviews` row must be accepted
 *     (with or without conditions) and still inside its validity window.
 *
 * Returns null when the gate is satisfied.
 */
async function ramsPackGateError(
  db: Database,
  tenantId: string,
  permit: Pick<Permit, 'ramsPackVersionId' | 'ramsReviewId'>,
  now: Date,
): Promise<RamsGateError | null> {
  if (permit.ramsPackVersionId === null && permit.ramsReviewId === null) {
    return 'rams-pack-required';
  }

  if (permit.ramsPackVersionId !== null) {
    const rows = await db
      .select({ status: ramsPacks.status })
      .from(ramsPackVersions)
      .innerJoin(ramsPacks, eq(ramsPacks.id, ramsPackVersions.packId))
      .where(
        and(
          eq(ramsPackVersions.tenantId, tenantId),
          eq(ramsPackVersions.id, permit.ramsPackVersionId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (row === undefined) return 'rams-pack-required';
    if (row.status !== 'issued') return 'rams-pack-not-issued';
    return null;
  }

  const rows = await db
    .select({
      outcome: ramsReviews.outcome,
      validFrom: ramsReviews.validFrom,
      validTo: ramsReviews.validTo,
    })
    .from(ramsReviews)
    .where(and(eq(ramsReviews.tenantId, tenantId), eq(ramsReviews.id, permit.ramsReviewId ?? '')))
    .limit(1);
  const review = rows[0];
  if (review === undefined) return 'rams-pack-required';
  return reviewAcceptanceValid(review, now) ? null : 'rams-acceptance-expired';
}

/** The category ordering used for type lists — matches the catalogue. */
const CATEGORY_ORDER = new Map(PERMIT_CATEGORIES.map((c, i) => [c, i] as const));

// ─── Input schemas ──────────────────────────────────────────────────────────

const typeCreateInput = z.object({
  category: z.enum(PERMIT_CATEGORIES),
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).default(''),
  requiresAuthoriser: z.boolean().default(false),
  requiresGasTesting: z.boolean().default(false),
  requiresIsolationCertificate: z.boolean().default(false),
  requiresRescuePlan: z.boolean().default(false),
  requiresRiskAssessment: z.boolean().default(false),
  /** RAMS spec §10.2 — demands an issued own pack or an accepted third-party review. */
  requiresRamsPack: z.boolean().default(false),
  maxDurationHours: z.number().int().min(1).max(72).default(12),
  preconditions: z.array(permitTypePreconditionSchema).max(40).default([]),
  gasLimits: z.array(gasLimitSchema).max(20).default([]),
  gasTestMaxAgeMinutes: z
    .number()
    .int()
    .min(5)
    .max(24 * 60)
    .default(60),
});

const typeUpdateInput = z.object({
  typeId: z.string().length(26),
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  requiresAuthoriser: z.boolean().optional(),
  requiresGasTesting: z.boolean().optional(),
  requiresIsolationCertificate: z.boolean().optional(),
  requiresRescuePlan: z.boolean().optional(),
  requiresRiskAssessment: z.boolean().optional(),
  requiresRamsPack: z.boolean().optional(),
  maxDurationHours: z.number().int().min(1).max(72).optional(),
  preconditions: z.array(permitTypePreconditionSchema).max(40).optional(),
  gasLimits: z.array(gasLimitSchema).max(20).optional(),
  gasTestMaxAgeMinutes: z
    .number()
    .int()
    .min(5)
    .max(24 * 60)
    .optional(),
});

function assertUniqueGasLimitIds(limits: ReadonlyArray<{ id: string }> | undefined): void {
  if (limits === undefined) return;
  if (new Set(limits.map((l) => l.id)).size !== limits.length) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'duplicate-precondition-id' });
  }
}

function assertUniquePreconditionIds(defs: ReadonlyArray<{ id: string }> | undefined): void {
  if (defs === undefined) return;
  if (new Set(defs.map((d) => d.id)).size !== defs.length) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'duplicate-precondition-id' });
  }
}

const permitCreateInput = z.object({
  permitTypeId: z.string().length(26),
  title: z.string().trim().min(1).max(300),
  workDescription: z.string().max(5000).default(''),
  siteId: z.string().length(26).optional(),
  locationText: z.string().max(500).default(''),
  validFrom: z.coerce.date(),
  validTo: z.coerce.date(),
  acceptorUserId: z.string().max(64).optional(),
  isolationCertificateRef: z.string().max(300).default(''),
  rescuePlan: z.string().max(5000).default(''),
  riskAssessmentId: z.string().length(26).optional(),
  /** Preferred over the loose method-statement document link. */
  ramsPackVersionId: z.string().length(26).optional(),
  /** The accepted third-party review backing this permit, if any. */
  ramsReviewId: z.string().length(26).optional(),
  methodStatementDocumentId: z.string().length(26).optional(),
});

const permitUpdateInput = z.object({
  permitId: z.string().length(26),
  title: z.string().trim().min(1).max(300).optional(),
  workDescription: z.string().max(5000).optional(),
  siteId: z.string().length(26).nullable().optional(),
  locationText: z.string().max(500).optional(),
  validFrom: z.coerce.date().optional(),
  validTo: z.coerce.date().optional(),
  acceptorUserId: z.string().max(64).nullable().optional(),
  isolationCertificateRef: z.string().max(300).optional(),
  rescuePlan: z.string().max(5000).optional(),
  riskAssessmentId: z.string().length(26).nullable().optional(),
  ramsPackVersionId: z.string().length(26).nullable().optional(),
  ramsReviewId: z.string().length(26).nullable().optional(),
  methodStatementDocumentId: z.string().length(26).nullable().optional(),
});

const listStatusFilter = z.enum([
  'open',
  'draft',
  'issued',
  'active',
  'suspended',
  'closed',
  'cancelled',
  'all',
]);

// ─── Router ─────────────────────────────────────────────────────────────────

export function createPermitsRouter(deps: PermitsRouterDeps) {
  function assertEnabled(): void {
    if (!deps.enabled) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'module-disabled' });
    }
  }

  const types = router({
    list: tenantProcedure
      .use(requirePermission('permits.view'))
      .input(z.object({ includeArchived: z.boolean().default(false) }).default({}))
      .query(async ({ ctx, input }) => {
        assertEnabled();
        await ensureSeededTypes(ctx.db, ctx.tenantId, ctx.auth.userId);
        const rows = await ctx.db
          .select()
          .from(permitTypes)
          .where(eq(permitTypes.tenantId, ctx.tenantId));
        const counts = await ctx.db
          .select({ permitTypeId: permits.permitTypeId, n: sql<number>`count(*)::int` })
          .from(permits)
          .where(
            and(
              eq(permits.tenantId, ctx.tenantId),
              inArray(permits.status, [...OPEN_PERMIT_STATUSES]),
            ),
          )
          .groupBy(permits.permitTypeId);
        const countByType = new Map(counts.map((c) => [c.permitTypeId, c.n]));
        return rows
          .filter((r) => input.includeArchived || r.archivedAt === null)
          .sort(
            (a, b) =>
              (CATEGORY_ORDER.get(a.category) ?? 99) - (CATEGORY_ORDER.get(b.category) ?? 99) ||
              a.name.localeCompare(b.name),
          )
          .map((r) => ({ ...r, openPermitCount: countByType.get(r.id) ?? 0 }));
      }),

    create: tenantProcedure
      .use(requirePermission('permits.manage'))
      .input(typeCreateInput)
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        await ensureSeededTypes(ctx.db, ctx.tenantId, ctx.auth.userId);
        assertUniquePreconditionIds(input.preconditions);
        assertUniqueGasLimitIds(input.gasLimits);
        const dup = await ctx.db
          .select({ id: permitTypes.id })
          .from(permitTypes)
          .where(
            and(
              eq(permitTypes.tenantId, ctx.tenantId),
              sql`lower(${permitTypes.name}) = ${input.name.toLowerCase()}`,
            ),
          )
          .limit(1);
        if (dup[0] !== undefined) {
          throw new TRPCError({ code: 'CONFLICT', message: 'duplicate-name' });
        }
        const id = newId();
        await ctx.db.insert(permitTypes).values({
          id,
          tenantId: ctx.tenantId,
          category: input.category,
          name: input.name,
          description: input.description,
          requiresAuthoriser: input.requiresAuthoriser,
          requiresGasTesting: input.requiresGasTesting,
          requiresIsolationCertificate: input.requiresIsolationCertificate,
          requiresRescuePlan: input.requiresRescuePlan,
          requiresRamsPack: input.requiresRamsPack,
          requiresRiskAssessment: input.requiresRiskAssessment,
          maxDurationHours: input.maxDurationHours,
          preconditions: input.preconditions,
          gasLimits: input.gasLimits,
          gasTestMaxAgeMinutes: input.gasTestMaxAgeMinutes,
          isSystem: false,
          createdBy: ctx.auth.userId,
        });
        return { typeId: id };
      }),

    update: tenantProcedure
      .use(requirePermission('permits.manage'))
      .input(typeUpdateInput)
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const type = await loadPermitType(ctx.db, ctx.tenantId, input.typeId);
        assertUniquePreconditionIds(input.preconditions);
        assertUniqueGasLimitIds(input.gasLimits);
        if (input.name !== undefined && input.name.toLowerCase() !== type.name.toLowerCase()) {
          const dup = await ctx.db
            .select({ id: permitTypes.id })
            .from(permitTypes)
            .where(
              and(
                eq(permitTypes.tenantId, ctx.tenantId),
                sql`lower(${permitTypes.name}) = ${input.name.toLowerCase()}`,
              ),
            )
            .limit(1);
          if (dup[0] !== undefined) {
            throw new TRPCError({ code: 'CONFLICT', message: 'duplicate-name' });
          }
        }
        await ctx.db
          .update(permitTypes)
          .set({
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.requiresAuthoriser !== undefined
              ? { requiresAuthoriser: input.requiresAuthoriser }
              : {}),
            ...(input.requiresGasTesting !== undefined
              ? { requiresGasTesting: input.requiresGasTesting }
              : {}),
            ...(input.requiresIsolationCertificate !== undefined
              ? { requiresIsolationCertificate: input.requiresIsolationCertificate }
              : {}),
            ...(input.requiresRamsPack !== undefined
              ? { requiresRamsPack: input.requiresRamsPack }
              : {}),
            ...(input.requiresRescuePlan !== undefined
              ? { requiresRescuePlan: input.requiresRescuePlan }
              : {}),
            ...(input.maxDurationHours !== undefined
              ? { maxDurationHours: input.maxDurationHours }
              : {}),
            ...(input.preconditions !== undefined ? { preconditions: input.preconditions } : {}),
            ...(input.requiresRiskAssessment !== undefined
              ? { requiresRiskAssessment: input.requiresRiskAssessment }
              : {}),
            ...(input.gasLimits !== undefined ? { gasLimits: input.gasLimits } : {}),
            ...(input.gasTestMaxAgeMinutes !== undefined
              ? { gasTestMaxAgeMinutes: input.gasTestMaxAgeMinutes }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(permitTypes.id, type.id));
        return { typeId: type.id };
      }),

    archive: tenantProcedure
      .use(requirePermission('permits.manage'))
      .input(z.object({ typeId: z.string().length(26), restore: z.boolean().default(false) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const type = await loadPermitType(ctx.db, ctx.tenantId, input.typeId);
        await ctx.db
          .update(permitTypes)
          .set({ archivedAt: input.restore ? null : new Date(), updatedAt: new Date() })
          .where(eq(permitTypes.id, type.id));
        return { typeId: type.id };
      }),
  });

  return router({
    types,

    list: tenantProcedure
      .use(requirePermission('permits.view'))
      .input(
        z
          .object({
            status: listStatusFilter.default('open'),
            siteId: z.string().length(26).optional(),
            typeId: z.string().length(26).optional(),
            search: z.string().max(200).optional(),
          })
          .default({ status: 'open' }),
      )
      .query(async ({ ctx, input }) => {
        assertEnabled();
        const conditions = [eq(permits.tenantId, ctx.tenantId)];
        if (input.status === 'open') {
          conditions.push(inArray(permits.status, [...OPEN_PERMIT_STATUSES]));
        } else if (input.status !== 'all') {
          conditions.push(eq(permits.status, input.status));
        }
        if (input.siteId !== undefined) conditions.push(eq(permits.siteId, input.siteId));
        if (input.typeId !== undefined) conditions.push(eq(permits.permitTypeId, input.typeId));
        if (input.search !== undefined && input.search.trim().length > 0) {
          const like = `%${input.search.trim().toLowerCase()}%`;
          conditions.push(
            sql`(lower(${permits.title}) like ${like} or lower(coalesce(${permits.referenceNumber}, '')) like ${like})`,
          );
        }
        const rows = await ctx.db
          .select({
            id: permits.id,
            referenceNumber: permits.referenceNumber,
            title: permits.title,
            status: permits.status,
            siteId: permits.siteId,
            locationText: permits.locationText,
            validFrom: permits.validFrom,
            validTo: permits.validTo,
            acceptorUserId: permits.acceptorUserId,
            issuerUserId: permits.issuerUserId,
            extensionCount: permits.extensionCount,
            createdAt: permits.createdAt,
            typeName: permitTypes.name,
            category: permitTypes.category,
          })
          .from(permits)
          .innerJoin(permitTypes, eq(permitTypes.id, permits.permitTypeId))
          .where(and(...conditions))
          .orderBy(desc(permits.createdAt));

        const siteNames = await siteNamesById(
          ctx.db,
          ctx.tenantId,
          rows.map((r) => r.siteId).filter((v): v is string => v !== null),
        );
        const userNames = await userNamesById(
          ctx.db,
          ctx.tenantId,
          rows
            .flatMap((r) => [r.acceptorUserId, r.issuerUserId])
            .filter((v): v is string => v !== null),
        );
        const now = new Date();
        return rows.map((r) => ({
          ...r,
          siteName: r.siteId !== null ? (siteNames.get(r.siteId) ?? null) : null,
          acceptorName:
            r.acceptorUserId !== null ? (userNames.get(r.acceptorUserId) ?? null) : null,
          issuerName: r.issuerUserId !== null ? (userNames.get(r.issuerUserId) ?? null) : null,
          overdue: permitIsOverdue({ status: r.status, validTo: r.validTo }, now),
        }));
      }),

    get: tenantProcedure
      .use(requirePermission('permits.view'))
      .input(z.object({ permitId: z.string().length(26) }))
      .query(async ({ ctx, input }) => {
        assertEnabled();
        const permit = await loadPermit(ctx.db, ctx.tenantId, input.permitId);
        const type = await loadPermitType(ctx.db, ctx.tenantId, permit.permitTypeId);
        const events = await ctx.db
          .select()
          .from(permitEvents)
          .where(and(eq(permitEvents.tenantId, ctx.tenantId), eq(permitEvents.permitId, permit.id)))
          .orderBy(asc(permitEvents.createdAt));

        const userNames = await userNamesById(ctx.db, ctx.tenantId, [
          ...[
            permit.acceptorUserId,
            permit.issuerUserId,
            permit.authoriserUserId,
            permit.createdBy,
            permit.suspendedBy,
            permit.closedBy,
            permit.cancelledBy,
          ].filter((v): v is string => v !== null),
          ...events.map((e) => e.actorUserId),
        ]);
        const siteName =
          permit.siteId !== null
            ? ((await siteNamesById(ctx.db, ctx.tenantId, [permit.siteId])).get(permit.siteId) ??
              null)
            : null;

        const showConflicts = permit.status === 'draft' || isOpenPermitStatus(permit.status);
        const conflicts = showConflicts
          ? await findConflicts(ctx.db, ctx.tenantId, {
              siteId: permit.siteId,
              validFrom: permit.validFrom,
              validTo: permit.validTo,
              locationText: permit.locationText,
              excludePermitId: permit.id,
            })
          : [];

        // Safe-system-of-work links (PW-7), resolved for display.
        const riskAssessment =
          permit.riskAssessmentId !== null
            ? await ctx.db
                .select({
                  id: riskAssessments.id,
                  title: riskAssessments.title,
                  referenceNumber: riskAssessments.referenceNumber,
                  status: riskAssessments.status,
                })
                .from(riskAssessments)
                .where(eq(riskAssessments.id, permit.riskAssessmentId))
                .limit(1)
                .then((rows) => rows[0] ?? null)
            : null;
        const methodStatement =
          permit.methodStatementDocumentId !== null
            ? await ctx.db
                .select({ id: documents.id, name: documents.name })
                .from(documents)
                .where(eq(documents.id, permit.methodStatementDocumentId))
                .limit(1)
                .then((rows) => rows[0] ?? null)
            : null;

        const now = new Date();
        return {
          ...permit,
          type,
          siteName,
          riskAssessment,
          methodStatement,
          insideCount: openEntryCount(permit.entryLog),
          /** The caller's own id — lets the UI show "accept" only to the named acceptor. */
          viewerUserId: ctx.auth.userId,
          overdue: permitIsOverdue({ status: permit.status, validTo: permit.validTo }, now),
          parties: {
            acceptorName:
              permit.acceptorUserId !== null
                ? (userNames.get(permit.acceptorUserId) ?? null)
                : null,
            issuerName:
              permit.issuerUserId !== null ? (userNames.get(permit.issuerUserId) ?? null) : null,
            authoriserName:
              permit.authoriserUserId !== null
                ? (userNames.get(permit.authoriserUserId) ?? null)
                : null,
            createdByName: userNames.get(permit.createdBy) ?? null,
            closedByName:
              permit.closedBy !== null ? (userNames.get(permit.closedBy) ?? null) : null,
            cancelledByName:
              permit.cancelledBy !== null ? (userNames.get(permit.cancelledBy) ?? null) : null,
            suspendedByName:
              permit.suspendedBy !== null ? (userNames.get(permit.suspendedBy) ?? null) : null,
          },
          events: events.map((e) => ({
            id: e.id,
            kind: e.kind,
            detail: e.detail,
            createdAt: e.createdAt,
            actorUserId: e.actorUserId,
            actorName: e.actorUserId === 'system' ? null : (userNames.get(e.actorUserId) ?? null),
          })),
          conflicts,
        };
      }),

    overview: tenantProcedure.use(requirePermission('permits.view')).query(async ({ ctx }) => {
      assertEnabled();
      const rows = await ctx.db
        .select({ status: permits.status, validTo: permits.validTo })
        .from(permits)
        .where(
          and(
            eq(permits.tenantId, ctx.tenantId),
            inArray(permits.status, ['draft', ...OPEN_PERMIT_STATUSES]),
          ),
        );
      const now = new Date();
      const soonCutoff = new Date(now.getTime() + 2 * 3_600_000);
      let draft = 0;
      let awaitingAcceptance = 0;
      let active = 0;
      let suspended = 0;
      let overdue = 0;
      let expiringSoon = 0;
      for (const r of rows) {
        if (r.status === 'draft') {
          draft += 1;
          continue;
        }
        if (r.status === 'issued') awaitingAcceptance += 1;
        if (r.status === 'active') active += 1;
        if (r.status === 'suspended') suspended += 1;
        if (permitIsOverdue({ status: r.status, validTo: r.validTo }, now)) {
          overdue += 1;
        } else if (r.validTo <= soonCutoff) {
          expiringSoon += 1;
        }
      }
      return {
        draft,
        awaitingAcceptance,
        active,
        suspended,
        overdue,
        expiringSoon,
        openTotal: awaitingAcceptance + active + suspended,
      };
    }),

    /**
     * The live board: every open permit across the estate, overdue first,
     * then soonest to expire. The control-room view.
     */
    board: tenantProcedure.use(requirePermission('permits.view')).query(async ({ ctx }) => {
      assertEnabled();
      const rows = await ctx.db
        .select({
          id: permits.id,
          referenceNumber: permits.referenceNumber,
          title: permits.title,
          status: permits.status,
          siteId: permits.siteId,
          locationText: permits.locationText,
          validFrom: permits.validFrom,
          validTo: permits.validTo,
          acceptorUserId: permits.acceptorUserId,
          issuerUserId: permits.issuerUserId,
          entryLog: permits.entryLog,
          typeName: permitTypes.name,
          category: permitTypes.category,
        })
        .from(permits)
        .innerJoin(permitTypes, eq(permitTypes.id, permits.permitTypeId))
        .where(
          and(
            eq(permits.tenantId, ctx.tenantId),
            inArray(permits.status, [...OPEN_PERMIT_STATUSES]),
          ),
        );
      const siteNames = await siteNamesById(
        ctx.db,
        ctx.tenantId,
        rows.map((r) => r.siteId).filter((v): v is string => v !== null),
      );
      const userNames = await userNamesById(
        ctx.db,
        ctx.tenantId,
        rows
          .flatMap((r) => [r.acceptorUserId, r.issuerUserId])
          .filter((v): v is string => v !== null),
      );
      const now = new Date();
      const boardRows = rows
        .map((r) => {
          const overdue = permitIsOverdue({ status: r.status, validTo: r.validTo }, now);
          const { entryLog, ...rest } = r;
          return {
            ...rest,
            siteName: r.siteId !== null ? (siteNames.get(r.siteId) ?? null) : null,
            acceptorName:
              r.acceptorUserId !== null ? (userNames.get(r.acceptorUserId) ?? null) : null,
            issuerName: r.issuerUserId !== null ? (userNames.get(r.issuerUserId) ?? null) : null,
            overdue,
            minutesRemaining: Math.floor((r.validTo.getTime() - now.getTime()) / 60_000),
            /** People currently logged into the space under this permit. */
            insideCount: openEntryCount(entryLog),
          };
        })
        .sort((a, b) => {
          if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
          return a.validTo.getTime() - b.validTo.getTime();
        });
      return { asOf: now, permits: boardRows };
    }),

    /**
     * Render the permit to a PDF in R2 (PW-6) — the copy posted at the
     * point of work and filed in the audit bundle. Returns the storage
     * key; the download route exchanges it for a signed URL.
     */
    renderPdf: tenantProcedure
      .use(requirePermission('permits.view'))
      .input(z.object({ permitId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        if (deps.renderPdf === undefined) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'render-unavailable' });
        }
        const permit = await loadPermit(ctx.db, ctx.tenantId, input.permitId);
        const rendered = await deps.renderPdf({ tenantId: ctx.tenantId, permitId: permit.id });
        const stem = permit.referenceNumber ?? 'permit';
        return {
          storageKey: rendered.key,
          filename: `${stem}.pdf`,
          sizeBytes: rendered.bytes,
          stub: rendered.stub,
        };
      }),

    checkConflicts: tenantProcedure
      .use(requirePermission('permits.view'))
      .input(
        z.object({
          siteId: z.string().length(26).optional(),
          validFrom: z.coerce.date(),
          validTo: z.coerce.date(),
          locationText: z.string().max(500).default(''),
          excludePermitId: z.string().length(26).optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        assertEnabled();
        return findConflicts(ctx.db, ctx.tenantId, {
          siteId: input.siteId ?? null,
          validFrom: input.validFrom,
          validTo: input.validTo,
          locationText: input.locationText,
          excludePermitId: input.excludePermitId,
        });
      }),

    create: tenantProcedure
      .use(requirePermission('permits.create'))
      .input(permitCreateInput)
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const type = await loadPermitType(ctx.db, ctx.tenantId, input.permitTypeId);
        if (type.archivedAt !== null) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'type-archived' });
        }
        const windowError = validityWindowError(
          input.validFrom,
          input.validTo,
          type.maxDurationHours,
        );
        if (windowError !== null) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: windowError });
        }
        if (input.siteId !== undefined) {
          await loadSiteInTenant(ctx.db, ctx.tenantId, input.siteId);
        }
        if (input.acceptorUserId !== undefined) {
          await loadUserInTenant(ctx.db, ctx.tenantId, input.acceptorUserId);
        }
        if (input.riskAssessmentId !== undefined) {
          await loadRiskAssessmentInTenant(ctx.db, ctx.tenantId, input.riskAssessmentId);
        }
        if (input.methodStatementDocumentId !== undefined) {
          await loadDocumentInTenant(ctx.db, ctx.tenantId, input.methodStatementDocumentId);
        }
        const id = newId();
        const n = await nextReferenceValue(ctx.db, ctx.tenantId, 'permit');
        const referenceNumber = `PTW-${String(n).padStart(4, '0')}`;
        await ctx.db.insert(permits).values({
          id,
          tenantId: ctx.tenantId,
          permitTypeId: type.id,
          referenceNumber,
          title: input.title,
          workDescription: input.workDescription,
          siteId: input.siteId ?? null,
          locationText: input.locationText,
          validFrom: input.validFrom,
          validTo: input.validTo,
          acceptorUserId: input.acceptorUserId ?? null,
          isolationCertificateRef: input.isolationCertificateRef,
          rescuePlan: input.rescuePlan,
          riskAssessmentId: input.riskAssessmentId ?? null,
          ramsPackVersionId: input.ramsPackVersionId ?? null,
          ramsReviewId: input.ramsReviewId ?? null,
          methodStatementDocumentId: input.methodStatementDocumentId ?? null,
          preconditions: snapshotPreconditions(type.preconditions),
          createdBy: ctx.auth.userId,
        });
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          permitId: id,
          actorUserId: ctx.auth.userId,
          kind: 'created',
          detail: type.name,
        });
        return { permitId: id, referenceNumber };
      }),

    update: tenantProcedure
      .use(requirePermission('permits.create'))
      .input(permitUpdateInput)
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const permit = await loadPermit(ctx.db, ctx.tenantId, input.permitId);
        if (permit.status !== 'draft') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'not-draft' });
        }
        const type = await loadPermitType(ctx.db, ctx.tenantId, permit.permitTypeId);
        const validFrom = input.validFrom ?? permit.validFrom;
        const validTo = input.validTo ?? permit.validTo;
        const windowError = validityWindowError(validFrom, validTo, type.maxDurationHours);
        if (windowError !== null) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: windowError });
        }
        if (input.siteId !== undefined && input.siteId !== null) {
          await loadSiteInTenant(ctx.db, ctx.tenantId, input.siteId);
        }
        if (input.acceptorUserId !== undefined && input.acceptorUserId !== null) {
          await loadUserInTenant(ctx.db, ctx.tenantId, input.acceptorUserId);
        }
        if (input.riskAssessmentId !== undefined && input.riskAssessmentId !== null) {
          await loadRiskAssessmentInTenant(ctx.db, ctx.tenantId, input.riskAssessmentId);
        }
        if (
          input.methodStatementDocumentId !== undefined &&
          input.methodStatementDocumentId !== null
        ) {
          await loadDocumentInTenant(ctx.db, ctx.tenantId, input.methodStatementDocumentId);
        }
        await ctx.db
          .update(permits)
          .set({
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.workDescription !== undefined
              ? { workDescription: input.workDescription }
              : {}),
            ...(input.siteId !== undefined ? { siteId: input.siteId } : {}),
            ...(input.locationText !== undefined ? { locationText: input.locationText } : {}),
            ...(input.validFrom !== undefined ? { validFrom: input.validFrom } : {}),
            ...(input.validTo !== undefined ? { validTo: input.validTo } : {}),
            ...(input.acceptorUserId !== undefined ? { acceptorUserId: input.acceptorUserId } : {}),
            ...(input.isolationCertificateRef !== undefined
              ? { isolationCertificateRef: input.isolationCertificateRef }
              : {}),
            ...(input.rescuePlan !== undefined ? { rescuePlan: input.rescuePlan } : {}),
            ...(input.ramsPackVersionId !== undefined
              ? { ramsPackVersionId: input.ramsPackVersionId }
              : {}),
            ...(input.ramsReviewId !== undefined ? { ramsReviewId: input.ramsReviewId } : {}),
            ...(input.riskAssessmentId !== undefined
              ? { riskAssessmentId: input.riskAssessmentId }
              : {}),
            ...(input.methodStatementDocumentId !== undefined
              ? { methodStatementDocumentId: input.methodStatementDocumentId }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(permits.id, permit.id));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          permitId: permit.id,
          actorUserId: ctx.auth.userId,
          kind: 'updated',
        });
        return { permitId: permit.id };
      }),

    checkPrecondition: tenantProcedure
      .use(requirePermission('permits.view'))
      .input(
        z.object({
          permitId: z.string().length(26),
          preconditionId: z.string().min(1).max(60),
          checked: z.boolean(),
          note: z.string().max(500).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const permit = await loadPermit(ctx.db, ctx.tenantId, input.permitId);
        assertCanRecord(ctx, permit);
        if (permit.status !== 'draft') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'not-draft' });
        }
        const target = permit.preconditions.find((p) => p.id === input.preconditionId);
        if (target === undefined) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'unknown-precondition' });
        }
        const actor = await loadUserInTenant(ctx.db, ctx.tenantId, ctx.auth.userId);
        const next: PermitPreconditionState[] = permit.preconditions.map((p) =>
          p.id === input.preconditionId
            ? {
                ...p,
                checked: input.checked,
                checkedBy: input.checked ? ctx.auth.userId : null,
                checkedByName: input.checked ? actor.name : null,
                checkedAt: input.checked ? new Date().toISOString() : null,
                note: input.note ?? p.note,
              }
            : p,
        );
        await ctx.db
          .update(permits)
          .set({ preconditions: next, updatedAt: new Date() })
          .where(eq(permits.id, permit.id));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          permitId: permit.id,
          actorUserId: ctx.auth.userId,
          kind: input.checked ? 'precondition_checked' : 'precondition_unchecked',
          detail: target.label,
        });
        return { permitId: permit.id };
      }),

    recordGasReading: tenantProcedure
      .use(requirePermission('permits.view'))
      .input(
        z.object({
          permitId: z.string().length(26),
          substance: z.string().trim().min(1).max(120),
          reading: z.number().finite(),
          unit: z.enum(GAS_READING_UNITS),
          note: z.string().max(500).default(''),
          /** The type gas-limit this reading evidences (PW-1). */
          limitId: z.string().min(1).max(40).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const permit = await loadPermit(ctx.db, ctx.tenantId, input.permitId);
        assertCanRecord(ctx, permit);
        if (permit.status !== 'draft' && !isOpenPermitStatus(permit.status)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'invalid-transition' });
        }
        // Evaluate against the type's limit at record time — the verdict
        // is snapshotted onto the reading (PW-1). A dangerous reading is
        // still RECORDED (it is evidence); it just blocks the gate.
        let limitId: string | null = null;
        let withinLimits: boolean | null = null;
        if (input.limitId !== undefined) {
          const type = await loadPermitType(ctx.db, ctx.tenantId, permit.permitTypeId);
          const limit = type.gasLimits.find((l) => l.id === input.limitId);
          if (limit === undefined) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'unknown-gas-limit' });
          }
          if (limit.unit !== input.unit) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'gas-unit-mismatch' });
          }
          limitId = limit.id;
          withinLimits = readingWithinLimit({ reading: input.reading, unit: input.unit }, limit);
        }
        const actor = await loadUserInTenant(ctx.db, ctx.tenantId, ctx.auth.userId);
        const reading = {
          id: newId(),
          substance: input.substance,
          reading: input.reading,
          unit: input.unit,
          takenAt: new Date().toISOString(),
          takenBy: ctx.auth.userId,
          takenByName: actor.name,
          note: input.note,
          limitId,
          withinLimits,
        };
        await ctx.db
          .update(permits)
          .set({ gasReadings: [...permit.gasReadings, reading], updatedAt: new Date() })
          .where(eq(permits.id, permit.id));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          permitId: permit.id,
          actorUserId: ctx.auth.userId,
          kind: 'gas_reading_recorded',
          detail:
            withinLimits === null
              ? `${input.substance}: ${String(input.reading)}`
              : `${input.substance}: ${String(input.reading)} (${withinLimits ? 'within limits' : 'OUT OF LIMITS'})`,
        });
        return { permitId: permit.id, withinLimits };
      }),

    addAttachment: tenantProcedure
      .use(requirePermission('permits.view'))
      .input(
        z.object({
          permitId: z.string().length(26),
          kind: z.enum(PERMIT_ATTACHMENT_KINDS),
          storageKey: z.string().min(1).max(500),
          filename: z.string().min(1).max(300),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const permit = await loadPermit(ctx.db, ctx.tenantId, input.permitId);
        assertCanRecord(ctx, permit);
        if (permit.status !== 'draft' && !isOpenPermitStatus(permit.status)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'invalid-transition' });
        }
        const attachment = {
          id: newId(),
          kind: input.kind,
          storageKey: input.storageKey,
          filename: input.filename,
          uploadedBy: ctx.auth.userId,
          uploadedAt: new Date().toISOString(),
        };
        await ctx.db
          .update(permits)
          .set({ attachments: [...permit.attachments, attachment], updatedAt: new Date() })
          .where(eq(permits.id, permit.id));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          permitId: permit.id,
          actorUserId: ctx.auth.userId,
          kind: 'attachment_added',
          detail: `${input.kind}: ${input.filename}`,
        });
        return { permitId: permit.id };
      }),

    /**
     * Replace the list of people covered by the permit — the gang, not
     * just the acceptor (PW-8). Names may be contractors without
     * accounts; linked userIds are validated in-tenant.
     */
    setWorkers: tenantProcedure
      .use(requirePermission('permits.view'))
      .input(
        z.object({
          permitId: z.string().length(26),
          workers: z
            .array(
              z.object({
                id: z.string().min(1).max(40).optional(),
                name: z.string().trim().min(1).max(200),
                userId: z.string().max(64).nullable().optional(),
                role: z.enum(PERMIT_WORKER_ROLES).default('worker'),
              }),
            )
            .max(MAX_WORKERS_PER_PERMIT),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const permit = await loadPermit(ctx.db, ctx.tenantId, input.permitId);
        assertCanRecord(ctx, permit);
        if (permit.status !== 'draft' && !isOpenPermitStatus(permit.status)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'invalid-transition' });
        }
        for (const w of input.workers) {
          if (w.userId !== undefined && w.userId !== null) {
            await loadUserInTenant(ctx.db, ctx.tenantId, w.userId);
          }
        }
        const next: PermitWorker[] = input.workers.map((w) => ({
          id: w.id ?? newId(),
          name: w.name,
          userId: w.userId ?? null,
          role: w.role,
        }));
        const oldIds = new Set(permit.workers.map((w) => w.id));
        const newIds = new Set(next.map((w) => w.id));
        const added = next.filter((w) => !oldIds.has(w.id));
        const removed = permit.workers.filter((w) => !newIds.has(w.id));
        await ctx.db
          .update(permits)
          .set({ workers: next, updatedAt: new Date() })
          .where(eq(permits.id, permit.id));
        for (const w of added) {
          await logEvent(ctx.db, {
            tenantId: ctx.tenantId,
            permitId: permit.id,
            actorUserId: ctx.auth.userId,
            kind: 'worker_added',
            detail: `${w.name} (${w.role})`,
          });
        }
        for (const w of removed) {
          await logEvent(ctx.db, {
            tenantId: ctx.tenantId,
            permitId: permit.id,
            actorUserId: ctx.auth.userId,
            kind: 'worker_removed',
            detail: w.name,
          });
        }
        return { permitId: permit.id, workers: next };
      }),

    /**
     * Log a person INTO the space/work area (PW-8). Only on an ACTIVE
     * permit — nobody enters under a permit the acceptor hasn't signed
     * onto or that is suspended. "Who is in there right now" is the set
     * of rows without an exit.
     */
    logEntry: tenantProcedure
      .use(requirePermission('permits.view'))
      .input(
        z.object({
          permitId: z.string().length(26),
          /** A listed worker (preferred) … */
          workerId: z.string().min(1).max(40).optional(),
          /** … or an ad-hoc name. */
          name: z.string().trim().max(200).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const permit = await loadPermit(ctx.db, ctx.tenantId, input.permitId);
        assertCanRecord(ctx, permit);
        if (permit.status !== 'active') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'invalid-transition' });
        }
        if (permit.entryLog.length >= MAX_ENTRY_LOG_ROWS) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'entry-log-full' });
        }
        let name: string;
        let userId: string | null = null;
        if (input.workerId !== undefined) {
          const worker = permit.workers.find((w) => w.id === input.workerId);
          if (worker === undefined) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'unknown-worker' });
          }
          name = worker.name;
          userId = worker.userId;
        } else if (input.name !== undefined && input.name.length > 0) {
          name = input.name;
        } else {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'name-required' });
        }
        const row: PermitEntryLogRow = {
          id: newId(),
          name,
          userId,
          enteredAt: new Date().toISOString(),
          exitedAt: null,
          loggedBy: ctx.auth.userId,
        };
        await ctx.db
          .update(permits)
          .set({ entryLog: [...permit.entryLog, row], updatedAt: new Date() })
          .where(eq(permits.id, permit.id));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          permitId: permit.id,
          actorUserId: ctx.auth.userId,
          kind: 'entry_logged',
          detail: name,
        });
        return { permitId: permit.id, entryId: row.id };
      }),

    /** Log a person OUT. Allowed while the permit is open — people leave
     * during suspensions too; closure requires everyone out. */
    logExit: tenantProcedure
      .use(requirePermission('permits.view'))
      .input(z.object({ permitId: z.string().length(26), entryId: z.string().min(1).max(40) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const permit = await loadPermit(ctx.db, ctx.tenantId, input.permitId);
        assertCanRecord(ctx, permit);
        if (!isOpenPermitStatus(permit.status)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'invalid-transition' });
        }
        const row = permit.entryLog.find((r) => r.id === input.entryId);
        if (row === undefined) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'unknown-entry' });
        }
        if (row.exitedAt !== null) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'already-exited' });
        }
        const next = permit.entryLog.map((r) =>
          r.id === input.entryId ? { ...r, exitedAt: new Date().toISOString() } : r,
        );
        await ctx.db
          .update(permits)
          .set({ entryLog: next, updatedAt: new Date() })
          .where(eq(permits.id, permit.id));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          permitId: permit.id,
          actorUserId: ctx.auth.userId,
          kind: 'exit_logged',
          detail: row.name,
        });
        return { permitId: permit.id };
      }),

    /**
     * Authorising engineer / site controller counter-signature. Draft
     * only — issue checks it where the type requires it. Never the
     * acceptor: the person doing the work cannot authorise it.
     */
    authorise: tenantProcedure
      .use(requirePermission('permits.issue'))
      .input(z.object({ permitId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const permit = await loadPermit(ctx.db, ctx.tenantId, input.permitId);
        await assertSiteAuthority(ctx.db, ctx.tenantId, permit, ctx.auth.userId, ctx.permissions);
        if (permit.status !== 'draft') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'invalid-transition' });
        }
        if (permit.authorisedAt !== null) {
          throw new TRPCError({ code: 'CONFLICT', message: 'already-authorised' });
        }
        if (permit.acceptorUserId === ctx.auth.userId) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'authoriser-is-acceptor' });
        }
        await ctx.db
          .update(permits)
          .set({
            authoriserUserId: ctx.auth.userId,
            authorisedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(permits.id, permit.id));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          permitId: permit.id,
          actorUserId: ctx.auth.userId,
          kind: 'authorised',
        });
        return { permitId: permit.id };
      }),

    /**
     * The issue gate. Every control the type demands must be in place;
     * SIMOPs conflicts must be explicitly acknowledged. The caller signs
     * as issuer and can never be the acceptor.
     */
    issue: tenantProcedure
      .use(requirePermission('permits.issue'))
      .input(
        z.object({
          permitId: z.string().length(26),
          acknowledgeConflicts: z.boolean().default(false),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const permit = await loadPermit(ctx.db, ctx.tenantId, input.permitId);
        await assertSiteAuthority(ctx.db, ctx.tenantId, permit, ctx.auth.userId, ctx.permissions);
        assertTransition(permit.status, 'issued');
        const type = await loadPermitType(ctx.db, ctx.tenantId, permit.permitTypeId);

        const now = new Date();
        const windowError = validityWindowError(
          permit.validFrom,
          permit.validTo,
          type.maxDurationHours,
        );
        if (windowError !== null) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: windowError });
        }
        if (permit.validTo.getTime() <= now.getTime()) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'window-past' });
        }
        if (permit.acceptorUserId === null) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'acceptor-required' });
        }
        if (permit.acceptorUserId === ctx.auth.userId) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'issuer-is-acceptor' });
        }
        if (!allPreconditionsChecked(permit.preconditions)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'preconditions-incomplete' });
        }
        // The gas gate EVALUATES (PW-1): every configured limit needs a
        // fresh, in-range latest reading — not just "a number was typed".
        const gasError = gasGateError({
          requiresGasTesting: type.requiresGasTesting,
          limits: type.gasLimits,
          maxAgeMinutes: type.gasTestMaxAgeMinutes,
          readings: permit.gasReadings,
          now,
        });
        if (gasError !== null) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: gasError });
        }
        if (
          type.requiresIsolationCertificate &&
          permit.isolationCertificateRef.trim().length === 0 &&
          !hasAttachmentOfKind(permit, 'isolation_certificate')
        ) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'isolation-certificate-required' });
        }
        if (
          type.requiresRescuePlan &&
          permit.rescuePlan.trim().length === 0 &&
          !hasAttachmentOfKind(permit, 'rescue_plan')
        ) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'rescue-plan-required' });
        }
        if (type.requiresAuthoriser && permit.authorisedAt === null) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'authorisation-required' });
        }
        // The safe system of work must be on the permit where the type
        // demands it (PW-7).
        if (type.requiresRiskAssessment && permit.riskAssessmentId === null) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'risk-assessment-required' });
        }
        // RAMS spec §10.2 / RS-E14: where the type demands an accepted
        // safe system of work, the permit must carry EITHER an issued
        // own RAMS pack version OR an in-date accepted third-party
        // review. Both are accepted; neither is, and an expired
        // acceptance is not.
        if (type.requiresRamsPack) {
          const ramsError = await ramsPackGateError(ctx.db, ctx.tenantId, permit, now);
          if (ramsError !== null) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: ramsError });
          }
        }

        const conflicts = await findConflicts(ctx.db, ctx.tenantId, {
          siteId: permit.siteId,
          validFrom: permit.validFrom,
          validTo: permit.validTo,
          locationText: permit.locationText,
          excludePermitId: permit.id,
        });
        if (conflicts.length > 0 && !input.acknowledgeConflicts) {
          throw new TRPCError({ code: 'CONFLICT', message: 'simops-conflict' });
        }

        await ctx.db
          .update(permits)
          .set({
            status: 'issued',
            issuerUserId: ctx.auth.userId,
            issuedAt: now,
            updatedAt: now,
          })
          .where(eq(permits.id, permit.id));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          permitId: permit.id,
          actorUserId: ctx.auth.userId,
          kind: 'issued',
          detail:
            conflicts.length > 0
              ? `acknowledged ${String(conflicts.length)} simultaneous-operation conflict(s)`
              : '',
        });
        return { permitId: permit.id, status: 'issued' as const };
      }),

    /** The named acceptor's signature — nobody else's. */
    accept: tenantProcedure
      .use(requirePermission('permits.view'))
      .input(z.object({ permitId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const permit = await loadPermit(ctx.db, ctx.tenantId, input.permitId);
        assertTransition(permit.status, 'active');
        if (permit.acceptorUserId !== ctx.auth.userId) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'not-the-acceptor' });
        }
        const now = new Date();
        // Signing on to a lapsed permit authorises work that has no valid
        // window (PW-2). Extend (re-authorise) first, then accept.
        if (permit.validTo.getTime() <= now.getTime()) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'window-past' });
        }
        await ctx.db
          .update(permits)
          .set({ status: 'active', acceptedAt: now, updatedAt: now })
          .where(eq(permits.id, permit.id));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          permitId: permit.id,
          actorUserId: ctx.auth.userId,
          kind: 'accepted',
        });
        return { permitId: permit.id, status: 'active' as const };
      }),

    suspend: tenantProcedure
      .use(requirePermission('permits.issue'))
      .input(
        z.object({ permitId: z.string().length(26), reason: z.string().trim().min(3).max(1000) }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const permit = await loadPermit(ctx.db, ctx.tenantId, input.permitId);
        await assertSiteAuthority(ctx.db, ctx.tenantId, permit, ctx.auth.userId, ctx.permissions);
        assertTransition(permit.status, 'suspended');
        const now = new Date();
        await ctx.db
          .update(permits)
          .set({
            status: 'suspended',
            suspendedAt: now,
            suspendedBy: ctx.auth.userId,
            suspensionReason: input.reason,
            updatedAt: now,
          })
          .where(eq(permits.id, permit.id));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          permitId: permit.id,
          actorUserId: ctx.auth.userId,
          kind: 'suspended',
          detail: input.reason,
        });
        return { permitId: permit.id, status: 'suspended' as const };
      }),

    resume: tenantProcedure
      .use(requirePermission('permits.issue'))
      .input(z.object({ permitId: z.string().length(26), confirmSafeToResume: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const permit = await loadPermit(ctx.db, ctx.tenantId, input.permitId);
        await assertSiteAuthority(ctx.db, ctx.tenantId, permit, ctx.auth.userId, ctx.permissions);
        if (permit.status !== 'suspended') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'invalid-transition' });
        }
        if (!input.confirmSafeToResume) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'resume-confirmation-required' });
        }
        const now = new Date();
        // Resuming gas-tested work needs a FRESH in-range test taken after
        // the suspension — the pre-alarm atmosphere is not evidence that
        // the alarm's cause is gone (PW-3).
        const type = await loadPermitType(ctx.db, ctx.tenantId, permit.permitTypeId);
        const gasError = gasGateError({
          requiresGasTesting: type.requiresGasTesting,
          limits: type.gasLimits,
          maxAgeMinutes: type.gasTestMaxAgeMinutes,
          readings: permit.gasReadings,
          now,
          takenAfter: permit.suspendedAt ?? undefined,
        });
        if (gasError !== null) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: gasError });
        }
        await ctx.db
          .update(permits)
          .set({
            status: 'active',
            suspendedAt: null,
            suspendedBy: null,
            suspensionReason: '',
            updatedAt: now,
          })
          .where(eq(permits.id, permit.id));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          permitId: permit.id,
          actorUserId: ctx.auth.userId,
          kind: 'resumed',
        });
        return { permitId: permit.id, status: 'active' as const };
      }),

    /**
     * Extension with re-authorisation. Where the type demands an
     * authorising engineer, only the permit's authoriser can extend — the
     * extension IS the re-authorisation. Each extension may add at most
     * one further `maxDurationHours` window.
     */
    extend: tenantProcedure
      .use(requirePermission('permits.issue'))
      .input(
        z.object({
          permitId: z.string().length(26),
          newValidTo: z.coerce.date(),
          /** SIMOPs over the added window must be acknowledged (PW-4). */
          acknowledgeConflicts: z.boolean().default(false),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const permit = await loadPermit(ctx.db, ctx.tenantId, input.permitId);
        await assertSiteAuthority(ctx.db, ctx.tenantId, permit, ctx.auth.userId, ctx.permissions);
        if (permit.status !== 'active' && permit.status !== 'issued') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'invalid-transition' });
        }
        const type = await loadPermitType(ctx.db, ctx.tenantId, permit.permitTypeId);
        const now = new Date();
        if (input.newValidTo.getTime() <= permit.validTo.getTime()) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'extension-not-later' });
        }
        // An "extension" that still ends in the past extends nothing —
        // the permit would remain lapsed (PW-4).
        if (input.newValidTo.getTime() <= now.getTime()) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'extension-in-past' });
        }
        const addedHours = (input.newValidTo.getTime() - permit.validTo.getTime()) / 3_600_000;
        if (addedHours > type.maxDurationHours) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'extension-too-long' });
        }
        if (type.requiresAuthoriser && permit.authoriserUserId !== ctx.auth.userId) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'reauthorisation-required' });
        }
        // Re-run SIMOPs over the span the extension adds — a clashing
        // permit issued since the original acknowledgement must be seen
        // and acknowledged again (PW-4).
        const conflicts = await findConflicts(ctx.db, ctx.tenantId, {
          siteId: permit.siteId,
          validFrom: permit.validTo,
          validTo: input.newValidTo,
          locationText: permit.locationText,
          excludePermitId: permit.id,
        });
        if (conflicts.length > 0 && !input.acknowledgeConflicts) {
          throw new TRPCError({ code: 'CONFLICT', message: 'simops-conflict' });
        }
        await ctx.db
          .update(permits)
          .set({
            validTo: input.newValidTo,
            extensionCount: permit.extensionCount + 1,
            // A fresh window gets a fresh expiry watch — warning included.
            expiryEscalatedAt: null,
            expiryWarningSentAt: null,
            updatedAt: now,
          })
          .where(eq(permits.id, permit.id));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          permitId: permit.id,
          actorUserId: ctx.auth.userId,
          kind: 'extended',
          detail:
            `${permit.validTo.toISOString()} -> ${input.newValidTo.toISOString()}` +
            (conflicts.length > 0
              ? ` (acknowledged ${String(conflicts.length)} simultaneous-operation conflict(s))`
              : ''),
        });
        return {
          permitId: permit.id,
          validTo: input.newValidTo,
          extensionCount: permit.extensionCount + 1,
        };
      }),

    /**
     * Shift handover. The outgoing acceptor (or a permit-issuer) re-points
     * the permit at the incoming acceptor; it drops back to `issued` until
     * the incoming acceptor signs on — work does not continue on an
     * unaccepted permit.
     */
    handover: tenantProcedure
      .use(requirePermission('permits.view'))
      .input(z.object({ permitId: z.string().length(26), toUserId: z.string().max(64) }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const permit = await loadPermit(ctx.db, ctx.tenantId, input.permitId);
        if (permit.status !== 'active' && permit.status !== 'issued') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'invalid-transition' });
        }
        const now = new Date();
        // An overdue permit has no valid window to hand anyone onto —
        // extend (re-authorise) first (PW-11).
        if (permit.validTo.getTime() <= now.getTime()) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'window-past' });
        }
        const isIssuerAuthority =
          ctx.permissions.includes('permits.issue') || grantsAdminAccess(ctx.permissions);
        if (permit.acceptorUserId !== ctx.auth.userId && !isIssuerAuthority) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'not-allowed' });
        }
        if (permit.acceptorUserId !== ctx.auth.userId) {
          // Issuer-authority handovers respect site scoping; the outgoing
          // acceptor is already a party to this specific permit.
          await assertSiteAuthority(ctx.db, ctx.tenantId, permit, ctx.auth.userId, ctx.permissions);
        }
        if (input.toUserId === permit.issuerUserId) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'acceptor-is-issuer' });
        }
        // Separation of duties holds through handover: the authorising
        // engineer cannot end up doing the work they authorised (PW-5).
        if (input.toUserId === permit.authoriserUserId) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'acceptor-is-authoriser' });
        }
        if (input.toUserId === permit.acceptorUserId) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'same-acceptor' });
        }
        const incoming = await loadUserInTenant(ctx.db, ctx.tenantId, input.toUserId);
        const outgoingName =
          permit.acceptorUserId !== null
            ? ((await userNamesById(ctx.db, ctx.tenantId, [permit.acceptorUserId])).get(
                permit.acceptorUserId,
              ) ?? permit.acceptorUserId)
            : '—';
        await ctx.db
          .update(permits)
          .set({
            status: 'issued',
            acceptorUserId: input.toUserId,
            acceptedAt: null,
            updatedAt: now,
          })
          .where(eq(permits.id, permit.id));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          permitId: permit.id,
          actorUserId: ctx.auth.userId,
          kind: 'handed_over',
          detail: `${outgoingName} -> ${incoming.name}`,
        });
        return { permitId: permit.id, status: 'issued' as const };
      }),

    close: tenantProcedure
      .use(requirePermission('permits.issue'))
      .input(
        z.object({
          permitId: z.string().length(26),
          checks: closureChecksSchema,
          notes: z.string().max(2000).default(''),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const permit = await loadPermit(ctx.db, ctx.tenantId, input.permitId);
        await assertSiteAuthority(ctx.db, ctx.tenantId, permit, ctx.auth.userId, ctx.permissions);
        assertTransition(permit.status, 'closed');
        if (!closureComplete(input.checks)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'closure-checks-incomplete' });
        }
        // "Personnel clear" cannot be true while the entry log still has
        // someone inside (PW-8) — log their exits first.
        if (openEntryCount(permit.entryLog) > 0) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'entrants-still-inside' });
        }
        const now = new Date();
        await ctx.db
          .update(permits)
          .set({
            status: 'closed',
            closedAt: now,
            closedBy: ctx.auth.userId,
            closureChecks: input.checks,
            closureNotes: input.notes,
            updatedAt: now,
          })
          .where(eq(permits.id, permit.id));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          permitId: permit.id,
          actorUserId: ctx.auth.userId,
          kind: 'closed',
          detail: input.notes,
        });
        return { permitId: permit.id, status: 'closed' as const };
      }),

    cancel: tenantProcedure
      .use(requirePermission('permits.view'))
      .input(
        z.object({ permitId: z.string().length(26), reason: z.string().trim().min(3).max(1000) }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const permit = await loadPermit(ctx.db, ctx.tenantId, input.permitId);
        assertTransition(permit.status, 'cancelled');
        const isIssuerAuthority =
          ctx.permissions.includes('permits.issue') || grantsAdminAccess(ctx.permissions);
        const isOwnDraft = permit.status === 'draft' && permit.createdBy === ctx.auth.userId;
        if (!isIssuerAuthority && !isOwnDraft) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'not-allowed' });
        }
        if (!isOwnDraft) {
          await assertSiteAuthority(ctx.db, ctx.tenantId, permit, ctx.auth.userId, ctx.permissions);
        }
        const now = new Date();
        await ctx.db
          .update(permits)
          .set({
            status: 'cancelled',
            cancelledAt: now,
            cancelledBy: ctx.auth.userId,
            cancellationReason: input.reason,
            updatedAt: now,
          })
          .where(eq(permits.id, permit.id));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          permitId: permit.id,
          actorUserId: ctx.auth.userId,
          kind: 'cancelled',
          detail: input.reason,
        });
        return { permitId: permit.id, status: 'cancelled' as const };
      }),
  });
}
