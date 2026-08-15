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
import { contractorVisits, contractors, siteMembers, sites, user } from '@forma360/db/schema';
import { emailEnabledFor, loadNotificationPrefs, notifyInApp } from '@forma360/api/notify';
import { usersHoldingPermission, type PermissionHolder } from '@forma360/permissions/holders';
import type { Logger } from '@forma360/shared/logger';
import type { Job } from 'bullmq';
import { aliasedTable, and, eq, isNotNull, isNull, lte } from 'drizzle-orm';

export const CONTRACTOR_OVERSTAY_CRON = '0 * * * *'; // top of every hour
export const OVERSTAY_THRESHOLD_HOURS = 24;

/** One addressable person for the alert. CT-O03: the locale rides along. */
export interface OverstayRecipient {
  /** Platform user id — carries the notification prefs and the bell row. */
  userId: string | null;
  email: string;
  name: string;
  /** Preferred email language (PF-20); null = English. */
  locale: string | null;
}

export interface OverstayVisit {
  visitId: string;
  tenantId: string;
  contractorName: string;
  visitorName: string | null;
  title: string;
  /** CT-O04: needed to narrow the gate audience to the site's own team. */
  siteId: string | null;
  siteName: string | null;
  checkedInAt: Date;
  /** The people who scheduled / authorised the visit. */
  inviters: OverstayRecipient[];
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
      siteId: contractorVisits.siteId,
      siteName: sites.name,
      checkedInAt: contractorVisits.checkedInAt,
      creatorId: creator.id,
      creatorEmail: creator.email,
      creatorName: creator.name,
      creatorLocale: creator.locale,
      authorizerId: authorizer.id,
      authorizerEmail: authorizer.email,
      authorizerName: authorizer.name,
      authorizerLocale: authorizer.locale,
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
      const inviters: OverstayRecipient[] = [];
      const seen = new Set<string>();
      for (const cand of [
        { userId: r.creatorId, email: r.creatorEmail, name: r.creatorName, locale: r.creatorLocale },
        {
          userId: r.authorizerId,
          email: r.authorizerEmail,
          name: r.authorizerName,
          locale: r.authorizerLocale,
        },
      ]) {
        const email = cand.email;
        if (email === null || email === undefined || email === '') continue;
        if (seen.has(email)) continue;
        seen.add(email);
        inviters.push({
          userId: cand.userId ?? null,
          email,
          name: cand.name ?? email,
          locale: cand.locale ?? null,
        });
      }
      return {
        visitId: r.visitId,
        tenantId: r.tenantId,
        contractorName: r.contractorName,
        visitorName: r.visitorName,
        title: r.title,
        siteId: r.siteId,
        siteName: r.siteName,
        checkedInAt: r.checkedInAt,
        inviters,
      };
    });
}

/**
 * The gate audience for ONE visit.
 *
 * CT-O04: this used to resolve every `contractors.gate` holder and every
 * administrator in the tenant, cached by tenant alone — so a group with
 * twenty sites mailed the whole company about one contractor overrunning
 * at one of them, and told guards with no business at that site which
 * contractor was where. It now narrows to the site's own team wherever
 * `site_members` is curated. An empty intersection falls back to every
 * holder: a mis-curated site must never swallow an overstay alert.
 *
 * Mirrors `resolveAlertRecipients` in incident-alert.ts, and uses
 * `usersHoldingPermission` so the permission test is the same SQL
 * containment check every other module runs (administrators qualify via
 * `org.settings`) rather than a hand-rolled `.includes` — which is also
 * what makes `user.locale` available for CT-O03.
 */
export async function resolveGateGuards(
  db: Database,
  tenantId: string,
  siteId: string | null,
): Promise<OverstayRecipient[]> {
  const toRecipient = (h: PermissionHolder): OverstayRecipient => ({
    userId: h.userId,
    email: h.email,
    name: h.name,
    locale: h.locale,
  });
  const holders = await usersHoldingPermission(db, tenantId, 'contractors.gate');
  const addressable = holders.filter((h) => h.email !== '');
  if (siteId === null || addressable.length === 0) return addressable.map(toRecipient);
  const members = await db
    .select({ userId: siteMembers.userId })
    .from(siteMembers)
    .where(and(eq(siteMembers.tenantId, tenantId), eq(siteMembers.siteId, siteId)));
  if (members.length === 0) return addressable.map(toRecipient);
  const memberIds = new Set(members.map((m) => m.userId));
  const scoped = addressable.filter((h) => memberIds.has(h.userId));
  return (scoped.length > 0 ? scoped : addressable).map(toRecipient);
}

export interface ContractorOverstayDeps {
  db: Database;
  logger: Logger;
  appUrl: string;
  /** Send one overstay alert to one recipient. Injected so tests fake it. */
  notify: (visit: OverstayVisit, recipient: OverstayRecipient, boardUrl: string) => Promise<void>;
  now?: () => Date;
}

/** Pure run: find overstays, notify inviters + guards, stamp. Returns visits alerted. */
export async function runContractorOverstayAlerts(deps: ContractorOverstayDeps): Promise<number> {
  const now = deps.now?.() ?? new Date();
  const overstays = await findOverstayVisits(deps.db, now, OVERSTAY_THRESHOLD_HOURS);
  const base = deps.appUrl.replace(/\/$/, '');
  // CT-O04: the audience depends on the SITE, not just the tenant.
  const guardCache = new Map<string, OverstayRecipient[]>();
  let alerted = 0;

  for (const v of overstays) {
    const cacheKey = `${v.tenantId}:${v.siteId ?? ''}`;
    let guards = guardCache.get(cacheKey);
    if (guards === undefined) {
      try {
        guards = await resolveGateGuards(deps.db, v.tenantId, v.siteId);
      } catch (err) {
        deps.logger.error(
          { err, visitId: v.visitId },
          '[contractor-overstay] gate-guard lookup failed',
        );
        continue;
      }
      guardCache.set(cacheKey, guards);
    }
    const recipients = new Map<string, OverstayRecipient>();
    for (const r of [...v.inviters, ...guards]) {
      if (!recipients.has(r.email)) recipients.set(r.email, r);
    }

    // Per-recipient channel prefs, one bulk read per visit (settings →
    // notifications). notifyInApp checks the inapp pref itself; the email
    // pref is checked in the loop below.
    const prefsById = await loadNotificationPrefs(
      deps.db,
      v.tenantId,
      [...recipients.values()].flatMap((r) => (r.userId === null ? [] : [r.userId])),
    );

    // CT-O02: one bad address must not abort the fan-out nor block the
    // stamp. The per-recipient loop had no inner catch, so the first
    // rejection threw past every remaining recipient AND past the stamp —
    // and the next hourly tick then re-mailed everyone who had already
    // received it, forever. Try each recipient; stamp when at least one
    // landed (or there was genuinely nobody to tell). Total failure leaves
    // the stamp clear so the next tick retries. Same rule as
    // permit-expiry-watch and incident-alert (IN-A1).
    let attempted = 0;
    let delivered = 0;
    let muted = 0;
    for (const recipient of recipients.values()) {
      if (recipient.userId !== null) {
        await notifyInApp(
          deps.db,
          {
            tenantId: v.tenantId,
            userId: recipient.userId,
            kind: 'contractor_overstay',
            title:
              v.siteName !== null
                ? `${v.contractorName} still on site at ${v.siteName}`
                : `${v.contractorName} still on site`,
            href: '/contractors',
          },
          prefsById.get(recipient.userId) ?? {},
        );
        if (!emailEnabledFor(prefsById, recipient.userId, 'contractor_overstay')) {
          // A muted email is handled, not failed — count it so an all-muted
          // audience still stamps (an unstamped visit re-alerts hourly).
          muted += 1;
          continue;
        }
      }
      attempted += 1;
      try {
        // CT-O03: the board link lands in the reader's own locale, not /en/.
        await deps.notify(v, recipient, `${base}/${recipient.locale ?? 'en'}/contractors`);
        delivered += 1;
      } catch (err) {
        deps.logger.error(
          { err, visitId: v.visitId, to: recipient.email },
          '[contractor-overstay] notify failed',
        );
      }
    }
    if (attempted > 0 && delivered === 0 && muted === 0) {
      deps.logger.error(
        { visitId: v.visitId },
        '[contractor-overstay] alert undelivered — stamp withheld for retry',
      );
      continue;
    }
    try {
      await deps.db
        .update(contractorVisits)
        .set({ overstayAlertedAt: now })
        .where(and(eq(contractorVisits.tenantId, v.tenantId), eq(contractorVisits.id, v.visitId)));
      alerted += 1;
    } catch (err) {
      deps.logger.error({ err, visitId: v.visitId }, '[contractor-overstay] stamp failed');
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
