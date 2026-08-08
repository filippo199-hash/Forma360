/**
 * Handler for `forma360-dashboard-schedule-tick` (ADR 0018).
 *
 * Every 15 minutes: scan unpaused `dashboard_schedules` whose dashboard
 * is PUBLISHED, expand each RRULE over the window
 * (max(lastSentAt, startAt, now − 24h), now], and enqueue one
 * `dashboard-schedule-send` job per due schedule.
 *
 * Two deliberate properties:
 *   - LATEST occurrence only. After downtime (or a long pause) a
 *     schedule sends ONE report carrying current numbers, not a backlog
 *     of stale ones — a dashboard PDF is a view of now, so replaying
 *     missed occurrences would email identical attachments N times.
 *   - The 24-hour floor bounds the catch-up: an occurrence older than a
 *     day is gone, matching what a recipient would expect of a report
 *     that failed to arrive yesterday.
 *
 * Timezone handling copies schedule-materialise: the rrule walks in
 * floating wall-clock time, each hit is reinterpreted in the schedule's
 * IANA zone via `floatingToZonedUtc`, and the window filter runs in the
 * TRUE frame over a padded walk (±14 h covers any offset + DST).
 */
import type { Database } from '@forma360/db/client';
import { dashboardSchedules, dashboards } from '@forma360/db/schema';
import type { Logger } from '@forma360/shared/logger';
import { floatingToZonedUtc } from '@forma360/shared/timezone';
import type { ConnectionOptions, Job } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { enqueue } from '../enqueue';
import { QUEUE_NAMES, type DashboardScheduleSendPayload } from '../queues';
import { occurrencesBetween } from './schedule-rrule';

export const DASHBOARD_SCHEDULE_TICK_CRON = '*/15 * * * *';

/** Catch-up floor: occurrences older than this never fire. */
export const DASHBOARD_CATCHUP_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Padding for the floating-frame walk (max tz offset + DST headroom). */
const TZ_PAD_MS = 14 * 60 * 60 * 1000;

export interface DueDashboardSend {
  scheduleId: string;
  tenantId: string;
  /** The latest due occurrence — the one the send job delivers. */
  occurrenceAt: Date;
}

/**
 * One pass over every tenant's dashboard schedules. Pure — the handler
 * and the tests share it. Returns at most one entry per schedule.
 */
export async function collectDueDashboardSends(
  db: Database,
  now: Date,
): Promise<DueDashboardSend[]> {
  const rows = await db
    .select({
      id: dashboardSchedules.id,
      tenantId: dashboardSchedules.tenantId,
      rrule: dashboardSchedules.rrule,
      timezone: dashboardSchedules.timezone,
      startAt: dashboardSchedules.startAt,
      endAt: dashboardSchedules.endAt,
      lastSentAt: dashboardSchedules.lastSentAt,
    })
    .from(dashboardSchedules)
    .innerJoin(dashboards, eq(dashboards.id, dashboardSchedules.dashboardId))
    .where(and(eq(dashboardSchedules.paused, false), eq(dashboards.status, 'published')));

  const floor = new Date(now.getTime() - DASHBOARD_CATCHUP_WINDOW_MS);
  const due: DueDashboardSend[] = [];
  for (const row of rows) {
    let fireTimes: Date[];
    try {
      fireTimes = occurrencesBetween({
        rrule: row.rrule,
        startAt: row.startAt,
        from: new Date(floor.getTime() - TZ_PAD_MS),
        until: new Date(now.getTime() + TZ_PAD_MS),
        endAt: row.endAt,
      });
    } catch {
      // A malformed rrule slipped past router validation (or predates
      // it). Skip rather than wedging the whole tick for every tenant.
      continue;
    }
    const lastSentMs = row.lastSentAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    let latest: Date | null = null;
    for (const floating of fireTimes) {
      const occ = floatingToZonedUtc(floating, row.timezone);
      const t = occ.getTime();
      // Window (max(lastSentAt, floor), now] — lower-exclusive on the
      // dedupe cursor so occurrenceAt === lastSentAt never re-fires.
      if (t > now.getTime() || t <= floor.getTime() || t <= lastSentMs) continue;
      if (latest === null || t > latest.getTime()) latest = occ;
    }
    if (latest !== null) {
      due.push({ scheduleId: row.id, tenantId: row.tenantId, occurrenceAt: latest });
    }
  }
  return due;
}

export interface DashboardScheduleTickDeps {
  db: Database;
  logger: Logger;
  /** Enqueue one send job. Injected so tests fake it (no Redis). */
  enqueueSend: (payload: DashboardScheduleSendPayload) => Promise<void>;
  /** Overridable clock for tests. */
  now?: () => Date;
}

/** Pure run: scan, then enqueue one send per due schedule. */
export async function runDashboardScheduleTick(
  deps: DashboardScheduleTickDeps,
): Promise<{ due: number }> {
  const now = deps.now?.() ?? new Date();
  const due = await collectDueDashboardSends(deps.db, now);
  for (const d of due) {
    await deps.enqueueSend({
      scheduleId: d.scheduleId,
      occurrenceAt: d.occurrenceAt.toISOString(),
    });
  }
  deps.logger.info({ due: due.length }, '[dashboard-schedule-tick] run complete');
  return { due: due.length };
}

/** BullMQ job wrapper — wires the real enqueue over the shared Redis. */
export function createDashboardScheduleTickHandler(deps: {
  db: Database;
  logger: Logger;
  connection: ConnectionOptions;
}) {
  return async (_job: Job): Promise<{ due: number }> =>
    runDashboardScheduleTick({
      db: deps.db,
      logger: deps.logger,
      enqueueSend: async (payload) => {
        await enqueue(QUEUE_NAMES.DASHBOARD_SCHEDULE_SEND, payload, {
          connection: deps.connection,
        });
      },
    });
}
