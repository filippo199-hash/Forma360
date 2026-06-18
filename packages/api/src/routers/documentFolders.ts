/**
 * Document Folders router — Phase 5D.
 *
 * Self-referencing folder hierarchy with optional group / site visibility.
 * D-E06: can't delete a folder that still contains documents or sub-folders.
 */
import { documentFolders, documents } from '@forma360/db/schema';
import { user } from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { TRPCError } from '@trpc/server';
import { and, count, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission, tenantProcedure } from '../procedures';
import { router } from '../trpc';
import { loadViewerMemberships, makeFolderVisibilityChecker } from './document-visibility';

const folderIdInput = z.object({ folderId: z.string().length(26) });

const visibilityFields = {
  /** ULID array — when non-empty only members of these groups can see the folder. */
  visibleToGroupIds: z.array(z.string().length(26)).default([]),
  /** ULID array — when non-empty only users assigned to these sites can see the folder. */
  visibleToSiteIds: z.array(z.string().length(26)).default([]),
};

const createInput = z.object({
  name: z.string().min(1).max(500),
  parentId: z.string().length(26).optional(),
  ...visibilityFields,
});

const updateInput = z.object({
  folderId: z.string().length(26),
  name: z.string().min(1).max(500).optional(),
  parentId: z.string().length(26).nullable().optional(),
  visibleToGroupIds: z.array(z.string().length(26)).optional(),
  visibleToSiteIds: z.array(z.string().length(26)).optional(),
});

const listInput = z
  .object({
    parentId: z.string().length(26).nullable().optional(),
  })
  .default({});

export const documentFoldersRouter = router({
  list: tenantProcedure
    .use(requirePermission('documents.view'))
    .input(listInput)
    .query(async ({ ctx, input }) => {
      const where = [eq(documentFolders.tenantId, ctx.tenantId)];
      if (input.parentId !== undefined) {
        if (input.parentId === null) where.push(isNull(documentFolders.parentId));
        else where.push(eq(documentFolders.parentId, input.parentId));
      }

      const rows = await ctx.db
        .select({
          id: documentFolders.id,
          name: documentFolders.name,
          parentId: documentFolders.parentId,
          visibleToGroupIds: documentFolders.visibleToGroupIds,
          visibleToSiteIds: documentFolders.visibleToSiteIds,
          createdByUserId: documentFolders.createdByUserId,
          createdAt: documentFolders.createdAt,
          creatorName: user.name,
        })
        .from(documentFolders)
        .leftJoin(user, eq(user.id, documentFolders.createdByUserId))
        .where(and(...where))
        .orderBy(documentFolders.name);

      // Managers see every folder; everyone else only sees folders whose
      // own AND ancestor visibility passes (parent overrides child — #6).
      if (
        ctx.permissions.includes('documents.manage') ||
        ctx.permissions.includes('documents.folders.manage')
      ) {
        return rows;
      }

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
      return rows.filter((r) => folderVisible(r.id));
    }),

  create: tenantProcedure
    .use(requirePermission('documents.folders.manage'))
    .input(createInput)
    .mutation(async ({ ctx, input }) => {
      const id = newId();
      const now = new Date();
      await ctx.db.insert(documentFolders).values({
        id,
        tenantId: ctx.tenantId,
        name: input.name,
        parentId: input.parentId ?? null,
        visibleToGroupIds: input.visibleToGroupIds,
        visibleToSiteIds: input.visibleToSiteIds,
        createdByUserId: ctx.auth.userId,
        createdAt: now,
        updatedAt: now,
      });
      return { folderId: id };
    }),

  update: tenantProcedure
    .use(requirePermission('documents.folders.manage'))
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(documentFolders)
        .where(
          and(eq(documentFolders.tenantId, ctx.tenantId), eq(documentFolders.id, input.folderId)),
        )
        .limit(1);
      const folder = rows[0];
      if (folder === undefined) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'folder-not-found' });
      }

      const updates: Partial<typeof documentFolders.$inferInsert> = { updatedAt: new Date() };
      if (input.name !== undefined) updates.name = input.name;
      if (input.parentId !== undefined) updates.parentId = input.parentId;
      if (input.visibleToGroupIds !== undefined)
        updates.visibleToGroupIds = input.visibleToGroupIds;
      if (input.visibleToSiteIds !== undefined) updates.visibleToSiteIds = input.visibleToSiteIds;

      await ctx.db.update(documentFolders).set(updates).where(eq(documentFolders.id, folder.id));
      return { ok: true as const };
    }),

  /**
   * D-E06: refuse deletion when the folder still contains documents
   * (non-archived) or sub-folders.
   */
  delete: tenantProcedure
    .use(requirePermission('documents.folders.manage'))
    .input(folderIdInput)
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(documentFolders)
        .where(
          and(eq(documentFolders.tenantId, ctx.tenantId), eq(documentFolders.id, input.folderId)),
        )
        .limit(1);
      const folder = rows[0];
      if (folder === undefined) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'folder-not-found' });
      }

      const subFolderCount = await ctx.db
        .select({ c: count() })
        .from(documentFolders)
        .where(eq(documentFolders.parentId, folder.id));
      if (Number(subFolderCount[0]?.c ?? 0) > 0) {
        throw new TRPCError({ code: 'CONFLICT', message: 'folder-has-subfolders' });
      }

      const docCount = await ctx.db
        .select({ c: count() })
        .from(documents)
        .where(and(eq(documents.folderId, folder.id), isNull(documents.archivedAt)));
      if (Number(docCount[0]?.c ?? 0) > 0) {
        throw new TRPCError({ code: 'CONFLICT', message: 'folder-has-documents' });
      }

      await ctx.db.delete(documentFolders).where(eq(documentFolders.id, folder.id));
      return { ok: true as const };
    }),
});
