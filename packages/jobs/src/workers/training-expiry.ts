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
import { notifyInApp } from '@forma360/api/notify';
import { notificationEnabled } from '@forma360/shared/notification-catalogue';
import type { Logger } from '@forma360/shared/logger';
import type { Job } from 'bullmq';
import { and, eq, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

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
  /** Recipient's own locale, so the chase arrives in their language. */
  locale: string | null;
  /**
   * True when the holder has no account and the chase went to whoever
   * recorded the card instead — a contractor's operative cannot be
   * emailed, but the person responsible for their paperwork can.
   */
  viaRecorder: boolean;
  /** The platform user the chase is addressed to (holder or recorder). */
  recipientUserId: string;
  /** That recipient's channel toggles (settings → notifications). */
  notificationPrefs: Record<string, boolean>;
}

/**
 * Records entering their renewal window and not yet chased.
 *
 * The window is the requirement's `renewal_lead_days`, compared in SQL
 * against the record's own expiry, so each requirement chases on its own
 * schedule. Already-expired records are included — the chase matters most
 * once it has lapsed — but only until they are stamped.
 *
 * TR-A6: this used to INNER JOIN the user table, which silently excluded
 * every contractor's operative and agency worker — exactly the people
 * whose cards lapse most and who the matrix exists to cover. It is now a
 * LEFT JOIN, and an account-less holder's chase is addressed to the
 * person who recorded the card.
 *
 * Pure, so the handler and its tests share one definition of "due".
 */
export async function findDueTrainingReminders(
  db: Database,
  today: Date,
  limit: number,
): Promise<DueTrainingReminder[]> {
  const holder = alias(user, 'holder');
  const recorder = alias(user, 'recorder');
  const rows = await db
    .select({
      recordId: trainingRecords.id,
      tenantId: trainingRecords.tenantId,
      personName: trainingRecords.personName,
      expiresAt: trainingRecords.expiresAt,
      requirementName: trainingRequirements.name,
      holderId: holder.id,
      holderEmail: holder.email,
      holderLocale: holder.locale,
      holderPrefs: holder.notificationPrefs,
      holderDeactivatedAt: holder.deactivatedAt,
      recorderId: recorder.id,
      recorderEmail: recorder.email,
      recorderLocale: recorder.locale,
      recorderPrefs: recorder.notificationPrefs,
    })
    .from(trainingRecords)
    .innerJoin(trainingRequirements, eq(trainingRecords.requirementId, trainingRequirements.id))
    .leftJoin(holder, eq(trainingRecords.userId, holder.id))
    .leftJoin(recorder, eq(trainingRecords.recordedByUserId, recorder.id))
    .where(
      and(
        isNull(trainingRecords.reminderSentAt),
        isNull(trainingRecords.supersededAt),
        isNotNull(trainingRecords.expiresAt),
        isNull(trainingRequirements.archivedAt),
        // expiry <= today + the requirement's own lead time
        lte(
          trainingRecords.expiresAt,
          sql`(${today.toISOString().slice(0, 10)}::date + (${trainingRequirements.renewalLeadDays} || ' days')::interval)`,
        ),
      ),
    )
    .limit(limit);

  const due: DueTrainingReminder[] = [];
  for (const r of rows) {
    if (r.expiresAt === null) continue;
    // TR-B9: a deactivated holder is nobody's to chase — and that has to
    // mean SKIP, not "fall through to the recorder". The previous code did
    // the opposite of this comment, so for a month after someone left,
    // whoever recorded their tickets got a chase per lapsing card for a
    // person who no longer works there.
    if (r.holderDeactivatedAt !== null) continue;
    // The recorder fallback exists only for genuinely account-less people
    // (a contractor's operative), which is what TR-A6 asked for.
    const holderReachable = r.holderEmail !== null;
    const email = holderReachable ? r.holderEmail : r.recorderEmail;
    const recipientUserId = holderReachable ? r.holderId : r.recorderId;
    if (email === null || email === undefined) continue;
    // An email always comes off a joined user row, so the id rides along.
    if (recipientUserId === null) continue;
    due.push({
      recordId: r.recordId,
      tenantId: r.tenantId,
      personName: r.personName,
      requirementName: r.requirementName,
      email,
      expiresOn: r.expiresAt.toISOString().slice(0, 10),
      locale: (holderReachable ? r.holderLocale : r.recorderLocale) ?? null,
      viaRecorder: !holderReachable,
      recipientUserId,
      notificationPrefs: (holderReachable ? r.holderPrefs : r.recorderPrefs) ?? {},
    });
  }
  return due;
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
    // The recorder variant is its own kind: a manager chasing someone
    // else's card mutes it independently of their own expiring tickets.
    const kind = r.viaRecorder ? 'training_expiry_recorder' : 'training_expiry';
    const stamp = () =>
      deps.db
        .update(trainingRecords)
        .set({ reminderSentAt: today })
        .where(eq(trainingRecords.id, r.recordId));
    // Each channel is muteable on its own (settings → notifications);
    // notifyInApp checks the inapp pref itself.
    await notifyInApp(
      deps.db,
      {
        tenantId: r.tenantId,
        userId: r.recipientUserId,
        kind,
        title: r.viaRecorder
          ? `${r.personName}: ${r.requirementName} expires ${r.expiresOn}`
          : `${r.requirementName} expires ${r.expiresOn}`,
        href: '/training',
      },
      r.notificationPrefs,
    );
    if (!notificationEnabled(r.notificationPrefs, kind, 'email')) {
      // A muted email is handled, not failed — stamp, or the record would
      // be re-chased (and re-belled) on every daily tick.
      await stamp();
      continue;
    }
    try {
      // TR-A9: the link lands in the recipient's own locale, not a
      // hardcoded /en/ that throws away five shipped translations.
      await deps.notify(r, `${deps.appUrl}/${r.locale ?? 'en'}/training`);
      await stamp();
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
