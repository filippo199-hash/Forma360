/**
 * Handler for `forma360-document-expiry` (platform HSE review PF-16):
 * documents stored `reminderDays` and the UI offered the checkboxes,
 * but no worker ever read the field — an expired insurance certificate
 * was a red badge nobody saw. Daily pass:
 *
 *   - for each document with an expiry date, compute its reminder
 *     thresholds (expiresAt − N days for each configured N, plus the
 *     expiry moment itself);
 *   - when `now` has crossed a threshold the document hasn't been
 *     reminded for yet (`last_expiry_reminder_at` stamp), email the
 *     named responsible party (user or group), the uploader, and every
 *     `documents.manage` holder — once each, deduped by email.
 *
 * A document with no reminderDays still gets the single at-expiry
 * notice — silence on expiry is the failure mode this exists to kill.
 */
import type { Database } from '@forma360/db/client';
import { documents, groupMembers, user } from '@forma360/db/schema';
import { notifyInApp } from '@forma360/api/notify';
import { appLink } from '@forma360/shared/app-link';
import { notificationEnabled } from '@forma360/shared/notification-catalogue';
import type { Logger } from '@forma360/shared/logger';
import { usersHoldingPermission } from '@forma360/permissions/holders';
import type { Job } from 'bullmq';
import { inArray, and, eq, isNotNull, lte, sql } from 'drizzle-orm';

export const DOCUMENT_EXPIRY_CRON = '15 6 * * *'; // daily, 06:15 UTC
const DAY_MS = 86_400_000;

export interface ExpiringDocument {
  documentId: string;
  tenantId: string;
  name: string;
  expiresAt: Date;
  uploadedByUserId: string;
  /**
   * DC-S06: the named accountable party. Collected on the upload form,
   * stored, and rendered on the detail page — and completely ignored by the
   * notification engine, which mailed whoever dragged the PDF in eighteen
   * months ago (possibly a leaver) plus a broadcast of every
   * `documents.manage` holder. The one field that names a responsible human
   * was the one field the reminder did not read.
   */
  responsibleUserId: string | null;
  responsibleGroupId: string | null;
  /** True when the document is already past its expiry. */
  expired: boolean;
}

/**
 * Documents whose next un-reminded threshold has arrived. Pure — the
 * handler and the tests share it.
 */
export async function findDocumentsNeedingReminder(
  db: Database,
  now: Date,
): Promise<ExpiringDocument[]> {
  // Widest candidate set: anything with an expiry within the largest
  // conceivable lead (365 days) or already expired, not archived.
  const horizon = new Date(now.getTime() + 365 * DAY_MS);
  const rows = await db
    .select({
      documentId: documents.id,
      tenantId: documents.tenantId,
      name: documents.name,
      expiresAt: documents.expiresAt,
      reminderDays: documents.reminderDays,
      lastExpiryReminderAt: documents.lastExpiryReminderAt,
      uploadedByUserId: documents.uploadedByUserId,
      responsibleUserId: documents.responsibleUserId,
      responsibleGroupId: documents.responsibleGroupId,
      archivedAt: documents.archivedAt,
    })
    .from(documents)
    .where(
      and(
        isNotNull(documents.expiresAt),
        lte(documents.expiresAt, horizon),
        sql`${documents.archivedAt} IS NULL`,
      ),
    );

  const out: ExpiringDocument[] = [];
  for (const row of rows) {
    if (row.expiresAt === null) continue;
    const expiresAt = row.expiresAt;
    const days = Array.isArray(row.reminderDays)
      ? row.reminderDays.filter((d): d is number => typeof d === 'number' && d > 0)
      : [];
    const thresholds = [
      ...days.map((d) => new Date(expiresAt.getTime() - d * DAY_MS)),
      expiresAt,
    ].sort((a, b) => a.getTime() - b.getTime());
    const crossed = thresholds.filter((t) => t.getTime() <= now.getTime());
    if (crossed.length === 0) continue;
    const latestCrossed = crossed[crossed.length - 1];
    if (latestCrossed === undefined) continue;
    const last = row.lastExpiryReminderAt;
    // Remind when the newest crossed threshold post-dates the last stamp.
    if (last === null || last.getTime() < latestCrossed.getTime()) {
      out.push({
        documentId: row.documentId,
        tenantId: row.tenantId,
        name: row.name,
        expiresAt: row.expiresAt,
        uploadedByUserId: row.uploadedByUserId,
        responsibleUserId: row.responsibleUserId,
        responsibleGroupId: row.responsibleGroupId,
        expired: row.expiresAt.getTime() <= now.getTime(),
      });
    }
  }
  return out;
}

export interface DocumentExpiryDeps {
  db: Database;
  logger: Logger;
  appUrl: string;
  notify: (
    recipient: { email: string; name: string; locale?: string | null },
    doc: ExpiringDocument,
    viewUrl: string,
  ) => Promise<void>;
  now?: () => Date;
}

export async function runDocumentExpiry(
  deps: DocumentExpiryDeps,
): Promise<{ reminded: number; emails: number }> {
  const now = deps.now?.() ?? new Date();
  const due = await findDocumentsNeedingReminder(deps.db, now);
  let reminded = 0;
  let emails = 0;
  for (const doc of due) {
    // Uploader + documents.manage holders, deduped by email.
    const holders = await usersHoldingPermission(deps.db, doc.tenantId, 'documents.manage');
    const uploaderRows = await deps.db
      .select({
        name: user.name,
        email: user.email,
        locale: user.locale,
        deactivatedAt: user.deactivatedAt,
      })
      .from(user)
      .where(and(eq(user.tenantId, doc.tenantId), eq(user.id, doc.uploadedByUserId)))
      .limit(1);
    /**
     * DC-S06: the named responsible party comes FIRST, because they are the
     * person actually accountable for renewing this document. A compliance
     * officer who sets "Responsible: Jane, Facilities" on the fire-alarm
     * service certificate expects Jane to be told; she never was.
     */
    const responsibleRows =
      doc.responsibleUserId !== null
        ? await deps.db
            .select({
              id: user.id,
              name: user.name,
              email: user.email,
              locale: user.locale,
              deactivatedAt: user.deactivatedAt,
            })
            .from(user)
            .where(and(eq(user.tenantId, doc.tenantId), eq(user.id, doc.responsibleUserId)))
            .limit(1)
        : [];
    const responsibleGroupRows =
      doc.responsibleGroupId !== null
        ? await deps.db
            .select({
              id: user.id,
              name: user.name,
              email: user.email,
              locale: user.locale,
              deactivatedAt: user.deactivatedAt,
            })
            .from(groupMembers)
            .innerJoin(user, eq(groupMembers.userId, user.id))
            .where(
              and(
                eq(groupMembers.tenantId, doc.tenantId),
                eq(groupMembers.groupId, doc.responsibleGroupId),
              ),
            )
        : [];

    const recipients = new Map<
      string,
      { userId: string | null; email: string; name: string; locale?: string | null }
    >();
    for (const r of [...responsibleRows, ...responsibleGroupRows]) {
      if (r.deactivatedAt !== null || r.email.length === 0) continue;
      recipients.set(r.email, {
        userId: r.id,
        email: r.email,
        name: r.name,
        locale: r.locale,
      });
    }
    const uploader = uploaderRows[0];
    if (uploader !== undefined && uploader.deactivatedAt === null && uploader.email.length > 0) {
      recipients.set(uploader.email, {
        userId: doc.uploadedByUserId,
        email: uploader.email,
        name: uploader.name,
        locale: uploader.locale,
      });
    }
    for (const h of holders) {
      if (h.email.length > 0) {
        recipients.set(h.email, {
          userId: h.userId,
          email: h.email,
          name: h.name,
          locale: h.locale,
        });
      }
    }
    // Per-recipient channel prefs (settings → notifications). notifyInApp
    // checks the inapp pref itself; the email pref is checked here.
    const recipientIds = [...recipients.values()].flatMap((r) =>
      r.userId === null ? [] : [r.userId],
    );
    const prefRows =
      recipientIds.length > 0
        ? await deps.db
            .select({ id: user.id, notificationPrefs: user.notificationPrefs })
            .from(user)
            .where(inArray(user.id, recipientIds))
        : [];
    const prefsById = new Map(prefRows.map((r) => [r.id, r.notificationPrefs]));
    let delivered = 0;
    let muted = 0;
    for (const recipient of recipients.values()) {
      if (recipient.userId !== null) {
        const prefs = prefsById.get(recipient.userId) ?? {};
        await notifyInApp(
          deps.db,
          {
            tenantId: doc.tenantId,
            userId: recipient.userId,
            kind: 'document_expiry',
            title: doc.name,
            href: `/documents/${doc.documentId}`,
          },
          prefs,
        );
        if (!notificationEnabled(prefs, 'document_expiry', 'email')) {
          // A muted email is handled, not failed — count it so an
          // all-muted document still gets stamped (an unstamped doc
          // would re-notify the bell every single day).
          muted += 1;
          continue;
        }
      }
      try {
        // DOC-A01: built per recipient — the locale was already
        // carried here and used only for the email body.
        await deps.notify(
          recipient,
          doc,
          appLink(deps.appUrl, recipient.locale, `/documents/${doc.documentId}`),
        );
        delivered += 1;
      } catch (err) {
        deps.logger.error(
          { err, documentId: doc.documentId, to: recipient.email },
          '[document-expiry] notify failed',
        );
      }
    }
    // PF-1 lesson: never stamp "told" when nobody was.
    if (recipients.size > 0 && delivered === 0 && muted === 0) continue;
    await deps.db
      .update(documents)
      .set({ lastExpiryReminderAt: now })
      .where(eq(documents.id, doc.documentId));
    reminded += 1;
    emails += delivered;
  }
  deps.logger.info({ reminded, emails }, '[document-expiry] run complete');
  return { reminded, emails };
}

export function createDocumentExpiryHandler(deps: DocumentExpiryDeps) {
  return async (_job: Job): Promise<{ reminded: number; emails: number }> => {
    return runDocumentExpiry(deps);
  };
}
