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

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const updateBrandingInput = z.object({
  logoStorageKey: z.string().max(500).optional(),
  primaryColor: hexColor.optional(),
  /** Company website the palette was derived from. https only (ADR 0018). */
  websiteUrl: z.string().url().max(2048).startsWith('https://').optional(),
  accentColor: hexColor.optional(),
  /** Up to 8 `#rrggbb` chart series colours, adjacent-contrast ordered. */
  chartColors: z.array(hexColor).max(8).optional(),
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
        retentionMonths: tenants.retentionMonths,
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
  /**
   * PF-31 retention v1: months to keep notification-centre rows. Null =
   * keep forever. Deliberately narrow — statutory safety records are
   * never in scope; widening retention is a per-module product decision.
   */
  setRetention: tenantProcedure
    .use(requirePermission('org.settings'))
    .input(z.object({ retentionMonths: z.number().int().min(1).max(120).nullable() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(tenants)
        .set({ retentionMonths: input.retentionMonths, updatedAt: new Date() })
        .where(eq(tenants.id, ctx.tenantId));
      return { ok: true as const };
    }),

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

  /**
   * Admin-only patch on the tenant `branding` block inside `settings`. When
   * the input carries any key we set `branding` to the patch; when it is
   * empty we clear branding entirely (set to `undefined`). Other settings
   * keys (terminology, siteLabels) are preserved by the read-merge-write.
   */
  updateBranding: tenantProcedure
    .use(requirePermission('org.settings'))
    .input(updateBrandingInput)
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
      const next: TenantSettings = { ...current };
      const hasAnyKey =
        input.logoStorageKey !== undefined ||
        input.primaryColor !== undefined ||
        input.websiteUrl !== undefined ||
        input.accentColor !== undefined ||
        input.chartColors !== undefined;
      if (hasAnyKey) {
        next.branding = {
          ...(input.logoStorageKey !== undefined ? { logoStorageKey: input.logoStorageKey } : {}),
          ...(input.primaryColor !== undefined ? { primaryColor: input.primaryColor } : {}),
          ...(input.websiteUrl !== undefined ? { websiteUrl: input.websiteUrl } : {}),
          ...(input.accentColor !== undefined ? { accentColor: input.accentColor } : {}),
          ...(input.chartColors !== undefined ? { chartColors: input.chartColors } : {}),
        };
      } else {
        // No keys present → clear branding entirely.
        delete next.branding;
      }
      await ctx.db
        .update(tenants)
        .set({ settings: next, updatedAt: new Date() })
        .where(eq(tenants.id, ctx.tenantId));
      ctx.logger.info({ tenantId: ctx.tenantId }, '[tenants] branding updated');
      return { settings: next };
    }),
});
