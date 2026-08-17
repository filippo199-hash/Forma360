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
import { Queue, type ConnectionOptions, type JobsOptions } from 'bullmq';
import { z } from 'zod';

// ─── Queue names ────────────────────────────────────────────────────────────

export const QUEUE_NAMES = {
  /** No-op queue used by the deliberately-simple Phase 0 smoke test. */
  TEST: 'forma360-test',
  /** Nightly `pg_dump` → R2 snapshot. One job per night. */
  BACKUPS: 'forma360-backups',
  /**
   * Phase 1 § 1.3 — materialise `group_members` from
   * `group_membership_rules`. Enqueued on rule save / user field change.
   * Idempotent.
   */
  GROUP_RECONCILE: 'forma360-group-membership-reconcile',
  /** Phase 1 § 1.4 — analogous for sites. */
  SITE_RECONCILE: 'forma360-site-membership-reconcile',
  /**
   * Phase 1 § 1.1 — async fan-out of anonymisation across modules.
   * Phase 1 anonymises `user` + `user_custom_field_values` inline;
   * later phases extend the flow via the `registerAnonymiser(...)`
   * hook that this job consumes.
   */
  USER_ANONYMISATION: 'forma360-user-anonymisation',
  /**
   * Phase 2 PR 32 — schedule materialisation tick. Repeatable every
   * 10 minutes; fans out to SCHEDULE_MATERIALISE for each due schedule.
   */
  SCHEDULE_TICK: 'forma360-schedule-tick',
  /**
   * Phase 2 PR 32 — compute the next 14 days of occurrences for a
   * single schedule and upsert them. Idempotent via the unique
   * (scheduleId, assigneeUserId, occurrenceAt) index.
   */
  SCHEDULE_MATERIALISE: 'forma360-schedule-materialise',
  /**
   * Phase 2 PR 32 — send one reminder email for one occurrence.
   */
  SCHEDULE_REMINDER: 'forma360-schedule-reminder',
  /**
   * Phase 3 — send notification emails for a newly-created observation.
   * Fans out to each resolved recipient (group members, site members, named
   * users) and respects the category's `notificationRule` + `criticalAlerts`
   * settings.
   */
  OBSERVATION_NOTIFY: 'forma360-observation-notify',
  /**
   * Contractors Phase 1 — daily scan that emails contractors whose compliance
   * documents are expiring within the reminder window (single reminder).
   */
  CONTRACTOR_DOC_REMINDER: 'forma360-contractor-doc-reminder',
  /**
   * Contractors Phase 2 — hourly scan that alerts the inviter + gate guards
   * when a visit has been on site (checked in) for more than 24 hours.
   */
  CONTRACTOR_OVERSTAY: 'forma360-contractor-overstay',
  /**
   * FreeHS B1 — daily chase of pending risk-assessment acknowledgements
   * (feedback A-3): first reminder after a grace period, weekly repeats,
   * deduped via `last_reminder_at`.
   */
  RA_ACK_REMINDER: 'forma360-ra-ack-reminder',
  /**
   * FreeHS B3 — 15-minute scan for open permits past their validity end.
   * An unclosed permit means someone may still be in there: stamp
   * `expiry_escalated_at` (once per window), log the event, email
   * issuer / acceptor / authoriser.
   */
  PERMIT_EXPIRY_WATCH: 'forma360-permit-expiry-watch',
  /**
   * FreeHS B4 — daily digest of the fire-safety calendar (HSE review
   * FS-3): failed / overdue / due-soon checks, door inspections, FRA
   * reviews, PEEP reviews and marshal-training expiry, emailed to every
   * `fireSafety.manage` holder. Quiet when the calendar is clean.
   */
  FIRE_DUE_DIGEST: 'forma360-fire-due-digest',
  /**
   * FreeHS B5 — event-driven immediate alert for a newly reported /
   * triaged incident that is serious-or-above or an always-alert kind
   * (dangerous occurrence, sharps, violence). The worker resolves
   * `incidents.manage` holders (site-scoped where curated), sends a
   * confidential-safe email and stamps `alert_sent_at`.
   */
  INCIDENT_ALERT: 'forma360-incident-alert',
  /**
   * FreeHS B5 — 15-minute RIDDOR deadline watch: warnings at T-5 and
   * T-2 days to the incident owner + `incidents.manage` holders,
   * escalation once the statutory deadline passes unsubmitted.
   * Notify-then-stamp: a failed send retries next tick.
   */
  INCIDENT_RIDDOR_WATCH: 'forma360-incident-riddor-watch',
  /**
   * FreeHS B5 — daily chase digest: investigations idle beyond the
   * chase window, incidents stuck in actions_outstanding with overdue
   * actions, and effectiveness reviews past due. One email per owner;
   * silent when clean.
   */
  INCIDENT_CHASE: 'forma360-incident-chase',
  /**
   * Platform review PF-4 — daily reminder digest for corrective-action
   * assignees: due-soon warned once, overdue re-pinged weekly.
   */
  ACTION_REMINDERS: 'forma360-action-reminders',
  /** Platform PF-15 — publishes scheduled Heads Ups when publishAt arrives. */
  HEADS_UP_PUBLISH: 'forma360-heads-up-publish',
  /** Platform PF-16 — document expiry reminders driven by reminderDays. */
  DOCUMENT_EXPIRY: 'forma360-document-expiry',
  /** Platform PF-3 — stamps 'missed' on scheduled occurrences past grace. */
  SCHEDULE_MISSED_SWEEP: 'forma360-schedule-missed-sweep',
  RETENTION_SWEEP: 'forma360-retention-sweep',
  /**
   * FreeHS B7 — daily training-expiry chasing. One reminder per record,
   * deduped on `reminder_sent_at`, silent when nothing is due.
   */
  TRAINING_EXPIRY: 'forma360-training-expiry',
  /**
   * ADR 0018 — 15-minute scan of unpaused `dashboard_schedules` whose
   * dashboard is published. Computes due RRULE occurrences over the
   * window (max(lastSentAt, startAt, now − 24h), now] and enqueues one
   * DASHBOARD_SCHEDULE_SEND per due schedule — latest occurrence only,
   * so a catch-up after downtime sends ONE email, not a backlog.
   */
  DASHBOARD_SCHEDULE_TICK: 'forma360-dashboard-schedule-tick',
  /**
   * ADR 0018 — render one dashboard PDF and email it to every
   * recipient of one schedule, then stamp `lastSentAt = occurrenceAt`
   * (notify-then-stamp, the IN-A1 lesson: a failed send retries with
   * the stamp unset).
   */
  DASHBOARD_SCHEDULE_SEND: 'forma360-dashboard-schedule-send',
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

/** Phase 3 — send observation-created notification emails. */
export const observationNotifyPayloadSchema = z.object({
  tenantId: z.string().length(26),
  issueId: z.string().length(26),
  /** Whether this issue's category has criticalAlerts enabled. */
  isCritical: z.boolean(),
});
export type ObservationNotifyPayload = z.infer<typeof observationNotifyPayloadSchema>;

/** Contractor doc-reminder tick — no payload; the worker scans for due docs. */
export const contractorDocReminderPayloadSchema = z.object({}).strict();
export type ContractorDocReminderPayload = z.infer<typeof contractorDocReminderPayloadSchema>;

export const contractorOverstayPayloadSchema = z.object({}).strict();
export type ContractorOverstayPayload = z.infer<typeof contractorOverstayPayloadSchema>;

/** RA acknowledgement-reminder tick — no payload; the worker scans for
 * pending acknowledgements. */
export const raAckReminderPayloadSchema = z.object({}).strict();
export type RaAckReminderPayload = z.infer<typeof raAckReminderPayloadSchema>;

/** Permit expiry-watch tick — no payload; the worker scans for expired
 * open permits. */
export const permitExpiryWatchPayloadSchema = z.object({}).strict();
export type PermitExpiryWatchPayload = z.infer<typeof permitExpiryWatchPayloadSchema>;

/** Fire due-digest tick — no payload; the worker scans every calendar. */
export const fireDueDigestPayloadSchema = z.object({}).strict();
export type FireDueDigestPayload = z.infer<typeof fireDueDigestPayloadSchema>;

/** One immediate-alert fan-out for one incident. */
export const incidentAlertPayloadSchema = z
  .object({
    tenantId: z.string().length(26),
    incidentId: z.string().length(26),
  })
  .strict();
export type IncidentAlertPayload = z.infer<typeof incidentAlertPayloadSchema>;

/** RIDDOR deadline-watch tick — no payload; the worker scans the clocks. */
export const incidentRiddorWatchPayloadSchema = z.object({}).strict();
export type IncidentRiddorWatchPayload = z.infer<typeof incidentRiddorWatchPayloadSchema>;

/** Incident chase-digest tick — no payload; the worker scans open incidents. */
export const incidentChasePayloadSchema = z.object({}).strict();
export type IncidentChasePayload = z.infer<typeof incidentChasePayloadSchema>;
/** Action reminders tick — no payload; the worker scans due dates. */
export const actionRemindersPayloadSchema = z.object({}).strict();
export type ActionRemindersPayload = z.infer<typeof actionRemindersPayloadSchema>;

/** Heads-up publish tick — no payload; the worker scans publishAt. */
export const headsUpPublishPayloadSchema = z.object({}).strict();
export type HeadsUpPublishPayload = z.infer<typeof headsUpPublishPayloadSchema>;

/** Document expiry tick — no payload; the worker scans reminderDays. */
export const documentExpiryPayloadSchema = z.object({}).strict();
export type DocumentExpiryPayload = z.infer<typeof documentExpiryPayloadSchema>;

/** Missed-occurrence sweep tick — no payload. */
export const scheduleMissedSweepPayloadSchema = z.object({}).strict();
export type ScheduleMissedSweepPayload = z.infer<typeof scheduleMissedSweepPayloadSchema>;

/** PF-31 retention v1 — tick payload is empty. */
/** Training expiry chase — no payload; the worker scans expiries. */
export const trainingExpiryPayloadSchema = z.object({}).strict();
export type TrainingExpiryPayload = z.infer<typeof trainingExpiryPayloadSchema>;

export const retentionSweepPayloadSchema = z.object({}).strict();
export type RetentionSweepPayload = z.infer<typeof retentionSweepPayloadSchema>;

/** Dashboard schedule tick — no payload; the worker scans every schedule. */
export const dashboardScheduleTickPayloadSchema = z.object({}).strict();
export type DashboardScheduleTickPayload = z.infer<typeof dashboardScheduleTickPayloadSchema>;

/** Send one dashboard-schedule occurrence (render + email + stamp). */
export const dashboardScheduleSendPayloadSchema = z
  .object({
    scheduleId: z.string().length(26),
    /** ISO instant of the occurrence being delivered — the dedupe key. */
    occurrenceAt: z.string().datetime(),
  })
  .strict();
export type DashboardScheduleSendPayload = z.infer<typeof dashboardScheduleSendPayloadSchema>;

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
  [QUEUE_NAMES.OBSERVATION_NOTIFY]: ObservationNotifyPayload;
  [QUEUE_NAMES.CONTRACTOR_DOC_REMINDER]: ContractorDocReminderPayload;
  [QUEUE_NAMES.CONTRACTOR_OVERSTAY]: ContractorOverstayPayload;
  [QUEUE_NAMES.RA_ACK_REMINDER]: RaAckReminderPayload;
  [QUEUE_NAMES.PERMIT_EXPIRY_WATCH]: PermitExpiryWatchPayload;
  [QUEUE_NAMES.FIRE_DUE_DIGEST]: FireDueDigestPayload;
  [QUEUE_NAMES.INCIDENT_ALERT]: IncidentAlertPayload;
  [QUEUE_NAMES.INCIDENT_RIDDOR_WATCH]: IncidentRiddorWatchPayload;
  [QUEUE_NAMES.INCIDENT_CHASE]: IncidentChasePayload;
  [QUEUE_NAMES.ACTION_REMINDERS]: ActionRemindersPayload;
  [QUEUE_NAMES.HEADS_UP_PUBLISH]: HeadsUpPublishPayload;
  [QUEUE_NAMES.DOCUMENT_EXPIRY]: DocumentExpiryPayload;
  [QUEUE_NAMES.SCHEDULE_MISSED_SWEEP]: ScheduleMissedSweepPayload;
  [QUEUE_NAMES.RETENTION_SWEEP]: RetentionSweepPayload;
  [QUEUE_NAMES.TRAINING_EXPIRY]: TrainingExpiryPayload;
  [QUEUE_NAMES.DASHBOARD_SCHEDULE_TICK]: DashboardScheduleTickPayload;
  [QUEUE_NAMES.DASHBOARD_SCHEDULE_SEND]: DashboardScheduleSendPayload;
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
  [QUEUE_NAMES.OBSERVATION_NOTIFY]: observationNotifyPayloadSchema,
  [QUEUE_NAMES.CONTRACTOR_DOC_REMINDER]: contractorDocReminderPayloadSchema,
  [QUEUE_NAMES.CONTRACTOR_OVERSTAY]: contractorOverstayPayloadSchema,
  [QUEUE_NAMES.RA_ACK_REMINDER]: raAckReminderPayloadSchema,
  [QUEUE_NAMES.PERMIT_EXPIRY_WATCH]: permitExpiryWatchPayloadSchema,
  [QUEUE_NAMES.FIRE_DUE_DIGEST]: fireDueDigestPayloadSchema,
  [QUEUE_NAMES.INCIDENT_ALERT]: incidentAlertPayloadSchema,
  [QUEUE_NAMES.INCIDENT_RIDDOR_WATCH]: incidentRiddorWatchPayloadSchema,
  [QUEUE_NAMES.INCIDENT_CHASE]: incidentChasePayloadSchema,
  [QUEUE_NAMES.ACTION_REMINDERS]: actionRemindersPayloadSchema,
  [QUEUE_NAMES.HEADS_UP_PUBLISH]: headsUpPublishPayloadSchema,
  [QUEUE_NAMES.DOCUMENT_EXPIRY]: documentExpiryPayloadSchema,
  [QUEUE_NAMES.SCHEDULE_MISSED_SWEEP]: scheduleMissedSweepPayloadSchema,
  [QUEUE_NAMES.RETENTION_SWEEP]: retentionSweepPayloadSchema,
  [QUEUE_NAMES.TRAINING_EXPIRY]: trainingExpiryPayloadSchema,
  [QUEUE_NAMES.DASHBOARD_SCHEDULE_TICK]: dashboardScheduleTickPayloadSchema,
  [QUEUE_NAMES.DASHBOARD_SCHEDULE_SEND]: dashboardScheduleSendPayloadSchema,
} as const;

// ─── Lazy queue handles ─────────────────────────────────────────────────────

const queueCache = new Map<QueueName, Queue>();

/**
 * Default job options applied to every queue.
 *
 * BullMQ defaults to `attempts: 1`, so before this every job in the system
 * was single-shot. Cron-driven workers survived that by re-deriving their work
 * on the next tick, but the event-driven ones had no second chance: an
 * incident alert, an observation notification, a schedule reminder or a
 * dashboard delivery was dropped permanently by one transient database or SMTP
 * blip. For a product whose job is telling somebody a person got hurt, that is
 * the wrong failure mode — and the code already assumed otherwise, both in
 * `apps/web/src/server/trpc.ts` ("BullMQ-side retries cover transient
 * failures once the job is accepted") and in the IN-A1 notify-then-stamp
 * design, which is only safe to retry BECAUSE the stamp lands after delivery.
 *
 * Retries are safe here for that reason: handlers stamp their dedupe marker
 * after a successful send, so a retry re-attempts only what did not land. Keep
 * that property when writing a new handler.
 *
 * `removeOnComplete`/`removeOnFail` were also unset, which meant Redis grew
 * without bound — every job ever processed was retained forever. Failed jobs
 * are kept far longer than completed ones because they are the ones worth
 * inspecting.
 */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { age: 60 * 60 * 24, count: 1_000 },
  removeOnFail: { age: 60 * 60 * 24 * 14 },
} satisfies JobsOptions;

/**
 * Return (creating if necessary) a BullMQ Queue handle for the given name.
 * Memoised per process. `connection` is only read the first time a given
 * queue is requested; subsequent calls ignore it.
 */
export function getQueue<N extends QueueName>(name: N, connection: ConnectionOptions): Queue {
  let q = queueCache.get(name);
  if (q === undefined) {
    q = new Queue(name, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
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
