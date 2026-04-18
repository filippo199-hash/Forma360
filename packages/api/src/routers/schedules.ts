/**
 * Schedules admin router. Phase 2 PR 32.
 *
 * Every mutation is gated by `templates.schedules.manage`. Read paths
 * for the "Upcoming inspections" surface use `inspections.view`.
 *
 * Procedures:
 *   - list                 List all schedules in the tenant, optional
 *                          templateId filter.
 *   - get                  One schedule + pending-occurrence count.
 *   - listForTemplate      Schedules attached to a given template.
 *   - create / update      Validates the RRULE string via the `rrule`
 *                          package helper; ensures at least one
 *                          assignee between users + groups.
 *   - pause / resume       Flip `paused`.
 *   - delete               Cascades occurrences.
 *   - materialiseNow       Manual enqueue of a materialise job for a
 *                          given schedule.
 *   - listUpcoming         Current user's pending occurrences within
 *                          the next 7 days.
 *
 * Also registers a `schedules` dependents resolver used by the
 * template-archive cascade preview.
 */
import {
  scheduledInspectionOccurrences,
  templateSchedules,
  templates,
} from '@forma360/db/schema';
import {
  registerDependentResolver,
  type DependentResolver,
} from '@forma360/permissions/dependents';
import { newId } from '@forma360/shared/id';
import { TRPCError } from '@trpc/server';
// `rrule` is CJS; Node 22 ESM can't synthesize its named exports. See
// packages/jobs/src/workers/schedule-rrule.ts for the same pattern.
import rrulePkg from 'rrule';
const { RRule, rrulestr } = rrulePkg;
import { and, count, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission, tenantProcedure } from '../procedures';
import { router } from '../trpc';

// ─── Dependents resolver ───────────────────────────────────────────────────

const schedulesResolver: DependentResolver = async (deps, input) => {
  if (input.entity === 'template') {
    const rows = await deps.db
      .select({ c: count() })
      .from(templateSchedules)
      .where(
        and(
          eq(templateSchedules.tenantId, input.tenantId),
          eq(templateSchedules.templateId, input.id),
        ),
      );
    return Number(rows[0]?.c ?? 0);
  }
  return 0;
};
registerDependentResolver('notifications', schedulesResolver);

// ─── RRULE validation ──────────────────────────────────────────────────────

/**
 * Parse an RRULE string. Returns null on success, otherwise a message
 * suitable for a BAD_REQUEST cause.
 */
function validateRrule(rrule: string): string | null {
  try {
    const parsed = rrulestr(rrule, { dtstart: new Date() });
    if (parsed instanceof RRule) {
      if (parsed.options.freq === undefined || parsed.options.freq === null) {
        return 'RRULE must include a FREQ (e.g. FREQ=DAILY)';
      }
    }
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'Invalid RRULE';
  }
}

function nextOccurrences(
  rrule: string,
  startAt: Date,
  n: number,
  from: Date,
  endAt: Date | null,
): Date[] {
  try {
    const rule = rrulestr(rrule, { dtstart: startAt });
    const out: Date[] = [];
    let cursor: Date | null = from;
    while (out.length < n) {
      const next: Date | null = rule.after(cursor ?? from, false);
      if (next === null) break;
      if (endAt !== null && next > endAt) break;
      out.push(next);
      cursor = next;
    }
    return out;
  } catch {
    return [];
  }
}

// ─── Zod schemas ───────────────────────────────────────────────────────────

const idSchema = z.string().length(26);
const idArraySchema = z.array(idSchema).max(500).default([]);

const baseScheduleInput = z.object({
  name: z.string().min(1).max(200),
  timezone: z.string().min(1).max(100).default('UTC'),
  rrule: z.string().min(1).max(2000),
  startAt: z.string().datetime(),
  endAt: z.string().datetime().nullable().default(null),
  assigneeUserIds: z.array(z.string()).max(500).default([]),
  assigneeGroupIds: idArraySchema,
  siteIds: idArraySchema,
  reminderMinutesBefore: z.number().int().min(1).max(60 * 24 * 30).nullable().default(null),
});

const createInput = baseScheduleInput.extend({
  templateId: idSchema,
});

const updateInput = baseScheduleInput.extend({
  scheduleId: idSchema,
});

const idInput = z.object({ scheduleId: idSchema });

function assertValidRrule(rrule: string): void {
  const err = validateRrule(rrule);
  if (err !== null) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Invalid RRULE: ${err}` });
  }
}

function assertAtLeastOneAssignee(input: z.infer<typeof baseScheduleInput>): void {
  if (input.assigneeUserIds.length === 0 && input.assigneeGroupIds.length === 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'A schedule must have at least one assignee user or group.',
    });
  }
}

// ─── Router ────────────────────────────────────────────────────────────────

export const schedulesRouter = router({
  list: tenantProcedure
    .use(requirePermission('templates.schedules.manage'))
    .input(
      z
        .object({
          templateId: idSchema.optional(),
          paused: z.boolean().optional(),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const where = [eq(templateSchedules.tenantId, ctx.tenantId)];
      if (input.templateId !== undefined) {
        where.push(eq(templateSchedules.templateId, input.templateId));
      }
      if (input.paused !== undefined) {
        where.push(eq(templateSchedules.paused, input.paused));
      }
      return ctx.db
        .select()
        .from(templateSchedules)
        .where(and(...where))
        .orderBy(desc(templateSchedules.updatedAt));
    }),

  listForTemplate: tenantProcedure
    .use(requirePermission('templates.schedules.manage'))
    .input(z.object({ templateId: idSchema }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(templateSchedules)
        .where(
          and(
            eq(templateSchedules.tenantId, ctx.tenantId),
            eq(templateSchedules.templateId, input.templateId),
          ),
        )
        .orderBy(desc(templateSchedules.updatedAt));
    }),

  get: tenantProcedure
    .use(requirePermission('templates.schedules.manage'))
    .input(idInput)
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(templateSchedules)
        .where(
          and(
            eq(templateSchedules.tenantId, ctx.tenantId),
            eq(templateSchedules.id, input.scheduleId),
          ),
        )
        .limit(1);
      const sched = rows[0];
      if (sched === undefined) throw new TRPCError({ code: 'NOT_FOUND' });

      const pendingRows = await ctx.db
        .select({ c: count() })
        .from(scheduledInspectionOccurrences)
        .where(
          and(
            eq(scheduledInspectionOccurrences.tenantId, ctx.tenantId),
            eq(scheduledInspectionOccurrences.scheduleId, sched.id),
            eq(scheduledInspectionOccurrences.status, 'pending'),
          ),
        );
      const upcoming = nextOccurrences(sched.rrule, sched.startAt, 5, new Date(), sched.endAt);

      return {
        schedule: sched,
        pendingOccurrenceCount: Number(pendingRows[0]?.c ?? 0),
        upcomingPreview: upcoming.map((d) => d.toISOString()),
      };
    }),

  create: tenantProcedure
    .use(requirePermission('templates.schedules.manage'))
    .input(createInput)
    .mutation(async ({ ctx, input }) => {
      assertValidRrule(input.rrule);
      assertAtLeastOneAssignee(input);

      // Confirm template exists + is not archived.
      const tplRows = await ctx.db
        .select()
        .from(templates)
        .where(and(eq(templates.tenantId, ctx.tenantId), eq(templates.id, input.templateId)))
        .limit(1);
      const tpl = tplRows[0];
      if (tpl === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      if (tpl.archivedAt !== null) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot schedule an archived template.',
        });
      }

      const id = newId();
      await ctx.db.insert(templateSchedules).values({
        id,
        tenantId: ctx.tenantId,
        templateId: input.templateId,
        name: input.name,
        timezone: input.timezone,
        rrule: input.rrule,
        startAt: new Date(input.startAt),
        endAt: input.endAt === null ? null : new Date(input.endAt),
        assigneeUserIds: input.assigneeUserIds,
        assigneeGroupIds: input.assigneeGroupIds,
        siteIds: input.siteIds,
        reminderMinutesBefore: input.reminderMinutesBefore,
        paused: false,
        createdBy: ctx.auth.userId,
      });

      ctx.logger.info({ scheduleId: id, templateId: input.templateId }, '[schedules] created');
      return { scheduleId: id };
    }),

  update: tenantProcedure
    .use(requirePermission('templates.schedules.manage'))
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      assertValidRrule(input.rrule);
      assertAtLeastOneAssignee(input);

      const rows = await ctx.db
        .select()
        .from(templateSchedules)
        .where(
          and(
            eq(templateSchedules.tenantId, ctx.tenantId),
            eq(templateSchedules.id, input.scheduleId),
          ),
        )
        .limit(1);
      if (rows[0] === undefined) throw new TRPCError({ code: 'NOT_FOUND' });

      await ctx.db
        .update(templateSchedules)
        .set({
          name: input.name,
          timezone: input.timezone,
          rrule: input.rrule,
          startAt: new Date(input.startAt),
          endAt: input.endAt === null ? null : new Date(input.endAt),
          assigneeUserIds: input.assigneeUserIds,
          assigneeGroupIds: input.assigneeGroupIds,
          siteIds: input.siteIds,
          reminderMinutesBefore: input.reminderMinutesBefore,
          // Invalidate the materialise cursor so the next tick refreshes
          // occurrences against the new rule.
          lastMaterialisedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(templateSchedules.id, input.scheduleId));
      return { ok: true as const };
    }),

  pause: tenantProcedure
    .use(requirePermission('templates.schedules.manage'))
    .input(idInput)
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(templateSchedules)
        .set({ paused: true, updatedAt: new Date() })
        .where(
          and(
            eq(templateSchedules.tenantId, ctx.tenantId),
            eq(templateSchedules.id, input.scheduleId),
          ),
        );
      return { ok: true as const };
    }),

  resume: tenantProcedure
    .use(requirePermission('templates.schedules.manage'))
    .input(idInput)
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(templateSchedules)
        .set({ paused: false, lastMaterialisedAt: null, updatedAt: new Date() })
        .where(
          and(
            eq(templateSchedules.tenantId, ctx.tenantId),
            eq(templateSchedules.id, input.scheduleId),
          ),
        );
      return { ok: true as const };
    }),

  delete: tenantProcedure
    .use(requirePermission('templates.schedules.manage'))
    .input(idInput)
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(templateSchedules)
        .where(
          and(
            eq(templateSchedules.tenantId, ctx.tenantId),
            eq(templateSchedules.id, input.scheduleId),
          ),
        );
      return { ok: true as const };
    }),

  /**
   * Manual force-run — enqueues a materialise job for one schedule.
   * The context's `enqueue` helper is wired to the jobs queue in prod;
   * in tests it defaults to a noop so this route can be called without
   * a live Redis.
   */
  materialiseNow: tenantProcedure
    .use(requirePermission('templates.schedules.manage'))
    .input(idInput)
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({ id: templateSchedules.id })
        .from(templateSchedules)
        .where(
          and(
            eq(templateSchedules.tenantId, ctx.tenantId),
            eq(templateSchedules.id, input.scheduleId),
          ),
        )
        .limit(1);
      if (rows[0] === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      ctx.enqueue('forma360:schedule-materialise', {
        tenantId: ctx.tenantId,
        scheduleId: input.scheduleId,
      });
      return { ok: true as const };
    }),

  /**
   * Current-user-scoped "what's on my plate soon" list. Used by the
   * Upcoming dashboard widget. Returns pending occurrences in the next
   * 7 days, ordered soonest-first.
   */
  listUpcoming: tenantProcedure
    .use(requirePermission('inspections.view'))
    .input(z.object({ daysAhead: z.number().int().min(1).max(90).default(7) }).default({}))
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const upper = new Date(now.getTime() + input.daysAhead * 24 * 60 * 60 * 1000);

      return ctx.db
        .select({
          id: scheduledInspectionOccurrences.id,
          scheduleId: scheduledInspectionOccurrences.scheduleId,
          templateId: scheduledInspectionOccurrences.templateId,
          occurrenceAt: scheduledInspectionOccurrences.occurrenceAt,
          status: scheduledInspectionOccurrences.status,
          inspectionId: scheduledInspectionOccurrences.inspectionId,
          siteId: scheduledInspectionOccurrences.siteId,
        })
        .from(scheduledInspectionOccurrences)
        .where(
          and(
            eq(scheduledInspectionOccurrences.tenantId, ctx.tenantId),
            eq(scheduledInspectionOccurrences.assigneeUserId, ctx.auth.userId),
            eq(scheduledInspectionOccurrences.status, 'pending'),
            gte(scheduledInspectionOccurrences.occurrenceAt, now),
            lte(scheduledInspectionOccurrences.occurrenceAt, upper),
          ),
        )
        .orderBy(scheduledInspectionOccurrences.occurrenceAt);
    }),
});

// ─── Helper for other modules ──────────────────────────────────────────────

/**
 * Flip every schedule for a template to paused. Called from
 * templates.archive — see T-E05. Returns the number of rows updated.
 */
export async function pauseSchedulesForTemplate(
  db: Parameters<DependentResolver>[0]['db'],
  tenantId: string,
  templateId: string,
): Promise<number> {
  const result = await db
    .update(templateSchedules)
    .set({ paused: true, updatedAt: new Date() })
    .where(
      and(
        eq(templateSchedules.tenantId, tenantId),
        eq(templateSchedules.templateId, templateId),
        // Only flip not-already-paused rows so "pause count" is meaningful.
        eq(templateSchedules.paused, false),
      ),
    );
  return (result as unknown as { rowCount?: number }).rowCount ?? 0;
}

// Silence unused imports for helpers that are sometimes tree-shaken
// during typecheck-only runs.
void inArray;
void sql;
