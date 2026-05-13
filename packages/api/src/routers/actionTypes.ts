/**
 * Action types (categories) router — Phase 4b.
 *
 * SafetyCulture parity: admins can carve up the Actions module into
 * tenant-defined types ("Corrective Action", "Maintenance",
 * "Work Order", …) with per-type custom questions, required-field
 * overrides, visibility rules, and gated-status transition rules.
 *
 * The CRUD surface is intentionally compact: list / get / create /
 * update / archive / restore / setDefault. The tenant-level settings
 * (priority → due-date-days) live on a separate `settings.get` /
 * `settings.update` pair on this router to keep them adjacent in the
 * UI namespace.
 */
import { actionTypes, actions, tenantActionSettings, user } from '@forma360/db/schema';
import {
  ACTION_REQUIRED_FIELDS,
  ACTION_VISIBILITY_RULES,
  actionCustomQuestionsSchema,
  actionRequiredFieldsSchema,
  actionVisibilityRuleSchema,
  priorityDueDateDaysSchema,
  transitionRulesSchema,
} from '@forma360/shared/actions-schema';
import { newId } from '@forma360/shared/id';
import { TRPCError } from '@trpc/server';
import { and, count, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission, tenantProcedure } from '../procedures';
import { router } from '../trpc';

const typeIdInput = z.object({ typeId: z.string().length(26) });

const createInput = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2_000).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a #RRGGBB hex string')
    .optional(),
  icon: z.string().max(80).optional(),
  customQuestions: actionCustomQuestionsSchema.default([]),
  requiredFields: actionRequiredFieldsSchema.default([]),
  visibility: actionVisibilityRuleSchema.default('all_users'),
  transitionRules: transitionRulesSchema.optional(),
});

const updateInput = z.object({
  typeId: z.string().length(26),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2_000).nullable().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
  icon: z.string().max(80).nullable().optional(),
  customQuestions: actionCustomQuestionsSchema.optional(),
  requiredFields: actionRequiredFieldsSchema.optional(),
  visibility: actionVisibilityRuleSchema.optional(),
  transitionRules: transitionRulesSchema.optional(),
});

const settingsUpdateInput = z.object({
  priorityDueDateDays: priorityDueDateDaysSchema,
});

export const actionTypesRouter = router({
  /**
   * List every action type in the tenant (active by default). Joins a
   * per-type "active actions" count so the settings list can render
   * the same widget SafetyCulture shows.
   */
  list: tenantProcedure
    .use(requirePermission('actions.view'))
    .input(
      z.object({ includeArchived: z.boolean().default(false) }).default({ includeArchived: false }),
    )
    .query(async ({ ctx, input }) => {
      const where = [eq(actionTypes.tenantId, ctx.tenantId)];
      if (!input.includeArchived) where.push(isNull(actionTypes.archivedAt));
      const types = await ctx.db
        .select()
        .from(actionTypes)
        .where(and(...where))
        .orderBy(actionTypes.name);

      // Per-type active-action count. Cheap: index hit on
      // actions_tenant_type_idx. Skipped if list is empty.
      const counts = new Map<string, number>();
      if (types.length > 0) {
        const rows = await ctx.db
          .select({
            id: actions.actionTypeId,
            c: count(),
          })
          .from(actions)
          .where(and(eq(actions.tenantId, ctx.tenantId), isNull(actions.archivedAt)))
          .groupBy(actions.actionTypeId);
        for (const r of rows) {
          if (r.id !== null) counts.set(r.id, Number(r.c));
        }
      }
      return types.map((t) => ({ ...t, activeActions: counts.get(t.id) ?? 0 }));
    }),

  get: tenantProcedure
    .use(requirePermission('actions.view'))
    .input(typeIdInput)
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(actionTypes)
        .where(and(eq(actionTypes.tenantId, ctx.tenantId), eq(actionTypes.id, input.typeId)))
        .limit(1);
      const t = rows[0];
      if (t === undefined) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'action-type-not-found' });
      }
      return t;
    }),

  create: tenantProcedure
    .use(requirePermission('actions.settings'))
    .input(createInput)
    .mutation(async ({ ctx, input }) => {
      const id = newId();
      const now = new Date();
      try {
        await ctx.db.insert(actionTypes).values({
          id,
          tenantId: ctx.tenantId,
          name: input.name.trim(),
          description: input.description?.trim() ?? null,
          color: input.color ?? null,
          icon: input.icon ?? null,
          customQuestions: input.customQuestions,
          requiredFields: input.requiredFields,
          visibility: input.visibility,
          transitionRules: input.transitionRules ?? {
            completed: { allowedGroupIds: [] },
            cancelled: { allowedGroupIds: [] },
          },
          isDefault: false,
          createdBy: ctx.auth.userId,
          createdAt: now,
          updatedAt: now,
        });
      } catch (err) {
        // Partial unique index — duplicates only collide among active rows.
        const code = (err as { code?: string }).code;
        if (code === '23505') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'action-type-name-duplicate',
          });
        }
        throw err;
      }
      return { typeId: id };
    }),

  update: tenantProcedure
    .use(requirePermission('actions.settings'))
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      const updates: Partial<typeof actionTypes.$inferInsert> = { updatedAt: new Date() };
      if (input.name !== undefined) updates.name = input.name.trim();
      if (input.description !== undefined) {
        updates.description = input.description?.trim() ?? null;
      }
      if (input.color !== undefined) updates.color = input.color;
      if (input.icon !== undefined) updates.icon = input.icon;
      if (input.customQuestions !== undefined) updates.customQuestions = input.customQuestions;
      if (input.requiredFields !== undefined) updates.requiredFields = input.requiredFields;
      if (input.visibility !== undefined) updates.visibility = input.visibility;
      if (input.transitionRules !== undefined) updates.transitionRules = input.transitionRules;

      try {
        const result = await ctx.db
          .update(actionTypes)
          .set(updates)
          .where(and(eq(actionTypes.tenantId, ctx.tenantId), eq(actionTypes.id, input.typeId)))
          .returning({ id: actionTypes.id });
        if (result[0] === undefined) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'action-type-not-found' });
        }
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === '23505') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'action-type-name-duplicate',
          });
        }
        throw err;
      }
      return { ok: true as const };
    }),

  archive: tenantProcedure
    .use(requirePermission('actions.settings'))
    .input(typeIdInput)
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(actionTypes)
        .set({ archivedAt: new Date(), updatedAt: new Date(), isDefault: false })
        .where(and(eq(actionTypes.tenantId, ctx.tenantId), eq(actionTypes.id, input.typeId)));
      return { ok: true as const };
    }),

  restore: tenantProcedure
    .use(requirePermission('actions.settings'))
    .input(typeIdInput)
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(actionTypes)
        .set({ archivedAt: null, updatedAt: new Date() })
        .where(and(eq(actionTypes.tenantId, ctx.tenantId), eq(actionTypes.id, input.typeId)));
      return { ok: true as const };
    }),

  /**
   * Marks one type as the tenant default for standalone creates.
   * Clears the flag on every other type in the same transaction so we
   * never have two defaults at once.
   */
  setDefault: tenantProcedure
    .use(requirePermission('actions.settings'))
    .input(typeIdInput)
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction(async (tx) => {
        await tx
          .update(actionTypes)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(eq(actionTypes.tenantId, ctx.tenantId));
        await tx
          .update(actionTypes)
          .set({ isDefault: true, updatedAt: new Date() })
          .where(and(eq(actionTypes.tenantId, ctx.tenantId), eq(actionTypes.id, input.typeId)));
      });
      return { ok: true as const };
    }),

  /**
   * Tenant-level action-module settings (priority → due-date-days
   * table). Returns defaults when no row exists, so the UI never has
   * to think about a missing settings row.
   */
  settings: router({
    get: tenantProcedure.use(requirePermission('actions.view')).query(async ({ ctx }) => {
      const rows = await ctx.db
        .select()
        .from(tenantActionSettings)
        .where(eq(tenantActionSettings.tenantId, ctx.tenantId))
        .limit(1);
      const row = rows[0];
      if (row !== undefined) return row;
      return {
        tenantId: ctx.tenantId,
        priorityDueDateDays: { low: 30, medium: 7, high: 1, critical: 1 },
        updatedAt: new Date(),
      };
    }),

    update: tenantProcedure
      .use(requirePermission('actions.settings'))
      .input(settingsUpdateInput)
      .mutation(async ({ ctx, input }) => {
        const now = new Date();
        // Upsert pattern — INSERT … ON CONFLICT DO UPDATE.
        await ctx.db
          .insert(tenantActionSettings)
          .values({
            tenantId: ctx.tenantId,
            priorityDueDateDays: input.priorityDueDateDays,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: tenantActionSettings.tenantId,
            set: {
              priorityDueDateDays: input.priorityDueDateDays,
              updatedAt: now,
            },
          });
        return { ok: true as const };
      }),
  }),
});

/**
 * Required-fields list helper, exported so the create-action page can
 * tell the user which fields the chosen type expects. Not currently
 * used in the API — but a public symbol so the UI doesn't reimport
 * the literal list.
 */
export const ACTION_REQUIRED_FIELD_KEYS = ACTION_REQUIRED_FIELDS;
export const ACTION_VISIBILITY_RULE_KEYS = ACTION_VISIBILITY_RULES;

// Silence unused-import lint when the user list isn't joined in this file.
void user;
