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
import { Worker, type WorkerOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { closeAllQueues, getQueue, QUEUE_NAMES } from './queues.js';
import { createPgDumpHandler, PG_DUMP_CRON } from './workers/pg-dump-nightly.js';
import { createTestQueueHandler } from './workers/test-queue.js';

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

  for (const w of [testWorker, pgDumpWorker]) {
    w.on('completed', (job) => {
      logger.info({ job_id: job.id, queue: job.queueName }, '[worker] job completed');
    });
    w.on('failed', (job, err) => {
      logger.error(
        { job_id: job?.id, queue: job?.queueName, err: err.message },
        '[worker] job failed',
      );
    });
  }

  const shutdown = async (): Promise<void> => {
    logger.info('[worker] shutdown requested');
    await Promise.allSettled([testWorker.close(), pgDumpWorker.close()]);
    await closeAllQueues();
    connection.disconnect();
    logger.info('[worker] shutdown complete');
  };

  return { shutdown };
}
