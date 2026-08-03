/**
 * In-app notification writes (platform HSE review PF-23).
 *
 * One tiny helper the email-sending code paths call alongside the email, so
 * the bell and the inbox never disagree with what was sent. Writes are
 * best-effort: a notification-insert failure must never fail the mutation
 * that triggered it (the email path already has its own error handling).
 *
 * Kinds in use (grep for `notifyInApp` to extend):
 *   action_assigned · approval_pending · approval_decided · heads_up ·
 *   issue_reported · schedule_missed · action_due · document_expiry
 */
import type { Database } from '@forma360/db/client';
import { notifications } from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';

export interface InAppNotification {
  tenantId: string;
  userId: string;
  kind: string;
  title: string;
  body?: string;
  /** Locale-relative in-app target, e.g. `/actions/01H…`. */
  href?: string;
}

export async function notifyInApp(db: Database, n: InAppNotification): Promise<void> {
  try {
    await db.insert(notifications).values({
      id: newId(),
      tenantId: n.tenantId,
      userId: n.userId,
      kind: n.kind,
      title: n.title.slice(0, 500),
      body: (n.body ?? '').slice(0, 2000),
      href: n.href ?? null,
    });
  } catch {
    // Best-effort by contract — the triggering mutation must not fail.
  }
}

/** Fan a notification out to several users (deduped user ids). */
export async function notifyInAppMany(
  db: Database,
  userIds: readonly string[],
  n: Omit<InAppNotification, 'userId'>,
): Promise<void> {
  for (const userId of new Set(userIds)) {
    await notifyInApp(db, { ...n, userId });
  }
}
