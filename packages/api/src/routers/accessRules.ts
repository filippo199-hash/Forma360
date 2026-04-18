/**
 * Access-rules admin router.
 *
 * Covers:
 *   - list (view)
 *   - create / update / delete (manage)
 *   - listInvalid (view) — G-E06: surface invalidated rules for the
 *     Settings dashboard badge.
 *   - invalidateReferencing(groupId | siteId) — called internally by
 *     groups.archive / sites.archive to mark any referencing rule
 *     invalidatedAt = now().
 *
 * Registers an `accessRules` dependents resolver that counts rules
 * referencing a group / site anchor.
 */
import { accessRules } from '@forma360/db/schema';
import {
  registerDependentResolver,
  type DependentResolver,
} from '@forma360/permissions/dependents';
import { newId } from '@forma360/shared/id';
import { TRPCError } from '@trpc/server';
import { and, count, eq, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission, tenantProcedure } from '../procedures';
import { router } from '../trpc';

// ─── Dependents resolver ───────────────────────────────────────────────────

const accessRulesResolver: DependentResolver = async (deps, input) => {
  if (input.entity !== 'group' && input.entity !== 'site') return 0;
  const column = input.entity === 'group' ? accessRules.groupIds : accessRules.siteIds;
  const rows = await deps.db
    .select({ c: count() })
    .from(accessRules)
    .where(
      and(
        eq(accessRules.tenantId, input.tenantId),
        sql`${column} @> ${JSON.stringify([input.id])}::jsonb`,
      ),
    );
  return Number(rows[0]?.c ?? 0);
};
registerDependentResolver('accessRules', accessRulesResolver);

/**
 * Mark every access rule referencing the given anchor as invalidated.
 * Called from the archive flow in the groups and sites routers. Exported
 * as a helper so future Phase 2+ modules can reuse it without re-importing
 * the whole router.
 */
export async function invalidateAccessRulesReferencing(
  db: Parameters<DependentResolver>[0]['db'],
  tenantId: string,
  kind: 'group' | 'site',
  id: string,
): Promise<number> {
  const column = kind === 'group' ? accessRules.groupIds : accessRules.siteIds;
  const result = await db
    .update(accessRules)
    .set({ invalidatedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(accessRules.tenantId, tenantId),
        sql`${column} @> ${JSON.stringify([id])}::jsonb`,
        // Only invalidate rules that weren't already invalidated — idempotent.
        sql`${accessRules.invalidatedAt} IS NULL`,
      ),
    );
  // pglite returns `rowCount` on the result; on real pg the types are
  // consistent. Return a best-effort count for logging.
  return (result as unknown as { rowCount?: number }).rowCount ?? 0;
}

// ─── Zod schemas ───────────────────────────────────────────────────────────

const createInput = z.object({
  name: z.string().min(1).max(120),
  groupIds: z.array(z.string().length(26)).max(500).default([]),
  siteIds: z.array(z.string().length(26)).max(500).default([]),
});

const updateInput = z.object({
  id: z.string().length(26),
  name: z.string().min(1).max(120).optional(),
  groupIds: z.array(z.string().length(26)).max(500).optional(),
  siteIds: z.array(z.string().length(26)).max(500).optional(),
});

// ─── Router ────────────────────────────────────────────────────────────────

export const accessRulesRouter = router({
  list: tenantProcedure.use(requirePermission('permissions.view')).query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(accessRules)
      .where(eq(accessRules.tenantId, ctx.tenantId))
      .orderBy(accessRules.name);
  }),

  listInvalid: tenantProcedure.use(requirePermission('permissions.view')).query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(accessRules)
      .where(and(eq(accessRules.tenantId, ctx.tenantId), isNotNull(accessRules.invalidatedAt)))
      .orderBy(accessRules.invalidatedAt);
  }),

  create: tenantProcedure
    .use(requirePermission('permissions.manage'))
    .input(createInput)
    .mutation(async ({ ctx, input }) => {
      const id = newId();
      await ctx.db.insert(accessRules).values({
        id,
        tenantId: ctx.tenantId,
        name: input.name,
        groupIds: input.groupIds,
        siteIds: input.siteIds,
      });
      return { id };
    }),

  update: tenantProcedure
    .use(requirePermission('permissions.manage'))
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      const updates: Partial<typeof accessRules.$inferInsert> = { updatedAt: new Date() };
      if (input.name !== undefined) updates.name = input.name;
      if (input.groupIds !== undefined) updates.groupIds = input.groupIds;
      if (input.siteIds !== undefined) updates.siteIds = input.siteIds;
      // Updating the references is the admin's way to revive an invalidated
      // rule after fixing its anchors.
      updates.invalidatedAt = null;
      const existing = await ctx.db
        .select()
        .from(accessRules)
        .where(and(eq(accessRules.tenantId, ctx.tenantId), eq(accessRules.id, input.id)))
        .limit(1);
      if (existing[0] === undefined) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      await ctx.db.update(accessRules).set(updates).where(eq(accessRules.id, input.id));
      return { ok: true as const };
    }),

  delete: tenantProcedure
    .use(requirePermission('permissions.manage'))
    .input(z.object({ id: z.string().length(26) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(accessRules)
        .where(and(eq(accessRules.tenantId, ctx.tenantId), eq(accessRules.id, input.id)));
      return { ok: true as const };
    }),
});
