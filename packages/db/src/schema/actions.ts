/**
 * Actions — stub landed in Phase 2 PR 28.
 *
 * The full Actions module lands in Phase 4; Phase 2 needs just enough of
 * the table to:
 *   - let an inspection question create an Action on trigger / answer
 *     (createFromInspectionQuestion) with idempotent dedup per-question
 *   - let the templates dependents resolver count actions referencing an
 *     inspection (via sourceType='inspection')
 *
 * Columns marked "Phase 4" are placeholders — the Phase 4 PR will extend
 * this table with a forward-only migration (labels, evidence, etc.).
 */
import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

export const actionStatus = ['open', 'in_progress', 'completed', 'cancelled'] as const;
export type ActionStatus = (typeof actionStatus)[number];

export const actionPriority = ['low', 'medium', 'high', 'critical'] as const;
export type ActionPriority = (typeof actionPriority)[number];

export const actions = pgTable(
  'actions',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    /** "inspection" for PR 28. Other source types land in later phases. */
    sourceType: text('source_type').notNull(),
    /** The anchor id — for sourceType="inspection", this is the inspection id. */
    sourceId: varchar('source_id', { length: 26 }),
    /**
     * The template item id (or other per-source item identifier) that raised
     * this action. Used for the dedup unique index below.
     */
    sourceItemId: text('source_item_id'),

    title: text('title').notNull(),
    description: text('description'),

    status: text('status').notNull().default('open'),
    priority: text('priority'),

    assigneeUserId: text('assignee_user_id'),
    dueAt: timestamp('due_at', { withTimezone: true, mode: 'date' }),

    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('actions_tenant_status_idx').on(table.tenantId, table.status),
    index('actions_tenant_source_idx').on(table.tenantId, table.sourceType, table.sourceId),
    /**
     * Per-item dedup: a given (sourceType, sourceId, sourceItemId) triple
     * produces at most one action, so an idempotent insert from an
     * inspection question is safe. We accept NULL-duplicates rather than
     * using a partial index — Postgres treats NULLs as distinct in a
     * plain unique index, so "no sourceItemId" rows don't collide.
     */
    uniqueIndex('actions_source_item_unique').on(
      table.sourceType,
      table.sourceId,
      table.sourceItemId,
    ),
  ],
);

export type Action = typeof actions.$inferSelect;
export type NewAction = typeof actions.$inferInsert;
