/**
 * Assets subgraph — Phase 5B.
 *
 * Three tenant-scoped tables:
 *
 *   - asset_types            — admin-defined taxonomy with custom-field
 *                              definitions (JSONB). AS-E12: can't delete
 *                              a type with active assets.
 *   - assets                 — the asset register row. One-level parent-
 *                              child hierarchy (AS-E11: no 2-level nesting).
 *                              AS-E01: can't delete parent with sub-assets.
 *                              Has a unique QR token for mobile scanning.
 *   - asset_readings         — odometer / runtime / temperature readings.
 *                              Manual or telematics source.
 *
 * See ADR 0002 (tenant scope + RESTRICT FKs).
 */
import { index, jsonb, numeric, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { sites } from './sites';
import { tenants } from './tenants';

export interface AssetCustomFieldDef {
  id: string;
  name: string;
  fieldType: 'text' | 'number' | 'date' | 'select';
  options?: string[];
  required?: boolean;
}

export const assetTypes = pgTable(
  'asset_types',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    /** Array of AssetCustomFieldDef objects. */
    customFields: jsonb('custom_fields').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [index('asset_types_tenant_idx').on(t.tenantId)],
);

export type AssetType = typeof assetTypes.$inferSelect;

export const assetReadingSource = ['manual', 'telematics'] as const;
export type AssetReadingSource = (typeof assetReadingSource)[number];

export const assets = pgTable(
  'assets',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    typeId: text('type_id').references(() => assetTypes.id),
    siteId: text('site_id').references(() => sites.id, { onDelete: 'set null' }),
    parentId: text('parent_id'),
    /** Single responsible user for this asset. Cleared if the user is removed. */
    ownerUserId: text('owner_user_id').references(() => user.id, { onDelete: 'set null' }),
    photoKey: text('photo_key'),
    /** Map of { fieldId: value } matching the type's customFields def. */
    customFieldValues: jsonb('custom_field_values').notNull().default({}),
    qrToken: text('qr_token').unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    index('assets_tenant_idx').on(t.tenantId),
    index('assets_tenant_type_idx').on(t.tenantId, t.typeId),
    index('assets_tenant_site_idx').on(t.tenantId, t.siteId),
    index('assets_parent_idx').on(t.parentId),
    index('assets_owner_idx').on(t.ownerUserId),
  ],
);

export type Asset = typeof assets.$inferSelect;

export const assetReadings = pgTable(
  'asset_readings',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    fieldName: text('field_name').notNull(),
    value: numeric('value').notNull(),
    unit: text('unit').notNull().default(''),
    source: text('source').notNull().default('manual'),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
    capturedByUserId: text('captured_by_user_id').references(() => user.id),
  },
  (t) => [index('asset_readings_asset_idx').on(t.assetId, t.capturedAt)],
);

export type AssetReading = typeof assetReadings.$inferSelect;
