/**
 * The publish core for Heads Ups, extracted from the router so the
 * scheduled-publish worker can run the exact same recipient-freeze
 * logic (platform HSE review PF-15 — "schedule for later" used to save
 * a draft "for the schedule job" when no schedule job existed; a
 * toolbox-talk notice scheduled for Monday 07:00 sat in drafts forever).
 *
 * Semantics preserved verbatim from the router mutation:
 *  - explicit ids win; otherwise the stored recipientSpec applies
 *  - broadcastToAll (or an empty resolved spec) fans out to every
 *    active user in the tenant
 *  - group/site expansion via the materialised membership tables
 *  - recipients are validated against the tenant before insert
 *  - re-publish is idempotent (onConflictDoNothing)
 */
import type { Database } from '@forma360/db/client';
import { groupMembers, headsUpRecipients, headsUps, siteMembers, user } from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { notifyInAppMany } from './notify';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';

export const recipientSpecSchema = z
  .object({
    broadcastToAll: z.boolean().default(false),
    userIds: z.array(z.string()).default([]),
    groupIds: z.array(z.string().length(26)).default([]),
    siteIds: z.array(z.string().length(26)).default([]),
  })
  .optional();

export interface PublishHeadsUpInput {
  tenantId: string;
  headsUpId: string;
  userIds: string[];
  groupIds: string[];
  siteIds: string[];
  /** Stored spec JSON (from the heads_ups row), consulted when no explicit ids. */
  recipientSpec: string | null;
}

export async function publishHeadsUp(
  db: Database,
  input: PublishHeadsUpInput,
): Promise<{ recipientCount: number }> {
  let effectiveUserIds = [...input.userIds];
  let effectiveGroupIds = [...input.groupIds];
  let effectiveSiteIds = [...input.siteIds];

  const hasExplicit =
    input.userIds.length > 0 || input.groupIds.length > 0 || input.siteIds.length > 0;

  let broadcastToAll = false;

  if (!hasExplicit && input.recipientSpec !== null) {
    const parsed = recipientSpecSchema.safeParse(
      (() => {
        try {
          return JSON.parse(input.recipientSpec ?? '{}') as unknown;
        } catch {
          return {};
        }
      })(),
    );
    if (parsed.success && parsed.data !== undefined) {
      broadcastToAll = parsed.data.broadcastToAll;
      effectiveUserIds = parsed.data.userIds;
      effectiveGroupIds = parsed.data.groupIds;
      effectiveSiteIds = parsed.data.siteIds;
    }
  }

  const recipientUserIds = new Set<string>(effectiveUserIds);

  const resolvedEmpty =
    !broadcastToAll &&
    recipientUserIds.size === 0 &&
    effectiveGroupIds.length === 0 &&
    effectiveSiteIds.length === 0;
  if (broadcastToAll || resolvedEmpty) {
    const allUsers = await db
      .select({ id: user.id })
      .from(user)
      .where(and(eq(user.tenantId, input.tenantId), isNull(user.deactivatedAt)));
    for (const u of allUsers) recipientUserIds.add(u.id);
  }

  if (effectiveGroupIds.length > 0) {
    const memberRows = await db
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.tenantId, input.tenantId),
          inArray(groupMembers.groupId, effectiveGroupIds),
        ),
      );
    for (const r of memberRows) recipientUserIds.add(r.userId);
  }

  if (effectiveSiteIds.length > 0) {
    const siteUserRows = await db
      .select({ userId: siteMembers.userId })
      .from(siteMembers)
      .where(
        and(
          eq(siteMembers.tenantId, input.tenantId),
          inArray(siteMembers.siteId, effectiveSiteIds),
        ),
      );
    for (const r of siteUserRows) recipientUserIds.add(r.userId);
  }

  const now = new Date();

  // Restrict recipients to users that actually belong to this tenant. A
  // client-supplied (or stored-spec) `userId` must never materialise a
  // foreign user as a recipient — that would leak their name + email via
  // `listRecipients`/`sendReminder`. The group/site expansions above are
  // already tenant-scoped; this catches the direct-id path.
  const candidateIds = [...recipientUserIds];
  const inTenantRows =
    candidateIds.length > 0
      ? await db
          .select({ id: user.id })
          .from(user)
          .where(and(eq(user.tenantId, input.tenantId), inArray(user.id, candidateIds)))
      : [];
  const validUserIds = new Set(inTenantRows.map((r) => r.id));

  const values = [...recipientUserIds]
    .filter((userId) => validUserIds.has(userId))
    .map((userId) => ({
      id: newId(),
      tenantId: input.tenantId,
      headsUpId: input.headsUpId,
      userId,
      createdAt: now,
    }));

  if (values.length > 0) {
    await db.insert(headsUpRecipients).values(values).onConflictDoNothing();
    // PF-23: the bell mirrors the Heads Up fan-out.
    const titleRows = await db
      .select({ title: headsUps.title })
      .from(headsUps)
      .where(eq(headsUps.id, input.headsUpId))
      .limit(1);
    await notifyInAppMany(
      db,
      values.map((v) => v.userId),
      {
        tenantId: input.tenantId,
        kind: 'heads_up',
        title: titleRows[0]?.title ?? '',
        href: `/briefings/${input.headsUpId}`,
      },
    );
  }

  await db
    .update(headsUps)
    .set({ status: 'published', updatedAt: now })
    .where(eq(headsUps.id, input.headsUpId));

  return { recipientCount: values.length };
}
