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
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { tenants } from './tenants';

export const contractorStatus = ['active', 'inactive'] as const;
export type ContractorStatus = (typeof contractorStatus)[number];

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
    primaryContactName: text('primary_contact_name'),
    primaryContactEmail: text('primary_contact_email'),
    notes: text('notes'),
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
