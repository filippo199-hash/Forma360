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
  /**
   * Phase 1 § 1.3 — materialise `group_members` from
   * `group_membership_rules`. Enqueued on rule save / user field change.
   * Idempotent.
   */
  GROUP_RECONCILE: 'forma360:group-membership-reconcile',
  /** Phase 1 § 1.4 — analogous for sites. */
  SITE_RECONCILE: 'forma360:site-membership-reconcile',
  /**
   * Phase 1 § 1.1 — async fan-out of anonymisation across modules.
   * Phase 1 anonymises `user` + `user_custom_field_values` inline;
   * later phases extend the flow via the `registerAnonymiser(...)`
   * hook that this job consumes.
   */
  USER_ANONYMISATION: 'forma360:user-anonymisation',
  /**
   * Phase 2 PR 32 — schedule materialisation tick. Repeatable every
   * 10 minutes; fans out to SCHEDULE_MATERIALISE for each due schedule.
   */
  SCHEDULE_TICK: 'forma360:schedule-tick',
  /**
   * Phase 2 PR 32 — compute the next 14 days of occurrences for a
   * single schedule and upsert them. Idempotent via the unique
   * (scheduleId, assigneeUserId, occurrenceAt) index.
   */
  SCHEDULE_MATERIALISE: 'forma360:schedule-materialise',
  /**
   * Phase 2 PR 32 — send one reminder email for one occurrence.
   */
  SCHEDULE_REMINDER: 'forma360:schedule-reminder',
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

/** Rule materialisation — group reconcile. */
export const groupReconcilePayloadSchema = z.object({
  tenantId: z.string().length(26),
  /** Optional: reconcile one group. If omitted, reconcile every rule-based group. */
  groupId: z.string().length(26).optional(),
  /** Actor id for audit (undefined = system / scheduled). */
  actorId: z.string().optional(),
});
export type GroupReconcilePayload = z.infer<typeof groupReconcilePayloadSchema>;

/** Rule materialisation — site reconcile. Same shape as group. */
export const siteReconcilePayloadSchema = z.object({
  tenantId: z.string().length(26),
  siteId: z.string().length(26).optional(),
  actorId: z.string().optional(),
});
export type SiteReconcilePayload = z.infer<typeof siteReconcilePayloadSchema>;

/** Async anonymisation cascade. Phase 1 receives the payload; the cascade
 *  itself is extended per-module in later phases. */
export const userAnonymisationPayloadSchema = z.object({
  tenantId: z.string().length(26),
  userId: z.string(),
  actorId: z.string(),
});
export type UserAnonymisationPayload = z.infer<typeof userAnonymisationPayloadSchema>;

/** Schedule tick — no payload needed; worker fans out to every due schedule. */
export const scheduleTickPayloadSchema = z.object({
  /** ISO timestamp the tick represents. Optional — worker uses now() if omitted. */
  tickAt: z.string().datetime().optional(),
});
export type ScheduleTickPayload = z.infer<typeof scheduleTickPayloadSchema>;

/** Materialise one schedule's upcoming occurrences. */
export const scheduleMaterialisePayloadSchema = z.object({
  tenantId: z.string().length(26),
  scheduleId: z.string().length(26),
});
export type ScheduleMaterialisePayload = z.infer<typeof scheduleMaterialisePayloadSchema>;

/** Send a reminder for one occurrence. */
export const scheduleReminderPayloadSchema = z.object({
  tenantId: z.string().length(26),
  occurrenceId: z.string().length(26),
});
export type ScheduleReminderPayload = z.infer<typeof scheduleReminderPayloadSchema>;

/**
 * Type-level map from queue name to its payload type. Adding a new queue
 * adds a new key here; the enqueue helper uses this to type-check callers.
 */
export interface QueuePayloads {
  [QUEUE_NAMES.TEST]: TestPayload;
  [QUEUE_NAMES.BACKUPS]: PgDumpPayload;
  [QUEUE_NAMES.GROUP_RECONCILE]: GroupReconcilePayload;
  [QUEUE_NAMES.SITE_RECONCILE]: SiteReconcilePayload;
  [QUEUE_NAMES.USER_ANONYMISATION]: UserAnonymisationPayload;
  [QUEUE_NAMES.SCHEDULE_TICK]: ScheduleTickPayload;
  [QUEUE_NAMES.SCHEDULE_MATERIALISE]: ScheduleMaterialisePayload;
  [QUEUE_NAMES.SCHEDULE_REMINDER]: ScheduleReminderPayload;
}

/** Runtime schema map mirroring QueuePayloads — used for validation at enqueue. */
export const QUEUE_PAYLOAD_SCHEMAS = {
  [QUEUE_NAMES.TEST]: testPayloadSchema,
  [QUEUE_NAMES.BACKUPS]: pgDumpPayloadSchema,
  [QUEUE_NAMES.GROUP_RECONCILE]: groupReconcilePayloadSchema,
  [QUEUE_NAMES.SITE_RECONCILE]: siteReconcilePayloadSchema,
  [QUEUE_NAMES.USER_ANONYMISATION]: userAnonymisationPayloadSchema,
  [QUEUE_NAMES.SCHEDULE_TICK]: scheduleTickPayloadSchema,
  [QUEUE_NAMES.SCHEDULE_MATERIALISE]: scheduleMaterialisePayloadSchema,
  [QUEUE_NAMES.SCHEDULE_REMINDER]: scheduleReminderPayloadSchema,
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
