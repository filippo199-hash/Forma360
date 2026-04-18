/**
 * Custom user fields admin router.
 *
 * Covers:
 *   - list (view)             — every field for the tenant, ordered.
 *   - create/update (manage)  — field definitions (text / select / multi_select).
 *   - delete (manage)         — blocks when referenced by any membership
 *                               rule (S-E04). The FK in the DB also
 *                               RESTRICTs on value rows — that's the
 *                               deeper floor.
 *   - reorder (manage)        — set the `order` field in bulk.
 *
 * Registers a `customUserFields` dependents-resolver that counts
 * referencing group + site membership rules.
 */
import { customUserFields, groupMembershipRules, siteMembershipRules } from '@forma360/db/schema';
import {
  registerDependentResolver,
  type DependentResolver,
} from '@forma360/permissions/dependents';
import { newId } from '@forma360/shared/id';
import { TRPCError } from '@trpc/server';
import { and, count, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission, tenantProcedure } from '../procedures';
import { router } from '../trpc';

// ─── Dependents resolver ────────────────────────────────────────────────────
// Counts group + site membership rules whose `conditions` jsonb references
// the field id. Used by both the cascade-preview UI and the S-E04 guard.

async function countRulesReferencingField(
  db: Parameters<DependentResolver>[0]['db'],
  tenantId: string,
  fieldId: string,
): Promise<{ groups: number; sites: number }> {
  const [groupRows, siteRows] = await Promise.all([
    db
      .select({ c: count() })
      .from(groupMembershipRules)
      .where(
        and(
          eq(groupMembershipRules.tenantId, tenantId),
          sql`${groupMembershipRules.conditions} @> ${JSON.stringify([{ fieldId }])}::jsonb`,
        ),
      ),
    db
      .select({ c: count() })
      .from(siteMembershipRules)
      .where(
        and(
          eq(siteMembershipRules.tenantId, tenantId),
          sql`${siteMembershipRules.conditions} @> ${JSON.stringify([{ fieldId }])}::jsonb`,
        ),
      ),
  ]);
  return {
    groups: Number(groupRows[0]?.c ?? 0),
    sites: Number(siteRows[0]?.c ?? 0),
  };
}

const customFieldsDependentResolver: DependentResolver = async (deps, input) => {
  if (input.entity !== 'customUserField') return 0;
  const { groups, sites } = await countRulesReferencingField(deps.db, input.tenantId, input.id);
  return groups + sites;
};
registerDependentResolver('customUserFields', customFieldsDependentResolver);

// ─── Zod schemas ────────────────────────────────────────────────────────────

const typeSchema = z.enum(['text', 'select', 'multi_select']);

const optionsSchema = z
  .array(z.object({ id: z.string().min(1).max(60), label: z.string().min(1).max(120) }))
  .max(200);

const createFieldInput = z.object({
  name: z.string().min(1).max(120),
  type: typeSchema,
  options: optionsSchema.optional(),
  required: z.boolean().default(false),
  order: z.number().int().min(0).default(0),
});

const updateFieldInput = z.object({
  id: z.string().length(26),
  name: z.string().min(1).max(120).optional(),
  options: optionsSchema.optional(),
  required: z.boolean().optional(),
  order: z.number().int().min(0).optional(),
});

// ─── Router ────────────────────────────────────────────────────────────────

export const customFieldsRouter = router({
  list: tenantProcedure.use(requirePermission('users.customFields.view')).query(async ({ ctx }) => {
    const rows = await ctx.db
      .select()
      .from(customUserFields)
      .where(eq(customUserFields.tenantId, ctx.tenantId))
      .orderBy(customUserFields.order, customUserFields.name);
    return rows;
  }),

  create: tenantProcedure
    .use(requirePermission('users.customFields.manage'))
    .input(createFieldInput)
    .mutation(async ({ ctx, input }) => {
      const id = newId();
      await ctx.db.insert(customUserFields).values({
        id,
        tenantId: ctx.tenantId,
        name: input.name,
        type: input.type,
        options: input.options ?? [],
        required: input.required ? 'true' : 'false',
        order: input.order,
      });
      return { id };
    }),

  update: tenantProcedure
    .use(requirePermission('users.customFields.manage'))
    .input(updateFieldInput)
    .mutation(async ({ ctx, input }) => {
      const updates: Partial<typeof customUserFields.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (input.name !== undefined) updates.name = input.name;
      if (input.options !== undefined) updates.options = input.options;
      if (input.required !== undefined) updates.required = input.required ? 'true' : 'false';
      if (input.order !== undefined) updates.order = input.order;
      await ctx.db
        .update(customUserFields)
        .set(updates)
        .where(and(eq(customUserFields.tenantId, ctx.tenantId), eq(customUserFields.id, input.id)));
      return { ok: true as const };
    }),

  /**
   * S-E04: blocks deletion when any membership rule references the field.
   * Returns a structured error so the UI can surface the counts and point
   * the admin to the referencing rules.
   */
  delete: tenantProcedure
    .use(requirePermission('users.customFields.manage'))
    .input(z.object({ id: z.string().length(26) }))
    .mutation(async ({ ctx, input }) => {
      const refs = await countRulesReferencingField(ctx.db, ctx.tenantId, input.id);
      if (refs.groups + refs.sites > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `This field is used by ${refs.groups + refs.sites} membership rule${
            refs.groups + refs.sites === 1 ? '' : 's'
          }. Remove it from those rules first.`,
          cause: {
            code: 'HAS_DEPENDENTS',
            groups: refs.groups,
            sites: refs.sites,
          },
        });
      }
      await ctx.db
        .delete(customUserFields)
        .where(and(eq(customUserFields.tenantId, ctx.tenantId), eq(customUserFields.id, input.id)));
      return { ok: true as const };
    }),

  /** Dependents count for a field (UI preview without attempting delete). */
  dependents: tenantProcedure
    .use(requirePermission('users.customFields.view'))
    .input(z.object({ id: z.string().length(26) }))
    .query(async ({ ctx, input }) => {
      return countRulesReferencingField(ctx.db, ctx.tenantId, input.id);
    }),
});
