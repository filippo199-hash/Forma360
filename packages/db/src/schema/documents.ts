/**
 * Documents subgraph — Phase 5C.
 *
 * Four tenant-scoped tables:
 *
 *   - document_folders  — self-referencing folder hierarchy. D-E06:
 *                         can't delete a non-empty folder.
 *   - documents         — the document row. Points to a currentVersion
 *                         counter; each upload appends a version row.
 *                         D-E03: 50 MB file size limit enforced at
 *                         the router level. D-E05: site deleted →
 *                         site_id cleared (SET NULL at app layer).
 *                         freshness_days: when set, documents older
 *                         than freshness_days are flagged as stale.
 *   - document_versions — immutable per-version storage row. Version
 *                         numbers are dense and monotonically increasing
 *                         per document.
 *   - document_access   — per-document or per-folder ACL rows. Subject
 *                         can be a user or group; permission is
 *                         view | edit | manage. D-E07: compliance
 *                         evidence link stores document_id in issues /
 *                         inspections (handled at query layer).
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

export const documentFolders = pgTable(
  'document_folders',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    parentId: text('parent_id'),
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
    /** Array of label strings. */
    labels: jsonb('labels').notNull().default([]),
    /** When set, documents older than this many days are flagged stale. */
    freshnessDays: integer('freshness_days'),
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
  ],
);

export type Document = typeof documents.$inferSelect;

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
