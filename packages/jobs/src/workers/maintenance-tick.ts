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
  assetReadings,
  assets,
  maintenancePlanAssets,
  maintenancePlans,
} from '@forma360/db/schema';
import type { Database } from '@forma360/db/client';
import type { Logger } from '@forma360/shared/logger';
import type { Job, ConnectionOptions } from 'bullmq';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { getQueue, QUEUE_NAMES, type MaintenanceTickPayload } from '../queues';

export const MAINTENANCE_TICK_CRON = '0 7 * * *'; // 07:00 UTC daily

/** Compute the due date string (YYYY-MM-DD) for a time-based plan, or null. */
function computeDueDate(
  lastServiceDate: string | null,
  intervalDays: number | null,
): string | null {
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

    // Load ALL active plan-asset links — time AND usage based (PF-18: the
    // 'usage' filter gap meant meter-based plans never notified anyone).
    const links = await db
      .select({
        id: maintenancePlanAssets.id,
        tenantId: maintenancePlans.tenantId,
        planId: maintenancePlanAssets.planId,
        assetId: maintenancePlanAssets.assetId,
        lastServiceDate: maintenancePlanAssets.lastServiceDate,
        lastServiceValue: maintenancePlanAssets.lastServiceValue,
        intervalDays: maintenancePlans.intervalDays,
        intervalUsage: maintenancePlans.intervalUsage,
        usageField: maintenancePlans.usageField,
        usageUnit: maintenancePlans.usageUnit,
        planType: maintenancePlans.planType,
        notificationDaysBefore: maintenancePlans.notificationDaysBefore,
        notificationsLog: maintenancePlanAssets.notificationsLog,
      })
      .from(maintenancePlanAssets)
      .innerJoin(maintenancePlans, eq(maintenancePlans.id, maintenancePlanAssets.planId))
      .innerJoin(assets, eq(assets.id, maintenancePlanAssets.assetId))
      .where(and(isNull(maintenancePlans.archivedAt), isNull(assets.archivedAt)));

    log.info({ count: links.length }, '[maintenance-tick] links found');

    let enqueued = 0;
    for (const link of links) {
      if (link.planType === 'usage') {
        enqueued += await evaluateUsageLink(db, notifyQueue, link, log);
        continue;
      }
      const dueDate = computeDueDate(link.lastServiceDate, link.intervalDays);
      if (dueDate === null) continue;

      const remaining = daysUntilDue(dueDate, today);
      const notifDays = Array.isArray(link.notificationDaysBefore)
        ? (link.notificationDaysBefore as number[])
        : [];
      if (notifDays.length === 0) continue;

      // Build the dedup log for this due date.
      const rawLog = link.notificationsLog as Record<string, number[]> | null;
      const sentForDueRaw = rawLog !== null ? rawLog[dueDate] : undefined;
      const sentForDue: number[] = Array.isArray(sentForDueRaw) ? (sentForDueRaw as number[]) : [];

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

/** Marker stored in the dedup log for a usage-cycle "approaching" send. */
export const USAGE_APPROACHING_MARKER = 1;
/** Marker for the usage-cycle "due" send. */
export const USAGE_DUE_MARKER = 0;
/** Fraction of the usage interval at which the early warning fires. */
export const USAGE_APPROACHING_FRACTION = 0.9;

export interface UsageLinkRow {
  id: string;
  tenantId: string;
  planId: string;
  assetId: string | null;
  lastServiceValue: string | null;
  intervalUsage: string | null;
  usageField: string | null;
  usageUnit: string;
  notificationDaysBefore: unknown;
  notificationsLog: unknown;
}

/**
 * PF-18: evaluate one usage-based plan-asset link. Due when the latest
 * reading of the plan's usage field crosses lastServiceValue + interval;
 * an early warning fires at {@link USAGE_APPROACHING_FRACTION} of the
 * interval. One send per cycle, deduped through the same notificationsLog
 * mechanism time plans use, keyed `usage:<threshold>`.
 */
export async function evaluateUsageLink(
  db: Database,
  notifyQueue: { add: (name: string, payload: object, opts: object) => Promise<unknown> },
  link: UsageLinkRow,
  log: Logger,
): Promise<number> {
  if (link.assetId === null || link.usageField === null || link.intervalUsage === null) return 0;
  const interval = Number(link.intervalUsage);
  if (!Number.isFinite(interval) || interval <= 0) return 0;
  const notifDays = Array.isArray(link.notificationDaysBefore)
    ? (link.notificationDaysBefore as number[])
    : [];
  if (notifDays.length === 0) return 0;

  const latest = await db
    .select({ value: assetReadings.value })
    .from(assetReadings)
    .where(
      and(eq(assetReadings.assetId, link.assetId), eq(assetReadings.fieldName, link.usageField)),
    )
    .orderBy(desc(assetReadings.capturedAt))
    .limit(1);
  const current = latest[0] === undefined ? null : Number(latest[0].value);
  if (current === null || !Number.isFinite(current)) return 0;

  const base = link.lastServiceValue === null ? 0 : Number(link.lastServiceValue);
  const threshold = base + interval;
  const logKey = `usage:${threshold}`;
  const rawLog = link.notificationsLog as Record<string, number[]> | null;
  const sentRaw = rawLog !== null ? rawLog[logKey] : undefined;
  const sent: number[] = Array.isArray(sentRaw) ? (sentRaw as number[]) : [];

  const unit = link.usageUnit.length > 0 ? ` ${link.usageUnit}` : '';
  const wanted: Array<{ marker: number; statusLabel: string }> = [];
  if (current >= threshold && !sent.includes(USAGE_DUE_MARKER)) {
    wanted.push({
      marker: USAGE_DUE_MARKER,
      statusLabel: `due — meter at ${current}${unit}, service at ${threshold}${unit}`,
    });
  } else if (
    current >= base + interval * USAGE_APPROACHING_FRACTION &&
    current < threshold &&
    notifDays.some((d) => d > 0) &&
    !sent.includes(USAGE_APPROACHING_MARKER) &&
    !sent.includes(USAGE_DUE_MARKER)
  ) {
    wanted.push({
      marker: USAGE_APPROACHING_MARKER,
      statusLabel: `approaching — meter at ${current}${unit}, service at ${threshold}${unit}`,
    });
  }

  let n = 0;
  for (const w of wanted) {
    await notifyQueue.add(
      QUEUE_NAMES.MAINTENANCE_NOTIFY,
      {
        tenantId: link.tenantId,
        planId: link.planId,
        assetId: link.assetId,
        dueDate: logKey,
        daysBefore: w.marker,
        statusLabel: w.statusLabel,
        dueLabel: `at ${threshold}${unit}`,
      },
      {
        jobId: `maint-notify:${link.planId}:${link.assetId}:${logKey}:${w.marker}`,
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    );
    n += 1;
  }
  if (n > 0)
    log.info(
      { planId: link.planId, assetId: link.assetId },
      '[maintenance-tick] usage notify enqueued',
    );
  return n;
}
