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
import {
  assertDocumentFoldersInTenant,
  assertGroupsInTenant,
  assertSitesInTenant,
} from '../tenant-guards';
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
      // A parent folder must belong to this tenant (else the tree could
      // reference another tenant's folder).
      await assertDocumentFoldersInTenant(ctx.db, ctx.tenantId, [input.parentId]);
      // DC-T05: a folder's visibility CASCADES to every document inside it and
      // to every sub-folder, so an unchecked id here is strictly worse than
      // the same hole on a single document — it silently buries a whole
      // branch of the library behind a rule that matches nobody.
      await assertGroupsInTenant(ctx.db, ctx.tenantId, input.visibleToGroupIds);
      await assertSitesInTenant(ctx.db, ctx.tenantId, input.visibleToSiteIds);
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

      // Reparenting guards: the new parent must belong to this tenant and must
      // not be the folder itself or one of its descendants — otherwise the move
      // forms an unreachable, unremovable cycle.
      if (input.parentId !== undefined && input.parentId !== null) {
        await assertDocumentFoldersInTenant(ctx.db, ctx.tenantId, [input.parentId]);
        if (input.parentId === folder.id) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'folder-parent-self' });
        }
        // Walk up the ancestry from the proposed parent; reaching this folder
        // means the parent is a descendant → cycle. `seen` guards a pre-existing
        // cycle from looping forever.
        let cursor: string | null = input.parentId;
        const seen = new Set<string>();
        while (cursor !== null && !seen.has(cursor)) {
          if (cursor === folder.id) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'folder-parent-cycle' });
          }
          seen.add(cursor);
          const parentRows = await ctx.db
            .select({ parentId: documentFolders.parentId })
            .from(documentFolders)
            .where(and(eq(documentFolders.tenantId, ctx.tenantId), eq(documentFolders.id, cursor)))
            .limit(1);
          cursor = parentRows[0]?.parentId ?? null;
        }
      }

      // DC-T05: same rule as create — the cascade makes this the highest-blast
      // -radius visibility write in the module.
      if (input.visibleToGroupIds !== undefined)
        await assertGroupsInTenant(ctx.db, ctx.tenantId, input.visibleToGroupIds);
      if (input.visibleToSiteIds !== undefined)
        await assertSitesInTenant(ctx.db, ctx.tenantId, input.visibleToSiteIds);

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

      // Count ALL documents (archived included): `documents.folder_id` has no
      // cascade/set-null, so a folder holding even archived docs can't be
      // deleted — block with a clean CONFLICT instead of a raw FK 500.
      const docCount = await ctx.db
        .select({ c: count() })
        .from(documents)
        .where(eq(documents.folderId, folder.id));
      if (Number(docCount[0]?.c ?? 0) > 0) {
        throw new TRPCError({ code: 'CONFLICT', message: 'folder-has-documents' });
      }

      await ctx.db.delete(documentFolders).where(eq(documentFolders.id, folder.id));
      return { ok: true as const };
    }),
});
