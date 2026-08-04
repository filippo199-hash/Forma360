/**
 * RAMS — Risk Assessment & Method Statement (FreeHS module B6). ADR 0015.
 *
 * Three objects, deliberately separate (spec §4.1):
 *   - `method_statements` (+ `_versions`) — the reusable *how*. A
 *     sequence of steps, owned by the tenant, versioned on publish.
 *     Exists independently of any job, which is what makes the library
 *     work: one method statement is issued as five different packs
 *     across five jobs without copy-paste.
 *   - `rams_packs` (+ `_versions`) — the issuable artefact for a
 *     specific job: one method-statement version + N risk-assessment
 *     versions + N COSHH assessments + documents + job context. Issue
 *     freezes everything into `rams_pack_versions.content` (ADR 0007's
 *     snapshot model, exactly as inspections pin a template version), so
 *     a later RA revision never silently changes an issued pack.
 *   - `rams_briefings` — append-only proof that a named person was
 *     briefed on a specific pack VERSION. Re-issue does not delete them;
 *     they simply cease to be current, which is what answers "who had
 *     been briefed on the version in force on the day".
 *
 * Plus the client-issue links, the third-party review workflow over
 * `contractor_documents`, and the append-only event log.
 *
 * Immutability contract, mirroring `risk_assessment_versions` and
 * `template_versions`: a published `method_statement_versions.content`
 * and an issued `rams_pack_versions.content` are NEVER UPDATEd. Editing
 * a published method statement writes a new draft version; re-issuing a
 * pack writes version n+1.
 */
import {
  boolean,
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
  BriefeeCategory,
  BriefeeKind,
  ClientDecision,
  MethodStatementContent,
  MethodStatementStatus,
  MethodStatementTrade,
  RamsPackStatus,
  RamsReviewOutcome,
  ReviewChecklistEntry,
} from '@forma360/shared/rams';
import { contractorDocuments, contractors } from './contractors';
import { documents } from './documents';
import { riskAssessmentVersions, riskAssessments } from './risk-assessments';
import { coshhAssessments, coshhSubstances } from './coshh';
import { sites } from './sites';
import { tenants } from './tenants';

// ─── Method statements ──────────────────────────────────────────────────────

export const methodStatements = pgTable(
  'method_statements',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    /** Human-friendly reference ("MS-000001"), stamped in the create tx. */
    referenceNumber: text('reference_number'),

    title: text('title').notNull(),
    trade: text('trade').notNull().default('other').$type<MethodStatementTrade>(),
    status: text('status').notNull().default('draft').$type<MethodStatementStatus>(),

    /**
     * Library entry. Any method statement can be saved as a template;
     * starting a new one offers the library first (spec §5). Seeded
     * starters are templates owned by the tenant, fully editable.
     */
    isTemplate: boolean('is_template').notNull().default(false),
    /** True for the rows created by the starter-library seeding. */
    isSeeded: boolean('is_seeded').notNull().default(false),

    ownerUserId: text('owner_user_id'),

    /**
     * The working draft content. Published content lives immutably in
     * `method_statement_versions`; this is what the builder edits.
     */
    draftContent: jsonb('draft_content').notNull().$type<MethodStatementContent>(),

    /** Version counter — 0 until first publish. */
    currentVersion: integer('current_version').notNull().default(0),
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
    index('method_statements_tenant_status_idx').on(table.tenantId, table.status),
    index('method_statements_tenant_template_idx').on(table.tenantId, table.isTemplate),
  ],
);

export type MethodStatement = typeof methodStatements.$inferSelect;
export type NewMethodStatement = typeof methodStatements.$inferInsert;

/**
 * Immutable published versions. `content` is never UPDATEd after insert —
 * a pack that pinned version 3 always renders version 3.
 */
export const methodStatementVersions = pgTable(
  'method_statement_versions',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    methodStatementId: varchar('method_statement_id', { length: 26 })
      .notNull()
      .references(() => methodStatements.id, { onDelete: 'cascade' }),

    versionNumber: integer('version_number').notNull(),
    content: jsonb('content').notNull().$type<MethodStatementContent>(),

    publishedBy: text('published_by').notNull(),
    /** Name snapshot so the printed record survives user renames. */
    publishedByName: text('published_by_name'),
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('ms_versions_statement_version_idx').on(
      table.methodStatementId,
      table.versionNumber,
    ),
    index('ms_versions_tenant_idx').on(table.tenantId),
  ],
);

export type MethodStatementVersion = typeof methodStatementVersions.$inferSelect;

// ─── RAMS packs ─────────────────────────────────────────────────────────────

export const ramsPacks = pgTable(
  'rams_packs',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    /** Human-friendly reference ("RAMS-000001"), stamped in the create tx. */
    referenceNumber: text('reference_number'),

    title: text('title').notNull(),
    status: text('status').notNull().default('draft').$type<RamsPackStatus>(),

    /** Job context. */
    clientName: text('client_name').notNull().default(''),
    siteId: varchar('site_id', { length: 26 }).references(() => sites.id, { onDelete: 'set null' }),
    locationText: text('location_text').notNull().default(''),
    plannedFrom: timestamp('planned_from', { withTimezone: true, mode: 'date' }),
    plannedTo: timestamp('planned_to', { withTimezone: true, mode: 'date' }),

    /** The author who signs the attestation, and the supervisor in charge. */
    authorUserId: text('author_user_id'),
    supervisorUserId: text('supervisor_user_id'),
    supervisorName: text('supervisor_name').notNull().default(''),

    /**
     * The method statement this pack draws from. The *version* is pinned
     * per pack version at issue; this is the working link the builder
     * edits against.
     */
    methodStatementId: varchar('method_statement_id', { length: 26 }).references(
      () => methodStatements.id,
      { onDelete: 'set null' },
    ),
    /**
     * The pack's own working copy of the method-statement content. A pack
     * tailors steps for the job without touching the library entry
     * (RS-E18) — "duplicate and tailor" is the default motion.
     */
    draftContent: jsonb('draft_content').notNull().$type<MethodStatementContent>(),

    currentVersion: integer('current_version').notNull().default(0),
    issuedAt: timestamp('issued_at', { withTimezone: true, mode: 'date' }),

    /** Reason required on withdraw / cancel — visible to everyone briefed. */
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true, mode: 'date' }),
    withdrawnBy: text('withdrawn_by'),
    withdrawnReason: text('withdrawn_reason').notNull().default(''),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'date' }),
    cancelledReason: text('cancelled_reason').notNull().default(''),

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
    index('rams_packs_tenant_status_idx').on(table.tenantId, table.status),
    index('rams_packs_tenant_site_idx').on(table.tenantId, table.siteId),
    index('rams_packs_tenant_planned_idx').on(table.tenantId, table.plannedFrom),
  ],
);

export type RamsPack = typeof ramsPacks.$inferSelect;
export type NewRamsPack = typeof ramsPacks.$inferInsert;

/** One bound risk assessment, as frozen into a pack version. */
export interface PackVersionRiskAssessment {
  raVersionId: string;
  assessmentId: string;
  referenceNumber: string | null;
  title: string;
  versionNumber: number;
  /** Worst residual band across the version's hazards, for the summary row. */
  worstResidualBand: string;
  hazardCount: number;
}

/** One bound COSHH assessment, as frozen into a pack version. */
export interface PackVersionCoshh {
  assessmentId: string;
  substanceId: string;
  substanceName: string;
  referenceNumber: string | null;
  taskDescription: string;
  /** SDS reference travels into the pack (spec §6 step 4). */
  sdsReference: string;
}

/** One supporting document, as frozen into a pack version. */
export interface PackVersionDocument {
  id: string;
  kind: string;
  title: string;
  /** Set when the document lives in the Documents module. */
  documentId: string | null;
  /** Set when the file was uploaded directly to the pack. */
  storageKey: string | null;
  filename: string;
}

/** Job context frozen alongside the content. */
export interface PackVersionJobContext {
  title: string;
  clientName: string;
  siteId: string | null;
  siteName: string | null;
  locationText: string;
  plannedFrom: string | null;
  plannedTo: string | null;
  authorName: string;
  supervisorName: string;
}

/**
 * The full snapshot frozen at issue — everything needed to reproduce
 * "the pack as issued on {date}" without touching a mutable row.
 */
export interface RamsPackVersionContent {
  jobContext: PackVersionJobContext;
  /** The method-statement version pinned at issue. */
  methodStatementId: string | null;
  methodStatementVersionId: string | null;
  methodStatementVersionNumber: number | null;
  methodStatementTitle: string;
  /** The step content as issued — tailored per pack. */
  content: MethodStatementContent;
  riskAssessments: PackVersionRiskAssessment[];
  coshh: PackVersionCoshh[];
  documents: PackVersionDocument[];
}

export const ramsPackVersions = pgTable(
  'rams_pack_versions',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    packId: varchar('pack_id', { length: 26 })
      .notNull()
      .references(() => ramsPacks.id, { onDelete: 'cascade' }),

    versionNumber: integer('version_number').notNull(),
    content: jsonb('content').notNull().$type<RamsPackVersionContent>(),

    /** The author who actively confirmed the attestation (spec §6). */
    issuedBy: text('issued_by').notNull(),
    issuedByName: text('issued_by_name'),
    issuedAt: timestamp('issued_at', { withTimezone: true, mode: 'date' }).notNull(),
    /** The exact attestation text confirmed, snapshotted for the record. */
    attestationText: text('attestation_text').notNull().default(''),

    /** Set when a later issue superseded this version. */
    supersededAt: timestamp('superseded_at', { withTimezone: true, mode: 'date' }),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('rams_pack_versions_pack_version_idx').on(table.packId, table.versionNumber),
    index('rams_pack_versions_tenant_idx').on(table.tenantId),
  ],
);

export type RamsPackVersion = typeof ramsPackVersions.$inferSelect;

/**
 * Pack ↔ risk-assessment VERSION join. Queryable without opening the
 * jsonb — the RA detail page's "used in RAMS packs" list reads this
 * (spec §10.1), and it is how a draft binding is detected before issue.
 */
export const ramsPackRiskAssessments = pgTable(
  'rams_pack_risk_assessments',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    packId: varchar('pack_id', { length: 26 })
      .notNull()
      .references(() => ramsPacks.id, { onDelete: 'cascade' }),
    assessmentId: varchar('assessment_id', { length: 26 })
      .notNull()
      .references(() => riskAssessments.id, { onDelete: 'restrict' }),
    /**
     * Null while the bound assessment has never been published — the
     * issue gate refuses in that case (RS-E04) rather than silently
     * binding nothing.
     */
    raVersionId: varchar('ra_version_id', { length: 26 }).references(
      () => riskAssessmentVersions.id,
      { onDelete: 'restrict' },
    ),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('rams_pack_ra_unique_idx').on(table.packId, table.assessmentId),
    index('rams_pack_ra_assessment_idx').on(table.tenantId, table.assessmentId),
  ],
);

export type RamsPackRiskAssessment = typeof ramsPackRiskAssessments.$inferSelect;

/** Pack ↔ COSHH assessment join. */
export const ramsPackCoshh = pgTable(
  'rams_pack_coshh',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    packId: varchar('pack_id', { length: 26 })
      .notNull()
      .references(() => ramsPacks.id, { onDelete: 'cascade' }),
    coshhAssessmentId: varchar('coshh_assessment_id', { length: 26 })
      .notNull()
      .references(() => coshhAssessments.id, { onDelete: 'restrict' }),
    substanceId: varchar('substance_id', { length: 26 }).references(() => coshhSubstances.id, {
      onDelete: 'set null',
    }),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('rams_pack_coshh_unique_idx').on(table.packId, table.coshhAssessmentId),
    index('rams_pack_coshh_tenant_idx').on(table.tenantId),
  ],
);

export type RamsPackCoshh = typeof ramsPackCoshh.$inferSelect;

export const RAMS_DOCUMENT_KINDS = [
  'insurance',
  'certificate',
  'training_record',
  'equipment_certificate',
  'drawing',
  'other',
] as const;
export type RamsDocumentKind = (typeof RAMS_DOCUMENT_KINDS)[number];

/**
 * Pack ↔ supporting document. Documents-module rows are referenced, not
 * copied (spec §10.3); direct uploads carry a storage key instead.
 */
export const ramsPackDocuments = pgTable(
  'rams_pack_documents',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    packId: varchar('pack_id', { length: 26 })
      .notNull()
      .references(() => ramsPacks.id, { onDelete: 'cascade' }),

    kind: text('kind').notNull().default('other').$type<RamsDocumentKind>(),
    title: text('title').notNull().default(''),

    /** Exactly one of these is set — enforced by the router. */
    documentId: varchar('document_id', { length: 26 }).references(() => documents.id, {
      onDelete: 'cascade',
    }),
    storageKey: text('storage_key'),
    filename: text('filename').notNull().default(''),

    sortOrder: integer('sort_order').notNull().default(0),
    addedBy: text('added_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index('rams_pack_documents_pack_idx').on(table.packId)],
);

export type RamsPackDocument = typeof ramsPackDocuments.$inferSelect;

// ─── Briefings ──────────────────────────────────────────────────────────────

/**
 * "Briefed and understood", anchored to a pack VERSION — this is what
 * answers "who had been briefed on the version in force on the day".
 *
 * Append-only: the router exposes no update or delete surface (RS-E09).
 * A re-issue does not touch these rows; they simply stop matching the
 * pack's current version, which is how "briefed on a superseded version"
 * is computed.
 */
export const ramsBriefings = pgTable(
  'rams_briefings',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    packId: varchar('pack_id', { length: 26 })
      .notNull()
      .references(() => ramsPacks.id, { onDelete: 'cascade' }),
    packVersionId: varchar('pack_version_id', { length: 26 })
      .notNull()
      .references(() => ramsPackVersions.id, { onDelete: 'cascade' }),
    /** Denormalised for the "briefed on v{n}" chip without a join. */
    versionNumber: integer('version_number').notNull(),

    /** Platform user or a named non-user (a subcontractor's operative). */
    briefeeKind: text('briefee_kind').notNull().default('user').$type<BriefeeKind>(),
    briefeeUserId: text('briefee_user_id'),
    briefeeName: text('briefee_name').notNull(),
    briefeeCategory: text('briefee_category')
      .notNull()
      .default('employee')
      .$type<BriefeeCategory>(),
    /** The subcontractor's company, when the briefee is not an employee. */
    briefeeOrganisation: text('briefee_organisation').notNull().default(''),

    briefedBy: text('briefed_by').notNull(),
    briefedByName: text('briefed_by_name').notNull().default(''),
    briefedAt: timestamp('briefed_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),

    /** Base64 signature-pad data URL; optional — a tick is still a record. */
    signatureData: text('signature_data'),
    /** Anything the briefee raised, captured at the point of briefing. */
    questionsNote: text('questions_note').notNull().default(''),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('rams_briefings_tenant_version_idx').on(table.tenantId, table.packVersionId),
    index('rams_briefings_pack_idx').on(table.packId, table.briefedAt),
  ],
);

export type RamsBriefing = typeof ramsBriefings.$inferSelect;
export type NewRamsBriefing = typeof ramsBriefings.$inferInsert;

// ─── Client issue & acceptance ──────────────────────────────────────────────

/**
 * Login-free share link to a specific pack version, plus the client's
 * acceptance decision. Revocable and expiring (RS-E12).
 */
export const ramsClientLinks = pgTable(
  'rams_client_links',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    packId: varchar('pack_id', { length: 26 })
      .notNull()
      .references(() => ramsPacks.id, { onDelete: 'cascade' }),
    packVersionId: varchar('pack_version_id', { length: 26 })
      .notNull()
      .references(() => ramsPackVersions.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),

    token: text('token').notNull(),
    issuedToName: text('issued_to_name').notNull().default(''),
    issuedToEmail: text('issued_to_email'),
    issuedBy: text('issued_by').notNull(),

    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    revokedBy: text('revoked_by'),

    /** Acceptance, recorded against this exact version. */
    decision: text('decision').notNull().default('pending').$type<ClientDecision>(),
    decidedAt: timestamp('decided_at', { withTimezone: true, mode: 'date' }),
    acceptedByName: text('accepted_by_name').notNull().default(''),
    acceptedByOrganisation: text('accepted_by_organisation').notNull().default(''),
    decisionComment: text('decision_comment').notNull().default(''),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('rams_client_links_token_idx').on(table.token),
    index('rams_client_links_pack_idx').on(table.tenantId, table.packId),
  ],
);

export type RamsClientLink = typeof ramsClientLinks.$inferSelect;

// ─── Third-party review (§9 — the receive side) ─────────────────────────────

/**
 * A review over a RAMS a contractor sent US. Anchors to the
 * `contractor_documents` row the platform already stores; the review is
 * the workflow that was missing.
 *
 * An accepted, in-date review satisfies a contractor requirement and can
 * back a permit that demands a pack (RS-E13 / RS-E14).
 */
export const ramsReviews = pgTable(
  'rams_reviews',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    contractorId: varchar('contractor_id', { length: 26 })
      .notNull()
      .references(() => contractors.id, { onDelete: 'cascade' }),
    /**
     * The uploaded pack under review. Null when the pack arrived by
     * email and is being logged internally (spec §9).
     */
    contractorDocumentId: varchar('contractor_document_id', { length: 26 }).references(
      () => contractorDocuments.id,
      { onDelete: 'set null' },
    ),

    title: text('title').notNull(),
    /** Free-text description of the work the pack covers. */
    workDescription: text('work_description').notNull().default(''),
    siteId: varchar('site_id', { length: 26 }).references(() => sites.id, { onDelete: 'set null' }),

    outcome: text('outcome').notNull().default('pending').$type<RamsReviewOutcome>(),
    checklist: jsonb('checklist')
      .notNull()
      .$type<ReviewChecklistEntry[]>()
      .default(sql`'[]'::jsonb`),
    /** Required when the outcome is `accepted_with_conditions`. */
    conditions: text('conditions').notNull().default(''),
    /** Comments returned to the contractor on rejection. */
    comments: text('comments').notNull().default(''),

    validFrom: timestamp('valid_from', { withTimezone: true, mode: 'date' }),
    validTo: timestamp('valid_to', { withTimezone: true, mode: 'date' }),

    reviewerUserId: text('reviewer_user_id'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true, mode: 'date' }),

    submittedBy: text('submitted_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('rams_reviews_tenant_outcome_idx').on(table.tenantId, table.outcome, table.validTo),
    index('rams_reviews_contractor_idx').on(table.tenantId, table.contractorId),
  ],
);

export type RamsReview = typeof ramsReviews.$inferSelect;
export type NewRamsReview = typeof ramsReviews.$inferInsert;

// ─── Event log ──────────────────────────────────────────────────────────────

export const RAMS_EVENT_KINDS = [
  'pack_created',
  'pack_updated',
  'pack_issued',
  'pack_reissued',
  'pack_withdrawn',
  'pack_cancelled',
  'ra_bound',
  'ra_unbound',
  'coshh_bound',
  'coshh_unbound',
  'document_added',
  'document_removed',
  'briefing_recorded',
  'client_link_created',
  'client_link_revoked',
  'client_accepted',
  'client_changes_requested',
  'method_statement_created',
  'method_statement_published',
  'method_statement_archived',
  'method_statement_duplicated',
  'review_submitted',
  'review_decided',
] as const;
export type RamsEventKind = (typeof RAMS_EVENT_KINDS)[number];

/**
 * Append-only audit log across the whole module — every version, issue,
 * briefing, acceptance and review decision. The log is evidence, not
 * state: the router writes rows and exposes no way to alter them.
 * Workers write as `system`.
 */
export const ramsEvents = pgTable(
  'rams_events',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    /** One of these anchors the event; both may be null for a review event. */
    packId: varchar('pack_id', { length: 26 }).references(() => ramsPacks.id, {
      onDelete: 'cascade',
    }),
    methodStatementId: varchar('method_statement_id', { length: 26 }).references(
      () => methodStatements.id,
      { onDelete: 'cascade' },
    ),
    reviewId: varchar('review_id', { length: 26 }).references(() => ramsReviews.id, {
      onDelete: 'cascade',
    }),

    actorUserId: text('actor_user_id').notNull(),
    kind: text('kind').notNull().$type<RamsEventKind>(),
    detail: text('detail').notNull().default(''),
    /** Structured payload rendered by the timeline UI. */
    payload: jsonb('payload')
      .notNull()
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('rams_events_tenant_pack_idx').on(table.tenantId, table.packId, table.createdAt),
    index('rams_events_ms_idx').on(table.methodStatementId, table.createdAt),
  ],
);

export type RamsEvent = typeof ramsEvents.$inferSelect;
