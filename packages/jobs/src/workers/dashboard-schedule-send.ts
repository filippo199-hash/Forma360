/**
 * Handler for `forma360-dashboard-schedule-send` (ADR 0018).
 *
 * Delivers ONE occurrence of ONE dashboard schedule: re-load the
 * schedule + dashboard (state may have changed since the tick), render
 * the PDF via the injected renderer, email every recipient with the PDF
 * attached, and only AFTER every send stamp
 * `lastSentAt = occurrenceAt`.
 *
 * Notify-then-stamp (the IN-A1 lesson): a failing send is logged and
 * RETHROWN so BullMQ retries the job with the stamp unset. A retry may
 * re-send to recipients who already got the mail — a duplicate report
 * beats a silently missing one. The stamp is never written before the
 * sends.
 *
 * Skips (successful no-ops, not failures): schedule deleted, schedule
 * paused, dashboard no longer published, occurrence at or before the
 * dedupe cursor. Each is a legitimate state the world reached between
 * tick and send.
 */
import type { Database } from '@forma360/db/client';
import { dashboardSchedules, dashboards } from '@forma360/db/schema';
import { appLink } from '@forma360/shared/app-link';
import type { Logger } from '@forma360/shared/logger';
import type { Job } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import type { DashboardScheduleSendPayload } from '../queues';

export interface DashboardScheduleSendDeps {
  db: Database;
  logger: Logger;
  appUrl: string;
  /**
   * Render the dashboard PDF and hand back the BYTES for attachment.
   * The worker boot composes `renderDashboardPdf` from @forma360/render
   * with an R2 download of the resulting key; tests stub it.
   */
  renderPdf: (input: {
    tenantId: string;
    dashboardId: string;
  }) => Promise<{ bytes: Uint8Array; stub: boolean }>;
  /** Send one templated email with the PDF attached. Injected so tests fake it. */
  notify: (
    to: string,
    input: {
      dashboardTitle: string;
      viewUrl: string;
      attachment: { filename: string; content: Uint8Array };
    },
  ) => Promise<void>;
  /** Overridable clock for tests. */
  now?: () => Date;
}

export type DashboardSendResult =
  | { sent: number }
  | { sent: 0; skipped: 'missing' | 'paused' | 'not-published' | 'already-sent' };

/** Filesystem-friendly attachment name from the dashboard title. */
export function dashboardPdfFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug.length > 0 ? slug : 'dashboard'}.pdf`;
}

export async function runDashboardScheduleSend(
  deps: DashboardScheduleSendDeps,
  payload: DashboardScheduleSendPayload,
): Promise<DashboardSendResult> {
  const now = deps.now?.() ?? new Date();
  const occurrenceAt = new Date(payload.occurrenceAt);
  const log = deps.logger.child({
    scheduleId: payload.scheduleId,
    occurrenceAt: payload.occurrenceAt,
  });

  const rows = await deps.db
    .select({
      schedule: dashboardSchedules,
      dashboardId: dashboards.id,
      dashboardTitle: dashboards.title,
      dashboardStatus: dashboards.status,
    })
    .from(dashboardSchedules)
    .innerJoin(dashboards, eq(dashboards.id, dashboardSchedules.dashboardId))
    .where(eq(dashboardSchedules.id, payload.scheduleId))
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    log.warn('[dashboard-schedule-send] schedule not found — skipping');
    return { sent: 0, skipped: 'missing' };
  }
  const { schedule } = row;
  if (schedule.paused) {
    log.info('[dashboard-schedule-send] paused — skipping');
    return { sent: 0, skipped: 'paused' };
  }
  if (row.dashboardStatus !== 'published') {
    log.info('[dashboard-schedule-send] dashboard not published — skipping');
    return { sent: 0, skipped: 'not-published' };
  }
  // Dedupe: the cursor may have advanced past this occurrence (a
  // concurrent send, or a re-delivered job) — a repeat is a no-op.
  if (schedule.lastSentAt !== null && occurrenceAt.getTime() <= schedule.lastSentAt.getTime()) {
    log.info('[dashboard-schedule-send] occurrence already sent — skipping');
    return { sent: 0, skipped: 'already-sent' };
  }

  const rendered = await deps.renderPdf({
    tenantId: schedule.tenantId,
    dashboardId: row.dashboardId,
  });
  const attachment = {
    filename: dashboardPdfFilename(row.dashboardTitle),
    content: rendered.bytes,
  };
  // Recipients are free-text external addresses (ADR 0018) — no user
  // rows, no locale; the email goes out in English with a default-locale
  // link. The dispatcher's undeliverable-address guard still applies.
  const viewUrl = appLink(deps.appUrl, null, `/dashboards/${row.dashboardId}`);

  let sent = 0;
  for (const recipient of schedule.recipients) {
    try {
      await deps.notify(recipient, {
        dashboardTitle: row.dashboardTitle,
        viewUrl,
        attachment,
      });
      sent += 1;
    } catch (err) {
      // Log + rethrow so BullMQ retries; the stamp below never ran, so
      // the occurrence is still owed (IN-A1 — never stamp before send).
      log.error({ err, sent }, '[dashboard-schedule-send] notify failed — will retry');
      throw err;
    }
  }

  await deps.db
    .update(dashboardSchedules)
    .set({ lastSentAt: occurrenceAt, updatedAt: now })
    .where(
      and(eq(dashboardSchedules.id, schedule.id), eq(dashboardSchedules.tenantId, schedule.tenantId)),
    );

  log.info({ sent, stub: rendered.stub }, '[dashboard-schedule-send] delivered');
  return { sent };
}

/** BullMQ job wrapper. */
export function createDashboardScheduleSendHandler(deps: DashboardScheduleSendDeps) {
  return async (job: Job<DashboardScheduleSendPayload>): Promise<DashboardSendResult> =>
    runDashboardScheduleSend(deps, job.data);
}
