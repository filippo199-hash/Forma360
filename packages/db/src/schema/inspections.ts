/**
 * Inspections — the running / completed form instances.
 *
 * Phase 2 PR 28. Four tenant-scoped tables:
 *
 *   - inspections            — the conduct row. Pins to templateVersionId at
 *                              start (T-E04). Snapshots the caller's
 *                              groups / sites / permissions into
 *                              `accessSnapshot` per ADR 0007.
 *   - inspection_signatures  — one row per filled signature slot. Unique
 *                              (inspectionId, slotIndex) gives T-E20
 *                              double-sign protection via DB.
 *   - inspection_approvals   — one row per approval decision (approve or
 *                              reject). Kept as a log; the inspection's
 *                              terminal status is stamped on the parent row.
 *   - public_inspection_links — opaque-token public links (revocable). Not
 *                              used at auth time in Phase 2 — stubbed out
 *                              to land the schema.
 *
 * See ADR 0002 (every table tenant-scoped, ON DELETE RESTRICT on tenant),
 * ADR 0007 (access state at time of action).
 */
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { sites } from './sites';
import { templates, templateVersions } from './templates';
import { tenants } from './tenants';

/** Terminal and intermediate lifecycle states. */
export const inspectionStatus = [
  'in_progress',
  'awaiting_signatures',
  'awaiting_approval',
  'completed',
  'rejected',
] as const;
export type InspectionStatus = (typeof inspectionStatus)[number];

/**
 * Shape of the access snapshot we write at inspection start. See ADR 0007 —
 * we freeze what the user COULD DO when they started so the rest of the
 * flow (answer, sign, approve) is deterministic even if the admin removes
 * them from a group halfway through.
 */
export interface AccessSnapshot {
  /** Group ULIDs the caller belonged to at start. */
  groups: readonly string[];
  /** Site ULIDs the caller belonged to at start. */
  sites: readonly string[];
  /** Permission keys the caller held at start. */
  permissions: readonly string[];
  /** ISO timestamp of the snapshot. */
  snapshotAt: string;
}

/**
 * Computed score sticker. Null while in progress. Stamped once at submit
 * (or approval, depending on the template's flow).
 */
export interface InspectionScore {
  total: number;
  max: number;
  percentage: number;
}

export const inspections = pgTable(
  'inspections',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    /**
     * Template identity. RESTRICT — cannot hard-delete a template with
     * inspections; admins archive the template instead (T-E05).
     */
    templateId: varchar('template_id', { length: 26 })
      .notNull()
      .references(() => templates.id, { onDelete: 'restrict' }),

    /**
     * The specific version the inspection is PINNED to (T-E04). Once set,
     * subsequent template edits do not change how this inspection renders.
     */
    templateVersionId: varchar('template_version_id', { length: 26 })
      .notNull()
      .references(() => templateVersions.id, { onDelete: 'restrict' }),

    status: text('status').notNull().default('in_progress'),

    /** Rendered title (T-E09: truncated to 250 chars at render time). */
    title: text('title').notNull(),
    /** Rendered document number. Null before the stamp transaction runs. */
    documentNumber: text('document_number'),

    /** The user id of the "Conducted By" — a snapshot, not an FK. */
    conductedBy: text('conducted_by'),

    /** Optional site link. SET NULL on site delete so history is preserved. */
    siteId: varchar('site_id', { length: 26 }).references(() => sites.id, {
      onDelete: 'set null',
    }),

    /**
     * Keyed by template item id. Value shape depends on the item type —
     * the full validation schema lives in Phase 2 future work; Phase 2 PR
     * 28 just persists what the conduct UI sends.
     */
    responses: jsonb('responses')
      .notNull()
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`),

    /** Computed at submit; null while in progress. */
    score: jsonb('score').$type<InspectionScore | null>(),

    /** ADR 0007 access snapshot. Never null once the row exists. */
    accessSnapshot: jsonb('access_snapshot').notNull().$type<AccessSnapshot>(),

    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    submittedAt: timestamp('submitted_at', { withTimezone: true, mode: 'date' }),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
    rejectedAt: timestamp('rejected_at', { withTimezone: true, mode: 'date' }),
    rejectedReason: text('rejected_reason'),

    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('inspections_tenant_status_idx').on(table.tenantId, table.status),
    index('inspections_tenant_template_idx').on(table.tenantId, table.templateId),
    index('inspections_tenant_version_idx').on(table.tenantId, table.templateVersionId),
    index('inspections_tenant_createdby_idx').on(table.tenantId, table.createdBy),
    index('inspections_tenant_site_idx').on(table.tenantId, table.siteId),
  ],
);

export type Inspection = typeof inspections.$inferSelect;
export type NewInspection = typeof inspections.$inferInsert;

/**
 * One row per signed slot. The unique (inspectionId, slotIndex) catches
 * concurrent double-signs at the DB layer (T-E20) — the router catches
 * the unique-violation and translates to CONFLICT.
 */
export const inspectionSignatures = pgTable(
  'inspection_signatures',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    inspectionId: varchar('inspection_id', { length: 26 })
      .notNull()
      .references(() => inspections.id, { onDelete: 'cascade' }),

    /** 0-based slot position, matching the template's signature slots. */
    slotIndex: integer('slot_index').notNull(),
    /** The template item id of the signature question. */
    slotId: text('slot_id').notNull(),

    /** Signer user id at time of signing — snapshot, not FK. */
    signerUserId: text('signer_user_id').notNull(),
    signerName: text('signer_name').notNull(),
    signerRole: text('signer_role'),

    /** SVG or data URL. */
    signatureData: text('signature_data').notNull(),
    signedAt: timestamp('signed_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('inspection_signatures_unique_slot').on(table.inspectionId, table.slotIndex),
    index('inspection_signatures_tenant_inspection_idx').on(table.tenantId, table.inspectionId),
  ],
);

export type InspectionSignature = typeof inspectionSignatures.$inferSelect;
export type NewInspectionSignature = typeof inspectionSignatures.$inferInsert;

export const inspectionApprovalDecision = ['approved', 'rejected'] as const;
export type InspectionApprovalDecision = (typeof inspectionApprovalDecision)[number];

/**
 * Audit log of approval decisions. The parent inspection's status is the
 * authoritative terminal state — this table is the "who decided what, when,
 * why" paper trail.
 */
export const inspectionApprovals = pgTable(
  'inspection_approvals',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    inspectionId: varchar('inspection_id', { length: 26 })
      .notNull()
      .references(() => inspections.id, { onDelete: 'cascade' }),

    approverUserId: text('approver_user_id').notNull(),
    decision: text('decision').notNull(),
    comment: text('comment'),
    decidedAt: timestamp('decided_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('inspection_approvals_tenant_inspection_idx').on(table.tenantId, table.inspectionId),
  ],
);

export type InspectionApproval = typeof inspectionApprovals.$inferSelect;
export type NewInspectionApproval = typeof inspectionApprovals.$inferInsert;

/**
 * Public (unauthenticated) share links. Opaque URL-safe tokens. Optional
 * expiry + revoke semantics. Enforcement (auth bypass) lives in the Phase 2
 * web route handler; Phase 2 PR 28 just lands the schema.
 */
export const publicInspectionLinks = pgTable(
  'public_inspection_links',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    inspectionId: varchar('inspection_id', { length: 26 })
      .notNull()
      .references(() => inspections.id, { onDelete: 'cascade' }),

    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),

    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('public_inspection_links_tenant_inspection_idx').on(table.tenantId, table.inspectionId),
  ],
);

export type PublicInspectionLink = typeof publicInspectionLinks.$inferSelect;
export type NewPublicInspectionLink = typeof publicInspectionLinks.$inferInsert;
