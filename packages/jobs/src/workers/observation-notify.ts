/**
 * Handler for `forma360-observation-notify` (Phase 3).
 *
 * Fired when a new observation is created. Resolves the recipient list from
 * the category's `notificationRecipientSpec` (or `criticalAlertRecipientSpec`
 * for critical issues) and sends a notification email to each unique email
 * address:
 *
 *   1. Load the issue + its category snapshot.
 *   2. Determine the effective recipient spec (critical vs. normal).
 *   3. Resolve group members, site members, and named users → unique emails.
 *   4. If broadcastToAll (or spec is null) → all active admin users.
 *   5. Send one email per resolved recipient.
 */
import type { Database } from '@forma360/db/client';
import {
  groupMembers,
  issueCategories,
  issues,
  permissionSets,
  siteMembers,
  user as userTable,
} from '@forma360/db/schema';
import { emailEnabledFor, loadNotificationPrefs, notifyInApp } from '@forma360/api/notify';
import { appLink } from '@forma360/shared/app-link';
import type { SendTemplatedEmail } from '@forma360/shared/email';
import type { Logger } from '@forma360/shared/logger';
import type { Job } from 'bullmq';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { ObservationNotifyPayload } from '../queues';

export interface ObservationNotifyDeps {
  db: Database;
  logger: Logger;
  sendTemplatedEmail: SendTemplatedEmail;
  appUrl: string;
}

type RecipientSpec = {
  broadcastToAll: boolean;
  groupIds: string[];
  siteIds: string[];
  userIds: string[];
} | null;

/**
 * Resolve the email set for a recipient spec. If `spec` is null or
 * `broadcastToAll` is true, returns every active admin user's email for the
 * tenant. Otherwise fans out group/site/user ids.
 */
interface NotifyRecipient {
  /**
   * Platform user id, when the address belongs to one. Only these carry a
   * notification preference and a bell row — a free-text address has no
   * user to hold either, so it is always emailed and never belled.
   */
  userId: string | null;
  email: string;
  /** Preferred email language (PF-20); null = English. */
  locale: string | null;
}

async function resolveRecipients(
  db: Database,
  tenantId: string,
  spec: RecipientSpec,
): Promise<Map<string, NotifyRecipient>> {
  // DOC-A01: this returned a bare Set<string> of addresses, so neither the
  // email BODY nor the link could be in the reader's language — the one
  // worker of the ten where the locale was not merely discarded but never
  // loaded. Keyed by email so the dedupe the Set gave us still holds.
  const emails = new Map<string, NotifyRecipient>();
  const add = (row: { id: string; email: string; locale: string | null }): void => {
    if (row.email.length > 0 && !emails.has(row.email)) {
      emails.set(row.email, { userId: row.id, email: row.email, locale: row.locale });
    }
  };

  if (spec === null || spec.broadcastToAll) {
    // Broadcast: all active administrators (permission set contains org.settings).
    const adminRows = await db
      .select({ id: userTable.id, email: userTable.email, locale: userTable.locale })
      .from(userTable)
      .innerJoin(permissionSets, eq(userTable.permissionSetId, permissionSets.id))
      .where(
        and(
          eq(userTable.tenantId, tenantId),
          isNull(userTable.deactivatedAt),
          sql`${permissionSets.permissions} @> '["org.settings"]'::jsonb`,
        ),
      );
    for (const row of adminRows) add(row);
    return emails;
  }

  // Named users.
  if (spec.userIds.length > 0) {
    const namedRows = await db
      .select({ id: userTable.id, email: userTable.email, locale: userTable.locale })
      .from(userTable)
      .where(
        and(
          eq(userTable.tenantId, tenantId),
          isNull(userTable.deactivatedAt),
          inArray(userTable.id, spec.userIds),
        ),
      );
    for (const row of namedRows) add(row);
  }

  // Group members.
  if (spec.groupIds.length > 0) {
    const groupRows = await db
      .select({ id: userTable.id, email: userTable.email, locale: userTable.locale })
      .from(groupMembers)
      .innerJoin(userTable, eq(groupMembers.userId, userTable.id))
      .where(
        and(
          eq(userTable.tenantId, tenantId),
          isNull(userTable.deactivatedAt),
          inArray(groupMembers.groupId, spec.groupIds),
        ),
      );
    for (const row of groupRows) add(row);
  }

  // Site members.
  if (spec.siteIds.length > 0) {
    const siteRows = await db
      .select({ id: userTable.id, email: userTable.email, locale: userTable.locale })
      .from(siteMembers)
      .innerJoin(userTable, eq(siteMembers.userId, userTable.id))
      .where(
        and(
          eq(userTable.tenantId, tenantId),
          isNull(userTable.deactivatedAt),
          inArray(siteMembers.siteId, spec.siteIds),
        ),
      );
    for (const row of siteRows) add(row);
  }

  return emails;
}

export function createObservationNotifyHandler(deps: ObservationNotifyDeps) {
  return async function handleObservationNotify(
    job: Job<ObservationNotifyPayload>,
  ): Promise<{ sent: number }> {
    const { tenantId, issueId, isCritical } = job.data;
    const log = deps.logger.child({
      job_id: job.id,
      queue: job.queueName,
      tenantId,
      issueId,
    });

    // Load the issue.
    const issueRows = await deps.db
      .select({
        title: issues.title,
        referenceNumber: issues.referenceNumber,
        categoryId: issues.categoryId,
      })
      .from(issues)
      .where(and(eq(issues.tenantId, tenantId), eq(issues.id, issueId)))
      .limit(1);
    const issue = issueRows[0];
    if (issue === undefined) {
      log.warn('[observation-notify] issue not found — skipping');
      return { sent: 0 };
    }

    // Load the category's recipient specs.
    const catRows = await deps.db
      .select({
        notificationRule: issueCategories.notificationRule,
        notificationRecipientSpec: issueCategories.notificationRecipientSpec,
        criticalAlertRecipientSpec: issueCategories.criticalAlertRecipientSpec,
      })
      .from(issueCategories)
      .where(and(eq(issueCategories.tenantId, tenantId), eq(issueCategories.id, issue.categoryId)))
      .limit(1);
    const category = catRows[0];
    if (category === undefined) {
      log.warn('[observation-notify] category not found — skipping');
      return { sent: 0 };
    }

    // Private rule = no emails.
    if (category.notificationRule === 'private') {
      log.info('[observation-notify] notificationRule=private — skipping');
      return { sent: 0 };
    }

    // Pick the correct spec.
    const spec =
      (isCritical
        ? (category.criticalAlertRecipientSpec as RecipientSpec)
        : (category.notificationRecipientSpec as RecipientSpec)) ?? null;

    const emails = await resolveRecipients(deps.db, tenantId, spec);
    if (emails.size === 0) {
      log.info('[observation-notify] no recipients — skipping');
      return { sent: 0 };
    }

    // PF-12: the first path segment is the LOCALE, not the tenant id —
    // every notification email built here 404ed.
    const templateKey = isCritical ? 'observation-critical-alert' : 'observation-notification';
    // The critical alert is its own kind — muting routine observation
    // traffic must not mute the alarm.
    const kind = isCritical ? 'observation_critical' : 'observation_notification';

    // Per-recipient channel prefs, one bulk read (settings → notifications).
    // notifyInApp checks the inapp pref itself; the email pref is checked in
    // the loop. Free-text addresses (userId null) have no preference to
    // honour and are always emailed.
    const prefsById = await loadNotificationPrefs(
      deps.db,
      tenantId,
      [...emails.values()].flatMap((r) => (r.userId === null ? [] : [r.userId])),
    );

    let sent = 0;
    for (const recipient of emails.values()) {
      if (recipient.userId !== null) {
        await notifyInApp(
          deps.db,
          {
            tenantId,
            userId: recipient.userId,
            kind,
            title: issue.title,
            href: `/observations/${issueId}`,
          },
          prefsById.get(recipient.userId) ?? {},
        );
        if (!emailEnabledFor(prefsById, recipient.userId, kind)) continue;
      }
      try {
        await deps.sendTemplatedEmail({
          to: recipient.email,
          // DOC-A01: the body AND the link now follow the reader.
          ...(recipient.locale !== null ? { locale: recipient.locale } : {}),
          templateKey,
          variables: {
            issueTitle: issue.title,
            referenceNumber: issue.referenceNumber,
            viewUrl: appLink(deps.appUrl, recipient.locale, `/observations/${issueId}`),
          },
        });
        sent++;
      } catch (err) {
        log.error({ err, email: recipient.email }, '[observation-notify] failed to send email');
      }
    }

    log.info({ sent, total: emails.size }, '[observation-notify] done');
    return { sent };
  };
}
