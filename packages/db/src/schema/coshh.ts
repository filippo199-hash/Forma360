/**
 * COSHH (FreeHS module B2) — Control of Substances Hazardous to Health.
 *
 * A live inventory of every hazardous substance on site, its assessment,
 * its controls, and the exposure it creates.
 *
 * Model:
 *   - `coshh_substances` — the product record. Hazard profile (GHS
 *     classification, H/P statements, pictograms, WELs) lives here as
 *     jsonb, pre-populated from the safety data sheet by the AI reader
 *     and always editable. Special-regime flags (carcinogen, mutagen,
 *     asthmagen, biological agent, lead, asbestos-referral) drive the
 *     substitution-first prompting.
 *   - `coshh_substance_locations` — where and how much: one row per
 *     site/place with quantity, storage class (segregation bucket) and
 *     storage notes. Incompatibility warnings are computed from storage
 *     classes at read time (`@forma360/shared/coshh`).
 *   - `coshh_sds_documents` — versioned safety data sheets. Exactly one
 *     `isCurrent` row per substance; `reviewByDate` powers the
 *     sheet-too-old prompt. The AI extraction snapshot is kept for audit.
 *   - `coshh_assessments` — task-level COSHH assessments: route of
 *     exposure, quantity/frequency/duration bands, persons exposed, and
 *     the plain-language summary for the people using the substance.
 *   - `coshh_assessment_controls` — hierarchy-of-control entries
 *     (eliminate → substitute → engineering → administrative → RPE →
 *     other PPE). PPE/RPE-only reliance requires a justification to
 *     publish; `planned` controls generate actions on publish.
 *   - `coshh_exposure_monitoring` — monitoring results compared against
 *     the substance's WELs at record time (`exceedsWel` snapshot;
 *     null = not comparable).
 *   - `coshh_lev_units` + `coshh_lev_tests` — local exhaust ventilation
 *     register and its thorough examination & test log (statutory
 *     14-month default interval).
 *   - `coshh_events` — append-only audit log across the module's
 *     entities. Evidence, not state.
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type {
  HStatement,
  MonitoringPeriod,
  PhysicalForm,
  PStatement,
  SdsExtraction,
  SignalWord,
  StorageClass,
  WelUnit,
  WorkplaceExposureLimit,
} from '@forma360/shared/coshh';
import { sites } from './sites';
import { tenants } from './tenants';

export const COSHH_SUBSTANCE_STATUSES = ['active', 'archived'] as const;
export type CoshhSubstanceStatus = (typeof COSHH_SUBSTANCE_STATUSES)[number];

export const SUBSTITUTION_STATUSES = [
  'not_assessed',
  'considered_rejected',
  'planned',
  'substituted',
] as const;
export type SubstitutionStatus = (typeof SUBSTITUTION_STATUSES)[number];

export const COSHH_QUANTITY_UNITS = ['ml', 'l', 'g', 'kg', 'units'] as const;
export type CoshhQuantityUnit = (typeof COSHH_QUANTITY_UNITS)[number];

export const COSHH_ASSESSMENT_STATUSES = ['draft', 'active', 'archived'] as const;
export type CoshhAssessmentStatus = (typeof COSHH_ASSESSMENT_STATUSES)[number];

export const EXPOSURE_ROUTES = ['inhalation', 'skin', 'eyes', 'ingestion', 'injection'] as const;
export type ExposureRoute = (typeof EXPOSURE_ROUTES)[number];

export const QUANTITY_BANDS = ['small', 'medium', 'large'] as const;
export type QuantityBand = (typeof QUANTITY_BANDS)[number];

export const FREQUENCY_BANDS = ['rare', 'monthly', 'weekly', 'daily', 'continuous'] as const;
export type FrequencyBand = (typeof FREQUENCY_BANDS)[number];

export const DURATION_BANDS = ['under_15_min', '15_60_min', '1_4_h', 'over_4_h'] as const;
export type DurationBand = (typeof DURATION_BANDS)[number];

/**
 * COSHH hierarchy of control. Ordered: the module prompts substitution
 * first, then engineering (LEV), then administrative measures, and treats
 * RPE / other PPE as the last resort that needs justifying.
 */
export const COSHH_CONTROL_TIERS = [
  'elimination',
  'substitution',
  'engineering',
  'administrative',
  'rpe',
  'ppe',
] as const;
export type CoshhControlTier = (typeof COSHH_CONTROL_TIERS)[number];

export const COSHH_CONTROL_STATUSES = ['in_place', 'planned'] as const;
export type CoshhControlStatus = (typeof COSHH_CONTROL_STATUSES)[number];

export const SAMPLE_TYPES = ['personal', 'static', 'biological'] as const;
export type SampleType = (typeof SAMPLE_TYPES)[number];

export const LEV_STATUSES = ['in_service', 'out_of_service', 'decommissioned'] as const;
export type LevStatus = (typeof LEV_STATUSES)[number];

export const LEV_TEST_RESULTS = ['pass', 'pass_with_defects', 'fail'] as const;
export type LevTestResult = (typeof LEV_TEST_RESULTS)[number];

/** Preset "persons exposed" groups; free-text extras allowed (same as RA). */
export const COSHH_EXPOSED_GROUP_PRESETS = [
  'employees',
  'cleaners',
  'contractors',
  'maintenance_staff',
  'young_persons',
  'new_expectant_mothers',
  'visitors',
  'members_of_public',
] as const;

export const coshhSubstances = pgTable(
  'coshh_substances',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    /** Human-friendly reference ("CS-0001"), stamped in the create tx. */
    referenceNumber: text('reference_number'),

    name: text('name').notNull(),
    supplier: text('supplier').notNull().default(''),
    /** Catalogue / article / UFI identifier from the SDS, if any. */
    productIdentifier: text('product_identifier').notNull().default(''),
    physicalForm: text('physical_form').$type<PhysicalForm>(),
    /** What the substance is used for, in the assessor's words. */
    usageDescription: text('usage_description').notNull().default(''),

    // ── Hazard profile (pre-populated from the SDS, always editable) ──
    signalWord: text('signal_word').$type<SignalWord>(),
    hazardClassification: jsonb('hazard_classification')
      .notNull()
      .$type<ReadonlyArray<string>>()
      .default(sql`'[]'::jsonb`),
    hStatements: jsonb('h_statements')
      .notNull()
      .$type<ReadonlyArray<HStatement>>()
      .default(sql`'[]'::jsonb`),
    pStatements: jsonb('p_statements')
      .notNull()
      .$type<ReadonlyArray<PStatement>>()
      .default(sql`'[]'::jsonb`),
    pictograms: jsonb('pictograms')
      .notNull()
      .$type<ReadonlyArray<string>>()
      .default(sql`'[]'::jsonb`),
    workplaceExposureLimits: jsonb('workplace_exposure_limits')
      .notNull()
      .$type<ReadonlyArray<WorkplaceExposureLimit>>()
      .default(sql`'[]'::jsonb`),

    // ── Special regimes ──
    isCarcinogen: boolean('is_carcinogen').notNull().default(false),
    isMutagen: boolean('is_mutagen').notNull().default(false),
    isAsthmagen: boolean('is_asthmagen').notNull().default(false),
    isBiologicalAgent: boolean('is_biological_agent').notNull().default(false),
    containsLead: boolean('contains_lead').notNull().default(false),
    /** Asbestos is out of COSHH scope — flag records the CAR 2012 referral. */
    asbestosReferral: boolean('asbestos_referral').notNull().default(false),

    // ── Substitution-first ──
    substitutionStatus: text('substitution_status')
      .notNull()
      .default('not_assessed')
      .$type<SubstitutionStatus>(),
    substitutionNotes: text('substitution_notes').notNull().default(''),

    /** SDS review age before the module prompts (months). */
    sdsReviewMonths: integer('sds_review_months').notNull().default(36),

    status: text('status').notNull().default('active').$type<CoshhSubstanceStatus>(),
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
    index('coshh_substances_tenant_status_idx').on(table.tenantId, table.status),
    index('coshh_substances_tenant_name_idx').on(table.tenantId, table.name),
  ],
);

export type CoshhSubstance = typeof coshhSubstances.$inferSelect;
export type NewCoshhSubstance = typeof coshhSubstances.$inferInsert;

export const coshhSubstanceLocations = pgTable(
  'coshh_substance_locations',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    substanceId: varchar('substance_id', { length: 26 })
      .notNull()
      .references(() => coshhSubstances.id, { onDelete: 'cascade' }),

    siteId: varchar('site_id', { length: 26 }).references(() => sites.id, {
      onDelete: 'set null',
    }),
    locationText: text('location_text').notNull().default(''),

    quantity: real('quantity'),
    unit: text('unit').$type<CoshhQuantityUnit>(),

    /** Segregation bucket for incompatibility warnings; null = unclassified. */
    storageClass: text('storage_class').$type<StorageClass>(),
    storageNotes: text('storage_notes').notNull().default(''),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('coshh_locations_substance_idx').on(table.substanceId),
    index('coshh_locations_tenant_site_idx').on(table.tenantId, table.siteId),
  ],
);

export type CoshhSubstanceLocation = typeof coshhSubstanceLocations.$inferSelect;
export type NewCoshhSubstanceLocation = typeof coshhSubstanceLocations.$inferInsert;

export const coshhSdsDocuments = pgTable(
  'coshh_sds_documents',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    substanceId: varchar('substance_id', { length: 26 })
      .notNull()
      .references(() => coshhSubstances.id, { onDelete: 'cascade' }),

    /** 1-based, incremented per substance on attach. */
    version: integer('version').notNull(),
    storageKey: text('storage_key').notNull(),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),

    /** Revision date printed on the sheet. */
    issueDate: timestamp('issue_date', { withTimezone: true, mode: 'date' }),
    /** When the sheet-too-old prompt fires (issueDate + sdsReviewMonths). */
    reviewByDate: timestamp('review_by_date', { withTimezone: true, mode: 'date' }),

    /** AI extraction snapshot for audit; null when attached manually. */
    extraction: jsonb('extraction').$type<SdsExtraction>(),

    isCurrent: boolean('is_current').notNull().default(true),

    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('coshh_sds_substance_version_uq').on(table.substanceId, table.version),
    index('coshh_sds_substance_idx').on(table.substanceId),
  ],
);

export type CoshhSdsDocument = typeof coshhSdsDocuments.$inferSelect;
export type NewCoshhSdsDocument = typeof coshhSdsDocuments.$inferInsert;

export const coshhAssessments = pgTable(
  'coshh_assessments',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    substanceId: varchar('substance_id', { length: 26 })
      .notNull()
      .references(() => coshhSubstances.id, { onDelete: 'cascade' }),

    /** Human-friendly reference ("COSHH-0001"), stamped in the create tx. */
    referenceNumber: text('reference_number'),

    /** The task / activity this assessment covers. */
    taskDescription: text('task_description').notNull(),

    status: text('status').notNull().default('draft').$type<CoshhAssessmentStatus>(),

    routesOfExposure: jsonb('routes_of_exposure')
      .notNull()
      .$type<ReadonlyArray<ExposureRoute>>()
      .default(sql`'[]'::jsonb`),
    personsExposed: jsonb('persons_exposed')
      .notNull()
      .$type<ReadonlyArray<string>>()
      .default(sql`'[]'::jsonb`),
    personsCount: integer('persons_count'),

    quantityBand: text('quantity_band').$type<QuantityBand>(),
    frequencyBand: text('frequency_band').$type<FrequencyBand>(),
    durationBand: text('duration_band').$type<DurationBand>(),

    levRequired: boolean('lev_required').notNull().default(false),
    healthSurveillanceRequired: boolean('health_surveillance_required').notNull().default(false),
    exposureMonitoringRequired: boolean('exposure_monitoring_required').notNull().default(false),
    emergencyNotes: text('emergency_notes').notNull().default(''),

    /** Task-level plain-language summary for the people doing the work. */
    plainSummary: text('plain_summary').notNull().default(''),

    assessorUserId: text('assessor_user_id'),

    reviewFrequencyMonths: integer('review_frequency_months'),
    nextReviewAt: timestamp('next_review_at', { withTimezone: true, mode: 'date' }),
    lastReviewedAt: timestamp('last_reviewed_at', { withTimezone: true, mode: 'date' }),
    lastReviewedBy: text('last_reviewed_by'),

    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),
    /** Assessor sign-off: who attested "suitable and sufficient" on publish. */
    publishedBy: text('published_by'),
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
    index('coshh_assessments_tenant_status_idx').on(table.tenantId, table.status),
    index('coshh_assessments_substance_idx').on(table.substanceId),
    index('coshh_assessments_tenant_review_idx').on(table.tenantId, table.nextReviewAt),
  ],
);

export type CoshhAssessment = typeof coshhAssessments.$inferSelect;
export type NewCoshhAssessment = typeof coshhAssessments.$inferInsert;

export const coshhAssessmentControls = pgTable(
  'coshh_assessment_controls',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    assessmentId: varchar('assessment_id', { length: 26 })
      .notNull()
      .references(() => coshhAssessments.id, { onDelete: 'cascade' }),

    tier: text('tier').notNull().$type<CoshhControlTier>(),
    description: text('description').notNull(),
    status: text('status').notNull().default('in_place').$type<CoshhControlStatus>(),
    /**
     * Required (on publish) when the assessment's controls are RPE/PPE-only —
     * exposure control relying on PPE must be justified.
     */
    ppeJustification: text('ppe_justification'),

    // ── RPE detail (meaningful when tier = 'rpe') — type, assigned
    // protection factor, and the wearer face-fit evidence date.
    rpeType: text('rpe_type'),
    rpeApf: integer('rpe_apf'),
    faceFitConfirmedAt: timestamp('face_fit_confirmed_at', { withTimezone: true, mode: 'date' }),

    /** Set when a planned control generated an action at publish. */
    actionId: varchar('action_id', { length: 26 }),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index('coshh_controls_assessment_idx').on(table.assessmentId)],
);

export type CoshhAssessmentControl = typeof coshhAssessmentControls.$inferSelect;
export type NewCoshhAssessmentControl = typeof coshhAssessmentControls.$inferInsert;

export const coshhExposureMonitoring = pgTable(
  'coshh_exposure_monitoring',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    substanceId: varchar('substance_id', { length: 26 })
      .notNull()
      .references(() => coshhSubstances.id, { onDelete: 'cascade' }),

    /** The agent measured (matches a WEL entry's agent when comparable). */
    agent: text('agent').notNull(),
    sampledAt: timestamp('sampled_at', { withTimezone: true, mode: 'date' }).notNull(),
    sampleType: text('sample_type').notNull().default('personal').$type<SampleType>(),
    period: text('period').notNull().$type<MonitoringPeriod>(),
    resultValue: real('result_value').notNull(),
    resultUnit: text('result_unit').notNull().$type<WelUnit>(),

    /** Snapshot of the WEL comparison at record time; null = not comparable. */
    exceedsWel: boolean('exceeds_wel'),

    notes: text('notes').notNull().default(''),
    recordedBy: text('recorded_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index('coshh_monitoring_substance_idx').on(table.substanceId, table.sampledAt)],
);

export type CoshhExposureMonitoring = typeof coshhExposureMonitoring.$inferSelect;
export type NewCoshhExposureMonitoring = typeof coshhExposureMonitoring.$inferInsert;

export const coshhLevUnits = pgTable(
  'coshh_lev_units',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    name: text('name').notNull(),
    siteId: varchar('site_id', { length: 26 }).references(() => sites.id, {
      onDelete: 'set null',
    }),
    locationText: text('location_text').notNull().default(''),
    description: text('description').notNull().default(''),

    /** Statutory default is 14 months (COSHH reg 9); shorter allowed. */
    testIntervalMonths: integer('test_interval_months').notNull().default(14),
    lastTestAt: timestamp('last_test_at', { withTimezone: true, mode: 'date' }),
    nextTestDueAt: timestamp('next_test_due_at', { withTimezone: true, mode: 'date' }),

    status: text('status').notNull().default('in_service').$type<LevStatus>(),

    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index('coshh_lev_units_tenant_status_idx').on(table.tenantId, table.status)],
);

export type CoshhLevUnit = typeof coshhLevUnits.$inferSelect;
export type NewCoshhLevUnit = typeof coshhLevUnits.$inferInsert;

export const coshhLevTests = pgTable(
  'coshh_lev_tests',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    levUnitId: varchar('lev_unit_id', { length: 26 })
      .notNull()
      .references(() => coshhLevUnits.id, { onDelete: 'cascade' }),

    testedAt: timestamp('tested_at', { withTimezone: true, mode: 'date' }).notNull(),
    result: text('result').notNull().$type<LevTestResult>(),
    /** Person / company that carried out the thorough examination. */
    examiner: text('examiner').notNull().default(''),
    reportStorageKey: text('report_storage_key'),
    defectsSummary: text('defects_summary').notNull().default(''),

    recordedBy: text('recorded_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index('coshh_lev_tests_unit_idx').on(table.levUnitId, table.testedAt)],
);

export type CoshhLevTest = typeof coshhLevTests.$inferSelect;
export type NewCoshhLevTest = typeof coshhLevTests.$inferInsert;

/**
 * Health surveillance register (COSHH Reg 11). One row per person per
 * substance: who is under surveillance, on what recall interval, when
 * they were last seen and when they are next due. Rows are ended (not
 * deleted) so the record survives — surveillance records carry a
 * 40-year retention duty.
 */
export const coshhHealthSurveillance = pgTable(
  'coshh_health_surveillance',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    substanceId: varchar('substance_id', { length: 26 })
      .notNull()
      .references(() => coshhSubstances.id, { onDelete: 'cascade' }),

    userId: text('user_id').notNull(),

    /** Recall cadence. 12 months is the common default for LFTs/skin checks. */
    intervalMonths: integer('interval_months').notNull().default(12),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    lastCheckAt: timestamp('last_check_at', { withTimezone: true, mode: 'date' }),
    nextDueAt: timestamp('next_due_at', { withTimezone: true, mode: 'date' }).notNull(),
    notes: text('notes').notNull().default(''),
    /** Set when the person leaves surveillance; the row is never deleted. */
    endedAt: timestamp('ended_at', { withTimezone: true, mode: 'date' }),

    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('coshh_surveillance_substance_idx').on(table.substanceId),
    index('coshh_surveillance_tenant_due_idx').on(table.tenantId, table.nextDueAt),
  ],
);

export type CoshhHealthSurveillance = typeof coshhHealthSurveillance.$inferSelect;
export type NewCoshhHealthSurveillance = typeof coshhHealthSurveillance.$inferInsert;

export const COSHH_EVENT_ENTITY_TYPES = ['substance', 'assessment', 'lev_unit'] as const;
export type CoshhEventEntityType = (typeof COSHH_EVENT_ENTITY_TYPES)[number];

export const COSHH_EVENT_KINDS = [
  'created',
  'updated',
  'archived',
  'location_added',
  'location_removed',
  'sds_attached',
  'sds_confirmed_current',
  'assessment_created',
  'published',
  'moved_to_draft',
  'control_added',
  'control_removed',
  'review_recorded',
  'monitoring_recorded',
  'lev_test_recorded',
  'substitution_updated',
  'surveillance_enrolled',
  'surveillance_check_recorded',
  'surveillance_ended',
] as const;
export type CoshhEventKind = (typeof COSHH_EVENT_KINDS)[number];

/**
 * Append-only change log across the module's entities. The router writes
 * one row per meaningful mutation and exposes no way to alter or remove
 * rows — the log is evidence, not state.
 */
export const coshhEvents = pgTable(
  'coshh_events',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    entityType: text('entity_type').notNull().$type<CoshhEventEntityType>(),
    entityId: varchar('entity_id', { length: 26 }).notNull(),
    actorUserId: text('actor_user_id').notNull(),
    kind: text('kind').notNull().$type<CoshhEventKind>(),
    detail: text('detail').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('coshh_events_entity_idx').on(
      table.tenantId,
      table.entityType,
      table.entityId,
      table.createdAt,
    ),
  ],
);

export type CoshhEvent = typeof coshhEvents.$inferSelect;
