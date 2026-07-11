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
  contractorDocuments,
  contractorRequirementTemplates,
  contractorRequirements,
  contractors,
  user,
} from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
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

    return rows.map((c) => ({
      ...c,
      complianceStatus: computeStatus(
        reqsByContractor.get(c.id) ?? [],
        docsByContractorReq.get(c.id) ?? new Map(),
        t,
      ),
      requirementCount: (reqsByContractor.get(c.id) ?? []).length,
    }));
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

      return {
        contractor,
        requirements,
        complianceStatus: computeStatus(
          reqs.map((r) => ({ id: r.id, blocking: r.blocking })),
          docsByReq,
          t,
        ),
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
});
