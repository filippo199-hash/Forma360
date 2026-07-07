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
async function resolveRecipients(
  db: Database,
  tenantId: string,
  spec: RecipientSpec,
): Promise<Set<string>> {
  const emails = new Set<string>();

  if (spec === null || spec.broadcastToAll) {
    // Broadcast: all active administrators (permission set contains org.settings).
    const adminRows = await db
      .select({ email: userTable.email })
      .from(userTable)
      .innerJoin(permissionSets, eq(userTable.permissionSetId, permissionSets.id))
      .where(
        and(
          eq(userTable.tenantId, tenantId),
          isNull(userTable.deactivatedAt),
          sql`${permissionSets.permissions} @> '["org.settings"]'::jsonb`,
        ),
      );
    for (const row of adminRows) emails.add(row.email);
    return emails;
  }

  // Named users.
  if (spec.userIds.length > 0) {
    const namedRows = await db
      .select({ email: userTable.email })
      .from(userTable)
      .where(
        and(
          eq(userTable.tenantId, tenantId),
          isNull(userTable.deactivatedAt),
          inArray(userTable.id, spec.userIds),
        ),
      );
    for (const row of namedRows) emails.add(row.email);
  }

  // Group members.
  if (spec.groupIds.length > 0) {
    const groupRows = await db
      .select({ email: userTable.email })
      .from(groupMembers)
      .innerJoin(userTable, eq(groupMembers.userId, userTable.id))
      .where(
        and(
          eq(userTable.tenantId, tenantId),
          isNull(userTable.deactivatedAt),
          inArray(groupMembers.groupId, spec.groupIds),
        ),
      );
    for (const row of groupRows) emails.add(row.email);
  }

  // Site members.
  if (spec.siteIds.length > 0) {
    const siteRows = await db
      .select({ email: userTable.email })
      .from(siteMembers)
      .innerJoin(userTable, eq(siteMembers.userId, userTable.id))
      .where(
        and(
          eq(userTable.tenantId, tenantId),
          isNull(userTable.deactivatedAt),
          inArray(siteMembers.siteId, spec.siteIds),
        ),
      );
    for (const row of siteRows) emails.add(row.email);
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

    const viewUrl = `${deps.appUrl}/${tenantId}/observations/${issueId}`;
    const templateKey = isCritical ? 'observation-critical-alert' : 'observation-notification';

    let sent = 0;
    for (const email of emails) {
      try {
        await deps.sendTemplatedEmail({
          to: email,
          templateKey,
          variables: {
            issueTitle: issue.title,
            referenceNumber: issue.referenceNumber,
            viewUrl,
          },
        });
        sent++;
      } catch (err) {
        log.error({ err, email }, '[observation-notify] failed to send email');
      }
    }

    log.info({ sent, total: emails.size }, '[observation-notify] done');
    return { sent };
  };
}
