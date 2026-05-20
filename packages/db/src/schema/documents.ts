/**
 * Documents & Policies subgraph — Phase 5D.
 *
 * Tables:
 *   - document_labels    — tenant-scoped label catalogue (name + colour).
 *   - document_folders   — self-referencing folder hierarchy with optional
 *                          group / site visibility restrictions (JSONB arrays).
 *                          D-E06: can't delete a non-empty folder.
 *   - documents          — the document / policy row. Tracks lifecycle
 *                          (start_date, expires_at), responsible party,
 *                          configurable reminder_days before expiry, and
 *                          references label_ids from document_labels.
 *                          D-E03: 50 MB file size limit at the router level.
 *   - document_versions  — immutable per-version rows; version numbers are
 *                          dense and monotonically increasing per document.
 *   - document_access    — per-document or per-folder ACL rows (user|group,
 *                          view|edit|manage). D-E07: compliance evidence link.
 *
 * See ADR 0002 (tenant scope + RESTRICT FKs).
 */
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { tenants } from './tenants';

// ─── Labels ─────────────────────────────────────────────────────────────────

export const documentLabels = pgTable(
  'document_labels',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    /** Hex colour, e.g. #6366f1. */
    color: text('color').notNull().default('#6366f1'),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('document_labels_tenant_idx').on(t.tenantId),
    uniqueIndex('document_labels_tenant_name_unique').on(t.tenantId, t.name),
  ],
);

export type DocumentLabel = typeof documentLabels.$inferSelect;

// ─── Folders ─────────────────────────────────────────────────────────────────

export const documentFolders = pgTable(
  'document_folders',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    parentId: text('parent_id'),
    /**
     * Optional group-level visibility. When non-empty, only users who
     * belong to at least one of these groups can see the folder.
     * Stored as a JSONB array of group ULID strings.
     */
    visibleToGroupIds: jsonb('visible_to_group_ids').notNull().default([]),
    /**
     * Optional site-level visibility. Same semantics as visibleToGroupIds.
     */
    visibleToSiteIds: jsonb('visible_to_site_ids').notNull().default([]),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('document_folders_tenant_idx').on(t.tenantId),
    index('document_folders_parent_idx').on(t.parentId),
  ],
);

export type DocumentFolder = typeof documentFolders.$inferSelect;

export const documentAccessPermission = ['view', 'edit', 'manage'] as const;
export type DocumentAccessPermission = (typeof documentAccessPermission)[number];

export const documentAccessSubjectType = ['user', 'group'] as const;
export type DocumentAccessSubjectType = (typeof documentAccessSubjectType)[number];

// ─── Documents ───────────────────────────────────────────────────────────────

export const documents = pgTable(
  'documents',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    folderId: text('folder_id').references(() => documentFolders.id),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    storageKey: text('storage_key').notNull(),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull().default(0),
    siteId: text('site_id'),
    /**
     * Legacy plain-string labels array (kept for backward compat).
     * New code uses label_ids referencing document_labels.
     */
    labels: jsonb('labels').notNull().default([]),
    /** ULID references into document_labels. */
    labelIds: jsonb('label_ids').notNull().default([]),
    /** When set, documents older than this many days are flagged stale. */
    freshnessDays: integer('freshness_days'),
    /** Lifecycle: when the document / policy comes into effect. */
    startDate: timestamp('start_date', { withTimezone: true }),
    /** Lifecycle: when the document / policy expires. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /**
     * Responsible individual. Nullable FK to user so row isn't blocked
     * if the user is later deactivated (app layer clears it).
     */
    responsibleUserId: text('responsible_user_id'),
    /**
     * Responsible group — stored as a plain text group ULID so there is
     * no hard FK (groups are soft-deleted). App layer validates on write.
     */
    responsibleGroupId: text('responsible_group_id'),
    /**
     * Days-before-expiry to send a reminder notification.
     * Example: [7, 30] → notify 30 days before and again 7 days before.
     */
    reminderDays: jsonb('reminder_days').notNull().default([]),
    currentVersion: integer('current_version').notNull().default(1),
    uploadedByUserId: text('uploaded_by_user_id')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    index('documents_tenant_idx').on(t.tenantId),
    index('documents_folder_idx').on(t.folderId),
    index('documents_tenant_site_idx').on(t.tenantId, t.siteId),
    index('documents_expires_at_idx').on(t.expiresAt),
  ],
);

export type Document = typeof documents.$inferSelect;

// ─── Versions ───────────────────────────────────────────────────────────────

export const documentVersions = pgTable(
  'document_versions',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    version: integer('version').notNull(),
    storageKey: text('storage_key').notNull(),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull().default(0),
    uploadedByUserId: text('uploaded_by_user_id')
      .notNull()
      .references(() => user.id),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('document_versions_unique_idx').on(t.documentId, t.version),
    index('document_versions_document_idx').on(t.documentId, t.version),
  ],
);

export type DocumentVersion = typeof documentVersions.$inferSelect;

// ─── Access ──────────────────────────────────────────────────────────────────

export const documentAccess = pgTable(
  'document_access',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id').references(() => documents.id, { onDelete: 'cascade' }),
    folderId: text('folder_id').references(() => documentFolders.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** 'user' | 'group' */
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    /** 'view' | 'edit' | 'manage' */
    permission: text('permission').notNull(),
    grantedByUserId: text('granted_by_user_id')
      .notNull()
      .references(() => user.id),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('document_access_document_idx').on(t.documentId),
    index('document_access_folder_idx').on(t.folderId),
    index('document_access_subject_idx').on(t.tenantId, t.subjectType, t.subjectId),
  ],
);

export type DocumentAccess = typeof documentAccess.$inferSelect;
