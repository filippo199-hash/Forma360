/**
 * Incident & Accident Management (FreeHS module B5).
 *
 * Record any workplace safety event involving people, run a proportionate
 * investigation to a defensible conclusion, discharge the statutory
 * reporting duty (RIDDOR), drive corrective actions through the existing
 * engine, and prove afterwards that they worked.
 *
 * Model:
 *   - `incidents` — the header row. Strict lifecycle reported → triaged →
 *     investigating → actions_outstanding → closed (⇢ reopened), any
 *     pre-closed state → cancelled (see `canTransition` in
 *     `@forma360/shared/incidents`). Kind-specific detail lives in one
 *     `details` jsonb column validated by the per-kind Zod schema. The
 *     RIDDOR determination, deadline clock, submission record and the
 *     effectiveness-review outcome all live here so the register can
 *     answer an auditor without joins.
 *   - `incident_persons` + `incident_absences` — zero or more affected
 *     persons (platform users or named non-users) with per-person injury
 *     blocks and the lost-time record the over-7-day screening reads.
 *   - `incident_investigations` — one row per **revision**. Approved
 *     revisions are frozen; reopening creates revision n+1 pre-filled
 *     from n. Signatures (submit / approve) are separated duties.
 *   - `incident_findings` — investigation children; `requires_action`
 *     findings generate one action exactly once (`action_id` stamp +
 *     the actions table's source unique index).
 *   - `incident_evidence` + `incident_witness_statements` — append-only.
 *     Corrections are new rows; nothing is edited or deleted.
 *   - `incident_events` — the append-only audit log (the `permit_events`
 *     pattern): every lifecycle move, screening change, signature and
 *     notification; workers write as actor `system`.
 *
 * Worker stamps (`alert_sent_at`, `riddor_warning*`, `riddor_escalated_at`)
 * dedupe the notification workers; the RIDDOR watch notifies **then**
 * stamps, so a crashed send re-fires rather than going silent.
 */
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type {
  CausalFactorCategory,
  CausalFactors,
  EffectivenessVerdict,
  EvidenceKind,
  FindingPriority,
  IncidentKind,
  IncidentSeverity,
  IncidentStatus,
  InvestigationLevel,
  InvestigationStatus,
  PersonCategory,
  PersonInjury,
  RcaMethod,
  RecurrenceLikelihood,
  RiddorCategory,
  RiddorSubmissionRoute,
  TimelineEntries,
  WhyChain,
} from '@forma360/shared/incidents';
import { assets } from './assets';
import { contractors } from './contractors';
import { issues } from './issues';
import { permits } from './permits';
import { sites } from './sites';
import { tenants } from './tenants';

export const incidents = pgTable(
  'incidents',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    /** `IN-` + 6-digit pad; grows past IN-999999 without truncation. */
    referenceNumber: text('reference_number').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),

    kind: text('kind').notNull().$type<IncidentKind>(),
    severity: text('severity').notNull().$type<IncidentSeverity>().default('minor'),
    /** "It was nearly much worse" — optional, same scale. */
    potentialSeverity: text('potential_severity').$type<IncidentSeverity>(),
    status: text('status').notNull().$type<IncidentStatus>().default('reported'),

    /**
     * Confidential records (defaulted on for sharps / V&A) are counted
     * for everyone but readable only by the reporter, the lead
     * investigator and `incidents.confidential.view` holders.
     */
    confidential: boolean('confidential').notNull().default(false),

    /** Both stored: a gap > 24 h between them is chip-flagged (late report). */
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
    reportedAt: timestamp('reported_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    reportedByUserId: text('reported_by_user_id').notNull(),

    siteId: varchar('site_id', { length: 26 }).references(() => sites.id, {
      onDelete: 'set null',
    }),
    locationText: text('location_text').notNull().default(''),

    /** Per-kind block, validated by `parseIncidentDetails` at every boundary. */
    details: jsonb('details')
      .notNull()
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`),

    // ── Linked records (§8.4) ────────────────────────────────────────────
    observationId: varchar('observation_id', { length: 26 }).references(() => issues.id, {
      onDelete: 'set null',
    }),
    permitId: varchar('permit_id', { length: 26 }).references(() => permits.id, {
      onDelete: 'set null',
    }),
    contractorId: varchar('contractor_id', { length: 26 }).references(() => contractors.id, {
      onDelete: 'set null',
    }),
    assetId: varchar('asset_id', { length: 26 }).references(() => assets.id, {
      onDelete: 'set null',
    }),

    // ── Triage ───────────────────────────────────────────────────────────
    investigationLevel: text('investigation_level').$type<InvestigationLevel>(),
    leadInvestigatorUserId: text('lead_investigator_user_id'),

    // ── RIDDOR duty (§6) ─────────────────────────────────────────────────
    /** Null until screened. `not_reportable` is itself a defensible record. */
    riddorCategory: text('riddor_category').$type<RiddorCategory>(),
    riddorDeterminationNote: text('riddor_determination_note').notNull().default(''),
    riddorScreenedByUserId: text('riddor_screened_by_user_id'),
    riddorScreenedAt: timestamp('riddor_screened_at', { withTimezone: true, mode: 'date' }),
    riddorDeadlineAt: timestamp('riddor_deadline_at', { withTimezone: true, mode: 'date' }),
    /** Set when accumulating absence contradicts a not-reportable screening. */
    riddorRescreenRequired: boolean('riddor_rescreen_required').notNull().default(false),
    riddorSubmittedAt: timestamp('riddor_submitted_at', { withTimezone: true, mode: 'date' }),
    riddorSubmittedByUserId: text('riddor_submitted_by_user_id'),
    riddorSubmissionRoute: text('riddor_submission_route').$type<RiddorSubmissionRoute>(),
    riddorHseReference: text('riddor_hse_reference'),

    // ── Closure + effectiveness (§5.6) ───────────────────────────────────
    closedAt: timestamp('closed_at', { withTimezone: true, mode: 'date' }),
    closedByUserId: text('closed_by_user_id'),
    effectivenessDueAt: timestamp('effectiveness_due_at', { withTimezone: true, mode: 'date' }),
    effectivenessVerdict: text('effectiveness_verdict').$type<EffectivenessVerdict>(),
    effectivenessNote: text('effectiveness_note').notNull().default(''),
    effectivenessRecordedAt: timestamp('effectiveness_recorded_at', {
      withTimezone: true,
      mode: 'date',
    }),
    effectivenessRecordedByUserId: text('effectiveness_recorded_by_user_id'),

    // ── Post-incident review prompts (§8.2) ──────────────────────────────
    reviewPromptAt: timestamp('review_prompt_at', { withTimezone: true, mode: 'date' }),
    reviewPromptSkippedReason: text('review_prompt_skipped_reason'),

    // ── Worker dedup stamps ──────────────────────────────────────────────
    alertSentAt: timestamp('alert_sent_at', { withTimezone: true, mode: 'date' }),
    riddorWarning5SentAt: timestamp('riddor_warning5_sent_at', {
      withTimezone: true,
      mode: 'date',
    }),
    riddorWarning2SentAt: timestamp('riddor_warning2_sent_at', {
      withTimezone: true,
      mode: 'date',
    }),
    riddorEscalatedAt: timestamp('riddor_escalated_at', { withTimezone: true, mode: 'date' }),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('incidents_tenant_status_idx').on(table.tenantId, table.status),
    index('incidents_tenant_occurred_idx').on(table.tenantId, table.occurredAt),
    index('incidents_tenant_riddor_deadline_idx').on(table.tenantId, table.riddorDeadlineAt),
    index('incidents_site_idx').on(table.siteId),
    index('incidents_tenant_observation_idx').on(table.tenantId, table.observationId),
  ],
);

export type Incident = typeof incidents.$inferSelect;
export type NewIncident = typeof incidents.$inferInsert;

export const incidentPersons = pgTable(
  'incident_persons',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    incidentId: varchar('incident_id', { length: 26 })
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),

    /** Platform user when known; contractors' operatives, visitors and the public are name-only. */
    userId: text('user_id'),
    name: text('name').notNull(),
    category: text('category').notNull().$type<PersonCategory>(),

    /** Per-person injury block (`personInjurySchema`). */
    injury: jsonb('injury')
      .notNull()
      .$type<PersonInjury>()
      .default(sql`'{}'::jsonb`),
    /** Occupational-health follow-up flagged (sharps default-on lives in details). */
    ohFollowUpRequired: boolean('oh_follow_up_required').notNull().default(false),

    // Lost-time record flags (periods live in incident_absences).
    returnedToWork: boolean('returned_to_work').notNull().default(false),
    onRestrictedDuties: boolean('on_restricted_duties').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index('incident_persons_incident_idx').on(table.tenantId, table.incidentId)],
);

export type IncidentPerson = typeof incidentPersons.$inferSelect;
export type NewIncidentPerson = typeof incidentPersons.$inferInsert;

export const incidentAbsences = pgTable(
  'incident_absences',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    incidentId: varchar('incident_id', { length: 26 })
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),
    personId: varchar('person_id', { length: 26 })
      .notNull()
      .references(() => incidentPersons.id, { onDelete: 'cascade' }),

    /** Calendar days, `YYYY-MM-DD`. Open period (`to_date` null) = still absent. */
    fromDate: date('from_date', { mode: 'string' }).notNull(),
    toDate: date('to_date', { mode: 'string' }),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index('incident_absences_incident_idx').on(table.tenantId, table.incidentId)],
);

export type IncidentAbsence = typeof incidentAbsences.$inferSelect;
export type NewIncidentAbsence = typeof incidentAbsences.$inferInsert;

export const incidentInvestigations = pgTable(
  'incident_investigations',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    incidentId: varchar('incident_id', { length: 26 })
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),

    /** 1-based; reopening creates revision n+1, prior revisions stay frozen. */
    revision: integer('revision').notNull(),

    /**
     * The visibility circle: user ids named when the investigation was
     * started (or edited later by the lead/an admin). `null` means
     * unrestricted — every incidents.view holder with detail access sees
     * it, which is the pre-existing behaviour and the default. When set,
     * only these users, the incident's lead investigator and admins can
     * read the investigation (counted-not-readable for everyone else,
     * the module's confidentiality doctrine). Deliberately NOT bypassed
     * by `incidents.confidential.view` — the default Manager set holds
     * that key, and a named list must bind managers too (PR #84).
     * Copied forward on reopen; the LATEST revision's circle governs
     * the whole thread.
     */
    participantUserIds: jsonb('participant_user_ids').$type<ReadonlyArray<string>>(),

    method: text('method').$type<RcaMethod>(),
    immediateCause: text('immediate_cause').notNull().default(''),
    underlyingCause: text('underlying_cause').notNull().default(''),
    /** Basic-level contributing-factor checklist (causal-factor categories). */
    contributingFactors: jsonb('contributing_factors')
      .notNull()
      .$type<ReadonlyArray<CausalFactorCategory>>()
      .default(sql`'[]'::jsonb`),
    whyChain: jsonb('why_chain').$type<WhyChain>(),
    causalFactors: jsonb('causal_factors').$type<CausalFactors>(),
    timelineEntries: jsonb('timeline_entries')
      .notNull()
      .$type<TimelineEntries>()
      .default(sql`'[]'::jsonb`),

    // Conclusion block (§5.5).
    conclusionSummary: text('conclusion_summary').notNull().default(''),
    rootCauseStatement: text('root_cause_statement').notNull().default(''),
    recurrenceLikelihood: text('recurrence_likelihood').$type<RecurrenceLikelihood>(),
    lessonsLearned: text('lessons_learned').notNull().default(''),

    /** draft → submitted (lead investigator) → approved (separated duties). */
    status: text('status').notNull().$type<InvestigationStatus>().default('draft'),
    submittedByUserId: text('submitted_by_user_id'),
    submittedAt: timestamp('submitted_at', { withTimezone: true, mode: 'date' }),
    approvedByUserId: text('approved_by_user_id'),
    approvedAt: timestamp('approved_at', { withTimezone: true, mode: 'date' }),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('incident_investigations_incident_idx').on(table.tenantId, table.incidentId),
    uniqueIndex('incident_investigations_revision_unique').on(table.incidentId, table.revision),
  ],
);

export type IncidentInvestigation = typeof incidentInvestigations.$inferSelect;
export type NewIncidentInvestigation = typeof incidentInvestigations.$inferInsert;

export const incidentFindings = pgTable(
  'incident_findings',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    incidentId: varchar('incident_id', { length: 26 })
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),
    investigationId: varchar('investigation_id', { length: 26 })
      .notNull()
      .references(() => incidentInvestigations.id, { onDelete: 'cascade' }),

    category: text('category').notNull().$type<CausalFactorCategory>(),
    priority: text('priority').notNull().$type<FindingPriority>().default('medium'),
    description: text('description').notNull(),
    requiresAction: boolean('requires_action').notNull().default(true),

    /**
     * Once-only stamp: set inside the approval tx that inserts the
     * action (`sourceType 'incident'`, `sourceItemId` = this row's id —
     * the actions source unique index backs the race).
     */
    actionId: varchar('action_id', { length: 26 }),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('incident_findings_investigation_idx').on(table.tenantId, table.investigationId),
  ],
);

export type IncidentFinding = typeof incidentFindings.$inferSelect;
export type NewIncidentFinding = typeof incidentFindings.$inferInsert;

export const incidentEvidence = pgTable(
  'incident_evidence',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    incidentId: varchar('incident_id', { length: 26 })
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),

    kind: text('kind').notNull().$type<EvidenceKind>(),
    /** Null for reference-only items (CCTV location, physical evidence). */
    storageKey: text('storage_key'),
    filename: text('filename'),
    caption: text('caption').notNull().default(''),

    collectedByUserId: text('collected_by_user_id').notNull(),
    collectedAt: timestamp('collected_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index('incident_evidence_incident_idx').on(table.tenantId, table.incidentId)],
);

export type IncidentEvidence = typeof incidentEvidence.$inferSelect;
export type NewIncidentEvidence = typeof incidentEvidence.$inferInsert;

export const incidentWitnessStatements = pgTable(
  'incident_witness_statements',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    incidentId: varchar('incident_id', { length: 26 })
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),

    witnessUserId: text('witness_user_id'),
    witnessName: text('witness_name').notNull(),
    statement: text('statement').notNull(),

    takenByUserId: text('taken_by_user_id').notNull(),
    takenAt: timestamp('taken_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    /** Optional signature-pad capture (base64 PNG data URL). */
    signatureData: text('signature_data'),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('incident_witness_statements_incident_idx').on(table.tenantId, table.incidentId),
  ],
);

export type IncidentWitnessStatement = typeof incidentWitnessStatements.$inferSelect;
export type NewIncidentWitnessStatement = typeof incidentWitnessStatements.$inferInsert;

export const INCIDENT_EVENT_KINDS = [
  'reported',
  'updated',
  'triaged',
  'severity_changed',
  'investigator_assigned',
  'riddor_screened',
  'riddor_rescreen_flagged',
  'riddor_submitted',
  'person_added',
  'person_updated',
  'person_removed',
  'absence_added',
  'absence_updated',
  'absence_removed',
  'evidence_added',
  'witness_statement_added',
  'investigation_started',
  'investigation_participants_changed',
  'investigation_submitted',
  'investigation_rejected',
  'investigation_approved',
  'investigation_level_changed',
  'actions_generated',
  'reviews_prompted',
  'reviews_prompt_skipped',
  'closed',
  'reopened',
  'cancelled',
  'effectiveness_recorded',
  'alert_sent',
  'riddor_warning_sent',
  'riddor_escalated',
  'promoted_from_observation',
] as const;
export type IncidentEventKind = (typeof INCIDENT_EVENT_KINDS)[number];

export const incidentEvents = pgTable(
  'incident_events',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    incidentId: varchar('incident_id', { length: 26 })
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),

    /** `system` for worker-written rows. */
    actorUserId: text('actor_user_id').notNull(),
    kind: text('kind').notNull().$type<IncidentEventKind>(),
    detail: jsonb('detail')
      .notNull()
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('incident_events_incident_idx').on(table.tenantId, table.incidentId, table.createdAt),
  ],
);

export type IncidentEvent = typeof incidentEvents.$inferSelect;
export type NewIncidentEvent = typeof incidentEvents.$inferInsert;
