/**
 * Handler for `forma360-incident-chase` (FreeHS module B5).
 *
 * Daily digest (06:30 UTC) chasing the three ways an incident quietly
 * stalls:
 *   - investigations idle: a draft / submitted investigation untouched
 *     for more than `INVESTIGATION_IDLE_CHASE_DAYS` on an incident still
 *     in `investigating`;
 *   - incidents in `actions_outstanding` with at least one linked action
 *     past its due date and not terminal;
 *   - effectiveness reviews past due on closed incidents.
 *
 * One email per owner (lead investigator, else reporter; the closer for
 * effectiveness reviews), listing that owner's items. Quiet when clean —
 * the fire-due-digest shape. No dedup stamp: a failed send is repeated
 * by tomorrow's run anyway (self-healing, like fire-due-digest).
 */
import type { Database } from '@forma360/db/client';
import { actions, incidentInvestigations, incidents, user } from '@forma360/db/schema';
import type { Logger } from '@forma360/shared/logger';
import { INVESTIGATION_IDLE_CHASE_DAYS } from '@forma360/shared/incidents';
import type { Job } from 'bullmq';
import { and, eq, inArray, isNull, lt, lte } from 'drizzle-orm';

export const INCIDENT_CHASE_CRON = '30 6 * * *'; // daily, 06:30 UTC

const DAY_MS = 86_400_000;

export interface IncidentChaseDigest {
  tenantId: string;
  ownerUserId: string;
  /** "IN-000123 — investigation idle 21 days" style lines. */
  idleInvestigations: string[];
  overdueActionIncidents: string[];
  effectivenessDue: string[];
}

function hasContent(digest: IncidentChaseDigest): boolean {
  return (
    digest.idleInvestigations.length > 0 ||
    digest.overdueActionIncidents.length > 0 ||
    digest.effectivenessDue.length > 0
  );
}

/**
 * Collect every owner's chase items across all tenants. Pure — the
 * handler and tests share it.
 */
export async function collectIncidentChase(
  db: Database,
  now: Date,
): Promise<IncidentChaseDigest[]> {
  const idleCutoff = new Date(now.getTime() - INVESTIGATION_IDLE_CHASE_DAYS * DAY_MS);

  const [idleRows, outstandingRows, effectivenessRows] = await Promise.all([
    db
      .select({
        tenantId: incidents.tenantId,
        referenceNumber: incidents.referenceNumber,
        leadInvestigatorUserId: incidents.leadInvestigatorUserId,
        reportedByUserId: incidents.reportedByUserId,
        updatedAt: incidentInvestigations.updatedAt,
      })
      .from(incidentInvestigations)
      .innerJoin(incidents, eq(incidents.id, incidentInvestigations.incidentId))
      .where(
        and(
          inArray(incidentInvestigations.status, ['draft', 'submitted']),
          lte(incidentInvestigations.updatedAt, idleCutoff),
          eq(incidents.status, 'investigating'),
        ),
      ),
    db
      .select({
        id: incidents.id,
        tenantId: incidents.tenantId,
        referenceNumber: incidents.referenceNumber,
        leadInvestigatorUserId: incidents.leadInvestigatorUserId,
        reportedByUserId: incidents.reportedByUserId,
      })
      .from(incidents)
      .where(eq(incidents.status, 'actions_outstanding')),
    db
      .select({
        tenantId: incidents.tenantId,
        referenceNumber: incidents.referenceNumber,
        closedByUserId: incidents.closedByUserId,
        leadInvestigatorUserId: incidents.leadInvestigatorUserId,
        reportedByUserId: incidents.reportedByUserId,
        effectivenessDueAt: incidents.effectivenessDueAt,
      })
      .from(incidents)
      .where(
        and(
          eq(incidents.status, 'closed'),
          isNull(incidents.effectivenessVerdict),
          lte(incidents.effectivenessDueAt, now),
        ),
      ),
  ]);

  // Which actions_outstanding incidents actually have an overdue action?
  const outstandingIds = outstandingRows.map((r) => r.id);
  const overdueSet = new Set<string>();
  if (outstandingIds.length > 0) {
    const overdue = await db
      .select({ sourceId: actions.sourceId })
      .from(actions)
      .where(
        and(
          eq(actions.sourceType, 'incident'),
          inArray(actions.sourceId, outstandingIds),
          inArray(actions.status, ['open', 'in_progress']),
          lt(actions.dueAt, now),
        ),
      );
    for (const row of overdue) {
      if (row.sourceId !== null) overdueSet.add(row.sourceId);
    }
  }

  const digests = new Map<string, IncidentChaseDigest>();
  const forOwner = (tenantId: string, ownerUserId: string): IncidentChaseDigest => {
    const key = `${tenantId}:${ownerUserId}`;
    let digest = digests.get(key);
    if (digest === undefined) {
      digest = {
        tenantId,
        ownerUserId,
        idleInvestigations: [],
        overdueActionIncidents: [],
        effectivenessDue: [],
      };
      digests.set(key, digest);
    }
    return digest;
  };

  for (const row of idleRows) {
    const owner = row.leadInvestigatorUserId ?? row.reportedByUserId;
    const idleDays = Math.floor((now.getTime() - row.updatedAt.getTime()) / DAY_MS);
    forOwner(row.tenantId, owner).idleInvestigations.push(
      `${row.referenceNumber} — investigation idle ${idleDays} days`,
    );
  }
  for (const row of outstandingRows) {
    if (!overdueSet.has(row.id)) continue;
    const owner = row.leadInvestigatorUserId ?? row.reportedByUserId;
    forOwner(row.tenantId, owner).overdueActionIncidents.push(
      `${row.referenceNumber} — corrective actions overdue`,
    );
  }
  for (const row of effectivenessRows) {
    const owner = row.closedByUserId ?? row.leadInvestigatorUserId ?? row.reportedByUserId;
    forOwner(row.tenantId, owner).effectivenessDue.push(
      `${row.referenceNumber} — effectiveness review due`,
    );
  }

  return [...digests.values()].filter(hasContent);
}

/** Render the digest body lines, capped for email sanity. */
export function chaseDetailLines(digest: IncidentChaseDigest, cap = 15): string {
  const lines = [
    ...digest.idleInvestigations,
    ...digest.overdueActionIncidents,
    ...digest.effectivenessDue,
  ];
  const shown = lines.slice(0, cap);
  if (lines.length > shown.length) {
    shown.push(`…and ${lines.length - shown.length} more`);
  }
  return shown.join('\n');
}

export interface IncidentChaseDeps {
  db: Database;
  logger: Logger;
  appUrl: string;
  notify: (
    recipient: { userId: string; name: string; email: string },
    digest: IncidentChaseDigest,
    viewUrl: string,
  ) => Promise<void>;
}

/** One chase run. Returns the number of digests sent. */
export async function runIncidentChase(
  deps: IncidentChaseDeps,
  now: Date = new Date(),
): Promise<{ sent: number }> {
  const digests = await collectIncidentChase(deps.db, now);
  let sent = 0;
  for (const digest of digests) {
    const rows = await deps.db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        deactivatedAt: user.deactivatedAt,
      })
      .from(user)
      .where(and(eq(user.tenantId, digest.tenantId), eq(user.id, digest.ownerUserId)))
      .limit(1);
    const owner = rows[0];
    if (owner === undefined || owner.deactivatedAt !== null || owner.email === '') continue;
    try {
      await deps.notify(
        { userId: owner.id, name: owner.name, email: owner.email },
        digest,
        `${deps.appUrl}/en/incidents`,
      );
      sent += 1;
    } catch (err) {
      deps.logger.warn(
        { err, ownerUserId: digest.ownerUserId, tenantId: digest.tenantId },
        '[incident-chase] send failed — tomorrow repeats',
      );
    }
  }
  return { sent };
}

export function createIncidentChaseHandler(deps: IncidentChaseDeps) {
  return async (_job: Job): Promise<void> => {
    const result = await runIncidentChase(deps);
    if (result.sent > 0) {
      deps.logger.info(result, '[incident-chase] digests sent');
    }
  };
}
