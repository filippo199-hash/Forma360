/**
 * Handler for `forma360-training-expiry` (FreeHS module B7).
 *
 * Runs daily. Finds every training record whose expiry falls inside its
 * requirement's own renewal lead time, that has not been chased yet, and
 * whose holder has an email — then sends one reminder and stamps
 * `reminder_sent_at` so it never fires twice for the same record.
 *
 * The discipline is copied from the four reminder workers that came
 * before it (`ra-ack-reminder`, `permit-expiry-watch`, `fire-due-digest`,
 * `contractor-doc-reminder`):
 *   - **dedup** on a stamped column, never on "did we send today";
 *   - **per-run cap**, so one neglected tenant cannot spend the whole
 *     mail budget in a single tick;
 *   - **quiet when clean** — no rows due means no output, because a
 *     digest that arrives saying "nothing to do" trains people to filter
 *     the sender.
 *
 * Lead time is per requirement, not global: a CSCS card needs chasing
 * months out, a toolbox talk does not.
 */
import type { Database } from '@forma360/db/client';
import { trainingRecords, trainingRequirements, user } from '@forma360/db/schema';
import type { Logger } from '@forma360/shared/logger';
import type { Job } from 'bullmq';
import { and, eq, isNotNull, isNull, lte, sql } from 'drizzle-orm';

export const TRAINING_EXPIRY_CRON = '0 7 * * *'; // 07:00 UTC daily

/** Most reminders one tick will send, across all tenants. */
export const MAX_REMINDERS_PER_RUN = 500;

export interface DueTrainingReminder {
  recordId: string;
  tenantId: string;
  personName: string;
  requirementName: string;
  email: string;
  expiresOn: string;
}

/**
 * Records entering their renewal window and not yet chased.
 *
 * The window is the requirement's `renewal_lead_days`, compared in SQL
 * against the record's own expiry, so each requirement chases on its own
 * schedule. Already-expired records are included — the chase matters most
 * once it has lapsed — but only until they are stamped.
 *
 * Pure, so the handler and its tests share one definition of "due".
 */
export async function findDueTrainingReminders(
  db: Database,
  today: Date,
  limit: number,
): Promise<DueTrainingReminder[]> {
  const rows = await db
    .select({
      recordId: trainingRecords.id,
      tenantId: trainingRecords.tenantId,
      personName: trainingRecords.personName,
      expiresAt: trainingRecords.expiresAt,
      requirementName: trainingRequirements.name,
      email: user.email,
    })
    .from(trainingRecords)
    .innerJoin(trainingRequirements, eq(trainingRecords.requirementId, trainingRequirements.id))
    .innerJoin(user, eq(trainingRecords.userId, user.id))
    .where(
      and(
        isNull(trainingRecords.reminderSentAt),
        isNull(trainingRecords.supersededAt),
        isNotNull(trainingRecords.expiresAt),
        isNull(trainingRequirements.archivedAt),
        isNull(user.deactivatedAt),
        // expiry <= today + the requirement's own lead time
        lte(
          trainingRecords.expiresAt,
          sql`(${today.toISOString().slice(0, 10)}::date + (${trainingRequirements.renewalLeadDays} || ' days')::interval)`,
        ),
      ),
    )
    .limit(limit);

  return rows
    .filter((r): r is typeof r & { expiresAt: Date } => r.expiresAt !== null)
    .map((r) => ({
      recordId: r.recordId,
      tenantId: r.tenantId,
      personName: r.personName,
      requirementName: r.requirementName,
      email: r.email,
      expiresOn: r.expiresAt.toISOString().slice(0, 10),
    }));
}

export interface TrainingExpiryDeps {
  db: Database;
  logger: Logger;
  appUrl: string;
  /** Send one reminder. Injected so the worker uses templated email; tests fake it. */
  notify: (r: DueTrainingReminder, url: string) => Promise<void>;
  /** Overridable clock for tests. */
  now?: () => Date;
}

/** Find, notify, stamp. Returns the count sent. */
export async function runTrainingExpiryReminders(deps: TrainingExpiryDeps): Promise<number> {
  const today = deps.now?.() ?? new Date();
  const due = await findDueTrainingReminders(deps.db, today, MAX_REMINDERS_PER_RUN);
  // Quiet when clean: no log line at all on an empty run.
  if (due.length === 0) return 0;

  let sent = 0;
  for (const r of due) {
    try {
      await deps.notify(r, `${deps.appUrl}/en/training`);
      await deps.db
        .update(trainingRecords)
        .set({ reminderSentAt: today })
        .where(eq(trainingRecords.id, r.recordId));
      sent += 1;
    } catch (err) {
      deps.logger.error({ err, recordId: r.recordId }, '[training-expiry] notify failed');
    }
  }
  deps.logger.info({ sent, considered: due.length }, '[training-expiry] done');
  return sent;
}

export function createTrainingExpiryHandler(deps: TrainingExpiryDeps) {
  return async function handler(_job: Job): Promise<{ sent: number }> {
    const sent = await runTrainingExpiryReminders(deps);
    return { sent };
  };
}
