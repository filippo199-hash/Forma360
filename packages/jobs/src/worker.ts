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
import { createSendEmail } from '@forma360/shared/email';

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
