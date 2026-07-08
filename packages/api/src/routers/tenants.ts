/**
 * Tenants router — read + update the current tenant.
 *
 *   - get      — current tenant + member count. Available to any authed
 *                user (no permission gate) so the settings/company page
 *                can render even for non-admins (it shows read-only).
 *   - update   — admin-only (`org.settings`) patch on `name`. Slug is
 *                read-only after creation; member count is derived.
 */
import type { TenantSettings } from '@forma360/db/schema';
import { tenants, user } from '@forma360/db/schema';
import { TRPCError } from '@trpc/server';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission, tenantProcedure } from '../procedures';
import { router } from '../trpc';

const updateInput = z.object({
  name: z.string().min(1).max(100),
});

const updateSettingsInput = z.object({
  terminology: z.enum(['sites', 'projects', 'both']),
});

export const tenantsRouter = router({
  /**
   * Return the caller's current tenant plus a small set of derived fields
   * (member count). Caller must be authed + bound to a tenant; otherwise
   * `tenantProcedure` rejects.
   */
  get: tenantProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        createdAt: tenants.createdAt,
        updatedAt: tenants.updatedAt,
        archivedAt: tenants.archivedAt,
        settings: tenants.settings,
      })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1);
    const tenant = rows[0];
    if (tenant === undefined) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }

    const memberRows = await ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(user)
      .where(and(eq(user.tenantId, ctx.tenantId), isNull(user.deactivatedAt)));
    const memberCount = memberRows[0]?.count ?? 0;

    return {
      tenant,
      memberCount,
    };
  }),

  /**
   * Admin-only patch on the tenant row. Only `name` is editable; the
   * slug is fixed at sign-up so any existing share links / public URLs
   * keep working.
   */
  update: tenantProcedure
    .use(requirePermission('org.settings'))
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db
        .update(tenants)
        .set({ name: input.name, updatedAt: new Date() })
        .where(eq(tenants.id, ctx.tenantId))
        .returning({
          id: tenants.id,
          name: tenants.name,
          slug: tenants.slug,
        });
      const tenant = result[0];
      if (tenant === undefined) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      ctx.logger.info({ tenantId: ctx.tenantId, name: input.name }, '[tenants] updated');
      return { tenant };
    }),

  /**
   * Admin-only patch on the tenant-wide `settings` jsonb. Merges the given
   * keys over the existing settings so unrelated flags (e.g. `siteLabels`)
   * are preserved. Currently exposes only `terminology`.
   */
  updateSettings: tenantProcedure
    .use(requirePermission('org.settings'))
    .input(updateSettingsInput)
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({ settings: tenants.settings })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .limit(1);
      const current = rows[0]?.settings;
      if (current === undefined) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      const next: TenantSettings = { ...current, terminology: input.terminology };
      await ctx.db
        .update(tenants)
        .set({ settings: next, updatedAt: new Date() })
        .where(eq(tenants.id, ctx.tenantId));
      ctx.logger.info(
        { tenantId: ctx.tenantId, terminology: input.terminology },
        '[tenants] settings updated',
      );
      return { settings: next };
    }),
});
