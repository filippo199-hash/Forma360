/**
 * Tenants table.
 *
 * Every user-facing record in the system belongs to exactly one tenant.
 * The `tenant_id` foreign key on every other table references `tenants.id`
 * and is enforced via `tenantProcedure` at the tRPC boundary — clients never
 * supply a tenant id directly. See ADR 0002.
 */
import { sql } from 'drizzle-orm';
import { jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

/**
 * Tenant-level settings envelope. Shape stays intentionally loose so Phase N
 * modules can add their own keys without a schema migration. Read through
 * a Zod schema at every access to narrow.
 *
 * Phase 1 keys:
 *   - `siteLabels`: array of level names (default `["Country","Region","Area","Site"]`).
 *     Used by Module 9 to customise breadcrumb copy.
 */
export interface TenantSettings {
  siteLabels?: readonly string[];
  [key: string]: unknown;
}

const DEFAULT_SETTINGS: TenantSettings = {};

export const tenants = pgTable('tenants', {
  /** ULID, 26 chars, Crockford base32. See ADR 0003. */
  id: varchar('id', { length: 26 }).primaryKey(),

  /** Human-readable display name of the tenant (e.g. "Acme Safety Ltd"). */
  name: text('name').notNull(),

  /**
   * URL-safe, globally unique slug used in preview / public URLs. Lowercased
   * alphanumeric + dashes enforced at the application layer (Zod).
   */
  slug: text('slug').notNull().unique(),

  /**
   * Tenant-wide settings (site labels, defaults, flags). Read through a
   * Zod schema; writing is admin-only and goes through an `org.settings`
   * permission check.
   */
  settings: jsonb('settings')
    .notNull()
    .$type<TenantSettings>()
    .default(sql`'${sql.raw(JSON.stringify(DEFAULT_SETTINGS))}'::jsonb`),

  /** UTC timestamp of row creation, server-assigned. */
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .default(sql`now()`),

  /**
   * UTC timestamp of the last row mutation. Application code should bump this
   * on every UPDATE; migrations do not install a trigger for it.
   */
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .default(sql`now()`),

  /**
   * Soft-delete timestamp. Null for active tenants; set by the tenant archive
   * flow (Phase 1) rather than hard-deleted so cascaded downstream records
   * remain historically queryable.
   */
  archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
});

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
