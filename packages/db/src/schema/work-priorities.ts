/**
 * Per-user Focus rules (review round 4) — the "teach it what matters to
 * me" store behind the My-work Focus list.
 *
 * Each row is one compiled, DETERMINISTIC preference: boost or demote
 * items by work-item kind or by a title keyword. `note` keeps the
 * user's own words ("RIDDOR stuff first") so the guidance reads back as
 * written. No model in the loop: the ranking is a pure function over
 * these rows, so the same queue always ranks the same way.
 */
import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { tenants } from './tenants';

export const workPriorityRuleTypes = ['kind', 'keyword'] as const;
export type WorkPriorityRuleType = (typeof workPriorityRuleTypes)[number];

export const workPriorityDirections = ['boost', 'demote'] as const;
export type WorkPriorityDirection = (typeof workPriorityDirections)[number];

export const userWorkPriorities = pgTable(
  'user_work_priorities',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    ruleType: text('rule_type').notNull().$type<WorkPriorityRuleType>(),
    /** A MyWorkKind for 'kind' rules; a lowercase substring for 'keyword'. */
    value: text('value').notNull(),
    direction: text('direction').notNull().$type<WorkPriorityDirection>(),
    /** The user's own words, shown back verbatim. */
    note: text('note').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index('user_work_priorities_user_idx').on(table.tenantId, table.userId)],
);

export type UserWorkPriority = typeof userWorkPriorities.$inferSelect;
export type NewUserWorkPriority = typeof userWorkPriorities.$inferInsert;
