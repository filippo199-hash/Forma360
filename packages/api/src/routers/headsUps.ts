/**
 * Heads Up router — Phase 5A.
 *
 * Broadcast messages with engagement tracking. Features:
 *   - CRUD: create (draft), update, publish (immediately or scheduled),
 *     archive.
 *   - Recipients: resolved at publish time from individual users,
 *     groups, and sites. H-E01: assignee list locked at publish.
 *   - Engagement: markViewed / markAcknowledged / sign — H-E09:
 *     must acknowledge before signing.
 *   - Engagement dashboard: summary counts + recipient list.
 *   - Comments: create / list.
 *   - Edit after publish: H-E03: editing body content after publishing
 *     invalidates all existing signatures.
 */
import {
  headsUpAttachments,
  headsUpComments,
  headsUpRecipients,
  headsUps,
  type HeadsUp,
} from '@forma360/db/schema';
import { user } from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { TRPCError } from '@trpc/server';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission, tenantProcedure } from '../procedures';
import { router } from '../trpc';

const headsUpIdInput = z.object({ headsUpId: z.string().length(26) });

const LIST_LIMIT = 100;

async function loadHeadsUpOrThrow(
  db: Parameters<Parameters<typeof tenantProcedure.query>[0]>[0]['ctx']['db'],
  tenantId: string,
  headsUpId: string,
): Promise<HeadsUp> {
  const rows = await db
    .select()
    .from(headsUps)
    .where(and(eq(headsUps.tenantId, tenantId), eq(headsUps.id, headsUpId)))
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'heads-up-not-found' });
  }
  return row;
}

const createInput = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(50_000).default(''),
  engagementLevel: z.enum(['view', 'acknowledge', 'sign']).default('view'),
  requireAcknowledgement: z.boolean().default(false),
  requireSignature: z.boolean().default(false),
  publishAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
});

const updateInput = z.object({
  headsUpId: z.string().length(26),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(50_000).optional(),
  engagementLevel: z.enum(['view', 'acknowledge', 'sign']).optional(),
  requireAcknowledgement: z.boolean().optional(),
  requireSignature: z.boolean().optional(),
  publishAt: z.string().datetime().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

const publishInput = z.object({
  headsUpId: z.string().length(26),
  /**
   * User IDs, group IDs, or site IDs to add as recipients. The router
   * resolves group/site members and inserts individual recipient rows.
   * H-E01: once published, assignees are locked (the list is frozen).
   */
  userIds: z.array(z.string().length(26)).default([]),
  groupIds: z.array(z.string().length(26)).default([]),
  siteIds: z.array(z.string().length(26)).default([]),
});

const listInput = z
  .object({
    status: z.enum(['draft', 'published', 'archived']).optional(),
    limit: z.number().int().min(1).max(LIST_LIMIT).default(LIST_LIMIT),
  })
  .default({ limit: LIST_LIMIT });

const listRecipientsInput = z.object({
  headsUpId: z.string().length(26),
  filter: z.enum(['all', 'viewed', 'acknowledged', 'signed', 'not_viewed']).default('all'),
  limit: z.number().int().min(1).max(500).default(200),
});

const markViewedInput = z.object({ headsUpId: z.string().length(26) });
const markAcknowledgedInput = z.object({ headsUpId: z.string().length(26) });
const signInput = z.object({
  headsUpId: z.string().length(26),
  signatureData: z.string().min(1).max(500_000),
});

const createCommentInput = z.object({
  headsUpId: z.string().length(26),
  body: z.string().min(1).max(20_000),
});

const listCommentsInput = z.object({ headsUpId: z.string().length(26) });

export const headsUpsRouter = router({
  list: tenantProcedure
    .use(requirePermission('headsUp.view'))
    .input(listInput)
    .query(async ({ ctx, input }) => {
      const where = [eq(headsUps.tenantId, ctx.tenantId)];
      if (input.status !== undefined) where.push(eq(headsUps.status, input.status));

      const rows = await ctx.db
        .select({
          id: headsUps.id,
          title: headsUps.title,
          status: headsUps.status,
          engagementLevel: headsUps.engagementLevel,
          requireAcknowledgement: headsUps.requireAcknowledgement,
          requireSignature: headsUps.requireSignature,
          publishAt: headsUps.publishAt,
          expiresAt: headsUps.expiresAt,
          createdByUserId: headsUps.createdByUserId,
          createdAt: headsUps.createdAt,
          updatedAt: headsUps.updatedAt,
          creatorName: user.name,
        })
        .from(headsUps)
        .leftJoin(user, eq(user.id, headsUps.createdByUserId))
        .where(and(...where))
        .orderBy(desc(headsUps.createdAt))
        .limit(input.limit);
      return rows;
    }),

  get: tenantProcedure
    .use(requirePermission('headsUp.view'))
    .input(headsUpIdInput)
    .query(async ({ ctx, input }) => {
      const headsUp = await loadHeadsUpOrThrow(ctx.db, ctx.tenantId, input.headsUpId);

      const [recipientCountRows, creatorRows, attachmentRows] = await Promise.all([
        ctx.db
          .select({ total: count() })
          .from(headsUpRecipients)
          .where(eq(headsUpRecipients.headsUpId, headsUp.id)),
        ctx.db
          .select({ name: user.name })
          .from(user)
          .where(eq(user.id, headsUp.createdByUserId))
          .limit(1),
        ctx.db
          .select()
          .from(headsUpAttachments)
          .where(eq(headsUpAttachments.headsUpId, headsUp.id)),
      ]);

      return {
        headsUp,
        creatorName: creatorRows[0]?.name ?? null,
        recipientCount: Number(recipientCountRows[0]?.total ?? 0),
        attachments: attachmentRows,
      };
    }),

  create: tenantProcedure
    .use(requirePermission('headsUp.publish'))
    .input(createInput)
    .mutation(async ({ ctx, input }) => {
      const id = newId();
      const now = new Date();
      await ctx.db.insert(headsUps).values({
        id,
        tenantId: ctx.tenantId,
        title: input.title,
        description: input.description,
        status: 'draft',
        engagementLevel: input.engagementLevel,
        requireAcknowledgement: input.requireAcknowledgement,
        requireSignature: input.requireSignature,
        publishAt: input.publishAt !== undefined ? new Date(input.publishAt) : null,
        expiresAt: input.expiresAt !== undefined ? new Date(input.expiresAt) : null,
        createdByUserId: ctx.auth.userId,
        createdAt: now,
        updatedAt: now,
      });
      return { headsUpId: id };
    }),

  update: tenantProcedure
    .use(requirePermission('headsUp.manage'))
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      const headsUp = await loadHeadsUpOrThrow(ctx.db, ctx.tenantId, input.headsUpId);
      if (headsUp.status === 'archived') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'heads-up-archived' });
      }

      const now = new Date();
      const updates: Partial<typeof headsUps.$inferInsert> = { updatedAt: now };

      if (input.title !== undefined && input.title !== headsUp.title) {
        updates.title = input.title;
      }
      if (input.description !== undefined && input.description !== headsUp.description) {
        updates.description = input.description;
        // H-E03: editing body content after publish invalidates all signatures.
        if (headsUp.status === 'published') {
          await ctx.db
            .update(headsUpRecipients)
            .set({ signedAt: null, signatureData: null })
            .where(eq(headsUpRecipients.headsUpId, headsUp.id));
        }
      }
      if (input.engagementLevel !== undefined) updates.engagementLevel = input.engagementLevel;
      if (input.requireAcknowledgement !== undefined)
        updates.requireAcknowledgement = input.requireAcknowledgement;
      if (input.requireSignature !== undefined) updates.requireSignature = input.requireSignature;
      if (input.publishAt !== undefined)
        updates.publishAt = input.publishAt === null ? null : new Date(input.publishAt);
      if (input.expiresAt !== undefined)
        updates.expiresAt = input.expiresAt === null ? null : new Date(input.expiresAt);

      await ctx.db.update(headsUps).set(updates).where(eq(headsUps.id, headsUp.id));
      return { ok: true as const };
    }),

  /**
   * Publish: resolves all recipients from users/groups/sites and inserts
   * recipient rows. H-E01: assignees are locked at this point.
   */
  publish: tenantProcedure
    .use(requirePermission('headsUp.publish'))
    .input(publishInput)
    .mutation(async ({ ctx, input }) => {
      const headsUp = await loadHeadsUpOrThrow(ctx.db, ctx.tenantId, input.headsUpId);
      if (headsUp.status === 'archived') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'heads-up-archived' });
      }

      // Collect all user IDs to add as recipients.
      const recipientUserIds = new Set<string>(input.userIds);

      // Expand groups (group_members is materialised by Phase 1).
      if (input.groupIds.length > 0) {
        const { groupMembers } = await import('@forma360/db/schema');
        const { inArray } = await import('drizzle-orm');
        const memberRows = await ctx.db
          .select({ userId: groupMembers.userId })
          .from(groupMembers)
          .where(
            and(
              eq(groupMembers.tenantId, ctx.tenantId),
              inArray(groupMembers.groupId, input.groupIds),
            ),
          );
        for (const r of memberRows) recipientUserIds.add(r.userId);
      }

      // Expand sites: look up users via the site_members materialised table.
      if (input.siteIds.length > 0) {
        const { siteMembers } = await import('@forma360/db/schema');
        const { inArray } = await import('drizzle-orm');
        const siteUserRows = await ctx.db
          .select({ userId: siteMembers.userId })
          .from(siteMembers)
          .where(
            and(
              eq(siteMembers.tenantId, ctx.tenantId),
              inArray(siteMembers.siteId, input.siteIds),
            ),
          );
        for (const r of siteUserRows) recipientUserIds.add(r.userId);
      }

      const now = new Date();

      // Upsert: ignore duplicates (idempotent re-publish edge case).
      const values = [...recipientUserIds].map((userId) => ({
        id: newId(),
        tenantId: ctx.tenantId,
        headsUpId: headsUp.id,
        userId,
        createdAt: now,
      }));

      if (values.length > 0) {
        await ctx.db.insert(headsUpRecipients).values(values).onConflictDoNothing();
      }

      await ctx.db
        .update(headsUps)
        .set({ status: 'published', updatedAt: now })
        .where(eq(headsUps.id, headsUp.id));

      return { ok: true as const, recipientCount: values.length };
    }),

  archive: tenantProcedure
    .use(requirePermission('headsUp.manage'))
    .input(headsUpIdInput)
    .mutation(async ({ ctx, input }) => {
      const headsUp = await loadHeadsUpOrThrow(ctx.db, ctx.tenantId, input.headsUpId);
      if (headsUp.status === 'archived') return { ok: true as const };
      await ctx.db
        .update(headsUps)
        .set({ status: 'archived', updatedAt: new Date() })
        .where(eq(headsUps.id, headsUp.id));
      return { ok: true as const };
    }),

  /** Engagement dashboard — summary counts. */
  engagementSummary: tenantProcedure
    .use(requirePermission('headsUp.analytics.view'))
    .input(headsUpIdInput)
    .query(async ({ ctx, input }) => {
      await loadHeadsUpOrThrow(ctx.db, ctx.tenantId, input.headsUpId);

      const rows = await ctx.db
        .select({
          total: count(),
          // Aggregate via SQL count with filter condition
        })
        .from(headsUpRecipients)
        .where(eq(headsUpRecipients.headsUpId, input.headsUpId));

      const totalCount = Number(rows[0]?.total ?? 0);

      // Individual counts for each engagement state.
      const [viewedRows, acknowledgedRows, signedRows] = await Promise.all([
        ctx.db
          .select({ c: count() })
          .from(headsUpRecipients)
          .where(
            and(
              eq(headsUpRecipients.headsUpId, input.headsUpId),
              isNull(headsUpRecipients.viewedAt),
            ),
          ),
        ctx.db
          .select({ c: count() })
          .from(headsUpRecipients)
          .where(
            and(
              eq(headsUpRecipients.headsUpId, input.headsUpId),
              isNull(headsUpRecipients.acknowledgedAt),
            ),
          ),
        ctx.db
          .select({ c: count() })
          .from(headsUpRecipients)
          .where(
            and(
              eq(headsUpRecipients.headsUpId, input.headsUpId),
              isNull(headsUpRecipients.signedAt),
            ),
          ),
      ]);

      const notViewedCount = Number(viewedRows[0]?.c ?? 0);
      const notAcknowledgedCount = Number(acknowledgedRows[0]?.c ?? 0);
      const notSignedCount = Number(signedRows[0]?.c ?? 0);

      return {
        total: totalCount,
        viewed: totalCount - notViewedCount,
        notViewed: notViewedCount,
        acknowledged: totalCount - notAcknowledgedCount,
        notAcknowledged: notAcknowledgedCount,
        signed: totalCount - notSignedCount,
        notSigned: notSignedCount,
      };
    }),

  /** Recipient list with engagement state + optional filter. H-E07: paginated. */
  listRecipients: tenantProcedure
    .use(requirePermission('headsUp.analytics.view'))
    .input(listRecipientsInput)
    .query(async ({ ctx, input }) => {
      await loadHeadsUpOrThrow(ctx.db, ctx.tenantId, input.headsUpId);

      const { isNotNull } = await import('drizzle-orm');
      const where = [eq(headsUpRecipients.headsUpId, input.headsUpId)];
      if (input.filter === 'viewed') where.push(isNotNull(headsUpRecipients.viewedAt));
      if (input.filter === 'not_viewed') where.push(isNull(headsUpRecipients.viewedAt));
      if (input.filter === 'acknowledged') where.push(isNotNull(headsUpRecipients.acknowledgedAt));
      if (input.filter === 'signed') where.push(isNotNull(headsUpRecipients.signedAt));

      const rows = await ctx.db
        .select({
          id: headsUpRecipients.id,
          userId: headsUpRecipients.userId,
          userName: user.name,
          userEmail: user.email,
          viewedAt: headsUpRecipients.viewedAt,
          acknowledgedAt: headsUpRecipients.acknowledgedAt,
          signedAt: headsUpRecipients.signedAt,
        })
        .from(headsUpRecipients)
        .leftJoin(user, eq(user.id, headsUpRecipients.userId))
        .where(and(...where))
        .orderBy(desc(headsUpRecipients.createdAt))
        .limit(input.limit);

      return rows;
    }),

  /** Track that the current user has viewed a Heads Up. */
  markViewed: tenantProcedure
    .use(requirePermission('headsUp.view'))
    .input(markViewedInput)
    .mutation(async ({ ctx, input }) => {
      const recipientRows = await ctx.db
        .select()
        .from(headsUpRecipients)
        .where(
          and(
            eq(headsUpRecipients.headsUpId, input.headsUpId),
            eq(headsUpRecipients.userId, ctx.auth.userId),
          ),
        )
        .limit(1);
      const recipient = recipientRows[0];
      if (recipient === undefined) return { ok: true as const }; // not a recipient
      if (recipient.viewedAt !== null) return { ok: true as const }; // already viewed

      await ctx.db
        .update(headsUpRecipients)
        .set({ viewedAt: new Date() })
        .where(eq(headsUpRecipients.id, recipient.id));
      return { ok: true as const };
    }),

  /** Acknowledge a Heads Up. Must have viewed first (implicit — no hard guard). */
  markAcknowledged: tenantProcedure
    .use(requirePermission('headsUp.view'))
    .input(markAcknowledgedInput)
    .mutation(async ({ ctx, input }) => {
      const recipientRows = await ctx.db
        .select()
        .from(headsUpRecipients)
        .where(
          and(
            eq(headsUpRecipients.headsUpId, input.headsUpId),
            eq(headsUpRecipients.userId, ctx.auth.userId),
          ),
        )
        .limit(1);
      const recipient = recipientRows[0];
      if (recipient === undefined) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'not-a-recipient' });
      }
      if (recipient.acknowledgedAt !== null) return { ok: true as const };

      await ctx.db
        .update(headsUpRecipients)
        .set({ viewedAt: recipient.viewedAt ?? new Date(), acknowledgedAt: new Date() })
        .where(eq(headsUpRecipients.id, recipient.id));
      return { ok: true as const };
    }),

  /**
   * Sign a Heads Up. H-E09: must have acknowledged first when
   * requireAcknowledgement is true.
   */
  sign: tenantProcedure
    .use(requirePermission('headsUp.view'))
    .input(signInput)
    .mutation(async ({ ctx, input }) => {
      const headsUp = await loadHeadsUpOrThrow(ctx.db, ctx.tenantId, input.headsUpId);
      if (!headsUp.requireSignature) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'signature-not-required' });
      }

      const recipientRows = await ctx.db
        .select()
        .from(headsUpRecipients)
        .where(
          and(
            eq(headsUpRecipients.headsUpId, input.headsUpId),
            eq(headsUpRecipients.userId, ctx.auth.userId),
          ),
        )
        .limit(1);
      const recipient = recipientRows[0];
      if (recipient === undefined) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'not-a-recipient' });
      }

      // H-E09: must acknowledge before signing when acknowledgement is required.
      if (headsUp.requireAcknowledgement && recipient.acknowledgedAt === null) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'must-acknowledge-before-sign' });
      }

      if (recipient.signedAt !== null) return { ok: true as const };

      const now = new Date();
      await ctx.db
        .update(headsUpRecipients)
        .set({
          viewedAt: recipient.viewedAt ?? now,
          acknowledgedAt: recipient.acknowledgedAt ?? (headsUp.requireAcknowledgement ? now : null),
          signedAt: now,
          signatureData: input.signatureData,
        })
        .where(eq(headsUpRecipients.id, recipient.id));
      return { ok: true as const };
    }),

  comments: router({
    list: tenantProcedure
      .use(requirePermission('headsUp.view'))
      .input(listCommentsInput)
      .query(async ({ ctx, input }) => {
        await loadHeadsUpOrThrow(ctx.db, ctx.tenantId, input.headsUpId);
        const rows = await ctx.db
          .select({
            id: headsUpComments.id,
            body: headsUpComments.body,
            authorUserId: headsUpComments.authorUserId,
            authorName: user.name,
            createdAt: headsUpComments.createdAt,
          })
          .from(headsUpComments)
          .leftJoin(user, eq(user.id, headsUpComments.authorUserId))
          .where(eq(headsUpComments.headsUpId, input.headsUpId))
          .orderBy(headsUpComments.createdAt);
        return rows;
      }),

    create: tenantProcedure
      .use(requirePermission('headsUp.view'))
      .input(createCommentInput)
      .mutation(async ({ ctx, input }) => {
        await loadHeadsUpOrThrow(ctx.db, ctx.tenantId, input.headsUpId);
        const id = newId();
        await ctx.db.insert(headsUpComments).values({
          id,
          tenantId: ctx.tenantId,
          headsUpId: input.headsUpId,
          authorUserId: ctx.auth.userId,
          body: input.body,
        });
        return { commentId: id };
      }),
  }),
});
