/**
 * Handler for `forma360-permit-expiry-watch` (FreeHS module B3).
 *
 * Runs every 15 minutes, two passes:
 *   1. WARNING (HSE review PW-10) — open permits whose window closes
 *      within the next `EXPIRY_WARNING_LEAD_MINUTES` get one heads-up to
 *      every signature party, stamped on `expiry_warning_sent_at`, so
 *      the team can close out or extend BEFORE the permit lapses.
 *   2. ESCALATION — a permit past its validity end while still open
 *      (issued / active / suspended) means someone may still be in
 *      there: stamp `expiry_escalated_at`, append the event, email
 *      issuer, acceptor and authoriser.
 * Both stamps fire exactly once per window; extension clears both, so a
 * re-authorised window gets a fresh watch.
 */
import type { Database } from '@forma360/db/client';
import { permitEvents, permits, permitTypes, sites, user } from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import type { Logger } from '@forma360/shared/logger';
import {
  EXPIRY_WARNING_LEAD_MINUTES,
  OPEN_PERMIT_STATUSES,
  type PermitStatus,
} from '@forma360/shared/permits';
import type { Job } from 'bullmq';
import { and, eq, gt, inArray, isNull, lte } from 'drizzle-orm';

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
 * Open permits whose window closes within the warning lead time and have
 * not been warned yet (PW-10). Pure — the handler and tests share it.
 */
export async function findExpiringOpenPermits(
  db: Database,
  now: Date,
): Promise<ExpiredOpenPermit[]> {
  const leadCutoff = new Date(now.getTime() + EXPIRY_WARNING_LEAD_MINUTES * 60_000);
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
        gt(permits.validTo, now),
        lte(permits.validTo, leadCutoff),
        isNull(permits.expiryWarningSentAt),
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
      locale: user.locale,
      name: user.name,
      deactivatedAt: user.deactivatedAt,
    })
    .from(user)
    .where(and(eq(user.tenantId, permit.tenantId), inArray(user.id, ids)));
  return rows
    .filter((r) => r.deactivatedAt === null && r.email.length > 0)
    .map((r) => ({ userId: r.id, email: r.email, name: r.name }));
}

export type PermitWatchKind = 'warning' | 'escalation';

export interface PermitExpiryWatchDeps {
  db: Database;
  logger: Logger;
  appUrl: string;
  /**
   * Send one notification — `kind` picks the template (pre-expiry
   * warning vs post-expiry escalation). Injected so the worker uses
   * templated email; tests fake it.
   */
  notify: (
    kind: PermitWatchKind,
    permit: ExpiredOpenPermit,
    recipient: { email: string; name: string },
    viewUrl: string,
  ) => Promise<void>;
  /** Overridable clock for tests. */
  now?: () => Date;
}

/**
 * Pure run, two passes: warn permits closing within the lead window
 * (PW-10), escalate permits already past their end. Each stamp goes on
 * BEFORE the notifies so a failing email provider can never cause a
 * permit to warn or escalate twice; failures are logged and land in
 * Sentry via the worker's failed-job hook on the next tick.
 */
export async function runPermitExpiryWatch(
  deps: PermitExpiryWatchDeps,
): Promise<{ warned: number; escalated: number }> {
  const now = deps.now?.() ?? new Date();

  /**
   * Attempt every notify; report how many were attempted vs delivered.
   * PF-1 (platform review): the stamp is one-shot, so it must never be
   * written when NOTHING was delivered — a broken template or provider
   * would otherwise mark the permit warned/escalated while nobody was
   * told, permanently. Total failure → no stamp → the next 15-minute
   * tick retries. Partial success stamps (no duplicate sends).
   */
  const notifyAll = async (
    kind: PermitWatchKind,
    permit: ExpiredOpenPermit,
  ): Promise<{ attempted: number; delivered: number }> => {
    const recipients = await resolveEscalationRecipients(deps.db, permit);
    const viewUrl = `${deps.appUrl}/en/permits/${permit.permitId}`;
    let delivered = 0;
    for (const recipient of recipients) {
      try {
        await deps.notify(kind, permit, recipient, viewUrl);
        delivered += 1;
      } catch (err) {
        deps.logger.error(
          { err, permitId: permit.permitId, to: recipient.userId, kind },
          '[permit-expiry-watch] notify failed',
        );
      }
    }
    return { attempted: recipients.length, delivered };
  };

  let warned = 0;
  const expiring = await findExpiringOpenPermits(deps.db, now);
  for (const permit of expiring) {
    const outcome = await notifyAll('warning', permit);
    if (outcome.attempted > 0 && outcome.delivered === 0) {
      deps.logger.error(
        { permitId: permit.permitId },
        '[permit-expiry-watch] warning undelivered — stamp withheld for retry',
      );
      continue;
    }
    await deps.db
      .update(permits)
      .set({ expiryWarningSentAt: now })
      .where(eq(permits.id, permit.permitId));
    await deps.db.insert(permitEvents).values({
      id: newId(),
      tenantId: permit.tenantId,
      permitId: permit.permitId,
      actorUserId: 'system',
      kind: 'expiry_warning',
      detail: `window closes ${permit.validTo.toISOString()}`,
    });
    warned += 1;
  }

  let escalated = 0;
  const expired = await findExpiredOpenPermits(deps.db, now);
  for (const permit of expired) {
    const outcome = await notifyAll('escalation', permit);
    if (outcome.attempted > 0 && outcome.delivered === 0) {
      deps.logger.error(
        { permitId: permit.permitId },
        '[permit-expiry-watch] escalation undelivered — stamp withheld for retry',
      );
      continue;
    }
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
    escalated += 1;
  }

  deps.logger.info({ warned, escalated }, '[permit-expiry-watch] done');
  return { warned, escalated };
}

export function createPermitExpiryWatchHandler(deps: PermitExpiryWatchDeps) {
  return async function handler(_job: Job): Promise<{ warned: number; escalated: number }> {
    return runPermitExpiryWatch(deps);
  };
}
