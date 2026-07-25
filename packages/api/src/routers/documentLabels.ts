/**
 * Document Labels router — Phase 5D.
 *
 * Tenant-scoped label catalogue used to tag documents and policies.
 * Labels have a name and a hex colour. Names are unique per tenant.
 */
import { documentLabels, documents } from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { TRPCError } from '@trpc/server';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission, tenantProcedure } from '../procedures';
import { router } from '../trpc';

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

const createInput = z.object({
  name: z.string().min(1).max(100),
  color: z.string().regex(HEX_COLOR, 'color must be a hex colour like #6366f1').default('#6366f1'),
});

const updateInput = z.object({
  labelId: z.string().length(26),
  name: z.string().min(1).max(100).optional(),
  color: z.string().regex(HEX_COLOR, 'color must be a hex colour like #6366f1').optional(),
});

const labelIdInput = z.object({ labelId: z.string().length(26) });

export const documentLabelsRouter = router({
  list: tenantProcedure.use(requirePermission('documents.view')).query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: documentLabels.id,
        name: documentLabels.name,
        color: documentLabels.color,
        createdAt: documentLabels.createdAt,
      })
      .from(documentLabels)
      .where(eq(documentLabels.tenantId, ctx.tenantId))
      .orderBy(asc(documentLabels.name));
  }),

  create: tenantProcedure
    .use(requirePermission('documents.manage'))
    .input(createInput)
    .mutation(async ({ ctx, input }) => {
      const id = newId();
      try {
        await ctx.db.insert(documentLabels).values({
          id,
          tenantId: ctx.tenantId,
          name: input.name,
          color: input.color,
          createdByUserId: ctx.auth.userId,
          createdAt: new Date(),
        });
      } catch {
        throw new TRPCError({ code: 'CONFLICT', message: 'label-name-already-exists' });
      }
      return { labelId: id };
    }),

  update: tenantProcedure
    .use(requirePermission('documents.manage'))
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(documentLabels)
        .where(and(eq(documentLabels.tenantId, ctx.tenantId), eq(documentLabels.id, input.labelId)))
        .limit(1);
      if (rows[0] === undefined) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'label-not-found' });
      }

      const updates: Partial<typeof documentLabels.$inferInsert> = {};
      if (input.name !== undefined) updates.name = input.name;
      if (input.color !== undefined) updates.color = input.color;

      if (Object.keys(updates).length > 0) {
        try {
          await ctx.db
            .update(documentLabels)
            .set(updates)
            .where(eq(documentLabels.id, input.labelId));
        } catch {
          throw new TRPCError({ code: 'CONFLICT', message: 'label-name-already-exists' });
        }
      }
      return { ok: true as const };
    }),

  delete: tenantProcedure
    .use(requirePermission('documents.manage'))
    .input(labelIdInput)
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction(async (tx) => {
        await tx
          .delete(documentLabels)
          .where(
            and(eq(documentLabels.tenantId, ctx.tenantId), eq(documentLabels.id, input.labelId)),
          );
        // Prune the deleted label id from every document's labelIds array —
        // there is no FK on the jsonb array, so a bare delete would leave a
        // dangling id that renders as a blank chip. Rebuild each array without
        // the removed id (only touching documents that actually reference it).
        await tx
          .update(documents)
          .set({
            labelIds: sql`COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements(${documents.labelIds}) x WHERE x <> ${JSON.stringify(input.labelId)}::jsonb), '[]'::jsonb)`,
          })
          .where(
            and(
              eq(documents.tenantId, ctx.tenantId),
              sql`${documents.labelIds} @> ${JSON.stringify([input.labelId])}::jsonb`,
            ),
          );
      });
      return { ok: true as const };
    }),
});
