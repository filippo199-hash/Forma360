/**
 * Custom user fields.
 *
 * Tenants define their own per-user metadata (role, department, shift,
 * location, ...). Fields have a type (text / select / multi_select) and,
 * for select types, a catalogue of options. Field values live in the
 * `user_custom_field_values` join.
 *
 * Rule-based group / site membership keys off these field values — see
 * ADR 0002 and the Phase 1 prompt's 1.3 / 1.4 sections.
 *
 * Deletion of a field referenced by any membership rule is blocked at the
 * router layer (S-E04). The FK here is RESTRICT to back-stop that check.
 */
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { user } from './auth';

export const customUserFieldType = ['text', 'select', 'multi_select'] as const;
export type CustomUserFieldType = (typeof customUserFieldType)[number];

export const customUserFields = pgTable(
  'custom_user_fields',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    /** "text" | "select" | "multi_select". Validated at the router boundary. */
    type: text('type').notNull(),
    /**
     * For select / multi_select: array of `{ id, label }`. For text: empty.
     * Stored as JSON so adding an option does not require a migration.
     */
    options: jsonb('options')
      .notNull()
      .$type<ReadonlyArray<{ id: string; label: string }>>()
      .default(sql`'[]'::jsonb`),
    required: text('required').notNull().default('false'),
    /** Display order within the tenant's field list. */
    order: integer('order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('custom_user_fields_tenant_id_idx').on(table.tenantId, table.order),
    uniqueIndex('custom_user_fields_tenant_id_name_unique').on(table.tenantId, table.name),
  ],
);

export type CustomUserField = typeof customUserFields.$inferSelect;
export type NewCustomUserField = typeof customUserFields.$inferInsert;

/**
 * User × field value join.
 *
 * Composite PK on (user_id, field_id) ensures at most one value per user
 * per field. Rule-based membership evaluators query this table.
 *
 * `value` is stored as text regardless of field type; for multi_select it
 * contains a JSON-encoded array which the evaluator parses. This keeps the
 * shape uniform and indexes simple.
 */
export const userCustomFieldValues = pgTable(
  'user_custom_field_values',
  {
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    fieldId: varchar('field_id', { length: 26 })
      .notNull()
      .references(() => customUserFields.id, { onDelete: 'restrict' }),
    value: text('value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // Leading tenantId per ADR 0002. Secondary composite unique on
    // (userId, fieldId) enforces one-value-per-user-per-field.
    uniqueIndex('user_custom_field_values_user_id_field_id_unique').on(table.userId, table.fieldId),
    index('user_custom_field_values_tenant_id_field_id_idx').on(table.tenantId, table.fieldId),
  ],
);

export type UserCustomFieldValue = typeof userCustomFieldValues.$inferSelect;
export type NewUserCustomFieldValue = typeof userCustomFieldValues.$inferInsert;
