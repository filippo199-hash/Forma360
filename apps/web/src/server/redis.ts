import { Redis, type RedisOptions } from 'ioredis';
import { env } from './env';
import { logger } from './logger';

/**
 * Build an ioredis client with the house error handling attached.
 *
 * ioredis does NOT crash the process on an unhandled `error` event — that
 * was checked rather than assumed. It writes `[ioredis] Unhandled error
 * event: …` straight to stderr and carries on reconnecting. The problem is
 * where that line goes: raw stderr, with no `service`, no request id, and
 * nothing for a log search to group on. A Redis outage was therefore
 * invisible in the drain while being perfectly visible in the terminal
 * nobody is watching (STAB-02).
 *
 * `role` names which client is talking, because a process holds several.
 */
export function createRedis(role: string, options: RedisOptions = {}): Redis {
  const client = new Redis(env.REDIS_URL, options);
  client.on('error', (err: Error) => {
    logger.error({ err, role }, '[redis] connection error');
  });
  return client;
}

/**
 * Single ioredis connection shared by better-auth's secondary storage and
 * (when a procedure enqueues a job) the BullMQ enqueue helper. Opened
 * lazily on first import.
 */
export const redis = createRedis('web', {
  // better-auth's redisStorage uses simple GET/SET/DEL; the default retry
  // policy is fine. The null-retry quirk only applies to BullMQ worker
  // connections (see packages/jobs/src/worker.ts).
  maxRetriesPerRequest: 3,
});
