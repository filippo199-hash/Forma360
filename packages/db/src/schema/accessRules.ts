/**
 * Advanced access rules — reusable "group + site" policy primitive.
 *
 * A rule matches a user iff they belong to ANY of `groupIds` AND ANY of
 * `siteIds`. Empty arrays match everyone in that axis (semantics codified
 * in `resolveAccessRule`). Phase 2+ modules (templates, inspections,
 * issues, actions, training) will gate features on a set of access rules.
 *
 * `invalidatedAt` is set when a referenced group or site is archived or
 * deleted (G-E06). Invalidated rules resolve to "no access" (most
 * restrictive) and surface in the Settings dashboard via
 * `accessRules.listInvalid` until the admin fixes the rule.
 */
import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

export const accessRules = pgTable(
  'access_rules',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    /** Group ULIDs. Empty array = any group. */
    groupIds: jsonb('group_ids')
      .notNull()
      .$type<readonly string[]>()
      .default(sql`'[]'::jsonb`),
    /** Site ULIDs. Empty array = any site. */
    siteIds: jsonb('site_ids')
      .notNull()
      .$type<readonly string[]>()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    /** Non-null when a referenced group or site has been archived (G-E06). */
    invalidatedAt: timestamp('invalidated_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [index('access_rules_tenant_id_idx').on(table.tenantId, table.invalidatedAt)],
);

export type AccessRule = typeof accessRules.$inferSelect;
export type NewAccessRule = typeof accessRules.$inferInsert;
