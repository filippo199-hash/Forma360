import { Redis } from 'ioredis';
import { env } from './env';

/**
 * Single ioredis connection shared by better-auth's secondary storage and
 * (when a procedure enqueues a job) the BullMQ enqueue helper. Opened
 * lazily on first import.
 */
export const redis = new Redis(env.REDIS_URL, {
  // better-auth's redisStorage uses simple GET/SET/DEL; the default retry
  // policy is fine. The null-retry quirk only applies to BullMQ worker
  // connections (see packages/jobs/src/worker.ts).
  maxRetriesPerRequest: 3,
});
