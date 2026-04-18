/**
 * Groups admin router.
 *
 * Covers:
 *   - list / get (view)
 *   - create / update / archive (manage)
 *   - addMember / removeMember (manage) — rejected when the group is in
 *     rule_based mode (mirrors G-E10 for sites; same rule for groups)
 *   - setRules (manage) — bounded ≤ 5 rules per group. Materialisation
 *     into group_members for rule_based groups is queued on the
 *     `group-membership-reconcile` BullMQ queue in PR 21; this PR
 *     accepts the rule writes but does not yet re-evaluate in-band.
 *
 * Limits:
 *   - ≤ 5 rules per group (router enforced)
 *   - ≤ 100 groups per user (enforced by addMember)
 *   - ≤ 15,000 users in a rule-based group (enforced at reconcile time;
 *     PR 21)
 *
 * Registers a `groups` dependents resolver that counts active members.
 */
import { groupMembers, groupMembershipRules, groups, user } from '@forma360/db/schema';
import {
  registerDependentResolver,
  type DependentResolver,
} from '@forma360/permissions/dependents';
import { validateRuleConditions } from '@forma360/permissions/rules';
import { newId } from '@forma360/shared/id';
import { TRPCError } from '@trpc/server';
import { and, count, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission, tenantProcedure } from '../procedures';
import { router } from '../trpc';
import { invalidateAccessRulesReferencing } from './accessRules';

const MAX_RULES_PER_GROUP = 5;
const MAX_GROUPS_PER_USER = 100;

// ─── Dependents resolver ───────────────────────────────────────────────────

const groupsResolver: DependentResolver = async (deps, input) => {
  if (input.entity !== 'group') return 0;
  const rows = await deps.db
    .select({ c: count() })
    .from(groupMembers)
    .where(and(eq(groupMembers.tenantId, input.tenantId), eq(groupMembers.groupId, input.id)));
  return Number(rows[0]?.c ?? 0);
};
registerDependentResolver('groups', groupsResolver);

// ─── Zod schemas ───────────────────────────────────────────────────────────

const conditionSchema = z.object({
  fieldId: z.string().min(1),
  operator: z.string().min(1),
  value: z.unknown(),
});

const ruleSchema = z.object({
  order: z.number().int().min(0).max(999).default(0),
  conditions: z.array(conditionSchema).max(50),
});

// ─── Router ────────────────────────────────────────────────────────────────

export const groupsRouter = router({
  list: tenantProcedure.use(requirePermission('groups.view')).query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: groups.id,
        name: groups.name,
        description: groups.description,
        membershipMode: groups.membershipMode,
        archivedAt: groups.archivedAt,
      })
      .from(groups)
      .where(and(eq(groups.tenantId, ctx.tenantId), isNull(groups.archivedAt)))
      .orderBy(groups.name);
    return rows;
  }),

  create: tenantProcedure
    .use(requirePermission('groups.manage'))
    .input(
      z.object({
        name: z.string().min(1).max(120),
        description: z.string().max(500).optional(),
        membershipMode: z.enum(['manual', 'rule_based']).default('manual'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const id = newId();
      await ctx.db.insert(groups).values({
        id,
        tenantId: ctx.tenantId,
        name: input.name,
        description: input.description ?? null,
        membershipMode: input.membershipMode,
      });
      return { id };
    }),

  update: tenantProcedure
    .use(requirePermission('groups.manage'))
    .input(
      z.object({
        id: z.string().length(26),
        name: z.string().min(1).max(120).optional(),
        description: z.string().max(500).nullable().optional(),
        membershipMode: z.enum(['manual', 'rule_based']).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const updates: Partial<typeof groups.$inferInsert> = { updatedAt: new Date() };
      if (input.name !== undefined) updates.name = input.name;
      if (input.description !== undefined) updates.description = input.description;
      if (input.membershipMode !== undefined) updates.membershipMode = input.membershipMode;
      await ctx.db
        .update(groups)
        .set(updates)
        .where(and(eq(groups.tenantId, ctx.tenantId), eq(groups.id, input.id)));
      return { ok: true as const };
    }),

  archive: tenantProcedure
    .use(requirePermission('groups.manage'))
    .input(z.object({ id: z.string().length(26) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(groups)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(groups.tenantId, ctx.tenantId), eq(groups.id, input.id)));
      // G-E06: invalidate every access rule referencing this group.
      const invalidated = await invalidateAccessRulesReferencing(
        ctx.db,
        ctx.tenantId,
        'group',
        input.id,
      );
      ctx.logger.info(
        { groupId: input.id, invalidatedAccessRules: invalidated },
        '[groups] archived',
      );
      return { ok: true as const, invalidatedAccessRules: invalidated };
    }),

  addMember: tenantProcedure
    .use(requirePermission('groups.manage'))
    .input(z.object({ groupId: z.string().length(26), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const groupRow = await ctx.db
        .select()
        .from(groups)
        .where(and(eq(groups.tenantId, ctx.tenantId), eq(groups.id, input.groupId)))
        .limit(1);
      const g = groupRow[0];
      if (g === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      if (g.membershipMode !== 'manual') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Group is rule_based; manual membership edits are disabled.',
        });
      }

      // Cap per-user group count (G-E02).
      const perUser = await ctx.db
        .select({ c: count() })
        .from(groupMembers)
        .where(and(eq(groupMembers.tenantId, ctx.tenantId), eq(groupMembers.userId, input.userId)));
      if (Number(perUser[0]?.c ?? 0) >= MAX_GROUPS_PER_USER) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `User already belongs to ${MAX_GROUPS_PER_USER} groups (maximum).`,
        });
      }

      await ctx.db
        .insert(groupMembers)
        .values({
          tenantId: ctx.tenantId,
          groupId: input.groupId,
          userId: input.userId,
          addedVia: 'manual',
          addedBy: ctx.auth.userId,
        })
        .onConflictDoNothing();
      return { ok: true as const };
    }),

  removeMember: tenantProcedure
    .use(requirePermission('groups.manage'))
    .input(z.object({ groupId: z.string().length(26), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const groupRow = await ctx.db
        .select()
        .from(groups)
        .where(and(eq(groups.tenantId, ctx.tenantId), eq(groups.id, input.groupId)))
        .limit(1);
      const g = groupRow[0];
      if (g === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      if (g.membershipMode !== 'manual') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Group is rule_based; manual membership edits are disabled.',
        });
      }
      await ctx.db
        .delete(groupMembers)
        .where(
          and(
            eq(groupMembers.tenantId, ctx.tenantId),
            eq(groupMembers.groupId, input.groupId),
            eq(groupMembers.userId, input.userId),
          ),
        );
      return { ok: true as const };
    }),

  members: tenantProcedure
    .use(requirePermission('groups.view'))
    .input(z.object({ groupId: z.string().length(26) }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          userId: groupMembers.userId,
          userName: user.name,
          userEmail: user.email,
          addedVia: groupMembers.addedVia,
          addedAt: groupMembers.addedAt,
        })
        .from(groupMembers)
        .innerJoin(user, eq(groupMembers.userId, user.id))
        .where(
          and(eq(groupMembers.tenantId, ctx.tenantId), eq(groupMembers.groupId, input.groupId)),
        )
        .orderBy(user.name);
    }),

  setRules: tenantProcedure
    .use(requirePermission('groups.manage'))
    .input(
      z.object({
        groupId: z.string().length(26),
        rules: z.array(ruleSchema).max(MAX_RULES_PER_GROUP),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Validate every rule's conditions early so a single bad operator
      // fails the whole mutation before we wipe the existing rule set.
      for (const [i, rule] of input.rules.entries()) {
        const result = validateRuleConditions(rule.conditions as never);
        if (!result.ok) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Rule ${i + 1}: ${result.issues.map((x) => x.message).join(', ')}`,
          });
        }
      }

      await ctx.db.transaction(async (tx) => {
        await tx
          .delete(groupMembershipRules)
          .where(
            and(
              eq(groupMembershipRules.tenantId, ctx.tenantId),
              eq(groupMembershipRules.groupId, input.groupId),
            ),
          );
        if (input.rules.length === 0) return;
        await tx.insert(groupMembershipRules).values(
          input.rules.map((rule, i) => ({
            id: newId(),
            tenantId: ctx.tenantId,
            groupId: input.groupId,
            order: rule.order !== undefined ? rule.order : i,
            conditions: rule.conditions as readonly {
              fieldId: string;
              operator: string;
              value: unknown;
            }[],
          })),
        );
      });

      // Reconcile is enqueued in PR 21 via BullMQ. This router simply
      // writes the rule definitions.
      return { ok: true as const };
    }),
});
