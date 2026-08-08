/**
 * Handler for `forma360-incident-alert` (FreeHS module B5).
 *
 * Event-driven: the incidents router enqueues one job per incident that
 * needs the immediate fan-out (severity serious-or-above, or one of the
 * always-alert kinds — dangerous occurrence, sharps exposure, violence &
 * aggression). The worker:
 *   1. re-checks the routing predicate against the *current* row (a
 *      severity downgraded before the job ran means no alert);
 *   2. resolves recipients — every `incidents.manage` holder, narrowed
 *      to the incident's site team where `site_members` is curated
 *      (empty team / no site → tenant-wide holders);
 *   3. sends a **confidential-safe** email: reference, kind, severity,
 *      site — never the title, description or names;
 *   4. stamps `alert_sent_at` and appends the `alert_sent` event.
 *
 * Notify-then-stamp (IN-A1): the stamp is written only after at least
 * one delivery succeeded (or there was genuinely nobody to tell). Total
 * delivery failure leaves the stamp clear and THROWS so BullMQ retries
 * the job with backoff — the serious-incident fan-out is the one
 * notification that must never be lost to a transient mail outage.
 * `alert_sent_at` also dedupes re-enqueues (create + triage both fire).
 */
import type { Database } from '@forma360/db/client';
import { incidentEvents, incidents, siteMembers, sites } from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { appLink } from '@forma360/shared/app-link';
import type { Logger } from '@forma360/shared/logger';
import { needsImmediateAlert } from '@forma360/shared/incidents';
import { usersHoldingPermission, type PermissionHolder } from '@forma360/permissions/holders';
import type { Job } from 'bullmq';
import { incidentAlertPayloadSchema, type IncidentAlertPayload } from '../queues';
import { and, eq } from 'drizzle-orm';

export interface AlertIncident {
  incidentId: string;
  tenantId: string;
  referenceNumber: string;
  kind: string;
  severity: string;
  siteName: string | null;
  occurredAt: Date;
}

export interface IncidentAlertDeps {
  db: Database;
  logger: Logger;
  appUrl: string;
  notify: (recipient: PermissionHolder, incident: AlertIncident, viewUrl: string) => Promise<void>;
}

/**
 * Resolve the alert audience: `incidents.manage` holders, site-scoped
 * where the incident has a site with a curated team. An empty
 * intersection falls back to every holder — a mis-curated site must
 * never swallow a serious-incident alert.
 */
export async function resolveAlertRecipients(
  db: Database,
  tenantId: string,
  siteId: string | null,
): Promise<PermissionHolder[]> {
  const holders = await usersHoldingPermission(db, tenantId, 'incidents.manage');
  if (siteId === null || holders.length === 0) return holders;
  const members = await db
    .select({ userId: siteMembers.userId })
    .from(siteMembers)
    .where(and(eq(siteMembers.tenantId, tenantId), eq(siteMembers.siteId, siteId)));
  if (members.length === 0) return holders;
  const memberIds = new Set(members.map((m) => m.userId));
  const scoped = holders.filter((h) => memberIds.has(h.userId));
  return scoped.length > 0 ? scoped : holders;
}

/** Run one alert fan-out. Returns the number of recipients notified. */
export async function runIncidentAlert(
  deps: IncidentAlertDeps,
  payload: IncidentAlertPayload,
): Promise<{ notified: number }> {
  const rows = await deps.db
    .select({
      id: incidents.id,
      tenantId: incidents.tenantId,
      referenceNumber: incidents.referenceNumber,
      kind: incidents.kind,
      severity: incidents.severity,
      status: incidents.status,
      siteId: incidents.siteId,
      occurredAt: incidents.occurredAt,
      alertSentAt: incidents.alertSentAt,
      siteName: sites.name,
    })
    .from(incidents)
    .leftJoin(sites, eq(sites.id, incidents.siteId))
    .where(and(eq(incidents.tenantId, payload.tenantId), eq(incidents.id, payload.incidentId)))
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    deps.logger.warn({ payload }, '[incident-alert] incident not found');
    return { notified: 0 };
  }
  if (row.alertSentAt !== null || row.status === 'cancelled') {
    return { notified: 0 };
  }
  if (!needsImmediateAlert(row.kind, row.severity)) {
    return { notified: 0 };
  }

  const recipients = await resolveAlertRecipients(deps.db, row.tenantId, row.siteId);
  const incident: AlertIncident = {
    incidentId: row.id,
    tenantId: row.tenantId,
    referenceNumber: row.referenceNumber,
    kind: row.kind,
    severity: row.severity,
    siteName: row.siteName ?? null,
    occurredAt: row.occurredAt,
  };
  let notified = 0;
  let attempted = 0;
  for (const recipient of recipients) {
    if (recipient.email === '') continue;
    const viewUrl = appLink(deps.appUrl, recipient.locale, `/incidents/${row.id}`);
    attempted += 1;
    try {
      await deps.notify(recipient, incident, viewUrl);
      notified += 1;
    } catch (err) {
      deps.logger.warn(
        { err, incidentId: row.id, to: recipient.email },
        '[incident-alert] send failed',
      );
    }
  }

  // IN-A1 guard (same rule as the RIDDOR watch): zero deliveries while
  // there was someone to tell means the fan-out did NOT happen — leave
  // the stamp clear and throw so BullMQ retries with backoff. Partial
  // delivery stamps: someone was told, and a blanket re-send would
  // duplicate for the recipients that succeeded.
  if (attempted > 0 && notified === 0) {
    throw new Error(
      `[incident-alert] all ${String(attempted)} deliveries failed for incident ${row.id} — not stamping, job will retry`,
    );
  }

  // Notify-then-stamp; stamp at zero addressable recipients so an empty
  // holder list doesn't re-fire forever.
  const now = new Date();
  await deps.db
    .update(incidents)
    .set({ alertSentAt: now, updatedAt: now })
    .where(and(eq(incidents.tenantId, row.tenantId), eq(incidents.id, row.id)));
  await deps.db.insert(incidentEvents).values({
    id: newId(),
    tenantId: row.tenantId,
    incidentId: row.id,
    actorUserId: 'system',
    kind: 'alert_sent',
    detail: { notified },
  });
  return { notified };
}

export function createIncidentAlertHandler(deps: IncidentAlertDeps) {
  return async (job: Job): Promise<void> => {
    const payload = incidentAlertPayloadSchema.parse(job.data);
    const result = await runIncidentAlert(deps, payload);
    deps.logger.info({ ...payload, ...result }, '[incident-alert] done');
  };
}
