/**
 * Templates + template versions.
 *
 * Core Phase 2 tables. Both are tenant-scoped per ADR 0002.
 *
 * A `templates` row is the persistent identity of a template — name,
 * access rule, archive state, and a pointer to its current published
 * version. `templateVersions` rows are **immutable once published**.
 * Editing produces a new draft version; publish flips `isCurrent` and
 * stamps `publishedAt`. Published versions are never updated — that
 * invariant is enforced at the router layer (see `packages/api/src/
 * routers/templateVersions.ts`) because the DB layer has to allow
 * UPDATE during the publish transaction to flip the previous
 * `isCurrent` to false.
 *
 * See docs/adr/0009-template-content-schema.md for the `content` shape.
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
import { accessRules } from './accessRules';
import { tenants } from './tenants';
import type { TemplateContent } from '@forma360/shared/template-schema';

/** Lifecycle states. `archived` is a soft-delete distinct from the row being deleted. */
export const templateStatus = ['draft', 'published', 'archived'] as const;
export type TemplateStatus = (typeof templateStatus)[number];

export const templates = pgTable(
  'templates',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    name: text('name').notNull(),
    description: text('description'),

    /** Cached lifecycle flag. Derived from version state but denormalised for listing perf. */
    status: text('status').notNull().default('draft'),

    /**
     * Pointer to the currently-published version. Null until the first
     * publish. The publish path sets this in the same tx that flips the
     * previous current version's isCurrent flag.
     */
    currentVersionId: varchar('current_version_id', { length: 26 }),

    /**
     * Optional access rule. Null = every tenant user with `templates.view`
     * can see it. Non-null = the rule's group/site membership gate applies.
     * See `@forma360/permissions/access` resolveAccessRule.
     */
    accessRuleId: varchar('access_rule_id', { length: 26 }).references(() => accessRules.id, {
      onDelete: 'set null',
    }),

    /**
     * Template-level format string used to auto-generate inspection titles.
     * Tokens like {site}, {date}, {docNumber}, {conductedBy}. Capped at 500
     * chars here; rendered titles truncate at 250 per T-E09.
     */
    titleFormat: text('title_format').notNull().default('{date}'),

    /**
     * Monotonic per-template counter used by the `documentNumberFormat` to
     * stamp `AUDIT000001`-style numbers on inspections. Incremented in the
     * inspection-creation transaction with a row lock.
     */
    documentNumberCounter: integer('document_number_counter').notNull().default(0),

    createdBy: text('created_by').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    /**
     * Soft-delete. Archival triggers getDependents preview; schedules are
     * paused and in-progress inspections are allowed to complete per T-E05.
     */
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('templates_tenant_id_status_idx').on(table.tenantId, table.status),
    index('templates_tenant_id_archived_at_idx').on(table.tenantId, table.archivedAt),
  ],
);

export type Template = typeof templates.$inferSelect;
export type NewTemplate = typeof templates.$inferInsert;

/**
 * Template version — the immutable snapshot that inspections pin to at start.
 * Every publish creates a new row; editing a published template creates a new
 * DRAFT row (isCurrent=false, publishedAt=null).
 *
 * Unique `(templateId, versionNumber)` and a partial unique on
 * `(templateId, isCurrent=true)` guaranteed at most one current version per
 * template.
 */
export const templateVersions = pgTable(
  'template_versions',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    templateId: varchar('template_id', { length: 26 })
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),

    /** Monotonic within a template. 1, 2, 3, ... */
    versionNumber: integer('version_number').notNull(),

    /**
     * Full template content. See docs/adr/0009-template-content-schema.md
     * for the shape. Validated at router boundaries by
     * @forma360/shared/template-schema.
     */
    content: jsonb('content').notNull().$type<TemplateContent>(),

    /** Null for drafts; stamped on publish and immutable thereafter. */
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),
    publishedBy: text('published_by'),

    /**
     * Exactly-one-true-per-template invariant via a partial unique index
     * below. Flipped atomically during publish: new version set true, old
     * current set false.
     */
    isCurrent: boolean('is_current').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('template_versions_template_version_unique').on(
      table.templateId,
      table.versionNumber,
    ),
    index('template_versions_tenant_template_idx').on(table.tenantId, table.templateId),
  ],
);

export type TemplateVersion = typeof templateVersions.$inferSelect;
export type NewTemplateVersion = typeof templateVersions.$inferInsert;
