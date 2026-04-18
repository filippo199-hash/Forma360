/**
 * Template schedules + materialised inspection occurrences.
 *
 * Phase 2 PR 32 — Scheduling. See docs/modules-overview.html (Schedules)
 * and T-E05 (archiving a template must pause — not delete — its
 * schedules).
 *
 * Two tables:
 *
 *   - templateSchedules               The admin-facing config: which
 *                                     template, what RRULE, which
 *                                     assignees, which sites, reminder
 *                                     window, paused flag.
 *   - scheduledInspectionOccurrences  The materialised fan-out: one row
 *                                     per (schedule, assignee,
 *                                     occurrenceAt) triple, created by
 *                                     the materialise worker. Links to
 *                                     a concrete inspection once the
 *                                     assignee starts it.
 *
 * The worker reads `templateSchedules`, computes occurrences from the
 * rrule inside a forward 14-day window, and upserts rows into
 * `scheduledInspectionOccurrences`. The unique
 * `(scheduleId, assigneeUserId, occurrenceAt)` is the idempotency key —
 * re-running materialise for an unchanged schedule is a no-op.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { sites } from './sites';
import { templates } from './templates';
import { tenants } from './tenants';

/**
 * Occurrence status lifecycle:
 *   pending      — materialised but not started
 *   in_progress  — assignee started; inspectionId populated
 *   completed    — assignee submitted (terminal)
 *   missed       — occurrenceAt passed without a start (stamped by a
 *                  future sweeper job; PR 32 leaves missed unstamped
 *                  and "pending" after the fact serves the same signal)
 */
export const scheduleOccurrenceStatus = [
  'pending',
  'in_progress',
  'completed',
  'missed',
] as const;
export type ScheduleOccurrenceStatus = (typeof scheduleOccurrenceStatus)[number];

export const templateSchedules = pgTable(
  'template_schedules',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    /**
     * CASCADE — schedules die with the template. Archive only paused the
     * schedule (`paused` flipped true), preserving rows so an admin can
     * resume if the template is un-archived.
     */
    templateId: varchar('template_id', { length: 26 })
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),

    name: text('name').notNull(),

    /** IANA timezone. RRULE evaluates in this zone. Defaults to UTC. */
    timezone: text('timezone').notNull().default('UTC'),

    /**
     * iCalendar RRULE (e.g. `FREQ=WEEKLY;BYDAY=MO;BYHOUR=8`). Validated
     * by the router using the `rrule` npm package before insert / update.
     */
    rrule: text('rrule').notNull(),

    /** First occurrence anchor. */
    startAt: timestamp('start_at', { withTimezone: true, mode: 'date' }).notNull(),
    /** Optional bound; null = runs forever. */
    endAt: timestamp('end_at', { withTimezone: true, mode: 'date' }),

    /** User ULIDs directly assigned. */
    assigneeUserIds: jsonb('assignee_user_ids')
      .notNull()
      .$type<readonly string[]>()
      .default(sql`'[]'::jsonb`),
    /** Group ULIDs — expanded to users at materialise time. */
    assigneeGroupIds: jsonb('assignee_group_ids')
      .notNull()
      .$type<readonly string[]>()
      .default(sql`'[]'::jsonb`),
    /** Optional per-site scoping. Empty = schedule is tenant-wide. */
    siteIds: jsonb('site_ids')
      .notNull()
      .$type<readonly string[]>()
      .default(sql`'[]'::jsonb`),

    /** Minutes before the occurrence to send a reminder. Null disables. */
    reminderMinutesBefore: integer('reminder_minutes_before'),

    /** Auto-flipped true when the template is archived. */
    paused: boolean('paused').notNull().default(false),

    /** Idempotency cursor used by the tick worker. */
    lastMaterialisedAt: timestamp('last_materialised_at', {
      withTimezone: true,
      mode: 'date',
    }),

    createdBy: text('created_by').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('template_schedules_tenant_template_idx').on(table.tenantId, table.templateId),
    index('template_schedules_tenant_paused_idx').on(table.tenantId, table.paused),
  ],
);

export type TemplateSchedule = typeof templateSchedules.$inferSelect;
export type NewTemplateSchedule = typeof templateSchedules.$inferInsert;

export const scheduledInspectionOccurrences = pgTable(
  'scheduled_inspection_occurrences',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    scheduleId: varchar('schedule_id', { length: 26 })
      .notNull()
      .references(() => templateSchedules.id, { onDelete: 'cascade' }),
    /** RESTRICT — preserves history if an admin tries to hard-delete. */
    templateId: varchar('template_id', { length: 26 })
      .notNull()
      .references(() => templates.id, { onDelete: 'restrict' }),

    /** The exact time this occurrence is meant to happen. */
    occurrenceAt: timestamp('occurrence_at', { withTimezone: true, mode: 'date' }).notNull(),

    /**
     * The assigned user snapshot at materialise time. `text` rather than
     * varchar(26) because `user.id` is a better-auth text PK.
     */
    assigneeUserId: text('assignee_user_id'),

    /** Optional per-site binding propagated from the schedule. */
    siteId: varchar('site_id', { length: 26 }).references(() => sites.id, {
      onDelete: 'set null',
    }),

    /** The inspection the assignee started, once they start. Null until. */
    inspectionId: varchar('inspection_id', { length: 26 }),

    status: text('status').notNull().default('pending'),

    /** Stamped by the reminder worker once it sends the email. */
    reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true, mode: 'date' }),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('scheduled_inspection_occurrences_unique').on(
      table.scheduleId,
      table.assigneeUserId,
      table.occurrenceAt,
    ),
    index('scheduled_inspection_occurrences_tenant_status_idx').on(table.tenantId, table.status),
    index('scheduled_inspection_occurrences_tenant_assignee_status_idx').on(
      table.tenantId,
      table.assigneeUserId,
      table.status,
    ),
  ],
);

export type ScheduledInspectionOccurrence =
  typeof scheduledInspectionOccurrences.$inferSelect;
export type NewScheduledInspectionOccurrence =
  typeof scheduledInspectionOccurrences.$inferInsert;
