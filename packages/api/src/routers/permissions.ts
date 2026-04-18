/**
 * Permission-sets admin router.
 *
 * Covers:
 *   - list (view)               — per-tenant list with user counts.
 *   - create (manage)           — new custom permission set.
 *   - update (manage)           — rename, description, permissions.
 *                                 Blocks renaming a system set.
 *   - delete (manage)           — blocks if users are assigned (S-E01)
 *                                 and blocks any system set.
 *   - assignToUser (users.manage) — change a user's permission set.
 *                                 Runs the S-E02 last-admin guard.
 *
 * Every mutation is wrapped in `requirePermission(...)`. Tenant id comes
 * from the session — never from the client (ADR 0002).
 *
 * Dependents registration: the permission-sets resolver counts active
 * users whose `permissionSetId` points at the id under query. Admin UI
 * surfaces the count in the deletion cascade preview.
 */
import { permissionSets, user } from '@forma360/db/schema';
import { isPermissionKey, type PermissionKey } from '@forma360/permissions/catalogue';
import {
  registerDependentResolver,
  type DependentResolver,
} from '@forma360/permissions/dependents';
import { wouldDropBelowMinAdmins } from '@forma360/permissions/admins';
import { newId } from '@forma360/shared/id';
import { and, count, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission, tenantProcedure } from '../procedures';
import { router, TRPCError } from '../trpc';

// ─── Zod schemas ────────────────────────────────────────────────────────────

const permissionKeySchema = z.string().refine(isPermissionKey, {
  message: 'Unknown permission key',
});

const createPermissionSetInput = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  permissions: z.array(permissionKeySchema).max(500),
});

const updatePermissionSetInput = z.object({
  id: z.string().length(26),
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  permissions: z.array(permissionKeySchema).max(500).optional(),
});

const deletePermissionSetInput = z.object({
  id: z.string().length(26),
});

const assignPermissionSetInput = z.object({
  userId: z.string(),
  permissionSetId: z.string().length(26),
});

// ─── Dependents resolver registration ──────────────────────────────────────

const permissionSetsDependentResolver: DependentResolver = async (deps, input) => {
  if (input.entity !== 'permissionSet') return 0;
  const result = await deps.db
    .select({ c: count() })
    .from(user)
    .where(and(eq(user.tenantId, input.tenantId), eq(user.permissionSetId, input.id)));
  return Number(result[0]?.c ?? 0);
};
registerDependentResolver('permissionSets', permissionSetsDependentResolver);

// ─── Router ────────────────────────────────────────────────────────────────

export const permissionsRouter = router({
  /**
   * List every permission set in the tenant with its assigned user count.
   * The count is what S-E01 blocks deletion on.
   */
  list: tenantProcedure.use(requirePermission('permissions.view')).query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: permissionSets.id,
        name: permissionSets.name,
        description: permissionSets.description,
        permissions: permissionSets.permissions,
        isSystem: permissionSets.isSystem,
        createdAt: permissionSets.createdAt,
        updatedAt: permissionSets.updatedAt,
        userCount: sql<number>`(
          SELECT count(*)::int FROM ${user}
          WHERE ${user.permissionSetId} = ${permissionSets.id}
          AND ${user.tenantId} = ${ctx.tenantId}
          AND ${user.deactivatedAt} IS NULL
        )`,
      })
      .from(permissionSets)
      .where(eq(permissionSets.tenantId, ctx.tenantId))
      .orderBy(permissionSets.name);
    return rows;
  }),

  create: tenantProcedure
    .use(requirePermission('permissions.manage'))
    .input(createPermissionSetInput)
    .mutation(async ({ ctx, input }) => {
      const id = newId();
      await ctx.db.insert(permissionSets).values({
        id,
        tenantId: ctx.tenantId,
        name: input.name,
        description: input.description ?? null,
        permissions: input.permissions as readonly PermissionKey[],
        isSystem: false,
      });
      ctx.logger.info({ permissionSetId: id }, '[permissions] created');
      return { id };
    }),

  update: tenantProcedure
    .use(requirePermission('permissions.manage'))
    .input(updatePermissionSetInput)
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db
        .select()
        .from(permissionSets)
        .where(and(eq(permissionSets.id, input.id), eq(permissionSets.tenantId, ctx.tenantId)))
        .limit(1);
      const row = existing[0];
      if (row === undefined) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Permission set not found' });
      }
      if (row.isSystem && input.name !== undefined && input.name !== row.name) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot rename a system permission set',
        });
      }
      // S-E02: if we're *removing* org.settings from a set that currently
      // has it, the change may drop the tenant below 1 admin. Evaluate
      // against every user on this set.
      if (
        input.permissions !== undefined &&
        row.permissions.includes('org.settings') &&
        !input.permissions.includes('org.settings')
      ) {
        const usersOnThisSet = await ctx.db
          .select({ id: user.id })
          .from(user)
          .where(and(eq(user.tenantId, ctx.tenantId), eq(user.permissionSetId, input.id)));
        for (const u of usersOnThisSet) {
          const dropped = await wouldDropBelowMinAdmins(ctx.db, {
            tenantId: ctx.tenantId,
            targetUserId: u.id,
            afterPermissions: input.permissions,
          });
          if (dropped) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message:
                'Cannot remove org.settings from this set: it would leave the tenant without an administrator',
            });
          }
        }
      }

      const updates: Partial<typeof permissionSets.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (input.name !== undefined) updates.name = input.name;
      if (input.description !== undefined) updates.description = input.description;
      if (input.permissions !== undefined)
        updates.permissions = input.permissions as readonly PermissionKey[];
      await ctx.db.update(permissionSets).set(updates).where(eq(permissionSets.id, input.id));
      return { ok: true as const };
    }),

  /**
   * Delete. Blocks system sets + S-E01 (users assigned).
   */
  delete: tenantProcedure
    .use(requirePermission('permissions.manage'))
    .input(deletePermissionSetInput)
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db
        .select()
        .from(permissionSets)
        .where(and(eq(permissionSets.id, input.id), eq(permissionSets.tenantId, ctx.tenantId)))
        .limit(1);
      const row = existing[0];
      if (row === undefined) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Permission set not found' });
      }
      if (row.isSystem) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot delete a system permission set',
        });
      }

      // S-E01: structured "assigned count" error so the UI can render
      // a reassignment modal.
      const assignedResult = await ctx.db
        .select({ c: count() })
        .from(user)
        .where(and(eq(user.tenantId, ctx.tenantId), eq(user.permissionSetId, input.id)));
      const assigned = Number(assignedResult[0]?.c ?? 0);
      if (assigned > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot delete: ${assigned} user(s) assigned. Reassign them first.`,
          cause: { code: 'HAS_DEPENDENTS', assigned },
        });
      }

      await ctx.db.delete(permissionSets).where(eq(permissionSets.id, input.id));
      ctx.logger.info({ permissionSetId: input.id }, '[permissions] deleted');
      return { ok: true as const };
    }),

  /**
   * Assign a (different) permission set to a user. Runs the S-E02
   * last-admin guard if the current user is an admin and the incoming
   * set is not.
   */
  assignToUser: tenantProcedure
    .use(requirePermission('users.manage'))
    .input(assignPermissionSetInput)
    .mutation(async ({ ctx, input }) => {
      const targetSet = await ctx.db
        .select()
        .from(permissionSets)
        .where(
          and(
            eq(permissionSets.id, input.permissionSetId),
            eq(permissionSets.tenantId, ctx.tenantId),
          ),
        )
        .limit(1);
      if (targetSet[0] === undefined) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Permission set not found' });
      }

      const dropped = await wouldDropBelowMinAdmins(ctx.db, {
        tenantId: ctx.tenantId,
        targetUserId: input.userId,
        afterPermissions: targetSet[0].permissions,
      });
      if (dropped) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'You are the last administrator. At least one administrator must exist. Assign another user as Administrator first.',
        });
      }

      await ctx.db
        .update(user)
        .set({ permissionSetId: input.permissionSetId, updatedAt: new Date() })
        .where(and(eq(user.tenantId, ctx.tenantId), eq(user.id, input.userId)));
      return { ok: true as const };
    }),
});
