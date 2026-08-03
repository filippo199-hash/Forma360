/**
 * Handler for `forma360-incident-riddor-watch` (FreeHS module B5).
 *
 * Runs every 15 minutes over every incident whose RIDDOR clock is
 * running (reportable determination, no submission record yet):
 *   - T-5 days  → first warning, stamped on `riddor_warning5_sent_at`
 *   - T-2 days  → second warning, stamped on `riddor_warning2_sent_at`
 *   - past the deadline → escalation, stamped on `riddor_escalated_at`
 *
 * Recipients: the incident owner (lead investigator, else the reporter)
 * plus every `incidents.manage` holder, deduped. Content is
 * confidential-safe (reference, category, deadline — no title).
 *
 * **Notify-then-stamp** (the PF-1 lesson): the stamp is written only
 * after at least one send succeeded, so a failed delivery retries next
 * tick instead of going silent. Re-screening clears all three stamps so
 * a fresh determination restarts the ladder.
 */
import type { Database } from '@forma360/db/client';
import { incidentEvents, incidents, user } from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import type { Logger } from '@forma360/shared/logger';
import { usersHoldingPermission, type PermissionHolder } from '@forma360/permissions/holders';
import type { Job } from 'bullmq';
import { and, eq, gt, isNotNull, isNull, lte, ne, sql } from 'drizzle-orm';

export const INCIDENT_RIDDOR_WATCH_CRON = '*/15 * * * *'; // every 15 minutes
/** Per-run cap per bucket — a backlog drains across ticks, not one burst. */
export const MAX_NOTIFICATIONS_PER_RUN = 200;

const DAY_MS = 86_400_000;

export type RiddorWatchKind = 'warning5' | 'warning2' | 'escalation';

export interface RiddorWatchIncident {
  incidentId: string;
  tenantId: string;
  referenceNumber: string;
  riddorCategory: string;
  riddorDeadlineAt: Date;
  leadInvestigatorUserId: string | null;
  reportedByUserId: string;
}

const watchColumns = {
  incidentId: incidents.id,
  tenantId: incidents.tenantId,
  referenceNumber: incidents.referenceNumber,
  riddorCategory: incidents.riddorCategory,
  riddorDeadlineAt: incidents.riddorDeadlineAt,
  leadInvestigatorUserId: incidents.leadInvestigatorUserId,
  reportedByUserId: incidents.reportedByUserId,
} as const;

function clockRunning() {
  return and(
    isNotNull(incidents.riddorCategory),
    ne(sql`${incidents.riddorCategory}`, 'not_reportable'),
    isNull(incidents.riddorSubmittedAt),
    isNotNull(incidents.riddorDeadlineAt),
    ne(incidents.status, 'cancelled'),
  );
}

function mapRows(
  rows: Array<{
    incidentId: string;
    tenantId: string;
    referenceNumber: string;
    riddorCategory: string | null;
    riddorDeadlineAt: Date | null;
    leadInvestigatorUserId: string | null;
    reportedByUserId: string;
  }>,
): RiddorWatchIncident[] {
  return rows.flatMap((r) =>
    r.riddorCategory === null || r.riddorDeadlineAt === null
      ? []
      : [{ ...r, riddorCategory: r.riddorCategory, riddorDeadlineAt: r.riddorDeadlineAt }],
  );
}

/** Deadline within (now, now+5d], first warning not yet sent. Pure. */
export async function findWarning5Due(db: Database, now: Date): Promise<RiddorWatchIncident[]> {
  const rows = await db
    .select(watchColumns)
    .from(incidents)
    .where(
      and(
        clockRunning(),
        gt(incidents.riddorDeadlineAt, now),
        lte(incidents.riddorDeadlineAt, new Date(now.getTime() + 5 * DAY_MS)),
        isNull(incidents.riddorWarning5SentAt),
      ),
    )
    .limit(MAX_NOTIFICATIONS_PER_RUN);
  return mapRows(rows);
}

/** Deadline within (now, now+2d], second warning not yet sent. Pure. */
export async function findWarning2Due(db: Database, now: Date): Promise<RiddorWatchIncident[]> {
  const rows = await db
    .select(watchColumns)
    .from(incidents)
    .where(
      and(
        clockRunning(),
        gt(incidents.riddorDeadlineAt, now),
        lte(incidents.riddorDeadlineAt, new Date(now.getTime() + 2 * DAY_MS)),
        isNull(incidents.riddorWarning2SentAt),
      ),
    )
    .limit(MAX_NOTIFICATIONS_PER_RUN);
  return mapRows(rows);
}

/** Deadline passed, not yet escalated. Pure. */
export async function findEscalationsDue(db: Database, now: Date): Promise<RiddorWatchIncident[]> {
  const rows = await db
    .select(watchColumns)
    .from(incidents)
    .where(
      and(
        clockRunning(),
        lte(incidents.riddorDeadlineAt, now),
        isNull(incidents.riddorEscalatedAt),
      ),
    )
    .limit(MAX_NOTIFICATIONS_PER_RUN);
  return mapRows(rows);
}

/** Owner (lead ?? reporter, if active) + manage holders, deduped by user id. */
export async function resolveRiddorRecipients(
  db: Database,
  incident: RiddorWatchIncident,
): Promise<PermissionHolder[]> {
  const holders = await usersHoldingPermission(db, incident.tenantId, 'incidents.manage');
  const ownerId = incident.leadInvestigatorUserId ?? incident.reportedByUserId;
  const out = new Map<string, PermissionHolder>(holders.map((h) => [h.userId, h]));
  if (!out.has(ownerId)) {
    const rows = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        deactivatedAt: user.deactivatedAt,
      })
      .from(user)
      .where(and(eq(user.tenantId, incident.tenantId), eq(user.id, ownerId)))
      .limit(1);
    const owner = rows[0];
    if (owner !== undefined && owner.deactivatedAt === null && owner.email !== '') {
      out.set(owner.id, { userId: owner.id, name: owner.name, email: owner.email });
    }
  }
  return [...out.values()];
}

export interface RiddorWatchDeps {
  db: Database;
  logger: Logger;
  appUrl: string;
  notify: (
    kind: RiddorWatchKind,
    incident: RiddorWatchIncident,
    recipient: PermissionHolder,
    viewUrl: string,
  ) => Promise<void>;
}

const STAMP_COLUMN: Record<
  RiddorWatchKind,
  'riddorWarning5SentAt' | 'riddorWarning2SentAt' | 'riddorEscalatedAt'
> = {
  warning5: 'riddorWarning5SentAt',
  warning2: 'riddorWarning2SentAt',
  escalation: 'riddorEscalatedAt',
};

async function processBucket(
  deps: RiddorWatchDeps,
  kind: RiddorWatchKind,
  due: RiddorWatchIncident[],
): Promise<number> {
  let processed = 0;
  for (const incident of due) {
    const recipients = await resolveRiddorRecipients(deps.db, incident);
    const viewUrl = `${deps.appUrl}/en/incidents/${incident.incidentId}`;
    let delivered = 0;
    for (const recipient of recipients) {
      try {
        await deps.notify(kind, incident, recipient, viewUrl);
        delivered += 1;
      } catch (err) {
        deps.logger.warn(
          { err, incidentId: incident.incidentId, to: recipient.email, kind },
          '[incident-riddor-watch] send failed',
        );
      }
    }
    // Notify-then-stamp: with zero deliveries (every send failed AND
    // there was someone to tell) leave the stamp clear so the next tick
    // retries. An empty recipient list still stamps — nothing to retry.
    if (delivered === 0 && recipients.length > 0) continue;
    const now = new Date();
    await deps.db
      .update(incidents)
      .set({ [STAMP_COLUMN[kind]]: now, updatedAt: now })
      .where(and(eq(incidents.tenantId, incident.tenantId), eq(incidents.id, incident.incidentId)));
    await deps.db.insert(incidentEvents).values({
      id: newId(),
      tenantId: incident.tenantId,
      incidentId: incident.incidentId,
      actorUserId: 'system',
      kind: kind === 'escalation' ? 'riddor_escalated' : 'riddor_warning_sent',
      detail: { kind, delivered },
    });
    processed += 1;
  }
  return processed;
}

/** One watch tick. Escalations run first — they are the most urgent. */
export async function runIncidentRiddorWatch(
  deps: RiddorWatchDeps,
  now: Date = new Date(),
): Promise<{ warned5: number; warned2: number; escalated: number }> {
  const escalated = await processBucket(deps, 'escalation', await findEscalationsDue(deps.db, now));
  const warned2 = await processBucket(deps, 'warning2', await findWarning2Due(deps.db, now));
  // Skip the 5-day warning for rows the 2-day pass just handled.
  const warned5 = await processBucket(
    deps,
    'warning5',
    (await findWarning5Due(deps.db, now)).filter(
      (i) => i.riddorDeadlineAt.getTime() > now.getTime() + 2 * DAY_MS,
    ),
  );
  return { warned5, warned2, escalated };
}

export function createIncidentRiddorWatchHandler(deps: RiddorWatchDeps) {
  return async (_job: Job): Promise<void> => {
    const result = await runIncidentRiddorWatch(deps);
    if (result.warned5 + result.warned2 + result.escalated > 0) {
      deps.logger.info(result, '[incident-riddor-watch] tick complete');
    }
  };
}
