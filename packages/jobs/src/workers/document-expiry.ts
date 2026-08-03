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
 *     uploader and every `documents.manage` holder once.
 *
 * A document with no reminderDays still gets the single at-expiry
 * notice — silence on expiry is the failure mode this exists to kill.
 */
import type { Database } from '@forma360/db/client';
import { documents, user } from '@forma360/db/schema';
import type { Logger } from '@forma360/shared/logger';
import { usersHoldingPermission } from '@forma360/permissions/holders';
import type { Job } from 'bullmq';
import { and, eq, isNotNull, lte, sql } from 'drizzle-orm';

export const DOCUMENT_EXPIRY_CRON = '15 6 * * *'; // daily, 06:15 UTC
const DAY_MS = 86_400_000;

export interface ExpiringDocument {
  documentId: string;
  tenantId: string;
  name: string;
  expiresAt: Date;
  uploadedByUserId: string;
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
    const days = Array.isArray(row.reminderDays)
      ? row.reminderDays.filter((d): d is number => typeof d === 'number' && d > 0)
      : [];
    const thresholds = [
      ...days.map((d) => new Date(row.expiresAt!.getTime() - d * DAY_MS)),
      row.expiresAt,
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
    recipient: { email: string; name: string },
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
      .select({ name: user.name, email: user.email, deactivatedAt: user.deactivatedAt })
      .from(user)
      .where(and(eq(user.tenantId, doc.tenantId), eq(user.id, doc.uploadedByUserId)))
      .limit(1);
    const recipients = new Map<string, { email: string; name: string }>();
    const uploader = uploaderRows[0];
    if (uploader !== undefined && uploader.deactivatedAt === null && uploader.email.length > 0) {
      recipients.set(uploader.email, { email: uploader.email, name: uploader.name });
    }
    for (const h of holders) {
      if (h.email.length > 0) recipients.set(h.email, { email: h.email, name: h.name });
    }
    const viewUrl = `${deps.appUrl.replace(/\/+$/, '')}/en/documents/${doc.documentId}`;
    let delivered = 0;
    for (const recipient of recipients.values()) {
      try {
        await deps.notify(recipient, doc, viewUrl);
        delivered += 1;
      } catch (err) {
        deps.logger.error(
          { err, documentId: doc.documentId, to: recipient.email },
          '[document-expiry] notify failed',
        );
      }
    }
    // PF-1 lesson: never stamp "told" when nobody was.
    if (recipients.size > 0 && delivered === 0) continue;
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
