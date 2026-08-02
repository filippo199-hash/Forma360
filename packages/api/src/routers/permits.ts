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
  permitEvents,
  permits,
  permitTypes,
  sites,
  user,
  type Permit,
  type PermitEventKind,
  type PermitType,
} from '@forma360/db/schema';
import type { Database } from '@forma360/db/client';
import {
  allPreconditionsChecked,
  canTransition,
  closureChecksSchema,
  closureComplete,
  DEFAULT_PERMIT_TYPES,
  GAS_READING_UNITS,
  isOpenPermitStatus,
  OPEN_PERMIT_STATUSES,
  overlaps,
  PERMIT_ATTACHMENT_KINDS,
  PERMIT_CATEGORIES,
  permitIsOverdue,
  permitTypePreconditionSchema,
  snapshotPreconditions,
  validityWindowError,
  type PermitPreconditionState,
  type PermitStatus,
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

function normaliseArea(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
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
  const area = normaliseArea(args.locationText);
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
      sameArea: area.length > 0 && normaliseArea(r.locationText) === area,
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
        maxDurationHours: t.maxDurationHours,
        preconditions: t.preconditions,
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
  maxDurationHours: z.number().int().min(1).max(72).default(12),
  preconditions: z.array(permitTypePreconditionSchema).max(40).default([]),
});

const typeUpdateInput = z.object({
  typeId: z.string().length(26),
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  requiresAuthoriser: z.boolean().optional(),
  requiresGasTesting: z.boolean().optional(),
  requiresIsolationCertificate: z.boolean().optional(),
  requiresRescuePlan: z.boolean().optional(),
  maxDurationHours: z.number().int().min(1).max(72).optional(),
  preconditions: z.array(permitTypePreconditionSchema).max(40).optional(),
});

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
          maxDurationHours: input.maxDurationHours,
          preconditions: input.preconditions,
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
            ...(input.requiresRescuePlan !== undefined
              ? { requiresRescuePlan: input.requiresRescuePlan }
              : {}),
            ...(input.maxDurationHours !== undefined
              ? { maxDurationHours: input.maxDurationHours }
              : {}),
            ...(input.preconditions !== undefined ? { preconditions: input.preconditions } : {}),
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

        const now = new Date();
        return {
          ...permit,
          type,
          siteName,
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
          return {
            ...r,
            siteName: r.siteId !== null ? (siteNames.get(r.siteId) ?? null) : null,
            acceptorName:
              r.acceptorUserId !== null ? (userNames.get(r.acceptorUserId) ?? null) : null,
            issuerName: r.issuerUserId !== null ? (userNames.get(r.issuerUserId) ?? null) : null,
            overdue,
            minutesRemaining: Math.floor((r.validTo.getTime() - now.getTime()) / 60_000),
          };
        })
        .sort((a, b) => {
          if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
          return a.validTo.getTime() - b.validTo.getTime();
        });
      return { asOf: now, permits: boardRows };
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
      .use(requirePermission('permits.issue'))
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
      .use(requirePermission('permits.issue'))
      .input(
        z.object({
          permitId: z.string().length(26),
          substance: z.string().trim().min(1).max(120),
          reading: z.number().finite(),
          unit: z.enum(GAS_READING_UNITS),
          note: z.string().max(500).default(''),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const permit = await loadPermit(ctx.db, ctx.tenantId, input.permitId);
        if (permit.status !== 'draft' && !isOpenPermitStatus(permit.status)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'invalid-transition' });
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
          detail: `${input.substance}: ${input.reading}`,
        });
        return { permitId: permit.id };
      }),

    addAttachment: tenantProcedure
      .use(requirePermission('permits.issue'))
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
        if (type.requiresGasTesting && permit.gasReadings.length === 0) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'gas-test-required' });
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
        if (permit.status !== 'suspended') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'invalid-transition' });
        }
        if (!input.confirmSafeToResume) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'resume-confirmation-required' });
        }
        const now = new Date();
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
      .input(z.object({ permitId: z.string().length(26), newValidTo: z.coerce.date() }))
      .mutation(async ({ ctx, input }) => {
        assertEnabled();
        const permit = await loadPermit(ctx.db, ctx.tenantId, input.permitId);
        if (permit.status !== 'active' && permit.status !== 'issued') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'invalid-transition' });
        }
        const type = await loadPermitType(ctx.db, ctx.tenantId, permit.permitTypeId);
        if (input.newValidTo.getTime() <= permit.validTo.getTime()) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'extension-not-later' });
        }
        const addedHours = (input.newValidTo.getTime() - permit.validTo.getTime()) / 3_600_000;
        if (addedHours > type.maxDurationHours) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'extension-too-long' });
        }
        if (type.requiresAuthoriser && permit.authoriserUserId !== ctx.auth.userId) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'reauthorisation-required' });
        }
        const now = new Date();
        await ctx.db
          .update(permits)
          .set({
            validTo: input.newValidTo,
            extensionCount: permit.extensionCount + 1,
            // A fresh window gets a fresh expiry watch.
            expiryEscalatedAt: null,
            updatedAt: now,
          })
          .where(eq(permits.id, permit.id));
        await logEvent(ctx.db, {
          tenantId: ctx.tenantId,
          permitId: permit.id,
          actorUserId: ctx.auth.userId,
          kind: 'extended',
          detail: `${permit.validTo.toISOString()} -> ${input.newValidTo.toISOString()}`,
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
        const isIssuerAuthority =
          ctx.permissions.includes('permits.issue') || grantsAdminAccess(ctx.permissions);
        if (permit.acceptorUserId !== ctx.auth.userId && !isIssuerAuthority) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'not-allowed' });
        }
        if (input.toUserId === permit.issuerUserId) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'acceptor-is-issuer' });
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
        const now = new Date();
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
        assertTransition(permit.status, 'closed');
        if (!closureComplete(input.checks)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'closure-checks-incomplete' });
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
