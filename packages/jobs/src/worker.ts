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
import { createDb } from '@forma360/db/client';
import { closeAllQueues, getQueue, QUEUE_NAMES } from './queues';
import { createGroupReconcileHandler } from './workers/group-membership-reconcile';
import { createPgDumpHandler, PG_DUMP_CRON } from './workers/pg-dump-nightly';
import { createScheduleMaterialiseHandler } from './workers/schedule-materialise';
import { createScheduleReminderHandler } from './workers/schedule-reminder';
import { createScheduleTickHandler, SCHEDULE_TICK_CRON } from './workers/schedule-tick';
import { createSiteReconcileHandler } from './workers/site-membership-reconcile';
import { createTestQueueHandler } from './workers/test-queue';
import { createUserAnonymisationHandler } from './workers/user-anonymisation';
import { createSendEmail, createSendTemplatedEmail } from '@forma360/shared/email';
import { createMaintenanceTickHandler, MAINTENANCE_TICK_CRON } from './workers/maintenance-tick';
import { createMaintenanceNotifyHandler } from './workers/maintenance-notify';
import {
  createContractorDocReminderHandler,
  CONTRACTOR_DOC_REMINDER_CRON,
  type DueReminder,
} from './workers/contractor-doc-reminder';
import {
  createContractorOverstayHandler,
  CONTRACTOR_OVERSTAY_CRON,
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

function buildRedis(url: string): Redis {
  // BullMQ requires `maxRetriesPerRequest: null` on the connection it uses
  // for blocking reads (Worker). Without this it raises a warning and falls
  // back to error-and-exit on reconnect churn.
  return new Redis(url, { maxRetriesPerRequest: null });
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

  const connection = buildRedis(env.REDIS_URL);
  const workerOptions: WorkerOptions = { connection };

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
  const { db: workerDb } = createDb(env.DATABASE_URL);

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

  // ─── Phase 5B — Maintenance notifications ──────────────────────────────
  const maintenanceTickWorker = new Worker(
    QUEUE_NAMES.MAINTENANCE_TICK,
    createMaintenanceTickHandler({
      db: workerDb,
      logger: logger.child({ handler: 'maintenance-tick' }),
      connection,
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

  const maintenanceNotifyWorker = new Worker(
    QUEUE_NAMES.MAINTENANCE_NOTIFY,
    createMaintenanceNotifyHandler({
      db: workerDb,
      logger: logger.child({ handler: 'maintenance-notify' }),
      sendTemplatedEmail,
      appUrl: env.APP_URL,
    }),
    workerOptions,
  );

  // Register maintenance-tick as a daily repeatable job.
  const maintenanceTickQueue = getQueue(QUEUE_NAMES.MAINTENANCE_TICK, connection);
  await maintenanceTickQueue.upsertJobScheduler(
    'maintenance-tick',
    { pattern: MAINTENANCE_TICK_CRON, tz: 'UTC' },
    { name: 'maintenance-tick', data: {} },
  );
  logger.info({ cron: MAINTENANCE_TICK_CRON }, '[worker] registered maintenance-tick repeatable');

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
      notify: async (v: OverstayVisit, email: string, boardUrl: string) => {
        await sendTemplatedEmail({
          to: email,
          templateKey: 'contractor-overstay',
          variables: {
            who: v.visitorName ?? 'A visitor',
            contractorName: v.contractorName,
            title: v.title,
            siteLine: v.siteName !== null ? ` at ${v.siteName}` : '',
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
        recipient: { email: string; name: string },
        viewUrl: string,
      ) => {
        await sendTemplatedEmail({
          to: recipient.email,
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
        recipient: { email: string; name: string },
        digest: FireDigest,
        viewUrl: string,
      ) => {
        const failed = digest.failedChecks.length + digest.failedDoors.length;
        const overdue = digest.overdueChecks.length + digest.overdueDoors.length;
        await sendTemplatedEmail({
          to: recipient.email,
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

  // ─── Platform PF-4 — corrective-action reminder digest ────────────────
  const actionRemindersWorker = new Worker(
    QUEUE_NAMES.ACTION_REMINDERS,
    createActionRemindersHandler({
      db: workerDb,
      logger: logger.child({ handler: 'action-reminders' }),
      appUrl: env.APP_URL,
      notify: async (
        recipient: { email: string; name: string },
        payload: { overdue: DueActionRow[]; dueSoon: DueActionRow[]; viewUrl: string },
      ) => {
        await sendTemplatedEmail({
          to: recipient.email,
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
        recipient: { email: string; name: string },
        doc: ExpiringDocument,
        viewUrl: string,
      ) => {
        await sendTemplatedEmail({
          to: recipient.email,
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
        recipient: { email: string; name: string },
        missed: MissedOccurrence[],
        viewUrl: string,
      ) => {
        await sendTemplatedEmail({
          to: recipient.email,
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
    maintenanceTickWorker,
    maintenanceNotifyWorker,
    contractorReminderWorker,
    contractorOverstayWorker,
    observationNotifyWorker,
    raAckReminderWorker,
    permitExpiryWatchWorker,
    fireDueDigestWorker,
    actionRemindersWorker,
    headsUpPublishWorker,
    documentExpiryWorker,
    scheduleMissedSweepWorker,
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
      Sentry.captureException(err, {
        tags: { queue: job?.queueName ?? 'unknown', job_name: job?.name ?? 'unknown' },
        extra: { job_id: job?.id, attempts: job?.attemptsMade, data: job?.data },
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
