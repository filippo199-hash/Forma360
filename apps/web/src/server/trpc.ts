import { createContextFactory, type Enqueue } from '@forma360/api/context';
import { enqueue as bullEnqueue, type QueueName } from '@forma360/jobs';
import { auth } from './auth';
import { db } from './db';
import { logger } from './logger';
import { redis } from './redis';

/**
 * Fire-and-forget enqueue. The tRPC handler does not await the BullMQ
 * round-trip — if Redis is briefly unavailable we log and carry on so
 * the user's mutation still completes. The reconcile handler is
 * idempotent, and BullMQ-side retries cover transient failures once the
 * job is accepted; this wrapper only covers the "Redis is gone" case.
 */
const enqueueImpl: Enqueue = (name, payload) => {
  void bullEnqueue(name as QueueName, payload as never, { connection: redis }).catch(
    (err: unknown) => {
      logger.error({ queue: name, err }, '[enqueue] failed');
    },
  );
};

export const createContext = createContextFactory({
  db,
  auth,
  logger,
  enqueue: enqueueImpl,
});
