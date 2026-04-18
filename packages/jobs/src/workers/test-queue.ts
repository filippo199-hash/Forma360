/**
 * Handler for the `forma360:test` queue.
 *
 * No side effects beyond a log line. Used to prove the worker + enqueue
 * plumbing end-to-end without depending on Redis / Postgres / R2 being
 * properly configured.
 */
import type { Logger } from '@forma360/shared/logger';
import type { Job } from 'bullmq';
import type { TestPayload } from '../queues.js';

export function createTestQueueHandler(logger: Logger) {
  return async function handleTestJob(job: Job<TestPayload>): Promise<void> {
    logger.info(
      {
        job_id: job.id,
        queue: job.queueName,
        message: job.data.message,
      },
      '[test-queue] received',
    );
  };
}
