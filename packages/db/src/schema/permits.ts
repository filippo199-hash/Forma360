/**
 * Permit to Work & High-Risk Activities (FreeHS module B3).
 *
 * Formal authorisation, control and closure of the activities most likely
 * to kill someone.
 *
 * Model:
 *   - `permit_types` — the per-tenant catalogue of permit kinds (hot
 *     work, confined space entry, …). Seeded from
 *     `DEFAULT_PERMIT_TYPES` on first use, editable thereafter. Carries
 *     the precondition checklist definition and the signature /
 *     evidence requirements that the issue guard enforces.
 *   - `permits` — the permit itself. Lifecycle draft → issued → active
 *     ⇄ suspended → closed / cancelled (see `canTransition` in
 *     `@forma360/shared/permits`). Preconditions are snapshotted from
 *     the type at creation (jsonb) so later edits to the type never
 *     rewrite a live permit. Gas readings, attachments (isolation
 *     certificates, rescue plans) and the closure-check set are jsonb
 *     records validated by the shared Zod schemas at every boundary.
 *     Signature timestamps (`authorisedAt` / `issuedAt` / `acceptedAt`)
 *     plus the corresponding user ids are the multi-party digital
 *     signature record.
 *   - `permit_events` — append-only audit log. One row per meaningful
 *     mutation; never updated or deleted. Evidence, not state.
 *
 * `expiry_escalated_at` is stamped by the `forma360-permit-expiry-watch`
 * worker the first time it sees an open permit past `valid_to` — the
 * dedupe that stops the escalation email refiring every tick.
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type {
  ClosureChecks,
  GasReading,
  PermitAttachment,
  PermitCategory,
  PermitPreconditionState,
  PermitStatus,
  PermitTypePrecondition,
} from '@forma360/shared/permits';
import { sites } from './sites';
import { tenants } from './tenants';

export const permitTypes = pgTable(
  'permit_types',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),

    /** Icon / grouping family; behaviour lives on the row's flags. */
    category: text('category').notNull().$type<PermitCategory>(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),

    /** Requires an authorising engineer / site controller counter-signature. */
    requiresAuthoriser: boolean('requires_authoriser').notNull().default(false),
    /** Requires at least one recorded gas-test result before issue. */
    requiresGasTesting: boolean('requires_gas_testing').notNull().default(false),
    /** Requires an isolation-certificate reference or attachment before issue. */
    requiresIsolationCertificate: boolean('requires_isolation_certificate')
      .notNull()
      .default(false),
    /** Requires a rescue plan (text or attachment) before issue. */
    requiresRescuePlan: boolean('requires_rescue_plan').notNull().default(false),

    /** Longest validity window a single issue may cover. */
    maxDurationHours: integer('max_duration_hours').notNull().default(12),

    /** Checklist definition snapshotted onto each new permit. */
    preconditions: jsonb('preconditions')
      .notNull()
      .$type<ReadonlyArray<PermitTypePrecondition>>()
      .default(sql`'[]'::jsonb`),

    /** True for the seeded defaults — the UI labels them, both stay editable. */
    isSystem: boolean('is_system').notNull().default(false),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),

    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index('permit_types_tenant_idx').on(table.tenantId, table.archivedAt)],
);

export type PermitType = typeof permitTypes.$inferSelect;
export type NewPermitType = typeof permitTypes.$inferInsert;

export const permits = pgTable(
  'permits',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    permitTypeId: varchar('permit_type_id', { length: 26 })
      .notNull()
      .references(() => permitTypes.id, { onDelete: 'restrict' }),

    /** Human-friendly reference ("PTW-0001"), stamped in the create tx. */
    referenceNumber: text('reference_number'),

    title: text('title').notNull(),
    workDescription: text('work_description').notNull().default(''),

    siteId: varchar('site_id', { length: 26 }).references(() => sites.id, {
      onDelete: 'set null',
    }),
    /** Specific area within the site; drives the same-area conflict flag. */
    locationText: text('location_text').notNull().default(''),

    status: text('status').notNull().default('draft').$type<PermitStatus>(),

    validFrom: timestamp('valid_from', { withTimezone: true, mode: 'date' }).notNull(),
    validTo: timestamp('valid_to', { withTimezone: true, mode: 'date' }).notNull(),

    // ── Parties + digital signatures (timestamps are the signatures) ──
    /** Named at creation; must accept before work starts. */
    acceptorUserId: text('acceptor_user_id'),
    acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'date' }),
    /** Set when a permits.issue holder issues; never the acceptor. */
    issuerUserId: text('issuer_user_id'),
    issuedAt: timestamp('issued_at', { withTimezone: true, mode: 'date' }),
    /** Authorising engineer / site controller, where the type requires one. */
    authoriserUserId: text('authoriser_user_id'),
    authorisedAt: timestamp('authorised_at', { withTimezone: true, mode: 'date' }),

    // ── Precondition checklist snapshot (from the type, at creation) ──
    preconditions: jsonb('preconditions')
      .notNull()
      .$type<ReadonlyArray<PermitPreconditionState>>()
      .default(sql`'[]'::jsonb`),

    // ── Evidence records ──
    gasReadings: jsonb('gas_readings')
      .notNull()
      .$type<ReadonlyArray<GasReading>>()
      .default(sql`'[]'::jsonb`),
    attachments: jsonb('attachments')
      .notNull()
      .$type<ReadonlyArray<PermitAttachment>>()
      .default(sql`'[]'::jsonb`),
    /** Isolation-certificate reference (satisfies the requirement without an upload). */
    isolationCertificateRef: text('isolation_certificate_ref').notNull().default(''),
    rescuePlan: text('rescue_plan').notNull().default(''),

    // ── Suspension ──
    suspendedAt: timestamp('suspended_at', { withTimezone: true, mode: 'date' }),
    suspendedBy: text('suspended_by'),
    suspensionReason: text('suspension_reason').notNull().default(''),

    /** Number of re-authorised extensions applied to `valid_to`. */
    extensionCount: integer('extension_count').notNull().default(0),

    // ── Closure / cancellation ──
    closedAt: timestamp('closed_at', { withTimezone: true, mode: 'date' }),
    closedBy: text('closed_by'),
    closureChecks: jsonb('closure_checks').$type<ClosureChecks>(),
    closureNotes: text('closure_notes').notNull().default(''),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'date' }),
    cancelledBy: text('cancelled_by'),
    cancellationReason: text('cancellation_reason').notNull().default(''),

    /** Stamped once by the expiry-watch worker; dedupes the escalation. */
    expiryEscalatedAt: timestamp('expiry_escalated_at', { withTimezone: true, mode: 'date' }),

    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('permits_tenant_status_idx').on(table.tenantId, table.status),
    index('permits_tenant_site_idx').on(table.tenantId, table.siteId),
    index('permits_tenant_valid_to_idx').on(table.tenantId, table.validTo),
    index('permits_type_idx').on(table.permitTypeId),
  ],
);

export type Permit = typeof permits.$inferSelect;
export type NewPermit = typeof permits.$inferInsert;

export const PERMIT_EVENT_KINDS = [
  'created',
  'updated',
  'precondition_checked',
  'precondition_unchecked',
  'gas_reading_recorded',
  'attachment_added',
  'authorised',
  'issued',
  'accepted',
  'suspended',
  'resumed',
  'extended',
  'handed_over',
  'cancelled',
  'closed',
  'expiry_escalated',
] as const;
export type PermitEventKind = (typeof PERMIT_EVENT_KINDS)[number];

/**
 * Append-only permit audit log. The router writes one row per meaningful
 * mutation and exposes no way to alter or remove rows — timestamps every
 * signature and lifecycle move. The expiry-watch worker writes
 * `expiry_escalated` with actor 'system'.
 */
export const permitEvents = pgTable(
  'permit_events',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    permitId: varchar('permit_id', { length: 26 })
      .notNull()
      .references(() => permits.id, { onDelete: 'cascade' }),
    actorUserId: text('actor_user_id').notNull(),
    kind: text('kind').notNull().$type<PermitEventKind>(),
    detail: text('detail').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('permit_events_permit_idx').on(table.tenantId, table.permitId, table.createdAt),
  ],
);

export type PermitEvent = typeof permitEvents.$inferSelect;
