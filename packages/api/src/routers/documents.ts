/**
 * Documents & Policies router — Phase 5D.
 *
 * Lifecycle fields added: start_date, expires_at, responsible_user_id,
 * responsible_group_id, reminder_days, label_ids.
 *
 * Key edge cases:
 *   D-E03: 50 MB file size limit at the router boundary.
 *   D-E05: site_id is nullable; cleared at app layer when a site is deleted.
 *   Version history: each upload appends a document_versions row and bumps
 *     documents.current_version.
 *   Access: document_access rows grant user/group view|edit|manage on a
 *     document or folder.
 */
import {
  documentAccess,
  documentFolders,
  documentVersions,
  documents,
  headsUpDocuments,
  headsUpRecipients,
  headsUps,
  type Document,
} from '@forma360/db/schema';
import { user } from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, ilike, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission, tenantProcedure } from '../procedures';
import {
  assertGroupsInTenant,
  assertSitesInTenant,
  assertStorageKeyInTenant,
  assertUsersInTenant,
} from '../tenant-guards';
import { router } from '../trpc';
import {
  loadViewerMemberships,
  makeFolderVisibilityChecker,
  ownVisibilityPasses,
} from './document-visibility';

type Db = Parameters<Parameters<typeof tenantProcedure.query>[0]>[0]['ctx']['db'];

const documentIdInput = z.object({ documentId: z.string().length(26) });

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // D-E03: 50 MB

async function loadDocumentOrThrow(
  db: Db,
  tenantId: string,
  documentId: string,
): Promise<Document> {
  const rows = await db
    .select()
    .from(documents)
    .where(and(eq(documents.tenantId, tenantId), eq(documents.id, documentId)))
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'document-not-found' });
  }
  return row;
}

/** Shared lifecycle / label fields used by create + update. */
const lifecycleFields = {
  /** ISO date string or null. */
  startDate: z.string().datetime({ offset: true }).optional().nullable(),
  /** ISO date string or null. When set, reminder jobs fire reminder_days before. */
  expiresAt: z.string().datetime({ offset: true }).optional().nullable(),
  /**
   * Responsible user ID. Better-auth user IDs are NOT plain ULIDs —
   * they carry a "usr_" prefix making them ~30 chars, so we validate
   * by min length only (same pattern as users/groups routers).
   */
  responsibleUserId: z.string().min(1).max(100).optional().nullable(),
  /** Responsible group ULID. */
  responsibleGroupId: z.string().length(26).optional().nullable(),
  /**
   * Days before expiresAt to send a reminder. E.g. [30, 7].
   * Ignored when expiresAt is null.
   */
  reminderDays: z.array(z.number().int().min(1).max(365)).default([]),
  /** Array of document_labels ULIDs. */
  labelIds: z.array(z.string().length(26)).default([]),
};

const createInput = z.object({
  name: z.string().min(1).max(500),
  description: z.string().max(5000).default(''),
  folderId: z.string().length(26).optional(),
  storageKey: z.string().min(1).max(1000),
  filename: z.string().min(1).max(500),
  mimeType: z.string().min(1).max(200),
  /** Must not exceed 50 MB (D-E03). */
  sizeBytes: z.number().int().min(0).max(MAX_FILE_SIZE_BYTES),
  siteId: z.string().length(26).optional(),
  labels: z.array(z.string().max(100)).default([]),
  freshnessDays: z.number().int().min(1).optional(),
  ...lifecycleFields,
});

const updateInput = z.object({
  documentId: z.string().length(26),
  name: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional(),
  folderId: z.string().length(26).nullable().optional(),
  siteId: z.string().length(26).nullable().optional(),
  labels: z.array(z.string().max(100)).optional(),
  freshnessDays: z.number().int().min(1).nullable().optional(),
  startDate: z.string().datetime({ offset: true }).optional().nullable(),
  expiresAt: z.string().datetime({ offset: true }).optional().nullable(),
  // Better-auth user IDs are not plain ULIDs (have a "usr_" prefix).
  responsibleUserId: z.string().min(1).max(100).optional().nullable(),
  responsibleGroupId: z.string().length(26).optional().nullable(),
  reminderDays: z.array(z.number().int().min(1).max(365)).optional(),
  labelIds: z.array(z.string().length(26)).optional(),
  /** File visibility (To-Do #5): empty arrays = visible to everyone. */
  visibleToGroupIds: z.array(z.string().length(26)).optional(),
  visibleToSiteIds: z.array(z.string().length(26)).optional(),
});

const uploadNewVersionInput = z.object({
  documentId: z.string().length(26),
  storageKey: z.string().min(1).max(1000),
  filename: z.string().min(1).max(500),
  mimeType: z.string().min(1).max(200),
  /** Must not exceed 50 MB (D-E03). */
  sizeBytes: z.number().int().min(0).max(MAX_FILE_SIZE_BYTES),
});

const listInput = z
  .object({
    folderId: z.string().length(26).nullable().optional(),
    siteId: z.string().length(26).optional(),
    query: z.string().max(200).optional(),
    includeArchived: z.boolean().default(false),
    limit: z.number().int().min(1).max(500).default(200),
  })
  .default({ includeArchived: false, limit: 200 });

const grantAccessInput = z.object({
  documentId: z.string().length(26).optional(),
  folderId: z.string().length(26).optional(),
  subjectType: z.enum(['user', 'group']),
  subjectId: z.string().length(26),
  permission: z.enum(['view', 'edit', 'manage']),
});

const revokeAccessInput = z.object({
  accessId: z.string().length(26),
});

const listAccessInput = z.object({
  documentId: z.string().length(26).optional(),
  folderId: z.string().length(26).optional(),
});

export const documentsRouter = router({
  list: tenantProcedure
    .use(requirePermission('documents.view'))
    .input(listInput)
    .query(async ({ ctx, input }) => {
      const where = [eq(documents.tenantId, ctx.tenantId)];
      if (input.folderId !== undefined) {
        if (input.folderId === null) where.push(isNull(documents.folderId));
        else where.push(eq(documents.folderId, input.folderId));
      }
      if (input.siteId !== undefined) where.push(eq(documents.siteId, input.siteId));
      if (input.query !== undefined && input.query.trim().length > 0) {
        where.push(ilike(documents.name, `%${input.query.trim()}%`));
      }
      if (!input.includeArchived) where.push(isNull(documents.archivedAt));

      const rows = await ctx.db
        .select({
          id: documents.id,
          name: documents.name,
          folderId: documents.folderId,
          folderName: documentFolders.name,
          mimeType: documents.mimeType,
          sizeBytes: documents.sizeBytes,
          siteId: documents.siteId,
          labels: documents.labels,
          labelIds: documents.labelIds,
          freshnessDays: documents.freshnessDays,
          startDate: documents.startDate,
          expiresAt: documents.expiresAt,
          responsibleUserId: documents.responsibleUserId,
          responsibleGroupId: documents.responsibleGroupId,
          visibleToGroupIds: documents.visibleToGroupIds,
          visibleToSiteIds: documents.visibleToSiteIds,
          currentVersion: documents.currentVersion,
          uploadedByUserId: documents.uploadedByUserId,
          uploaderName: user.name,
          createdAt: documents.createdAt,
          updatedAt: documents.updatedAt,
          archivedAt: documents.archivedAt,
        })
        .from(documents)
        .leftJoin(documentFolders, eq(documentFolders.id, documents.folderId))
        .leftJoin(user, eq(user.id, documents.uploadedByUserId))
        .where(and(...where))
        .orderBy(asc(documents.name))
        .limit(input.limit);

      // Managers see everything; everyone else is filtered by file + ancestor
      // folder visibility (To-Do #5/#6).
      if (ctx.permissions.includes('documents.manage')) return rows;

      const [viewer, allFolders] = await Promise.all([
        loadViewerMemberships(ctx.db, ctx.tenantId, ctx.auth.userId),
        ctx.db
          .select({
            id: documentFolders.id,
            parentId: documentFolders.parentId,
            visibleToGroupIds: documentFolders.visibleToGroupIds,
            visibleToSiteIds: documentFolders.visibleToSiteIds,
          })
          .from(documentFolders)
          .where(eq(documentFolders.tenantId, ctx.tenantId)),
      ]);
      const folderVisible = makeFolderVisibilityChecker(allFolders, viewer);

      return rows.filter(
        (r) =>
          ownVisibilityPasses(r.visibleToGroupIds, r.visibleToSiteIds, viewer) &&
          folderVisible(r.folderId),
      );
    }),

  get: tenantProcedure
    .use(requirePermission('documents.view'))
    .input(documentIdInput)
    .query(async ({ ctx, input }) => {
      const doc = await loadDocumentOrThrow(ctx.db, ctx.tenantId, input.documentId);

      const [uploaderRows, folderRows, versionRows, responsibleUserRows] = await Promise.all([
        ctx.db
          .select({ name: user.name, email: user.email })
          .from(user)
          .where(eq(user.id, doc.uploadedByUserId))
          .limit(1),
        doc.folderId !== null
          ? ctx.db
              .select({ name: documentFolders.name })
              .from(documentFolders)
              .where(eq(documentFolders.id, doc.folderId))
              .limit(1)
          : Promise.resolve([]),
        ctx.db
          .select({
            id: documentVersions.id,
            version: documentVersions.version,
            filename: documentVersions.filename,
            mimeType: documentVersions.mimeType,
            sizeBytes: documentVersions.sizeBytes,
            storageKey: documentVersions.storageKey,
            uploadedByUserId: documentVersions.uploadedByUserId,
            uploaderName: user.name,
            uploadedAt: documentVersions.uploadedAt,
          })
          .from(documentVersions)
          .leftJoin(user, eq(user.id, documentVersions.uploadedByUserId))
          .where(eq(documentVersions.documentId, doc.id))
          .orderBy(desc(documentVersions.version)),
        doc.responsibleUserId !== null
          ? ctx.db
              .select({ name: user.name, email: user.email })
              .from(user)
              .where(and(eq(user.tenantId, ctx.tenantId), eq(user.id, doc.responsibleUserId)))
              .limit(1)
          : Promise.resolve([]),
      ]);

      let isStale = false;
      if (doc.freshnessDays !== null) {
        const msPerDay = 86_400_000;
        const daysSinceUpdate = (Date.now() - new Date(doc.updatedAt).getTime()) / msPerDay;
        isStale = daysSinceUpdate > doc.freshnessDays;
      }

      const isExpired = doc.expiresAt !== null && new Date(doc.expiresAt) < new Date();
      const daysUntilExpiry =
        doc.expiresAt !== null
          ? Math.ceil((new Date(doc.expiresAt).getTime() - Date.now()) / 86_400_000)
          : null;

      return {
        document: doc,
        uploader: uploaderRows[0] ?? null,
        responsibleUser: responsibleUserRows[0] ?? null,
        folderName: folderRows[0]?.name ?? null,
        versions: versionRows,
        isStale,
        isExpired,
        daysUntilExpiry,
      };
    }),

  create: tenantProcedure
    .use(requirePermission('documents.manage'))
    .input(createInput)
    .mutation(async ({ ctx, input }) => {
      if (input.sizeBytes > MAX_FILE_SIZE_BYTES) {
        throw new TRPCError({ code: 'PAYLOAD_TOO_LARGE', message: 'file-too-large' });
      }
      // Storage key + referenced site/owner must belong to this tenant.
      assertStorageKeyInTenant(ctx.tenantId, input.storageKey);
      await assertSitesInTenant(ctx.db, ctx.tenantId, [input.siteId]);
      await assertUsersInTenant(ctx.db, ctx.tenantId, [input.responsibleUserId]);
      await assertGroupsInTenant(ctx.db, ctx.tenantId, [input.responsibleGroupId]);

      const id = newId();
      const versionId = newId();
      const now = new Date();

      await ctx.db.transaction(async (tx) => {
        await tx.insert(documents).values({
          id,
          tenantId: ctx.tenantId,
          folderId: input.folderId ?? null,
          name: input.name,
          description: input.description,
          storageKey: input.storageKey,
          filename: input.filename,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          siteId: input.siteId ?? null,
          labels: input.labels,
          labelIds: input.labelIds,
          freshnessDays: input.freshnessDays ?? null,
          startDate: input.startDate != null ? new Date(input.startDate) : null,
          expiresAt: input.expiresAt != null ? new Date(input.expiresAt) : null,
          responsibleUserId: input.responsibleUserId ?? null,
          responsibleGroupId: input.responsibleGroupId ?? null,
          reminderDays: input.reminderDays,
          currentVersion: 1,
          uploadedByUserId: ctx.auth.userId,
          createdAt: now,
          updatedAt: now,
        });

        await tx.insert(documentVersions).values({
          id: versionId,
          documentId: id,
          tenantId: ctx.tenantId,
          version: 1,
          storageKey: input.storageKey,
          filename: input.filename,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          uploadedByUserId: ctx.auth.userId,
          uploadedAt: now,
        });
      });

      return { documentId: id };
    }),

  update: tenantProcedure
    .use(requirePermission('documents.manage'))
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      const doc = await loadDocumentOrThrow(ctx.db, ctx.tenantId, input.documentId);
      if (doc.archivedAt !== null) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'document-archived' });
      }
      // Referenced site / owner must belong to this tenant.
      if (input.siteId !== undefined)
        await assertSitesInTenant(ctx.db, ctx.tenantId, [input.siteId]);
      if (input.responsibleUserId !== undefined)
        await assertUsersInTenant(ctx.db, ctx.tenantId, [input.responsibleUserId]);
      if (input.responsibleGroupId !== undefined)
        await assertGroupsInTenant(ctx.db, ctx.tenantId, [input.responsibleGroupId]);

      const updates: Partial<typeof documents.$inferInsert> = { updatedAt: new Date() };
      if (input.name !== undefined) updates.name = input.name;
      if (input.description !== undefined) updates.description = input.description;
      if (input.folderId !== undefined) updates.folderId = input.folderId;
      if (input.siteId !== undefined) updates.siteId = input.siteId;
      if (input.labels !== undefined) updates.labels = input.labels;
      if (input.labelIds !== undefined) updates.labelIds = input.labelIds;
      if (input.freshnessDays !== undefined) updates.freshnessDays = input.freshnessDays;
      if (input.startDate !== undefined)
        updates.startDate = input.startDate != null ? new Date(input.startDate) : null;
      if (input.expiresAt !== undefined)
        updates.expiresAt = input.expiresAt != null ? new Date(input.expiresAt) : null;
      if (input.responsibleUserId !== undefined)
        updates.responsibleUserId = input.responsibleUserId;
      if (input.responsibleGroupId !== undefined)
        updates.responsibleGroupId = input.responsibleGroupId;
      if (input.reminderDays !== undefined) updates.reminderDays = input.reminderDays;
      if (input.visibleToGroupIds !== undefined)
        updates.visibleToGroupIds = input.visibleToGroupIds;
      if (input.visibleToSiteIds !== undefined) updates.visibleToSiteIds = input.visibleToSiteIds;

      await ctx.db.update(documents).set(updates).where(eq(documents.id, doc.id));
      return { ok: true as const };
    }),

  /** Upload a new version. Bumps documents.current_version. */
  uploadVersion: tenantProcedure
    .use(requirePermission('documents.manage'))
    .input(uploadNewVersionInput)
    .mutation(async ({ ctx, input }) => {
      if (input.sizeBytes > MAX_FILE_SIZE_BYTES) {
        throw new TRPCError({ code: 'PAYLOAD_TOO_LARGE', message: 'file-too-large' });
      }
      const doc = await loadDocumentOrThrow(ctx.db, ctx.tenantId, input.documentId);
      if (doc.archivedAt !== null) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'document-archived' });
      }
      assertStorageKeyInTenant(ctx.tenantId, input.storageKey);

      const nextVersion = doc.currentVersion + 1;
      const versionId = newId();
      const now = new Date();

      await ctx.db.transaction(async (tx) => {
        await tx.insert(documentVersions).values({
          id: versionId,
          documentId: doc.id,
          tenantId: ctx.tenantId,
          version: nextVersion,
          storageKey: input.storageKey,
          filename: input.filename,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          uploadedByUserId: ctx.auth.userId,
          uploadedAt: now,
        });

        await tx
          .update(documents)
          .set({
            currentVersion: nextVersion,
            storageKey: input.storageKey,
            filename: input.filename,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            updatedAt: now,
          })
          .where(eq(documents.id, doc.id));
      });

      return { versionId, version: nextVersion };
    }),

  /**
   * Promote an existing historical version to be the current one. Re-points
   * the document's file fields + currentVersion at the chosen version row (no
   * new version is created — version rows stay immutable).
   */
  setCurrentVersion: tenantProcedure
    .use(requirePermission('documents.manage'))
    .input(z.object({ documentId: z.string().length(26), version: z.number().int().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const doc = await loadDocumentOrThrow(ctx.db, ctx.tenantId, input.documentId);
      if (doc.archivedAt !== null) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'document-archived' });
      }
      if (input.version === doc.currentVersion) return { ok: true as const };
      const vRows = await ctx.db
        .select({
          storageKey: documentVersions.storageKey,
          filename: documentVersions.filename,
          mimeType: documentVersions.mimeType,
          sizeBytes: documentVersions.sizeBytes,
        })
        .from(documentVersions)
        .where(
          and(
            eq(documentVersions.tenantId, ctx.tenantId),
            eq(documentVersions.documentId, doc.id),
            eq(documentVersions.version, input.version),
          ),
        )
        .limit(1);
      const v = vRows[0];
      if (v === undefined) throw new TRPCError({ code: 'NOT_FOUND', message: 'version-not-found' });
      await ctx.db
        .update(documents)
        .set({
          currentVersion: input.version,
          storageKey: v.storageKey,
          filename: v.filename,
          mimeType: v.mimeType,
          sizeBytes: v.sizeBytes,
          updatedAt: new Date(),
        })
        .where(eq(documents.id, doc.id));
      return { ok: true as const };
    }),

  /**
   * Sign-off requests for a document (#4). Every Heads-Up that attached this
   * document, with the version it was sent at and each recipient's sign
   * status — surfacing the signatures collected via Heads-Up on the document
   * page, grouped per version by the caller.
   */
  signatureRequests: tenantProcedure
    .use(requirePermission('documents.view'))
    .input(z.object({ documentId: z.string().length(26) }))
    .query(async ({ ctx, input }) => {
      const links = await ctx.db
        .select({
          headsUpId: headsUpDocuments.headsUpId,
          documentVersion: headsUpDocuments.documentVersion,
          title: headsUps.title,
          engagementLevel: headsUps.engagementLevel,
          requireSignature: headsUps.requireSignature,
          status: headsUps.status,
          createdAt: headsUps.createdAt,
          senderName: user.name,
        })
        .from(headsUpDocuments)
        .innerJoin(headsUps, eq(headsUpDocuments.headsUpId, headsUps.id))
        .leftJoin(user, eq(headsUps.createdByUserId, user.id))
        .where(
          and(
            eq(headsUpDocuments.tenantId, ctx.tenantId),
            eq(headsUpDocuments.documentId, input.documentId),
          ),
        )
        .orderBy(desc(headsUps.createdAt));

      if (links.length === 0) return [];

      const headsUpIds = links.map((l) => l.headsUpId);
      const recipients = await ctx.db
        .select({
          headsUpId: headsUpRecipients.headsUpId,
          userId: headsUpRecipients.userId,
          name: user.name,
          email: user.email,
          signedAt: headsUpRecipients.signedAt,
          acknowledgedAt: headsUpRecipients.acknowledgedAt,
          viewedAt: headsUpRecipients.viewedAt,
        })
        .from(headsUpRecipients)
        .leftJoin(user, eq(headsUpRecipients.userId, user.id))
        .where(inArray(headsUpRecipients.headsUpId, headsUpIds))
        .orderBy(user.name);

      const byHeadsUp = new Map<string, typeof recipients>();
      for (const r of recipients) {
        const arr = byHeadsUp.get(r.headsUpId) ?? [];
        arr.push(r);
        byHeadsUp.set(r.headsUpId, arr);
      }

      return links.map((l) => ({
        ...l,
        recipients: byHeadsUp.get(l.headsUpId) ?? [],
      }));
    }),

  archive: tenantProcedure
    .use(requirePermission('documents.manage'))
    .input(documentIdInput)
    .mutation(async ({ ctx, input }) => {
      const doc = await loadDocumentOrThrow(ctx.db, ctx.tenantId, input.documentId);
      if (doc.archivedAt !== null) return { ok: true as const };
      await ctx.db
        .update(documents)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(documents.id, doc.id));
      return { ok: true as const };
    }),

  restore: tenantProcedure
    .use(requirePermission('documents.manage'))
    .input(documentIdInput)
    .mutation(async ({ ctx, input }) => {
      const doc = await loadDocumentOrThrow(ctx.db, ctx.tenantId, input.documentId);
      if (doc.archivedAt === null) return { ok: true as const };
      await ctx.db
        .update(documents)
        .set({ archivedAt: null, updatedAt: new Date() })
        .where(eq(documents.id, doc.id));
      return { ok: true as const };
    }),

  access: router({
    list: tenantProcedure
      .use(requirePermission('documents.manage'))
      .input(listAccessInput)
      .query(async ({ ctx, input }) => {
        if (input.documentId === undefined && input.folderId === undefined) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'document-or-folder-id-required',
          });
        }
        const where = [eq(documentAccess.tenantId, ctx.tenantId)];
        if (input.documentId !== undefined) {
          where.push(eq(documentAccess.documentId, input.documentId));
        }
        if (input.folderId !== undefined) {
          where.push(eq(documentAccess.folderId, input.folderId));
        }
        return ctx.db
          .select()
          .from(documentAccess)
          .where(and(...where));
      }),

    grant: tenantProcedure
      .use(requirePermission('documents.manage'))
      .input(grantAccessInput)
      .mutation(async ({ ctx, input }) => {
        if (input.documentId === undefined && input.folderId === undefined) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'document-or-folder-id-required',
          });
        }
        const id = newId();
        await ctx.db.insert(documentAccess).values({
          id,
          documentId: input.documentId ?? null,
          folderId: input.folderId ?? null,
          tenantId: ctx.tenantId,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          permission: input.permission,
          grantedByUserId: ctx.auth.userId,
          grantedAt: new Date(),
        });
        return { accessId: id };
      }),

    revoke: tenantProcedure
      .use(requirePermission('documents.manage'))
      .input(revokeAccessInput)
      .mutation(async ({ ctx, input }) => {
        await ctx.db
          .delete(documentAccess)
          .where(
            and(eq(documentAccess.tenantId, ctx.tenantId), eq(documentAccess.id, input.accessId)),
          );
        return { ok: true as const };
      }),
  }),

  versions: router({
    list: tenantProcedure
      .use(requirePermission('documents.view'))
      .input(documentIdInput)
      .query(async ({ ctx, input }) => {
        await loadDocumentOrThrow(ctx.db, ctx.tenantId, input.documentId);
        const rows = await ctx.db
          .select({
            id: documentVersions.id,
            version: documentVersions.version,
            filename: documentVersions.filename,
            mimeType: documentVersions.mimeType,
            sizeBytes: documentVersions.sizeBytes,
            storageKey: documentVersions.storageKey,
            uploadedByUserId: documentVersions.uploadedByUserId,
            uploaderName: user.name,
            uploadedAt: documentVersions.uploadedAt,
          })
          .from(documentVersions)
          .leftJoin(user, eq(user.id, documentVersions.uploadedByUserId))
          .where(eq(documentVersions.documentId, input.documentId))
          .orderBy(desc(documentVersions.version));
        return rows;
      }),
  }),
});
