/**
 * Sites admin router.
 *
 * Covers:
 *   - list (view)                         — tenant-scoped tree export.
 *   - create / update / archive (manage)  — with depth limits (G-E07).
 *   - move (manage, G-17)                 — change parent, recompute depth
 *                                           + path for the subtree
 *                                           (application-code hierarchy
 *                                           maintenance per sites.ts
 *                                           header note).
 *   - addMember / removeMember (manage)   — G-E10: refused in rule_based
 *                                           mode.
 *   - matrix (view)                       — sparse (userId, siteId) edge
 *                                           list; the UI virtualises.
 *   - setRules (manage)                   — same shape as groups.setRules.
 *
 * Limits:
 *   - depth ≤ 5 (6 levels total, 0–5). G-E07 enforced at router layer.
 *   - ≤ 50,000 sites per tenant — checked at create.
 */
import { siteMembers, siteMembershipRules, sites } from '@forma360/db/schema';
import {
  registerDependentResolver,
  type DependentResolver,
} from '@forma360/permissions/dependents';
import { validateRuleConditions } from '@forma360/permissions/rules';
import { newId } from '@forma360/shared/id';
import { TRPCError } from '@trpc/server';
import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission, tenantProcedure } from '../procedures';
import { router } from '../trpc';
import { invalidateAccessRulesReferencing } from './accessRules';

const MAX_DEPTH = 5;
const MAX_SITES_PER_TENANT = 50_000;
const MAX_RULES_PER_SITE = 5;

// ─── Dependents resolver ───────────────────────────────────────────────────

const sitesResolver: DependentResolver = async (deps, input) => {
  if (input.entity !== 'site') return 0;
  const rows = await deps.db
    .select({ c: count() })
    .from(siteMembers)
    .where(and(eq(siteMembers.tenantId, input.tenantId), eq(siteMembers.siteId, input.id)));
  return Number(rows[0]?.c ?? 0);
};
registerDependentResolver('sites', sitesResolver);

// ─── Path helpers ──────────────────────────────────────────────────────────
// `path` is a dot-separated materialised list of ancestor ids. Root rows
// store "". A site at `A.B.C` stores `A.B` (root first, nearest ancestor
// last). The full `path || '.' || id` finds every descendant.

function buildPath(parentPath: string, parentId: string): string {
  return parentPath.length === 0 ? parentId : `${parentPath}.${parentId}`;
}

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

export const sitesRouter = router({
  list: tenantProcedure.use(requirePermission('sites.view')).query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: sites.id,
        name: sites.name,
        parentId: sites.parentId,
        depth: sites.depth,
        path: sites.path,
        membershipMode: sites.membershipMode,
        archivedAt: sites.archivedAt,
      })
      .from(sites)
      .where(and(eq(sites.tenantId, ctx.tenantId), isNull(sites.archivedAt)))
      .orderBy(sites.path, sites.name);
    return rows;
  }),

  create: tenantProcedure
    .use(requirePermission('sites.manage'))
    .input(
      z.object({
        name: z.string().min(1).max(120),
        parentId: z.string().length(26).nullable().optional(),
        membershipMode: z.enum(['manual', 'rule_based']).default('manual'),
        metadata: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Tenant-scale cap (Module 9 spec).
      const tenantCount = await ctx.db
        .select({ c: count() })
        .from(sites)
        .where(eq(sites.tenantId, ctx.tenantId));
      if (Number(tenantCount[0]?.c ?? 0) >= MAX_SITES_PER_TENANT) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Site cap reached (${MAX_SITES_PER_TENANT}).`,
        });
      }

      let depth = 0;
      let path = '';
      if (input.parentId != null) {
        const parent = await ctx.db
          .select()
          .from(sites)
          .where(and(eq(sites.tenantId, ctx.tenantId), eq(sites.id, input.parentId)))
          .limit(1);
        if (parent[0] === undefined) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Parent site not found' });
        }
        depth = parent[0].depth + 1;
        if (depth > MAX_DEPTH) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Max hierarchy depth is ${MAX_DEPTH + 1} (6 levels, 0-indexed).`,
          });
        }
        path = buildPath(parent[0].path, parent[0].id);
      }

      const id = newId();
      await ctx.db.insert(sites).values({
        id,
        tenantId: ctx.tenantId,
        name: input.name,
        parentId: input.parentId ?? null,
        depth,
        path,
        membershipMode: input.membershipMode,
        metadata: input.metadata ?? {},
      });
      return { id };
    }),

  update: tenantProcedure
    .use(requirePermission('sites.manage'))
    .input(
      z.object({
        id: z.string().length(26),
        name: z.string().min(1).max(120).optional(),
        membershipMode: z.enum(['manual', 'rule_based']).optional(),
        metadata: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const updates: Partial<typeof sites.$inferInsert> = { updatedAt: new Date() };
      if (input.name !== undefined) updates.name = input.name;
      if (input.membershipMode !== undefined) updates.membershipMode = input.membershipMode;
      if (input.metadata !== undefined) updates.metadata = input.metadata;
      await ctx.db
        .update(sites)
        .set(updates)
        .where(and(eq(sites.tenantId, ctx.tenantId), eq(sites.id, input.id)));
      return { ok: true as const };
    }),

  archive: tenantProcedure
    .use(requirePermission('sites.manage'))
    .input(z.object({ id: z.string().length(26) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(sites)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(sites.tenantId, ctx.tenantId), eq(sites.id, input.id)));
      // G-E06: invalidate every access rule referencing this site.
      const invalidated = await invalidateAccessRulesReferencing(
        ctx.db,
        ctx.tenantId,
        'site',
        input.id,
      );
      ctx.logger.info(
        { siteId: input.id, invalidatedAccessRules: invalidated },
        '[sites] archived',
      );
      return { ok: true as const, invalidatedAccessRules: invalidated };
    }),

  /**
   * G-17: move a site to a new parent. Re-computes `depth` + `path` for
   * the site AND every descendant. `parentId === null` promotes to root.
   */
  move: tenantProcedure
    .use(requirePermission('sites.manage'))
    .input(
      z.object({
        id: z.string().length(26),
        parentId: z.string().length(26).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [self] = await ctx.db
        .select()
        .from(sites)
        .where(and(eq(sites.tenantId, ctx.tenantId), eq(sites.id, input.id)))
        .limit(1);
      if (self === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      if (input.parentId === input.id) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot set a site as its own parent.',
        });
      }

      // Compute the new (depth, path) for the moved site.
      let newDepth = 0;
      let newPath = '';
      if (input.parentId !== null) {
        const [parent] = await ctx.db
          .select()
          .from(sites)
          .where(and(eq(sites.tenantId, ctx.tenantId), eq(sites.id, input.parentId)))
          .limit(1);
        if (parent === undefined) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'New parent site not found' });
        }
        // Reject moves that would make a site its own descendant.
        if (
          parent.path === self.id ||
          parent.path.startsWith(`${self.id}.`) ||
          parent.path.includes(`.${self.id}.`) ||
          parent.path.endsWith(`.${self.id}`)
        ) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Cannot move a site beneath its own descendant.',
          });
        }
        newDepth = parent.depth + 1;
        newPath = buildPath(parent.path, parent.id);
      }

      // Recompute for the subtree. Every descendant's new path is
      // newPath + self.id + descendant's path-suffix after the old subtree
      // root. Data stays linked by id (G-E09); only the hierarchy metadata
      // changes.
      const oldPrefix = buildPath(self.path, self.id); // old full path to self (inclusive)
      const newPrefix = buildPath(newPath, self.id);

      // Guard max depth for the deepest descendant.
      const deepest = await ctx.db
        .select({ d: sql<number>`max(${sites.depth})` })
        .from(sites)
        .where(and(eq(sites.tenantId, ctx.tenantId), sql`${sites.path} LIKE ${oldPrefix + '%'}`));
      const depthDelta = newDepth - self.depth;
      const deepestCurrent = Number(deepest[0]?.d ?? self.depth);
      if (deepestCurrent + depthDelta > MAX_DEPTH) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Move would exceed max depth (${MAX_DEPTH + 1} levels).`,
        });
      }

      await ctx.db.transaction(async (tx) => {
        // Update self.
        await tx
          .update(sites)
          .set({
            parentId: input.parentId,
            depth: newDepth,
            path: newPath,
            updatedAt: new Date(),
          })
          .where(and(eq(sites.tenantId, ctx.tenantId), eq(sites.id, input.id)));

        // Update descendants. Replace the prefix of their path + shift
        // depth by the delta. Cast the params to text so pglite's type
        // inference doesn't balk on the untyped bind parameters.
        await tx
          .update(sites)
          .set({
            depth: sql`${sites.depth} + ${depthDelta}`,
            path: sql`CONCAT(${newPrefix}::text, SUBSTR(${sites.path}, ${oldPrefix.length + 1}))`,
            updatedAt: new Date(),
          })
          .where(
            and(eq(sites.tenantId, ctx.tenantId), sql`${sites.path} LIKE ${oldPrefix + '.%'}`),
          );
      });

      return { ok: true as const };
    }),

  addMember: tenantProcedure
    .use(requirePermission('sites.manage'))
    .input(z.object({ siteId: z.string().length(26), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(sites)
        .where(and(eq(sites.tenantId, ctx.tenantId), eq(sites.id, input.siteId)))
        .limit(1);
      if (row === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      if (row.membershipMode !== 'manual') {
        // G-E10
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Site is rule_based; manual membership edits are disabled.',
        });
      }
      await ctx.db
        .insert(siteMembers)
        .values({
          tenantId: ctx.tenantId,
          siteId: input.siteId,
          userId: input.userId,
          addedVia: 'manual',
        })
        .onConflictDoNothing();
      return { ok: true as const };
    }),

  removeMember: tenantProcedure
    .use(requirePermission('sites.manage'))
    .input(z.object({ siteId: z.string().length(26), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(sites)
        .where(and(eq(sites.tenantId, ctx.tenantId), eq(sites.id, input.siteId)))
        .limit(1);
      if (row === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      if (row.membershipMode !== 'manual') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Site is rule_based; manual membership edits are disabled.',
        });
      }
      await ctx.db
        .delete(siteMembers)
        .where(
          and(
            eq(siteMembers.tenantId, ctx.tenantId),
            eq(siteMembers.siteId, input.siteId),
            eq(siteMembers.userId, input.userId),
          ),
        );
      return { ok: true as const };
    }),

  /**
   * Sparse user × site edge list. The UI is responsible for virtualising;
   * this endpoint does NOT produce a dense matrix.
   */
  matrix: tenantProcedure
    .use(requirePermission('sites.view'))
    .input(
      z.object({
        userIds: z.array(z.string()).max(500).optional(),
        siteIds: z.array(z.string().length(26)).max(500).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const whereParts = [eq(siteMembers.tenantId, ctx.tenantId)];
      if (input.userIds && input.userIds.length > 0) {
        whereParts.push(inArray(siteMembers.userId, input.userIds));
      }
      if (input.siteIds && input.siteIds.length > 0) {
        whereParts.push(inArray(siteMembers.siteId, input.siteIds));
      }
      const edges = await ctx.db
        .select({
          userId: siteMembers.userId,
          siteId: siteMembers.siteId,
          addedVia: siteMembers.addedVia,
        })
        .from(siteMembers)
        .where(and(...whereParts));
      return { edges };
    }),

  setRules: tenantProcedure
    .use(requirePermission('sites.manage'))
    .input(
      z.object({
        siteId: z.string().length(26),
        rules: z.array(ruleSchema).max(MAX_RULES_PER_SITE),
      }),
    )
    .mutation(async ({ ctx, input }) => {
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
          .delete(siteMembershipRules)
          .where(
            and(
              eq(siteMembershipRules.tenantId, ctx.tenantId),
              eq(siteMembershipRules.siteId, input.siteId),
            ),
          );
        if (input.rules.length === 0) return;
        await tx.insert(siteMembershipRules).values(
          input.rules.map((rule, i) => ({
            id: newId(),
            tenantId: ctx.tenantId,
            siteId: input.siteId,
            order: rule.order !== undefined ? rule.order : i,
            conditions: rule.conditions as readonly {
              fieldId: string;
              operator: string;
              value: unknown;
            }[],
          })),
        );
      });
      return { ok: true as const };
    }),
});

export { buildPath };
