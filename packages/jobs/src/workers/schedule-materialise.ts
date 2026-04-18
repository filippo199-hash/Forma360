/**
 * Handler for `forma360:schedule-materialise` (Phase 2 PR 32).
 *
 * For one schedule:
 *   1. Load the schedule + its assignee set (direct users + expanded
 *      group memberships).
 *   2. Compute occurrences in the forward 14-day window via the rrule
 *      helper.
 *   3. For each (time, assignee) combination, upsert a
 *      `scheduled_inspection_occurrences` row — the unique index on
 *      (scheduleId, assigneeUserId, occurrenceAt) makes this idempotent
 *      via onConflictDoNothing.
 *   4. For each newly-created row whose reminder time is inside the
 *      window, enqueue a `schedule-reminder` job with a delay matching
 *      the offset until the reminder fires.
 *   5. Stamp `lastMaterialisedAt` on the schedule.
 */
import type { Database } from '@forma360/db/client';
import {
  groupMembers,
  scheduledInspectionOccurrences,
  templateSchedules,
} from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import type { Logger } from '@forma360/shared/logger';
import type { ConnectionOptions, Job } from 'bullmq';
import { and, eq, inArray } from 'drizzle-orm';
import { enqueue } from '../enqueue';
import { QUEUE_NAMES, type ScheduleMaterialisePayload } from '../queues';
import { occurrencesBetween } from './schedule-rrule';

/** 14-day forward look-ahead. */
export const MATERIALISE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export interface ScheduleMaterialiseDeps {
  db: Database;
  logger: Logger;
  connection: ConnectionOptions;
  /** Injected clock for tests. Defaults to Date.now(). */
  now?: () => Date;
}

async function resolveAssignees(
  db: Database,
  tenantId: string,
  directUserIds: readonly string[],
  groupIds: readonly string[],
): Promise<string[]> {
  const all = new Set<string>(directUserIds);
  if (groupIds.length > 0) {
    const rows = await db
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(
        and(eq(groupMembers.tenantId, tenantId), inArray(groupMembers.groupId, [...groupIds])),
      );
    for (const r of rows) all.add(r.userId);
  }
  return [...all];
}

export function createScheduleMaterialiseHandler(deps: ScheduleMaterialiseDeps) {
  const clock = deps.now ?? (() => new Date());

  return async function handleScheduleMaterialise(
    job: Job<ScheduleMaterialisePayload>,
  ): Promise<{ created: number }> {
    const { tenantId, scheduleId } = job.data;
    const log = deps.logger.child({
      job_id: job.id,
      queue: job.queueName,
      tenantId,
      scheduleId,
    });

    const schedRows = await deps.db
      .select()
      .from(templateSchedules)
      .where(
        and(eq(templateSchedules.tenantId, tenantId), eq(templateSchedules.id, scheduleId)),
      )
      .limit(1);
    const sched = schedRows[0];
    if (sched === undefined) {
      log.warn('[schedule-materialise] schedule not found');
      return { created: 0 };
    }
    if (sched.paused) {
      log.info('[schedule-materialise] paused — skipping');
      return { created: 0 };
    }

    const now = clock();
    const windowEnd = new Date(now.getTime() + MATERIALISE_WINDOW_MS);

    const fireTimes = occurrencesBetween({
      rrule: sched.rrule,
      startAt: sched.startAt,
      from: now,
      until: windowEnd,
      endAt: sched.endAt,
    });
    if (fireTimes.length === 0) {
      await deps.db
        .update(templateSchedules)
        .set({ lastMaterialisedAt: now, updatedAt: now })
        .where(eq(templateSchedules.id, sched.id));
      return { created: 0 };
    }

    const assignees = await resolveAssignees(
      deps.db,
      tenantId,
      sched.assigneeUserIds,
      sched.assigneeGroupIds,
    );
    if (assignees.length === 0) {
      log.warn('[schedule-materialise] schedule has no assignees');
      await deps.db
        .update(templateSchedules)
        .set({ lastMaterialisedAt: now, updatedAt: now })
        .where(eq(templateSchedules.id, sched.id));
      return { created: 0 };
    }

    // One occurrence per (assignee, fireTime). Optional per-site scoping
    // applies at a schedule level — if siteIds is non-empty we stamp the
    // first entry as the site binding. The PR 32 UI only permits one
    // site per schedule; the field is an array for forward-compat.
    const siteBinding = sched.siteIds[0] ?? null;

    let created = 0;
    // ON CONFLICT DO NOTHING gives us the idempotency we need for the
    // tick retries; we insert in small batches to stay friendly with the
    // bullmq lock renewal timer.
    for (const fireTime of fireTimes) {
      for (const userId of assignees) {
        const occurrenceId = newId();
        const inserted = await deps.db
          .insert(scheduledInspectionOccurrences)
          .values({
            id: occurrenceId,
            tenantId,
            scheduleId: sched.id,
            templateId: sched.templateId,
            occurrenceAt: fireTime,
            assigneeUserId: userId,
            siteId: siteBinding,
            inspectionId: null,
            status: 'pending',
            reminderSentAt: null,
          })
          .onConflictDoNothing()
          .returning({ id: scheduledInspectionOccurrences.id });
        const newRow = inserted[0];
        if (newRow === undefined) continue;
        created += 1;

        // Reminder scheduling — only if a reminder is configured AND the
        // reminder time is in the future but inside the look-ahead window.
        if (sched.reminderMinutesBefore !== null) {
          const reminderAt = new Date(
            fireTime.getTime() - sched.reminderMinutesBefore * 60 * 1000,
          );
          if (reminderAt > now && reminderAt <= windowEnd) {
            await enqueue(
              QUEUE_NAMES.SCHEDULE_REMINDER,
              { tenantId, occurrenceId: newRow.id },
              {
                connection: deps.connection,
                jobOptions: { delay: reminderAt.getTime() - now.getTime() },
              },
            );
          }
        }
      }
    }

    await deps.db
      .update(templateSchedules)
      .set({ lastMaterialisedAt: now, updatedAt: now })
      .where(eq(templateSchedules.id, sched.id));

    log.info({ created, fireTimes: fireTimes.length, assignees: assignees.length }, '[schedule-materialise] done');
    return { created };
  };
}
