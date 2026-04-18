/**
 * Approvals router — Phase 2 PR 28.
 *
 *   - approve (manage) — INSERT an approval with decision='approved',
 *     set inspection.status='completed' + stamp completedAt.
 *   - reject (manage)  — INSERT an approval with decision='rejected',
 *     set inspection.status='rejected' + stamp rejectedAt/rejectedReason.
 *
 * Only legal from inspection status 'awaiting_approval'.
 */
import { inspectionApprovals, inspections } from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission, tenantProcedure } from '../procedures';
import { router } from '../trpc';

const approveInput = z.object({
  inspectionId: z.string().length(26),
  comment: z.string().max(2000).optional(),
});

const rejectInput = z.object({
  inspectionId: z.string().length(26),
  comment: z.string().min(1).max(2000),
});

export const approvalsRouter = router({
  approve: tenantProcedure
    .use(requirePermission('inspections.manage'))
    .input(approveInput)
    .mutation(async ({ ctx, input }) => {
      const insp = (
        await ctx.db
          .select()
          .from(inspections)
          .where(
            and(eq(inspections.tenantId, ctx.tenantId), eq(inspections.id, input.inspectionId)),
          )
          .limit(1)
      )[0];
      if (insp === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      if (insp.status !== 'awaiting_approval') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot approve an inspection in status "${insp.status}"`,
        });
      }
      const now = new Date();
      await ctx.db.transaction(async (tx) => {
        await tx.insert(inspectionApprovals).values({
          id: newId(),
          tenantId: ctx.tenantId,
          inspectionId: insp.id,
          approverUserId: ctx.auth.userId,
          decision: 'approved',
          comment: input.comment ?? null,
          decidedAt: now,
          createdAt: now,
        });
        await tx
          .update(inspections)
          .set({ status: 'completed', completedAt: now, updatedAt: now })
          .where(eq(inspections.id, insp.id));
      });
      return { ok: true as const };
    }),

  reject: tenantProcedure
    .use(requirePermission('inspections.manage'))
    .input(rejectInput)
    .mutation(async ({ ctx, input }) => {
      const insp = (
        await ctx.db
          .select()
          .from(inspections)
          .where(
            and(eq(inspections.tenantId, ctx.tenantId), eq(inspections.id, input.inspectionId)),
          )
          .limit(1)
      )[0];
      if (insp === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      if (insp.status !== 'awaiting_approval') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot reject an inspection in status "${insp.status}"`,
        });
      }
      const now = new Date();
      await ctx.db.transaction(async (tx) => {
        await tx.insert(inspectionApprovals).values({
          id: newId(),
          tenantId: ctx.tenantId,
          inspectionId: insp.id,
          approverUserId: ctx.auth.userId,
          decision: 'rejected',
          comment: input.comment,
          decidedAt: now,
          createdAt: now,
        });
        await tx
          .update(inspections)
          .set({
            status: 'rejected',
            rejectedAt: now,
            rejectedReason: input.comment,
            updatedAt: now,
          })
          .where(eq(inspections.id, insp.id));
      });
      return { ok: true as const };
    }),
});
