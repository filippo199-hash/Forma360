/**
 * Groups + membership (manual + rule-based).
 *
 * Tables:
 *   - groups — one row per group, with a mode flag
 *   - group_members — the (group, user) join, composite PK
 *   - group_membership_rules — tenant-scoped, per-group list of rules
 *
 * Limits enforced at the router / reconcile-job layer (not the DB):
 *   - ≤ 5 rules per group
 *   - ≤ 15,000 users in a single rule-based group
 *   - ≤ 100 groups per user
 *
 * Rule conditions are stored as a JSON array of `{ fieldId, operator, value }`
 * and combined with AND. Multiple rules on the same group combined with OR.
 * The shape is validated at the router boundary by a Zod schema in
 * `@forma360/permissions/rules`.
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

export const groupMembershipMode = ['manual', 'rule_based'] as const;
export type GroupMembershipMode = (typeof groupMembershipMode)[number];

export const groups = pgTable(
  'groups',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    description: text('description'),
    /** "manual" | "rule_based". Defaults to manual. */
    membershipMode: text('membership_mode').notNull().default('manual'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    /** Soft-delete. Cascade preview via getDependents('group', id). */
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [uniqueIndex('groups_tenant_id_name_unique').on(table.tenantId, table.name)],
);

export type Group = typeof groups.$inferSelect;
export type NewGroup = typeof groups.$inferInsert;

export const groupMembers = pgTable(
  'group_members',
  {
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    groupId: varchar('group_id', { length: 26 })
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** "manual" | "rule_based" — whose turn it was to add the user. */
    addedVia: text('added_via').notNull().default('manual'),
    addedBy: text('added_by'),
    addedAt: timestamp('added_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('group_members_group_id_user_id_unique').on(table.groupId, table.userId),
    index('group_members_tenant_id_user_id_idx').on(table.tenantId, table.userId),
  ],
);

export type GroupMember = typeof groupMembers.$inferSelect;
export type NewGroupMember = typeof groupMembers.$inferInsert;

/**
 * Rule row. `conditions` is a JSON array of
 * `{ fieldId, operator, value }` combined with AND. Each row is a single
 * OR-rule; multiple rows on the same group OR together to match a user.
 */
export const groupMembershipRules = pgTable(
  'group_membership_rules',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    groupId: varchar('group_id', { length: 26 })
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    /** Order within the group's rule list (first match wins on conflict). */
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
    index('group_membership_rules_tenant_id_group_id_idx').on(
      table.tenantId,
      table.groupId,
      table.order,
    ),
  ],
);

export type GroupMembershipRule = typeof groupMembershipRules.$inferSelect;
export type NewGroupMembershipRule = typeof groupMembershipRules.$inferInsert;
