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
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import type {
  ActionCustomQuestion,
  ActionLabels,
  ActionRequiredField,
  ActionVisibilityRule,
  PriorityDueDateDays,
  RecurrenceConfig,
  TransitionRules,
} from '@forma360/shared/actions-schema';
import { assets } from './assets';
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
  'type_changed',
  'recurrence_changed',
  'recurred',
  'commented',
  'archived',
  'restored',
] as const;
export type ActionActivityKind = (typeof actionActivityKinds)[number];

/**
 * Action types — Phase 4b. SafetyCulture-style "Action types" with
 * per-type custom questions, required-field overrides, visibility
 * rules, and gated-status transition rules.
 *
 * Tenant-scoped, soft-deletable. Per-tenant the (name, archived_at IS NULL)
 * pair is unique (active types can't collide on name; archived ones
 * step aside).
 */
export const actionTypes = pgTable(
  'action_types',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    name: text('name').notNull(),
    description: text('description'),
    /** Hex string (e.g. "#2563eb") rendered as the type chip background. */
    color: text('color'),
    /** Optional lucide-react icon name. */
    icon: text('icon'),

    /** Up to 20 custom questions asked when an action of this type is created. */
    customQuestions: jsonb('custom_questions')
      .notNull()
      .$type<ReadonlyArray<ActionCustomQuestion>>()
      .default(sql`'[]'::jsonb`),

    /** Built-in fields the admin has marked required for this type. */
    requiredFields: jsonb('required_fields')
      .notNull()
      .$type<ReadonlyArray<ActionRequiredField>>()
      .default(sql`'[]'::jsonb`),

    /** Visibility rule — all_users | site_members | creator_and_assignee. */
    visibility: text('visibility').notNull().$type<ActionVisibilityRule>().default('all_users'),

    /**
     * Who can transition actions of this type into the gated terminal
     * statuses (completed / cancelled). Empty groupIds list = anyone
     * with `actions.manage`. Non-empty list = caller must belong to one
     * of the listed groups (admins always bypass).
     */
    transitionRules: jsonb('transition_rules')
      .notNull()
      .$type<TransitionRules>()
      .default(
        sql`'{"completed":{"allowedGroupIds":[]},"cancelled":{"allowedGroupIds":[]}}'::jsonb`,
      ),

    /**
     * Preset label options for this type. When non-empty, the create-action
     * form renders a dropdown so reporters pick a structured label instead
     * of free-typing. Admin manages these on the type detail page.
     */
    labels: jsonb('labels')
      .notNull()
      .$type<ActionLabels>()
      .default(sql`'[]'::jsonb`),

    /** Whether this type is the tenant's default for standalone creates. */
    isDefault: boolean('is_default').notNull().default(false),

    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),

    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('action_types_tenant_idx').on(table.tenantId),
    // Active (non-archived) types can't share a name within a tenant.
    // We accept duplicates among archived rows so admins can name a new
    // type the same as a retired one.
    uniqueIndex('action_types_tenant_name_active_uniq')
      .on(table.tenantId, table.name)
      .where(sql`archived_at IS NULL`),
  ],
);

export type ActionType = typeof actionTypes.$inferSelect;
export type NewActionType = typeof actionTypes.$inferInsert;

/**
 * Per-tenant action-module settings — currently just the
 * priority → due-date-days table. Future settings (close-reason
 * required, etc.) get columns here.
 */
export const tenantActionSettings = pgTable('tenant_action_settings', {
  tenantId: varchar('tenant_id', { length: 26 })
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'restrict' }),
  priorityDueDateDays: jsonb('priority_due_date_days')
    .notNull()
    .$type<PriorityDueDateDays>()
    .default(sql`'{"low":30,"medium":7,"high":1,"critical":1}'::jsonb`),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .default(sql`now()`),
});

export type TenantActionSettings = typeof tenantActionSettings.$inferSelect;
export type NewTenantActionSettings = typeof tenantActionSettings.$inferInsert;

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

    /**
     * The action type this row belongs to. NULL means "no type"
     * (legacy or quick-create) — the list and detail screens render a
     * generic "Action" badge in that case. ON DELETE SET NULL so
     * archiving a type doesn't orphan-delete its rows.
     */
    actionTypeId: varchar('action_type_id', { length: 26 }).references(() => actionTypes.id, {
      onDelete: 'set null',
    }),

    /**
     * Map of `{ [questionId]: response }`. Validated against the
     * type's `customQuestions` at the router boundary on create /
     * update — the DB column is intentionally loose so admins can
     * change the question set without forcing a data migration.
     */
    customQuestionResponses: jsonb('custom_question_responses')
      .notNull()
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`),

    /**
     * Recurrence config (RRULE + optional end). NULL = one-off. The
     * worker that materialises the next occurrence on close reads
     * this; UI also surfaces it as a "Recurring" badge.
     */
    recurrence: jsonb('recurrence').$type<RecurrenceConfig | null>(),

    /**
     * When this row is itself a generated occurrence, points back at
     * the parent action that owned the original recurrence config.
     * Lets the detail page surface "Generated from AC-000042".
     */
    recurrenceParentId: varchar('recurrence_parent_id', { length: 26 }),

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
    index('actions_tenant_type_idx').on(table.tenantId, table.actionTypeId),
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

/** Assets explicitly linked to an action. */
export const actionAssets = pgTable(
  'action_assets',
  {
    id: text('id').primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    actionId: varchar('action_id', { length: 26 })
      .notNull()
      .references(() => actions.id, { onDelete: 'cascade' }),
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
  },
  (t) => [
    uniqueIndex('aa_action_asset_uniq').on(t.actionId, t.assetId),
    index('aa_asset_tenant_idx').on(t.tenantId, t.assetId),
  ],
);

export type ActionAsset = typeof actionAssets.$inferSelect;

/**
 * Per-user saved views for the Actions board/list (To-Do #3). Each user has
 * their own set within a tenant — two users in the same company see different
 * views. `config` is the opaque filter/view snapshot the client serialises
 * (status/source/priority/sort/etc.). Cascade-deletes with the user.
 */
export const actionSavedViews = pgTable(
  'action_saved_views',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    config: jsonb('config')
      .notNull()
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('action_saved_views_user_idx').on(t.tenantId, t.userId)],
);

export type ActionSavedView = typeof actionSavedViews.$inferSelect;
