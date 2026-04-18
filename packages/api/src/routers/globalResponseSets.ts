/**
 * Global response sets router. Reusable multiple-choice option bundles
 * (Pass/Fail, Severity scales, ...).
 *
 * The live rows drive the template editor's "choose a response set"
 * picker. At publish time the editor snapshots the resolved set into
 * `template_versions.content.customResponseSets` — edits here do NOT
 * retroactively mutate published versions or in-progress inspections
 * (T-E17). That's the whole point of snapshotting.
 */
import { globalResponseSets } from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { TRPCError } from '@trpc/server';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission, tenantProcedure } from '../procedures';
import { router } from '../trpc';

const optionSchema = z.object({
  id: z.string().length(26),
  label: z.string().min(1).max(200),
  color: z.string().max(40).optional(),
  flagged: z.boolean().optional(),
});

const createInput = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  options: z.array(optionSchema).min(1).max(200),
  multiSelect: z.boolean().default(false),
});

const updateInput = z.object({
  id: z.string().length(26),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  options: z.array(optionSchema).min(1).max(200).optional(),
  multiSelect: z.boolean().optional(),
});

export const globalResponseSetsRouter = router({
  list: tenantProcedure
    .use(requirePermission('templates.responseSets.manage'))
    .query(async ({ ctx }) => {
      return ctx.db
        .select()
        .from(globalResponseSets)
        .where(
          and(eq(globalResponseSets.tenantId, ctx.tenantId), isNull(globalResponseSets.archivedAt)),
        )
        .orderBy(globalResponseSets.name);
    }),

  create: tenantProcedure
    .use(requirePermission('templates.responseSets.manage'))
    .input(createInput)
    .mutation(async ({ ctx, input }) => {
      const id = newId();
      await ctx.db.insert(globalResponseSets).values({
        id,
        tenantId: ctx.tenantId,
        name: input.name,
        description: input.description ?? null,
        options: input.options,
        multiSelect: input.multiSelect,
      });
      return { id };
    }),

  update: tenantProcedure
    .use(requirePermission('templates.responseSets.manage'))
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      const updates: Partial<typeof globalResponseSets.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (input.name !== undefined) updates.name = input.name;
      if (input.description !== undefined) updates.description = input.description;
      if (input.options !== undefined) updates.options = input.options;
      if (input.multiSelect !== undefined) updates.multiSelect = input.multiSelect;
      await ctx.db
        .update(globalResponseSets)
        .set(updates)
        .where(
          and(eq(globalResponseSets.tenantId, ctx.tenantId), eq(globalResponseSets.id, input.id)),
        );
      return { ok: true as const };
    }),

  archive: tenantProcedure
    .use(requirePermission('templates.responseSets.manage'))
    .input(z.object({ id: z.string().length(26) }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db
        .select()
        .from(globalResponseSets)
        .where(
          and(eq(globalResponseSets.tenantId, ctx.tenantId), eq(globalResponseSets.id, input.id)),
        )
        .limit(1);
      if (existing[0] === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      await ctx.db
        .update(globalResponseSets)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(globalResponseSets.id, input.id));
      return { ok: true as const };
    }),
});
