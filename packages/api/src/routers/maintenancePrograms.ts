/**
 * Maintenance Programs router (To-Do #3).
 *
 * A program bundles triggers (time / distance / usage). Attaching a program
 * to an asset materialises a future-dated Action per trigger; completing one
 * rolls the next forward (see maintenance-actions.ts + actions.setStatus).
 * Reads require `assets.view`; writes require `assets.maintenance.manage`.
 */
import {
  actionAssets,
  actions,
  assets,
  maintenancePrograms,
  maintenanceProgramAssets,
  maintenanceProgramTriggers,
} from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission, tenantProcedure } from '../procedures';
import { router } from '../trpc';
import {
  DEFAULT_MAINTENANCE_TEMPLATES,
  generateMaintenanceAction,
  hasOpenMaintenanceAction,
} from './maintenance-actions';

const idSchema = z.string().length(26);

const triggerInput = z.object({
  title: z.string().min(1).max(200),
  triggerType: z.enum(['time', 'distance', 'usage']),
  intervalDays: z
    .number()
    .int()
    .min(1)
    .max(366 * 20)
    .nullable()
    .optional(),
  intervalValue: z.number().min(0).nullable().optional(),
  usageField: z.string().max(100).nullable().optional(),
  unit: z.string().max(40).nullable().optional(),
});

export const maintenanceProgramsRouter = router({
  templates: tenantProcedure.use(requirePermission('assets.view')).query(() => {
    return { templates: DEFAULT_MAINTENANCE_TEMPLATES };
  }),

  list: tenantProcedure.use(requirePermission('assets.view')).query(async ({ ctx }) => {
    const programs = await ctx.db
      .select()
      .from(maintenancePrograms)
      .where(
        and(eq(maintenancePrograms.tenantId, ctx.tenantId), isNull(maintenancePrograms.archivedAt)),
      )
      .orderBy(asc(maintenancePrograms.name));
    if (programs.length === 0) return { programs: [] as const };

    const ids = programs.map((p) => p.id);
    const [triggers, assignments] = await Promise.all([
      ctx.db
        .select({ programId: maintenanceProgramTriggers.programId })
        .from(maintenanceProgramTriggers)
        .where(inArray(maintenanceProgramTriggers.programId, ids)),
      ctx.db
        .select({ programId: maintenanceProgramAssets.programId })
        .from(maintenanceProgramAssets)
        .where(inArray(maintenanceProgramAssets.programId, ids)),
    ]);
    const triggerCount = new Map<string, number>();
    for (const t of triggers)
      triggerCount.set(t.programId, (triggerCount.get(t.programId) ?? 0) + 1);
    const assetCount = new Map<string, number>();
    for (const a of assignments)
      assetCount.set(a.programId, (assetCount.get(a.programId) ?? 0) + 1);

    return {
      programs: programs.map((p) => ({
        ...p,
        triggerCount: triggerCount.get(p.id) ?? 0,
        assetCount: assetCount.get(p.id) ?? 0,
      })),
    };
  }),

  get: tenantProcedure
    .use(requirePermission('assets.view'))
    .input(z.object({ programId: idSchema }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(maintenancePrograms)
        .where(
          and(
            eq(maintenancePrograms.tenantId, ctx.tenantId),
            eq(maintenancePrograms.id, input.programId),
          ),
        )
        .limit(1);
      const program = rows[0];
      if (program === undefined) throw new TRPCError({ code: 'NOT_FOUND' });

      const triggers = await ctx.db
        .select()
        .from(maintenanceProgramTriggers)
        .where(eq(maintenanceProgramTriggers.programId, program.id))
        .orderBy(
          asc(maintenanceProgramTriggers.sortOrder),
          asc(maintenanceProgramTriggers.createdAt),
        );

      const assignments = await ctx.db
        .select({
          id: maintenanceProgramAssets.id,
          assetId: maintenanceProgramAssets.assetId,
          assetName: assets.name,
        })
        .from(maintenanceProgramAssets)
        .leftJoin(assets, eq(assets.id, maintenanceProgramAssets.assetId))
        .where(eq(maintenanceProgramAssets.programId, program.id));

      return { program, triggers, assets: assignments };
    }),

  create: tenantProcedure
    .use(requirePermission('assets.maintenance.manage'))
    .input(
      z.object({ name: z.string().min(1).max(200), description: z.string().max(2000).default('') }),
    )
    .mutation(async ({ ctx, input }) => {
      const id = newId();
      await ctx.db.insert(maintenancePrograms).values({
        id,
        tenantId: ctx.tenantId,
        name: input.name,
        description: input.description,
        createdBy: ctx.auth.userId,
      });
      return { programId: id };
    }),

  createFromTemplate: tenantProcedure
    .use(requirePermission('assets.maintenance.manage'))
    .input(z.object({ templateKey: z.string().min(1).max(50) }))
    .mutation(async ({ ctx, input }) => {
      const tpl = DEFAULT_MAINTENANCE_TEMPLATES.find((t) => t.key === input.templateKey);
      if (tpl === undefined)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'template-not-found' });

      const programId = newId();
      await ctx.db.transaction(async (tx) => {
        await tx.insert(maintenancePrograms).values({
          id: programId,
          tenantId: ctx.tenantId,
          name: tpl.name,
          description: tpl.description,
          createdBy: ctx.auth.userId,
        });
        if (tpl.triggers.length > 0) {
          await tx.insert(maintenanceProgramTriggers).values(
            tpl.triggers.map((t, i) => ({
              id: newId(),
              tenantId: ctx.tenantId,
              programId,
              title: t.title,
              triggerType: t.triggerType,
              intervalDays: t.intervalDays ?? null,
              intervalValue: t.intervalValue != null ? String(t.intervalValue) : null,
              usageField: t.usageField ?? null,
              unit: t.unit ?? null,
              sortOrder: i,
            })),
          );
        }
      });
      return { programId };
    }),

  update: tenantProcedure
    .use(requirePermission('assets.maintenance.manage'))
    .input(
      z.object({
        programId: idSchema,
        name: z.string().min(1).max(200).optional(),
        description: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const updates: Partial<typeof maintenancePrograms.$inferInsert> = { updatedAt: new Date() };
      if (input.name !== undefined) updates.name = input.name;
      if (input.description !== undefined) updates.description = input.description;
      await ctx.db
        .update(maintenancePrograms)
        .set(updates)
        .where(
          and(
            eq(maintenancePrograms.tenantId, ctx.tenantId),
            eq(maintenancePrograms.id, input.programId),
          ),
        );
      return { ok: true as const };
    }),

  archive: tenantProcedure
    .use(requirePermission('assets.maintenance.manage'))
    .input(z.object({ programId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(maintenancePrograms)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(maintenancePrograms.tenantId, ctx.tenantId),
            eq(maintenancePrograms.id, input.programId),
          ),
        );
      return { ok: true as const };
    }),

  addTrigger: tenantProcedure
    .use(requirePermission('assets.maintenance.manage'))
    .input(triggerInput.extend({ programId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      // Place new triggers at the end.
      const existing = await ctx.db
        .select({ id: maintenanceProgramTriggers.id })
        .from(maintenanceProgramTriggers)
        .where(eq(maintenanceProgramTriggers.programId, input.programId));
      const id = newId();
      await ctx.db.insert(maintenanceProgramTriggers).values({
        id,
        tenantId: ctx.tenantId,
        programId: input.programId,
        title: input.title,
        triggerType: input.triggerType,
        intervalDays: input.intervalDays ?? null,
        intervalValue: input.intervalValue != null ? String(input.intervalValue) : null,
        usageField: input.usageField ?? null,
        unit: input.unit ?? null,
        sortOrder: existing.length,
      });
      return { triggerId: id };
    }),

  updateTrigger: tenantProcedure
    .use(requirePermission('assets.maintenance.manage'))
    .input(triggerInput.partial().extend({ triggerId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      const updates: Partial<typeof maintenanceProgramTriggers.$inferInsert> = {};
      if (input.title !== undefined) updates.title = input.title;
      if (input.triggerType !== undefined) updates.triggerType = input.triggerType;
      if (input.intervalDays !== undefined) updates.intervalDays = input.intervalDays;
      if (input.intervalValue !== undefined)
        updates.intervalValue = input.intervalValue != null ? String(input.intervalValue) : null;
      if (input.usageField !== undefined) updates.usageField = input.usageField;
      if (input.unit !== undefined) updates.unit = input.unit;
      await ctx.db
        .update(maintenanceProgramTriggers)
        .set(updates)
        .where(
          and(
            eq(maintenanceProgramTriggers.tenantId, ctx.tenantId),
            eq(maintenanceProgramTriggers.id, input.triggerId),
          ),
        );
      return { ok: true as const };
    }),

  removeTrigger: tenantProcedure
    .use(requirePermission('assets.maintenance.manage'))
    .input(z.object({ triggerId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(maintenanceProgramTriggers)
        .where(
          and(
            eq(maintenanceProgramTriggers.tenantId, ctx.tenantId),
            eq(maintenanceProgramTriggers.id, input.triggerId),
          ),
        );
      return { ok: true as const };
    }),

  /**
   * Attach a program to an asset and materialise a future-dated Action for
   * each trigger (skipping any trigger that already has an open action for
   * this asset). Idempotent.
   */
  attachAsset: tenantProcedure
    .use(requirePermission('assets.maintenance.manage'))
    .input(z.object({ programId: idSchema, assetId: z.string().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const asset = await ctx.db
        .select({ id: assets.id, name: assets.name })
        .from(assets)
        .where(and(eq(assets.tenantId, ctx.tenantId), eq(assets.id, input.assetId)))
        .limit(1);
      if (asset[0] === undefined)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'asset-not-found' });

      await ctx.db
        .insert(maintenanceProgramAssets)
        .values({
          id: newId(),
          tenantId: ctx.tenantId,
          programId: input.programId,
          assetId: input.assetId,
        })
        .onConflictDoNothing();

      const triggers = await ctx.db
        .select()
        .from(maintenanceProgramTriggers)
        .where(eq(maintenanceProgramTriggers.programId, input.programId));

      let created = 0;
      for (const trigger of triggers) {
        const open = await hasOpenMaintenanceAction(
          ctx.db,
          ctx.tenantId,
          trigger.id,
          input.assetId,
        );
        if (open) continue;
        await generateMaintenanceAction(ctx.db, {
          tenantId: ctx.tenantId,
          userId: ctx.auth.userId,
          trigger,
          assetId: input.assetId,
          assetName: asset[0].name,
        });
        created += 1;
      }
      return { ok: true as const, actionsCreated: created };
    }),

  detachAsset: tenantProcedure
    .use(requirePermission('assets.maintenance.manage'))
    .input(z.object({ programId: idSchema, assetId: z.string().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(maintenanceProgramAssets)
        .where(
          and(
            eq(maintenanceProgramAssets.tenantId, ctx.tenantId),
            eq(maintenanceProgramAssets.programId, input.programId),
            eq(maintenanceProgramAssets.assetId, input.assetId),
          ),
        );
      return { ok: true as const };
    }),

  /** Programs attached to an asset + open maintenance actions for the asset. */
  listForAsset: tenantProcedure
    .use(requirePermission('assets.view'))
    .input(z.object({ assetId: z.string().min(1).max(100) }))
    .query(async ({ ctx, input }) => {
      const assignments = await ctx.db
        .select({
          programId: maintenanceProgramAssets.programId,
          programName: maintenancePrograms.name,
        })
        .from(maintenanceProgramAssets)
        .innerJoin(
          maintenancePrograms,
          eq(maintenancePrograms.id, maintenanceProgramAssets.programId),
        )
        .where(
          and(
            eq(maintenanceProgramAssets.tenantId, ctx.tenantId),
            eq(maintenanceProgramAssets.assetId, input.assetId),
          ),
        );

      const openActions = await ctx.db
        .select({
          id: actions.id,
          title: actions.title,
          status: actions.status,
          dueAt: actions.dueAt,
          description: actions.description,
          referenceNumber: actions.referenceNumber,
        })
        .from(actions)
        .innerJoin(actionAssets, eq(actionAssets.actionId, actions.id))
        .where(
          and(
            eq(actions.tenantId, ctx.tenantId),
            eq(actions.sourceType, 'maintenance'),
            eq(actionAssets.assetId, input.assetId),
          ),
        )
        .orderBy(desc(actions.createdAt));

      return { programs: assignments, actions: openActions };
    }),
});
