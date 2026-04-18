/**
 * Sites + hierarchy + membership.
 *
 * Hierarchy is a self-referencing tree with max depth 6 (G-E07). We track
 * `depth` explicitly as an integer on each row and recompute `path` on
 * insert / move in application code — chosen over a Postgres ltree trigger
 * because pglite (our test harness) does not ship the ltree extension, and
 * the application-code path keeps the test surface single-runtime.
 *
 * `path` is a materialised breadcrumb of ancestor ids, dot-separated, used
 * for efficient "is X an ancestor of Y?" queries with a `LIKE 'abc.%'`
 * scan. Recomputing `path` for a subtree on move is O(subtree size).
 *
 * Limits enforced at the router layer:
 *   - ≤ 50,000 sites per tenant (Module 9 spec)
 *   - ≤ depth 6 (G-E07)
 */
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { user } from './auth';

export const siteMembershipMode = ['manual', 'rule_based'] as const;
export type SiteMembershipMode = (typeof siteMembershipMode)[number];

export const sites = pgTable(
  'sites',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    /** Self-FK. Null for top-level. Cascade restrict: explicit archival required. */
    parentId: varchar('parent_id', { length: 26 }).references((): AnyPgColumn => sites.id, {
      onDelete: 'restrict',
    }),
    /** 0-indexed. Root rows are depth 0; max 5 (for a max total of 6 levels). */
    depth: integer('depth').notNull().default(0),
    /**
     * Materialised ancestor path, dot-separated ULIDs. Root rows have an
     * empty string; a grandchild at `C.B.A` stores `"A.B"` (root first,
     * nearest-ancestor last). `LIKE 'A.%'` finds every descendant of A.
     */
    path: text('path').notNull().default(''),
    /**
     * "manual" | "rule_based". When rule_based, manual add/remove is
     * rejected at the router (G-E10).
     */
    membershipMode: text('membership_mode').notNull().default('manual'),
    /** Free-form tenant metadata (coordinates, custom codes, timezone, ...). */
    metadata: jsonb('metadata')
      .notNull()
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('sites_tenant_id_parent_id_idx').on(table.tenantId, table.parentId),
    index('sites_tenant_id_path_idx').on(table.tenantId, table.path),
    // Postgres 15+: NULLS NOT DISTINCT — two root-level sites (parent_id
    // NULL) with the same name in the same tenant collide as expected.
    // Uses `unique()` table constraint because `uniqueIndex().nullsNotDistinct()`
    // isn't a method on the current drizzle-orm/pg-core builder.
    unique('sites_tenant_id_parent_id_name_unique')
      .on(table.tenantId, table.parentId, table.name)
      .nullsNotDistinct(),
  ],
);

export type Site = typeof sites.$inferSelect;
export type NewSite = typeof sites.$inferInsert;

export const siteMembers = pgTable(
  'site_members',
  {
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    siteId: varchar('site_id', { length: 26 })
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    addedVia: text('added_via').notNull().default('manual'),
    addedAt: timestamp('added_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('site_members_site_id_user_id_unique').on(table.siteId, table.userId),
    index('site_members_tenant_id_user_id_idx').on(table.tenantId, table.userId),
  ],
);

export type SiteMember = typeof siteMembers.$inferSelect;
export type NewSiteMember = typeof siteMembers.$inferInsert;

export const siteMembershipRules = pgTable(
  'site_membership_rules',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    siteId: varchar('site_id', { length: 26 })
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    order: integer('order').notNull().default(0),
    conditions: jsonb('conditions')
      .notNull()
      .$type<ReadonlyArray<{ fieldId: string; operator: string; value: unknown }>>()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('site_membership_rules_tenant_id_site_id_idx').on(
      table.tenantId,
      table.siteId,
      table.order,
    ),
  ],
);

export type SiteMembershipRule = typeof siteMembershipRules.$inferSelect;
export type NewSiteMembershipRule = typeof siteMembershipRules.$inferInsert;
