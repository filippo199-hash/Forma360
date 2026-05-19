/**
 * Maintenance Plans router — Phase 5B.
 *
 * Time-based (every N days) or usage-based (every N km/hours) plans.
 * Each plan can be linked to multiple assets via maintenance_plan_assets.
 *
 * Status computation (returned alongside each plan-asset link):
 *   - awaiting_first_reading: usage plan with no reading yet (AS-E07)
 *   - on_schedule | approaching | overdue — calculated at query time
 */
import { assetReadings, assets, maintenancePlanAssets, maintenancePlans } from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission, tenantProcedure } from '../procedures';
import { router } from '../trpc';

const planIdInput = z.object({ planId: z.string().length(26) });

const createInput = z.object({
  name: z.string().min(1).max(500),
  description: z.string().max(5000).default(''),
  planType: z.enum(['time', 'usage']).default('time'),
  intervalDays: z.number().int().min(1).optional(),
  intervalUsage: z.number().min(0).optional(),
  usageField: z.string().max(200).optional(),
  usageUnit: z.string().max(50).default(''),
  lastServiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  lastServiceValue: z.number().optional(),
  notificationDaysBefore: z.array(z.number().int().min(0)).default([]),
});

const updateInput = z.object({
  planId: z.string().length(26),
  name: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional(),
  planType: z.enum(['time', 'usage']).optional(),
  intervalDays: z.number().int().min(1).nullable().optional(),
  intervalUsage: z.number().min(0).nullable().optional(),
  usageField: z.string().max(200).nullable().optional(),
  usageUnit: z.string().max(50).optional(),
  lastServiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  lastServiceValue: z.number().nullable().optional(),
  notificationDaysBefore: z.array(z.number().int().min(0)).optional(),
});

const linkAssetsInput = z.object({
  planId: z.string().length(26),
  assetIds: z.array(z.string().length(26)).min(1).max(100),
});

const unlinkAssetInput = z.object({
  planId: z.string().length(26),
  assetId: z.string().length(26),
});

const updateServiceInput = z.object({
  planId: z.string().length(26),
  assetId: z.string().length(26),
  lastServiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  lastServiceValue: z.number().optional(),
});

/**
 * Compute the maintenance status for a plan-asset combination.
 * Returns: 'awaiting_first_reading' | 'on_schedule' | 'approaching' | 'overdue'
 */
function computeMaintenanceStatus(args: {
  planType: string;
  intervalDays: number | null;
  intervalUsage: string | null;
  usageField: string | null;
  lastServiceDate: string | null;
  lastServiceValue: string | null;
  latestReadingValue: string | null;
  notificationDaysBefore: unknown;
}): 'awaiting_first_reading' | 'on_schedule' | 'approaching' | 'overdue' {
  const today = new Date();

  if (args.planType === 'usage') {
    if (args.latestReadingValue === null) return 'awaiting_first_reading';
    const lastVal = Number(args.lastServiceValue ?? 0);
    const currentVal = Number(args.latestReadingValue);
    const interval = Number(args.intervalUsage ?? 0);
    if (interval <= 0) return 'on_schedule';
    const usedSinceService = currentVal - lastVal;
    const remaining = interval - usedSinceService;
    if (remaining <= 0) return 'overdue';
    // "approaching" = within 10% of interval remaining
    if (remaining <= interval * 0.1) return 'approaching';
    return 'on_schedule';
  }

  // Time-based
  if (args.lastServiceDate === null) return 'on_schedule';
  const intervalDays = args.intervalDays ?? 0;
  if (intervalDays <= 0) return 'on_schedule';

  const lastService = new Date(args.lastServiceDate);
  const dueDate = new Date(lastService);
  dueDate.setDate(dueDate.getDate() + intervalDays);

  const msPerDay = 86_400_000;
  const daysUntilDue = Math.ceil((dueDate.getTime() - today.getTime()) / msPerDay);

  if (daysUntilDue < 0) return 'overdue';

  // Check if within notification window.
  const notifDays = Array.isArray(args.notificationDaysBefore)
    ? (args.notificationDaysBefore as number[])
    : [];
  const maxNotif = notifDays.length > 0 ? Math.max(...notifDays) : 7;
  if (daysUntilDue <= maxNotif) return 'approaching';

  return 'on_schedule';
}

export const maintenancePlansRouter = router({
  list: tenantProcedure
    .use(requirePermission('assets.view'))
    .input(
      z
        .object({ includeArchived: z.boolean().default(false) })
        .default({ includeArchived: false }),
    )
    .query(async ({ ctx, input }) => {
      const where = [eq(maintenancePlans.tenantId, ctx.tenantId)];
      if (!input.includeArchived) where.push(isNull(maintenancePlans.archivedAt));
      return ctx.db
        .select()
        .from(maintenancePlans)
        .where(and(...where))
        .orderBy(maintenancePlans.name);
    }),

  get: tenantProcedure
    .use(requirePermission('assets.view'))
    .input(planIdInput)
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(maintenancePlans)
        .where(
          and(eq(maintenancePlans.tenantId, ctx.tenantId), eq(maintenancePlans.id, input.planId)),
        )
        .limit(1);
      const plan = rows[0];
      if (plan === undefined) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'maintenance-plan-not-found' });
      }

      // Load linked assets.
      const linkedRows = await ctx.db
        .select({
          id: maintenancePlanAssets.id,
          assetId: maintenancePlanAssets.assetId,
          assetName: assets.name,
          lastServiceDate: maintenancePlanAssets.lastServiceDate,
          lastServiceValue: maintenancePlanAssets.lastServiceValue,
        })
        .from(maintenancePlanAssets)
        .leftJoin(assets, eq(assets.id, maintenancePlanAssets.assetId))
        .where(eq(maintenancePlanAssets.planId, input.planId));

      return { plan, linkedAssets: linkedRows };
    }),

  /**
   * Flat maintenance table: all plan × asset combinations across all plans,
   * with computed status. Used by the /maintenance page.
   */
  table: tenantProcedure
    .use(requirePermission('assets.view'))
    .query(async ({ ctx }) => {
      const links = await ctx.db
        .select({
          planId: maintenancePlanAssets.planId,
          assetId: maintenancePlanAssets.assetId,
          assetName: assets.name,
          lastServiceDate: maintenancePlanAssets.lastServiceDate,
          lastServiceValue: maintenancePlanAssets.lastServiceValue,
          planName: maintenancePlans.name,
          planType: maintenancePlans.planType,
          intervalDays: maintenancePlans.intervalDays,
          intervalUsage: maintenancePlans.intervalUsage,
          usageField: maintenancePlans.usageField,
          usageUnit: maintenancePlans.usageUnit,
          notificationDaysBefore: maintenancePlans.notificationDaysBefore,
        })
        .from(maintenancePlanAssets)
        .leftJoin(maintenancePlans, eq(maintenancePlans.id, maintenancePlanAssets.planId))
        .leftJoin(assets, eq(assets.id, maintenancePlanAssets.assetId))
        .where(and(eq(maintenancePlans.tenantId, ctx.tenantId), isNull(maintenancePlans.archivedAt)));

      // For each usage-type link, fetch the latest reading.
      const result = await Promise.all(
        links.map(async (link) => {
          let latestReadingValue: string | null = null;
          if (link.planType === 'usage' && link.usageField !== null) {
            const readingRows = await ctx.db
              .select({ value: assetReadings.value })
              .from(assetReadings)
              .where(
                and(
                  eq(assetReadings.assetId, link.assetId ?? ''),
                  eq(assetReadings.fieldName, link.usageField ?? ''),
                ),
              )
              .orderBy(desc(assetReadings.capturedAt))
              .limit(1);
            latestReadingValue = readingRows[0]?.value ?? null;
          }

          const status = computeMaintenanceStatus({
            planType: link.planType ?? 'time',
            intervalDays: link.intervalDays,
            intervalUsage: link.intervalUsage,
            usageField: link.usageField,
            lastServiceDate: link.lastServiceDate,
            lastServiceValue: link.lastServiceValue,
            latestReadingValue,
            notificationDaysBefore: link.notificationDaysBefore,
          });

          return { ...link, latestReadingValue, status };
        }),
      );

      return result;
    }),

  create: tenantProcedure
    .use(requirePermission('assets.maintenance.manage'))
    .input(createInput)
    .mutation(async ({ ctx, input }) => {
      const id = newId();
      const now = new Date();
      await ctx.db.insert(maintenancePlans).values({
        id,
        tenantId: ctx.tenantId,
        name: input.name,
        description: input.description,
        planType: input.planType,
        intervalDays: input.intervalDays ?? null,
        intervalUsage: input.intervalUsage !== undefined ? String(input.intervalUsage) : null,
        usageField: input.usageField ?? null,
        usageUnit: input.usageUnit,
        lastServiceDate: input.lastServiceDate ?? null,
        lastServiceValue:
          input.lastServiceValue !== undefined ? String(input.lastServiceValue) : null,
        notificationDaysBefore: input.notificationDaysBefore,
        createdAt: now,
        updatedAt: now,
      });
      return { planId: id };
    }),

  update: tenantProcedure
    .use(requirePermission('assets.maintenance.manage'))
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(maintenancePlans)
        .where(
          and(eq(maintenancePlans.tenantId, ctx.tenantId), eq(maintenancePlans.id, input.planId)),
        )
        .limit(1);
      const plan = rows[0];
      if (plan === undefined) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'maintenance-plan-not-found' });
      }
      if (plan.archivedAt !== null) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'maintenance-plan-archived' });
      }

      const updates: Partial<typeof maintenancePlans.$inferInsert> = { updatedAt: new Date() };
      if (input.name !== undefined) updates.name = input.name;
      if (input.description !== undefined) updates.description = input.description;
      if (input.planType !== undefined) updates.planType = input.planType;
      if (input.intervalDays !== undefined) updates.intervalDays = input.intervalDays;
      if (input.intervalUsage !== undefined)
        updates.intervalUsage = input.intervalUsage === null ? null : String(input.intervalUsage);
      if (input.usageField !== undefined) updates.usageField = input.usageField;
      if (input.usageUnit !== undefined) updates.usageUnit = input.usageUnit;
      if (input.lastServiceDate !== undefined) updates.lastServiceDate = input.lastServiceDate;
      if (input.lastServiceValue !== undefined)
        updates.lastServiceValue =
          input.lastServiceValue === null ? null : String(input.lastServiceValue);
      if (input.notificationDaysBefore !== undefined)
        updates.notificationDaysBefore = input.notificationDaysBefore;

      await ctx.db.update(maintenancePlans).set(updates).where(eq(maintenancePlans.id, plan.id));
      return { ok: true as const };
    }),

  archive: tenantProcedure
    .use(requirePermission('assets.maintenance.manage'))
    .input(planIdInput)
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(maintenancePlans)
        .where(
          and(eq(maintenancePlans.tenantId, ctx.tenantId), eq(maintenancePlans.id, input.planId)),
        )
        .limit(1);
      const plan = rows[0];
      if (plan === undefined) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'maintenance-plan-not-found' });
      }
      if (plan.archivedAt !== null) return { ok: true as const };
      await ctx.db
        .update(maintenancePlans)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(maintenancePlans.id, plan.id));
      return { ok: true as const };
    }),

  /** Link assets to a plan. Idempotent on duplicates. */
  linkAssets: tenantProcedure
    .use(requirePermission('assets.maintenance.manage'))
    .input(linkAssetsInput)
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({ id: maintenancePlans.id })
        .from(maintenancePlans)
        .where(
          and(eq(maintenancePlans.tenantId, ctx.tenantId), eq(maintenancePlans.id, input.planId)),
        )
        .limit(1);
      if (rows[0] === undefined) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'maintenance-plan-not-found' });
      }

      const values = input.assetIds.map((assetId) => ({
        id: newId(),
        planId: input.planId,
        assetId,
      }));
      await ctx.db.insert(maintenancePlanAssets).values(values).onConflictDoNothing();
      return { ok: true as const };
    }),

  unlinkAsset: tenantProcedure
    .use(requirePermission('assets.maintenance.manage'))
    .input(unlinkAssetInput)
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(maintenancePlanAssets)
        .where(
          and(
            eq(maintenancePlanAssets.planId, input.planId),
            eq(maintenancePlanAssets.assetId, input.assetId),
          ),
        );
      return { ok: true as const };
    }),

  updateServiceRecord: tenantProcedure
    .use(requirePermission('assets.maintenance.manage'))
    .input(updateServiceInput)
    .mutation(async ({ ctx, input }) => {
      const links = await ctx.db
        .select({ id: maintenancePlanAssets.id })
        .from(maintenancePlanAssets)
        .where(
          and(
            eq(maintenancePlanAssets.planId, input.planId),
            eq(maintenancePlanAssets.assetId, input.assetId),
          ),
        )
        .limit(1);
      if (links[0] === undefined) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'plan-asset-link-not-found' });
      }

      const updates: Partial<typeof maintenancePlanAssets.$inferInsert> = {};
      if (input.lastServiceDate !== undefined) updates.lastServiceDate = input.lastServiceDate;
      if (input.lastServiceValue !== undefined)
        updates.lastServiceValue = String(input.lastServiceValue);

      await ctx.db
        .update(maintenancePlanAssets)
        .set(updates)
        .where(eq(maintenancePlanAssets.id, links[0].id));
      return { ok: true as const };
    }),
});
