/**
 * Document Folders router — Phase 5C.
 *
 * Self-referencing folder hierarchy.
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

const folderIdInput = z.object({ folderId: z.string().length(26) });

const createInput = z.object({
  name: z.string().min(1).max(500),
  parentId: z.string().length(26).optional(),
});

const updateInput = z.object({
  folderId: z.string().length(26),
  name: z.string().min(1).max(500).optional(),
  parentId: z.string().length(26).nullable().optional(),
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
          createdByUserId: documentFolders.createdByUserId,
          createdAt: documentFolders.createdAt,
          creatorName: user.name,
        })
        .from(documentFolders)
        .leftJoin(user, eq(user.id, documentFolders.createdByUserId))
        .where(and(...where))
        .orderBy(documentFolders.name);

      return rows;
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
          and(
            eq(documentFolders.tenantId, ctx.tenantId),
            eq(documentFolders.id, input.folderId),
          ),
        )
        .limit(1);
      const folder = rows[0];
      if (folder === undefined) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'folder-not-found' });
      }

      const updates: Partial<typeof documentFolders.$inferInsert> = { updatedAt: new Date() };
      if (input.name !== undefined) updates.name = input.name;
      if (input.parentId !== undefined) updates.parentId = input.parentId;

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
          and(
            eq(documentFolders.tenantId, ctx.tenantId),
            eq(documentFolders.id, input.folderId),
          ),
        )
        .limit(1);
      const folder = rows[0];
      if (folder === undefined) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'folder-not-found' });
      }

      // Check for sub-folders.
      const subFolderCount = await ctx.db
        .select({ c: count() })
        .from(documentFolders)
        .where(eq(documentFolders.parentId, folder.id));
      if (Number(subFolderCount[0]?.c ?? 0) > 0) {
        throw new TRPCError({ code: 'CONFLICT', message: 'folder-has-subfolders' });
      }

      // Check for documents in this folder (non-archived).
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
