/**
 * Signatures router — Phase 2 PR 28.
 *
 * Lists slot metadata (from the pinned template version) for a conducting
 * user to render the sign page, and captures signatures.
 *
 *   - listSlots (view)   — pinned template's signature slots plus any rows
 *                          already filled.
 *   - sign (sign)        — atomic INSERT. The DB unique index
 *                          (inspection_id, slot_index) is T-E20's
 *                          double-sign guard — on violation we map to
 *                          CONFLICT.
 *
 * Slot-completion side effect: after a successful insert, if every slot
 * is filled the inspection advances. Approval-required templates move to
 * awaiting_approval; otherwise completed. Approval-required detection
 * follows the same rule as `inspections.submit` (presence of
 * settings.approvalPage).
 */
import { inspectionSignatures, inspections, templateVersions } from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission, tenantProcedure } from '../procedures';
import { router } from '../trpc';

const listSlotsInput = z.object({ inspectionId: z.string().length(26) });

const signInput = z.object({
  inspectionId: z.string().length(26),
  slotIndex: z.number().int().min(0).max(9),
  slotId: z.string().length(26),
  signatureData: z.string().min(1),
  signerName: z.string().min(1).max(200),
  signerRole: z.string().max(200).optional(),
});

/**
 * Detect a Postgres unique-violation-style error across both pg (production)
 * and pglite (tests). pglite surfaces a `.message` containing
 * "duplicate key" whereas node-postgres sets `.code = '23505'`. Drizzle
 * wraps the driver error so the useful info is on `.cause`.
 */
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

export const signaturesRouter = router({
  listSlots: tenantProcedure
    .use(requirePermission('inspections.view'))
    .input(listSlotsInput)
    .query(async ({ ctx, input }) => {
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

      const version = (
        await ctx.db
          .select()
          .from(templateVersions)
          .where(eq(templateVersions.id, insp.templateVersionId))
          .limit(1)
      )[0];
      if (version === undefined) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Pinned version missing' });
      }

      // Gather every signature item + its slot config.
      const slots: Array<{
        itemId: string;
        slotIndex: number;
        assigneeUserId: string | null;
        label?: string | undefined;
      }> = [];
      for (const page of version.content.pages) {
        for (const section of page.sections) {
          for (const item of section.items) {
            if (item.type !== 'signature') continue;
            for (const slot of item.slots) {
              slots.push({
                itemId: item.id,
                slotIndex: slot.slotIndex,
                assigneeUserId: slot.assigneeUserId,
                label: slot.label,
              });
            }
          }
        }
      }

      const existing = await ctx.db
        .select()
        .from(inspectionSignatures)
        .where(
          and(
            eq(inspectionSignatures.tenantId, ctx.tenantId),
            eq(inspectionSignatures.inspectionId, insp.id),
          ),
        );
      return { slots, signed: existing };
    }),

  sign: tenantProcedure
    .use(requirePermission('inspections.sign'))
    .input(signInput)
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
      if (insp.status !== 'awaiting_signatures' && insp.status !== 'in_progress') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot sign an inspection in status "${insp.status}"`,
        });
      }

      const version = (
        await ctx.db
          .select()
          .from(templateVersions)
          .where(eq(templateVersions.id, insp.templateVersionId))
          .limit(1)
      )[0];
      if (version === undefined) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Pinned version missing' });
      }

      // Verify the slot exists on the pinned version.
      const totalSlots: Array<{ itemId: string; slotIndex: number }> = [];
      let matched = false;
      for (const page of version.content.pages) {
        for (const section of page.sections) {
          for (const item of section.items) {
            if (item.type !== 'signature') continue;
            for (const slot of item.slots) {
              totalSlots.push({ itemId: item.id, slotIndex: slot.slotIndex });
              if (item.id === input.slotId && slot.slotIndex === input.slotIndex) {
                matched = true;
              }
            }
          }
        }
      }
      if (!matched) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Signature slot not found on pinned template version',
        });
      }

      // Atomic insert; rely on the unique index for T-E20.
      const now = new Date();
      const sigId = newId();
      try {
        await ctx.db.insert(inspectionSignatures).values({
          id: sigId,
          tenantId: ctx.tenantId,
          inspectionId: insp.id,
          slotIndex: input.slotIndex,
          slotId: input.slotId,
          signerUserId: ctx.auth.userId,
          signerName: input.signerName,
          signerRole: input.signerRole ?? null,
          signatureData: input.signatureData,
          signedAt: now,
          createdAt: now,
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'This signature slot has already been signed',
          });
        }
        throw err;
      }

      // Post-insert: if every slot is now filled, transition status.
      const filled = await ctx.db
        .select({ slotIndex: inspectionSignatures.slotIndex })
        .from(inspectionSignatures)
        .where(
          and(
            eq(inspectionSignatures.tenantId, ctx.tenantId),
            eq(inspectionSignatures.inspectionId, insp.id),
          ),
        );
      const hasApprovalPage = version.content.settings.approvalPage !== undefined;
      if (filled.length >= totalSlots.length) {
        const next = hasApprovalPage ? ('awaiting_approval' as const) : ('completed' as const);
        const patch: {
          status: 'awaiting_approval' | 'completed';
          updatedAt: Date;
          completedAt?: Date;
        } = { status: next, updatedAt: now };
        if (next === 'completed') patch.completedAt = now;
        await ctx.db.update(inspections).set(patch).where(eq(inspections.id, insp.id));
      }

      return { signatureId: sigId };
    }),
});
