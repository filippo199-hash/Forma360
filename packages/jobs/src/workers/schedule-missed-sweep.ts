/**
 * Handler for `forma360-schedule-missed-sweep` (platform HSE review
 * PF-3): the occurrence status enum declared 'missed' and nothing in
 * the codebase ever wrote it — an undone weekly statutory inspection
 * sat "pending" forever with no flag anywhere. Hourly pass:
 *
 *   - pending occurrences whose time passed more than
 *     {MISSED_GRACE_HOURS} hours ago flip to 'missed';
 *   - each affected assignee gets ONE email listing what they missed
 *     (and the schedule's creator gets one covering their schedules,
 *     deduped when they're the same person).
 *
 * Stamping and notifying are separate concerns here: the status flip is
 * the record and must happen regardless; the email is best-effort.
 */
import type { Database } from '@forma360/db/client';
import {
  scheduledInspectionOccurrences,
  templateSchedules,
  templates,
  user,
} from '@forma360/db/schema';
import type { Logger } from '@forma360/shared/logger';
import type { Job } from 'bullmq';
import { and, eq, inArray, lte } from 'drizzle-orm';

export const SCHEDULE_MISSED_SWEEP_CRON = '20 * * * *'; // hourly at :20
export const MISSED_GRACE_HOURS = 24;
/** Per-run cap — a huge backlog drains across ticks. */
export const MAX_SWEEP_PER_RUN = 500;

export interface MissedOccurrence {
  occurrenceId: string;
  tenantId: string;
  occurrenceAt: Date;
  assigneeUserId: string;
  scheduleCreatedBy: string;
  templateName: string | null;
}

/** Pending occurrences past the grace window. Pure; shared with tests. */
export async function findNewlyMissed(db: Database, now: Date): Promise<MissedOccurrence[]> {
  const cutoff = new Date(now.getTime() - MISSED_GRACE_HOURS * 3_600_000);
  const rows = await db
    .select({
      occurrenceId: scheduledInspectionOccurrences.id,
      tenantId: scheduledInspectionOccurrences.tenantId,
      occurrenceAt: scheduledInspectionOccurrences.occurrenceAt,
      assigneeUserId: scheduledInspectionOccurrences.assigneeUserId,
      scheduleCreatedBy: templateSchedules.createdBy,
      templateName: templates.name,
    })
    .from(scheduledInspectionOccurrences)
    .innerJoin(
      templateSchedules,
      eq(templateSchedules.id, scheduledInspectionOccurrences.scheduleId),
    )
    .leftJoin(templates, eq(templates.id, scheduledInspectionOccurrences.templateId))
    .where(
      and(
        eq(scheduledInspectionOccurrences.status, 'pending'),
        lte(scheduledInspectionOccurrences.occurrenceAt, cutoff),
      ),
    )
    .limit(MAX_SWEEP_PER_RUN);
  return rows.flatMap((r) =>
    r.assigneeUserId === null ? [] : [{ ...r, assigneeUserId: r.assigneeUserId }],
  );
}

export interface ScheduleMissedSweepDeps {
  db: Database;
  logger: Logger;
  appUrl: string;
  notify: (
    recipient: { email: string; name: string },
    missed: MissedOccurrence[],
    viewUrl: string,
  ) => Promise<void>;
  now?: () => Date;
}

export async function runScheduleMissedSweep(
  deps: ScheduleMissedSweepDeps,
): Promise<{ swept: number; emails: number }> {
  const now = deps.now?.() ?? new Date();
  const missed = await findNewlyMissed(deps.db, now);
  if (missed.length === 0) return { swept: 0, emails: 0 };

  // The record first: flip every found occurrence to missed.
  await deps.db
    .update(scheduledInspectionOccurrences)
    .set({ status: 'missed' })
    .where(
      inArray(
        scheduledInspectionOccurrences.id,
        missed.map((m) => m.occurrenceId),
      ),
    );

  // One email per (tenant, person) — assignee and schedule owner both
  // learn; a Set dedupes when they're the same user.
  const byRecipient = new Map<string, MissedOccurrence[]>();
  for (const m of missed) {
    for (const userId of new Set([m.assigneeUserId, m.scheduleCreatedBy])) {
      const key = `${m.tenantId}:${userId}`;
      const bucket = byRecipient.get(key);
      if (bucket === undefined) byRecipient.set(key, [m]);
      else bucket.push(m);
    }
  }
  const userIds = [...new Set(missed.flatMap((m) => [m.assigneeUserId, m.scheduleCreatedBy]))];
  const userRows = await deps.db
    .select({
      id: user.id,
      tenantId: user.tenantId,
      name: user.name,
      email: user.email,
      deactivatedAt: user.deactivatedAt,
    })
    .from(user)
    .where(inArray(user.id, userIds));
  const usersById = new Map(userRows.map((u) => [`${u.tenantId}:${u.id}`, u]));

  let emails = 0;
  for (const [key, rows] of byRecipient) {
    const recipient = usersById.get(key);
    if (
      recipient === undefined ||
      recipient.deactivatedAt !== null ||
      recipient.email.length === 0
    ) {
      continue;
    }
    try {
      await deps.notify(
        { email: recipient.email, name: recipient.name },
        rows,
        `${deps.appUrl.replace(/\/+$/, '')}/en/schedules`,
      );
      emails += 1;
    } catch (err) {
      deps.logger.error({ err, recipient: key }, '[schedule-missed-sweep] notify failed');
    }
  }
  deps.logger.info({ swept: missed.length, emails }, '[schedule-missed-sweep] run complete');
  return { swept: missed.length, emails };
}

/** Plain-text block for the email body. */
export function missedLines(rows: MissedOccurrence[], cap = 10): string {
  const lines = rows.map(
    (m) =>
      `${m.templateName ?? 'Scheduled inspection'} — due ${m.occurrenceAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
  );
  const extra = lines.length - cap;
  const out = lines.slice(0, cap);
  if (extra > 0) out.push(`…and ${extra} more`);
  return out.join('\n');
}

export function createScheduleMissedSweepHandler(deps: ScheduleMissedSweepDeps) {
  return async (_job: Job): Promise<{ swept: number; emails: number }> => {
    return runScheduleMissedSweep(deps);
  };
}
