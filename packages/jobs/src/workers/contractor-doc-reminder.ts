/**
 * Handler for `forma360-contractor-doc-reminder` (Contractors Phase 1).
 *
 * Runs daily. Finds every *verified* contractor compliance document that
 * expires within the reminder window, hasn't been reminded yet, and whose
 * contractor has a primary contact email — then sends a single reminder and
 * stamps `reminder_sent_at` so it never fires twice for the same document.
 */
import type { Database } from '@forma360/db/client';
import { contractorDocuments, contractorRequirements, contractors } from '@forma360/db/schema';
import type { Logger } from '@forma360/shared/logger';
import type { Job } from 'bullmq';
import { and, eq, gte, isNotNull, isNull, lte } from 'drizzle-orm';

export const CONTRACTOR_DOC_REMINDER_CRON = '0 8 * * *'; // 08:00 UTC daily
export const REMINDER_LEAD_DAYS = 14;

export interface DueReminder {
  docId: string;
  contractorName: string;
  requirementName: string;
  email: string;
  endDate: string;
  uploadToken: string | null;
}

function isoDay(offsetDays: number, base: Date): string {
  const d = new Date(base.getTime() + offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/**
 * Verified, not-yet-reminded documents expiring within [today, today+lead]
 * whose contractor has a contact email. Pure — the handler and tests share it.
 */
export async function findDueReminders(
  db: Database,
  today: Date,
  leadDays: number,
): Promise<DueReminder[]> {
  const from = isoDay(0, today);
  const to = isoDay(leadDays, today);
  const rows = await db
    .select({
      docId: contractorDocuments.id,
      endDate: contractorDocuments.endDate,
      requirementName: contractorRequirements.name,
      contractorName: contractors.name,
      email: contractors.primaryContactEmail,
      uploadToken: contractors.uploadToken,
    })
    .from(contractorDocuments)
    .innerJoin(
      contractorRequirements,
      eq(contractorDocuments.requirementId, contractorRequirements.id),
    )
    .innerJoin(contractors, eq(contractorDocuments.contractorId, contractors.id))
    .where(
      and(
        eq(contractorDocuments.status, 'verified'),
        isNull(contractorDocuments.reminderSentAt),
        isNotNull(contractorDocuments.endDate),
        gte(contractorDocuments.endDate, from),
        lte(contractorDocuments.endDate, to),
        isNotNull(contractors.primaryContactEmail),
        isNull(contractors.archivedAt),
      ),
    );
  return rows
    .filter((r): r is typeof r & { email: string; endDate: string } =>
      r.email !== null && r.endDate !== null,
    )
    .map((r) => ({
      docId: r.docId,
      contractorName: r.contractorName,
      requirementName: r.requirementName,
      email: r.email,
      endDate: r.endDate,
      uploadToken: r.uploadToken,
    }));
}

export interface ContractorReminderDeps {
  db: Database;
  logger: Logger;
  appUrl: string;
  /** Send one reminder. Injected so the worker uses templated email; tests fake it. */
  notify: (r: DueReminder, uploadUrl: string) => Promise<void>;
  /** Overridable clock for tests. */
  now?: () => Date;
}

/** Pure run: find due reminders, notify, stamp. Returns the count sent. */
export async function runContractorDocReminders(deps: ContractorReminderDeps): Promise<number> {
  const today = deps.now?.() ?? new Date();
  const due = await findDueReminders(deps.db, today, REMINDER_LEAD_DAYS);
  let sent = 0;
  for (const r of due) {
    const uploadUrl =
      r.uploadToken !== null ? `${deps.appUrl}/contractor-upload/${r.uploadToken}` : deps.appUrl;
    try {
      await deps.notify(r, uploadUrl);
      await deps.db
        .update(contractorDocuments)
        .set({ reminderSentAt: today })
        .where(eq(contractorDocuments.id, r.docId));
      sent += 1;
    } catch (err) {
      deps.logger.error({ err, docId: r.docId }, '[contractor-doc-reminder] notify failed');
    }
  }
  deps.logger.info({ sent, considered: due.length }, '[contractor-doc-reminder] done');
  return sent;
}

export function createContractorDocReminderHandler(deps: ContractorReminderDeps) {
  return async function handler(_job: Job): Promise<{ sent: number }> {
    const sent = await runContractorDocReminders(deps);
    return { sent };
  };
}
