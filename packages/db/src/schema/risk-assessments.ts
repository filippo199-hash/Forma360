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
 *     records, one row per (assessment, user).
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
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
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

/** Matrix band thresholds over likelihood × severity (1–5 each). */
export interface RiskMatrixConfig {
  /** Score ≤ lowMax → low; ≤ mediumMax → medium; ≤ highMax → high; else critical. */
  lowMax: number;
  mediumMax: number;
  highMax: number;
}

export const DEFAULT_RISK_MATRIX: RiskMatrixConfig = { lowMax: 4, mediumMax: 9, highMax: 15 };

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

    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),

    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
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
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true, mode: 'date' }),
    /** True when the row was re-distributed after a review/update. */
    redistributed: boolean('redistributed').notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.assessmentId, table.userId] }),
    index('ra_acks_tenant_user_idx').on(table.tenantId, table.userId),
  ],
);

export type RiskAssessmentAcknowledgement = typeof riskAssessmentAcknowledgements.$inferSelect;
