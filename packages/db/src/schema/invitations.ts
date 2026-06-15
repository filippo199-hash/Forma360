/**
 * Invitations table.
 *
 * One row per pending invitation. The invitations flow is the only path
 * by which a user is added to an existing tenant — direct row creation
 * via the previous `users.invite` was rewritten to insert here instead.
 *
 * Lifecycle:
 *   1. Admin clicks "Invite" → row inserted, opaque `token` mailed out.
 *   2. Invitee clicks the email link → `acceptInvite` mutation reads
 *      the token, creates the `user` + `account` rows in one tx, then
 *      stamps `acceptedAt`.
 *   3. Expired invites can be re-issued (the admin path UPSERTs the
 *      existing active row by `(tenant_id, lower(email))`).
 *
 * Foreign-key column types match the existing schema:
 *   - `tenant_id` / `permission_set_id` are ULID `varchar(26)`
 *   - `invited_by_user_id` is `text` to match `user.id`
 */
import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { permissionSets } from './permissions';
import { tenants } from './tenants';

export const invitations = pgTable(
  'invitations',
  {
    /** ULID. */
    id: varchar('id', { length: 26 }).primaryKey(),

    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    /** Address the invitation was issued to. Stored as-provided; lookups
     * normalise via `lower(email)`. */
    email: text('email').notNull(),

    /** Optional display name suggested by the admin at invite time. */
    name: text('name'),

    permissionSetId: varchar('permission_set_id', { length: 26 })
      .notNull()
      .references(() => permissionSets.id, { onDelete: 'restrict' }),

    /** 64-hex-char (crypto.randomBytes(32)) opaque token. Globally unique. */
    token: varchar('token', { length: 64 }).notNull().unique(),

    /** The admin user who created the invitation. `text` to match user.id. */
    invitedByUserId: text('invited_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),

    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),

    /** Null until the invitee successfully accepts; set in the accept tx. */
    acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'date' }),

    /**
     * Group IDs (ULIDs) the new user should be added to when they accept.
     * Stored as a JSON array so no additional foreign-key coupling is
     * introduced — groups may be archived between invite and acceptance.
     */
    groupIds: jsonb('group_ids').$type<string[]>(),

    /**
     * Site IDs (ULIDs) the new user should be added to on acceptance.
     * Same rationale as groupIds above.
     */
    siteIds: jsonb('site_ids').$type<string[]>(),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('invitations_tenant_id_idx').on(t.tenantId),
    /**
     * One active invite per (tenant, email). The partial index excludes
     * accepted rows so re-inviting after acceptance is allowed (the
     * acceptance creates a real user row, after which there is nothing
     * to reuse anyway).
     */
    activeUnique: uniqueIndex('invitations_active_email_idx')
      .on(t.tenantId, sql`lower(${t.email})`)
      .where(sql`${t.acceptedAt} IS NULL`),
  }),
);

export type Invitation = typeof invitations.$inferSelect;
export type NewInvitation = typeof invitations.$inferInsert;
