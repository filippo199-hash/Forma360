/**
 * Site/Project plans & drawings (Phase 3) — floor plans, site layouts and
 * drawings uploaded per site, with a level ordering so a building's floors
 * can be switched like an indoor map. Observations, photos, assets and
 * inspections are pinned onto a plan at normalised (x, y) coordinates.
 *
 * `site_plans`      — one row per plan/level image.
 * `site_plan_pins`  — one row per pin, referencing a plan + (optionally) an
 *                     entity elsewhere in the platform.
 *
 * Both cascade from their site (safety net; sites are normally archived).
 */
import { index, integer, pgTable, real, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { sites } from './sites';
import { tenants } from './tenants';

export const sitePlanKind = ['image', 'pdf'] as const;
export type SitePlanKind = (typeof sitePlanKind)[number];

export const sitePlanPinEntity = ['observation', 'asset', 'media', 'inspection', 'note'] as const;
export type SitePlanPinEntity = (typeof sitePlanPinEntity)[number];

export const sitePlans = pgTable(
  'site_plans',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    siteId: varchar('site_id', { length: 26 })
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** R2 object key: `<tenantId>/site-plans/<siteId>/<filename>`. */
    storageKey: text('storage_key').notNull(),
    mimeType: text('mime_type').notNull(),
    /** 'image' (interactive/pinnable) | 'pdf' (download fallback). */
    kind: text('kind').notNull().default('image'),
    /** Level ordering — lower shows first in the switcher (e.g. floors). */
    sortOrder: integer('sort_order').notNull().default(0),
    uploadedBy: varchar('uploaded_by', { length: 64 })
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    index('site_plans_tenant_idx').on(t.tenantId),
    index('site_plans_site_idx').on(t.tenantId, t.siteId),
  ],
);

export const sitePlanPins = pgTable(
  'site_plan_pins',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    planId: varchar('plan_id', { length: 26 })
      .notNull()
      .references(() => sitePlans.id, { onDelete: 'cascade' }),
    /** Denormalised for tenant+site scoped queries. */
    siteId: varchar('site_id', { length: 26 })
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    /** Normalised 0..1 position on the plan image (fraction of width/height). */
    x: real('x').notNull(),
    y: real('y').notNull(),
    /** What this pin points at. 'note' pins have no entity. */
    entityType: text('entity_type').notNull().default('note'),
    /** Id of the referenced observation/asset/media/inspection; null for notes. */
    entityId: varchar('entity_id', { length: 26 }),
    label: text('label').notNull().default(''),
    createdBy: varchar('created_by', { length: 64 })
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    index('site_plan_pins_tenant_idx').on(t.tenantId),
    index('site_plan_pins_plan_idx').on(t.tenantId, t.planId),
  ],
);

export type SitePlan = typeof sitePlans.$inferSelect;
export type SitePlanPin = typeof sitePlanPins.$inferSelect;
