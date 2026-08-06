/**
 * Training & competence matrix (FreeHS module B7).
 *
 * Three objects, and deliberately no fourth: **the matrix itself is not a
 * table**. It is computed on read from assignments × records, exactly as
 * fire safety, permits and COSHH compute their statuses. Storing a grid
 * would mean 800 people × 30 requirements of rows to keep in step with
 * every role change — the thing that makes spreadsheets rot.
 *
 *   - `training_requirements` — the catalogue: what a ticket *is*, how
 *     long it lasts, whether it is statutory.
 *   - `training_requirement_assignments` — who needs it, by role, group,
 *     site or named person. A person's requirement set is the **union**,
 *     which is what lets "machine operator" carry three requirements
 *     automatically and a ward add a fourth on top.
 *   - `training_records` — what someone actually holds. **Append-only**:
 *     a renewal inserts a new row and nothing ever overwrites an expiry,
 *     because the auditor's question is "was this person competent *on
 *     the day*", which an overwritten row cannot answer.
 *
 * People are not necessarily users. A contractor's operative or an agency
 * worker has records and no account, so a record points at either a
 * `user_id` or a name + category — the `incident_people` precedent.
 *
 * Records outlive people (Lindqvist): the FK to `user` is ON DELETE SET
 * NULL and `person_name` is always populated, so anonymising a user
 * leaves the evidence that training happened while detaching the
 * identity.
 */
import {
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import type {
  TrainingAssignmentScope,
  TrainingObligation,
  TrainingRecordSource,
  TrainingVerificationStatus,
} from '@forma360/shared/training';
import { groups } from './groups';
import { sites } from './sites';
import { tenants } from './tenants';
import { user } from './auth';

// ─── Requirements (the catalogue) ───────────────────────────────────────────

/**
 * A training requirement — "Abrasive wheels", "CSCS card", "Fire marshal".
 *
 * `validityMonths` null means the qualification does not expire; the
 * status helper reads that as permanently in date rather than inventing
 * an expiry. `renewalLeadDays` is per-requirement because a CSCS card
 * needs chasing months out and a toolbox talk does not.
 */
export const trainingRequirements = pgTable(
  'training_requirements',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    /** Free-text grouping for the catalogue and the grid's column groups. */
    category: text('category'),
    /** Statutory and mandatory report separately — the board asks for them apart. */
    obligation: text('obligation').notNull().default('mandatory').$type<TrainingObligation>(),
    /** Null = never expires. */
    validityMonths: integer('validity_months'),
    renewalLeadDays: integer('renewal_lead_days').notNull().default(60),
    /** What evidence is expected — shown when recording, not enforced. */
    evidenceNote: text('evidence_note'),
    description: text('description'),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('training_requirements_tenant_idx').on(t.tenantId),
    uniqueIndex('training_requirements_tenant_name_key').on(t.tenantId, t.name),
  ],
);

export type TrainingRequirement = typeof trainingRequirements.$inferSelect;
export type NewTrainingRequirement = typeof trainingRequirements.$inferInsert;

// ─── Assignments (who needs it) ─────────────────────────────────────────────

/**
 * One rule attaching a requirement to a population. Exactly one of
 * `roleName` / `groupId` / `siteId` / `userId` is set, per `scope`.
 *
 * Role is a plain string rather than an FK because "role" here is the
 * tenant's own job-title vocabulary (a custom user field), not a
 * permission set — the panel's "machine operator", not "Administrator".
 */
export const trainingRequirementAssignments = pgTable(
  'training_requirement_assignments',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    requirementId: varchar('requirement_id', { length: 26 })
      .notNull()
      .references(() => trainingRequirements.id, { onDelete: 'cascade' }),
    scope: text('scope').notNull().$type<TrainingAssignmentScope>(),
    /** scope='role' — matches the tenant's job-title vocabulary. */
    roleName: text('role_name'),
    /** scope='group' */
    groupId: varchar('group_id', { length: 26 }).references(() => groups.id, {
      onDelete: 'cascade',
    }),
    /** scope='site' */
    siteId: varchar('site_id', { length: 26 }).references(() => sites.id, { onDelete: 'cascade' }),
    /** scope='person' — a named individual, only ever a platform user. */
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('training_assignments_tenant_idx').on(t.tenantId),
    index('training_assignments_requirement_idx').on(t.tenantId, t.requirementId),
  ],
);

export type TrainingRequirementAssignment = typeof trainingRequirementAssignments.$inferSelect;
export type NewTrainingRequirementAssignment = typeof trainingRequirementAssignments.$inferInsert;

// ─── Records (what someone holds) ───────────────────────────────────────────

/**
 * One completion. **Append-only** — a renewal is a new row; the old row
 * keeps its original expiry so "as at" queries stay truthful.
 *
 * `verifiedByUserId` / `verifiedAt` are kept apart from
 * `recordedByUserId` on purpose: self-declared training carries a
 * different evidential weight from checked training, and the record has
 * to say which it is. Same shape as `contractor_documents`.
 */
export const trainingRecords = pgTable(
  'training_records',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    requirementId: varchar('requirement_id', { length: 26 })
      .notNull()
      .references(() => trainingRequirements.id, { onDelete: 'restrict' }),

    /**
     * The person. `userId` when they have an account; otherwise name-only
     * (contractors' operatives, agency staff). `personName` is ALWAYS
     * populated so the record survives anonymisation of the user.
     */
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    personName: text('person_name').notNull(),
    /** Free-text: 'employee' | 'contractor' | 'agency' | … (incident_people precedent). */
    personCategory: text('person_category').notNull().default('employee'),
    /** Set when the person is a contractor's operative, for company roll-ups. */
    contractorId: varchar('contractor_id', { length: 26 }),

    achievedAt: date('achieved_at', { mode: 'date' }).notNull(),
    /** Computed from the requirement's validity on write; overridable. Null = never expires. */
    expiresAt: date('expires_at', { mode: 'date' }),

    awardingBody: text('awarding_body'),
    certificateNumber: text('certificate_number'),
    /** R2 key for the photographed card / certificate — the evidence. */
    evidenceKey: text('evidence_key'),
    evidenceFilename: text('evidence_filename'),

    source: text('source').notNull().default('external').$type<TrainingRecordSource>(),
    verificationStatus: text('verification_status')
      .notNull()
      .default('unverified')
      .$type<TrainingVerificationStatus>(),
    verifiedByUserId: text('verified_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    verifiedAt: timestamp('verified_at', { withTimezone: true, mode: 'date' }),
    verificationNote: text('verification_note'),

    notes: text('notes'),
    /** Stamped when the pre-expiry reminder has been sent, so it fires once. */
    reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true, mode: 'date' }),
    /** Superseded rows stay readable but drop out of the current matrix. */
    supersededAt: timestamp('superseded_at', { withTimezone: true, mode: 'date' }),

    recordedByUserId: text('recorded_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('training_records_tenant_idx').on(t.tenantId),
    index('training_records_person_idx').on(t.tenantId, t.userId),
    index('training_records_requirement_idx').on(t.tenantId, t.requirementId),
    index('training_records_expiry_idx').on(t.tenantId, t.expiresAt),
  ],
);

export type TrainingRecord = typeof trainingRecords.$inferSelect;
export type NewTrainingRecord = typeof trainingRecords.$inferInsert;
