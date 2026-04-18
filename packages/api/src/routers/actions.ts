/**
 * Actions router — Phase 2 PR 28 stub.
 *
 * The full Actions module (Phase 4) will replace this. Phase 2 PR 28 ships
 * the minimum surface needed for:
 *
 *   - createFromInspectionQuestion — idempotent creation of an Action when
 *     an inspection question fires a trigger. Dedup via the
 *     (sourceType, sourceId, sourceItemId) unique index — a duplicate call
 *     no-ops and returns the existing row's id.
 *   - list — used by the dependents resolver + simple admin listing.
 */
import { actions } from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission, tenantProcedure } from '../procedures';
import { router } from '../trpc';

const createInput = z.object({
  inspectionId: z.string().length(26),
  sourceItemId: z.string().min(1).max(200),
  title: z.string().min(1).max(500),
  description: z.string().max(20_000).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  assigneeUserId: z.string().optional(),
  dueAt: z.string().datetime().optional(),
});

const listInput = z
  .object({
    sourceType: z.enum(['inspection']).optional(),
    sourceId: z.string().length(26).optional(),
  })
  .default({});

function isUniqueViolation(err: unknown): boolean {
  const visit = (e: unknown): boolean => {
    if (typeof e !== 'object' || e === null) return false;
    const record = e as Record<string, unknown>;
    if (record.code === '23505') return true;
    const message = typeof record.message === 'string' ? record.message : '';
    if (/duplicate key|unique constraint|unique violation|UNIQUE/i.test(message)) return true;
    if ('cause' in record) return visit(record.cause);
    return false;
  };
  return visit(err);
}

export const actionsRouter = router({
  createFromInspectionQuestion: tenantProcedure
    .use(requirePermission('actions.create'))
    .input(createInput)
    .mutation(async ({ ctx, input }) => {
      // Dedup: look up first, INSERT on miss, catch unique violation race.
      const existing = await ctx.db
        .select({ id: actions.id })
        .from(actions)
        .where(
          and(
            eq(actions.tenantId, ctx.tenantId),
            eq(actions.sourceType, 'inspection'),
            eq(actions.sourceId, input.inspectionId),
            eq(actions.sourceItemId, input.sourceItemId),
          ),
        )
        .limit(1);
      if (existing[0] !== undefined) {
        return { actionId: existing[0].id, created: false as const };
      }

      const id = newId();
      const now = new Date();
      try {
        await ctx.db.insert(actions).values({
          id,
          tenantId: ctx.tenantId,
          sourceType: 'inspection',
          sourceId: input.inspectionId,
          sourceItemId: input.sourceItemId,
          title: input.title,
          description: input.description ?? null,
          status: 'open',
          priority: input.priority ?? null,
          assigneeUserId: input.assigneeUserId ?? null,
          dueAt: input.dueAt !== undefined ? new Date(input.dueAt) : null,
          createdBy: ctx.auth.userId,
          createdAt: now,
          updatedAt: now,
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        // Another caller won the race — fetch + return their row.
        const race = await ctx.db
          .select({ id: actions.id })
          .from(actions)
          .where(
            and(
              eq(actions.tenantId, ctx.tenantId),
              eq(actions.sourceType, 'inspection'),
              eq(actions.sourceId, input.inspectionId),
              eq(actions.sourceItemId, input.sourceItemId),
            ),
          )
          .limit(1);
        if (race[0] === undefined) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Unique violation without a matching row',
          });
        }
        return { actionId: race[0].id, created: false as const };
      }
      return { actionId: id, created: true as const };
    }),

  list: tenantProcedure
    .use(requirePermission('actions.view'))
    .input(listInput)
    .query(async ({ ctx, input }) => {
      const where = [eq(actions.tenantId, ctx.tenantId)];
      if (input.sourceType !== undefined) where.push(eq(actions.sourceType, input.sourceType));
      if (input.sourceId !== undefined) where.push(eq(actions.sourceId, input.sourceId));
      return ctx.db
        .select()
        .from(actions)
        .where(and(...where));
    }),
});
