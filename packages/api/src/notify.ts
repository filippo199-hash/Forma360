/**
 * In-app notification writes (platform HSE review PF-23) + per-user
 * notification-preference gates (settings → notifications).
 *
 * One tiny helper the email-sending code paths call alongside the email, so
 * the bell and the inbox never disagree with what was sent. Writes are
 * best-effort: a notification-insert failure must never fail the mutation
 * that triggered it (the email path already has its own error handling).
 *
 * Both channels are user-preference gated against the catalogue at
 * `@forma360/shared/notification-catalogue`:
 *   - `notifyInApp` / `notifyInAppMany` check the `inapp:<kind>` pref
 *     themselves — every present and future call site is covered here,
 *     a writer cannot forget the check;
 *   - email call sites gate with `notificationEnabled(prefs, kind,
 *     'email')` when they already hold the user row, or
 *     `loadNotificationPrefs` + `emailEnabledFor` when they only have ids.
 */
import type { Database } from '@forma360/db/client';
import { notifications, user } from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import type { NotificationKind } from '@forma360/shared/notification-catalogue';
import { notificationEnabled } from '@forma360/shared/notification-catalogue';
import { and, eq, inArray } from 'drizzle-orm';

export interface InAppNotification {
  tenantId: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  /** Locale-relative in-app target, e.g. `/actions/01H…`. */
  href?: string;
}

/**
 * Write one bell row, unless the recipient muted this kind's in-app
 * channel. Pass `prefs` when the caller already loaded the user row —
 * otherwise the helper reads them itself.
 */
export async function notifyInApp(
  db: Database,
  n: InAppNotification,
  prefs?: Record<string, boolean>,
): Promise<void> {
  try {
    let resolved = prefs;
    if (resolved === undefined) {
      const rows = await db
        .select({ notificationPrefs: user.notificationPrefs })
        .from(user)
        .where(and(eq(user.tenantId, n.tenantId), eq(user.id, n.userId)))
        .limit(1);
      resolved = rows[0]?.notificationPrefs ?? {};
    }
    if (!notificationEnabled(resolved, n.kind, 'inapp')) return;
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
  const distinct = [...new Set(userIds)];
  if (distinct.length === 0) return;
  try {
    const prefsById = await loadNotificationPrefs(db, n.tenantId, distinct);
    for (const userId of distinct) {
      await notifyInApp(db, { ...n, userId }, prefsById.get(userId) ?? {});
    }
  } catch {
    // Best-effort by contract.
  }
}

/**
 * Bulk-load `notificationPrefs` for a set of users in one query. For email
 * gates in fan-out paths that only hold user ids.
 */
export async function loadNotificationPrefs(
  db: Database,
  tenantId: string,
  userIds: readonly string[],
): Promise<Map<string, Record<string, boolean>>> {
  const distinct = [...new Set(userIds)];
  if (distinct.length === 0) return new Map();
  const rows = await db
    .select({ id: user.id, notificationPrefs: user.notificationPrefs })
    .from(user)
    .where(and(eq(user.tenantId, tenantId), inArray(user.id, distinct)));
  return new Map(rows.map((r) => [r.id, r.notificationPrefs]));
}

/**
 * Email-channel gate over a `loadNotificationPrefs` map. A user missing
 * from the map (e.g. a free-text recipient with no user row) is treated as
 * enabled — there is no preference to honour.
 */
export function emailEnabledFor(
  prefsById: ReadonlyMap<string, Record<string, boolean>>,
  userId: string,
  kind: NotificationKind,
): boolean {
  return notificationEnabled(prefsById.get(userId) ?? {}, kind, 'email');
}
