/**
 * Type-safe enqueue helper.
 *
 * Validates the payload against the queue's Zod schema before adding it to
 * BullMQ. Callers do not touch `new Queue(...)` directly; they pass a name
 * and a payload and get back a job id.
 */
import type { ConnectionOptions, JobsOptions } from 'bullmq';
import { getQueue, QUEUE_PAYLOAD_SCHEMAS, type QueueName, type QueuePayloads } from './queues';

export interface EnqueueOptions {
  connection: ConnectionOptions;
  /** Job name inside the queue. Defaults to the queue name. */
  jobName?: string;
  /** Passed through to BullMQ (delay, attempts, backoff, etc.). */
  jobOptions?: JobsOptions;
}

export async function enqueue<N extends QueueName>(
  name: N,
  payload: QueuePayloads[N],
  options: EnqueueOptions,
): Promise<string> {
  const schema = QUEUE_PAYLOAD_SCHEMAS[name];
  // An unregistered name used to surface as `Cannot read properties of
  // undefined (reading 'parse')` from the line below, which the web layer's
  // fire-and-forget `.catch()` logged as an ordinary enqueue failure —
  // indistinguishable from a Redis blip. Four call sites spelled the name
  // `forma360:x` instead of `forma360-x` and their jobs never ran once. Name
  // the fault instead, and see `enqueue-names.test.ts` for the guard that
  // stops a mis-spelled literal reaching production at all.
  if (schema === undefined) {
    throw new Error(
      `enqueue(${String(name)}): no such queue. Registered names are ${Object.keys(
        QUEUE_PAYLOAD_SCHEMAS,
      ).join(', ')}`,
    );
  }
  const parsed = schema.parse(payload);
  const queue = getQueue(name, options.connection);
  const job = await queue.add(options.jobName ?? name, parsed, options.jobOptions);
  if (job.id === undefined) {
    throw new Error(`enqueue(${name}) returned a job without an id`);
  }
  return job.id;
}
