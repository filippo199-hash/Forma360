/**
 * Site/Project media gallery — standalone photos & videos attached directly
 * to a site or project (the "site diary" / progress-photo stream), distinct
 * from inspection evidence or observation attachments.
 *
 * Rows point at an R2 object via `storageKey`
 * (`<tenantId>/site-media/<siteId>/<filename>`) and carry a caption plus an
 * AI-generated `tags` array (populated by a later phase). `capturedAt` is the
 * moment the photo was taken when known (EXIF, later); until then it mirrors
 * `createdAt` at the router.
 *
 * Cascade: media is a child of its site, so `ON DELETE CASCADE` — when a site
 * is hard-deleted its media goes with it. (Sites are normally archived, not
 * deleted; the cascade is a safety net, consistent with issueAttachments.)
 */
import { index, integer, jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { sites } from './sites';
import { tenants } from './tenants';

export const siteMediaKind = ['photo', 'video'] as const;
export type SiteMediaKind = (typeof siteMediaKind)[number];

export const siteMedia = pgTable(
  'site_media',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    siteId: varchar('site_id', { length: 26 })
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    /** R2 object key: `<tenantId>/site-media/<siteId>/<filename>`. */
    storageKey: text('storage_key').notNull(),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    /** 'photo' | 'video' — derived from the mime type at upload. */
    kind: text('kind').notNull().default('photo'),
    /** User-entered caption. Empty string when unset. */
    caption: text('caption').notNull().default(''),
    /** AI-generated labels (Phase 2b). Array of short strings. */
    tags: jsonb('tags').notNull().$type<readonly string[]>().default([]),
    /** When the media was captured (EXIF, later). Mirrors createdAt for now. */
    capturedAt: timestamp('captured_at', { withTimezone: true, mode: 'date' }),
    uploadedBy: varchar('uploaded_by', { length: 64 })
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    index('site_media_tenant_idx').on(t.tenantId),
    index('site_media_site_idx').on(t.tenantId, t.siteId),
  ],
);

export type SiteMedia = typeof siteMedia.$inferSelect;
