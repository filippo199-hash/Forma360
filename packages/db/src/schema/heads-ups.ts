/**
 * Heads Up subgraph — Phase 5A.
 *
 * Four tenant-scoped tables:
 *
 *   - heads_ups          — the broadcast message row. Status lifecycle:
 *                          draft → published (immediately or scheduled)
 *                          → archived. Three engagement levels: view,
 *                          acknowledge, sign.
 *   - heads_up_recipients — one row per resolved recipient (users
 *                           expanded from groups/sites at publish time,
 *                           H-E01). Tracks viewed_at / acknowledged_at /
 *                           signed_at per-user.
 *   - heads_up_attachments — media/file attachments on the message.
 *   - heads_up_comments   — collaboration thread; append-only.
 *
 * See ADR 0002 (tenant scope + RESTRICT FKs).
 */
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { tenants } from './tenants';

export const headsUpStatus = ['draft', 'published', 'archived'] as const;
export type HeadsUpStatus = (typeof headsUpStatus)[number];

export const headsUpEngagementLevel = ['view', 'acknowledge', 'sign'] as const;
export type HeadsUpEngagementLevel = (typeof headsUpEngagementLevel)[number];

export const headsUps = pgTable(
  'heads_ups',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    status: text('status').notNull().default('draft'),
    engagementLevel: text('engagement_level').notNull().default('view'),
    requireAcknowledgement: boolean('require_acknowledgement').notNull().default(false),
    requireSignature: boolean('require_signature').notNull().default(false),
    publishAt: timestamp('publish_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    linkedDocumentId: text('linked_document_id'),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('heads_ups_tenant_id_idx').on(t.tenantId),
    index('heads_ups_tenant_status_idx').on(t.tenantId, t.status),
  ],
);

export type HeadsUp = typeof headsUps.$inferSelect;
export type NewHeadsUp = typeof headsUps.$inferInsert;

export const headsUpRecipients = pgTable(
  'heads_up_recipients',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    headsUpId: text('heads_up_id')
      .notNull()
      .references(() => headsUps.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    viewedAt: timestamp('viewed_at', { withTimezone: true }),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    signatureData: text('signature_data'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('heads_up_recipients_unique_idx').on(t.headsUpId, t.userId),
    index('heads_up_recipients_heads_up_idx').on(t.headsUpId),
    index('heads_up_recipients_user_idx').on(t.userId),
  ],
);

export type HeadsUpRecipient = typeof headsUpRecipients.$inferSelect;

export const headsUpAttachments = pgTable(
  'heads_up_attachments',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    headsUpId: text('heads_up_id')
      .notNull()
      .references(() => headsUps.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull(),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull().default(0),
    uploadedByUserId: text('uploaded_by_user_id')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('heads_up_attachments_heads_up_idx').on(t.headsUpId)],
);

export type HeadsUpAttachment = typeof headsUpAttachments.$inferSelect;

export const headsUpComments = pgTable(
  'heads_up_comments',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    headsUpId: text('heads_up_id')
      .notNull()
      .references(() => headsUps.id, { onDelete: 'cascade' }),
    authorUserId: text('author_user_id')
      .notNull()
      .references(() => user.id),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('heads_up_comments_heads_up_idx').on(t.headsUpId)],
);

export type HeadsUpComment = typeof headsUpComments.$inferSelect;
