/**
 * Handler for `forma360:schedule-tick` (Phase 2 PR 32).
 *
 * Scans every unpaused `template_schedules` row whose
 * `lastMaterialisedAt` is stale (null, or older than the freshness
 * threshold) and enqueues one `schedule-materialise` job per row.
 *
 * Deliberately cheap: a single indexed query + N enqueues. The heavy
 * work (occurrence generation, DB writes, reminder scheduling) lives
 * in the materialise handler.
 */
import type { Database } from '@forma360/db/client';
import { templateSchedules } from '@forma360/db/schema';
import type { Logger } from '@forma360/shared/logger';
import type { ConnectionOptions, Job } from 'bullmq';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { enqueue } from '../enqueue';
import { QUEUE_NAMES, type ScheduleTickPayload } from '../queues';

/** 10 minutes — how often the tick repeats. */
export const SCHEDULE_TICK_CRON = '*/10 * * * *';

/** Freshness threshold: schedules not materialised in the last hour re-run. */
const STALE_MS = 60 * 60 * 1000;

export interface ScheduleTickDeps {
  db: Database;
  logger: Logger;
  /** Connection used to enqueue materialise jobs. */
  connection: ConnectionOptions;
}

export function createScheduleTickHandler(deps: ScheduleTickDeps) {
  return async function handleScheduleTick(job: Job<ScheduleTickPayload>): Promise<void> {
    const log = deps.logger.child({ job_id: job.id, queue: job.queueName });
    const now = new Date();
    const stale = new Date(now.getTime() - STALE_MS);

    const rows = await deps.db
      .select({
        id: templateSchedules.id,
        tenantId: templateSchedules.tenantId,
      })
      .from(templateSchedules)
      .where(
        and(
          eq(templateSchedules.paused, false),
          or(
            isNull(templateSchedules.lastMaterialisedAt),
            lt(templateSchedules.lastMaterialisedAt, stale),
          ),
          // Skip schedules whose endAt has already passed.
          or(
            isNull(templateSchedules.endAt),
            sql`${templateSchedules.endAt} > now()`,
          ),
        ),
      );

    log.info({ due: rows.length }, '[schedule-tick] scanning');

    for (const row of rows) {
      await enqueue(
        QUEUE_NAMES.SCHEDULE_MATERIALISE,
        { tenantId: row.tenantId, scheduleId: row.id },
        { connection: deps.connection },
      );
    }
  };
}
