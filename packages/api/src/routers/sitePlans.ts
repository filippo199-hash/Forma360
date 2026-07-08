/**
 * Site/Project plans & pins router (Phase 3).
 *
 * Plans (floor plans / drawings):
 *   - listPlans   (sites.view)   — a site's plans, ordered by level.
 *   - createPlan  (sites.manage) — register an uploaded plan image/pdf.
 *   - renamePlan  (sites.manage)
 *   - reorderPlan (sites.manage) — set a plan's level order.
 *   - archivePlan (sites.manage) — soft-delete (pins cascade in the UI).
 *
 * Pins (things located on a plan):
 *   - listPins    (sites.view)   — a plan's pins.
 *   - createPin   (sites.view)   — drop a pin at a normalised (x, y),
 *                                  optionally linked to an observation /
 *                                  asset / media / inspection, else a note.
 *   - updatePin   (sites.view)   — move / relabel.
 *   - archivePin  (sites.view)   — remove.
 */
import { sitePlanPins, sitePlans } from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { TRPCError } from '@trpc/server';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission, tenantProcedure } from '../procedures';
import { assertSitesInTenant, assertStorageKeyInTenant } from '../tenant-guards';
import { router } from '../trpc';

function planKindForMime(mimeType: string): 'image' | 'pdf' {
  return mimeType === 'application/pdf' ? 'pdf' : 'image';
}

const createPlanInput = z.object({
  siteId: z.string().length(26),
  name: z.string().min(1).max(200),
  storageKey: z.string().min(1).max(1024),
  mimeType: z.string().min(1).max(200),
});

const pinEntity = z.enum(['observation', 'asset', 'media', 'inspection', 'note']);

const createPinInput = z.object({
  planId: z.string().length(26),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  entityType: pinEntity.default('note'),
  entityId: z.string().length(26).nullable().optional(),
  label: z.string().max(500).optional(),
});

export const sitePlansRouter = router({
  // ── Plans ────────────────────────────────────────────────────────────────
  listPlans: tenantProcedure
    .use(requirePermission('sites.view'))
    .input(z.object({ siteId: z.string().length(26) }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          id: sitePlans.id,
          siteId: sitePlans.siteId,
          name: sitePlans.name,
          storageKey: sitePlans.storageKey,
          mimeType: sitePlans.mimeType,
          kind: sitePlans.kind,
          sortOrder: sitePlans.sortOrder,
          createdAt: sitePlans.createdAt,
        })
        .from(sitePlans)
        .where(
          and(
            eq(sitePlans.tenantId, ctx.tenantId),
            eq(sitePlans.siteId, input.siteId),
            isNull(sitePlans.archivedAt),
          ),
        )
        .orderBy(asc(sitePlans.sortOrder), asc(sitePlans.createdAt));
    }),

  createPlan: tenantProcedure
    .use(requirePermission('sites.manage'))
    .input(createPlanInput)
    .mutation(async ({ ctx, input }) => {
      await assertSitesInTenant(ctx.db, ctx.tenantId, [input.siteId]);
      assertStorageKeyInTenant(ctx.tenantId, input.storageKey);

      // New plans go to the end of the level order.
      const existing = await ctx.db
        .select({ sortOrder: sitePlans.sortOrder })
        .from(sitePlans)
        .where(and(eq(sitePlans.tenantId, ctx.tenantId), eq(sitePlans.siteId, input.siteId)));
      const nextOrder = existing.reduce((max, r) => Math.max(max, r.sortOrder + 1), 0);

      const id = newId();
      await ctx.db.insert(sitePlans).values({
        id,
        tenantId: ctx.tenantId,
        siteId: input.siteId,
        name: input.name,
        storageKey: input.storageKey,
        mimeType: input.mimeType,
        kind: planKindForMime(input.mimeType),
        sortOrder: nextOrder,
        uploadedBy: ctx.auth.userId,
      });
      return { id };
    }),

  renamePlan: tenantProcedure
    .use(requirePermission('sites.manage'))
    .input(z.object({ id: z.string().length(26), name: z.string().min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      const res = await ctx.db
        .update(sitePlans)
        .set({ name: input.name })
        .where(and(eq(sitePlans.tenantId, ctx.tenantId), eq(sitePlans.id, input.id)))
        .returning({ id: sitePlans.id });
      if (res[0] === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      return { id: input.id };
    }),

  reorderPlan: tenantProcedure
    .use(requirePermission('sites.manage'))
    .input(z.object({ id: z.string().length(26), sortOrder: z.number().int().min(0).max(9999) }))
    .mutation(async ({ ctx, input }) => {
      const res = await ctx.db
        .update(sitePlans)
        .set({ sortOrder: input.sortOrder })
        .where(and(eq(sitePlans.tenantId, ctx.tenantId), eq(sitePlans.id, input.id)))
        .returning({ id: sitePlans.id });
      if (res[0] === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      return { id: input.id };
    }),

  archivePlan: tenantProcedure
    .use(requirePermission('sites.manage'))
    .input(z.object({ id: z.string().length(26) }))
    .mutation(async ({ ctx, input }) => {
      const res = await ctx.db
        .update(sitePlans)
        .set({ archivedAt: new Date() })
        .where(
          and(
            eq(sitePlans.tenantId, ctx.tenantId),
            eq(sitePlans.id, input.id),
            isNull(sitePlans.archivedAt),
          ),
        )
        .returning({ id: sitePlans.id });
      if (res[0] === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      return { id: input.id };
    }),

  // ── Pins ─────────────────────────────────────────────────────────────────
  listPins: tenantProcedure
    .use(requirePermission('sites.view'))
    .input(z.object({ planId: z.string().length(26) }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          id: sitePlanPins.id,
          planId: sitePlanPins.planId,
          x: sitePlanPins.x,
          y: sitePlanPins.y,
          entityType: sitePlanPins.entityType,
          entityId: sitePlanPins.entityId,
          label: sitePlanPins.label,
          createdAt: sitePlanPins.createdAt,
        })
        .from(sitePlanPins)
        .where(
          and(
            eq(sitePlanPins.tenantId, ctx.tenantId),
            eq(sitePlanPins.planId, input.planId),
            isNull(sitePlanPins.archivedAt),
          ),
        )
        .orderBy(asc(sitePlanPins.createdAt));
    }),

  createPin: tenantProcedure
    .use(requirePermission('sites.view'))
    .input(createPinInput)
    .mutation(async ({ ctx, input }) => {
      const planRows = await ctx.db
        .select({ siteId: sitePlans.siteId })
        .from(sitePlans)
        .where(and(eq(sitePlans.tenantId, ctx.tenantId), eq(sitePlans.id, input.planId)))
        .limit(1);
      const siteId = planRows[0]?.siteId;
      if (siteId === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      const id = newId();
      await ctx.db.insert(sitePlanPins).values({
        id,
        tenantId: ctx.tenantId,
        planId: input.planId,
        siteId,
        x: input.x,
        y: input.y,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        label: input.label ?? '',
        createdBy: ctx.auth.userId,
      });
      return { id };
    }),

  updatePin: tenantProcedure
    .use(requirePermission('sites.view'))
    .input(
      z.object({
        id: z.string().length(26),
        x: z.number().min(0).max(1).optional(),
        y: z.number().min(0).max(1).optional(),
        label: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const patch: { x?: number; y?: number; label?: string } = {};
      if (input.x !== undefined) patch.x = input.x;
      if (input.y !== undefined) patch.y = input.y;
      if (input.label !== undefined) patch.label = input.label;
      const res = await ctx.db
        .update(sitePlanPins)
        .set(patch)
        .where(and(eq(sitePlanPins.tenantId, ctx.tenantId), eq(sitePlanPins.id, input.id)))
        .returning({ id: sitePlanPins.id });
      if (res[0] === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      return { id: input.id };
    }),

  archivePin: tenantProcedure
    .use(requirePermission('sites.view'))
    .input(z.object({ id: z.string().length(26) }))
    .mutation(async ({ ctx, input }) => {
      const res = await ctx.db
        .update(sitePlanPins)
        .set({ archivedAt: new Date() })
        .where(
          and(
            eq(sitePlanPins.tenantId, ctx.tenantId),
            eq(sitePlanPins.id, input.id),
            isNull(sitePlanPins.archivedAt),
          ),
        )
        .returning({ id: sitePlanPins.id });
      if (res[0] === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      return { id: input.id };
    }),
});
