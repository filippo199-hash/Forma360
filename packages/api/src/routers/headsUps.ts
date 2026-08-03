/**
 * Heads Up router — Phase 5A + redesign (PR after Phase 8).
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
 *   - Attachments: add / remove (media files stored in R2).
 *   - Share link: createShareLink / disableShareLink (external public URL).
 *   - Reactions: add / remove / list emoji reactions.
 *   - Edit after publish: H-E03: editing body content after publishing
 *     invalidates all existing signatures.
 *   - sendReminder: send reminder emails to pending recipients.
 */
import {
  documents,
  groups,
  headsUpAttachments,
  headsUpComments,
  headsUpDocuments,
  headsUpReactions,
  headsUpRecipients,
  headsUps,
  sites,
  type HeadsUp,
} from '@forma360/db/schema';
import { user } from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { publishHeadsUp } from '../heads-up-publish';
import type { SendTemplatedEmail } from '@forma360/shared/email';
import { TRPCError } from '@trpc/server';
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission, tenantProcedure } from '../procedures';
import { assertStorageKeyInTenant } from '../tenant-guards';
import { router } from '../trpc';

export type HeadsUpsRouterDeps = {
  sendEmail: SendTemplatedEmail;
  /** Base app URL (e.g. https://forma360.io) used to build the CTA link. */
  appUrl?: string;
};

const headsUpIdInput = z.object({ headsUpId: z.string().length(26) });

const LIST_LIMIT = 100;

const ALLOWED_EMOJIS = ['celebrate', 'clap', 'smile'] as const;
type AllowedEmoji = (typeof ALLOWED_EMOJIS)[number];

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

/** Pending attachment shape — uploaded to R2 before the heads-up is saved. */
const attachmentInput = z.object({
  storageKey: z.string().min(1).max(1000),
  filename: z.string().min(1).max(500),
  mimeType: z.string().min(1).max(200),
  sizeBytes: z.number().int().min(0),
});

const recipientSpecSchema = z
  .object({
    broadcastToAll: z.boolean().default(false),
    groupIds: z.array(z.string()),
    siteIds: z.array(z.string()),
    userIds: z.array(z.string()),
  })
  .optional();

const createInput = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(50_000).default(''),
  engagementLevel: z.enum(['view', 'acknowledge', 'sign']).default('view'),
  requireAcknowledgement: z.boolean().default(false),
  requireSignature: z.boolean().default(false),
  allowComments: z.boolean().default(true),
  allowReactions: z.boolean().default(true),
  publishAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  /** Attachments already uploaded to R2; will be recorded in the DB atomically. */
  attachments: z.array(attachmentInput).max(6).default([]),
  /** Library documents to attach (#4). Each is version-anchored at send time. */
  documentIds: z.array(z.string().length(26)).max(20).default([]),
  /** JSON-encoded recipient spec for pre-selecting groups/sites/users at publish time. */
  recipientSpec: z.string().optional(),
});

const updateInput = z.object({
  headsUpId: z.string().length(26),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(50_000).optional(),
  engagementLevel: z.enum(['view', 'acknowledge', 'sign']).optional(),
  requireAcknowledgement: z.boolean().optional(),
  requireSignature: z.boolean().optional(),
  allowComments: z.boolean().optional(),
  allowReactions: z.boolean().optional(),
  publishAt: z.string().datetime().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  /** JSON-encoded recipient spec. */
  recipientSpec: z.string().optional(),
});

const publishInput = z.object({
  headsUpId: z.string().length(26),
  /**
   * User IDs, group IDs, or site IDs to add as recipients. The router
   * resolves group/site members and inserts individual recipient rows.
   * H-E01: once published, assignees are locked (the list is frozen).
   */
  // better-auth user IDs are not plain ULIDs (carry a "usr_" prefix).
  userIds: z.array(z.string().min(1).max(100)).default([]),
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

const addAttachmentInput = z.object({
  headsUpId: z.string().length(26),
  storageKey: z.string().min(1).max(1000),
  filename: z.string().min(1).max(500),
  mimeType: z.string().min(1).max(200),
  sizeBytes: z.number().int().min(0),
});

const removeAttachmentInput = z.object({
  headsUpId: z.string().length(26),
  attachmentId: z.string().length(26),
});

const reactionInput = z.object({
  headsUpId: z.string().length(26),
  emoji: z.enum(ALLOWED_EMOJIS),
});

/** Generate a cryptographically random share token. */
function generateShareToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function createHeadsUpsRouter(deps: HeadsUpsRouterDeps) {
  return router({
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
            allowComments: headsUps.allowComments,
            allowReactions: headsUps.allowReactions,
            publishAt: headsUps.publishAt,
            expiresAt: headsUps.expiresAt,
            createdByUserId: headsUps.createdByUserId,
            createdAt: headsUps.createdAt,
            updatedAt: headsUps.updatedAt,
            recipientSpec: headsUps.recipientSpec,
            creatorName: user.name,
          })
          .from(headsUps)
          .leftJoin(user, eq(user.id, headsUps.createdByUserId))
          .where(and(...where))
          .orderBy(desc(headsUps.createdAt))
          .limit(input.limit);

        // Resolve group/site names from recipientSpec so the list UI can
        // display a human-readable audience column without additional requests.
        const allGroupIds = new Set<string>();
        const allSiteIds = new Set<string>();
        for (const row of rows) {
          if (row.recipientSpec !== null) {
            try {
              const parsed = recipientSpecSchema.safeParse(
                JSON.parse(row.recipientSpec) as unknown,
              );
              if (parsed.success && parsed.data !== undefined) {
                for (const id of parsed.data.groupIds) allGroupIds.add(id);
                for (const id of parsed.data.siteIds) allSiteIds.add(id);
              }
            } catch {
              /* invalid JSON — skip */
            }
          }
        }

        const [groupNameRows, siteNameRows] = await Promise.all([
          allGroupIds.size > 0
            ? ctx.db
                .select({ id: groups.id, name: groups.name })
                .from(groups)
                .where(and(eq(groups.tenantId, ctx.tenantId), inArray(groups.id, [...allGroupIds])))
            : Promise.resolve([] as Array<{ id: string; name: string }>),
          allSiteIds.size > 0
            ? ctx.db
                .select({ id: sites.id, name: sites.name })
                .from(sites)
                .where(and(eq(sites.tenantId, ctx.tenantId), inArray(sites.id, [...allSiteIds])))
            : Promise.resolve([] as Array<{ id: string; name: string }>),
        ]);

        const groupNameMap = new Map(groupNameRows.map((g) => [g.id, g.name]));
        const siteNameMap = new Map(siteNameRows.map((s) => [s.id, s.name]));

        return rows.map((row) => {
          const groupNames: string[] = [];
          const siteNames: string[] = [];
          let hasIndividualUsers = false;
          if (row.recipientSpec !== null) {
            try {
              const parsed = recipientSpecSchema.safeParse(
                JSON.parse(row.recipientSpec) as unknown,
              );
              if (parsed.success && parsed.data !== undefined) {
                for (const id of parsed.data.groupIds) {
                  const name = groupNameMap.get(id);
                  if (name !== undefined) groupNames.push(name);
                }
                for (const id of parsed.data.siteIds) {
                  const name = siteNameMap.get(id);
                  if (name !== undefined) siteNames.push(name);
                }
                hasIndividualUsers = parsed.data.userIds.length > 0;
              }
            } catch {
              /* ignore */
            }
          }
          const { recipientSpec: _spec, ...rest } = row;
          return { ...rest, audience: { groupNames, siteNames, hasIndividualUsers } };
        });
      }),

    get: tenantProcedure
      .use(requirePermission('headsUp.view'))
      .input(headsUpIdInput)
      .query(async ({ ctx, input }) => {
        const headsUp = await loadHeadsUpOrThrow(ctx.db, ctx.tenantId, input.headsUpId);

        const [recipientCountRows, creatorRows, attachmentRows, documentRows] = await Promise.all([
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
          ctx.db
            .select({
              documentId: headsUpDocuments.documentId,
              documentVersion: headsUpDocuments.documentVersion,
              name: documents.name,
              mimeType: documents.mimeType,
            })
            .from(headsUpDocuments)
            .innerJoin(documents, eq(headsUpDocuments.documentId, documents.id))
            .where(eq(headsUpDocuments.headsUpId, headsUp.id)),
        ]);

        return {
          headsUp,
          creatorName: creatorRows[0]?.name ?? null,
          recipientCount: Number(recipientCountRows[0]?.total ?? 0),
          attachments: attachmentRows,
          documents: documentRows,
        };
      }),

    /**
     * Recipient-facing inbox: the published heads-ups targeted at the
     * current user, with their own engagement state. Only surfaces
     * heads-ups this user is an actual recipient of (never leaks
     * non-targeted or draft/archived messages).
     */
    listForRecipient: tenantProcedure
      .use(requirePermission('headsUp.view'))
      .input(z.object({ filter: z.enum(['all', 'pending', 'done']).optional() }).optional())
      .query(async ({ ctx, input }) => {
        const rows = await ctx.db
          .select({
            id: headsUps.id,
            title: headsUps.title,
            engagementLevel: headsUps.engagementLevel,
            requireAcknowledgement: headsUps.requireAcknowledgement,
            requireSignature: headsUps.requireSignature,
            publishAt: headsUps.publishAt,
            expiresAt: headsUps.expiresAt,
            createdAt: headsUps.createdAt,
            creatorName: user.name,
            viewedAt: headsUpRecipients.viewedAt,
            acknowledgedAt: headsUpRecipients.acknowledgedAt,
            signedAt: headsUpRecipients.signedAt,
          })
          .from(headsUpRecipients)
          .innerJoin(headsUps, eq(headsUps.id, headsUpRecipients.headsUpId))
          .leftJoin(user, eq(user.id, headsUps.createdByUserId))
          .where(
            and(
              eq(headsUpRecipients.tenantId, ctx.tenantId),
              eq(headsUpRecipients.userId, ctx.auth.userId),
              eq(headsUps.status, 'published'),
            ),
          )
          .orderBy(desc(headsUps.createdAt));

        const filter = input?.filter ?? 'all';
        const now = new Date();
        const mapped = rows.map((row) => {
          const expired = row.expiresAt !== null && row.expiresAt <= now;
          // PF-32: an expired notice is no longer pending anyone's action.
          const pending =
            !expired &&
            (row.engagementLevel === 'sign'
              ? row.signedAt === null
              : row.engagementLevel === 'acknowledge'
                ? row.acknowledgedAt === null
                : row.viewedAt === null);
          return {
            id: row.id,
            title: row.title,
            engagementLevel: row.engagementLevel,
            requireAcknowledgement: row.requireAcknowledgement,
            requireSignature: row.requireSignature,
            publishAt: row.publishAt,
            expiresAt: row.expiresAt,
            creatorName: row.creatorName,
            viewedAt: row.viewedAt,
            acknowledgedAt: row.acknowledgedAt,
            signedAt: row.signedAt,
            expired,
            pending,
          };
        });

        const filtered =
          filter === 'pending'
            ? mapped.filter((r) => r.pending)
            : filter === 'done'
              ? mapped.filter((r) => !r.pending)
              : mapped;

        // Pending-first; SQL already ordered by createdAt desc and Array.sort
        // is stable, so within each pending group the createdAt order holds.
        filtered.sort((a, b) => Number(b.pending) - Number(a.pending));
        return filtered;
      }),

    /**
     * Recipient-facing detail view for a single heads-up. Only the
     * targeted recipient of a *published* heads-up may read it — any other
     * caller (non-recipient, or a draft/archived message) gets NOT_FOUND
     * so we never leak the existence of a message they weren't sent.
     */
    getForRecipient: tenantProcedure
      .use(requirePermission('headsUp.view'))
      .input(z.object({ headsUpId: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        const [recipientRows, headsUpRows] = await Promise.all([
          ctx.db
            .select()
            .from(headsUpRecipients)
            .where(
              and(
                eq(headsUpRecipients.tenantId, ctx.tenantId),
                eq(headsUpRecipients.headsUpId, input.headsUpId),
                eq(headsUpRecipients.userId, ctx.auth.userId),
              ),
            )
            .limit(1),
          ctx.db
            .select()
            .from(headsUps)
            .where(and(eq(headsUps.tenantId, ctx.tenantId), eq(headsUps.id, input.headsUpId)))
            .limit(1),
        ]);

        const recipient = recipientRows[0];
        const headsUp = headsUpRows[0];
        if (recipient === undefined || headsUp === undefined || headsUp.status !== 'published') {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'heads-up-not-found' });
        }

        const [creatorRows, attachmentRows, documentRows] = await Promise.all([
          ctx.db
            .select({ name: user.name })
            .from(user)
            .where(eq(user.id, headsUp.createdByUserId))
            .limit(1),
          ctx.db
            .select()
            .from(headsUpAttachments)
            .where(eq(headsUpAttachments.headsUpId, headsUp.id)),
          ctx.db
            .select({
              documentId: headsUpDocuments.documentId,
              documentVersion: headsUpDocuments.documentVersion,
              name: documents.name,
              mimeType: documents.mimeType,
            })
            .from(headsUpDocuments)
            .innerJoin(documents, eq(headsUpDocuments.documentId, documents.id))
            .where(eq(headsUpDocuments.headsUpId, headsUp.id)),
        ]);

        return {
          headsUp: {
            id: headsUp.id,
            title: headsUp.title,
            description: headsUp.description,
            engagementLevel: headsUp.engagementLevel,
            requireAcknowledgement: headsUp.requireAcknowledgement,
            requireSignature: headsUp.requireSignature,
            allowReactions: headsUp.allowReactions,
            allowComments: headsUp.allowComments,
            publishAt: headsUp.publishAt,
            expiresAt: headsUp.expiresAt,
          },
          creatorName: creatorRows[0]?.name ?? null,
          attachments: attachmentRows,
          documents: documentRows,
          engagement: {
            viewedAt: recipient.viewedAt,
            acknowledgedAt: recipient.acknowledgedAt,
            signedAt: recipient.signedAt,
          },
        };
      }),

    create: tenantProcedure
      .use(requirePermission('headsUp.publish'))
      .input(createInput)
      .mutation(async ({ ctx, input }) => {
        // Attachment storage keys must live under this tenant's R2 prefix
        // (mirrors `attachments.add`) — a foreign key would let `get` mint a
        // signed download URL for another tenant's object.
        for (const a of input.attachments ?? []) {
          assertStorageKeyInTenant(ctx.tenantId, a.storageKey);
        }
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
          allowComments: input.allowComments,
          allowReactions: input.allowReactions,
          publishAt: input.publishAt !== undefined ? new Date(input.publishAt) : null,
          expiresAt: input.expiresAt !== undefined ? new Date(input.expiresAt) : null,
          recipientSpec: input.recipientSpec ?? null,
          createdByUserId: ctx.auth.userId,
          createdAt: now,
          updatedAt: now,
        });

        // Insert any attachments that were pre-uploaded to R2.
        if (input.attachments.length > 0) {
          await ctx.db.insert(headsUpAttachments).values(
            input.attachments.map((a) => ({
              id: newId(),
              tenantId: ctx.tenantId,
              headsUpId: id,
              storageKey: a.storageKey,
              filename: a.filename,
              mimeType: a.mimeType,
              sizeBytes: a.sizeBytes,
              uploadedByUserId: ctx.auth.userId,
              createdAt: now,
            })),
          );
        }

        // Attach library documents (#4), version-anchored at send time.
        if (input.documentIds.length > 0) {
          const docRows = await ctx.db
            .select({ id: documents.id, currentVersion: documents.currentVersion })
            .from(documents)
            .where(
              and(
                eq(documents.tenantId, ctx.tenantId),
                inArray(documents.id, input.documentIds),
                isNull(documents.archivedAt),
              ),
            );
          if (docRows.length > 0) {
            await ctx.db.insert(headsUpDocuments).values(
              docRows.map((d) => ({
                tenantId: ctx.tenantId,
                headsUpId: id,
                documentId: d.id,
                documentVersion: d.currentVersion,
                createdAt: now,
              })),
            );
          }
        }

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
        if (input.allowComments !== undefined) updates.allowComments = input.allowComments;
        if (input.allowReactions !== undefined) updates.allowReactions = input.allowReactions;
        if (input.publishAt !== undefined)
          updates.publishAt = input.publishAt === null ? null : new Date(input.publishAt);
        if (input.expiresAt !== undefined)
          updates.expiresAt = input.expiresAt === null ? null : new Date(input.expiresAt);
        if (input.recipientSpec !== undefined) updates.recipientSpec = input.recipientSpec;

        await ctx.db.update(headsUps).set(updates).where(eq(headsUps.id, headsUp.id));
        return { ok: true as const };
      }),

    /**
     * Publish: resolves all recipients from users/groups/sites and inserts
     * recipient rows. H-E01: assignees are locked at this point.
     * If no explicit userIds/groupIds/siteIds are passed, falls back to
     * the recipientSpec stored on the headsUp row.
     */
    publish: tenantProcedure
      .use(requirePermission('headsUp.publish'))
      .input(publishInput)
      .mutation(async ({ ctx, input }) => {
        const headsUp = await loadHeadsUpOrThrow(ctx.db, ctx.tenantId, input.headsUpId);
        if (headsUp.status === 'archived') {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'heads-up-archived' });
        }

const result = await publishHeadsUp(ctx.db, {
          tenantId: ctx.tenantId,
          headsUpId: headsUp.id,
          userIds: input.userIds,
          groupIds: input.groupIds,
          siteIds: input.siteIds,
          recipientSpec: headsUp.recipientSpec,
        });

        return { ok: true as const, recipientCount: result.recipientCount };
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

    /**
     * Create an opaque external share link for the Heads Up.
     * Returns the full share URL. Idempotent — calling again returns the
     * same token unless disableShareLink was called first.
     */
    createShareLink: tenantProcedure
      .use(requirePermission('headsUp.manage'))
      .input(headsUpIdInput)
      .mutation(async ({ ctx, input }) => {
        const headsUp = await loadHeadsUpOrThrow(ctx.db, ctx.tenantId, input.headsUpId);
        if (headsUp.shareToken !== null) {
          // Already exists — return the existing token.
          return { shareToken: headsUp.shareToken };
        }
        const token = generateShareToken();
        await ctx.db
          .update(headsUps)
          .set({ shareToken: token, updatedAt: new Date() })
          .where(eq(headsUps.id, headsUp.id));
        return { shareToken: token };
      }),

    /** Revoke the external share link. */
    disableShareLink: tenantProcedure
      .use(requirePermission('headsUp.manage'))
      .input(headsUpIdInput)
      .mutation(async ({ ctx, input }) => {
        await loadHeadsUpOrThrow(ctx.db, ctx.tenantId, input.headsUpId);
        await ctx.db
          .update(headsUps)
          .set({ shareToken: null, updatedAt: new Date() })
          .where(eq(headsUps.id, input.headsUpId));
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
        const where = [
          eq(headsUpRecipients.tenantId, ctx.tenantId),
          eq(headsUpRecipients.headsUpId, input.headsUpId),
        ];
        if (input.filter === 'viewed') where.push(isNotNull(headsUpRecipients.viewedAt));
        if (input.filter === 'not_viewed') where.push(isNull(headsUpRecipients.viewedAt));
        if (input.filter === 'acknowledged')
          where.push(isNotNull(headsUpRecipients.acknowledgedAt));
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
            reminderLastSentAt: headsUpRecipients.reminderLastSentAt,
          })
          .from(headsUpRecipients)
          .leftJoin(
            user,
            and(eq(user.id, headsUpRecipients.userId), eq(user.tenantId, ctx.tenantId)),
          )
          .where(and(...where))
          .orderBy(desc(headsUpRecipients.createdAt))
          .limit(input.limit);

        return rows;
      }),

    /**
     * Send reminder emails to pending recipients.
     * If userId is provided, only reminds that specific user.
     * Otherwise, reminds all users who haven't completed the required engagement action.
     */
    sendReminder: tenantProcedure
      .use(requirePermission('headsUp.manage'))
      .input(
        z.object({
          headsUpId: z.string().length(26),
          // better-auth user IDs carry a "usr_" prefix → longer than 26.
          userId: z.string().min(1).max(100).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const headsUp = await loadHeadsUpOrThrow(ctx.db, ctx.tenantId, input.headsUpId);
        if (headsUp.status !== 'published') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'heads-up-not-published' });
        }

        // Determine what "pending" means for this engagement level.
        const pendingCondition =
          headsUp.engagementLevel === 'sign'
            ? isNull(headsUpRecipients.signedAt)
            : headsUp.engagementLevel === 'acknowledge'
              ? isNull(headsUpRecipients.acknowledgedAt)
              : isNull(headsUpRecipients.viewedAt);

        const where = [
          eq(headsUpRecipients.tenantId, ctx.tenantId),
          eq(headsUpRecipients.headsUpId, input.headsUpId),
          pendingCondition,
        ];
        if (input.userId !== undefined) {
          where.push(eq(headsUpRecipients.userId, input.userId));
        }

        // Load pending recipients with their user email.
        const pending = await ctx.db
          .select({
            id: headsUpRecipients.id,
            userId: headsUpRecipients.userId,
            userEmail: user.email,
            userName: user.name,
          })
          .from(headsUpRecipients)
          .leftJoin(
            user,
            and(eq(user.id, headsUpRecipients.userId), eq(user.tenantId, ctx.tenantId)),
          )
          .where(and(...where));

        const now = new Date();
        for (const r of pending) {
          if (r.userEmail !== null) {
            const actionRequired =
              headsUp.engagementLevel === 'sign'
                ? 'sign'
                : headsUp.engagementLevel === 'acknowledge'
                  ? 'acknowledge'
                  : 'view';
            // PF-15: recipients land on THEIR view page — the old link
            // pointed at the admin detail (no locale prefix, no access).
            const viewUrl =
              deps.appUrl !== undefined
                ? `${deps.appUrl}/en/heads-up/${input.headsUpId}/view`
                : undefined;
            await deps.sendEmail({
              to: r.userEmail,
              templateKey: 'heads-up-reminder',
              variables: {
                recipientName: r.userName ?? r.userEmail,
                headsUpTitle: headsUp.title,
                actionRequired,
                ...(viewUrl !== undefined ? { viewUrl } : {}),
              },
            });
          }
          await ctx.db
            .update(headsUpRecipients)
            .set({ reminderLastSentAt: now })
            .where(eq(headsUpRecipients.id, r.id));
        }

        return { ok: true as const, count: pending.length };
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
            acknowledgedAt:
              recipient.acknowledgedAt ?? (headsUp.requireAcknowledgement ? now : null),
            signedAt: now,
            signatureData: input.signatureData,
          })
          .where(eq(headsUpRecipients.id, recipient.id));
        return { ok: true as const };
      }),

    attachments: router({
      /** Record an attachment that has already been uploaded to R2. */
      add: tenantProcedure
        .use(requirePermission('headsUp.manage'))
        .input(addAttachmentInput)
        .mutation(async ({ ctx, input }) => {
          await loadHeadsUpOrThrow(ctx.db, ctx.tenantId, input.headsUpId);
          // Storage key must live under this tenant's R2 prefix (see the
          // issues attachment path for the full rationale).
          assertStorageKeyInTenant(ctx.tenantId, input.storageKey);
          // Count existing attachments to enforce 6-file limit.
          const existingRows = await ctx.db
            .select({ c: count() })
            .from(headsUpAttachments)
            .where(eq(headsUpAttachments.headsUpId, input.headsUpId));
          const existing = Number(existingRows[0]?.c ?? 0);
          if (existing >= 6) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'max-attachments-reached' });
          }
          const id = newId();
          await ctx.db.insert(headsUpAttachments).values({
            id,
            tenantId: ctx.tenantId,
            headsUpId: input.headsUpId,
            storageKey: input.storageKey,
            filename: input.filename,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            uploadedByUserId: ctx.auth.userId,
          });
          return { attachmentId: id };
        }),

      /** Remove an attachment record. Caller is responsible for R2 cleanup. */
      remove: tenantProcedure
        .use(requirePermission('headsUp.manage'))
        .input(removeAttachmentInput)
        .mutation(async ({ ctx, input }) => {
          await loadHeadsUpOrThrow(ctx.db, ctx.tenantId, input.headsUpId);
          const { eq: eqOp } = await import('drizzle-orm');
          await ctx.db
            .delete(headsUpAttachments)
            .where(
              and(
                eqOp(headsUpAttachments.headsUpId, input.headsUpId),
                eqOp(headsUpAttachments.id, input.attachmentId),
              ),
            );
          return { ok: true as const };
        }),
    }),

    reactions: router({
      /** List emoji reaction counts for a Heads Up. */
      list: tenantProcedure
        .use(requirePermission('headsUp.view'))
        .input(z.object({ headsUpId: z.string().length(26) }))
        .query(async ({ ctx, input }) => {
          await loadHeadsUpOrThrow(ctx.db, ctx.tenantId, input.headsUpId);
          const rows = await ctx.db
            .select({
              emoji: headsUpReactions.emoji,
              userId: headsUpReactions.userId,
            })
            .from(headsUpReactions)
            .where(eq(headsUpReactions.headsUpId, input.headsUpId));

          // Group by emoji.
          const counts: Record<AllowedEmoji, { count: number; reacted: boolean }> = {
            celebrate: { count: 0, reacted: false },
            clap: { count: 0, reacted: false },
            smile: { count: 0, reacted: false },
          };
          for (const r of rows) {
            const key = r.emoji as AllowedEmoji;
            if (key in counts) {
              const entry = counts[key];
              if (entry !== undefined) {
                entry.count += 1;
                if (r.userId === ctx.auth.userId) entry.reacted = true;
              }
            }
          }
          return counts;
        }),

      /** Toggle (add or remove) a reaction for the current user. */
      toggle: tenantProcedure
        .use(requirePermission('headsUp.view'))
        .input(reactionInput)
        .mutation(async ({ ctx, input }) => {
          await loadHeadsUpOrThrow(ctx.db, ctx.tenantId, input.headsUpId);

          // Check if the reaction already exists.
          const existing = await ctx.db
            .select({ id: headsUpReactions.id })
            .from(headsUpReactions)
            .where(
              and(
                eq(headsUpReactions.headsUpId, input.headsUpId),
                eq(headsUpReactions.userId, ctx.auth.userId),
                eq(headsUpReactions.emoji, input.emoji),
              ),
            )
            .limit(1);

          if (existing.length > 0) {
            // Remove existing reaction.
            await ctx.db
              .delete(headsUpReactions)
              .where(eq(headsUpReactions.id, existing[0]?.id ?? ''));
            return { action: 'removed' as const };
          }

          await ctx.db.insert(headsUpReactions).values({
            id: newId(),
            tenantId: ctx.tenantId,
            headsUpId: input.headsUpId,
            userId: ctx.auth.userId,
            emoji: input.emoji,
          });
          return { action: 'added' as const };
        }),
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
          const headsUp = await loadHeadsUpOrThrow(ctx.db, ctx.tenantId, input.headsUpId);
          // PF-32: the composer's "allow comments" switch is a promise —
          // refuse instead of silently accepting what the author disabled.
          if (!headsUp.allowComments) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'comments-disabled' });
          }
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
}

/**
 * Static export for backward compatibility. Tests and the stub `appRouter`
 * in router.ts use this; production wiring uses `buildAppRouter` which
 * calls `createHeadsUpsRouter` with real deps.
 */
export const headsUpsRouter = createHeadsUpsRouter({
  sendEmail: async () => ({ delivery: 'console' as const }),
});
