/**
 * Handler for `forma360-heads-up-publish` (platform HSE review PF-15):
 * the composer's "schedule for later" saved a draft "for the schedule
 * job" — and no schedule job existed, so scheduled notices sat in
 * drafts forever, silently. Every five minutes this worker publishes
 * draft Heads Ups whose `publishAt` has arrived, through the SAME
 * recipient-freeze core the router uses (`publishHeadsUp` from
 * `@forma360/api`).
 */
import { publishHeadsUp } from '@forma360/api';
import type { Database } from '@forma360/db/client';
import { headsUps } from '@forma360/db/schema';
import type { Logger } from '@forma360/shared/logger';
import type { Job } from 'bullmq';
import { and, eq, isNotNull, lte } from 'drizzle-orm';

export const HEADS_UP_PUBLISH_CRON = '*/5 * * * *'; // every five minutes
/** Per-run cap — a backlog drains across ticks instead of one burst. */
export const MAX_PUBLISHES_PER_RUN = 100;

export interface HeadsUpPublishDeps {
  db: Database;
  logger: Logger;
  now?: () => Date;
}

export async function runHeadsUpPublish(
  deps: HeadsUpPublishDeps,
): Promise<{ published: number }> {
  const now = deps.now?.() ?? new Date();
  const due = await deps.db
    .select({
      id: headsUps.id,
      tenantId: headsUps.tenantId,
      recipientSpec: headsUps.recipientSpec,
    })
    .from(headsUps)
    .where(
      and(eq(headsUps.status, 'draft'), isNotNull(headsUps.publishAt), lte(headsUps.publishAt, now)),
    )
    .limit(MAX_PUBLISHES_PER_RUN);

  let published = 0;
  for (const row of due) {
    try {
      const result = await publishHeadsUp(deps.db, {
        tenantId: row.tenantId,
        headsUpId: row.id,
        userIds: [],
        groupIds: [],
        siteIds: [],
        recipientSpec: row.recipientSpec,
      });
      published += 1;
      deps.logger.info(
        { headsUpId: row.id, recipients: result.recipientCount },
        '[heads-up-publish] published scheduled notice',
      );
    } catch (err) {
      // One bad row must not sink the batch — the next tick retries it.
      deps.logger.error({ err, headsUpId: row.id }, '[heads-up-publish] publish failed');
    }
  }
  return { published };
}

export function createHeadsUpPublishHandler(deps: HeadsUpPublishDeps) {
  return async (_job: Job): Promise<{ published: number }> => {
    return runHeadsUpPublish(deps);
  };
}
