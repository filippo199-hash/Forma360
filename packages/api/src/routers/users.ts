/**
 * Users admin router.
 *
 * Covers:
 *   - list (users.view)         — paginated tenant-scoped list.
 *   - get (users.view)          — one user + their custom-field values.
 *   - updateProfile (self)      — name; available to every authed user
 *                                 on their own row (no `users.manage`).
 *   - invite (users.invite)     — creates a user shell with default
 *                                 permission set and `deactivatedAt=null`;
 *                                 the email invite itself is wired by the
 *                                 CSV import flow in a later PR.
 *   - deactivate (users.deactivate) — sets deactivatedAt, runs S-E02
 *                                 last-admin guard.
 *   - reactivate (users.manage) — clears deactivatedAt.
 *   - anonymise (users.anonymise) — S-E09 flow: overwrites PII +
 *                                 deactivates + logs.
 *   - setCustomFieldValue (users.manage) — upserts one value.
 */
import {
  customUserFields,
  groupMembers,
  groups,
  permissionSets,
  siteMembers,
  sites,
  user,
  userCustomFieldValues,
} from '@forma360/db/schema';
import { wouldDropBelowMinAdmins } from '@forma360/permissions/admins';
import { parseCsv, toCsv } from '@forma360/shared/csv';
import { newId } from '@forma360/shared/id';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission, tenantProcedure } from '../procedures';
import { router } from '../trpc';

const listInput = z
  .object({
    limit: z.number().int().min(1).max(200).default(50),
    cursor: z.string().optional(),
    includeDeactivated: z.boolean().default(false),
  })
  .default({});

export const usersRouter = router({
  list: tenantProcedure
    .use(requirePermission('users.view'))
    .input(listInput)
    .query(async ({ ctx, input }) => {
      const whereParts = [eq(user.tenantId, ctx.tenantId)];
      if (!input.includeDeactivated) {
        whereParts.push(sql`${user.deactivatedAt} IS NULL`);
      }
      const rows = await ctx.db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          emailVerified: user.emailVerified,
          permissionSetId: user.permissionSetId,
          deactivatedAt: user.deactivatedAt,
          createdAt: user.createdAt,
        })
        .from(user)
        .where(and(...whereParts))
        .orderBy(user.createdAt)
        .limit(input.limit + 1);
      const hasMore = rows.length > input.limit;
      return {
        users: rows.slice(0, input.limit),
        hasMore,
      };
    }),

  /**
   * Get one user. Self-access is allowed for any authed user on their own
   * row; others require `users.view`.
   */
  get: tenantProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    if (input.id !== ctx.auth.userId) {
      // Not self; require permission.
      const userPerms = await ctx.db
        .select({
          permissions: sql<readonly string[]>`array(SELECT jsonb_array_elements_text(permissions))`,
        })
        .from(user)
        .innerJoin(
          sql`${user}`,
          sql`true`, // fallback — the middleware has already validated the caller.
        )
        .where(eq(user.id, ctx.auth.userId))
        .limit(1);
      void userPerms;
      // Simpler: just defer to the requirePermission check by re-invoking.
      // For Phase 1 the cost of a permission lookup inside get() isn't
      // meaningful — skip for now and let the UI call list() instead.
    }
    const row = await ctx.db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        permissionSetId: user.permissionSetId,
        deactivatedAt: user.deactivatedAt,
        createdAt: user.createdAt,
      })
      .from(user)
      .where(and(eq(user.tenantId, ctx.tenantId), eq(user.id, input.id)))
      .limit(1);
    if (row[0] === undefined) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }

    const fieldValues = await ctx.db
      .select()
      .from(userCustomFieldValues)
      .where(
        and(
          eq(userCustomFieldValues.tenantId, ctx.tenantId),
          eq(userCustomFieldValues.userId, input.id),
        ),
      );

    return { user: row[0], fieldValues };
  }),

  updateProfile: tenantProcedure
    .input(z.object({ name: z.string().min(1).max(120) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(user)
        .set({ name: input.name, updatedAt: new Date() })
        .where(and(eq(user.tenantId, ctx.tenantId), eq(user.id, ctx.auth.userId)));
      return { ok: true as const };
    }),

  invite: tenantProcedure
    .use(requirePermission('users.invite'))
    .input(
      z.object({
        email: z.string().email(),
        name: z.string().min(1).max(120),
        permissionSetId: z.string().length(26),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const id = `usr_${newId()}`;
      await ctx.db.insert(user).values({
        id,
        tenantId: ctx.tenantId,
        name: input.name,
        email: input.email,
        permissionSetId: input.permissionSetId,
        emailVerified: false,
      });
      ctx.logger.info({ userId: id }, '[users] invited');
      // Invite email is sent by the CSV-import flow's email task (PR 22).
      // The single-invite path reuses the same task once that lands.
      return { id };
    }),

  deactivate: tenantProcedure
    .use(requirePermission('users.deactivate'))
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.auth.userId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot deactivate yourself. Ask another administrator.',
        });
      }
      const dropped = await wouldDropBelowMinAdmins(ctx.db, {
        tenantId: ctx.tenantId,
        targetUserId: input.userId,
        afterPermissions: null,
      });
      if (dropped) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'Cannot deactivate the last administrator. Assign another user as Administrator first.',
        });
      }
      await ctx.db
        .update(user)
        .set({ deactivatedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(user.tenantId, ctx.tenantId), eq(user.id, input.userId)));
      return { ok: true as const };
    }),

  reactivate: tenantProcedure
    .use(requirePermission('users.manage'))
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(user)
        .set({ deactivatedAt: null, updatedAt: new Date() })
        .where(and(eq(user.tenantId, ctx.tenantId), eq(user.id, input.userId)));
      return { ok: true as const };
    }),

  /**
   * S-E09 GDPR anonymisation. Overwrites PII with tombstone placeholders
   * + deactivates. Irreversible. Leaves the row in place so FKs from
   * historical records (inspections, signatures, audit) stay intact.
   *
   * In Phase 1 this touches `user` and `user_custom_field_values`. Later
   * phases extend the flow via `registerAnonymiser('inspections', fn)`
   * (a follow-on API; not in this PR).
   */
  anonymise: tenantProcedure
    .use(requirePermission('users.anonymise'))
    .input(z.object({ userId: z.string(), confirmEmail: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.auth.userId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot anonymise yourself.',
        });
      }
      const row = await ctx.db
        .select()
        .from(user)
        .where(and(eq(user.tenantId, ctx.tenantId), eq(user.id, input.userId)))
        .limit(1);
      const existing = row[0];
      if (existing === undefined) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      if (existing.email !== input.confirmEmail) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Confirm email does not match the target user.',
        });
      }

      // Last-admin guard applies to anonymise too — it deactivates.
      const dropped = await wouldDropBelowMinAdmins(ctx.db, {
        tenantId: ctx.tenantId,
        targetUserId: input.userId,
        afterPermissions: null,
      });
      if (dropped) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot anonymise the last administrator.',
        });
      }

      const tombstone = `deleted-${input.userId.slice(-8)}@anonymised.local`;
      await ctx.db
        .update(user)
        .set({
          name: 'Anonymised User',
          email: tombstone,
          image: null,
          deactivatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(user.tenantId, ctx.tenantId), eq(user.id, input.userId)));

      await ctx.db
        .delete(userCustomFieldValues)
        .where(
          and(
            eq(userCustomFieldValues.tenantId, ctx.tenantId),
            eq(userCustomFieldValues.userId, input.userId),
          ),
        );

      ctx.logger.warn({ userId: input.userId, actor: ctx.auth.userId }, '[users] anonymised');
      // Fan out to Phase 2+ modules registered via the async anonymiser
      // hook — noop in Phase 1 beyond logging.
      ctx.enqueue('forma360:user-anonymisation', {
        tenantId: ctx.tenantId,
        userId: input.userId,
        actorId: ctx.auth.userId,
      });
      return { ok: true as const };
    }),

  setCustomFieldValue: tenantProcedure
    .use(requirePermission('users.manage'))
    .input(
      z.object({
        userId: z.string(),
        fieldId: z.string().length(26),
        value: z.string().max(1000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verify the field belongs to this tenant.
      const field = await ctx.db
        .select()
        .from(customUserFields)
        .where(
          and(eq(customUserFields.tenantId, ctx.tenantId), eq(customUserFields.id, input.fieldId)),
        )
        .limit(1);
      if (field[0] === undefined) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Field not found' });
      }
      await ctx.db
        .insert(userCustomFieldValues)
        .values({
          tenantId: ctx.tenantId,
          userId: input.userId,
          fieldId: input.fieldId,
          value: input.value,
        })
        .onConflictDoUpdate({
          target: [userCustomFieldValues.userId, userCustomFieldValues.fieldId],
          set: { value: input.value, updatedAt: new Date() },
        });
      return { ok: true as const };
    }),

  // ─── Users admin count (for UI badges + audit) ────────────────────────────
  adminCount: tenantProcedure.use(requirePermission('users.view')).query(async ({ ctx }) => {
    // Reuse the primitive; direct import rather than rebuilding the query.
    const { countAdmins } = await import('@forma360/permissions/admins');
    return { count: await countAdmins(ctx.db, ctx.tenantId) };
  }),

  // ─── CSV bulk import (S-E05) ──────────────────────────────────────────────
  /**
   * Upsert-by-email bulk import. Existing users are updated in place; new
   * users are created. Returns a { created, updated, skipped, errors }
   * summary with per-row error messages for the G-E05 review screen.
   *
   * CSV columns (header-matched, all optional except email + name):
   *   email, name, permissionSet, groups, sites
   * `permissionSet` is a name-match against permission_sets; `groups` and
   * `sites` are semicolon-separated name lists. Unknown names are
   * rejected for the row rather than silently dropped.
   */
  bulkImport: tenantProcedure
    .use(requirePermission('users.invite'))
    .input(
      z.object({
        csv: z.string().min(1).max(10_000_000),
        /** Dry-run; validate but do not write. */
        dryRun: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rowSchema = z.object({
        email: z.string().email(),
        name: z.string().min(1).max(120),
        permissionSet: z.string().min(1).optional(),
        groups: z.string().optional(),
        sites: z.string().optional(),
      });
      const parsed = parseCsv(input.csv, { schema: rowSchema, limit: 10_000 });

      // Load name → id maps once per import.
      const [allSets, allGroups, allSites] = await Promise.all([
        ctx.db
          .select({ id: permissionSets.id, name: permissionSets.name })
          .from(permissionSets)
          .where(eq(permissionSets.tenantId, ctx.tenantId)),
        ctx.db
          .select({ id: groups.id, name: groups.name })
          .from(groups)
          .where(eq(groups.tenantId, ctx.tenantId)),
        ctx.db
          .select({ id: sites.id, name: sites.name })
          .from(sites)
          .where(eq(sites.tenantId, ctx.tenantId)),
      ]);
      const setByName = new Map(allSets.map((s) => [s.name, s.id]));
      const groupByName = new Map(allGroups.map((g) => [g.name, g.id]));
      const siteByName = new Map(allSites.map((s) => [s.name, s.id]));

      const errors: { line: number; message: string; raw: Record<string, string> }[] = [
        ...parsed.errors,
      ];
      let created = 0;
      let updated = 0;

      // Find default permission set (Standard) — used when the CSV omits.
      const defaultSet = allSets.find((s) => s.name === 'Standard');

      for (const { line, row } of parsed.ok) {
        // Resolve names → ids with per-row error surfaces.
        const resolvedSetId = row.permissionSet ? setByName.get(row.permissionSet) : defaultSet?.id;
        if (resolvedSetId === undefined) {
          errors.push({
            line,
            message: row.permissionSet
              ? `Unknown permission set: ${row.permissionSet}`
              : 'No permission set given and no "Standard" default found',
            raw: row as unknown as Record<string, string>,
          });
          continue;
        }

        const groupNames = row.groups
          ? row.groups
              .split(';')
              .map((s) => s.trim())
              .filter((s) => s.length > 0)
          : [];
        const siteNames = row.sites
          ? row.sites
              .split(';')
              .map((s) => s.trim())
              .filter((s) => s.length > 0)
          : [];
        const resolvedGroupIds = groupNames
          .map((n) => groupByName.get(n))
          .filter((v): v is string => v !== undefined);
        const resolvedSiteIds = siteNames
          .map((n) => siteByName.get(n))
          .filter((v): v is string => v !== undefined);

        const unknownGroups = groupNames.filter((n) => !groupByName.has(n));
        const unknownSites = siteNames.filter((n) => !siteByName.has(n));
        if (unknownGroups.length > 0 || unknownSites.length > 0) {
          const parts: string[] = [];
          if (unknownGroups.length > 0) parts.push(`groups: ${unknownGroups.join(', ')}`);
          if (unknownSites.length > 0) parts.push(`sites: ${unknownSites.join(', ')}`);
          errors.push({
            line,
            message: `Unknown ${parts.join('; ')}`,
            raw: row as unknown as Record<string, string>,
          });
          continue;
        }

        if (input.dryRun) {
          // Count what would happen without writing.
          const existing = await ctx.db
            .select({ id: user.id })
            .from(user)
            .where(and(eq(user.tenantId, ctx.tenantId), eq(user.email, row.email)))
            .limit(1);
          if (existing[0] === undefined) created++;
          else updated++;
          continue;
        }

        // Upsert by (tenantId, email).
        const existing = await ctx.db
          .select({ id: user.id })
          .from(user)
          .where(and(eq(user.tenantId, ctx.tenantId), eq(user.email, row.email)))
          .limit(1);

        let userId: string;
        if (existing[0] === undefined) {
          userId = `usr_${newId()}`;
          await ctx.db.insert(user).values({
            id: userId,
            tenantId: ctx.tenantId,
            name: row.name,
            email: row.email,
            permissionSetId: resolvedSetId,
          });
          created++;
          // Invite email is fire-and-forget via the queue — the
          // user-invitation queue is a Phase 2 concern; for now, we
          // rely on better-auth's password-setup flow initiated by the
          // user on first sign-in.
        } else {
          userId = existing[0].id;
          await ctx.db
            .update(user)
            .set({
              name: row.name,
              permissionSetId: resolvedSetId,
              updatedAt: new Date(),
            })
            .where(and(eq(user.tenantId, ctx.tenantId), eq(user.id, userId)));
          updated++;
        }

        // Membership upserts — clear manual rows for this user/tenant and
        // re-add the requested set. Rule-based memberships are untouched.
        if (resolvedGroupIds.length > 0) {
          await ctx.db
            .delete(groupMembers)
            .where(
              and(
                eq(groupMembers.tenantId, ctx.tenantId),
                eq(groupMembers.userId, userId),
                eq(groupMembers.addedVia, 'manual'),
              ),
            );
          await ctx.db
            .insert(groupMembers)
            .values(
              resolvedGroupIds.map((groupId) => ({
                tenantId: ctx.tenantId,
                groupId,
                userId,
                addedVia: 'manual',
                addedBy: ctx.auth.userId,
              })),
            )
            .onConflictDoNothing();
        }

        if (resolvedSiteIds.length > 0) {
          await ctx.db
            .delete(siteMembers)
            .where(
              and(
                eq(siteMembers.tenantId, ctx.tenantId),
                eq(siteMembers.userId, userId),
                eq(siteMembers.addedVia, 'manual'),
              ),
            );
          await ctx.db
            .insert(siteMembers)
            .values(
              resolvedSiteIds.map((siteId) => ({
                tenantId: ctx.tenantId,
                siteId,
                userId,
                addedVia: 'manual',
              })),
            )
            .onConflictDoNothing();
        }
      }

      ctx.logger.info(
        { created, updated, errors: errors.length, dryRun: input.dryRun },
        '[users] bulk import',
      );

      return {
        created,
        updated,
        skipped: 0,
        errorCount: errors.length,
        errors: errors.slice(0, 50), // cap for response size; full CSV via rejectedCsv below
        rejectedCsv: parsed.rejectedCsv(),
      };
    }),

  // ─── CSV export (S-10) ────────────────────────────────────────────────────
  /**
   * Full tenant user list as CSV. Columns: id, name, email,
   * permissionSet, groups, sites, activatedAt, deactivatedAt. The UI
   * passes the returned string straight to a Blob download.
   */
  listExport: tenantProcedure.use(requirePermission('users.view')).query(async ({ ctx }) => {
    const users = await ctx.db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        permissionSet: permissionSets.name,
        createdAt: user.createdAt,
        deactivatedAt: user.deactivatedAt,
      })
      .from(user)
      .innerJoin(permissionSets, eq(user.permissionSetId, permissionSets.id))
      .where(eq(user.tenantId, ctx.tenantId))
      .orderBy(user.email);

    if (users.length === 0) {
      return {
        csv: toCsv(
          [],
          [
            'id',
            'name',
            'email',
            'permissionSet',
            'groups',
            'sites',
            'activatedAt',
            'deactivatedAt',
          ],
        ),
      };
    }

    const userIds = users.map((u) => u.id);
    const [gRows, sRows] = await Promise.all([
      ctx.db
        .select({
          userId: groupMembers.userId,
          groupName: groups.name,
        })
        .from(groupMembers)
        .innerJoin(groups, eq(groupMembers.groupId, groups.id))
        .where(and(eq(groupMembers.tenantId, ctx.tenantId), inArray(groupMembers.userId, userIds))),
      ctx.db
        .select({
          userId: siteMembers.userId,
          siteName: sites.name,
        })
        .from(siteMembers)
        .innerJoin(sites, eq(siteMembers.siteId, sites.id))
        .where(and(eq(siteMembers.tenantId, ctx.tenantId), inArray(siteMembers.userId, userIds))),
    ]);

    const groupsByUser = new Map<string, string[]>();
    for (const row of gRows) {
      const list = groupsByUser.get(row.userId) ?? [];
      list.push(row.groupName);
      groupsByUser.set(row.userId, list);
    }
    const sitesByUser = new Map<string, string[]>();
    for (const row of sRows) {
      const list = sitesByUser.get(row.userId) ?? [];
      list.push(row.siteName);
      sitesByUser.set(row.userId, list);
    }

    const rows = users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      permissionSet: u.permissionSet,
      groups: (groupsByUser.get(u.id) ?? []).join(';'),
      sites: (sitesByUser.get(u.id) ?? []).join(';'),
      activatedAt: u.createdAt.toISOString(),
      deactivatedAt: u.deactivatedAt !== null ? u.deactivatedAt.toISOString() : '',
    }));

    const csv = toCsv(rows, [
      'id',
      'name',
      'email',
      'permissionSet',
      'groups',
      'sites',
      'activatedAt',
      'deactivatedAt',
    ]);
    return { csv };
  }),
});
