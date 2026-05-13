/**
 * Actions — Phase 4 build.
 *
 * Phase 2 PR 28 shipped a stub (sourceType/sourceId/sourceItemId,
 * title/description, status/priority/assignee/dueAt). Phase 4 extends
 * the table with the columns SafetyCulture parity calls for:
 *
 *   - reference_number      — AC-NNNNNN human-friendly id, tenant-scoped
 *   - site_id               — optional site link (FK ON DELETE SET NULL)
 *   - label                 — free-form single label for grouping
 *   - closed_at / closed_by — terminal-state audit columns, mirroring
 *                             the issues table pattern
 *   - archived_at           — soft-delete pointer (active list filters it)
 *
 * It also lands two sibling tables:
 *   - action_activity — append-only audit log (status / assignee /
 *     priority / due-date / comment / attachment events)
 *   - action_comments — collaboration chat per action
 *
 * `sourceType` covers `inspection` (raised from an inspection question,
 * dedup'd by sourceItemId), `issue` (raised from an observation,
 * sourceItemId NULL), and `standalone` (created from the Actions list,
 * sourceId NULL). The existing
 * `actions_source_item_unique(sourceType, sourceId, sourceItemId)` index
 * stays in place — Postgres treats NULL source_item_id rows as distinct,
 * so the issue/standalone paths don't collide.
 *
 * Custom action types, custom statuses, priority-based auto-due,
 * recurring actions, merging, transition controls, labels CRUD and
 * action-type → template linking are explicit Phase 4 follow-on work.
 */
import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { sites } from './sites';
import { tenants } from './tenants';
import { user } from './auth';

export const actionStatus = ['open', 'in_progress', 'completed', 'cancelled'] as const;
export type ActionStatus = (typeof actionStatus)[number];

export const actionPriority = ['low', 'medium', 'high', 'critical'] as const;
export type ActionPriority = (typeof actionPriority)[number];

export const actionSourceTypes = ['inspection', 'issue', 'standalone'] as const;
export type ActionSourceType = (typeof actionSourceTypes)[number];

/**
 * Activity-log event kinds. Keep this list in sync with the writer
 * helpers in `routers/actions.ts` — Zod validates the kind enum at
 * router boundary, the DB column is a free-form `text` so we don't have
 * to ship a migration every time we add a new event type.
 */
export const actionActivityKinds = [
  'created',
  'status_changed',
  'priority_changed',
  'assignee_changed',
  'assignee_cleared',
  'due_date_changed',
  'due_date_cleared',
  'site_changed',
  'site_cleared',
  'label_changed',
  'title_changed',
  'description_changed',
  'commented',
  'archived',
  'restored',
] as const;
export type ActionActivityKind = (typeof actionActivityKinds)[number];

export const actions = pgTable(
  'actions',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    /** "inspection" | "issue" | "standalone" — see top-of-file rationale. */
    sourceType: text('source_type').notNull(),
    /**
     * The anchor id — for inspection-raised actions this is the
     * inspection id, for issue-raised actions the issue id, NULL for
     * standalone actions.
     */
    sourceId: varchar('source_id', { length: 26 }),
    /**
     * The template item id (or other per-source item identifier) that raised
     * this action. Used for the dedup unique index below.
     */
    sourceItemId: text('source_item_id'),

    /** Human-friendly reference shown in the UI ("AC-000123"). */
    referenceNumber: text('reference_number'),

    title: text('title').notNull(),
    description: text('description'),

    status: text('status').notNull().default('open').$type<ActionStatus>(),
    priority: text('priority').$type<ActionPriority>(),
    label: text('label'),

    assigneeUserId: text('assignee_user_id'),
    dueAt: timestamp('due_at', { withTimezone: true, mode: 'date' }),

    /** Optional site this action is associated with. */
    siteId: varchar('site_id', { length: 26 }).references(() => sites.id, {
      onDelete: 'set null',
    }),

    /** Stamped when the action moves to a terminal status (`completed` / `cancelled`). */
    closedAt: timestamp('closed_at', { withTimezone: true, mode: 'date' }),
    closedByUserId: text('closed_by_user_id'),

    /** Soft delete — the list query filters this out by default. */
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),

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
    index('actions_tenant_assignee_idx').on(table.tenantId, table.assigneeUserId),
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

/**
 * Append-only audit log per action. Mirrors `issue_activity`.
 */
export const actionActivity = pgTable(
  'action_activity',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    actionId: varchar('action_id', { length: 26 })
      .notNull()
      .references(() => actions.id, { onDelete: 'cascade' }),
    /** Null for system-generated events. */
    actorUserId: text('actor_user_id').references(() => user.id),
    kind: text('kind').notNull().$type<ActionActivityKind>(),
    payload: jsonb('payload')
      .notNull()
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index('action_activity_action_created_idx').on(table.actionId, table.createdAt)],
);

export type ActionActivity = typeof actionActivity.$inferSelect;
export type NewActionActivity = typeof actionActivity.$inferInsert;

/**
 * Collaboration thread per action. Mirrors `issue_comments`.
 */
export const actionComments = pgTable(
  'action_comments',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    actionId: varchar('action_id', { length: 26 })
      .notNull()
      .references(() => actions.id, { onDelete: 'cascade' }),
    authorUserId: text('author_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index('action_comments_action_idx').on(table.actionId, table.createdAt)],
);

export type ActionComment = typeof actionComments.$inferSelect;
export type NewActionComment = typeof actionComments.$inferInsert;
