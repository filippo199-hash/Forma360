/**
 * Contractors router (Phase 1: directory + compliance documents).
 *
 * Compliance is **derived**, never stored: a contractor is compliant when
 * every *blocking* requirement has a `verified` document whose end date has
 * not passed. Advisory requirements don't affect the status.
 */
import { randomBytes } from 'node:crypto';
import type { Database } from '@forma360/db/client';
import {
  assetTypes,
  assets,
  contractorAssets,
  contractorDocuments,
  contractorGateConfig,
  contractorGateFields,
  contractorRequirementTemplates,
  contractorRequirements,
  contractorUsers,
  contractorVisitEvents,
  contractorVisits,
  contractors,
  invitations,
  permissionSets,
  sites,
  tenants,
  user,
} from '@forma360/db/schema';
import {
  CONTRACTOR_ACTIVITIES,
  activitiesToPermissionKeys,
} from '@forma360/permissions/contractor-activities';
import { newId } from '@forma360/shared/id';
import { TRPCError } from '@trpc/server';
import { aliasedTable, and, asc, between, desc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { publicProcedure, requirePermission, tenantProcedure } from '../procedures';
import { assertStorageKeyInTenant } from '../tenant-guards';
import { router } from '../trpc';

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()
  .optional();

type ComplianceStatus = 'compliant' | 'non_compliant' | 'no_requirements';

interface ReqRow {
  id: string;
  blocking: boolean;
}
interface DocRow {
  requirementId: string;
  status: string;
  endDate: string | null;
}

/** Today as YYYY-MM-DD (lexicographic compare works for ISO dates). */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** A requirement is satisfied by a verified, unexpired document. */
function requirementSatisfied(docs: DocRow[], t: string): boolean {
  return docs.some(
    (d) => d.status === 'verified' && (d.endDate === null || d.endDate >= t),
  );
}

/** Company-wide compliance from a contractor's requirements + documents. */
function computeStatus(reqs: ReqRow[], docsByReq: Map<string, DocRow[]>, t: string): ComplianceStatus {
  const blocking = reqs.filter((r) => r.blocking);
  if (blocking.length === 0) return 'no_requirements';
  const allMet = blocking.every((r) => requirementSatisfied(docsByReq.get(r.id) ?? [], t));
  return allMet ? 'compliant' : 'non_compliant';
}

/**
 * Copy the trade templates for a category into a contractor's requirements,
 * skipping any whose name already exists on the contractor. Returns the count
 * applied.
 */
async function applyTemplatesForCategory(
  db: Database,
  tenantId: string,
  contractorId: string,
  category: string,
): Promise<number> {
  const templates = await db
    .select()
    .from(contractorRequirementTemplates)
    .where(
      and(
        eq(contractorRequirementTemplates.tenantId, tenantId),
        eq(contractorRequirementTemplates.category, category),
      ),
    );
  if (templates.length === 0) return 0;
  const existing = await db
    .select({ name: contractorRequirements.name })
    .from(contractorRequirements)
    .where(
      and(
        eq(contractorRequirements.tenantId, tenantId),
        eq(contractorRequirements.contractorId, contractorId),
      ),
    );
  const have = new Set(existing.map((r) => r.name));
  const toAdd = templates.filter((t) => !have.has(t.name));
  if (toAdd.length === 0) return 0;
  await db.insert(contractorRequirements).values(
    toAdd.map((t) => ({
      id: newId(),
      tenantId,
      contractorId,
      name: t.name,
      blocking: t.blocking,
      recurrenceMonths: t.recurrenceMonths,
    })),
  );
  return toAdd.length;
}

async function loadContractorOrThrow(db: Database, tenantId: string, id: string) {
  const rows = await db
    .select()
    .from(contractors)
    .where(and(eq(contractors.tenantId, tenantId), eq(contractors.id, id)))
    .limit(1);
  const row = rows[0];
  if (row === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
  return row;
}

async function loadVisitOrThrow(db: Database, tenantId: string, id: string) {
  const rows = await db
    .select()
    .from(contractorVisits)
    .where(and(eq(contractorVisits.tenantId, tenantId), eq(contractorVisits.id, id)))
    .limit(1);
  const row = rows[0];
  if (row === undefined || row.archivedAt !== null) throw new TRPCError({ code: 'NOT_FOUND' });
  return row;
}

/** ISO 8601 datetime (e.g. from `new Date().toISOString()`). */
const isoDateTime = z.string().datetime();

/**
 * Email dispatch for the external-contractor-user invite. Wired at app boot
 * via `setContractorsRouterDeps` (mirrors the users router); null in tests so
 * the invitation row is created without sending mail.
 */
export interface ContractorsRouterDeps {
  sendEmail:
    | ((args: {
        to: string;
        templateKey: 'invite' | 'contractor-portal-invite' | 'contractor-overstay';
        variables: Record<string, string>;
      }) => Promise<unknown>)
    | null;
  appUrl: string;
}
const contractorsDeps: ContractorsRouterDeps = { sendEmail: null, appUrl: 'http://localhost:3000' };
export function setContractorsRouterDeps(deps: ContractorsRouterDeps): void {
  contractorsDeps.sendEmail = deps.sendEmail;
  contractorsDeps.appUrl = deps.appUrl;
}

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const activitiesInput = z.array(z.enum(CONTRACTOR_ACTIVITIES)).default([]);

/** Answers to the configured gate fields, keyed by gate-field id. */
const capturedFieldsSchema = z.record(z.string().length(26), z.string().max(2000));

/** Append a gate check-in / check-out event to the audit log. */
async function insertVisitEvent(
  db: Database,
  args: {
    tenantId: string;
    visitId: string;
    contractorId: string;
    eventType: 'check_in' | 'check_out';
    method: 'self_scan' | 'staff';
    actorUserId: string | null;
    capturedFields?: Record<string, string>;
    overrideReason?: string | null;
  },
): Promise<void> {
  await db.insert(contractorVisitEvents).values({
    id: newId(),
    tenantId: args.tenantId,
    visitId: args.visitId,
    contractorId: args.contractorId,
    eventType: args.eventType,
    method: args.method,
    actorUserId: args.actorUserId,
    ...(args.capturedFields !== undefined ? { capturedFields: args.capturedFields } : {}),
    ...(args.overrideReason != null && args.overrideReason !== ''
      ? { overrideReason: args.overrideReason }
      : {}),
  });
}

export const contractorsRouter = router({
  list: tenantProcedure.use(requirePermission('contractors.view')).query(async ({ ctx }) => {
    const tid = ctx.tenantId;
    const rows = await ctx.db
      .select()
      .from(contractors)
      .where(and(eq(contractors.tenantId, tid), isNull(contractors.archivedAt)))
      .orderBy(contractors.name);
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const reqs = await ctx.db
      .select({
        id: contractorRequirements.id,
        contractorId: contractorRequirements.contractorId,
        blocking: contractorRequirements.blocking,
      })
      .from(contractorRequirements)
      .where(
        and(
          eq(contractorRequirements.tenantId, tid),
          inArray(contractorRequirements.contractorId, ids),
        ),
      );
    const docs = await ctx.db
      .select({
        contractorId: contractorDocuments.contractorId,
        requirementId: contractorDocuments.requirementId,
        status: contractorDocuments.status,
        endDate: contractorDocuments.endDate,
      })
      .from(contractorDocuments)
      .where(
        and(
          eq(contractorDocuments.tenantId, tid),
          inArray(contractorDocuments.contractorId, ids),
        ),
      );

    const t = today();
    const reqsByContractor = new Map<string, ReqRow[]>();
    for (const r of reqs) {
      const arr = reqsByContractor.get(r.contractorId) ?? [];
      arr.push({ id: r.id, blocking: r.blocking });
      reqsByContractor.set(r.contractorId, arr);
    }
    const docsByContractorReq = new Map<string, Map<string, DocRow[]>>();
    for (const d of docs) {
      const inner = docsByContractorReq.get(d.contractorId) ?? new Map<string, DocRow[]>();
      const arr = inner.get(d.requirementId) ?? [];
      arr.push({ requirementId: d.requirementId, status: d.status, endDate: d.endDate });
      inner.set(d.requirementId, arr);
      docsByContractorReq.set(d.contractorId, inner);
    }

    return rows.map((c) => {
      const derived = computeStatus(
        reqsByContractor.get(c.id) ?? [],
        docsByContractorReq.get(c.id) ?? new Map(),
        t,
      );
      return {
        ...c,
        // A manual override wins over the derived status.
        complianceStatus: c.complianceOverride ?? derived,
        derivedComplianceStatus: derived,
        requirementCount: (reqsByContractor.get(c.id) ?? []).length,
      };
    });
  }),

  get: tenantProcedure
    .use(requirePermission('contractors.view'))
    .input(z.object({ id: z.string().length(26) }))
    .query(async ({ ctx, input }) => {
      const contractor = await loadContractorOrThrow(ctx.db, ctx.tenantId, input.id);

      const reqs = await ctx.db
        .select()
        .from(contractorRequirements)
        .where(
          and(
            eq(contractorRequirements.tenantId, ctx.tenantId),
            eq(contractorRequirements.contractorId, input.id),
          ),
        )
        .orderBy(contractorRequirements.createdAt);

      const docs = await ctx.db
        .select({
          id: contractorDocuments.id,
          requirementId: contractorDocuments.requirementId,
          filename: contractorDocuments.filename,
          mimeType: contractorDocuments.mimeType,
          sizeBytes: contractorDocuments.sizeBytes,
          storageKey: contractorDocuments.storageKey,
          startDate: contractorDocuments.startDate,
          endDate: contractorDocuments.endDate,
          status: contractorDocuments.status,
          rejectReason: contractorDocuments.rejectReason,
          verifiedAt: contractorDocuments.verifiedAt,
          verifierName: user.name,
          createdAt: contractorDocuments.createdAt,
        })
        .from(contractorDocuments)
        .leftJoin(user, eq(contractorDocuments.verifiedByUserId, user.id))
        .where(
          and(
            eq(contractorDocuments.tenantId, ctx.tenantId),
            eq(contractorDocuments.contractorId, input.id),
          ),
        )
        .orderBy(desc(contractorDocuments.createdAt));

      const t = today();
      const docsByReq = new Map<string, DocRow[]>();
      for (const d of docs) {
        const arr = docsByReq.get(d.requirementId) ?? [];
        arr.push({ requirementId: d.requirementId, status: d.status, endDate: d.endDate });
        docsByReq.set(d.requirementId, arr);
      }

      const requirements = reqs.map((r) => ({
        ...r,
        satisfied: requirementSatisfied(docsByReq.get(r.id) ?? [], t),
        documents: docs.filter((d) => d.requirementId === r.id),
      }));

      const derivedComplianceStatus = computeStatus(
        reqs.map((r) => ({ id: r.id, blocking: r.blocking })),
        docsByReq,
        t,
      );
      return {
        contractor,
        requirements,
        complianceStatus: contractor.complianceOverride ?? derivedComplianceStatus,
        derivedComplianceStatus,
      };
    }),

  create: tenantProcedure
    .use(requirePermission('contractors.manage'))
    .input(
      z.object({
        name: z.string().min(1).max(200),
        category: z.string().max(120).nullable().optional(),
        primaryContactName: z.string().max(200).nullable().optional(),
        primaryContactEmail: z.string().email().max(200).nullable().optional(),
        notes: z.string().max(5000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const id = newId();
      await ctx.db.insert(contractors).values({
        id,
        tenantId: ctx.tenantId,
        name: input.name.trim(),
        category: input.category ?? null,
        primaryContactName: input.primaryContactName ?? null,
        primaryContactEmail: input.primaryContactEmail ?? null,
        notes: input.notes ?? null,
      });
      // Auto-apply trade templates matching the category.
      const category = input.category?.trim();
      if (category !== undefined && category !== '') {
        await applyTemplatesForCategory(ctx.db, ctx.tenantId, id, category);
      }
      return { id };
    }),

  update: tenantProcedure
    .use(requirePermission('contractors.manage'))
    .input(
      z.object({
        id: z.string().length(26),
        name: z.string().min(1).max(200).optional(),
        category: z.string().max(120).nullable().optional(),
        status: z.enum(['active', 'inactive']).optional(),
        primaryContactName: z.string().max(200).nullable().optional(),
        primaryContactEmail: z.string().email().max(200).nullable().optional(),
        notes: z.string().max(5000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await loadContractorOrThrow(ctx.db, ctx.tenantId, input.id);
      const updates: Partial<typeof contractors.$inferInsert> = { updatedAt: new Date() };
      if (input.name !== undefined) updates.name = input.name.trim();
      if (input.category !== undefined) updates.category = input.category;
      if (input.status !== undefined) updates.status = input.status;
      if (input.primaryContactName !== undefined)
        updates.primaryContactName = input.primaryContactName;
      if (input.primaryContactEmail !== undefined)
        updates.primaryContactEmail = input.primaryContactEmail;
      if (input.notes !== undefined) updates.notes = input.notes;
      await ctx.db
        .update(contractors)
        .set(updates)
        .where(and(eq(contractors.tenantId, ctx.tenantId), eq(contractors.id, input.id)));
      return { ok: true as const };
    }),

  /**
   * Manually override (or clear) a contractor's compliance status. Passing
   * `override: null` reverts to the document-derived status.
   */
  setComplianceOverride: tenantProcedure
    .use(requirePermission('contractors.manage'))
    .input(
      z.object({
        id: z.string().length(26),
        override: z.enum(['compliant', 'non_compliant', 'suspended']).nullable(),
        reason: z.string().max(1000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await loadContractorOrThrow(ctx.db, ctx.tenantId, input.id);
      await ctx.db
        .update(contractors)
        .set({
          complianceOverride: input.override,
          complianceOverrideReason:
            input.override === null ? null : (input.reason?.trim() ?? null) || null,
          updatedAt: new Date(),
        })
        .where(and(eq(contractors.tenantId, ctx.tenantId), eq(contractors.id, input.id)));
      return { ok: true as const };
    }),

  archive: tenantProcedure
    .use(requirePermission('contractors.manage'))
    .input(z.object({ id: z.string().length(26) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(contractors)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(contractors.tenantId, ctx.tenantId), eq(contractors.id, input.id)));
      return { ok: true as const };
    }),

  // ─── Requirements ──────────────────────────────────────────────────────
  addRequirement: tenantProcedure
    .use(requirePermission('contractors.manage'))
    .input(
      z.object({
        contractorId: z.string().length(26),
        name: z.string().min(1).max(200),
        blocking: z.boolean().default(true),
        recurrenceMonths: z.number().int().min(1).max(120).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await loadContractorOrThrow(ctx.db, ctx.tenantId, input.contractorId);
      const id = newId();
      await ctx.db.insert(contractorRequirements).values({
        id,
        tenantId: ctx.tenantId,
        contractorId: input.contractorId,
        name: input.name.trim(),
        blocking: input.blocking,
        recurrenceMonths: input.recurrenceMonths ?? null,
      });
      return { id };
    }),

  removeRequirement: tenantProcedure
    .use(requirePermission('contractors.manage'))
    .input(z.object({ id: z.string().length(26) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(contractorRequirements)
        .where(
          and(
            eq(contractorRequirements.tenantId, ctx.tenantId),
            eq(contractorRequirements.id, input.id),
          ),
        );
      return { ok: true as const };
    }),

  // ─── Documents ─────────────────────────────────────────────────────────
  addDocument: tenantProcedure
    .use(requirePermission('contractors.manage'))
    .input(
      z.object({
        requirementId: z.string().length(26),
        storageKey: z.string().min(1).max(1000),
        filename: z.string().min(1).max(500),
        mimeType: z.string().min(1).max(200),
        sizeBytes: z.number().int().min(0),
        startDate: dateStr,
        endDate: dateStr,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertStorageKeyInTenant(ctx.tenantId, input.storageKey);
      const reqRows = await ctx.db
        .select({ contractorId: contractorRequirements.contractorId })
        .from(contractorRequirements)
        .where(
          and(
            eq(contractorRequirements.tenantId, ctx.tenantId),
            eq(contractorRequirements.id, input.requirementId),
          ),
        )
        .limit(1);
      const contractorId = reqRows[0]?.contractorId;
      if (contractorId === undefined) throw new TRPCError({ code: 'NOT_FOUND' });

      const id = newId();
      await ctx.db.insert(contractorDocuments).values({
        id,
        tenantId: ctx.tenantId,
        contractorId,
        requirementId: input.requirementId,
        storageKey: input.storageKey,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        status: 'pending',
        uploadedByUserId: ctx.auth.userId,
      });
      return { id };
    }),

  verifyDocument: tenantProcedure
    .use(requirePermission('contractors.verifyDocs'))
    .input(z.object({ id: z.string().length(26) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(contractorDocuments)
        .set({
          status: 'verified',
          rejectReason: null,
          verifiedByUserId: ctx.auth.userId,
          verifiedAt: new Date(),
        })
        .where(
          and(eq(contractorDocuments.tenantId, ctx.tenantId), eq(contractorDocuments.id, input.id)),
        );
      return { ok: true as const };
    }),

  rejectDocument: tenantProcedure
    .use(requirePermission('contractors.verifyDocs'))
    .input(z.object({ id: z.string().length(26), reason: z.string().max(1000) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(contractorDocuments)
        .set({
          status: 'rejected',
          rejectReason: input.reason,
          verifiedByUserId: ctx.auth.userId,
          verifiedAt: new Date(),
        })
        .where(
          and(eq(contractorDocuments.tenantId, ctx.tenantId), eq(contractorDocuments.id, input.id)),
        );
      return { ok: true as const };
    }),

  // ─── Requirement trade templates ───────────────────────────────────────
  templates: router({
    list: tenantProcedure.use(requirePermission('contractors.view')).query(async ({ ctx }) => {
      return ctx.db
        .select()
        .from(contractorRequirementTemplates)
        .where(eq(contractorRequirementTemplates.tenantId, ctx.tenantId))
        .orderBy(contractorRequirementTemplates.category, contractorRequirementTemplates.name);
    }),
    create: tenantProcedure
      .use(requirePermission('contractors.manage'))
      .input(
        z.object({
          category: z.string().min(1).max(120),
          name: z.string().min(1).max(200),
          blocking: z.boolean().default(true),
          recurrenceMonths: z.number().int().min(1).max(120).nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const id = newId();
        await ctx.db.insert(contractorRequirementTemplates).values({
          id,
          tenantId: ctx.tenantId,
          category: input.category.trim(),
          name: input.name.trim(),
          blocking: input.blocking,
          recurrenceMonths: input.recurrenceMonths ?? null,
        });
        return { id };
      }),
    remove: tenantProcedure
      .use(requirePermission('contractors.manage'))
      .input(z.object({ id: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        await ctx.db
          .delete(contractorRequirementTemplates)
          .where(
            and(
              eq(contractorRequirementTemplates.tenantId, ctx.tenantId),
              eq(contractorRequirementTemplates.id, input.id),
            ),
          );
        return { ok: true as const };
      }),
  }),

  /** Apply the contractor's category templates on demand. */
  applyTemplates: tenantProcedure
    .use(requirePermission('contractors.manage'))
    .input(z.object({ id: z.string().length(26) }))
    .mutation(async ({ ctx, input }) => {
      const c = await loadContractorOrThrow(ctx.db, ctx.tenantId, input.id);
      if (c.category === null || c.category === '') return { applied: 0 };
      const applied = await applyTemplatesForCategory(ctx.db, ctx.tenantId, input.id, c.category);
      return { applied };
    }),

  // ─── Public upload portal (no login) ───────────────────────────────────
  /** Regenerate (or create) the opaque token for the public upload link. */
  regenerateUploadLink: tenantProcedure
    .use(requirePermission('contractors.manage'))
    .input(z.object({ id: z.string().length(26) }))
    .mutation(async ({ ctx, input }) => {
      await loadContractorOrThrow(ctx.db, ctx.tenantId, input.id);
      const token = randomBytes(24).toString('hex');
      await ctx.db
        .update(contractors)
        .set({ uploadToken: token, updatedAt: new Date() })
        .where(and(eq(contractors.tenantId, ctx.tenantId), eq(contractors.id, input.id)));
      return { token };
    }),

  /** Public: resolve a contractor by its upload token (name + requirements only). */
  publicByToken: publicProcedure
    .input(z.object({ token: z.string().min(10).max(200) }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({ id: contractors.id, name: contractors.name, tenantId: contractors.tenantId })
        .from(contractors)
        .where(and(eq(contractors.uploadToken, input.token), isNull(contractors.archivedAt)))
        .limit(1);
      const c = rows[0];
      if (c === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      const reqs = await ctx.db
        .select({
          id: contractorRequirements.id,
          name: contractorRequirements.name,
          blocking: contractorRequirements.blocking,
        })
        .from(contractorRequirements)
        .where(eq(contractorRequirements.contractorId, c.id))
        .orderBy(contractorRequirements.createdAt);
      return { contractorName: c.name, requirements: reqs };
    }),

  // ─── Visits / calendar (Phase 2a) ──────────────────────────────────────
  visits: router({
    /** Visits overlapping a [from, to] date-range — powers the calendar. */
    list: tenantProcedure
      .use(requirePermission('contractors.view'))
      .input(
        z.object({
          from: isoDateTime,
          to: isoDateTime,
          contractorId: z.string().length(26).optional(),
          siteId: z.string().length(26).optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        const authorizer = aliasedTable(user, 'visit_authorizer');
        const conds = [
          eq(contractorVisits.tenantId, ctx.tenantId),
          isNull(contractorVisits.archivedAt),
          between(contractorVisits.scheduledStart, new Date(input.from), new Date(input.to)),
        ];
        if (input.contractorId !== undefined)
          conds.push(eq(contractorVisits.contractorId, input.contractorId));
        if (input.siteId !== undefined) conds.push(eq(contractorVisits.siteId, input.siteId));
        return ctx.db
          .select({
            id: contractorVisits.id,
            contractorId: contractorVisits.contractorId,
            contractorName: contractors.name,
            siteId: contractorVisits.siteId,
            siteName: sites.name,
            title: contractorVisits.title,
            status: contractorVisits.status,
            scheduledStart: contractorVisits.scheduledStart,
            scheduledEnd: contractorVisits.scheduledEnd,
            isWalkIn: contractorVisits.isWalkIn,
            authorizedByName: authorizer.name,
            checkedInAt: contractorVisits.checkedInAt,
            checkedOutAt: contractorVisits.checkedOutAt,
          })
          .from(contractorVisits)
          .innerJoin(contractors, eq(contractorVisits.contractorId, contractors.id))
          .leftJoin(sites, eq(contractorVisits.siteId, sites.id))
          .leftJoin(authorizer, eq(contractorVisits.authorizedByUserId, authorizer.id))
          .where(and(...conds))
          .orderBy(asc(contractorVisits.scheduledStart));
      }),

    /**
     * Everyone currently on site — visits checked-in but not yet checked-out.
     * Powers the gate guard's "who is still inside" board on the directory.
     */
    onSiteNow: tenantProcedure
      .use(requirePermission('contractors.view'))
      .query(async ({ ctx }) => {
        return ctx.db
          .select({
            id: contractorVisits.id,
            contractorId: contractorVisits.contractorId,
            contractorName: contractors.name,
            title: contractorVisits.title,
            visitorName: contractorVisits.visitorName,
            siteName: sites.name,
            isWalkIn: contractorVisits.isWalkIn,
            checkedInAt: contractorVisits.checkedInAt,
          })
          .from(contractorVisits)
          .innerJoin(contractors, eq(contractorVisits.contractorId, contractors.id))
          .leftJoin(sites, eq(contractorVisits.siteId, sites.id))
          .where(
            and(
              eq(contractorVisits.tenantId, ctx.tenantId),
              isNull(contractorVisits.archivedAt),
              eq(contractorVisits.status, 'checked_in'),
            ),
          )
          .orderBy(desc(contractorVisits.checkedInAt));
      }),

    /** All non-archived visits for one contractor (detail page). */
    listForContractor: tenantProcedure
      .use(requirePermission('contractors.view'))
      .input(z.object({ contractorId: z.string().length(26) }))
      .query(async ({ ctx, input }) => {
        return ctx.db
          .select({
            id: contractorVisits.id,
            siteId: contractorVisits.siteId,
            siteName: sites.name,
            title: contractorVisits.title,
            status: contractorVisits.status,
            scheduledStart: contractorVisits.scheduledStart,
            scheduledEnd: contractorVisits.scheduledEnd,
            isWalkIn: contractorVisits.isWalkIn,
            checkedInAt: contractorVisits.checkedInAt,
            checkedOutAt: contractorVisits.checkedOutAt,
          })
          .from(contractorVisits)
          .leftJoin(sites, eq(contractorVisits.siteId, sites.id))
          .where(
            and(
              eq(contractorVisits.tenantId, ctx.tenantId),
              eq(contractorVisits.contractorId, input.contractorId),
              isNull(contractorVisits.archivedAt),
            ),
          )
          .orderBy(desc(contractorVisits.scheduledStart));
      }),

    get: tenantProcedure
      .use(requirePermission('contractors.view'))
      .input(z.object({ id: z.string().length(26) }))
      .query(async ({ ctx, input }) => {
        const authorizer = aliasedTable(user, 'visit_authorizer');
        const rows = await ctx.db
          .select({
            visit: contractorVisits,
            contractorName: contractors.name,
            siteName: sites.name,
            authorizedByName: authorizer.name,
          })
          .from(contractorVisits)
          .innerJoin(contractors, eq(contractorVisits.contractorId, contractors.id))
          .leftJoin(sites, eq(contractorVisits.siteId, sites.id))
          .leftJoin(authorizer, eq(contractorVisits.authorizedByUserId, authorizer.id))
          .where(
            and(
              eq(contractorVisits.tenantId, ctx.tenantId),
              eq(contractorVisits.id, input.id),
              isNull(contractorVisits.archivedAt),
            ),
          )
          .limit(1);
        const row = rows[0];
        if (row === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
        return row;
      }),

    /** Schedule a planned visit. `authorize` stamps the caller as authoriser. */
    create: tenantProcedure
      .use(requirePermission('contractors.manage'))
      .input(
        z.object({
          contractorId: z.string().length(26),
          siteId: z.string().length(26).nullable().optional(),
          title: z.string().min(1).max(300),
          visitorName: z.string().max(300).nullable().optional(),
          scheduledStart: isoDateTime,
          scheduledEnd: isoDateTime.nullable().optional(),
          notes: z.string().max(5000).nullable().optional(),
          authorize: z.boolean().default(false),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await loadContractorOrThrow(ctx.db, ctx.tenantId, input.contractorId);
        const id = newId();
        await ctx.db.insert(contractorVisits).values({
          id,
          tenantId: ctx.tenantId,
          contractorId: input.contractorId,
          siteId: input.siteId ?? null,
          title: input.title.trim(),
          visitorName: input.visitorName?.trim() ? input.visitorName.trim() : null,
          scheduledStart: new Date(input.scheduledStart),
          scheduledEnd: input.scheduledEnd != null ? new Date(input.scheduledEnd) : null,
          notes: input.notes ?? null,
          createdByUserId: ctx.auth.userId,
          ...(input.authorize ? { authorizedByUserId: ctx.auth.userId } : {}),
        });
        return { id };
      }),

    /** Log an unplanned arrival — created already checked-in at the gate. */
    createWalkIn: tenantProcedure
      .use(requirePermission('contractors.manage'))
      .input(
        z.object({
          contractorId: z.string().length(26),
          siteId: z.string().length(26).nullable().optional(),
          title: z.string().min(1).max(300),
          visitorName: z.string().max(300).nullable().optional(),
          notes: z.string().max(5000).nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await loadContractorOrThrow(ctx.db, ctx.tenantId, input.contractorId);
        const now = new Date();
        const id = newId();
        await ctx.db.insert(contractorVisits).values({
          id,
          tenantId: ctx.tenantId,
          contractorId: input.contractorId,
          siteId: input.siteId ?? null,
          title: input.title.trim(),
          visitorName: input.visitorName?.trim() ? input.visitorName.trim() : null,
          status: 'checked_in',
          scheduledStart: now,
          isWalkIn: true,
          authorizedByUserId: ctx.auth.userId,
          checkedInAt: now,
          notes: input.notes ?? null,
          createdByUserId: ctx.auth.userId,
        });
        await insertVisitEvent(ctx.db, {
          tenantId: ctx.tenantId,
          visitId: id,
          contractorId: input.contractorId,
          eventType: 'check_in',
          method: 'staff',
          actorUserId: ctx.auth.userId,
        });
        return { id };
      }),

    update: tenantProcedure
      .use(requirePermission('contractors.manage'))
      .input(
        z.object({
          id: z.string().length(26),
          title: z.string().min(1).max(300).optional(),
          siteId: z.string().length(26).nullable().optional(),
          scheduledStart: isoDateTime.optional(),
          scheduledEnd: isoDateTime.nullable().optional(),
          notes: z.string().max(5000).nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await loadVisitOrThrow(ctx.db, ctx.tenantId, input.id);
        const updates: Partial<typeof contractorVisits.$inferInsert> = { updatedAt: new Date() };
        if (input.title !== undefined) updates.title = input.title.trim();
        if (input.siteId !== undefined) updates.siteId = input.siteId;
        if (input.scheduledStart !== undefined)
          updates.scheduledStart = new Date(input.scheduledStart);
        if (input.scheduledEnd !== undefined)
          updates.scheduledEnd = input.scheduledEnd === null ? null : new Date(input.scheduledEnd);
        if (input.notes !== undefined) updates.notes = input.notes;
        await ctx.db
          .update(contractorVisits)
          .set(updates)
          .where(
            and(eq(contractorVisits.tenantId, ctx.tenantId), eq(contractorVisits.id, input.id)),
          );
        return { ok: true as const };
      }),

    /** Approve a scheduled visit (authoriser == approval). */
    authorize: tenantProcedure
      .use(requirePermission('contractors.manage'))
      .input(z.object({ id: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        await loadVisitOrThrow(ctx.db, ctx.tenantId, input.id);
        await ctx.db
          .update(contractorVisits)
          .set({ authorizedByUserId: ctx.auth.userId, updatedAt: new Date() })
          .where(
            and(eq(contractorVisits.tenantId, ctx.tenantId), eq(contractorVisits.id, input.id)),
          );
        return { ok: true as const };
      }),

    checkIn: tenantProcedure
      .use(requirePermission('contractors.manage'))
      .input(
        z.object({
          id: z.string().length(26),
          capturedFields: capturedFieldsSchema.optional(),
          overrideReason: z.string().max(1000).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const visit = await loadVisitOrThrow(ctx.db, ctx.tenantId, input.id);
        if (visit.status === 'cancelled')
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Visit is cancelled' });
        const now = new Date();
        await ctx.db
          .update(contractorVisits)
          .set({ status: 'checked_in', checkedInAt: now, updatedAt: now })
          .where(
            and(eq(contractorVisits.tenantId, ctx.tenantId), eq(contractorVisits.id, input.id)),
          );
        await insertVisitEvent(ctx.db, {
          tenantId: ctx.tenantId,
          visitId: visit.id,
          contractorId: visit.contractorId,
          eventType: 'check_in',
          method: 'staff',
          actorUserId: ctx.auth.userId,
          ...(input.capturedFields !== undefined ? { capturedFields: input.capturedFields } : {}),
          ...(input.overrideReason !== undefined ? { overrideReason: input.overrideReason } : {}),
        });
        return { ok: true as const };
      }),

    checkOut: tenantProcedure
      .use(requirePermission('contractors.manage'))
      .input(
        z.object({
          id: z.string().length(26),
          capturedFields: capturedFieldsSchema.optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const visit = await loadVisitOrThrow(ctx.db, ctx.tenantId, input.id);
        if (visit.checkedInAt === null)
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Visit was never checked in' });
        const now = new Date();
        await ctx.db
          .update(contractorVisits)
          .set({ status: 'checked_out', checkedOutAt: now, updatedAt: now })
          .where(
            and(eq(contractorVisits.tenantId, ctx.tenantId), eq(contractorVisits.id, input.id)),
          );
        await insertVisitEvent(ctx.db, {
          tenantId: ctx.tenantId,
          visitId: visit.id,
          contractorId: visit.contractorId,
          eventType: 'check_out',
          method: 'staff',
          actorUserId: ctx.auth.userId,
          ...(input.capturedFields !== undefined ? { capturedFields: input.capturedFields } : {}),
        });
        return { ok: true as const };
      }),

    /** Audit log of gate events for a visit (newest first). */
    events: tenantProcedure
      .use(requirePermission('contractors.view'))
      .input(z.object({ visitId: z.string().length(26) }))
      .query(async ({ ctx, input }) => {
        return ctx.db
          .select({
            id: contractorVisitEvents.id,
            eventType: contractorVisitEvents.eventType,
            method: contractorVisitEvents.method,
            overrideReason: contractorVisitEvents.overrideReason,
            capturedFields: contractorVisitEvents.capturedFields,
            actorName: user.name,
            at: contractorVisitEvents.at,
          })
          .from(contractorVisitEvents)
          .leftJoin(user, eq(contractorVisitEvents.actorUserId, user.id))
          .where(
            and(
              eq(contractorVisitEvents.tenantId, ctx.tenantId),
              eq(contractorVisitEvents.visitId, input.visitId),
            ),
          )
          .orderBy(desc(contractorVisitEvents.at));
      }),

    /** Set a terminal non-attended status: `cancelled` or `no_show`. */
    setStatus: tenantProcedure
      .use(requirePermission('contractors.manage'))
      .input(z.object({ id: z.string().length(26), status: z.enum(['cancelled', 'no_show']) }))
      .mutation(async ({ ctx, input }) => {
        await loadVisitOrThrow(ctx.db, ctx.tenantId, input.id);
        await ctx.db
          .update(contractorVisits)
          .set({ status: input.status, updatedAt: new Date() })
          .where(
            and(eq(contractorVisits.tenantId, ctx.tenantId), eq(contractorVisits.id, input.id)),
          );
        return { ok: true as const };
      }),

    delete: tenantProcedure
      .use(requirePermission('contractors.manage'))
      .input(z.object({ id: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        await ctx.db
          .update(contractorVisits)
          .set({ archivedAt: new Date(), updatedAt: new Date() })
          .where(
            and(eq(contractorVisits.tenantId, ctx.tenantId), eq(contractorVisits.id, input.id)),
          );
        return { ok: true as const };
      }),
  }),

  // ─── Gate: company-configurable capture fields (Phase 2b) ──────────────
  gateFields: router({
    list: tenantProcedure.use(requirePermission('contractors.view')).query(async ({ ctx }) => {
      return ctx.db
        .select()
        .from(contractorGateFields)
        .where(
          and(
            eq(contractorGateFields.tenantId, ctx.tenantId),
            isNull(contractorGateFields.archivedAt),
          ),
        )
        .orderBy(asc(contractorGateFields.sortOrder), asc(contractorGateFields.createdAt));
    }),
    create: tenantProcedure
      .use(requirePermission('contractors.manage'))
      .input(
        z.object({
          label: z.string().min(1).max(200),
          fieldType: z.enum(['text', 'number', 'yes_no']).default('text'),
          required: z.boolean().default(false),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const existing = await ctx.db
          .select({ sortOrder: contractorGateFields.sortOrder })
          .from(contractorGateFields)
          .where(
            and(
              eq(contractorGateFields.tenantId, ctx.tenantId),
              isNull(contractorGateFields.archivedAt),
            ),
          );
        const nextOrder = existing.reduce((m, r) => Math.max(m, r.sortOrder + 1), 0);
        const id = newId();
        await ctx.db.insert(contractorGateFields).values({
          id,
          tenantId: ctx.tenantId,
          label: input.label.trim(),
          fieldType: input.fieldType,
          required: input.required,
          sortOrder: nextOrder,
        });
        return { id };
      }),
    update: tenantProcedure
      .use(requirePermission('contractors.manage'))
      .input(
        z.object({
          id: z.string().length(26),
          label: z.string().min(1).max(200).optional(),
          fieldType: z.enum(['text', 'number', 'yes_no']).optional(),
          required: z.boolean().optional(),
          sortOrder: z.number().int().min(0).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const updates: Partial<typeof contractorGateFields.$inferInsert> = {};
        if (input.label !== undefined) updates.label = input.label.trim();
        if (input.fieldType !== undefined) updates.fieldType = input.fieldType;
        if (input.required !== undefined) updates.required = input.required;
        if (input.sortOrder !== undefined) updates.sortOrder = input.sortOrder;
        await ctx.db
          .update(contractorGateFields)
          .set(updates)
          .where(
            and(
              eq(contractorGateFields.tenantId, ctx.tenantId),
              eq(contractorGateFields.id, input.id),
            ),
          );
        return { ok: true as const };
      }),
    remove: tenantProcedure
      .use(requirePermission('contractors.manage'))
      .input(z.object({ id: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        // Soft-archive so historical event answers keep resolving their label.
        await ctx.db
          .update(contractorGateFields)
          .set({ archivedAt: new Date() })
          .where(
            and(
              eq(contractorGateFields.tenantId, ctx.tenantId),
              eq(contractorGateFields.id, input.id),
            ),
          );
        return { ok: true as const };
      }),
  }),

  // ─── Gate: self-scan kiosk (Phase 2b) ──────────────────────────────────
  gate: router({
    /** The tenant's kiosk token (null until first generated). */
    config: tenantProcedure.use(requirePermission('contractors.manage')).query(async ({ ctx }) => {
      const rows = await ctx.db
        .select({ gateToken: contractorGateConfig.gateToken })
        .from(contractorGateConfig)
        .where(eq(contractorGateConfig.tenantId, ctx.tenantId))
        .limit(1);
      return { gateToken: rows[0]?.gateToken ?? null };
    }),
    regenerateToken: tenantProcedure
      .use(requirePermission('contractors.manage'))
      .mutation(async ({ ctx }) => {
        const token = randomBytes(24).toString('hex');
        await ctx.db
          .insert(contractorGateConfig)
          .values({ tenantId: ctx.tenantId, gateToken: token })
          .onConflictDoUpdate({
            target: contractorGateConfig.tenantId,
            set: { gateToken: token, updatedAt: new Date() },
          });
        return { token };
      }),

    /** Public: resolve the kiosk by token — today's visits + capture fields. */
    publicByToken: publicProcedure
      .input(z.object({ token: z.string().min(10).max(200) }))
      .query(async ({ ctx, input }) => {
        const cfg = await ctx.db
          .select({ tenantId: contractorGateConfig.tenantId })
          .from(contractorGateConfig)
          .where(eq(contractorGateConfig.gateToken, input.token))
          .limit(1);
        const tenantId = cfg[0]?.tenantId;
        if (tenantId === undefined) throw new TRPCError({ code: 'NOT_FOUND' });

        const now = Date.now();
        const from = new Date(now - 24 * 3_600_000);
        const to = new Date(now + 24 * 3_600_000);
        const visits = await ctx.db
          .select({
            id: contractorVisits.id,
            contractorName: contractors.name,
            title: contractorVisits.title,
            status: contractorVisits.status,
            scheduledStart: contractorVisits.scheduledStart,
          })
          .from(contractorVisits)
          .innerJoin(contractors, eq(contractorVisits.contractorId, contractors.id))
          .where(
            and(
              eq(contractorVisits.tenantId, tenantId),
              isNull(contractorVisits.archivedAt),
              inArray(contractorVisits.status, ['scheduled', 'checked_in']),
              between(contractorVisits.scheduledStart, from, to),
            ),
          )
          .orderBy(asc(contractorVisits.scheduledStart));

        const fields = await ctx.db
          .select({
            id: contractorGateFields.id,
            label: contractorGateFields.label,
            fieldType: contractorGateFields.fieldType,
            required: contractorGateFields.required,
          })
          .from(contractorGateFields)
          .where(
            and(
              eq(contractorGateFields.tenantId, tenantId),
              isNull(contractorGateFields.archivedAt),
            ),
          )
          .orderBy(asc(contractorGateFields.sortOrder), asc(contractorGateFields.createdAt));

        return { visits, fields };
      }),

    /** Public: a contractor self-checks-in / out at the kiosk. */
    selfCheckIn: publicProcedure
      .input(
        z.object({
          token: z.string().min(10).max(200),
          visitId: z.string().length(26),
          eventType: z.enum(['check_in', 'check_out']),
          capturedFields: capturedFieldsSchema.optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const cfg = await ctx.db
          .select({ tenantId: contractorGateConfig.tenantId })
          .from(contractorGateConfig)
          .where(eq(contractorGateConfig.gateToken, input.token))
          .limit(1);
        const tenantId = cfg[0]?.tenantId;
        if (tenantId === undefined) throw new TRPCError({ code: 'NOT_FOUND' });

        const visit = await loadVisitOrThrow(ctx.db, tenantId, input.visitId);

        // Enforce required capture fields on check-in.
        if (input.eventType === 'check_in') {
          const required = await ctx.db
            .select({ id: contractorGateFields.id })
            .from(contractorGateFields)
            .where(
              and(
                eq(contractorGateFields.tenantId, tenantId),
                eq(contractorGateFields.required, true),
                isNull(contractorGateFields.archivedAt),
              ),
            );
          const answers = input.capturedFields ?? {};
          for (const f of required) {
            if ((answers[f.id] ?? '').trim() === '') {
              throw new TRPCError({ code: 'BAD_REQUEST', message: 'Missing required field' });
            }
          }
          if (visit.status === 'cancelled')
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'Visit is cancelled' });
        } else if (visit.checkedInAt === null) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Visit was never checked in' });
        }

        const now = new Date();
        await ctx.db
          .update(contractorVisits)
          .set(
            input.eventType === 'check_in'
              ? { status: 'checked_in', checkedInAt: now, updatedAt: now }
              : { status: 'checked_out', checkedOutAt: now, updatedAt: now },
          )
          .where(
            and(eq(contractorVisits.tenantId, tenantId), eq(contractorVisits.id, input.visitId)),
          );
        await insertVisitEvent(ctx.db, {
          tenantId,
          visitId: visit.id,
          contractorId: visit.contractorId,
          eventType: input.eventType,
          method: 'self_scan',
          actorUserId: null,
          ...(input.capturedFields !== undefined ? { capturedFields: input.capturedFields } : {}),
        });
        return { ok: true as const };
      }),
  }),

  // ─── Contractor ↔ asset link (Phase 3) ─────────────────────────────────
  assets: router({
    /** Assets this contractor services. */
    listForContractor: tenantProcedure
      .use(requirePermission('contractors.view'))
      .input(z.object({ contractorId: z.string().length(26) }))
      .query(async ({ ctx, input }) => {
        return ctx.db
          .select({
            linkId: contractorAssets.id,
            assetId: assets.id,
            name: assets.name,
            typeName: assetTypes.name,
            siteName: sites.name,
            note: contractorAssets.note,
          })
          .from(contractorAssets)
          .innerJoin(assets, eq(contractorAssets.assetId, assets.id))
          .leftJoin(assetTypes, eq(assets.typeId, assetTypes.id))
          .leftJoin(sites, eq(assets.siteId, sites.id))
          .where(
            and(
              eq(contractorAssets.tenantId, ctx.tenantId),
              eq(contractorAssets.contractorId, input.contractorId),
              isNull(assets.archivedAt),
            ),
          )
          .orderBy(asc(assets.name));
      }),

    /** Contractors that service this asset. */
    listForAsset: tenantProcedure
      .use(requirePermission('contractors.view'))
      .input(z.object({ assetId: z.string().length(26) }))
      .query(async ({ ctx, input }) => {
        return ctx.db
          .select({
            linkId: contractorAssets.id,
            contractorId: contractors.id,
            name: contractors.name,
            category: contractors.category,
            note: contractorAssets.note,
          })
          .from(contractorAssets)
          .innerJoin(contractors, eq(contractorAssets.contractorId, contractors.id))
          .where(
            and(
              eq(contractorAssets.tenantId, ctx.tenantId),
              eq(contractorAssets.assetId, input.assetId),
              isNull(contractors.archivedAt),
            ),
          )
          .orderBy(asc(contractors.name));
      }),

    link: tenantProcedure
      .use(requirePermission('contractors.manage'))
      .input(
        z.object({
          contractorId: z.string().length(26),
          assetId: z.string().length(26),
          note: z.string().max(500).nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await loadContractorOrThrow(ctx.db, ctx.tenantId, input.contractorId);
        const assetRows = await ctx.db
          .select({ id: assets.id })
          .from(assets)
          .where(and(eq(assets.tenantId, ctx.tenantId), eq(assets.id, input.assetId)))
          .limit(1);
        if (assetRows[0] === undefined) throw new TRPCError({ code: 'NOT_FOUND' });

        const id = newId();
        await ctx.db
          .insert(contractorAssets)
          .values({
            id,
            tenantId: ctx.tenantId,
            contractorId: input.contractorId,
            assetId: input.assetId,
            note: input.note ?? null,
          })
          .onConflictDoNothing({
            target: [contractorAssets.contractorId, contractorAssets.assetId],
          });
        return { ok: true as const };
      }),

    unlink: tenantProcedure
      .use(requirePermission('contractors.manage'))
      .input(z.object({ id: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        await ctx.db
          .delete(contractorAssets)
          .where(
            and(eq(contractorAssets.tenantId, ctx.tenantId), eq(contractorAssets.id, input.id)),
          );
        return { ok: true as const };
      }),
  }),

  // ─── External contractor users / portal (Phase 4) ──────────────────────
  users: router({
    /** Accepted external users + pending invites for a contractor. */
    list: tenantProcedure
      .use(requirePermission('contractors.view'))
      .input(z.object({ contractorId: z.string().length(26) }))
      .query(async ({ ctx, input }) => {
        const members = await ctx.db
          .select({
            id: contractorUsers.id,
            userId: contractorUsers.userId,
            name: user.name,
            email: user.email,
            activities: contractorUsers.activities,
            acknowledgedAt: contractorUsers.acknowledgedAt,
            deactivatedAt: user.deactivatedAt,
          })
          .from(contractorUsers)
          .innerJoin(user, eq(contractorUsers.userId, user.id))
          .where(
            and(
              eq(contractorUsers.tenantId, ctx.tenantId),
              eq(contractorUsers.contractorId, input.contractorId),
            ),
          )
          .orderBy(asc(user.name));

        const pending = await ctx.db
          .select({
            id: invitations.id,
            email: invitations.email,
            name: invitations.name,
            activities: invitations.contractorActivities,
            createdAt: invitations.createdAt,
          })
          .from(invitations)
          .where(
            and(
              eq(invitations.tenantId, ctx.tenantId),
              eq(invitations.contractorId, input.contractorId),
              isNull(invitations.acceptedAt),
            ),
          )
          .orderBy(desc(invitations.createdAt));

        return { members, pending };
      }),

    /** Invite a person to the portal as this contractor's user. */
    invite: tenantProcedure
      .use(requirePermission('contractors.manage'))
      .input(
        z.object({
          contractorId: z.string().length(26),
          email: z.string().email().max(200),
          name: z.string().max(200).optional(),
          activities: activitiesInput,
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const contractor = await loadContractorOrThrow(ctx.db, ctx.tenantId, input.contractorId);
        const emailLower = input.email.trim().toLowerCase();

        const existingUser = await ctx.db
          .select({ id: user.id })
          .from(user)
          .where(and(eq(user.tenantId, ctx.tenantId), eq(user.email, emailLower)))
          .limit(1);
        if (existingUser[0] !== undefined) {
          throw new TRPCError({ code: 'CONFLICT', message: 'A user with this email already exists' });
        }

        // Per-user, platform-managed permission set derived from activities.
        const permissionSetId = newId();
        await ctx.db.insert(permissionSets).values({
          id: permissionSetId,
          tenantId: ctx.tenantId,
          name: `Contractor · ${emailLower}`,
          description: `Portal access for ${contractor.name}`,
          permissions: activitiesToPermissionKeys(input.activities),
          isSystem: false,
          externalManaged: true,
        });

        const token = randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
        // Reuse an existing active invite for this email, else insert.
        const active = await ctx.db
          .select({ id: invitations.id })
          .from(invitations)
          .where(
            and(
              eq(invitations.tenantId, ctx.tenantId),
              eq(invitations.email, emailLower),
              isNull(invitations.acceptedAt),
            ),
          )
          .limit(1);
        let invitationId: string;
        if (active[0] !== undefined) {
          invitationId = active[0].id;
          await ctx.db
            .update(invitations)
            .set({
              token,
              expiresAt,
              permissionSetId,
              contractorId: input.contractorId,
              contractorActivities: input.activities,
              ...(input.name !== undefined ? { name: input.name } : {}),
            })
            .where(eq(invitations.id, invitationId));
        } else {
          invitationId = newId();
          await ctx.db.insert(invitations).values({
            id: invitationId,
            tenantId: ctx.tenantId,
            email: emailLower,
            ...(input.name !== undefined ? { name: input.name } : {}),
            permissionSetId,
            token,
            invitedByUserId: ctx.auth.userId,
            expiresAt,
            contractorId: input.contractorId,
            contractorActivities: input.activities,
          });
        }

        if (contractorsDeps.sendEmail !== null) {
          try {
            const [tenantRow] = await ctx.db
              .select({ name: tenants.name })
              .from(tenants)
              .where(eq(tenants.id, ctx.tenantId))
              .limit(1);
            const inviteUrl = `${contractorsDeps.appUrl.replace(/\/$/, '')}/en/invite/${token}`;
            const ACTIVITY_WORDS: Record<string, string> = {
              inspections: 'conduct inspections',
              observations: 'raise observations',
              actions: 'view and comment on actions',
              documents: 'view documents',
            };
            const activitiesText =
              input.activities.length > 0
                ? input.activities.map((a) => ACTIVITY_WORDS[a] ?? a).join(', ')
                : 'access the portal';
            await contractorsDeps.sendEmail({
              to: emailLower,
              templateKey: 'contractor-portal-invite',
              variables: {
                contractorName: contractor.name,
                tenantName: tenantRow?.name ?? 'Forma360',
                inviteUrl,
                expiresIn: '7 days',
                activities: activitiesText,
              },
            });
          } catch (err) {
            ctx.logger.error({ err, invitationId }, '[contractors] portal invite email failed');
          }
        }
        return { invitationId, token };
      }),

    /** Change a portal user's activities (updates their derived permission set). */
    updateActivities: tenantProcedure
      .use(requirePermission('contractors.manage'))
      .input(z.object({ userId: z.string(), activities: activitiesInput }))
      .mutation(async ({ ctx, input }) => {
        const rows = await ctx.db
          .select({ id: contractorUsers.id })
          .from(contractorUsers)
          .where(
            and(
              eq(contractorUsers.tenantId, ctx.tenantId),
              eq(contractorUsers.userId, input.userId),
            ),
          )
          .limit(1);
        if (rows[0] === undefined) throw new TRPCError({ code: 'NOT_FOUND' });

        await ctx.db
          .update(contractorUsers)
          .set({ activities: input.activities })
          .where(eq(contractorUsers.id, rows[0].id));

        const [u] = await ctx.db
          .select({ permissionSetId: user.permissionSetId })
          .from(user)
          .where(and(eq(user.tenantId, ctx.tenantId), eq(user.id, input.userId)))
          .limit(1);
        if (u !== undefined) {
          await ctx.db
            .update(permissionSets)
            .set({ permissions: activitiesToPermissionKeys(input.activities) })
            .where(
              and(
                eq(permissionSets.tenantId, ctx.tenantId),
                eq(permissionSets.id, u.permissionSetId),
                eq(permissionSets.externalManaged, true),
              ),
            );
        }
        return { ok: true as const };
      }),

    /** Revoke portal access: unlink + deactivate the user (blocks login). */
    remove: tenantProcedure
      .use(requirePermission('contractors.manage'))
      .input(z.object({ userId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        await ctx.db
          .delete(contractorUsers)
          .where(
            and(
              eq(contractorUsers.tenantId, ctx.tenantId),
              eq(contractorUsers.userId, input.userId),
            ),
          );
        await ctx.db
          .update(user)
          .set({ deactivatedAt: new Date() })
          .where(and(eq(user.tenantId, ctx.tenantId), eq(user.id, input.userId)));
        return { ok: true as const };
      }),

    /** Cancel a pending portal invite. */
    cancelInvite: tenantProcedure
      .use(requirePermission('contractors.manage'))
      .input(z.object({ invitationId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        await ctx.db
          .delete(invitations)
          .where(
            and(
              eq(invitations.tenantId, ctx.tenantId),
              eq(invitations.id, input.invitationId),
              isNull(invitations.acceptedAt),
            ),
          );
        return { ok: true as const };
      }),

    /** Portal: the signed-in external user's own membership (or null). */
    me: tenantProcedure.query(async ({ ctx }) => {
      const rows = await ctx.db
        .select({
          contractorId: contractorUsers.contractorId,
          contractorName: contractors.name,
          activities: contractorUsers.activities,
          acknowledgedAt: contractorUsers.acknowledgedAt,
        })
        .from(contractorUsers)
        .innerJoin(contractors, eq(contractorUsers.contractorId, contractors.id))
        .where(
          and(
            eq(contractorUsers.tenantId, ctx.tenantId),
            eq(contractorUsers.userId, ctx.auth.userId),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    }),

    /** Portal: the external user completes the acknowledgement-onboarding step. */
    acknowledge: tenantProcedure.mutation(async ({ ctx }) => {
      await ctx.db
        .update(contractorUsers)
        .set({ acknowledgedAt: new Date() })
        .where(
          and(
            eq(contractorUsers.tenantId, ctx.tenantId),
            eq(contractorUsers.userId, ctx.auth.userId),
          ),
        );
      return { ok: true as const };
    }),
  }),
});
