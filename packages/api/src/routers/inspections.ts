/**
 * Inspections router — Phase 2 PR 28.
 *
 * The conduct-side surface. An inspection:
 *   1. Starts — pins the currently-published template version (T-E04),
 *      snapshots the caller's access state (ADR 0007), stamps the
 *      template's monotonic document-number counter and renders the
 *      initial title + document number.
 *   2. Progresses — autosave via `saveProgress` (optimistic concurrency
 *      via expectedUpdatedAt, T-E18 style).
 *   3. Submits — `submit` transitions to awaiting_signatures /
 *      awaiting_approval / completed depending on what the pinned
 *      version requires.
 *   4. Ends — via approvals router or an explicit `reject`.
 *
 * ADR 0007 snapshot columns are populated in `create`; the ADR 0007 read
 * path (gating in-flight actions on the snapshot) lives in Phase 2.2 and
 * later modules. Phase 2 PR 28 just lays the foundation.
 *
 * Also registers dependents resolvers:
 *   - 'inspections' — counts actions referencing this inspection.
 *   - 'templates' — REPLACES the shim registered by the templates router
 *     with a real resolver that counts inspections referencing any
 *     version of the template.
 */
import {
  actions,
  accessRules,
  groupMembers,
  inspectionApprovals,
  inspectionSignatures,
  inspections,
  permissionSets,
  siteMembers,
  templateVersions,
  templates,
  user,
  type AccessSnapshot,
} from '@forma360/db/schema';
import { resolveAccessRule } from '@forma360/permissions/access';
import { isPermissionKey } from '@forma360/permissions/catalogue';
import {
  registerDependentResolver,
  type DependentResolver,
} from '@forma360/permissions/dependents';
import { newId } from '@forma360/shared/id';
import { TRPCError } from '@trpc/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission, tenantProcedure } from '../procedures';
import { router } from '../trpc';

// ─── Title / documentNumber rendering ──────────────────────────────────────

interface TitleRenderContext {
  date: Date;
  site?: string | undefined;
  conductedBy?: string | undefined;
  documentNumber?: string | undefined;
}

/**
 * Render a template's titleFormat into a concrete title. Supported tokens:
 *   {date}         — ISO date (YYYY-MM-DD)
 *   {site}         — the site id (placeholder; later phases render name)
 *   {conductedBy}  — the user id (placeholder)
 *   {docNumber}    — the rendered document number, if already stamped
 *
 * Unknown tokens are left literal so an admin sees them in the rendered
 * title and knows to fix the format. Truncated to 250 chars per T-E09.
 */
export function renderTitle(format: string, ctx: TitleRenderContext): string {
  const iso = ctx.date.toISOString().slice(0, 10);
  const replaced = format
    .replaceAll('{date}', iso)
    .replaceAll('{site}', ctx.site ?? '')
    .replaceAll('{conductedBy}', ctx.conductedBy ?? '')
    .replaceAll('{docNumber}', ctx.documentNumber ?? '');
  return replaced.slice(0, 250);
}

/**
 * Render a template's documentNumberFormat. The only required token is
 * {counter:N} which zero-pads the monotonic counter to N digits.
 */
export function renderDocumentNumber(format: string, counter: number): string {
  return format.replace(/\{counter:(\d+)\}/g, (_m, digitsStr: string) => {
    const digits = Number.parseInt(digitsStr, 10);
    return counter.toString().padStart(digits, '0');
  });
}

// ─── Dependents resolvers ───────────────────────────────────────────────────

const inspectionsResolver: DependentResolver = async (deps, input) => {
  if (input.entity !== 'inspection') return 0;
  const rows = await deps.db
    .select({ id: actions.id })
    .from(actions)
    .where(
      and(
        eq(actions.tenantId, input.tenantId),
        eq(actions.sourceType, 'inspection'),
        eq(actions.sourceId, input.id),
      ),
    );
  return rows.length;
};
registerDependentResolver('inspections', inspectionsResolver);

// Replace the PR 26 templates shim with a real resolver now that we can
// count inspections referencing a template.
const templatesResolverReal: DependentResolver = async (deps, input) => {
  if (input.entity !== 'template') return 0;
  const rows = await deps.db
    .select({ id: inspections.id })
    .from(inspections)
    .where(and(eq(inspections.tenantId, input.tenantId), eq(inspections.templateId, input.id)));
  return rows.length;
};
registerDependentResolver('templates', templatesResolverReal);

// ─── Input schemas ──────────────────────────────────────────────────────────

const listInput = z
  .object({
    status: z
      .enum(['in_progress', 'awaiting_signatures', 'awaiting_approval', 'completed', 'rejected'])
      .optional(),
    templateId: z.string().length(26).optional(),
    includeArchived: z.boolean().default(false),
  })
  .default({});

const getInput = z.object({ inspectionId: z.string().length(26) });

const createInput = z.object({
  templateId: z.string().length(26),
  siteId: z.string().length(26).optional(),
});

const saveProgressInput = z.object({
  inspectionId: z.string().length(26),
  responses: z.record(z.unknown()),
  expectedUpdatedAt: z.string().datetime().optional(),
});

const submitInput = z.object({ inspectionId: z.string().length(26) });

const rejectInput = z.object({
  inspectionId: z.string().length(26),
  reason: z.string().min(1).max(2000),
});

const deleteInput = z.object({ inspectionId: z.string().length(26) });

// ─── Helpers ────────────────────────────────────────────────────────────────

async function loadAccessSnapshot(
  db: Parameters<DependentResolver>[0]['db'],
  tenantId: string,
  userId: string,
): Promise<AccessSnapshot> {
  const groupRows = await db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(and(eq(groupMembers.tenantId, tenantId), eq(groupMembers.userId, userId)));
  const siteRows = await db
    .select({ siteId: siteMembers.siteId })
    .from(siteMembers)
    .where(and(eq(siteMembers.tenantId, tenantId), eq(siteMembers.userId, userId)));
  const permRows = await db
    .select({ permissions: permissionSets.permissions })
    .from(user)
    .innerJoin(permissionSets, eq(user.permissionSetId, permissionSets.id))
    .where(and(eq(user.id, userId), eq(user.tenantId, tenantId)))
    .limit(1);
  const perms = permRows[0]?.permissions.filter((p): p is string => isPermissionKey(p)) ?? [];
  return {
    groups: groupRows.map((r) => r.groupId),
    sites: siteRows.map((r) => r.siteId),
    permissions: perms,
    snapshotAt: new Date().toISOString(),
  };
}

// ─── Router ─────────────────────────────────────────────────────────────────

export const inspectionsRouter = router({
  list: tenantProcedure
    .use(requirePermission('inspections.view'))
    .input(listInput)
    .query(async ({ ctx, input }) => {
      const where = [eq(inspections.tenantId, ctx.tenantId)];
      if (input.status !== undefined) where.push(eq(inspections.status, input.status));
      if (input.templateId !== undefined) where.push(eq(inspections.templateId, input.templateId));
      return ctx.db
        .select({
          id: inspections.id,
          templateId: inspections.templateId,
          templateVersionId: inspections.templateVersionId,
          status: inspections.status,
          title: inspections.title,
          documentNumber: inspections.documentNumber,
          siteId: inspections.siteId,
          score: inspections.score,
          startedAt: inspections.startedAt,
          submittedAt: inspections.submittedAt,
          completedAt: inspections.completedAt,
          createdBy: inspections.createdBy,
          updatedAt: inspections.updatedAt,
        })
        .from(inspections)
        .where(and(...where))
        .orderBy(desc(inspections.startedAt));
    }),

  get: tenantProcedure
    .use(requirePermission('inspections.view'))
    .input(getInput)
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(inspections)
        .where(and(eq(inspections.tenantId, ctx.tenantId), eq(inspections.id, input.inspectionId)))
        .limit(1);
      const insp = rows[0];
      if (insp === undefined) throw new TRPCError({ code: 'NOT_FOUND' });

      const versionRows = await ctx.db
        .select()
        .from(templateVersions)
        .where(eq(templateVersions.id, insp.templateVersionId))
        .limit(1);
      const version = versionRows[0];
      if (version === undefined) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Pinned version missing' });
      }

      const sigs = await ctx.db
        .select()
        .from(inspectionSignatures)
        .where(
          and(
            eq(inspectionSignatures.tenantId, ctx.tenantId),
            eq(inspectionSignatures.inspectionId, insp.id),
          ),
        )
        .orderBy(inspectionSignatures.slotIndex);

      const approvalRows = await ctx.db
        .select()
        .from(inspectionApprovals)
        .where(
          and(
            eq(inspectionApprovals.tenantId, ctx.tenantId),
            eq(inspectionApprovals.inspectionId, insp.id),
          ),
        )
        .orderBy(inspectionApprovals.decidedAt);

      return { inspection: insp, version, signatures: sigs, approvals: approvalRows };
    }),

  create: tenantProcedure
    .use(requirePermission('inspections.conduct'))
    .input(createInput)
    .mutation(async ({ ctx, input }) => {
      // 1. Look up template — must exist, not be archived, be in current tenant.
      const tplRows = await ctx.db
        .select()
        .from(templates)
        .where(and(eq(templates.tenantId, ctx.tenantId), eq(templates.id, input.templateId)))
        .limit(1);
      const tpl = tplRows[0];
      if (tpl === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      if (tpl.archivedAt !== null) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot start an inspection on an archived template',
        });
      }

      // 2. Access-rule gate. If the template has a rule, the caller must satisfy it.
      if (tpl.accessRuleId !== null) {
        const ruleRows = await ctx.db
          .select()
          .from(accessRules)
          .where(and(eq(accessRules.tenantId, ctx.tenantId), eq(accessRules.id, tpl.accessRuleId)))
          .limit(1);
        const rule = ruleRows[0];
        if (rule === undefined) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Template references a missing access rule',
          });
        }
        // Load the caller's groups + sites for the rule check.
        const groupRows = await ctx.db
          .select({ groupId: groupMembers.groupId })
          .from(groupMembers)
          .where(
            and(eq(groupMembers.tenantId, ctx.tenantId), eq(groupMembers.userId, ctx.auth.userId)),
          );
        const siteRows = await ctx.db
          .select({ siteId: siteMembers.siteId })
          .from(siteMembers)
          .where(
            and(eq(siteMembers.tenantId, ctx.tenantId), eq(siteMembers.userId, ctx.auth.userId)),
          );
        const allowed = resolveAccessRule(
          {
            id: rule.id,
            groupIds: rule.groupIds,
            siteIds: rule.siteIds,
            invalidatedAt: rule.invalidatedAt,
          },
          {
            groupIds: groupRows.map((r) => r.groupId),
            siteIds: siteRows.map((r) => r.siteId),
          },
        );
        if (!allowed) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You do not satisfy this template\u2019s access rule',
          });
        }
      }

      // 3. Find the currently-published version. No published → can't conduct.
      const currentVersionId = tpl.currentVersionId;
      if (currentVersionId === null) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Template has no published version',
        });
      }
      const versionRows = await ctx.db
        .select()
        .from(templateVersions)
        .where(eq(templateVersions.id, currentVersionId))
        .limit(1);
      const version = versionRows[0];
      if (version === undefined) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Current template version missing',
        });
      }

      // 4. Build the access snapshot (ADR 0007).
      const accessSnapshot = await loadAccessSnapshot(ctx.db, ctx.tenantId, ctx.auth.userId);

      // 5. Increment document-number counter + render title / doc number.
      const inspectionId = newId();
      const now = new Date();
      const settings = version.content.settings;

      const inserted = await ctx.db.transaction(async (tx) => {
        const counterRows = await tx
          .update(templates)
          .set({
            documentNumberCounter: tpl.documentNumberCounter + 1,
            updatedAt: now,
          })
          .where(eq(templates.id, tpl.id))
          .returning({ counter: templates.documentNumberCounter });
        const counter = counterRows[0]?.counter ?? tpl.documentNumberCounter + 1;
        const documentNumber = renderDocumentNumber(settings.documentNumberFormat, counter);
        const title = renderTitle(tpl.titleFormat, {
          date: now,
          site: input.siteId,
          conductedBy: ctx.auth.userId,
          documentNumber,
        });

        await tx.insert(inspections).values({
          id: inspectionId,
          tenantId: ctx.tenantId,
          templateId: tpl.id,
          templateVersionId: version.id,
          status: 'in_progress',
          title,
          documentNumber,
          conductedBy: ctx.auth.userId,
          siteId: input.siteId ?? null,
          responses: {},
          score: null,
          accessSnapshot,
          startedAt: now,
          createdBy: ctx.auth.userId,
          createdAt: now,
          updatedAt: now,
        });
        return { inspectionId, title, documentNumber };
      });

      ctx.logger.info(
        { inspectionId: inserted.inspectionId, templateId: tpl.id },
        '[inspections] created',
      );
      return { inspectionId: inserted.inspectionId };
    }),

  saveProgress: tenantProcedure
    .use(requirePermission('inspections.conduct'))
    .input(saveProgressInput)
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(inspections)
        .where(and(eq(inspections.tenantId, ctx.tenantId), eq(inspections.id, input.inspectionId)))
        .limit(1);
      const insp = rows[0];
      if (insp === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      if (insp.status !== 'in_progress') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only in-progress inspections can be updated',
        });
      }
      if (input.expectedUpdatedAt !== undefined) {
        const expected = new Date(input.expectedUpdatedAt).getTime();
        const current = insp.updatedAt.getTime();
        if (current !== expected) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Inspection was modified elsewhere. Refresh before saving.',
            cause: {
              code: 'CONFLICT',
              serverUpdatedAt: insp.updatedAt.toISOString(),
            },
          });
        }
      }
      const now = new Date();
      await ctx.db
        .update(inspections)
        .set({ responses: input.responses, updatedAt: now })
        .where(eq(inspections.id, insp.id));
      return { updatedAt: now.toISOString() };
    }),

  submit: tenantProcedure
    .use(requirePermission('inspections.conduct'))
    .input(submitInput)
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(inspections)
        .where(and(eq(inspections.tenantId, ctx.tenantId), eq(inspections.id, input.inspectionId)))
        .limit(1);
      const insp = rows[0];
      if (insp === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      if (insp.status !== 'in_progress') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only in-progress inspections can be submitted',
        });
      }

      // Introspect the pinned version to decide the next status.
      const versionRows = await ctx.db
        .select()
        .from(templateVersions)
        .where(eq(templateVersions.id, insp.templateVersionId))
        .limit(1);
      const version = versionRows[0];
      if (version === undefined) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Pinned version missing' });
      }
      const hasSignatureSlots = version.content.pages.some((p) =>
        p.sections.some((s) => s.items.some((i) => i.type === 'signature')),
      );
      const hasApprovalPage = version.content.settings.approvalPage !== undefined;

      const now = new Date();
      const nextStatus = hasSignatureSlots
        ? ('awaiting_signatures' as const)
        : hasApprovalPage
          ? ('awaiting_approval' as const)
          : ('completed' as const);

      await ctx.db
        .update(inspections)
        .set({
          status: nextStatus,
          submittedAt: now,
          completedAt: nextStatus === 'completed' ? now : null,
          updatedAt: now,
        })
        .where(eq(inspections.id, insp.id));
      return { status: nextStatus };
    }),

  reject: tenantProcedure
    .use(requirePermission('inspections.manage'))
    .input(rejectInput)
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const result = await ctx.db
        .update(inspections)
        .set({
          status: 'rejected',
          rejectedAt: now,
          rejectedReason: input.reason,
          updatedAt: now,
        })
        .where(and(eq(inspections.tenantId, ctx.tenantId), eq(inspections.id, input.inspectionId)))
        .returning({ id: inspections.id });
      if (result.length === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { ok: true as const };
    }),

  delete: tenantProcedure
    .use(requirePermission('inspections.manage'))
    .input(deleteInput)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db
        .delete(inspections)
        .where(and(eq(inspections.tenantId, ctx.tenantId), eq(inspections.id, input.inspectionId)))
        .returning({ id: inspections.id });
      if (result.length === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { ok: true as const };
    }),
});
