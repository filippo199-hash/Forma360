/**
 * Handler for `forma360-ra-ack-reminder` (FreeHS module B1, feedback A-3).
 *
 * Runs daily. "Distribute" writes acknowledgement rows and sends one
 * notification email — this worker is the chase: anyone still pending gets
 * a reminder after a short grace period (sooner when their deadline is
 * close), then again on a weekly cadence, each send stamped on
 * `last_reminder_at` so a run never double-fires.
 */
import type { Database } from '@forma360/db/client';
import { riskAssessmentAcknowledgements, riskAssessments, user } from '@forma360/db/schema';
import type { Logger } from '@forma360/shared/logger';
import type { Job } from 'bullmq';
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';

export const RA_ACK_REMINDER_CRON = '30 8 * * *'; // 08:30 UTC daily
/** Days after distribution before the first chase. */
export const FIRST_REMINDER_GRACE_DAYS = 3;
/** Days between repeat chases. */
export const REPEAT_REMINDER_DAYS = 7;
/** A deadline within this many days skips the grace period. */
export const DUE_SOON_DAYS = 2;
/** Per-run send cap — a huge backlog drains over a few days instead of
 * hammering the email provider in one burst. */
export const MAX_REMINDERS_PER_RUN = 500;

export interface PendingAckReminder {
  assessmentId: string;
  userId: string;
  email: string;
  /** Recipient's preferred email language (PF-20). */
  locale?: string | null;
  userName: string;
  title: string;
  referenceNumber: string | null;
  distributedAt: Date;
  dueAt: Date | null;
}

const DAY_MS = 86_400_000;

/**
 * Pending acknowledgements on active assessments that are due a chase.
 * Pure — the handler and tests share it.
 */
export async function findDueAckReminders(
  db: Database,
  now: Date,
): Promise<PendingAckReminder[]> {
  const graceCutoff = new Date(now.getTime() - FIRST_REMINDER_GRACE_DAYS * DAY_MS);
  const repeatCutoff = new Date(now.getTime() - REPEAT_REMINDER_DAYS * DAY_MS);
  const dueSoonCutoff = new Date(now.getTime() + DUE_SOON_DAYS * DAY_MS);

  const rows = await db
    .select({
      assessmentId: riskAssessmentAcknowledgements.assessmentId,
      userId: riskAssessmentAcknowledgements.userId,
      distributedAt: riskAssessmentAcknowledgements.distributedAt,
      dueAt: riskAssessmentAcknowledgements.dueAt,
      email: user.email,
      locale: user.locale,
      userName: user.name,
      title: riskAssessments.title,
      referenceNumber: riskAssessments.referenceNumber,
    })
    .from(riskAssessmentAcknowledgements)
    .innerJoin(
      riskAssessments,
      eq(riskAssessments.id, riskAssessmentAcknowledgements.assessmentId),
    )
    .innerJoin(user, eq(user.id, riskAssessmentAcknowledgements.userId))
    .where(
      and(
        eq(riskAssessments.status, 'active'),
        isNull(riskAssessments.archivedAt),
        isNull(user.deactivatedAt),
        // Still pending: never acknowledged, or acknowledged an older version.
        or(
          isNull(riskAssessmentAcknowledgements.acknowledgedAt),
          sql`coalesce(${riskAssessmentAcknowledgements.acknowledgedVersion}, 0) < ${riskAssessmentAcknowledgements.versionNumber}`,
        ),
        // Chase cadence: first reminder after the grace period (or right
        // away when the deadline is close), repeats weekly.
        or(
          and(
            isNull(riskAssessmentAcknowledgements.lastReminderAt),
            or(
              lte(riskAssessmentAcknowledgements.distributedAt, graceCutoff),
              and(
                sql`${riskAssessmentAcknowledgements.dueAt} IS NOT NULL`,
                lte(riskAssessmentAcknowledgements.dueAt, dueSoonCutoff),
              ),
            ),
          ),
          lte(riskAssessmentAcknowledgements.lastReminderAt, repeatCutoff),
        ),
      ),
    )
    .limit(MAX_REMINDERS_PER_RUN);

  return rows.filter((r) => r.email.length > 0);
}

export interface RaAckReminderDeps {
  db: Database;
  logger: Logger;
  appUrl: string;
  /** Send one reminder. Injected so the worker uses templated email; tests fake it. */
  notify: (r: PendingAckReminder, viewUrl: string) => Promise<void>;
  /** Overridable clock for tests. */
  now?: () => Date;
}

/** Pure run: find pending acks due a chase, notify, stamp. Returns count sent. */
export async function runRaAckReminders(deps: RaAckReminderDeps): Promise<number> {
  const now = deps.now?.() ?? new Date();
  const due = await findDueAckReminders(deps.db, now);
  let sent = 0;
  for (const r of due) {
    const viewUrl = `${deps.appUrl}/en/risk-assessments/${r.assessmentId}`;
    try {
      await deps.notify(r, viewUrl);
      await deps.db
        .update(riskAssessmentAcknowledgements)
        .set({ lastReminderAt: now })
        .where(
          and(
            eq(riskAssessmentAcknowledgements.assessmentId, r.assessmentId),
            eq(riskAssessmentAcknowledgements.userId, r.userId),
          ),
        );
      sent += 1;
    } catch (err) {
      deps.logger.error(
        { err, assessmentId: r.assessmentId, userId: r.userId },
        '[ra-ack-reminder] notify failed',
      );
    }
  }
  deps.logger.info({ sent, considered: due.length }, '[ra-ack-reminder] done');
  return sent;
}

export function createRaAckReminderHandler(deps: RaAckReminderDeps) {
  return async function handler(_job: Job): Promise<{ sent: number }> {
    const sent = await runRaAckReminders(deps);
    return { sent };
  };
}
