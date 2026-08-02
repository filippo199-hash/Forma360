/**
 * Handler for `forma360-permit-expiry-watch` (FreeHS module B3).
 *
 * Runs every 15 minutes. A permit that passes its validity end while
 * still open (issued / active / suspended) means someone may still be in
 * there — this worker stamps `expiry_escalated_at` (so a permit is
 * escalated exactly once per window), appends an `expiry_escalated`
 * event, and emails every signature party on the permit: issuer,
 * acceptor and authoriser. Extension clears the stamp, so a re-authorised
 * window gets a fresh watch.
 */
import type { Database } from '@forma360/db/client';
import { permitEvents, permits, permitTypes, sites, user } from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import type { Logger } from '@forma360/shared/logger';
import { OPEN_PERMIT_STATUSES, type PermitStatus } from '@forma360/shared/permits';
import type { Job } from 'bullmq';
import { and, eq, inArray, isNull, lte } from 'drizzle-orm';

export const PERMIT_EXPIRY_WATCH_CRON = '*/15 * * * *'; // every 15 minutes
/** Per-run cap — a huge backlog drains across a few ticks instead of one burst. */
export const MAX_ESCALATIONS_PER_RUN = 200;

export interface ExpiredOpenPermit {
  permitId: string;
  tenantId: string;
  referenceNumber: string | null;
  title: string;
  status: PermitStatus;
  typeName: string;
  siteName: string | null;
  validTo: Date;
  issuerUserId: string | null;
  acceptorUserId: string | null;
  authoriserUserId: string | null;
}

/**
 * Open permits past their validity end that have not been escalated yet.
 * Pure — the handler and tests share it.
 */
export async function findExpiredOpenPermits(
  db: Database,
  now: Date,
): Promise<ExpiredOpenPermit[]> {
  const rows = await db
    .select({
      permitId: permits.id,
      tenantId: permits.tenantId,
      referenceNumber: permits.referenceNumber,
      title: permits.title,
      status: permits.status,
      validTo: permits.validTo,
      issuerUserId: permits.issuerUserId,
      acceptorUserId: permits.acceptorUserId,
      authoriserUserId: permits.authoriserUserId,
      typeName: permitTypes.name,
      siteName: sites.name,
    })
    .from(permits)
    .innerJoin(permitTypes, eq(permitTypes.id, permits.permitTypeId))
    .leftJoin(sites, eq(sites.id, permits.siteId))
    .where(
      and(
        inArray(permits.status, [...OPEN_PERMIT_STATUSES]),
        lte(permits.validTo, now),
        isNull(permits.expiryEscalatedAt),
      ),
    )
    .limit(MAX_ESCALATIONS_PER_RUN);
  return rows.map((r) => ({ ...r, siteName: r.siteName ?? null }));
}

/**
 * The distinct, still-active recipients for one escalation: issuer,
 * acceptor and authoriser. Deactivated users and empty emails are skipped.
 */
export async function resolveEscalationRecipients(
  db: Database,
  permit: ExpiredOpenPermit,
): Promise<Array<{ userId: string; email: string; name: string }>> {
  const ids = [
    ...new Set(
      [permit.issuerUserId, permit.acceptorUserId, permit.authoriserUserId].filter(
        (v): v is string => v !== null,
      ),
    ),
  ];
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      deactivatedAt: user.deactivatedAt,
    })
    .from(user)
    .where(and(eq(user.tenantId, permit.tenantId), inArray(user.id, ids)));
  return rows
    .filter((r) => r.deactivatedAt === null && r.email.length > 0)
    .map((r) => ({ userId: r.id, email: r.email, name: r.name }));
}

export interface PermitExpiryWatchDeps {
  db: Database;
  logger: Logger;
  appUrl: string;
  /** Send one escalation. Injected so the worker uses templated email; tests fake it. */
  notify: (
    permit: ExpiredOpenPermit,
    recipient: { email: string; name: string },
    viewUrl: string,
  ) => Promise<void>;
  /** Overridable clock for tests. */
  now?: () => Date;
}

/**
 * Pure run: find expired open permits, stamp, log, notify every party.
 * The stamp goes on BEFORE the notifies so a failing email provider can
 * never cause a permit to escalate twice; failures are logged and land
 * in Sentry via the worker's failed-job hook on the next tick.
 */
export async function runPermitExpiryWatch(deps: PermitExpiryWatchDeps): Promise<number> {
  const now = deps.now?.() ?? new Date();
  const expired = await findExpiredOpenPermits(deps.db, now);
  let escalated = 0;
  for (const permit of expired) {
    await deps.db
      .update(permits)
      .set({ expiryEscalatedAt: now })
      .where(eq(permits.id, permit.permitId));
    await deps.db.insert(permitEvents).values({
      id: newId(),
      tenantId: permit.tenantId,
      permitId: permit.permitId,
      actorUserId: 'system',
      kind: 'expiry_escalated',
      detail: `expired ${permit.validTo.toISOString()} without closure`,
    });
    const recipients = await resolveEscalationRecipients(deps.db, permit);
    const viewUrl = `${deps.appUrl}/en/permits/${permit.permitId}`;
    for (const recipient of recipients) {
      try {
        await deps.notify(permit, recipient, viewUrl);
      } catch (err) {
        deps.logger.error(
          { err, permitId: permit.permitId, to: recipient.userId },
          '[permit-expiry-watch] notify failed',
        );
      }
    }
    escalated += 1;
  }
  deps.logger.info({ escalated }, '[permit-expiry-watch] done');
  return escalated;
}

export function createPermitExpiryWatchHandler(deps: PermitExpiryWatchDeps) {
  return async function handler(_job: Job): Promise<{ escalated: number }> {
    const escalated = await runPermitExpiryWatch(deps);
    return { escalated };
  };
}
