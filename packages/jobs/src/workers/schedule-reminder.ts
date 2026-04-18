/**
 * Handler for `forma360:schedule-reminder` (Phase 2 PR 32).
 *
 * For one occurrence:
 *   1. Load the occurrence + its assignee email.
 *   2. Skip if the occurrence is already started (inspectionId set),
 *      cancelled (row gone), or already reminded (reminderSentAt set).
 *   3. Send a `schedule-reminder` email via the injected `sendEmail`.
 *   4. Stamp `reminderSentAt` so retries do not double-send.
 */
import type { Database } from '@forma360/db/client';
import {
  scheduledInspectionOccurrences,
  user as userTable,
} from '@forma360/db/schema';
import type { SendEmail } from '@forma360/shared/email';
import type { Logger } from '@forma360/shared/logger';
import type { Job } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import type { ScheduleReminderPayload } from '../queues';

export interface ScheduleReminderDeps {
  db: Database;
  logger: Logger;
  sendEmail: SendEmail;
  /** Base app URL used to compose the CTA link. */
  appUrl: string;
}

export function createScheduleReminderHandler(deps: ScheduleReminderDeps) {
  return async function handleScheduleReminder(
    job: Job<ScheduleReminderPayload>,
  ): Promise<{ sent: boolean }> {
    const { tenantId, occurrenceId } = job.data;
    const log = deps.logger.child({
      job_id: job.id,
      queue: job.queueName,
      tenantId,
      occurrenceId,
    });

    const rows = await deps.db
      .select()
      .from(scheduledInspectionOccurrences)
      .where(
        and(
          eq(scheduledInspectionOccurrences.tenantId, tenantId),
          eq(scheduledInspectionOccurrences.id, occurrenceId),
        ),
      )
      .limit(1);
    const occ = rows[0];
    if (occ === undefined) {
      log.info('[schedule-reminder] occurrence gone — skipping');
      return { sent: false };
    }
    if (occ.reminderSentAt !== null) {
      log.info('[schedule-reminder] already sent');
      return { sent: false };
    }
    if (occ.inspectionId !== null) {
      log.info('[schedule-reminder] already started — skipping');
      return { sent: false };
    }
    if (occ.assigneeUserId === null) {
      log.warn('[schedule-reminder] occurrence has no assignee');
      return { sent: false };
    }

    const userRows = await deps.db
      .select({ id: userTable.id, email: userTable.email })
      .from(userTable)
      .where(and(eq(userTable.id, occ.assigneeUserId), eq(userTable.tenantId, tenantId)))
      .limit(1);
    const assignee = userRows[0];
    if (assignee === undefined) {
      log.warn('[schedule-reminder] assignee user missing');
      return { sent: false };
    }

    const url = `${deps.appUrl.replace(/\/$/, '')}/inspections?upcoming=${occurrenceId}`;
    await deps.sendEmail({
      to: assignee.email,
      kind: 'schedule-reminder',
      url,
      userId: assignee.id,
    });

    await deps.db
      .update(scheduledInspectionOccurrences)
      .set({ reminderSentAt: new Date() })
      .where(eq(scheduledInspectionOccurrences.id, occurrenceId));

    log.info({ to: assignee.email }, '[schedule-reminder] sent');
    return { sent: true };
  };
}
