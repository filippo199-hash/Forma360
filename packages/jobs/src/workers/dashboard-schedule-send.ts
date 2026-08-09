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
import { dashboardSchedules, dashboards, tenants } from '@forma360/db/schema';
import { appLink } from '@forma360/shared/app-link';
import { settingsHaveEntitlement } from '@forma360/shared/entitlements';
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
  | { sent: number; failed?: number }
  | {
      sent: 0;
      skipped: 'missing' | 'paused' | 'not-published' | 'already-sent' | 'not-entitled';
    };

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
      tenantSettings: tenants.settings,
    })
    .from(dashboardSchedules)
    .innerJoin(dashboards, eq(dashboards.id, dashboardSchedules.dashboardId))
    .innerJoin(tenants, eq(tenants.id, dashboardSchedules.tenantId))
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
  // A downgraded tenant stops delivering, automatically and immediately —
  // the send worker is the single choke point, so a plan change halts
  // external emails without needing the admin (who can no longer reach the
  // entitlement-gated schedule UI) to pause anything (ADR 0018).
  if (!settingsHaveEntitlement(row.tenantSettings, 'customDashboards')) {
    log.info('[dashboard-schedule-send] tenant not entitled — skipping');
    return { sent: 0, skipped: 'not-entitled' };
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
  // Never email the "Render engine not configured" stub to external
  // recipients. Throw BEFORE any send so the stamp stays unset and BullMQ
  // retries; a persistently-misconfigured renderer then surfaces via the
  // failed-job Sentry hook rather than mailing a broken report.
  if (rendered.stub) {
    log.error('[dashboard-schedule-send] PDF rendered as stub — refusing to email; will retry');
    throw new Error('dashboard PDF rendered as stub — render engine not configured');
  }
  const attachment = {
    filename: dashboardPdfFilename(row.dashboardTitle),
    content: rendered.bytes,
  };
  // Recipients are free-text external addresses (ADR 0018) — no user
  // rows, no locale; the email goes out in English with a default-locale
  // link. The dispatcher's undeliverable-address guard still applies.
  const viewUrl = appLink(deps.appUrl, null, `/dashboards/${row.dashboardId}`);

  // Per-recipient isolation (the IN-A1 lesson): one persistently-rejected
  // address must not, by rethrowing, cause BullMQ to re-send to every
  // earlier recipient on retry. So we send each independently, stamp the
  // dedupe cursor when AT LEAST ONE succeeds (partial delivery is
  // recorded, not retried), and rethrow only when EVERY send fails — an
  // all-fail occurrence is still owed and retries cleanly with no stamp.
  let sent = 0;
  let failed = 0;
  for (const recipient of schedule.recipients) {
    try {
      await deps.notify(recipient, {
        dashboardTitle: row.dashboardTitle,
        viewUrl,
        attachment,
      });
      sent += 1;
    } catch (err) {
      failed += 1;
      log.error(
        { err, recipientFailures: failed },
        '[dashboard-schedule-send] recipient send failed',
      );
    }
  }

  if (sent === 0 && failed > 0) {
    // Total failure — leave the stamp unset and retry the whole occurrence.
    throw new Error(`dashboard-schedule-send: all ${failed} recipient sends failed`);
  }

  await deps.db
    .update(dashboardSchedules)
    .set({ lastSentAt: occurrenceAt, updatedAt: now })
    .where(
      and(
        eq(dashboardSchedules.id, schedule.id),
        eq(dashboardSchedules.tenantId, schedule.tenantId),
      ),
    );

  log.info({ sent, failed, stub: rendered.stub }, '[dashboard-schedule-send] delivered');
  return failed > 0 ? { sent, failed } : { sent };
}

/** BullMQ job wrapper. */
export function createDashboardScheduleSendHandler(deps: DashboardScheduleSendDeps) {
  return async (job: Job<DashboardScheduleSendPayload>): Promise<DashboardSendResult> =>
    runDashboardScheduleSend(deps, job.data);
}
