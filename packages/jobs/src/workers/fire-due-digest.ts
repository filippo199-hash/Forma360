/**
 * Handler for `forma360-fire-due-digest` (FreeHS module B4, HSE review
 * FS-3): the statutory fire-safety calendar must not depend on someone
 * opening the app. Once a day, every tenant with anything red or amber
 * on the calendar gets one digest email to each `fireSafety.manage`
 * holder:
 *
 *   - FAILED checks and door inspections (FS-1 states awaiting re-test)
 *   - overdue and due-soon logbook checks
 *   - overdue fire-door inspections
 *   - FRA reviews past their date
 *   - PEEP reviews due and marshal training expiring
 *
 * Tenants with a clean calendar get nothing — a digest that always
 * arrives trains people to delete it.
 */
import type { Database } from '@forma360/db/client';
import {
  fireBuildings,
  fireDoors,
  fireLogbookChecks,
  fireMarshals,
  firePeeps,
  fireRiskAssessments,
} from '@forma360/db/schema';
import type { Logger } from '@forma360/shared/logger';
import {
  checkDisplayStatus,
  doorDisplayStatus,
  doorInspectionIntervalMonths,
  marshalTrainingStatus,
} from '@forma360/shared/fire-safety';
import { usersHoldingPermission } from '@forma360/permissions/holders';
import type { Job } from 'bullmq';
import { and, eq, isNull, lte } from 'drizzle-orm';

export const FIRE_DUE_DIGEST_CRON = '0 6 * * *'; // daily, 06:00 UTC

export interface FireDigestLine {
  buildingName: string;
  label: string;
}

export interface FireDigest {
  tenantId: string;
  failedChecks: FireDigestLine[];
  overdueChecks: FireDigestLine[];
  dueSoonChecks: FireDigestLine[];
  failedDoors: FireDigestLine[];
  overdueDoors: FireDigestLine[];
  fraReviewsDue: Array<{ referenceNumber: string | null; title: string }>;
  peepReviewsDue: number;
  marshalsExpiring: number;
}

function hasContent(d: FireDigest): boolean {
  return (
    d.failedChecks.length > 0 ||
    d.overdueChecks.length > 0 ||
    d.dueSoonChecks.length > 0 ||
    d.failedDoors.length > 0 ||
    d.overdueDoors.length > 0 ||
    d.fraReviewsDue.length > 0 ||
    d.peepReviewsDue > 0 ||
    d.marshalsExpiring > 0
  );
}

function checkLabel(checkType: string): string {
  return checkType.replace(/_/g, ' ');
}

/**
 * One pass over every tenant's fire calendar. Pure — the handler and the
 * tests share it. Only tenants with at least one line are returned.
 */
export async function collectFireDigests(db: Database, now: Date): Promise<FireDigest[]> {
  const [checkRows, doorRows, fraRows, peepRows, marshalRows] = await Promise.all([
    db
      .select({
        tenantId: fireLogbookChecks.tenantId,
        checkType: fireLogbookChecks.checkType,
        frequency: fireLogbookChecks.frequency,
        lastResult: fireLogbookChecks.lastResult,
        nextDueAt: fireLogbookChecks.nextDueAt,
        buildingName: fireBuildings.name,
      })
      .from(fireLogbookChecks)
      .innerJoin(fireBuildings, eq(fireLogbookChecks.buildingId, fireBuildings.id))
      .where(and(eq(fireLogbookChecks.active, true), eq(fireBuildings.status, 'active'))),
    db
      .select({
        tenantId: fireDoors.tenantId,
        doorRef: fireDoors.doorRef,
        locationKind: fireDoors.locationKind,
        override: fireDoors.inspectionIntervalMonthsOverride,
        lastOutcome: fireDoors.lastOutcome,
        nextInspectionDueAt: fireDoors.nextInspectionDueAt,
        buildingName: fireBuildings.name,
        isResidential: fireBuildings.isResidential,
        heightMetres: fireBuildings.heightMetres,
        storeys: fireBuildings.storeys,
        hasFireAlarm: fireBuildings.hasFireAlarm,
        hasEmergencyLighting: fireBuildings.hasEmergencyLighting,
        hasSprinklers: fireBuildings.hasSprinklers,
        hasDampers: fireBuildings.hasDampers,
        hasRisers: fireBuildings.hasRisers,
      })
      .from(fireDoors)
      .innerJoin(fireBuildings, eq(fireDoors.buildingId, fireBuildings.id))
      .where(and(eq(fireDoors.status, 'active'), eq(fireBuildings.status, 'active'))),
    db
      .select({
        tenantId: fireRiskAssessments.tenantId,
        referenceNumber: fireRiskAssessments.referenceNumber,
        title: fireRiskAssessments.title,
      })
      .from(fireRiskAssessments)
      .where(
        and(eq(fireRiskAssessments.status, 'active'), lte(fireRiskAssessments.nextReviewAt, now)),
      ),
    db
      .select({ tenantId: firePeeps.tenantId })
      .from(firePeeps)
      .where(and(isNull(firePeeps.endedAt), lte(firePeeps.nextReviewAt, now))),
    db
      .select({
        tenantId: fireMarshals.tenantId,
        trainedAt: fireMarshals.trainedAt,
        trainingExpiresAt: fireMarshals.trainingExpiresAt,
      })
      .from(fireMarshals)
      .where(isNull(fireMarshals.endedAt)),
  ]);

  const digests = new Map<string, FireDigest>();
  const forTenant = (tenantId: string): FireDigest => {
    let d = digests.get(tenantId);
    if (d === undefined) {
      d = {
        tenantId,
        failedChecks: [],
        overdueChecks: [],
        dueSoonChecks: [],
        failedDoors: [],
        overdueDoors: [],
        fraReviewsDue: [],
        peepReviewsDue: 0,
        marshalsExpiring: 0,
      };
      digests.set(tenantId, d);
    }
    return d;
  };

  for (const row of checkRows) {
    const status = checkDisplayStatus(row.nextDueAt, row.frequency, row.lastResult, now);
    if (status === 'ok') continue;
    const line = { buildingName: row.buildingName, label: checkLabel(row.checkType) };
    const d = forTenant(row.tenantId);
    if (status === 'failed') d.failedChecks.push(line);
    else if (status === 'overdue') d.overdueChecks.push(line);
    else d.dueSoonChecks.push(line);
  }

  for (const row of doorRows) {
    const interval = doorInspectionIntervalMonths(
      row.locationKind,
      {
        isResidential: row.isResidential,
        heightMetres: row.heightMetres,
        storeys: row.storeys,
        hasFireAlarm: row.hasFireAlarm,
        hasEmergencyLighting: row.hasEmergencyLighting,
        hasSprinklers: row.hasSprinklers,
        hasDampers: row.hasDampers,
        hasRisers: row.hasRisers,
      },
      row.override,
    );
    const status = doorDisplayStatus(row.nextInspectionDueAt, interval, row.lastOutcome, now);
    if (status !== 'failed' && status !== 'overdue') continue;
    const line = { buildingName: row.buildingName, label: row.doorRef };
    const d = forTenant(row.tenantId);
    if (status === 'failed') d.failedDoors.push(line);
    else d.overdueDoors.push(line);
  }

  for (const row of fraRows) {
    forTenant(row.tenantId).fraReviewsDue.push({
      referenceNumber: row.referenceNumber,
      title: row.title,
    });
  }
  for (const row of peepRows) {
    forTenant(row.tenantId).peepReviewsDue += 1;
  }
  for (const row of marshalRows) {
    const status = marshalTrainingStatus(row, now);
    if (status === 'expiring_soon' || status === 'expired') {
      forTenant(row.tenantId).marshalsExpiring += 1;
    }
  }

  return [...digests.values()].filter(hasContent);
}

/** Compact plain-text block for the email body — top lines, capped. */
export function digestDetailLines(digest: FireDigest, cap = 12): string {
  const lines: string[] = [];
  for (const c of digest.failedChecks) lines.push(`FAILED — ${c.label} · ${c.buildingName}`);
  for (const c of digest.failedDoors) {
    lines.push(`FAILED — fire door ${c.label} · ${c.buildingName}`);
  }
  for (const c of digest.overdueChecks) lines.push(`Overdue — ${c.label} · ${c.buildingName}`);
  for (const c of digest.overdueDoors) {
    lines.push(`Overdue — fire door ${c.label} · ${c.buildingName}`);
  }
  for (const f of digest.fraReviewsDue) {
    lines.push(`FRA review due — ${f.referenceNumber ?? ''} ${f.title}`.replace('—  ', '— '));
  }
  for (const c of digest.dueSoonChecks) lines.push(`Due soon — ${c.label} · ${c.buildingName}`);
  const extra = lines.length - cap;
  const out = lines.slice(0, cap);
  if (extra > 0) out.push(`…and ${extra} more`);
  return out.join('\n');
}

export interface FireDueDigestDeps {
  db: Database;
  logger: Logger;
  appUrl: string;
  /** Send one digest email. Injected so tests fake it. */
  notify: (
    recipient: { email: string; name: string; locale?: string | null },
    digest: FireDigest,
    viewUrl: string,
  ) => Promise<void>;
  /** Overridable clock for tests. */
  now?: () => Date;
}

/**
 * Pure run: collect per-tenant digests, resolve each tenant's
 * `fireSafety.manage` holders, send one email per recipient. A failing
 * send is logged and skipped — the next daily run repeats anyway, so a
 * missed digest self-heals without a stamp.
 */
export async function runFireDueDigest(
  deps: FireDueDigestDeps,
): Promise<{ tenants: number; emails: number }> {
  const now = deps.now?.() ?? new Date();
  const digests = await collectFireDigests(deps.db, now);
  let emails = 0;
  for (const digest of digests) {
    const holders = await usersHoldingPermission(deps.db, digest.tenantId, 'fireSafety.manage');
    const viewUrl = `${deps.appUrl}/en/fire-safety`;
    for (const holder of holders) {
      if (holder.email.length === 0) continue;
      try {
        await deps.notify(
          { email: holder.email, name: holder.name, locale: holder.locale },
          digest,
          viewUrl,
        );
        emails += 1;
      } catch (err) {
        deps.logger.error(
          { err, tenantId: digest.tenantId, to: holder.userId },
          '[fire-due-digest] notify failed',
        );
      }
    }
  }
  deps.logger.info({ tenants: digests.length, emails }, '[fire-due-digest] run complete');
  return { tenants: digests.length, emails };
}

/** BullMQ job wrapper. */
export function createFireDueDigestHandler(deps: FireDueDigestDeps) {
  return async (_job: Job): Promise<{ tenants: number; emails: number }> => {
    return runFireDueDigest(deps);
  };
}
