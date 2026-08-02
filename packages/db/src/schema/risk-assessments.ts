/**
 * Risk Assessments (FreeHS module B1).
 *
 * Follows the HSE five-step structure: identify hazards → who might be
 * harmed and how → evaluate risks and controls → record findings → review.
 *
 * Model:
 *   - `risk_assessments` — the assessment header. `type` distinguishes the
 *     standing assessment from dynamic / point-of-work assessments.
 *     `personSpecificFor` + `parentAssessmentId` support person-specific
 *     variants (young persons, new/expectant mothers) linked to a parent.
 *     The scoring matrix thresholds are snapshotted per row so the matrix
 *     is configurable without rescoring history.
 *   - `risk_assessment_hazards` — one row per hazard: who might be harmed
 *     and how, initial likelihood × severity, existing controls, residual
 *     likelihood × severity.
 *   - `risk_assessment_controls` — hierarchy-of-control entries per hazard
 *     (eliminate → substitute → engineering → administrative → ppe).
 *     `status='planned'` controls generate actions on publish; `actionId`
 *     links the created action (dedup also enforced by the actions table's
 *     source unique index).
 *   - `risk_assessment_reviews` — append-only review log with the trigger
 *     that prompted it.
 *   - `risk_assessment_acknowledgements` — distribution + acknowledgement
 *     records, one row per (assessment, user), version-aware: publish
 *     re-opens them against the new version.
 *   - `risk_assessment_versions` — immutable content snapshot per publish
 *     with the assessor sign-off as first-class fields.
 *   - `tenant_risk_matrix_settings` — the tenant's matrix (thresholds +
 *     severity floors) applied to new assessments as a per-row snapshot.
 */
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  index,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { RiskBandLevel, RiskMatrixConfig } from '@forma360/shared/risk-matrix';
import { DEFAULT_RISK_MATRIX } from '@forma360/shared/risk-matrix';
import { sites } from './sites';
import { tenants } from './tenants';

export const RISK_ASSESSMENT_TYPES = ['standing', 'dynamic'] as const;
export type RiskAssessmentType = (typeof RISK_ASSESSMENT_TYPES)[number];

export const RISK_ASSESSMENT_STATUSES = ['draft', 'active', 'archived'] as const;
export type RiskAssessmentStatus = (typeof RISK_ASSESSMENT_STATUSES)[number];

export const CONTROL_TIERS = [
  'eliminate',
  'substitute',
  'engineering',
  'administrative',
  'ppe',
] as const;
export type ControlTier = (typeof CONTROL_TIERS)[number];

export const CONTROL_STATUSES = ['in_place', 'planned'] as const;
export type ControlStatus = (typeof CONTROL_STATUSES)[number];

export const REVIEW_TRIGGERS = [
  'scheduled',
  'incident',
  'process_change',
  'legislation_change',
  'new_equipment',
  'manual',
] as const;
export type ReviewTrigger = (typeof REVIEW_TRIGGERS)[number];

export const REVIEW_OUTCOMES = ['confirmed', 'updated'] as const;
export type ReviewOutcome = (typeof REVIEW_OUTCOMES)[number];

export const PERSON_SPECIFIC_KINDS = ['young_person', 'new_expectant_mother'] as const;
export type PersonSpecificKind = (typeof PERSON_SPECIFIC_KINDS)[number];

/** Preset "who might be harmed" groups; free-text extras are allowed too. */
export const AFFECTED_GROUP_PRESETS = [
  'employees',
  'cleaners',
  'contractors',
  'visitors',
  'young_persons',
  'new_expectant_mothers',
  'lone_workers',
  'members_of_public',
] as const;

/**
 * Matrix band thresholds + optional severity floors. Canonical definition
 * lives in `@forma360/shared/risk-matrix`; re-exported here so existing
 * schema-side imports keep working.
 */
export type { RiskMatrixConfig } from '@forma360/shared/risk-matrix';
export { DEFAULT_RISK_MATRIX } from '@forma360/shared/risk-matrix';

export const riskAssessments = pgTable(
  'risk_assessments',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    /** Human-friendly reference ("RA-0001"), stamped in the create tx. */
    referenceNumber: text('reference_number'),

    title: text('title').notNull(),
    /** The activity / process being assessed. */
    activity: text('activity').notNull().default(''),

    type: text('type').notNull().default('standing').$type<RiskAssessmentType>(),
    status: text('status').notNull().default('draft').$type<RiskAssessmentStatus>(),

    siteId: varchar('site_id', { length: 26 }).references(() => sites.id, {
      onDelete: 'set null',
    }),
    /** Free-text location for dynamic / point-of-work assessments. */
    locationText: text('location_text'),

    assessorUserId: text('assessor_user_id'),

    /** Person-specific variant support. */
    personSpecificFor: text('person_specific_for').$type<PersonSpecificKind>(),
    parentAssessmentId: varchar('parent_assessment_id', { length: 26 }),
    /**
     * Parent's state at fork time — a variant "drifts" once the parent's
     * content changes after this timestamp (feedback A-4).
     */
    forkedFromParentAt: timestamp('forked_from_parent_at', { withTimezone: true, mode: 'date' }),

    /** Matrix thresholds snapshot — configurable without rescoring history. */
    matrix: jsonb('matrix')
      .notNull()
      .$type<RiskMatrixConfig>()
      .default(sql`'{"lowMax":4,"mediumMax":9,"highMax":15}'::jsonb`),

    /** Review scheduling. */
    reviewFrequencyMonths: integer('review_frequency_months'),
    nextReviewAt: timestamp('next_review_at', { withTimezone: true, mode: 'date' }),
    lastReviewedAt: timestamp('last_reviewed_at', { withTimezone: true, mode: 'date' }),
    lastReviewedBy: text('last_reviewed_by'),

    /** Time the CURRENT version went live (re-stamped on every publish). */
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),
    /**
     * Version counter — 0 until first publish; each publish snapshots the
     * content into `risk_assessment_versions` and increments this
     * (feedback A-1 / M-3).
     */
    currentVersion: integer('current_version').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),

    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    /**
     * Bumped only by CONTENT mutations (header text, hazards, controls) —
     * not by review scheduling or distribution. `contentUpdatedAt` newer
     * than the current version row ⇒ "unpublished changes" banner.
     */
    contentUpdatedAt: timestamp('content_updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('risk_assessments_tenant_status_idx').on(table.tenantId, table.status),
    index('risk_assessments_tenant_review_idx').on(table.tenantId, table.nextReviewAt),
  ],
);

export type RiskAssessment = typeof riskAssessments.$inferSelect;
export type NewRiskAssessment = typeof riskAssessments.$inferInsert;

export const riskAssessmentHazards = pgTable(
  'risk_assessment_hazards',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    assessmentId: varchar('assessment_id', { length: 26 })
      .notNull()
      .references(() => riskAssessments.id, { onDelete: 'cascade' }),

    sortOrder: integer('sort_order').notNull().default(0),

    /** Step 1 — the hazard itself. */
    hazard: text('hazard').notNull(),
    /** Step 2 — who might be harmed (presets + free text) and how. */
    affectedGroups: jsonb('affected_groups')
      .notNull()
      .$type<ReadonlyArray<string>>()
      .default(sql`'[]'::jsonb`),
    harmDescription: text('harm_description').notNull().default(''),

    /** Step 3 — evaluation. Likelihood / severity 1–5; null until scored. */
    initialLikelihood: integer('initial_likelihood'),
    initialSeverity: integer('initial_severity'),
    existingControls: text('existing_controls').notNull().default(''),
    residualLikelihood: integer('residual_likelihood'),
    residualSeverity: integer('residual_severity'),
    /**
     * Required at publish when the residual band stays high/critical and
     * no planned control exists — "why is this tolerable / what further
     * action is planned" (feedback P-2).
     */
    residualJustification: text('residual_justification').notNull().default(''),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index('ra_hazards_assessment_idx').on(table.assessmentId)],
);

export type RiskAssessmentHazard = typeof riskAssessmentHazards.$inferSelect;
export type NewRiskAssessmentHazard = typeof riskAssessmentHazards.$inferInsert;

export const riskAssessmentControls = pgTable(
  'risk_assessment_controls',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    assessmentId: varchar('assessment_id', { length: 26 })
      .notNull()
      .references(() => riskAssessments.id, { onDelete: 'cascade' }),
    hazardId: varchar('hazard_id', { length: 26 })
      .notNull()
      .references(() => riskAssessmentHazards.id, { onDelete: 'cascade' }),

    description: text('description').notNull(),
    tier: text('tier').notNull().$type<ControlTier>(),
    status: text('status').notNull().default('in_place').$type<ControlStatus>(),
    /**
     * Required (on publish) when a hazard's controls are PPE-only — the
     * hierarchy of control demands justification for stopping at PPE.
     */
    ppeJustification: text('ppe_justification'),

    /** Set when a planned control generated a CAPA action. */
    actionId: varchar('action_id', { length: 26 }),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index('ra_controls_hazard_idx').on(table.hazardId)],
);

export type RiskAssessmentControl = typeof riskAssessmentControls.$inferSelect;
export type NewRiskAssessmentControl = typeof riskAssessmentControls.$inferInsert;

export const riskAssessmentReviews = pgTable(
  'risk_assessment_reviews',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    assessmentId: varchar('assessment_id', { length: 26 })
      .notNull()
      .references(() => riskAssessments.id, { onDelete: 'cascade' }),

    trigger: text('trigger').notNull().$type<ReviewTrigger>(),
    outcome: text('outcome').notNull().$type<ReviewOutcome>(),
    note: text('note').notNull().default(''),

    reviewedBy: text('reviewed_by').notNull(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index('ra_reviews_assessment_idx').on(table.assessmentId)],
);

export type RiskAssessmentReview = typeof riskAssessmentReviews.$inferSelect;

export const riskAssessmentAcknowledgements = pgTable(
  'risk_assessment_acknowledgements',
  {
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    assessmentId: varchar('assessment_id', { length: 26 })
      .notNull()
      .references(() => riskAssessments.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),

    distributedAt: timestamp('distributed_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    /**
     * The version this person is being asked to acknowledge. Re-stamped
     * to the new version on every publish so acknowledgements re-open
     * (feedback A-1 / M-3).
     */
    versionNumber: integer('version_number').notNull().default(1),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true, mode: 'date' }),
    /**
     * The version that was actually acknowledged. Pending :=
     * acknowledgedAt IS NULL OR acknowledgedVersion < versionNumber.
     */
    acknowledgedVersion: integer('acknowledged_version'),
    /** Acknowledgement deadline (feedback A-3). */
    dueAt: timestamp('due_at', { withTimezone: true, mode: 'date' }),
    /** Reminder dedupe stamp — see the ra-ack-reminder worker. */
    lastReminderAt: timestamp('last_reminder_at', { withTimezone: true, mode: 'date' }),
    /** True when the row was re-distributed after a review/update. */
    redistributed: boolean('redistributed').notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.assessmentId, table.userId] }),
    index('ra_acks_tenant_user_idx').on(table.tenantId, table.userId),
  ],
);

export type RiskAssessmentAcknowledgement = typeof riskAssessmentAcknowledgements.$inferSelect;

/** One control inside a frozen version snapshot. */
export interface RaVersionControl {
  description: string;
  tier: ControlTier;
  status: ControlStatus;
  ppeJustification: string | null;
}

/** One hazard inside a frozen version snapshot. */
export interface RaVersionHazard {
  hazard: string;
  harmDescription: string;
  affectedGroups: ReadonlyArray<string>;
  initialLikelihood: number | null;
  initialSeverity: number | null;
  existingControls: string;
  residualLikelihood: number | null;
  residualSeverity: number | null;
  residualJustification: string;
  controls: RaVersionControl[];
}

/**
 * The full content frozen at publish time — everything needed to
 * reproduce "the assessment as in force on {date}" without touching the
 * mutable working rows.
 */
export interface RaVersionContent {
  title: string;
  activity: string;
  type: RiskAssessmentType;
  siteId: string | null;
  siteName: string | null;
  locationText: string | null;
  matrix: RiskMatrixConfig;
  hazards: RaVersionHazard[];
}

/**
 * Immutable published versions (feedback A-1 / M-2 / M-3). One row per
 * publish; `content` is never UPDATEd after insert. Acknowledgements
 * reference `versionNumber`, so "read & understood" is always tied to
 * the exact content that was live — and the assessor sign-off is a
 * first-class field, not an inference from `createdBy`.
 */
export const riskAssessmentVersions = pgTable(
  'risk_assessment_versions',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    assessmentId: varchar('assessment_id', { length: 26 })
      .notNull()
      .references(() => riskAssessments.id, { onDelete: 'cascade' }),

    versionNumber: integer('version_number').notNull(),
    content: jsonb('content').notNull().$type<RaVersionContent>(),

    /** The assessor who actively confirmed the sign-off statement (M-2). */
    signedOffBy: text('signed_off_by').notNull(),
    /** Name snapshot so the printed record survives user renames. */
    signedOffByName: text('signed_off_by_name'),
    signedOffAt: timestamp('signed_off_at', { withTimezone: true, mode: 'date' }).notNull(),

    /** How many CAPA actions this publish created (audit convenience). */
    actionsCreated: integer('actions_created').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('ra_versions_assessment_version_idx').on(table.assessmentId, table.versionNumber),
    index('ra_versions_tenant_idx').on(table.tenantId),
  ],
);

export type RiskAssessmentVersion = typeof riskAssessmentVersions.$inferSelect;

/**
 * Per-tenant matrix configuration (feedback P-4). Applied as a snapshot
 * to assessments at creation (and optionally pushed to open drafts);
 * published history keeps its own snapshot so band labels never shift
 * under an audit.
 */
export const tenantRiskMatrixSettings = pgTable('tenant_risk_matrix_settings', {
  tenantId: varchar('tenant_id', { length: 26 })
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'restrict' }),
  lowMax: integer('low_max').notNull().default(DEFAULT_RISK_MATRIX.lowMax),
  mediumMax: integer('medium_max').notNull().default(DEFAULT_RISK_MATRIX.mediumMax),
  highMax: integer('high_max').notNull().default(DEFAULT_RISK_MATRIX.highMax),
  /** Severity value ('1'…'5') → minimum band, e.g. `{"5":"high"}`. */
  severityFloors: jsonb('severity_floors')
    .notNull()
    .$type<Record<string, RiskBandLevel>>()
    .default(sql`'{}'::jsonb`),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .default(sql`now()`),
});

export type TenantRiskMatrixSettings = typeof tenantRiskMatrixSettings.$inferSelect;

export const RA_EVENT_KINDS = [
  'created',
  'title_changed',
  'site_changed',
  'published',
  'moved_to_draft',
  'archived',
  'hazard_added',
  'hazard_removed',
  'control_added',
  'control_removed',
  'review_recorded',
  'distributed',
  'acknowledged',
  'variant_created',
] as const;
export type RaEventKind = (typeof RA_EVENT_KINDS)[number];

/**
 * Append-only change log (practitioner review #9 point 4). The router
 * writes one row per meaningful mutation and exposes no way to alter or
 * remove rows — the log is evidence, not state.
 */
export const riskAssessmentEvents = pgTable(
  'risk_assessment_events',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    assessmentId: varchar('assessment_id', { length: 26 })
      .notNull()
      .references(() => riskAssessments.id, { onDelete: 'cascade' }),
    actorUserId: text('actor_user_id').notNull(),
    kind: text('kind').notNull().$type<RaEventKind>(),
    detail: text('detail').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index('ra_events_assessment_idx').on(table.assessmentId, table.createdAt)],
);

export type RiskAssessmentEvent = typeof riskAssessmentEvents.$inferSelect;
