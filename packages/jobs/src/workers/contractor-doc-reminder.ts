/**
 * Handler for `forma360-contractor-doc-reminder` (Contractors Phase 1).
 *
 * Runs daily. Finds every *verified* contractor compliance document that
 * expires within the reminder window, hasn't been reminded yet, and whose
 * contractor has a primary contact email — then sends a single reminder and
 * stamps `reminder_sent_at` so it never fires twice for the same document.
 */
import { randomBytes } from 'node:crypto';
import type { Database } from '@forma360/db/client';
import { contractorDocuments, contractorRequirements, contractors } from '@forma360/db/schema';
import type { Logger } from '@forma360/shared/logger';
import type { Job } from 'bullmq';
import { and, eq, gte, isNotNull, isNull, lte } from 'drizzle-orm';

export const CONTRACTOR_DOC_REMINDER_CRON = '0 8 * * *'; // 08:00 UTC daily
export const REMINDER_LEAD_DAYS = 14;

export interface DueReminder {
  docId: string;
  tenantId: string;
  contractorId: string;
  contractorName: string;
  /** CT-O03: the contact's own email language; null = English. */
  locale: string | null;
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
      tenantId: contractorDocuments.tenantId,
      contractorId: contractorDocuments.contractorId,
      endDate: contractorDocuments.endDate,
      requirementName: contractorRequirements.name,
      contractorName: contractors.name,
      locale: contractors.locale,
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
    .filter(
      (r): r is typeof r & { email: string; endDate: string } =>
        r.email !== null && r.endDate !== null,
    )
    .map((r) => ({
      docId: r.docId,
      tenantId: r.tenantId,
      contractorId: r.contractorId,
      contractorName: r.contractorName,
      locale: r.locale,
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
  const base = deps.appUrl.replace(/\/$/, '');
  /**
   * CT-W01: one mint per contractor per run. Two documents due for the same
   * contractor must share a token — a second mint would invalidate the link
   * already sent in the first email.
   */
  const mintedTokens = new Map<string, string>();
  let sent = 0;
  for (const r of due) {
    try {
      // CT-W01: never fall back to the bare app URL. `upload_token` is
      // nullable and only the manual "copy upload link" button ever wrote
      // it, so the one email that matters — a blocking certificate 14 days
      // from expiry — shipped a CTA pointing at the tenant's sign-in page,
      // to an external party with no account. And `reminderSentAt` was
      // stamped anyway: one dead email, then permanent silence. A
      // contractor with no token gets one minted here, so legacy rows
      // self-heal and the one-shot stamp is never spent on a dead end.
      let token = r.uploadToken;
      if (token === null) {
        const cached = mintedTokens.get(r.contractorId);
        if (cached !== undefined) {
          token = cached;
        } else {
          token = randomBytes(24).toString('hex');
          await deps.db
            .update(contractors)
            .set({ uploadToken: token, updatedAt: today })
            .where(and(eq(contractors.tenantId, r.tenantId), eq(contractors.id, r.contractorId)));
          mintedTokens.set(r.contractorId, token);
        }
      }
      // CT-O03: the link lands in the contact's own language, not whatever
      // Accept-Language the middleware happens to guess.
      await deps.notify(r, `${base}/${r.locale ?? 'en'}/contractor-upload/${token}`);
      await deps.db
        .update(contractorDocuments)
        .set({ reminderSentAt: today })
        .where(
          and(eq(contractorDocuments.tenantId, r.tenantId), eq(contractorDocuments.id, r.docId)),
        );
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
