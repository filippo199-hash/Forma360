/**
 * Handler for `forma360-maintenance-tick` (Phase 5B).
 *
 * Runs daily at 07:00 UTC. For every active maintenance plan-asset link it:
 *   1. Computes the next due date.
 *   2. Checks whether today falls within any configured notification window
 *      (notificationDaysBefore).
 *   3. Fans out a MAINTENANCE_NOTIFY job for each window not yet dispatched
 *      for this due-date cycle.
 *
 * Dedup: each plan-asset link stores a `notificationsLog` JSONB field keyed
 * by dueDate (YYYY-MM-DD), with the value being an array of daysBefore
 * values already sent. When the asset is serviced, the due date changes, so
 * the old log key is irrelevant.
 */
import {
  assets,
  maintenancePlanAssets,
  maintenancePlans,
} from '@forma360/db/schema';
import type { Database } from '@forma360/db/client';
import type { Logger } from '@forma360/shared/logger';
import type { Job, ConnectionOptions } from 'bullmq';
import { and, eq, isNull } from 'drizzle-orm';
import { getQueue, QUEUE_NAMES, type MaintenanceTickPayload } from '../queues';

export const MAINTENANCE_TICK_CRON = '0 7 * * *'; // 07:00 UTC daily

/** Compute the due date string (YYYY-MM-DD) for a time-based plan, or null. */
function computeDueDate(lastServiceDate: string | null, intervalDays: number | null): string | null {
  if (lastServiceDate === null || intervalDays === null || intervalDays <= 0) return null;
  const d = new Date(lastServiceDate);
  d.setUTCDate(d.getUTCDate() + intervalDays);
  return d.toISOString().slice(0, 10);
}

/** Days from today until due date (negative = overdue). */
function daysUntilDue(dueDate: string, today: Date): number {
  const due = new Date(dueDate);
  const msPerDay = 86_400_000;
  return Math.ceil((due.getTime() - today.getTime()) / msPerDay);
}

export function createMaintenanceTickHandler(deps: {
  db: Database;
  logger: Logger;
  connection: ConnectionOptions;
}) {
  const { db, logger, connection } = deps;
  const notifyQueue = getQueue(QUEUE_NAMES.MAINTENANCE_NOTIFY, connection);

  return async function maintenanceTickHandler(job: Job<MaintenanceTickPayload>) {
    const today = new Date(job.data.tickAt ?? new Date().toISOString());
    today.setUTCHours(0, 0, 0, 0);
    const todayIso = today.toISOString().slice(0, 10);

    const log = logger.child({ jobId: job.id, tickAt: todayIso });
    log.info('[maintenance-tick] scanning');

    // Load all active time-based plan-asset links.
    const links = await db
      .select({
        id: maintenancePlanAssets.id,
        tenantId: maintenancePlans.tenantId,
        planId: maintenancePlanAssets.planId,
        assetId: maintenancePlanAssets.assetId,
        lastServiceDate: maintenancePlanAssets.lastServiceDate,
        intervalDays: maintenancePlans.intervalDays,
        planType: maintenancePlans.planType,
        notificationDaysBefore: maintenancePlans.notificationDaysBefore,
        notificationsLog: maintenancePlanAssets.notificationsLog,
      })
      .from(maintenancePlanAssets)
      .innerJoin(maintenancePlans, eq(maintenancePlans.id, maintenancePlanAssets.planId))
      .innerJoin(assets, eq(assets.id, maintenancePlanAssets.assetId))
      .where(
        and(
          isNull(maintenancePlans.archivedAt),
          isNull(assets.archivedAt),
          eq(maintenancePlans.planType, 'time'),
        ),
      );

    log.info({ count: links.length }, '[maintenance-tick] links found');

    let enqueued = 0;
    for (const link of links) {
      const dueDate = computeDueDate(link.lastServiceDate, link.intervalDays);
      if (dueDate === null) continue;

      const remaining = daysUntilDue(dueDate, today);
      const notifDays = Array.isArray(link.notificationDaysBefore)
        ? (link.notificationDaysBefore as number[])
        : [];
      if (notifDays.length === 0) continue;

      // Build the dedup log for this due date.
      const rawLog = link.notificationsLog as Record<string, number[]> | null;
      const sentForDue: number[] = Array.isArray(rawLog?.[dueDate]) ? (rawLog![dueDate] as number[]) : [];

      for (const daysBefore of notifDays) {
        // Notify on the exact day or on overdue (remaining <= 0) for the 0-day entry.
        const shouldNotify = remaining === daysBefore || (daysBefore === 0 && remaining <= 0);
        if (!shouldNotify) continue;
        if (sentForDue.includes(daysBefore)) continue;

        const payload = {
          tenantId: link.tenantId,
          planId: link.planId,
          assetId: link.assetId ?? '',
          dueDate,
          daysBefore,
        };
        await notifyQueue.add(QUEUE_NAMES.MAINTENANCE_NOTIFY, payload, {
          jobId: `maint-notify:${link.planId}:${link.assetId}:${dueDate}:${daysBefore}`,
          removeOnComplete: 100,
          removeOnFail: 50,
        });
        enqueued++;
      }
    }

    log.info({ enqueued }, '[maintenance-tick] done');
  };
}
