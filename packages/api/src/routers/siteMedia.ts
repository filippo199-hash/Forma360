/**
 * Site/Project media gallery router.
 *
 *   - list          (sites.view)   — non-archived media for one site,
 *                                     newest first, with uploader name.
 *   - create        (sites.view)   — register an already-uploaded R2 object
 *                                     (the /api/upload/site-media route puts
 *                                     the bytes; this records the row).
 *   - updateCaption (sites.view)   — edit the caption.
 *   - archive       (sites.manage) — soft-delete (curation is a manage act).
 *
 * The storage key + site are both validated against the tenant so a client
 * can't attach a foreign object or point at another tenant's site.
 */
import { siteMedia, user } from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission, tenantProcedure } from '../procedures';
import { assertSitesInTenant, assertStorageKeyInTenant } from '../tenant-guards';
import { router } from '../trpc';

function kindForMime(mimeType: string): 'photo' | 'video' {
  return mimeType.startsWith('video/') ? 'video' : 'photo';
}

const createInput = z.object({
  siteId: z.string().length(26),
  storageKey: z.string().min(1).max(1024),
  filename: z.string().min(1).max(400),
  mimeType: z.string().min(1).max(200),
  sizeBytes: z.number().int().nonnegative(),
  caption: z.string().max(2000).optional(),
});

export const siteMediaRouter = router({
  list: tenantProcedure
    .use(requirePermission('sites.view'))
    .input(z.object({ siteId: z.string().length(26) }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: siteMedia.id,
          siteId: siteMedia.siteId,
          storageKey: siteMedia.storageKey,
          filename: siteMedia.filename,
          mimeType: siteMedia.mimeType,
          sizeBytes: siteMedia.sizeBytes,
          kind: siteMedia.kind,
          caption: siteMedia.caption,
          tags: siteMedia.tags,
          capturedAt: siteMedia.capturedAt,
          createdAt: siteMedia.createdAt,
          uploadedBy: siteMedia.uploadedBy,
          uploaderName: user.name,
        })
        .from(siteMedia)
        .leftJoin(user, eq(user.id, siteMedia.uploadedBy))
        .where(
          and(
            eq(siteMedia.tenantId, ctx.tenantId),
            eq(siteMedia.siteId, input.siteId),
            isNull(siteMedia.archivedAt),
          ),
        )
        .orderBy(desc(siteMedia.createdAt));
      return rows;
    }),

  create: tenantProcedure
    .use(requirePermission('sites.view'))
    .input(createInput)
    .mutation(async ({ ctx, input }) => {
      await assertSitesInTenant(ctx.db, ctx.tenantId, [input.siteId]);
      assertStorageKeyInTenant(ctx.tenantId, input.storageKey);

      const now = new Date();
      const id = newId();
      await ctx.db.insert(siteMedia).values({
        id,
        tenantId: ctx.tenantId,
        siteId: input.siteId,
        storageKey: input.storageKey,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        kind: kindForMime(input.mimeType),
        caption: input.caption ?? '',
        capturedAt: now,
        uploadedBy: ctx.auth.userId,
      });
      ctx.logger.info({ tenantId: ctx.tenantId, siteId: input.siteId, id }, '[siteMedia] created');
      return { id };
    }),

  updateCaption: tenantProcedure
    .use(requirePermission('sites.view'))
    .input(z.object({ id: z.string().length(26), caption: z.string().max(2000) }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db
        .update(siteMedia)
        .set({ caption: input.caption })
        .where(and(eq(siteMedia.tenantId, ctx.tenantId), eq(siteMedia.id, input.id)))
        .returning({ id: siteMedia.id });
      if (result[0] === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      return { id: input.id };
    }),

  archive: tenantProcedure
    .use(requirePermission('sites.manage'))
    .input(z.object({ id: z.string().length(26) }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db
        .update(siteMedia)
        .set({ archivedAt: new Date() })
        .where(
          and(
            eq(siteMedia.tenantId, ctx.tenantId),
            eq(siteMedia.id, input.id),
            isNull(siteMedia.archivedAt),
          ),
        )
        .returning({ id: siteMedia.id });
      if (result[0] === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      return { id: input.id };
    }),
});
