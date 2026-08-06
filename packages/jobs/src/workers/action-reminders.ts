/**
 * Handler for `forma360-action-reminders` (platform HSE review PF-4):
 * the module that tracks the corrective actions themselves was the one
 * module that never told anyone anything. Once a day, every assignee
 * with actionable work gets ONE email covering:
 *
 *   - actions due within the next {DUE_SOON_DAYS} days (warned once —
 *     stamped on `due_soon_reminded_at`)
 *   - overdue actions (re-pinged at most weekly via
 *     `overdue_reminded_at`, because an overdue corrective action that
 *     goes quiet after one email is how backlogs rot)
 *
 * Assignment emails are transactional and sent by the router at the
 * moment of assignment; this worker owns the calendar.
 */
import type { Database } from '@forma360/db/client';
import { actions, user } from '@forma360/db/schema';
import { notifyInApp } from '@forma360/api/notify';
import type { Logger } from '@forma360/shared/logger';
import type { Job } from 'bullmq';
import { and, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';

export const ACTION_REMINDERS_CRON = '30 6 * * *'; // daily, 06:30 UTC
export const DUE_SOON_DAYS = 3;
/** Overdue re-ping cadence — weekly, not daily. */
export const OVERDUE_REPING_DAYS = 7;

export interface DueActionRow {
  actionId: string;
  tenantId: string;
  referenceNumber: string | null;
  title: string;
  dueAt: Date;
  assigneeUserId: string;
  bucket: 'due_soon' | 'overdue';
}

/**
 * Everything that needs a reminder today, across all tenants. Pure —
 * the handler and the tests share it.
 */
export async function findActionsNeedingReminder(db: Database, now: Date): Promise<DueActionRow[]> {
  const soonCutoff = new Date(now.getTime() + DUE_SOON_DAYS * 24 * 60 * 60 * 1000);
  const repingCutoff = new Date(now.getTime() - OVERDUE_REPING_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      actionId: actions.id,
      tenantId: actions.tenantId,
      referenceNumber: actions.referenceNumber,
      title: actions.title,
      dueAt: actions.dueAt,
      assigneeUserId: actions.assigneeUserId,
      dueSoonRemindedAt: actions.dueSoonRemindedAt,
      overdueRemindedAt: actions.overdueRemindedAt,
    })
    .from(actions)
    .where(
      and(
        inArray(actions.status, ['open', 'in_progress']),
        isNull(actions.archivedAt),
        isNotNull(actions.dueAt),
        isNotNull(actions.assigneeUserId),
        lte(actions.dueAt, soonCutoff),
        or(
          // Overdue: never pinged, or last ping older than the cadence.
          and(
            lt(actions.dueAt, now),
            or(isNull(actions.overdueRemindedAt), lt(actions.overdueRemindedAt, repingCutoff)),
          ),
          // Due soon (but not yet due): warned once only.
          and(sql`${actions.dueAt} >= ${now}`, isNull(actions.dueSoonRemindedAt)),
        ),
      ),
    );
  return rows.flatMap((r) => {
    if (r.dueAt === null || r.assigneeUserId === null) return [];
    return [
      {
        actionId: r.actionId,
        tenantId: r.tenantId,
        referenceNumber: r.referenceNumber,
        title: r.title,
        dueAt: r.dueAt,
        assigneeUserId: r.assigneeUserId,
        bucket: r.dueAt < now ? ('overdue' as const) : ('due_soon' as const),
      },
    ];
  });
}

export interface ActionRemindersDeps {
  db: Database;
  logger: Logger;
  appUrl: string;
  /** Send one digest email to one assignee. Injected; tests fake it. */
  notify: (
    recipient: { email: string; name: string; locale?: string | null },
    payload: {
      tenantId: string;
      overdue: DueActionRow[];
      dueSoon: DueActionRow[];
      viewUrl: string;
    },
  ) => Promise<void>;
  now?: () => Date;
}

/**
 * Group by (tenant, assignee), send one email each, stamp ONLY the
 * actions that were part of a delivered email — a failed send leaves
 * everything unstamped so tomorrow retries (PF-1 lesson: never mark
 * told when nobody was).
 */
export async function runActionReminders(
  deps: ActionRemindersDeps,
): Promise<{ emails: number; reminded: number }> {
  const now = deps.now?.() ?? new Date();
  const due = await findActionsNeedingReminder(deps.db, now);
  if (due.length === 0) {
    deps.logger.info({ emails: 0 }, '[action-reminders] nothing due');
    return { emails: 0, reminded: 0 };
  }

  const byAssignee = new Map<string, DueActionRow[]>();
  for (const row of due) {
    const key = `${row.tenantId}:${row.assigneeUserId}`;
    const bucket = byAssignee.get(key);
    if (bucket === undefined) byAssignee.set(key, [row]);
    else bucket.push(row);
  }

  const userIds = [...new Set(due.map((r) => r.assigneeUserId))];
  const userRows = await deps.db
    .select({
      id: user.id,
      tenantId: user.tenantId,
      name: user.name,
      email: user.email,
      locale: user.locale,
      notificationPrefs: user.notificationPrefs,
      deactivatedAt: user.deactivatedAt,
    })
    .from(user)
    .where(inArray(user.id, userIds));
  const usersById = new Map(userRows.map((u) => [`${u.tenantId}:${u.id}`, u]));

  let emails = 0;
  let reminded = 0;
  for (const [key, rows] of byAssignee) {
    const recipient = usersById.get(key);
    if (
      recipient === undefined ||
      recipient.deactivatedAt !== null ||
      recipient.email.length === 0
    ) {
      continue;
    }
    const overdue = rows.filter((r) => r.bucket === 'overdue');
    const dueSoon = rows.filter((r) => r.bucket === 'due_soon');
    // PF-23: the bell always learns; the pref only silences the email.
    await notifyInApp(deps.db, {
      tenantId: rows[0]?.tenantId ?? '',
      userId: recipient.id,
      kind: 'action_due',
      title: `${overdue.length + dueSoon.length} action(s) need attention`,
      body: `${overdue.length} overdue, ${dueSoon.length} due soon`,
      href: '/actions?mine=1',
    });
    if (recipient.notificationPrefs['emailActionReminders'] === false) {
      reminded += rows.length;
      await stampReminded(deps.db, overdue, dueSoon, now);
      continue;
    }
    try {
      await deps.notify(
        { email: recipient.email, name: recipient.name, locale: recipient.locale },
        {
          tenantId: rows[0]?.tenantId ?? '',
          overdue,
          dueSoon,
          viewUrl: `${deps.appUrl.replace(/\/+$/, '')}/en/actions`,
        },
      );
    } catch (err) {
      deps.logger.error(
        { err, assignee: key },
        '[action-reminders] notify failed — stamps withheld for retry',
      );
      continue;
    }
    emails += 1;
    reminded += rows.length;
    await stampReminded(deps.db, overdue, dueSoon, now);
  }
  deps.logger.info({ emails, reminded }, '[action-reminders] run complete');
  return { emails, reminded };
}

/** Stamp both reminder buckets — shared by the email and email-muted paths. */
async function stampReminded(
  db: Database,
  overdue: DueActionRow[],
  dueSoon: DueActionRow[],
  now: Date,
): Promise<void> {
  const overdueIds = overdue.map((r) => r.actionId);
  const dueSoonIds = dueSoon.map((r) => r.actionId);
  if (overdueIds.length > 0) {
    await db.update(actions).set({ overdueRemindedAt: now }).where(inArray(actions.id, overdueIds));
  }
  if (dueSoonIds.length > 0) {
    await db.update(actions).set({ dueSoonRemindedAt: now }).where(inArray(actions.id, dueSoonIds));
  }
}

/** Plain-text line block for the email body. */
export function actionDigestLines(overdue: DueActionRow[], dueSoon: DueActionRow[]): string {
  const line = (r: DueActionRow, tag: string) =>
    `${tag} — ${r.referenceNumber ?? ''} ${r.title} (due ${r.dueAt.toISOString().slice(0, 10)})`.replace(
      '  ',
      ' ',
    );
  return [
    ...overdue.map((r) => line(r, 'OVERDUE')),
    ...dueSoon.map((r) => line(r, 'Due soon')),
  ].join('\n');
}

export function createActionRemindersHandler(deps: ActionRemindersDeps) {
  return async (_job: Job): Promise<{ emails: number; reminded: number }> => {
    return runActionReminders(deps);
  };
}
