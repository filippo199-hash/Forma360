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
import { isValidTimeZone } from '@forma360/shared/timezone';
import { TRPCError } from '@trpc/server';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission, tenantProcedure } from '../procedures';
import { router } from '../trpc';

const updateInput = z.object({
  name: z.string().min(1).max(100),
});

const updateSettingsInput = z.object({
  terminology: z.enum(['sites', 'projects', 'both']).optional(),
  /**
   * BUG-14 (per-site): the tenant's default clock for printed documents. A
   * site may override it; absent falls back to the deployment's
   * `APP_TIMEZONE`. Empty string clears it.
   *
   * Validated rather than trusted: ICU accepts bare abbreviations and
   * resolves them to something nobody means — `BST` is Bangladesh Standard
   * Time — so an unchecked string can print a permit six hours out.
   */
  timezone: z
    .string()
    .max(64)
    .optional()
    .refine((v) => v === undefined || v === '' || isValidTimeZone(v), {
      message: 'invalid-timezone',
    }),
});

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/**
 * WCAG relative luminance of a `#rrggbb` colour (0 = black, 1 = white).
 * Kept inline (a few lines) rather than importing the web-only theme
 * helper: the app-side `buildTenantThemeCss` discards a near-white primary
 * (contrast would fail) and falls back to the default theme — so accepting
 * one here would toast "saved" and then silently ignore it. Refusing at
 * the boundary keeps the save honest. Mirror of NEAR_WHITE_LUMINANCE in
 * apps/web/src/lib/tenant-theme.ts.
 */
function relativeLuminance(hex: string): number {
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

const NEAR_WHITE_LUMINANCE = 0.8;

/** A primary/accent so pale the renderer would drop the whole palette. */
const usablePaletteColor = hexColor.refine(
  (c) => relativeLuminance(c) <= NEAR_WHITE_LUMINANCE,
  'Colour is too light to use as a brand colour — pick a darker shade',
);

const updateBrandingInput = z.object({
  logoStorageKey: z.string().max(500).optional(),
  primaryColor: usablePaletteColor.optional(),
  /** Company website the palette was derived from. https only (ADR 0018). */
  websiteUrl: z.string().url().max(2048).startsWith('https://').optional(),
  accentColor: usablePaletteColor.optional(),
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
      /**
       * What an unset `settings.timezone` actually resolves to. The company
       * settings page offered "Use the server default" without ever saying
       * what the server default IS — which is the one thing an admin needs
       * in order to decide whether to override it.
       */
      serverTimezone: ctx.appTimezone,
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
      const next: TenantSettings = { ...current };
      if (input.terminology !== undefined) next.terminology = input.terminology;
      if (input.timezone !== undefined) {
        if (input.timezone === '') delete next.timezone;
        else next.timezone = input.timezone;
      }
      await ctx.db
        .update(tenants)
        .set({ settings: next, updatedAt: new Date() })
        .where(eq(tenants.id, ctx.tenantId));
      ctx.logger.info(
        { tenantId: ctx.tenantId, terminology: next.terminology, timezone: next.timezone },
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
