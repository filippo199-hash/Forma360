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
import type { Database } from '@forma360/db/client';
import { inspectionApprovals, inspections, user } from '@forma360/db/schema';
import { appLink } from '@forma360/shared/app-link';
import { newId } from '@forma360/shared/id';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { notifyInApp } from '../notify';
import { requirePermission, tenantProcedure } from '../procedures';
import { router } from '../trpc';

/**
 * Side-channel deps (platform review PF-30): the approval gate used to
 * notify no one in either direction. Same pattern as the users/actions
 * routers — the web server wires the dispatcher once at boot.
 */
interface ApprovalsRouterDeps {
  sendEmail:
    | ((input: {
        to: string;
        locale?: string | undefined;
        templateKey: string;
        variables: Record<string, string>;
      }) => Promise<unknown>)
    | null;
  appUrl: string;
}
const approvalsDeps: ApprovalsRouterDeps = { sendEmail: null, appUrl: '' };

export function setApprovalsRouterDeps(deps: {
  sendEmail: ApprovalsRouterDeps['sendEmail'];
  appUrl: string;
}): void {
  approvalsDeps.sendEmail = deps.sendEmail;
  approvalsDeps.appUrl = deps.appUrl;
}

/** Best-effort decision email to the inspection's submitter (PF-30). */
async function notifyDecision(
  db: Database,
  logger: { warn: (obj: Record<string, unknown>, msg: string) => void },
  input: {
    tenantId: string;
    inspectionId: string;
    inspectionTitle: string;
    documentNumber: string | null;
    submitterUserId: string;
    approverUserId: string;
    decision: 'approved' | 'rejected';
    comment: string | null;
  },
): Promise<void> {
  const sendEmail = approvalsDeps.sendEmail;
  if (sendEmail === null || input.submitterUserId === input.approverUserId) return;
  try {
    const rows = await db
      .select({
        name: user.name,
        email: user.email,
        locale: user.locale,
        deactivatedAt: user.deactivatedAt,
      })
      .from(user)
      .where(and(eq(user.tenantId, input.tenantId), eq(user.id, input.submitterUserId)))
      .limit(1);
    const submitter = rows[0];
    if (
      submitter === undefined ||
      submitter.deactivatedAt !== null ||
      submitter.email.length === 0
    ) {
      return;
    }
    // PF-23: the in-app bell mirrors the email.
    await notifyInApp(db, {
      tenantId: input.tenantId,
      userId: input.submitterUserId,
      kind: 'approval_decided',
      title: input.inspectionTitle,
      body: input.decision,
      href: `/inspections/${input.inspectionId}/status`,
    });
    const approverRows = await db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, input.approverUserId))
      .limit(1);
    await sendEmail({
      to: submitter.email,
      locale: submitter.locale ?? undefined,
      templateKey: 'inspection-approval-decided',
      variables: {
        recipientName: submitter.name,
        approverName: approverRows[0]?.name ?? 'An approver',
        title: input.inspectionTitle,
        documentNumber: input.documentNumber ?? '',
        decisionLine:
          input.decision === 'approved' ? 'APPROVED it' : `REJECTED it back to you for changes`,
        commentLine:
          input.comment !== null && input.comment.length > 0 ? `\n\nComment: ${input.comment}` : '',
        viewUrl: appLink(
          approvalsDeps.appUrl,
          submitter.locale,
          `/inspections/${input.inspectionId}/status`,
        ),
      },
    });
  } catch (err) {
    logger.warn(
      { inspectionId: input.inspectionId, err: err instanceof Error ? err.message : String(err) },
      '[approvals] decision email failed',
    );
  }
}

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
      // PF-30: separation of duties — the person who conducted or created
      // the inspection cannot approve their own work.
      if (ctx.auth.userId === insp.createdBy || ctx.auth.userId === insp.conductedBy) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'self-approval' });
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
      await notifyDecision(ctx.db, ctx.logger, {
        tenantId: ctx.tenantId,
        inspectionId: insp.id,
        inspectionTitle: insp.title,
        documentNumber: insp.documentNumber,
        submitterUserId: insp.conductedBy ?? insp.createdBy,
        approverUserId: ctx.auth.userId,
        decision: 'approved',
        comment: input.comment ?? null,
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
      await notifyDecision(ctx.db, ctx.logger, {
        tenantId: ctx.tenantId,
        inspectionId: insp.id,
        inspectionTitle: insp.title,
        documentNumber: insp.documentNumber,
        submitterUserId: insp.conductedBy ?? insp.createdBy,
        approverUserId: ctx.auth.userId,
        decision: 'rejected',
        comment: input.comment,
      });
      return { ok: true as const };
    }),
});
