/**
 * BullMQ worker process.
 *
 * This is the long-running Railway `worker` service's entry point. It:
 *   1. Parses env via @forma360/shared/env (fails fast if misconfigured).
 *   2. Builds a shared pino logger and opens a single ioredis connection.
 *   3. Constructs one BullMQ Worker per queue with its handler.
 *   4. Registers repeatable schedules (pg-dump nightly) idempotently via
 *      upsertJobScheduler.
 *   5. Handles SIGTERM / SIGINT by closing workers and queues cleanly.
 */
import { getBrand } from '@forma360/shared/brand';
import { parseServerEnv } from '@forma360/shared/env';
import { createLogger, type Logger } from '@forma360/shared/logger';
import * as Sentry from '@sentry/node';
import { Worker, type WorkerOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { createDb, poolErrorFields } from '@forma360/db/client';
import { closeAllQueues, DEFAULT_JOB_OPTIONS, getQueue, QUEUE_NAMES } from './queues';
import { createGroupReconcileHandler } from './workers/group-membership-reconcile';
import { createPgDumpHandler, PG_DUMP_CRON } from './workers/pg-dump-nightly';
import { createScheduleMaterialiseHandler } from './workers/schedule-materialise';
import { createScheduleReminderHandler } from './workers/schedule-reminder';
import { createScheduleTickHandler, SCHEDULE_TICK_CRON } from './workers/schedule-tick';
import { createSiteReconcileHandler } from './workers/site-membership-reconcile';
import { createTestQueueHandler } from './workers/test-queue';
import { createUserAnonymisationHandler } from './workers/user-anonymisation';
import { createSendEmail, createSendTemplatedEmail } from '@forma360/shared/email';
import {
  createContractorDocReminderHandler,
  CONTRACTOR_DOC_REMINDER_CRON,
  type DueReminder,
} from './workers/contractor-doc-reminder';
import {
  createContractorOverstayHandler,
  CONTRACTOR_OVERSTAY_CRON,
  type OverstayRecipient,
  type OverstayVisit,
} from './workers/contractor-overstay';
import { createObservationNotifyHandler } from './workers/observation-notify';
import {
  createRaAckReminderHandler,
  RA_ACK_REMINDER_CRON,
  type PendingAckReminder,
} from './workers/ra-ack-reminder';
import {
  createPermitExpiryWatchHandler,
  PERMIT_EXPIRY_WATCH_CRON,
  type ExpiredOpenPermit,
  type PermitWatchKind,
} from './workers/permit-expiry-watch';
import {
  createFireDueDigestHandler,
  digestDetailLines,
  FIRE_DUE_DIGEST_CRON,
  type FireDigest,
} from './workers/fire-due-digest';
import { createIncidentAlertHandler, type AlertIncident } from './workers/incident-alert';
import {
  createIncidentRiddorWatchHandler,
  INCIDENT_RIDDOR_WATCH_CRON,
  type RiddorWatchIncident,
  type RiddorWatchKind,
} from './workers/incident-riddor-watch';
import {
  chaseDetailLines,
  createIncidentChaseHandler,
  INCIDENT_CHASE_CRON,
  type IncidentChaseDigest,
} from './workers/incident-chase';
import {
  actionDigestLines,
  ACTION_REMINDERS_CRON,
  createActionRemindersHandler,
  type DueActionRow,
} from './workers/action-reminders';
import { createHeadsUpPublishHandler, HEADS_UP_PUBLISH_CRON } from './workers/heads-up-publish';
import {
  createDocumentExpiryHandler,
  DOCUMENT_EXPIRY_CRON,
  type ExpiringDocument,
} from './workers/document-expiry';
import {
  createScheduleMissedSweepHandler,
  missedLines,
  SCHEDULE_MISSED_SWEEP_CRON,
  type MissedOccurrence,
} from './workers/schedule-missed-sweep';
import { createRetentionSweepHandler, RETENTION_SWEEP_CRON } from './workers/retention-sweep';
import { createSandboxTtlSweepHandler, SANDBOX_TTL_SWEEP_CRON } from './workers/sandbox-ttl-sweep';
import {
  createTrainingExpiryHandler,
  TRAINING_EXPIRY_CRON,
  type DueTrainingReminder,
} from './workers/training-expiry';
import {
  createDashboardScheduleTickHandler,
  DASHBOARD_SCHEDULE_TICK_CRON,
} from './workers/dashboard-schedule-tick';
import { createDashboardScheduleSendHandler } from './workers/dashboard-schedule-send';
import { renderDashboardPdf } from '@forma360/render';
import { createStorage } from '@forma360/shared/storage';

/**
 * Worker queries are allowed to be slower than web ones: reconcile fans out
 * over a whole tenant (G-E02 caps it at 15k users) and the daily digests
 * scan a module end to end. Still bounded — a query that has run for five
 * minutes is stuck, not busy, and it is holding a pool slot while it does.
 */
const WORKER_STATEMENT_TIMEOUT_MS = 300_000;

function buildRedis(url: string, logger: Logger, role: string): Redis {
  // BullMQ requires `maxRetriesPerRequest: null` on the connection it uses
  // for blocking reads (Worker). Without this it raises a warning and falls
  // back to error-and-exit on reconnect churn.
  const connection = new Redis(url, { maxRetriesPerRequest: null });
  // ioredis does not crash the process on an unhandled `error` event — it
  // writes `[ioredis] Unhandled error event` straight to stderr and carries
  // on. That line bypasses pino, so it never reaches the log drain with a
  // service field and never groups in a search. Attaching a listener is
  // what makes a Redis outage legible after the fact (STAB-02).
  connection.on('error', (err: Error) => {
    logger.error({ err, role }, '[worker] redis connection error');
  });
  return connection;
}

export interface StartWorkerDeps {
  logger?: Logger;
}

/**
 * Boot the worker. Exported so tests / scripts can mount it programmatically;
 * the binary entry point below just calls `startWorker({})`.
 */
export async function startWorker(deps: StartWorkerDeps = {}): Promise<{
  shutdown: () => Promise<void>;
}> {
  const env = parseServerEnv();
  const logger =
    deps.logger ?? createLogger({ service: 'worker', level: env.LOG_LEVEL, nodeEnv: env.NODE_ENV });

  logger.info({ queues: Object.values(QUEUE_NAMES) }, '[worker] booting');

  const connection = buildRedis(env.REDIS_URL, logger, 'worker');
  const workerOptions: WorkerOptions = {
    connection,
    // Retry policy itself is a JOB option, not a worker option — it lives in
    // `DEFAULT_JOB_OPTIONS` on the queue (see queues.ts). These two are the
    // worker-side half of the same fix: they bound retention for jobs whose
    // producer did not carry the queue defaults (repeatable jobs added by an
    // older process, for instance), so an unbounded completed-set cannot come
    // back by another route.
    removeOnComplete: DEFAULT_JOB_OPTIONS.removeOnComplete,
    removeOnFail: DEFAULT_JOB_OPTIONS.removeOnFail,
    // One worker process serves ~25 queues. Left unset, BullMQ runs one job at
    // a time per queue, which is fine — but a PDF-rendering handler can hold a
    // Chromium page for seconds, so give the pool a little room while keeping
    // it well under the render semaphore's own cap of 2.
    concurrency: 4,
  };

  const testWorker = new Worker(
    QUEUE_NAMES.TEST,
    createTestQueueHandler(logger.child({ handler: 'test-queue' })),
    workerOptions,
  );

  const pgDumpWorker = new Worker(
    QUEUE_NAMES.BACKUPS,
    createPgDumpHandler({
      databaseUrl: env.DATABASE_URL,
      logger: logger.child({ handler: 'pg-dump-nightly' }),
      r2: {
        accountId: env.R2_ACCOUNT_ID,
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
        bucket: env.R2_BUCKET,
      },
    }),
    workerOptions,
  );

  // Worker-side db client — the reconcile handlers need direct DB access.
  // Separate from the web app's pool so the two don't share a connection
  // count cap.
  //
  // `onPoolError` is the crash fix (STAB-01): a pool with no `'error'`
  // listener kills the worker process when an idle connection dies, which
  // is exactly what a Postgres restart does. BullMQ would then have to
  // recover every in-flight job on the next boot.
  //
  // The statement timeout is deliberately looser than the web default:
  // reconcile fans out over every user in a tenant (the G-E02 cap is
  // 15k) and a nightly digest scans a whole module, both of which are
  // legitimately slower than any HTTP request.
  const { db: workerDb } = createDb(env.DATABASE_URL, {
    max: env.DB_POOL_MAX,
    statementTimeoutMs: WORKER_STATEMENT_TIMEOUT_MS,
    applicationName: 'forma360-worker',
    onPoolError: (err) => {
      logger.error(poolErrorFields(err), '[worker] idle pool client error');
    },
  });

  const groupReconcileWorker = new Worker(
    QUEUE_NAMES.GROUP_RECONCILE,
    createGroupReconcileHandler({
      db: workerDb,
      logger: logger.child({ handler: 'group-reconcile' }),
    }),
    workerOptions,
  );

  const siteReconcileWorker = new Worker(
    QUEUE_NAMES.SITE_RECONCILE,
    createSiteReconcileHandler({
      db: workerDb,
      logger: logger.child({ handler: 'site-reconcile' }),
    }),
    workerOptions,
  );

  const userAnonymisationWorker = new Worker(
    QUEUE_NAMES.USER_ANONYMISATION,
    createUserAnonymisationHandler({
      db: workerDb,
      logger: logger.child({ handler: 'user-anonymisation' }),
    }),
    workerOptions,
  );

  // ─── Phase 2 PR 32 — schedules ─────────────────────────────────────────
  const scheduleTickWorker = new Worker(
    QUEUE_NAMES.SCHEDULE_TICK,
    createScheduleTickHandler({
      db: workerDb,
      logger: logger.child({ handler: 'schedule-tick' }),
      connection,
    }),
    workerOptions,
  );

  const scheduleMaterialiseWorker = new Worker(
    QUEUE_NAMES.SCHEDULE_MATERIALISE,
    createScheduleMaterialiseHandler({
      db: workerDb,
      logger: logger.child({ handler: 'schedule-materialise' }),
      connection,
    }),
    workerOptions,
  );

  const sendEmail = createSendEmail({
    delivery: env.EMAIL_DELIVERY,
    resendApiKey: env.RESEND_API_KEY,
    resendFrom: env.RESEND_FROM,
    logger: logger.child({ component: 'email' }),
    productName: getBrand(env.BRAND).name,
  });

  const scheduleReminderWorker = new Worker(
    QUEUE_NAMES.SCHEDULE_REMINDER,
    createScheduleReminderHandler({
      db: workerDb,
      logger: logger.child({ handler: 'schedule-reminder' }),
      sendEmail,
      appUrl: env.APP_URL,
    }),
    workerOptions,
  );

  const sendTemplatedEmail = createSendTemplatedEmail({
    delivery: env.EMAIL_DELIVERY,
    resendApiKey: env.RESEND_API_KEY,
    resendFrom: env.RESEND_FROM,
    logger: logger.child({ component: 'email-templated' }),
    productName: getBrand(env.BRAND).name,
  });

  // ─── Contractors Phase 1 — compliance-document expiry reminders ─────────
  const contractorReminderWorker = new Worker(
    QUEUE_NAMES.CONTRACTOR_DOC_REMINDER,
    createContractorDocReminderHandler({
      db: workerDb,
      logger: logger.child({ handler: 'contractor-doc-reminder' }),
      appUrl: env.APP_URL,
      notify: async (r: DueReminder, uploadUrl: string) => {
        await sendTemplatedEmail({
          to: r.email,
          // CT-O03: five translated templates shipped on disk and were never
          // reachable, because the loader was never told a locale.
          locale: r.locale ?? undefined,
          templateKey: 'contractor-doc-expiry',
          variables: {
            contractorName: r.contractorName,
            requirementName: r.requirementName,
            expiresOn: r.endDate,
            url: uploadUrl,
          },
        });
      },
    }),
    workerOptions,
  );
  const contractorReminderQueue = getQueue(QUEUE_NAMES.CONTRACTOR_DOC_REMINDER, connection);
  await contractorReminderQueue.upsertJobScheduler(
    'contractor-doc-reminder',
    { pattern: CONTRACTOR_DOC_REMINDER_CRON, tz: 'UTC' },
    { name: 'contractor-doc-reminder', data: {} },
  );
  logger.info(
    { cron: CONTRACTOR_DOC_REMINDER_CRON },
    '[worker] registered contractor-doc-reminder repeatable',
  );

  // ─── Contractors Phase 2 — overstay (>24h on site) alerts ──────────────
  const contractorOverstayWorker = new Worker(
    QUEUE_NAMES.CONTRACTOR_OVERSTAY,
    createContractorOverstayHandler({
      db: workerDb,
      logger: logger.child({ handler: 'contractor-overstay' }),
      appUrl: env.APP_URL,
      notify: async (v: OverstayVisit, recipient: OverstayRecipient, boardUrl: string) => {
        await sendTemplatedEmail({
          to: recipient.email,
          locale: recipient.locale ?? undefined,
          templateKey: 'contractor-overstay',
          // CT-O03: bare values only. `siteLine` used to arrive as the
          // English fragment ` at Warehouse 2` and `who` as `A visitor`,
          // both interpolated straight into translated bodies — so the
          // Italian mail read "Visita: Rewire at Warehouse 2". Every label
          // and connector now lives in the per-locale template; `—` is the
          // house placeholder (see the incident-alert wiring).
          variables: {
            who: v.visitorName ?? '—',
            contractorName: v.contractorName,
            title: v.title,
            siteName: v.siteName ?? '—',
            checkedInAt: v.checkedInAt.toISOString().replace('T', ' ').slice(0, 16),
            url: boardUrl,
          },
        });
      },
    }),
    workerOptions,
  );
  const contractorOverstayQueue = getQueue(QUEUE_NAMES.CONTRACTOR_OVERSTAY, connection);
  await contractorOverstayQueue.upsertJobScheduler(
    'contractor-overstay',
    { pattern: CONTRACTOR_OVERSTAY_CRON, tz: 'UTC' },
    { name: 'contractor-overstay', data: {} },
  );
  logger.info(
    { cron: CONTRACTOR_OVERSTAY_CRON },
    '[worker] registered contractor-overstay repeatable',
  );

  // ─── Phase 3 — Observation notifications ───────────────────────────────
  const observationNotifyWorker = new Worker(
    QUEUE_NAMES.OBSERVATION_NOTIFY,
    createObservationNotifyHandler({
      db: workerDb,
      logger: logger.child({ handler: 'observation-notify' }),
      sendTemplatedEmail,
      appUrl: env.APP_URL,
    }),
    workerOptions,
  );

  // ─── FreeHS B1 — risk-assessment acknowledgement chase (A-3) ───────────
  const raAckReminderWorker = new Worker(
    QUEUE_NAMES.RA_ACK_REMINDER,
    createRaAckReminderHandler({
      db: workerDb,
      logger: logger.child({ handler: 'ra-ack-reminder' }),
      appUrl: env.APP_URL,
      notify: async (r: PendingAckReminder, viewUrl: string) => {
        await sendTemplatedEmail({
          to: r.email,
          locale: r.locale ?? undefined,
          templateKey: 'risk-assessment-ack-reminder',
          variables: {
            recipientName: r.userName,
            title: r.title,
            referenceNumber: r.referenceNumber ?? '',
            distributedDate: r.distributedAt.toISOString().slice(0, 10),
            dueLine: r.dueAt !== null ? ` (due by ${r.dueAt.toISOString().slice(0, 10)})` : '',
            viewUrl,
          },
        });
      },
    }),
    workerOptions,
  );
  const raAckReminderQueue = getQueue(QUEUE_NAMES.RA_ACK_REMINDER, connection);
  await raAckReminderQueue.upsertJobScheduler(
    'ra-ack-reminder',
    { pattern: RA_ACK_REMINDER_CRON, tz: 'UTC' },
    { name: 'ra-ack-reminder', data: {} },
  );
  logger.info({ cron: RA_ACK_REMINDER_CRON }, '[worker] registered ra-ack-reminder repeatable');

  // ─── FreeHS B3 — permit expiry escalation ──────────────────────────────
  const permitExpiryWatchWorker = new Worker(
    QUEUE_NAMES.PERMIT_EXPIRY_WATCH,
    createPermitExpiryWatchHandler({
      db: workerDb,
      logger: logger.child({ handler: 'permit-expiry-watch' }),
      appUrl: env.APP_URL,
      notify: async (
        kind: PermitWatchKind,
        permit: ExpiredOpenPermit,
        recipient: { email: string; name: string; locale?: string | null },
        viewUrl: string,
      ) => {
        await sendTemplatedEmail({
          to: recipient.email,
          locale: recipient.locale ?? undefined,
          templateKey: kind === 'warning' ? 'permit-expiry-warning' : 'permit-expiry-escalation',
          variables: {
            recipientName: recipient.name,
            title: permit.title,
            referenceNumber: permit.referenceNumber ?? '',
            typeName: permit.typeName,
            siteLine: permit.siteName !== null ? ` at ${permit.siteName}` : '',
            expiredAt: permit.validTo.toISOString().replace('T', ' ').slice(0, 16),
            viewUrl,
          },
        });
      },
    }),
    workerOptions,
  );
  const permitExpiryWatchQueue = getQueue(QUEUE_NAMES.PERMIT_EXPIRY_WATCH, connection);
  await permitExpiryWatchQueue.upsertJobScheduler(
    'permit-expiry-watch',
    { pattern: PERMIT_EXPIRY_WATCH_CRON, tz: 'UTC' },
    { name: 'permit-expiry-watch', data: {} },
  );
  logger.info(
    { cron: PERMIT_EXPIRY_WATCH_CRON },
    '[worker] registered permit-expiry-watch repeatable',
  );

  // ─── FreeHS B4 — fire-safety due digest (HSE review FS-3) ─────────────
  const fireDueDigestWorker = new Worker(
    QUEUE_NAMES.FIRE_DUE_DIGEST,
    createFireDueDigestHandler({
      db: workerDb,
      logger: logger.child({ handler: 'fire-due-digest' }),
      appUrl: env.APP_URL,
      notify: async (
        recipient: { email: string; name: string; locale?: string | null },
        digest: FireDigest,
        viewUrl: string,
      ) => {
        const failed = digest.failedChecks.length + digest.failedDoors.length;
        const overdue = digest.overdueChecks.length + digest.overdueDoors.length;
        await sendTemplatedEmail({
          to: recipient.email,
          locale: recipient.locale ?? undefined,
          templateKey: 'fire-due-digest',
          variables: {
            recipientName: recipient.name,
            failedCount: String(failed),
            overdueCount: String(overdue),
            dueSoonCount: String(digest.dueSoonChecks.length),
            fraCount: String(digest.fraReviewsDue.length),
            peepCount: String(digest.peepReviewsDue),
            marshalCount: String(digest.marshalsExpiring),
            detailLines: digestDetailLines(digest),
            viewUrl,
          },
        });
      },
    }),
    workerOptions,
  );
  const fireDueDigestQueue = getQueue(QUEUE_NAMES.FIRE_DUE_DIGEST, connection);
  await fireDueDigestQueue.upsertJobScheduler(
    'fire-due-digest',
    { pattern: FIRE_DUE_DIGEST_CRON, tz: 'UTC' },
    { name: 'fire-due-digest', data: {} },
  );
  logger.info({ cron: FIRE_DUE_DIGEST_CRON }, '[worker] registered fire-due-digest repeatable');

  // ─── FreeHS B5 — incident immediate alert (event-driven) ───────────────
  const kindLabels: Record<string, string> = {
    injury: 'Injury',
    ill_health: 'Ill health',
    dangerous_occurrence: 'Dangerous occurrence',
    sharps_exposure: 'Sharps / splash exposure',
    violence_aggression: 'Violence & aggression',
    damage: 'Damage',
    environmental: 'Environmental',
    near_miss: 'Near miss',
  };
  const incidentAlertWorker = new Worker(
    QUEUE_NAMES.INCIDENT_ALERT,
    createIncidentAlertHandler({
      db: workerDb,
      logger: logger.child({ handler: 'incident-alert' }),
      appUrl: env.APP_URL,
      notify: async (
        recipient: { email: string; name: string; locale: string | null },
        incident: AlertIncident,
        viewUrl: string,
      ) => {
        await sendTemplatedEmail({
          to: recipient.email,
          locale: recipient.locale ?? undefined,
          templateKey: 'incident-alert',
          variables: {
            recipientName: recipient.name,
            referenceNumber: incident.referenceNumber,
            kindLabel: kindLabels[incident.kind] ?? incident.kind,
            severityLabel: incident.severity,
            siteLine: incident.siteName ?? '—',
            occurredAt: incident.occurredAt.toISOString().replace('T', ' ').slice(0, 16),
            viewUrl,
          },
        });
      },
    }),
    workerOptions,
  );

  // ─── FreeHS B5 — RIDDOR deadline watch ─────────────────────────────────
  const riddorCategoryLabels: Record<string, string> = {
    death: 'death',
    specified_injury: 'specified injury',
    non_worker_hospital: 'non-worker taken to hospital',
    over_7_day: 'over-7-day injury',
    occupational_disease: 'occupational disease',
    dangerous_occurrence: 'dangerous occurrence',
    gas_incident: 'gas incident',
  };
  const incidentRiddorWatchWorker = new Worker(
    QUEUE_NAMES.INCIDENT_RIDDOR_WATCH,
    createIncidentRiddorWatchHandler({
      db: workerDb,
      logger: logger.child({ handler: 'incident-riddor-watch' }),
      appUrl: env.APP_URL,
      notify: async (
        kind: RiddorWatchKind,
        incident: RiddorWatchIncident,
        recipient: { email: string; name: string; locale: string | null },
        viewUrl: string,
      ) => {
        const daysLeft = Math.max(
          0,
          Math.ceil((incident.riddorDeadlineAt.getTime() - Date.now()) / 86_400_000),
        );
        await sendTemplatedEmail({
          to: recipient.email,
          locale: recipient.locale ?? undefined,
          templateKey:
            kind === 'escalation' ? 'incident-riddor-escalation' : 'incident-riddor-warning',
          variables: {
            recipientName: recipient.name,
            referenceNumber: incident.referenceNumber,
            categoryLabel: riddorCategoryLabels[incident.riddorCategory] ?? incident.riddorCategory,
            deadlineAt: incident.riddorDeadlineAt.toISOString().replace('T', ' ').slice(0, 16),
            daysLeft: `${daysLeft} day(s)`,
            viewUrl,
          },
        });
      },
    }),
    workerOptions,
  );
  const incidentRiddorWatchQueue = getQueue(QUEUE_NAMES.INCIDENT_RIDDOR_WATCH, connection);
  await incidentRiddorWatchQueue.upsertJobScheduler(
    'incident-riddor-watch',
    { pattern: INCIDENT_RIDDOR_WATCH_CRON, tz: 'UTC' },
    { name: 'incident-riddor-watch', data: {} },
  );
  logger.info(
    { cron: INCIDENT_RIDDOR_WATCH_CRON },
    '[worker] registered incident-riddor-watch repeatable',
  );

  // ─── FreeHS B5 — incident chase digest ─────────────────────────────────
  const incidentChaseWorker = new Worker(
    QUEUE_NAMES.INCIDENT_CHASE,
    createIncidentChaseHandler({
      db: workerDb,
      logger: logger.child({ handler: 'incident-chase' }),
      appUrl: env.APP_URL,
      notify: async (
        recipient: { email: string; name: string; locale: string | null },
        digest: IncidentChaseDigest,
        viewUrl: string,
      ) => {
        const total =
          digest.untriagedIncidents.length +
          digest.idleInvestigations.length +
          digest.overdueActionIncidents.length +
          digest.effectivenessDue.length;
        await sendTemplatedEmail({
          to: recipient.email,
          locale: recipient.locale ?? undefined,
          templateKey: 'incident-chase-digest',
          variables: {
            recipientName: recipient.name,
            totalCount: String(total),
            detailLines: chaseDetailLines(digest),
            viewUrl,
          },
        });
      },
    }),
    workerOptions,
  );
  const incidentChaseQueue = getQueue(QUEUE_NAMES.INCIDENT_CHASE, connection);
  await incidentChaseQueue.upsertJobScheduler(
    'incident-chase',
    { pattern: INCIDENT_CHASE_CRON, tz: 'UTC' },
    { name: 'incident-chase', data: {} },
  );
  logger.info({ cron: INCIDENT_CHASE_CRON }, '[worker] registered incident-chase repeatable');

  // ─── Platform PF-4 — corrective-action reminder digest ────────────────
  const actionRemindersWorker = new Worker(
    QUEUE_NAMES.ACTION_REMINDERS,
    createActionRemindersHandler({
      db: workerDb,
      logger: logger.child({ handler: 'action-reminders' }),
      appUrl: env.APP_URL,
      notify: async (
        recipient: { email: string; name: string; locale?: string | null },
        payload: { overdue: DueActionRow[]; dueSoon: DueActionRow[]; viewUrl: string },
      ) => {
        await sendTemplatedEmail({
          to: recipient.email,
          locale: recipient.locale ?? undefined,
          templateKey: 'action-due-digest',
          variables: {
            recipientName: recipient.name,
            overdueCount: String(payload.overdue.length),
            dueSoonCount: String(payload.dueSoon.length),
            detailLines: actionDigestLines(payload.overdue, payload.dueSoon),
            viewUrl: payload.viewUrl,
          },
        });
      },
    }),
    workerOptions,
  );
  const actionRemindersQueue = getQueue(QUEUE_NAMES.ACTION_REMINDERS, connection);
  await actionRemindersQueue.upsertJobScheduler(
    'action-reminders',
    { pattern: ACTION_REMINDERS_CRON, tz: 'UTC' },
    { name: 'action-reminders', data: {} },
  );
  logger.info({ cron: ACTION_REMINDERS_CRON }, '[worker] registered action-reminders repeatable');

  // ─── Platform PF-15 — scheduled Heads Up publisher ────────────────────
  const headsUpPublishWorker = new Worker(
    QUEUE_NAMES.HEADS_UP_PUBLISH,
    createHeadsUpPublishHandler({
      db: workerDb,
      logger: logger.child({ handler: 'heads-up-publish' }),
    }),
    workerOptions,
  );
  const headsUpPublishQueue = getQueue(QUEUE_NAMES.HEADS_UP_PUBLISH, connection);
  await headsUpPublishQueue.upsertJobScheduler(
    'heads-up-publish',
    { pattern: HEADS_UP_PUBLISH_CRON, tz: 'UTC' },
    { name: 'heads-up-publish', data: {} },
  );
  logger.info({ cron: HEADS_UP_PUBLISH_CRON }, '[worker] registered heads-up-publish repeatable');

  // ─── Platform PF-16 — document expiry reminders ────────────────────────
  const documentExpiryWorker = new Worker(
    QUEUE_NAMES.DOCUMENT_EXPIRY,
    createDocumentExpiryHandler({
      db: workerDb,
      logger: logger.child({ handler: 'document-expiry' }),
      appUrl: env.APP_URL,
      notify: async (
        recipient: { email: string; name: string; locale?: string | null },
        doc: ExpiringDocument,
        viewUrl: string,
      ) => {
        await sendTemplatedEmail({
          to: recipient.email,
          locale: recipient.locale ?? undefined,
          templateKey: 'document-expiry',
          variables: {
            recipientName: recipient.name,
            documentName: doc.name,
            statusLine: doc.expired
              ? `expired on ${doc.expiresAt.toISOString().slice(0, 10)}`
              : `expires on ${doc.expiresAt.toISOString().slice(0, 10)}`,
            viewUrl,
          },
        });
      },
    }),
    workerOptions,
  );
  const documentExpiryQueue = getQueue(QUEUE_NAMES.DOCUMENT_EXPIRY, connection);
  await documentExpiryQueue.upsertJobScheduler(
    'document-expiry',
    { pattern: DOCUMENT_EXPIRY_CRON, tz: 'UTC' },
    { name: 'document-expiry', data: {} },
  );
  logger.info({ cron: DOCUMENT_EXPIRY_CRON }, '[worker] registered document-expiry repeatable');

  // ─── Platform PF-3 — missed-occurrence sweep ──────────────────────────
  const scheduleMissedSweepWorker = new Worker(
    QUEUE_NAMES.SCHEDULE_MISSED_SWEEP,
    createScheduleMissedSweepHandler({
      db: workerDb,
      logger: logger.child({ handler: 'schedule-missed-sweep' }),
      appUrl: env.APP_URL,
      notify: async (
        recipient: { email: string; name: string; locale?: string | null },
        missed: MissedOccurrence[],
        viewUrl: string,
      ) => {
        await sendTemplatedEmail({
          to: recipient.email,
          locale: recipient.locale ?? undefined,
          templateKey: 'schedule-missed',
          variables: {
            recipientName: recipient.name,
            missedCount: String(missed.length),
            detailLines: missedLines(missed),
            viewUrl,
          },
        });
      },
    }),
    workerOptions,
  );
  const scheduleMissedSweepQueue = getQueue(QUEUE_NAMES.SCHEDULE_MISSED_SWEEP, connection);
  await scheduleMissedSweepQueue.upsertJobScheduler(
    'schedule-missed-sweep',
    { pattern: SCHEDULE_MISSED_SWEEP_CRON, tz: 'UTC' },
    { name: 'schedule-missed-sweep', data: {} },
  );
  logger.info(
    { cron: SCHEDULE_MISSED_SWEEP_CRON },
    '[worker] registered schedule-missed-sweep repeatable',
  );

  // ─── Platform PF-31 — retention v1 (notification centre only) ─────────
  const retentionSweepWorker = new Worker(
    QUEUE_NAMES.RETENTION_SWEEP,
    createRetentionSweepHandler({
      db: workerDb,
      logger: logger.child({ handler: 'retention-sweep' }),
    }),
    workerOptions,
  );
  const retentionSweepQueue = getQueue(QUEUE_NAMES.RETENTION_SWEEP, connection);
  await retentionSweepQueue.upsertJobScheduler(
    'retention-sweep',
    { pattern: RETENTION_SWEEP_CRON, tz: 'UTC' },
    { name: 'retention-sweep', data: {} },
  );
  logger.info({ cron: RETENTION_SWEEP_CRON }, '[worker] registered retention-sweep repeatable');

  // ─── ADR 0017 — unclaimed-sandbox TTL sweep ────────────────────────────
  const sandboxTtlSweepWorker = new Worker(
    QUEUE_NAMES.SANDBOX_TTL_SWEEP,
    createSandboxTtlSweepHandler({
      db: workerDb,
      logger: logger.child({ handler: 'sandbox-ttl-sweep' }),
    }),
    workerOptions,
  );
  const sandboxTtlSweepQueue = getQueue(QUEUE_NAMES.SANDBOX_TTL_SWEEP, connection);
  await sandboxTtlSweepQueue.upsertJobScheduler(
    'sandbox-ttl-sweep',
    { pattern: SANDBOX_TTL_SWEEP_CRON, tz: 'UTC' },
    { name: 'sandbox-ttl-sweep', data: {} },
  );
  logger.info({ cron: SANDBOX_TTL_SWEEP_CRON }, '[worker] registered sandbox-ttl-sweep repeatable');

  // ─── FreeHS B7 — training expiry chasing ────────────────────────────────
  const trainingExpiryWorker = new Worker(
    QUEUE_NAMES.TRAINING_EXPIRY,
    createTrainingExpiryHandler({
      db: workerDb,
      logger: logger.child({ handler: 'training-expiry' }),
      appUrl: env.APP_URL,
      notify: async (r: DueTrainingReminder, url: string) => {
        await sendTemplatedEmail({
          to: r.email,
          locale: r.locale ?? undefined,
          // TR-B8: `viaRecorder` was set and never read, so a recorder got
          // "Your training record expires" about someone else's card. The
          // template now has two bodies and picks by this flag.
          templateKey: r.viaRecorder ? 'training-expiry-recorder' : 'training-expiry',
          variables: {
            personName: r.personName,
            requirementName: r.requirementName,
            expiresOn: r.expiresOn,
            url,
          },
        });
      },
    }),
    workerOptions,
  );
  const trainingExpiryQueue = getQueue(QUEUE_NAMES.TRAINING_EXPIRY, connection);
  await trainingExpiryQueue.upsertJobScheduler(
    'training-expiry',
    { pattern: TRAINING_EXPIRY_CRON, tz: 'UTC' },
    { name: 'training-expiry', data: {} },
  );
  logger.info({ cron: TRAINING_EXPIRY_CRON }, '[worker] registered training-expiry repeatable');

  // ─── ADR 0018 — scheduled dashboard PDF delivery ───────────────────────
  const dashboardScheduleTickWorker = new Worker(
    QUEUE_NAMES.DASHBOARD_SCHEDULE_TICK,
    createDashboardScheduleTickHandler({
      db: workerDb,
      logger: logger.child({ handler: 'dashboard-schedule-tick' }),
      connection,
    }),
    workerOptions,
  );

  // First worker consumer of the RenderDeps pipeline: R2-backed storage
  // for the artefact cache, APP_URL for the print route, the shared HMAC
  // secret for the render token — all from the one parsed env.
  const dashboardStorage = createStorage({
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucket: env.R2_BUCKET,
  });
  const dashboardRenderLog = logger.child({ component: 'render-dashboard-pdf' });
  const dashboardScheduleSendWorker = new Worker(
    QUEUE_NAMES.DASHBOARD_SCHEDULE_SEND,
    createDashboardScheduleSendHandler({
      db: workerDb,
      logger: logger.child({ handler: 'dashboard-schedule-send' }),
      appUrl: env.APP_URL,
      renderPdf: async (input) => {
        const rendered = await renderDashboardPdf(
          {
            db: workerDb,
            storage: dashboardStorage,
            appUrl: env.APP_URL,
            renderSharedSecret: env.RENDER_SHARED_SECRET,
            onLog: (e) => {
              if (e.level === 'warn') dashboardRenderLog.warn(e.msg);
              else dashboardRenderLog.info(e.msg);
            },
          },
          input,
        );
        // The pipeline caches the artefact in R2 and returns its key;
        // read the bytes back for the attachment.
        const url = await dashboardStorage.getSignedDownloadUrl({
          key: rendered.key,
          expiresInSeconds: 60 * 5,
        });
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`dashboard PDF download failed: ${res.status} ${res.statusText}`);
        }
        return { bytes: new Uint8Array(await res.arrayBuffer()), stub: rendered.stub };
      },
      notify: async (to, input) => {
        await sendTemplatedEmail({
          to,
          templateKey: 'dashboard-scheduled',
          variables: {
            dashboardTitle: input.dashboardTitle,
            viewUrl: input.viewUrl,
          },
          attachments: [input.attachment],
        });
      },
    }),
    workerOptions,
  );
  const dashboardScheduleTickQueue = getQueue(QUEUE_NAMES.DASHBOARD_SCHEDULE_TICK, connection);
  await dashboardScheduleTickQueue.upsertJobScheduler(
    'dashboard-schedule-tick',
    { pattern: DASHBOARD_SCHEDULE_TICK_CRON, tz: 'UTC' },
    { name: 'dashboard-schedule-tick', data: {} },
  );
  logger.info(
    { cron: DASHBOARD_SCHEDULE_TICK_CRON },
    '[worker] registered dashboard-schedule-tick repeatable',
  );

  // Register the tick as a repeatable job — idempotent per boot.
  const scheduleTickQueue = getQueue(QUEUE_NAMES.SCHEDULE_TICK, connection);
  await scheduleTickQueue.upsertJobScheduler(
    'schedule-tick',
    { pattern: SCHEDULE_TICK_CRON, tz: 'UTC' },
    {
      name: 'schedule-tick',
      data: {},
    },
  );
  logger.info({ cron: SCHEDULE_TICK_CRON }, '[worker] registered schedule-tick repeatable');

  // Idempotent repeatable: every boot re-asserts the schedule. No duplicate
  // jobs; BullMQ's upsertJobScheduler keys off the given id.
  const backupsQueue = getQueue(QUEUE_NAMES.BACKUPS, connection);
  await backupsQueue.upsertJobScheduler(
    'pg-dump-nightly',
    { pattern: PG_DUMP_CRON, tz: 'UTC' },
    {
      name: 'pg-dump-nightly',
      data: { date: new Date().toISOString().slice(0, 10) },
    },
  );

  logger.info({ cron: PG_DUMP_CRON }, '[worker] registered pg-dump-nightly repeatable');

  const allWorkers = [
    testWorker,
    pgDumpWorker,
    groupReconcileWorker,
    siteReconcileWorker,
    userAnonymisationWorker,
    scheduleTickWorker,
    scheduleMaterialiseWorker,
    scheduleReminderWorker,
    contractorReminderWorker,
    contractorOverstayWorker,
    observationNotifyWorker,
    raAckReminderWorker,
    permitExpiryWatchWorker,
    fireDueDigestWorker,
    incidentAlertWorker,
    incidentRiddorWatchWorker,
    incidentChaseWorker,
    actionRemindersWorker,
    headsUpPublishWorker,
    documentExpiryWorker,
    scheduleMissedSweepWorker,
    retentionSweepWorker,
    sandboxTtlSweepWorker,
    trainingExpiryWorker,
    dashboardScheduleTickWorker,
    dashboardScheduleSendWorker,
  ];
  for (const w of allWorkers) {
    w.on('completed', (job) => {
      logger.info({ job_id: job.id, queue: job.queueName }, '[worker] job completed');
    });
    w.on('failed', (job, err) => {
      logger.error(
        { job_id: job?.id, queue: job?.queueName, err: err.message },
        '[worker] job failed',
      );
      // `job.data` is deliberately NOT attached: worker payloads carry row
      // ids and, for the incident alert queue, enough context to identify a
      // person. The queue and job name are what you actually triage on.
      Sentry.captureException(err, {
        tags: {
          queue: job?.queueName ?? 'unknown',
          job: job?.name ?? 'unknown',
          handler: job?.name ?? 'unknown',
        },
      });
    });
  }

  const shutdown = async (): Promise<void> => {
    logger.info('[worker] shutdown requested');
    await Promise.allSettled(allWorkers.map((w) => w.close()));
    await closeAllQueues();
    connection.disconnect();
    logger.info('[worker] shutdown complete');
  };

  return { shutdown };
}
