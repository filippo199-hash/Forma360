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
  groups,
  inspections,
  scheduledInspectionOccurrences,
  sites,
  templateSchedules,
  templates,
  user,
} from '@forma360/db/schema';
import {
  registerDependentResolver,
  type DependentResolver,
} from '@forma360/permissions/dependents';
import { newId } from '@forma360/shared/id';
import { TRPCError } from '@trpc/server';
// This file is only consumed by Next.js via `@forma360/api`; Next's bundler
// (webpack/turbopack) handles the CJS interop transparently, so named
// imports from `rrule` Just Work here. The worker has no bundler — see
// packages/jobs/src/workers/schedule-rrule.ts for the default-import
// dance needed there.
import { RRule, rrulestr } from 'rrule';
import { floatingToZonedUtc } from '@forma360/shared/timezone';
import { and, count, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission, tenantProcedure } from '../procedures';
import { assertGroupsInTenant, assertSitesInTenant, assertUsersInTenant } from '../tenant-guards';
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
 * Hard ceiling on occurrences expanded from a single RRULE. Mirrors the
 * worker's `MAX_OCCURRENCES_PER_RULE` — bounds memory when the month
 * calendar expands a rule over a wide range so one pathological schedule
 * can't OOM the API process.
 */
const MAX_OCCURRENCES_PER_RULE = 2000;

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
      // Reject sub-hourly cadences (MINUTELY/SECONDLY) — never a legitimate
      // inspection schedule, and they expand to millions of occurrences that
      // would starve the shared materialise worker for every tenant.
      if (parsed.options.freq >= RRule.MINUTELY) {
        return 'RRULE frequency too high — the minimum interval is hourly';
      }
    }
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'Invalid RRULE';
  }
}

/**
 * Every occurrence of an RRULE in `[from, to]` (floating wall-clock Dates;
 * callers reinterpret in the schedule timezone). Used by the month calendar
 * (To-Do #2) so the grid can show occurrences beyond the materialised window.
 */
function occurrencesInRange(
  rrule: string,
  startAt: Date,
  from: Date,
  to: Date,
  endAt: Date | null,
): Date[] {
  try {
    const rule = rrulestr(rrule, { dtstart: startAt });
    const upper = endAt !== null && endAt < to ? endAt : to;
    return rule.between(from, upper, true, (_d, i) => i < MAX_OCCURRENCES_PER_RULE);
  } catch {
    return [];
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
  reminderMinutesBefore: z
    .number()
    .int()
    .min(1)
    .max(60 * 24 * 30)
    .nullable()
    .default(null),
  allowLateSubmissions: z.boolean().default(true),
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

function assertAtLeastOneAssignee(input: {
  assigneeUserIds: readonly string[];
  assigneeGroupIds: readonly string[];
  siteIds: readonly string[];
}): void {
  if (
    input.assigneeUserIds.length === 0 &&
    input.assigneeGroupIds.length === 0 &&
    input.siteIds.length === 0
  ) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'no-assignees',
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
          siteId: idSchema.optional(),
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
      if (input.siteId !== undefined) {
        // siteIds is a jsonb id array — containment check.
        where.push(sql`${templateSchedules.siteIds} @> ${JSON.stringify([input.siteId])}::jsonb`);
      }
      const rows = await ctx.db
        .select()
        .from(templateSchedules)
        .where(and(...where))
        .orderBy(desc(templateSchedules.updatedAt));

      // Resolve the human names of every assignment target (group / site /
      // direct user) so the list can tag each schedule with what it's
      // attached to (To-Do #1). One batched lookup per dimension.
      const groupIdSet = new Set<string>();
      const siteIdSet = new Set<string>();
      const userIdSet = new Set<string>();
      for (const r of rows) {
        for (const g of r.assigneeGroupIds ?? []) groupIdSet.add(g);
        for (const s of r.siteIds ?? []) siteIdSet.add(s);
        for (const u of r.assigneeUserIds ?? []) userIdSet.add(u);
      }
      const [groupRows, siteRows, userRows] = await Promise.all([
        groupIdSet.size > 0
          ? ctx.db
              .select({ id: groups.id, name: groups.name })
              .from(groups)
              .where(and(eq(groups.tenantId, ctx.tenantId), inArray(groups.id, [...groupIdSet])))
          : Promise.resolve([] as { id: string; name: string }[]),
        siteIdSet.size > 0
          ? ctx.db
              .select({ id: sites.id, name: sites.name })
              .from(sites)
              .where(and(eq(sites.tenantId, ctx.tenantId), inArray(sites.id, [...siteIdSet])))
          : Promise.resolve([] as { id: string; name: string }[]),
        userIdSet.size > 0
          ? ctx.db
              .select({ id: user.id, name: user.name })
              .from(user)
              .where(and(eq(user.tenantId, ctx.tenantId), inArray(user.id, [...userIdSet])))
          : Promise.resolve([] as { id: string; name: string }[]),
      ]);
      const groupName = new Map(groupRows.map((g) => [g.id, g.name]));
      const siteName = new Map(siteRows.map((s) => [s.id, s.name]));
      const userName = new Map(userRows.map((u) => [u.id, u.name]));

      return rows.map((r) => ({
        ...r,
        assigneeGroupNames: (r.assigneeGroupIds ?? []).map((id) => groupName.get(id) ?? id),
        siteNames: (r.siteIds ?? []).map((id) => siteName.get(id) ?? id),
        assigneeUserNames: (r.assigneeUserIds ?? []).map((id) => userName.get(id) ?? id),
      }));
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
        // rrule yields floating wall-clock times; reinterpret each in the
        // schedule's timezone so the true instant — and the time the client
        // shows when formatting in that timezone — matches what was set
        // (To-Do #1). The client formats these in `schedule.timezone`.
        upcomingPreview: upcoming.map((d) => floatingToZonedUtc(d, sched.timezone).toISOString()),
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
      // Assignees + sites must belong to this tenant.
      await assertUsersInTenant(ctx.db, ctx.tenantId, input.assigneeUserIds);
      await assertGroupsInTenant(ctx.db, ctx.tenantId, input.assigneeGroupIds);
      await assertSitesInTenant(ctx.db, ctx.tenantId, input.siteIds);

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
        allowLateSubmissions: input.allowLateSubmissions,
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
      // Assignees + sites must belong to this tenant.
      await assertUsersInTenant(ctx.db, ctx.tenantId, input.assigneeUserIds);
      await assertGroupsInTenant(ctx.db, ctx.tenantId, input.assigneeGroupIds);
      await assertSitesInTenant(ctx.db, ctx.tenantId, input.siteIds);

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
          allowLateSubmissions: input.allowLateSubmissions,
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
      ctx.enqueue('forma360-schedule-materialise', {
        tenantId: ctx.tenantId,
        scheduleId: input.scheduleId,
      });
      return { ok: true as const };
    }),

  /**
   * List completed occurrences for a schedule, joined with their inspection
   * rows. Used by the schedule detail page "Past inspections" section.
   */
  listOccurrences: tenantProcedure
    .use(requirePermission('templates.schedules.manage'))
    .input(
      z.object({
        scheduleId: idSchema,
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: scheduledInspectionOccurrences.id,
          occurrenceAt: scheduledInspectionOccurrences.occurrenceAt,
          status: scheduledInspectionOccurrences.status,
          assigneeUserId: scheduledInspectionOccurrences.assigneeUserId,
          inspectionId: scheduledInspectionOccurrences.inspectionId,
          inspectionTitle: inspections.title,
          inspectionStatus: inspections.status,
        })
        .from(scheduledInspectionOccurrences)
        .leftJoin(inspections, eq(inspections.id, scheduledInspectionOccurrences.inspectionId))
        .where(
          and(
            eq(scheduledInspectionOccurrences.tenantId, ctx.tenantId),
            eq(scheduledInspectionOccurrences.scheduleId, input.scheduleId),
            eq(scheduledInspectionOccurrences.status, 'completed'),
          ),
        )
        .orderBy(desc(scheduledInspectionOccurrences.occurrenceAt))
        .limit(input.limit);
      return rows;
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
            // PF-3: an overdue occurrence used to VANISH from this list
            // (pending + >= now). Pending-past-due and missed stay
            // visible for 30 days so the assignee sees the debt.
            inArray(scheduledInspectionOccurrences.status, ['pending', 'missed']),
            gte(
              scheduledInspectionOccurrences.occurrenceAt,
              new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
            ),
            lte(scheduledInspectionOccurrences.occurrenceAt, upper),
          ),
        )
        .orderBy(scheduledInspectionOccurrences.occurrenceAt);
    }),

  /**
   * Org-wide occurrences in a date range, computed live from each active
   * schedule's RRULE (so the month calendar can show times beyond the
   * 14-day materialised window). Optional filters by site / group / user
   * match at the schedule-config level — a schedule is included when it
   * targets the selected site(s), group(s), or direct user(s). When several
   * filters are set, a schedule must match every provided dimension.
   * Powers the calendar view (To-Do #2).
   */
  calendarOccurrences: tenantProcedure
    .use(requirePermission('inspections.view'))
    .input(
      z.object({
        from: z.string().datetime(),
        to: z.string().datetime(),
        siteIds: z.array(idSchema).max(200).default([]),
        groupIds: z.array(idSchema).max(200).default([]),
        userIds: z.array(z.string()).max(200).default([]),
      }),
    )
    .query(async ({ ctx, input }) => {
      const from = new Date(input.from);
      const to = new Date(input.to);
      // Bound the range so a `from: 2000 … to: 9999` request can't expand
      // every schedule over millennia and OOM the request. A calendar never
      // needs more than a year at a time.
      if (to.getTime() - from.getTime() > 366 * 24 * 60 * 60 * 1000) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Date range too wide (max 366 days)' });
      }

      const scheds = await ctx.db
        .select({
          id: templateSchedules.id,
          name: templateSchedules.name,
          rrule: templateSchedules.rrule,
          startAt: templateSchedules.startAt,
          endAt: templateSchedules.endAt,
          timezone: templateSchedules.timezone,
          templateId: templateSchedules.templateId,
          templateName: templates.name,
          assigneeUserIds: templateSchedules.assigneeUserIds,
          assigneeGroupIds: templateSchedules.assigneeGroupIds,
          siteIds: templateSchedules.siteIds,
        })
        .from(templateSchedules)
        .leftJoin(templates, eq(templateSchedules.templateId, templates.id))
        .where(
          and(eq(templateSchedules.tenantId, ctx.tenantId), eq(templateSchedules.paused, false)),
        );

      const hasSite = input.siteIds.length > 0;
      const hasGroup = input.groupIds.length > 0;
      const hasUser = input.userIds.length > 0;

      const CAP = 3000;
      const occurrences: {
        scheduleId: string;
        scheduleName: string;
        templateName: string | null;
        timezone: string;
        occurrenceAt: string;
      }[] = [];

      for (const s of scheds) {
        const sSites = s.siteIds ?? [];
        const sGroups = s.assigneeGroupIds ?? [];
        const sUsers = s.assigneeUserIds ?? [];
        if (hasSite && !sSites.some((id) => input.siteIds.includes(id))) continue;
        if (hasGroup && !sGroups.some((id) => input.groupIds.includes(id))) continue;
        if (hasUser && !sUsers.some((id) => input.userIds.includes(id))) continue;

        const times = occurrencesInRange(s.rrule, s.startAt, from, to, s.endAt);
        for (const t of times) {
          occurrences.push({
            scheduleId: s.id,
            scheduleName: s.name,
            templateName: s.templateName,
            timezone: s.timezone,
            occurrenceAt: floatingToZonedUtc(t, s.timezone).toISOString(),
          });
          if (occurrences.length >= CAP) break;
        }
        if (occurrences.length >= CAP) break;
      }

      return { occurrences, capped: occurrences.length >= CAP };
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
void sql;
