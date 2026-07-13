/**
 * Handler for `forma360-contractor-overstay` (Contractors Phase 2).
 *
 * Runs hourly. Finds every visit that is still `checked_in` more than 24 hours
 * after check-in (never checked out) and hasn't been alerted yet, then emails
 * the people who scheduled/authorised the visit AND the gate guards (users who
 * hold `contractors.gate`, plus admins). Stamps `overstay_alerted_at` so each
 * overstay only fires once.
 */
import type { Database } from '@forma360/db/client';
import { contractorVisits, contractors, permissionSets, sites, user } from '@forma360/db/schema';
import type { Logger } from '@forma360/shared/logger';
import type { Job } from 'bullmq';
import { aliasedTable, and, eq, isNotNull, isNull, lte } from 'drizzle-orm';

export const CONTRACTOR_OVERSTAY_CRON = '0 * * * *'; // top of every hour
export const OVERSTAY_THRESHOLD_HOURS = 24;

export interface OverstayVisit {
  visitId: string;
  tenantId: string;
  contractorName: string;
  visitorName: string | null;
  title: string;
  siteName: string | null;
  checkedInAt: Date;
  /** Emails of the people who scheduled / authorised the visit. */
  inviterEmails: string[];
}

/**
 * Checked-in visits whose check-in is older than the threshold and which have
 * not yet been alerted. Pure — the handler and tests share it.
 */
export async function findOverstayVisits(
  db: Database,
  now: Date,
  thresholdHours: number,
): Promise<OverstayVisit[]> {
  const cutoff = new Date(now.getTime() - thresholdHours * 3_600_000);
  const creator = aliasedTable(user, 'overstay_creator');
  const authorizer = aliasedTable(user, 'overstay_authorizer');
  const rows = await db
    .select({
      visitId: contractorVisits.id,
      tenantId: contractorVisits.tenantId,
      contractorName: contractors.name,
      visitorName: contractorVisits.visitorName,
      title: contractorVisits.title,
      siteName: sites.name,
      checkedInAt: contractorVisits.checkedInAt,
      creatorEmail: creator.email,
      authorizerEmail: authorizer.email,
    })
    .from(contractorVisits)
    .innerJoin(contractors, eq(contractorVisits.contractorId, contractors.id))
    .leftJoin(sites, eq(contractorVisits.siteId, sites.id))
    .leftJoin(creator, eq(contractorVisits.createdByUserId, creator.id))
    .leftJoin(authorizer, eq(contractorVisits.authorizedByUserId, authorizer.id))
    .where(
      and(
        eq(contractorVisits.status, 'checked_in'),
        isNull(contractorVisits.archivedAt),
        isNull(contractorVisits.overstayAlertedAt),
        isNotNull(contractorVisits.checkedInAt),
        lte(contractorVisits.checkedInAt, cutoff),
      ),
    );
  return rows
    .filter((r): r is typeof r & { checkedInAt: Date } => r.checkedInAt !== null)
    .map((r) => {
      const inviterEmails = [r.creatorEmail, r.authorizerEmail].filter(
        (e): e is string => e !== null && e !== undefined,
      );
      return {
        visitId: r.visitId,
        tenantId: r.tenantId,
        contractorName: r.contractorName,
        visitorName: r.visitorName,
        title: r.title,
        siteName: r.siteName,
        checkedInAt: r.checkedInAt,
        inviterEmails: [...new Set(inviterEmails)],
      };
    });
}

/** Active users in the tenant who should watch the gate (contractors.gate or admins). */
async function gateGuardEmails(db: Database, tenantId: string): Promise<string[]> {
  const rows = await db
    .select({ email: user.email, permissions: permissionSets.permissions })
    .from(user)
    .innerJoin(permissionSets, eq(user.permissionSetId, permissionSets.id))
    .where(and(eq(user.tenantId, tenantId), isNull(user.deactivatedAt)));
  return rows
    .filter((r) => r.permissions.includes('contractors.gate') || r.permissions.includes('org.settings'))
    .map((r) => r.email);
}

export interface ContractorOverstayDeps {
  db: Database;
  logger: Logger;
  appUrl: string;
  /** Send one overstay alert to one recipient. Injected so tests fake it. */
  notify: (visit: OverstayVisit, email: string, boardUrl: string) => Promise<void>;
  now?: () => Date;
}

/** Pure run: find overstays, notify inviters + guards, stamp. Returns visits alerted. */
export async function runContractorOverstayAlerts(deps: ContractorOverstayDeps): Promise<number> {
  const now = deps.now?.() ?? new Date();
  const overstays = await findOverstayVisits(deps.db, now, OVERSTAY_THRESHOLD_HOURS);
  const boardUrl = `${deps.appUrl.replace(/\/$/, '')}/en/contractors`;
  const guardCache = new Map<string, string[]>();
  let alerted = 0;

  for (const v of overstays) {
    try {
      let guards = guardCache.get(v.tenantId);
      if (guards === undefined) {
        guards = await gateGuardEmails(deps.db, v.tenantId);
        guardCache.set(v.tenantId, guards);
      }
      const recipients = [...new Set([...v.inviterEmails, ...guards])];
      for (const email of recipients) {
        await deps.notify(v, email, boardUrl);
      }
      await deps.db
        .update(contractorVisits)
        .set({ overstayAlertedAt: now })
        .where(eq(contractorVisits.id, v.visitId));
      alerted += 1;
    } catch (err) {
      deps.logger.error({ err, visitId: v.visitId }, '[contractor-overstay] alert failed');
    }
  }
  deps.logger.info({ alerted, considered: overstays.length }, '[contractor-overstay] done');
  return alerted;
}

export function createContractorOverstayHandler(deps: ContractorOverstayDeps) {
  return async function handler(_job: Job): Promise<{ alerted: number }> {
    const alerted = await runContractorOverstayAlerts(deps);
    return { alerted };
  };
}
