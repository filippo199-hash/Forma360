/**
 * Handler for `forma360-user-anonymisation` (Phase 1 § 1.1 — S-E09;
 * platform HSE review PF-31: "the anonymisation cascade is a stub").
 *
 * The *primary* anonymisation (user row overwrite + custom-field values)
 * happens inline in the `users.anonymise` mutation. This worker performs
 * the cross-module cascade that used to be a logged no-op:
 *
 *   - better-auth artefacts: sessions, accounts, two-factor secrets — gone;
 *   - drawn signature images (inspection signature slots, workflow signer
 *     rows, Heads Up sign-offs) — blanked. The *fact* of signing stays:
 *     the row, timestamp and status are tenant compliance evidence; the
 *     biometric-adjacent stroke data is the personal data;
 *   - the snapshot `signerName` on signature slots — replaced;
 *   - the user's personal notification inbox — deleted.
 *
 * Authored CONTENT (comments, notes, recorded checks) is intentionally
 * retained: it is tenant safety evidence, and the author's display name
 * resolves through the already-anonymised user row.
 */
import type { Database } from '@forma360/db/client';
import {
  account,
  headsUpRecipients,
  inspectionSignatures,
  inspectionWorkflowSigners,
  notifications,
  session,
  twoFactor,
} from '@forma360/db/schema';
import type { Logger } from '@forma360/shared/logger';
import type { Job } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import type { UserAnonymisationPayload } from '../queues';

export interface UserAnonymisationDeps {
  db: Database;
  logger: Logger;
}

export const ANONYMISED_SIGNER_NAME = 'Anonymised user';

/** The cascade body — pure so tests can call it without BullMQ. */
export async function runUserAnonymisationCascade(
  db: Database,
  tenantId: string,
  userId: string,
): Promise<{ sessions: number; accounts: number; signatures: number; notifications: number }> {
  const sessions = await db.delete(session).where(eq(session.userId, userId)).returning();
  const accounts = await db.delete(account).where(eq(account.userId, userId)).returning();
  await db.delete(twoFactor).where(eq(twoFactor.userId, userId));

  // Signature slots: keep the signed fact, blank the stroke + name snapshot.
  const sigs = await db
    .update(inspectionSignatures)
    .set({ signerName: ANONYMISED_SIGNER_NAME, signatureData: '' })
    .where(
      and(
        eq(inspectionSignatures.tenantId, tenantId),
        eq(inspectionSignatures.signerUserId, userId),
      ),
    )
    .returning();

  // Signature-workflow signer rows: same principle (nullable stroke data).
  await db
    .update(inspectionWorkflowSigners)
    .set({ signatureData: null })
    .where(
      and(
        eq(inspectionWorkflowSigners.tenantId, tenantId),
        eq(inspectionWorkflowSigners.signerUserId, userId),
      ),
    );

  // Heads Up sign-offs.
  await db
    .update(headsUpRecipients)
    .set({ signatureData: null })
    .where(and(eq(headsUpRecipients.tenantId, tenantId), eq(headsUpRecipients.userId, userId)));

  const notifs = await db
    .delete(notifications)
    .where(and(eq(notifications.tenantId, tenantId), eq(notifications.userId, userId)))
    .returning();

  return {
    sessions: sessions.length,
    accounts: accounts.length,
    signatures: sigs.length,
    notifications: notifs.length,
  };
}

export function createUserAnonymisationHandler(deps: UserAnonymisationDeps) {
  return async function handleUserAnonymisation(job: Job<UserAnonymisationPayload>): Promise<void> {
    const { tenantId, userId, actorId } = job.data;
    const log = deps.logger.child({ job_id: job.id, tenantId, userId, actorId });
    const result = await runUserAnonymisationCascade(deps.db, tenantId, userId);
    log.info(result, '[user-anonymisation] cascade complete');
  };
}
