/**
 * Contractors module (Phase 1: directory + compliance documents).
 *
 * A `contractor` is an external organisation the tenant works with. Its
 * compliance is judged **company-wide**: it is compliant only when every
 * *blocking* requirement has a `verified` document that has not expired
 * (derived, never stored). Later phases add external users, visits/gate,
 * and the asset/maintenance link.
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
import { assets } from './assets';
import { user } from './auth';
import { sites } from './sites';
import { tenants } from './tenants';

export const contractorStatus = ['active', 'inactive'] as const;
export type ContractorStatus = (typeof contractorStatus)[number];

/** Manual compliance-status override values (null = derive from documents). */
export const contractorComplianceOverride = ['compliant', 'non_compliant', 'suspended'] as const;
export type ContractorComplianceOverride = (typeof contractorComplianceOverride)[number];

export const contractors = pgTable(
  'contractors',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    /** Trade / category — drives requirement templates (Phase 1b). */
    category: text('category'),
    status: text('status').notNull().default('active').$type<ContractorStatus>(),
    /**
     * Manual compliance override. When null, compliance is derived from the
     * documents; when set, this wins (e.g. force `non_compliant`, or `suspended`
     * to bar a contractor regardless of paperwork). See `complianceOverride`.
     */
    complianceOverride: text('compliance_override').$type<ContractorComplianceOverride>(),
    complianceOverrideReason: text('compliance_override_reason'),
    primaryContactName: text('primary_contact_name'),
    primaryContactEmail: text('primary_contact_email'),
    notes: text('notes'),
    /** Opaque token for the public, no-login contractor upload portal. */
    uploadToken: text('upload_token'),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('contractors_tenant_idx').on(t.tenantId)],
);

export type Contractor = typeof contractors.$inferSelect;

/**
 * A required document "slot" for a contractor — e.g. "Public Liability
 * Insurance". `blocking` requirements gate compliance (and, later, the gate);
 * advisory ones only warn.
 */
export const contractorRequirements = pgTable(
  'contractor_requirements',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    contractorId: varchar('contractor_id', { length: 26 })
      .notNull()
      .references(() => contractors.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    blocking: boolean('blocking').notNull().default(true),
    /** Renewal cadence in months (null = one-off). Informational in Phase 1. */
    recurrenceMonths: integer('recurrence_months'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('contractor_requirements_contractor_idx').on(t.tenantId, t.contractorId)],
);

export type ContractorRequirement = typeof contractorRequirements.$inferSelect;

export const contractorDocumentStatus = ['pending', 'verified', 'rejected'] as const;
export type ContractorDocumentStatus = (typeof contractorDocumentStatus)[number];

/**
 * An uploaded document fulfilling a requirement. Stores the file directly
 * (like site_media) rather than going through the documents module. Only
 * `verified` + unexpired documents count toward compliance.
 */
export const contractorDocuments = pgTable(
  'contractor_documents',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    contractorId: varchar('contractor_id', { length: 26 })
      .notNull()
      .references(() => contractors.id, { onDelete: 'cascade' }),
    requirementId: varchar('requirement_id', { length: 26 })
      .notNull()
      .references(() => contractorRequirements.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull(),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull().default(0),
    startDate: date('start_date'),
    endDate: date('end_date'),
    status: text('status').notNull().default('pending').$type<ContractorDocumentStatus>(),
    rejectReason: text('reject_reason'),
    /** Stamped when the single pre-expiry reminder has been sent (dedupe). */
    reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true, mode: 'date' }),
    uploadedByUserId: varchar('uploaded_by_user_id', { length: 64 }).references(() => user.id, {
      onDelete: 'set null',
    }),
    verifiedByUserId: varchar('verified_by_user_id', { length: 64 }).references(() => user.id, {
      onDelete: 'set null',
    }),
    verifiedAt: timestamp('verified_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('contractor_documents_requirement_idx').on(t.tenantId, t.requirementId),
    index('contractor_documents_contractor_idx').on(t.tenantId, t.contractorId),
  ],
);

export type ContractorDocument = typeof contractorDocuments.$inferSelect;

/**
 * Requirement templates keyed by trade/category. When a contractor's category
 * matches, these are copied into `contractor_requirements` (auto on create, or
 * via "apply template"). Contractors can then add/remove per-contractor
 * overrides on top.
 */
export const contractorRequirementTemplates = pgTable(
  'contractor_requirement_templates',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    category: text('category').notNull(),
    name: text('name').notNull(),
    blocking: boolean('blocking').notNull().default(true),
    recurrenceMonths: integer('recurrence_months'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('contractor_req_templates_tenant_idx').on(t.tenantId, t.category)],
);

export type ContractorRequirementTemplate = typeof contractorRequirementTemplates.$inferSelect;

/**
 * Contractor visits (Phase 2: visits / calendar / gate).
 *
 * A concrete visit occurrence — a planned appointment or an on-the-spot
 * walk-in — optionally tied to a site/project. The **authoriser IS the
 * approval**: a visit with `authorizedByUserId` set is approved. The gate
 * check-in flow (Phase 2b) stamps `checkedInAt` / `checkedOutAt` and records
 * how (self-scan vs staff override) in `contractor_visit_events`.
 */
export const contractorVisitStatus = [
  'scheduled',
  'checked_in',
  'checked_out',
  'cancelled',
  'no_show',
] as const;
export type ContractorVisitStatus = (typeof contractorVisitStatus)[number];

export const contractorVisits = pgTable(
  'contractor_visits',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    contractorId: varchar('contractor_id', { length: 26 })
      .notNull()
      .references(() => contractors.id, { onDelete: 'cascade' }),
    /** Optional site/project the visit is for. Kept if the site is archived. */
    siteId: varchar('site_id', { length: 26 }).references(() => sites.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    /** Who from the contractor is attending — shown on the gate on-site board. */
    visitorName: text('visitor_name'),
    status: text('status').notNull().default('scheduled').$type<ContractorVisitStatus>(),
    scheduledStart: timestamp('scheduled_start', { withTimezone: true, mode: 'date' }).notNull(),
    scheduledEnd: timestamp('scheduled_end', { withTimezone: true, mode: 'date' }),
    /** True for unplanned arrivals logged at the gate. */
    isWalkIn: boolean('is_walk_in').notNull().default(false),
    /** The user who authorised the visit — presence == approved. */
    authorizedByUserId: varchar('authorized_by_user_id', { length: 64 }).references(() => user.id, {
      onDelete: 'set null',
    }),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true, mode: 'date' }),
    checkedOutAt: timestamp('checked_out_at', { withTimezone: true, mode: 'date' }),
    /** Stamped when the >24h on-site overstay alert has been sent (dedupe). */
    overstayAlertedAt: timestamp('overstay_alerted_at', { withTimezone: true, mode: 'date' }),
    notes: text('notes'),
    createdByUserId: varchar('created_by_user_id', { length: 64 }).references(() => user.id, {
      onDelete: 'set null',
    }),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('contractor_visits_tenant_start_idx').on(t.tenantId, t.scheduledStart),
    index('contractor_visits_contractor_idx').on(t.tenantId, t.contractorId),
  ],
);

export type ContractorVisit = typeof contractorVisits.$inferSelect;

/**
 * Gate check-in (Phase 2b).
 *
 * `contractor_gate_fields` are the company-configurable questions captured at
 * the gate (e.g. "Site induction complete?", "Vehicle reg"). Answers are
 * stored per event as a `{ fieldId: value }` map. `contractor_visit_events`
 * is the append-only audit log of check-ins / check-outs, recording whether
 * the contractor self-scanned or a staff member did it (with a reason).
 * `contractor_gate_config` holds the per-tenant opaque token behind the
 * public self-scan kiosk.
 */
export const contractorGateFieldType = ['text', 'number', 'yes_no'] as const;
export type ContractorGateFieldType = (typeof contractorGateFieldType)[number];

export const contractorGateFields = pgTable(
  'contractor_gate_fields',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    label: text('label').notNull(),
    fieldType: text('field_type').notNull().default('text').$type<ContractorGateFieldType>(),
    required: boolean('required').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('contractor_gate_fields_tenant_idx').on(t.tenantId, t.sortOrder)],
);

export type ContractorGateField = typeof contractorGateFields.$inferSelect;

export const contractorVisitEventType = ['check_in', 'check_out'] as const;
export type ContractorVisitEventType = (typeof contractorVisitEventType)[number];

/** `self_scan` = contractor via the public kiosk; `staff` = a logged-in user. */
export const contractorVisitEventMethod = ['self_scan', 'staff'] as const;
export type ContractorVisitEventMethod = (typeof contractorVisitEventMethod)[number];

export const contractorVisitEvents = pgTable(
  'contractor_visit_events',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    visitId: varchar('visit_id', { length: 26 })
      .notNull()
      .references(() => contractorVisits.id, { onDelete: 'cascade' }),
    contractorId: varchar('contractor_id', { length: 26 })
      .notNull()
      .references(() => contractors.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull().$type<ContractorVisitEventType>(),
    method: text('method').notNull().$type<ContractorVisitEventMethod>(),
    /** Set when staff check someone in without an authorised/self-scan path. */
    overrideReason: text('override_reason'),
    /** Answers to the configured gate fields: { [gateFieldId]: string }. */
    capturedFields: jsonb('captured_fields').$type<Record<string, string>>(),
    actorUserId: varchar('actor_user_id', { length: 64 }).references(() => user.id, {
      onDelete: 'set null',
    }),
    at: timestamp('at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('contractor_visit_events_visit_idx').on(t.tenantId, t.visitId)],
);

export type ContractorVisitEvent = typeof contractorVisitEvents.$inferSelect;

export const contractorGateConfig = pgTable('contractor_gate_config', {
  tenantId: varchar('tenant_id', { length: 26 })
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'restrict' }),
  /** Opaque token behind the public self-scan kiosk URL. */
  gateToken: text('gate_token'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ContractorGateConfig = typeof contractorGateConfig.$inferSelect;

/**
 * Contractor ↔ asset link (Phase 3).
 *
 * Many-to-many: an asset can be serviced by several contractors, and a
 * contractor services many assets. `assetId` is `text` to match `assets.id`
 * (which is a text ULID, not a varchar(26)). Mirrors `maintenanceProgramAssets`.
 */
export const contractorAssets = pgTable(
  'contractor_assets',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    contractorId: varchar('contractor_id', { length: 26 })
      .notNull()
      .references(() => contractors.id, { onDelete: 'cascade' }),
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('contractor_assets_unique').on(t.contractorId, t.assetId),
    index('contractor_assets_asset_idx').on(t.tenantId, t.assetId),
    index('contractor_assets_contractor_idx').on(t.tenantId, t.contractorId),
  ],
);

export type ContractorAsset = typeof contractorAssets.$inferSelect;

/**
 * External contractor users (Phase 4).
 *
 * Links a logged-in `user` (created via the normal invite → accept → email-OTP
 * flow) to the contractor they represent, plus the set of portal *activities*
 * the company granted them. Their actual permissions are enforced through a
 * per-user permission set derived from these activities; this row drives the
 * portal shell (which contractor, which activity tiles) and the
 * acknowledgement-onboarding step. `userId` is `text` to match `user.id`.
 */
export const contractorUsers = pgTable(
  'contractor_users',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    contractorId: varchar('contractor_id', { length: 26 })
      .notNull()
      .references(() => contractors.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Granted portal activities (see @forma360/permissions/contractor-activities). */
    activities: jsonb('activities').$type<string[]>().notNull().default([]),
    /** Stamped when the user completes the acknowledgement-onboarding step. */
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true, mode: 'date' }),
    /**
     * Which induction version the acknowledgement covers (PF-19). Null on
     * legacy rows — treated as version 1 when `acknowledgedAt` is set.
     */
    acknowledgedVersion: integer('acknowledged_version'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('contractor_users_user_unique').on(t.userId),
    index('contractor_users_contractor_idx').on(t.tenantId, t.contractorId),
  ],
);

/**
 * Tenant-level contractor induction text, versioned (PF-19). Editing the body
 * bumps `version`; portal users whose `acknowledgedVersion` is older must
 * re-acknowledge before the contractor-scoped surfaces open up again — so the
 * tenant can always prove WHICH text was acknowledged.
 */
export const contractorInductionConfig = pgTable('contractor_induction_config', {
  tenantId: varchar('tenant_id', { length: 26 })
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'restrict' }),
  body: text('body').notNull(),
  version: integer('version').notNull().default(1),
  updatedBy: text('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ContractorInductionConfig = typeof contractorInductionConfig.$inferSelect;

export type ContractorUser = typeof contractorUsers.$inferSelect;
