/**
 * Permission sets table.
 *
 * One row per (tenant, named bundle). The `permissions` column is a JSON
 * array of `PermissionKey` strings; membership is checked by
 * `requirePermission(perm)` at the tRPC boundary.
 *
 * `isSystem` marks the three defaults seeded on tenant creation
 * (Administrator, Manager, Standard). The UI prevents renaming or
 * deletion of system sets; custom sets are tenant-managed.
 *
 * See ADR 0002 (multi-tenant) and the permission catalogue at
 * `@forma360/permissions/catalogue` for the key shape.
 */
import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

export const permissionSets = pgTable(
  'permission_sets',
  {
    id: varchar('id', { length: 26 }).primaryKey(),

    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    name: text('name').notNull(),
    description: text('description'),

    /**
     * Stored as `PermissionKey[]`. Parsed through `isPermissionKey` on read
     * so an unknown key (from a deprecated catalogue entry) is simply
     * dropped rather than granting phantom access.
     */
    permissions: jsonb('permissions')
      .notNull()
      .$type<readonly string[]>()
      .default(sql`'[]'::jsonb`),

    /**
     * `true` for the three defaults seeded on tenant creation. Custom
     * tenant-authored sets are `false`.
     */
    isSystem: boolean('is_system').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // Every query must scope by tenantId (ADR 0002) — composite index with
    // tenantId leading covers both the tenant-scoped list and name lookup.
    index('permission_sets_tenant_id_name_idx').on(table.tenantId, table.name),
  ],
);

export type PermissionSet = typeof permissionSets.$inferSelect;
export type NewPermissionSet = typeof permissionSets.$inferInsert;
