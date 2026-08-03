/**
 * Fire Safety (FreeHS module B4) — the fire risk assessment, the fire
 * safety arrangements, and the recurring checks that keep them true.
 *
 * Model:
 *   - `fire_buildings` — the premises record: residential flag, height /
 *     storeys (drives the 2022 Regulations duties), fire-system flags
 *     (drive the check catalogue), building information for the fire and
 *     rescue service (external wall system, compartmentation, means of
 *     escape, risers, secure information box) and attached plan
 *     documents (jsonb, Zod-validated at the boundary).
 *   - `fire_risk_assessments` — the FRA header. Reviewable rather than
 *     rewritable: publish stamps the record active, reviews append to
 *     `fire_fra_reviews`, and every content change lands in the event
 *     log. Significant findings are first-class child rows.
 *   - `fire_significant_findings` — step-4 records. `requiresAction`
 *     findings generate actions on publish, exactly once (`actionId`).
 *   - `fire_fra_reviews` — append-only review log with the trigger that
 *     prompted it (scheduled, post-incident, material change, …).
 *   - `fire_logbook_checks` — the standing calendar: one row per
 *     building × check type with its frequency and next-due date.
 *     Seeded from the check catalogue (`source='auto'`), extendable
 *     manually (`source='manual'`).
 *   - `fire_logbook_entries` — the logbook itself: append-only evidence
 *     of every alarm test, lighting test, extinguisher check, … A
 *     failed check can raise an action, once.
 *   - `fire_doors` + `fire_door_inspections` — doors as inspectable
 *     assets with the quarterly common-parts / annual flat-entrance
 *     regime in relevant residential buildings above eleven metres.
 *   - `fire_drills` — drill records: evacuation time, muster-point roll,
 *     lessons learned. Recording a drill also satisfies the `fire_drill`
 *     logbook schedule.
 *   - `fire_peeps` — personal emergency evacuation plans, reviewed on a
 *     cadence and ended (never deleted) when no longer needed.
 *   - `fire_marshals` — marshal / warden register per building with
 *     training dates; coverage gaps are computed at read time.
 *   - `fire_events` — append-only audit log across the module's
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
  BuildingDocument,
  CheckFrequency,
  DoorChecklist,
  FireCheckType,
  FireDoorLocationKind,
  FraFindingCategory,
  FraFindingPriority,
  FraMethodology,
  FraRiskRating,
} from '@forma360/shared/fire-safety';
import { assets } from './assets';
import { sites } from './sites';
import { tenants } from './tenants';

export const FIRE_BUILDING_STATUSES = ['active', 'archived'] as const;
export type FireBuildingStatus = (typeof FIRE_BUILDING_STATUSES)[number];

export const fireBuildings = pgTable(
  'fire_buildings',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    name: text('name').notNull(),
    siteId: varchar('site_id', { length: 26 }).references(() => sites.id, {
      onDelete: 'set null',
    }),
    address: text('address').notNull().default(''),
    /** What the building is used for, in the practitioner's words. */
    useDescription: text('use_description').notNull().default(''),

    // ── Classification (drives the statutory duty profile) ──
    isResidential: boolean('is_residential').notNull().default(false),
    /** Height of the top occupied storey above ground, metres. */
    heightMetres: real('height_metres'),
    storeys: integer('storeys'),

    // ── Fire-system flags (drive the check catalogue) ──
    hasFireAlarm: boolean('has_fire_alarm').notNull().default(true),
    hasEmergencyLighting: boolean('has_emergency_lighting').notNull().default(true),
    hasSprinklers: boolean('has_sprinklers').notNull().default(false),
    hasDampers: boolean('has_dampers').notNull().default(false),
    hasRisers: boolean('has_risers').notNull().default(false),

    // ── Building information (held for the fire and rescue service) ──
    externalWallSystem: text('external_wall_system').notNull().default(''),
    compartmentationNotes: text('compartmentation_notes').notNull().default(''),
    meansOfEscapeNotes: text('means_of_escape_notes').notNull().default(''),
    serviceRisersNotes: text('service_risers_notes').notNull().default(''),
    /** Where the secure information box is, for high-rise duties. */
    secureInfoBoxLocation: text('secure_info_box_location').notNull().default(''),

    /**
     * Marshal coverage is opt-in per building (HSE review FS-8): a lock-up
     * substation doesn't need a marshal, and flagging it forever trains
     * people to ignore the amber. Buildings that do need cover state the
     * minimum headcount they need in date.
     */
    requiresMarshalCover: boolean('requires_marshal_cover').notNull().default(true),
    marshalTarget: integer('marshal_target').notNull().default(1),
    /** Attached plans / EWS documents; Zod-validated at the boundary. */
    infoDocuments: jsonb('info_documents')
      .notNull()
      .$type<ReadonlyArray<BuildingDocument>>()
      .default(sql`'[]'::jsonb`),

    status: text('status').notNull().default('active').$type<FireBuildingStatus>(),
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
    index('fire_buildings_tenant_status_idx').on(table.tenantId, table.status),
    index('fire_buildings_tenant_name_idx').on(table.tenantId, table.name),
  ],
);

export type FireBuilding = typeof fireBuildings.$inferSelect;
export type NewFireBuilding = typeof fireBuildings.$inferInsert;

export const FRA_STATUSES = ['draft', 'active', 'archived'] as const;
export type FraStatus = (typeof FRA_STATUSES)[number];

export const fireRiskAssessments = pgTable(
  'fire_risk_assessments',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    /** Null when the premises isn't modelled as a building record. */
    buildingId: varchar('building_id', { length: 26 }).references(() => fireBuildings.id, {
      onDelete: 'set null',
    }),

    /** Human-friendly reference ("FRA-0001"), stamped in the create tx. */
    referenceNumber: text('reference_number'),

    title: text('title').notNull(),
    premisesDescription: text('premises_description').notNull().default(''),
    methodology: text('methodology').notNull().default('pas79').$type<FraMethodology>(),

    /** The named Responsible Person (article 3, Fire Safety Order). */
    responsiblePersonName: text('responsible_person_name').notNull().default(''),
    assessorUserId: text('assessor_user_id'),
    /** External assessor name when the FRA was bought in. */
    assessorName: text('assessor_name').notNull().default(''),

    // ── Occupancy profile ──
    personsAtRisk: jsonb('persons_at_risk')
      .notNull()
      .$type<ReadonlyArray<string>>()
      .default(sql`'[]'::jsonb`),
    maxOccupancy: integer('max_occupancy'),
    sleepingOccupants: boolean('sleeping_occupants').notNull().default(false),

    // ── Hazard narrative (step 1–3) ──
    ignitionSources: text('ignition_sources').notNull().default(''),
    fuelSources: text('fuel_sources').notNull().default(''),
    oxygenSources: text('oxygen_sources').notNull().default(''),
    evaluationNotes: text('evaluation_notes').notNull().default(''),

    /** PAS 79-style taken-together rating; null until evaluated. */
    riskRating: text('risk_rating').$type<FraRiskRating>(),

    status: text('status').notNull().default('draft').$type<FraStatus>(),
    /**
     * When the assessment content (narrative, occupancy, rating,
     * findings) last changed — compared against `publishedAt` to detect
     * an active FRA edited after sign-off (HSE review FS-7). The
     * signature is only valid for the content it signed.
     */
    contentUpdatedAt: timestamp('content_updated_at', { withTimezone: true, mode: 'date' }),
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),
    /** Who attested "suitable and sufficient" on the latest publish. */
    publishedBy: text('published_by'),

    reviewFrequencyMonths: integer('review_frequency_months'),
    nextReviewAt: timestamp('next_review_at', { withTimezone: true, mode: 'date' }),
    lastReviewedAt: timestamp('last_reviewed_at', { withTimezone: true, mode: 'date' }),
    lastReviewedBy: text('last_reviewed_by'),

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
    index('fire_fras_tenant_status_idx').on(table.tenantId, table.status),
    index('fire_fras_tenant_review_idx').on(table.tenantId, table.nextReviewAt),
    index('fire_fras_building_idx').on(table.buildingId),
  ],
);

export type FireRiskAssessment = typeof fireRiskAssessments.$inferSelect;
export type NewFireRiskAssessment = typeof fireRiskAssessments.$inferInsert;

export const fireSignificantFindings = pgTable(
  'fire_significant_findings',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    fraId: varchar('fra_id', { length: 26 })
      .notNull()
      .references(() => fireRiskAssessments.id, { onDelete: 'cascade' }),

    sortOrder: integer('sort_order').notNull().default(0),
    category: text('category').notNull().$type<FraFindingCategory>(),
    priority: text('priority').notNull().default('medium').$type<FraFindingPriority>(),
    description: text('description').notNull(),

    /** Findings needing remedial work generate an action on publish. */
    requiresAction: boolean('requires_action').notNull().default(true),
    /** Set when publish generated the action — the once-only guard. */
    actionId: varchar('action_id', { length: 26 }),

    resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
    resolvedBy: text('resolved_by'),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index('fire_findings_fra_idx').on(table.fraId)],
);

export type FireSignificantFinding = typeof fireSignificantFindings.$inferSelect;
export type NewFireSignificantFinding = typeof fireSignificantFindings.$inferInsert;

export const FRA_REVIEW_TRIGGERS = [
  'scheduled',
  'post_incident',
  'material_change',
  'legislation_change',
  'manual',
] as const;
export type FraReviewTrigger = (typeof FRA_REVIEW_TRIGGERS)[number];

export const FRA_REVIEW_OUTCOMES = ['confirmed', 'updated'] as const;
export type FraReviewOutcome = (typeof FRA_REVIEW_OUTCOMES)[number];

/**
 * Append-only review log — the "reviewable rather than rewritable"
 * spine. The router exposes no way to alter or remove rows.
 */
export const fireFraReviews = pgTable(
  'fire_fra_reviews',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    fraId: varchar('fra_id', { length: 26 })
      .notNull()
      .references(() => fireRiskAssessments.id, { onDelete: 'cascade' }),

    trigger: text('trigger').notNull().$type<FraReviewTrigger>(),
    outcome: text('outcome').notNull().$type<FraReviewOutcome>(),
    note: text('note').notNull().default(''),

    reviewedBy: text('reviewed_by').notNull(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index('fire_fra_reviews_fra_idx').on(table.fraId)],
);

export type FireFraReview = typeof fireFraReviews.$inferSelect;

/** Auto-seeded from the building profile vs added by hand. */
export const FIRE_CHECK_SOURCES = ['auto', 'manual'] as const;
export type FireCheckSource = (typeof FIRE_CHECK_SOURCES)[number];

export const fireLogbookChecks = pgTable(
  'fire_logbook_checks',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    buildingId: varchar('building_id', { length: 26 })
      .notNull()
      .references(() => fireBuildings.id, { onDelete: 'cascade' }),

    checkType: text('check_type').notNull().$type<FireCheckType>(),
    frequency: text('frequency').notNull().$type<CheckFrequency>(),
    source: text('source').notNull().default('auto').$type<FireCheckSource>(),
    /** Deactivated instead of deleted so the calendar history survives. */
    active: boolean('active').notNull().default(true),

    assignedToUserId: text('assigned_to_user_id'),
    notes: text('notes').notNull().default(''),

    /**
     * The maintained asset this check concerns (PF-17) — e.g. the
     * extinguisher or sprinkler set that also lives in the Assets module.
     * Optional; links the fire logbook history onto the asset page.
     */
    assetId: varchar('asset_id', { length: 26 }).references(() => assets.id, {
      onDelete: 'set null',
    }),

    lastDoneAt: timestamp('last_done_at', { withTimezone: true, mode: 'date' }),
    /**
     * Result of the newest recorded entry (HSE review FS-1). A 'fail'
     * here holds the check in the red "failed" display state until a
     * subsequent pass clears it — advancing the due date never hides a
     * failure. Null until the first entry.
     */
    lastResult: text('last_result').$type<FireCheckResult>(),
    /** First cycle starts from setup; recomputed on every recorded entry. */
    nextDueAt: timestamp('next_due_at', { withTimezone: true, mode: 'date' }).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('fire_checks_building_type_uq').on(table.buildingId, table.checkType),
    index('fire_checks_tenant_due_idx').on(table.tenantId, table.nextDueAt),
    index('fire_logbook_checks_tenant_asset_idx').on(table.tenantId, table.assetId),
  ],
);

export type FireLogbookCheck = typeof fireLogbookChecks.$inferSelect;
export type NewFireLogbookCheck = typeof fireLogbookChecks.$inferInsert;

export const FIRE_CHECK_RESULTS = ['pass', 'defects_found', 'fail'] as const;
export type FireCheckResult = (typeof FIRE_CHECK_RESULTS)[number];

/**
 * The fire safety logbook — append-only evidence of every performed
 * check. The router exposes no update or delete.
 */
export const fireLogbookEntries = pgTable(
  'fire_logbook_entries',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    buildingId: varchar('building_id', { length: 26 })
      .notNull()
      .references(() => fireBuildings.id, { onDelete: 'cascade' }),
    /** The schedule satisfied, when one exists for this type. */
    checkId: varchar('check_id', { length: 26 }).references(() => fireLogbookChecks.id, {
      onDelete: 'set null',
    }),

    checkType: text('check_type').notNull().$type<FireCheckType>(),
    performedAt: timestamp('performed_at', { withTimezone: true, mode: 'date' }).notNull(),
    performedBy: text('performed_by').notNull(),
    result: text('result').notNull().$type<FireCheckResult>(),

    /** Weekly alarm tests rotate call points — which one was used. */
    callPointRef: text('call_point_ref').notNull().default(''),
    notes: text('notes').notNull().default(''),
    defectsSummary: text('defects_summary').notNull().default(''),
    /** Set when the failed check raised an action — once only. */
    actionId: varchar('action_id', { length: 26 }),

    /**
     * Offline-queue idempotency key (PF-10): a retried submission with the
     * same key is a no-op, enforced by a partial unique index.
     */
    clientRequestId: varchar('client_request_id', { length: 26 }),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('fire_entries_building_time_idx').on(table.buildingId, table.performedAt),
    index('fire_entries_tenant_time_idx').on(table.tenantId, table.performedAt),
    uniqueIndex('fire_logbook_entries_client_req_idx')
      .on(table.tenantId, table.clientRequestId)
      .where(sql`${table.clientRequestId} IS NOT NULL`),
  ],
);

export type FireLogbookEntry = typeof fireLogbookEntries.$inferSelect;
export type NewFireLogbookEntry = typeof fireLogbookEntries.$inferInsert;

export const FIRE_DOOR_STATUSES = ['active', 'archived'] as const;
export type FireDoorStatus = (typeof FIRE_DOOR_STATUSES)[number];

export const fireDoors = pgTable(
  'fire_doors',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    buildingId: varchar('building_id', { length: 26 })
      .notNull()
      .references(() => fireBuildings.id, { onDelete: 'cascade' }),

    /** The practitioner's label, e.g. "FD-2-07 stairwell east". */
    doorRef: text('door_ref').notNull(),
    locationKind: text('location_kind').notNull().default('other').$type<FireDoorLocationKind>(),
    floor: text('floor').notNull().default(''),
    description: text('description').notNull().default(''),
    /** FD rating, minutes (30, 60, …); null = unknown. */
    ratingMinutes: integer('rating_minutes'),
    selfClosing: boolean('self_closing').notNull().default(true),

    /** Overrides the regime-derived cadence when set. */
    inspectionIntervalMonthsOverride: integer('inspection_interval_months_override'),

    lastInspectedAt: timestamp('last_inspected_at', { withTimezone: true, mode: 'date' }),
    /** Newest inspection outcome — 'fail' holds the door red (FS-1). */
    lastOutcome: text('last_outcome').$type<FireDoorOutcome>(),
    nextInspectionDueAt: timestamp('next_inspection_due_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),

    status: text('status').notNull().default('active').$type<FireDoorStatus>(),
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
    index('fire_doors_building_status_idx').on(table.buildingId, table.status),
    index('fire_doors_tenant_due_idx').on(table.tenantId, table.nextInspectionDueAt),
  ],
);

export type FireDoor = typeof fireDoors.$inferSelect;
export type NewFireDoor = typeof fireDoors.$inferInsert;

export const FIRE_DOOR_OUTCOMES = ['pass', 'defects_found', 'fail'] as const;
export type FireDoorOutcome = (typeof FIRE_DOOR_OUTCOMES)[number];

export const fireDoorInspections = pgTable(
  'fire_door_inspections',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    doorId: varchar('door_id', { length: 26 })
      .notNull()
      .references(() => fireDoors.id, { onDelete: 'cascade' }),

    inspectedAt: timestamp('inspected_at', { withTimezone: true, mode: 'date' }).notNull(),
    inspectedBy: text('inspected_by').notNull(),
    outcome: text('outcome').notNull().$type<FireDoorOutcome>(),
    /** Five-point check snapshot; null members = not looked at. */
    checklist: jsonb('checklist').$type<DoorChecklist>(),
    defectsSummary: text('defects_summary').notNull().default(''),
    /** Set when the defective inspection raised an action — once only. */
    actionId: varchar('action_id', { length: 26 }),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index('fire_door_inspections_door_idx').on(table.doorId, table.inspectedAt)],
);

export type FireDoorInspection = typeof fireDoorInspections.$inferSelect;
export type NewFireDoorInspection = typeof fireDoorInspections.$inferInsert;

export const fireDrills = pgTable(
  'fire_drills',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    buildingId: varchar('building_id', { length: 26 })
      .notNull()
      .references(() => fireBuildings.id, { onDelete: 'cascade' }),

    conductedAt: timestamp('conducted_at', { withTimezone: true, mode: 'date' }).notNull(),
    conductedBy: text('conducted_by').notNull(),

    /** Alarm-to-clear time; null when not measured. */
    evacuationSeconds: integer('evacuation_seconds'),
    peoplePresent: integer('people_present'),
    peopleAccountedFor: integer('people_accounted_for'),
    /** The muster-point roll call closed with everyone accounted for. */
    rollComplete: boolean('roll_complete').notNull().default(false),

    notes: text('notes').notNull().default(''),
    lessonsLearned: text('lessons_learned').notNull().default(''),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index('fire_drills_building_time_idx').on(table.buildingId, table.conductedAt)],
);

export type FireDrill = typeof fireDrills.$inferSelect;
export type NewFireDrill = typeof fireDrills.$inferInsert;

/**
 * Personal emergency evacuation plans. Rows are ended (not deleted) so
 * the record of who had a plan, and when, survives.
 */
export const firePeeps = pgTable(
  'fire_peeps',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    buildingId: varchar('building_id', { length: 26 }).references(() => fireBuildings.id, {
      onDelete: 'set null',
    }),

    /** Staff member when the person has an account; visitors won't. */
    userId: text('user_id'),
    personName: text('person_name').notNull(),

    assistanceNeeds: text('assistance_needs').notNull().default(''),
    planSummary: text('plan_summary').notNull().default(''),
    buddyName: text('buddy_name').notNull().default(''),
    equipmentNeeded: text('equipment_needed').notNull().default(''),

    reviewFrequencyMonths: integer('review_frequency_months').notNull().default(12),
    nextReviewAt: timestamp('next_review_at', { withTimezone: true, mode: 'date' }).notNull(),
    lastReviewedAt: timestamp('last_reviewed_at', { withTimezone: true, mode: 'date' }),
    /** Set when the plan is no longer needed; the row is never deleted. */
    endedAt: timestamp('ended_at', { withTimezone: true, mode: 'date' }),

    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('fire_peeps_tenant_review_idx').on(table.tenantId, table.nextReviewAt),
    index('fire_peeps_building_idx').on(table.buildingId),
  ],
);

export type FirePeep = typeof firePeeps.$inferSelect;
export type NewFirePeep = typeof firePeeps.$inferInsert;

export const FIRE_MARSHAL_ROLES = ['marshal', 'deputy'] as const;
export type FireMarshalRole = (typeof FIRE_MARSHAL_ROLES)[number];

export const fireMarshals = pgTable(
  'fire_marshals',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    buildingId: varchar('building_id', { length: 26 })
      .notNull()
      .references(() => fireBuildings.id, { onDelete: 'cascade' }),

    userId: text('user_id').notNull(),
    role: text('role').notNull().default('marshal').$type<FireMarshalRole>(),
    /** Floor / zone the marshal sweeps. */
    area: text('area').notNull().default(''),

    trainedAt: timestamp('trained_at', { withTimezone: true, mode: 'date' }),
    trainingExpiresAt: timestamp('training_expires_at', { withTimezone: true, mode: 'date' }),

    notes: text('notes').notNull().default(''),
    /** Set when the person stands down; the row is never deleted. */
    endedAt: timestamp('ended_at', { withTimezone: true, mode: 'date' }),

    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('fire_marshals_building_idx').on(table.buildingId),
    index('fire_marshals_tenant_expiry_idx').on(table.tenantId, table.trainingExpiresAt),
  ],
);

export type FireMarshal = typeof fireMarshals.$inferSelect;
export type NewFireMarshal = typeof fireMarshals.$inferInsert;

export const FIRE_EVENT_ENTITY_TYPES = [
  'building',
  'fra',
  'door',
  'drill',
  'peep',
  'marshal',
  'logbook_check',
] as const;
export type FireEventEntityType = (typeof FIRE_EVENT_ENTITY_TYPES)[number];

export const FIRE_EVENT_KINDS = [
  'created',
  'updated',
  'archived',
  'checks_seeded',
  'check_updated',
  'check_recorded',
  'published',
  'moved_to_draft',
  'finding_added',
  'finding_updated',
  'finding_removed',
  'finding_resolved',
  'review_recorded',
  'inspection_recorded',
  'drill_recorded',
  'peep_review_recorded',
  'peep_ended',
  'marshal_added',
  'marshal_ended',
  'doors_bulk_added',
  'reattested',
] as const;
export type FireEventKind = (typeof FIRE_EVENT_KINDS)[number];

/**
 * Append-only change log across the module's entities. The router writes
 * one row per meaningful mutation and exposes no way to alter or remove
 * rows — the log is evidence, not state.
 */
export const fireEvents = pgTable(
  'fire_events',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    entityType: text('entity_type').notNull().$type<FireEventEntityType>(),
    entityId: varchar('entity_id', { length: 26 }).notNull(),
    actorUserId: text('actor_user_id').notNull(),
    kind: text('kind').notNull().$type<FireEventKind>(),
    detail: text('detail').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('fire_events_entity_idx').on(
      table.tenantId,
      table.entityType,
      table.entityId,
      table.createdAt,
    ),
  ],
);

export type FireEvent = typeof fireEvents.$inferSelect;
