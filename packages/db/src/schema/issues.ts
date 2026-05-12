/**
 * Issues subgraph — Phase 3 PR 1.
 *
 * Three tenant-scoped tables:
 *
 *   - issue_categories  — admin-defined taxonomy. Carries category settings:
 *                         optional access rule, custom field / question
 *                         definitions, notification rule, critical-alert
 *                         flag, linked-template list, and an optional
 *                         public share token used for QR-based anonymous
 *                         submission (I-E01).
 *   - issues            — the report row. Snapshots the category's
 *                         custom-field / custom-question definitions onto
 *                         the issue at creation time so that admin edits
 *                         to the category after-the-fact do not rewrite
 *                         history (I-E03). Also freezes the reporter's
 *                         `accessSnapshot` per ADR 0007.
 *   - issue_comments    — append-only thread. Author-only update; author
 *                         or `issues.manage` user can delete.
 *
 * See ADR 0002 (tenant-scope + RESTRICT FKs), ADR 0007 (access state at
 * time of action).
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
import { accessRules } from './accessRules';
import { user } from './auth';
import { sites } from './sites';
import { tenants } from './tenants';
import type {
  IssueCustomField,
  IssueCustomQuestion,
  IssueGps,
} from '@forma360/shared/issues-schema';

export const issueNotificationRules = ['private', 'summary', 'detailed'] as const;
export type IssueNotificationRule = (typeof issueNotificationRules)[number];

export const issueStatuses = ['open', 'investigation', 'closed'] as const;
export type IssueStatus = (typeof issueStatuses)[number];

export const issueReportedVia = ['app', 'qr'] as const;
export type IssueReportedVia = (typeof issueReportedVia)[number];

/**
 * Snapshot of the category's customFields + customQuestions at the moment
 * the issue was created. Stored on the issue so admin edits to the category
 * (renaming a select option, removing a question) do not rewrite history.
 */
export interface IssueCategorySnapshot {
  categoryId: string;
  name: string;
  customFields: ReadonlyArray<IssueCustomField>;
  customQuestions: ReadonlyArray<IssueCustomQuestion>;
}

/**
 * Same shape as `AccessSnapshot` on inspections — kept structurally identical
 * so a future helper can read either table through one interface.
 */
export interface IssueAccessSnapshot {
  groupIds: readonly string[];
  siteIds: readonly string[];
  permissions: readonly string[];
  snapshotAt: string;
}

export const issueCategories = pgTable(
  'issue_categories',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    description: text('description'),

    /** Optional gate. Null = anyone with `issues.report` can use this category. */
    accessRuleId: varchar('access_rule_id', { length: 26 }).references(() => accessRules.id, {
      onDelete: 'set null',
    }),

    /** Per-category custom field definitions. Validated by `issueCustomFieldsSchema`. */
    customFields: jsonb('custom_fields')
      .notNull()
      .$type<ReadonlyArray<IssueCustomField>>()
      .default(sql`'[]'::jsonb`),
    /** Per-category custom question definitions (up to 10). */
    customQuestions: jsonb('custom_questions')
      .notNull()
      .$type<ReadonlyArray<IssueCustomQuestion>>()
      .default(sql`'[]'::jsonb`),

    /** 'private' | 'summary' | 'detailed' — enforced by CHECK constraint in SQL. */
    notificationRule: varchar('notification_rule', { length: 20 })
      .notNull()
      .default('summary'),
    criticalAlerts: boolean('critical_alerts').notNull().default(false),

    /** Template ids that may pull this category's metadata in (Phase 3+). */
    linkedTemplateIds: jsonb('linked_template_ids')
      .notNull()
      .$type<readonly string[]>()
      .default(sql`'[]'::jsonb`),

    /** Opaque token for the public QR submission flow. Null until generated. */
    publicShareToken: varchar('public_share_token', { length: 64 }),

    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('issue_categories_tenant_idx')
      .on(table.tenantId)
      .where(sql`${table.archivedAt} IS NULL`),
    index('issue_categories_tenant_archived_idx').on(table.tenantId, table.archivedAt),
    uniqueIndex('issue_categories_public_share_token_unique').on(table.publicShareToken),
  ],
);

export type IssueCategory = typeof issueCategories.$inferSelect;
export type NewIssueCategory = typeof issueCategories.$inferInsert;

export const issues = pgTable(
  'issues',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    categoryId: varchar('category_id', { length: 26 })
      .notNull()
      .references(() => issueCategories.id, { onDelete: 'restrict' }),

    title: text('title').notNull(),
    description: text('description'),
    /** 'open' | 'investigation' | 'closed' — enforced by CHECK constraint. */
    status: varchar('status', { length: 20 }).notNull().default('open'),

    /** Null for anonymous QR submissions (I-E01). */
    reportedByUserId: text('reported_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    /** Display-name snapshot. Resolved at submission time. */
    reportedByName: text('reported_by_name'),
    /** 'app' | 'qr' — enforced by CHECK constraint. */
    reportedVia: varchar('reported_via', { length: 20 }).notNull().default('app'),

    siteId: varchar('site_id', { length: 26 }).references(() => sites.id, {
      onDelete: 'set null',
    }),
    locationGps: jsonb('location_gps').$type<IssueGps | null>(),
    locationAddress: text('location_address'),

    dateOccurred: timestamp('date_occurred', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),

    /** Keyed by custom-field id. */
    customFieldValues: jsonb('custom_field_values')
      .notNull()
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`),
    /** Keyed by custom-question id. */
    customQuestionResponses: jsonb('custom_question_responses')
      .notNull()
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`),

    /** Snapshot of the category at issue-create time (I-E03). */
    categorySnapshot: jsonb('category_snapshot').notNull().$type<IssueCategorySnapshot>(),

    /** Human-friendly reference like "ISS-000042". */
    referenceNumber: text('reference_number').notNull(),

    /** ADR 0007 access snapshot. Never null once the row exists. */
    accessSnapshot: jsonb('access_snapshot').notNull().$type<IssueAccessSnapshot>(),

    closedAt: timestamp('closed_at', { withTimezone: true, mode: 'date' }),
    closedByUserId: text('closed_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    closedReason: text('closed_reason'),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('issues_tenant_status_idx')
      .on(table.tenantId, table.status)
      .where(sql`${table.archivedAt} IS NULL`),
    index('issues_tenant_category_idx')
      .on(table.tenantId, table.categoryId)
      .where(sql`${table.archivedAt} IS NULL`),
    index('issues_tenant_site_idx')
      .on(table.tenantId, table.siteId)
      .where(sql`${table.archivedAt} IS NULL`),
    index('issues_tenant_created_idx').on(table.tenantId, table.createdAt),
  ],
);

export type Issue = typeof issues.$inferSelect;
export type NewIssue = typeof issues.$inferInsert;

export const issueComments = pgTable(
  'issue_comments',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    issueId: varchar('issue_id', { length: 26 })
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
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
  (table) => [index('issue_comments_issue_idx').on(table.issueId, table.createdAt)],
);

export type IssueComment = typeof issueComments.$inferSelect;
export type NewIssueComment = typeof issueComments.$inferInsert;
