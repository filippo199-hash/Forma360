/**
 * Asset Types router — Phase 5B.
 *
 * Admin-managed taxonomy for the asset register.
 * AS-E12: can't archive/delete a type that still has active (non-archived) assets.
 */
import { assetTypes, assets } from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { TRPCError } from '@trpc/server';
import { and, count, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission, tenantProcedure } from '../procedures';
import { router } from '../trpc';

const typeIdInput = z.object({ typeId: z.string().length(26) });

const customFieldSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  fieldType: z.enum(['text', 'number', 'date', 'select']),
  options: z.array(z.string().max(200)).optional(),
  required: z.boolean().optional(),
});

const createInput = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).default(''),
  customFields: z.array(customFieldSchema).default([]),
});

const updateInput = z.object({
  typeId: z.string().length(26),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  customFields: z.array(customFieldSchema).optional(),
});

export const assetTypesRouter = router({
  list: tenantProcedure
    .use(requirePermission('assets.view'))
    .input(
      z.object({ includeArchived: z.boolean().default(false) }).default({ includeArchived: false }),
    )
    .query(async ({ ctx, input }) => {
      const where = [eq(assetTypes.tenantId, ctx.tenantId)];
      if (!input.includeArchived) where.push(isNull(assetTypes.archivedAt));
      return ctx.db
        .select()
        .from(assetTypes)
        .where(and(...where))
        .orderBy(assetTypes.name);
    }),

  get: tenantProcedure
    .use(requirePermission('assets.view'))
    .input(typeIdInput)
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(assetTypes)
        .where(and(eq(assetTypes.tenantId, ctx.tenantId), eq(assetTypes.id, input.typeId)))
        .limit(1);
      const row = rows[0];
      if (row === undefined) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'asset-type-not-found' });
      }
      return row;
    }),

  create: tenantProcedure
    .use(requirePermission('assets.manage'))
    .input(createInput)
    .mutation(async ({ ctx, input }) => {
      const id = newId();
      const now = new Date();
      await ctx.db.insert(assetTypes).values({
        id,
        tenantId: ctx.tenantId,
        name: input.name,
        description: input.description,
        customFields: input.customFields,
        createdAt: now,
        updatedAt: now,
      });
      return { typeId: id };
    }),

  update: tenantProcedure
    .use(requirePermission('assets.manage'))
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(assetTypes)
        .where(and(eq(assetTypes.tenantId, ctx.tenantId), eq(assetTypes.id, input.typeId)))
        .limit(1);
      const row = rows[0];
      if (row === undefined) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'asset-type-not-found' });
      }
      if (row.archivedAt !== null) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'asset-type-archived' });
      }
      const updates: Partial<typeof assetTypes.$inferInsert> = { updatedAt: new Date() };
      if (input.name !== undefined) updates.name = input.name;
      if (input.description !== undefined) updates.description = input.description;
      if (input.customFields !== undefined) updates.customFields = input.customFields;
      await ctx.db.update(assetTypes).set(updates).where(eq(assetTypes.id, row.id));
      return { ok: true as const };
    }),

  /** AS-E12: refuse when active assets reference this type. */
  archive: tenantProcedure
    .use(requirePermission('assets.manage'))
    .input(typeIdInput)
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(assetTypes)
        .where(and(eq(assetTypes.tenantId, ctx.tenantId), eq(assetTypes.id, input.typeId)))
        .limit(1);
      const row = rows[0];
      if (row === undefined) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'asset-type-not-found' });
      }
      if (row.archivedAt !== null) return { ok: true as const };

      // AS-E12: refuse if active assets use this type.
      const activeAssets = await ctx.db
        .select({ c: count() })
        .from(assets)
        .where(
          and(
            eq(assets.tenantId, ctx.tenantId),
            eq(assets.typeId, input.typeId),
            isNull(assets.archivedAt),
          ),
        );
      const activeCount = Number(activeAssets[0]?.c ?? 0);
      if (activeCount > 0) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `asset-type-has-active-assets:${activeCount}`,
        });
      }

      await ctx.db
        .update(assetTypes)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(assetTypes.id, row.id));
      return { ok: true as const };
    }),
});
