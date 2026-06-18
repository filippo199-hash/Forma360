/**
 * Maintenance Programs (To-Do #3).
 *
 * Replaces the single-interval "maintenance plan" model with a higher-level
 * **program**: a reusable bundle of **triggers**, each of which fires on a
 * schedule (time / distance / usage). A program is attached to one or more
 * assets; attaching it materialises a future-dated **Action** per trigger
 * (in the Actions module), and completing that action rolls the next one
 * forward. See ADR 0006 (jobs) + the actions router for the roll-forward.
 *
 *   - maintenance_programs          the reusable program (name + triggers)
 *   - maintenance_program_triggers  one row per scheduled task in a program
 *   - maintenance_program_assets    program ↔ asset attachments
 */
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { assets } from './assets';
import { tenants } from './tenants';

/** How a trigger's next-due is computed. */
export const maintenanceTriggerTypes = ['time', 'distance', 'usage'] as const;
export type MaintenanceTriggerType = (typeof maintenanceTriggerTypes)[number];

export const maintenancePrograms = pgTable(
  'maintenance_programs',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [index('maintenance_programs_tenant_idx').on(t.tenantId)],
);

export type MaintenanceProgram = typeof maintenancePrograms.$inferSelect;

export const maintenanceProgramTriggers = pgTable(
  'maintenance_program_triggers',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    programId: varchar('program_id', { length: 26 })
      .notNull()
      .references(() => maintenancePrograms.id, { onDelete: 'cascade' }),
    /** What gets done, e.g. "Change oil". */
    title: text('title').notNull(),
    /** 'time' | 'distance' | 'usage'. */
    triggerType: text('trigger_type').notNull().$type<MaintenanceTriggerType>(),
    /** For time triggers: interval in days (e.g. 365 = yearly). */
    intervalDays: integer('interval_days'),
    /** For distance/usage triggers: interval in `unit` (e.g. 10000 km). */
    intervalValue: numeric('interval_value'),
    /** Reading field name for distance/usage triggers (e.g. "odometer"). */
    usageField: text('usage_field'),
    /** Display unit (e.g. "km", "hours", "miles"). */
    unit: text('unit'),
    /** Display order within the program. */
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index('maintenance_program_triggers_program_idx').on(t.programId),
    index('maintenance_program_triggers_tenant_idx').on(t.tenantId),
  ],
);

export type MaintenanceProgramTrigger = typeof maintenanceProgramTriggers.$inferSelect;

export const maintenanceProgramAssets = pgTable(
  'maintenance_program_assets',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    programId: varchar('program_id', { length: 26 })
      .notNull()
      .references(() => maintenancePrograms.id, { onDelete: 'cascade' }),
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    uniqueIndex('maintenance_program_assets_unique').on(t.programId, t.assetId),
    index('maintenance_program_assets_asset_idx').on(t.assetId),
    index('maintenance_program_assets_tenant_idx').on(t.tenantId),
  ],
);

export type MaintenanceProgramAsset = typeof maintenanceProgramAssets.$inferSelect;
