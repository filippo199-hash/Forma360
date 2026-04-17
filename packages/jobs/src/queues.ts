/**
 * BullMQ queue registry.
 *
 * This file is the single source of truth for which queues exist, their
 * names, and the shapes of payloads each one accepts. Adding a new queue
 * means adding an entry to `QUEUE_NAMES` and a payload interface here.
 * Phase 1+ modules may then import from `@forma360/jobs/queues` without
 * touching any other jobs-package wiring.
 *
 * Queues are built lazily via `getQueue(name, connection)` so this module
 * does not open a Redis connection at import time.
 */
import { Queue, type ConnectionOptions } from 'bullmq';
import { z } from 'zod';

// ─── Queue names ────────────────────────────────────────────────────────────

export const QUEUE_NAMES = {
  /** No-op queue used by the deliberately-simple Phase 0 smoke test. */
  TEST: 'forma360:test',
  /** Nightly `pg_dump` → R2 snapshot. One job per night. */
  BACKUPS: 'forma360:backups',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// ─── Payload schemas ────────────────────────────────────────────────────────

export const testPayloadSchema = z.object({
  message: z.string().min(1),
});
export type TestPayload = z.infer<typeof testPayloadSchema>;

export const pgDumpPayloadSchema = z.object({
  /**
   * ISO yyyy-mm-dd used in the R2 object key. The worker also re-derives
   * this from the job fire time, but accepting it here keeps manual
   * triggers deterministic.
   */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
});
export type PgDumpPayload = z.infer<typeof pgDumpPayloadSchema>;

/**
 * Type-level map from queue name to its payload type. Adding a new queue
 * adds a new key here; the enqueue helper uses this to type-check callers.
 */
export interface QueuePayloads {
  [QUEUE_NAMES.TEST]: TestPayload;
  [QUEUE_NAMES.BACKUPS]: PgDumpPayload;
}

/** Runtime schema map mirroring QueuePayloads — used for validation at enqueue. */
export const QUEUE_PAYLOAD_SCHEMAS = {
  [QUEUE_NAMES.TEST]: testPayloadSchema,
  [QUEUE_NAMES.BACKUPS]: pgDumpPayloadSchema,
} as const;

// ─── Lazy queue handles ─────────────────────────────────────────────────────

const queueCache = new Map<QueueName, Queue>();

/**
 * Return (creating if necessary) a BullMQ Queue handle for the given name.
 * Memoised per process. `connection` is only read the first time a given
 * queue is requested; subsequent calls ignore it.
 */
export function getQueue<N extends QueueName>(name: N, connection: ConnectionOptions): Queue {
  let q = queueCache.get(name);
  if (q === undefined) {
    q = new Queue(name, { connection });
    queueCache.set(name, q);
  }
  return q;
}

/**
 * Drain and close every cached queue. Exposed so the worker can shut down
 * cleanly on SIGTERM.
 */
export async function closeAllQueues(): Promise<void> {
  await Promise.all([...queueCache.values()].map((q) => q.close()));
  queueCache.clear();
}
