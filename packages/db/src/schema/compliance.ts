/**
 * Compliance subgraph — Phase 8.
 *
 * Five tenant-scoped tables:
 *
 *   - compliance_frameworks   — the top-level compliance framework (e.g.
 *                               ISO 9001, OSHA). Belongs to a tenant; has
 *                               an optional target_score and applicable sites.
 *   - compliance_rules        — individual obligations inside a framework.
 *                               Each rule has a frequency and optional
 *                               evidence requirements.
 *   - compliance_rule_evidence — evidence requirements linked to a rule.
 *                                A rule can have multiple evidence items, each
 *                                with a typed config payload.
 *   - compliance_evaluations  — one evaluation row per rule-evaluation cycle.
 *                               Written by the compliance-evaluate BullMQ
 *                               worker.
 *   - compliance_snapshots    — daily per-framework roll-up (score_pct,
 *                               counts by status). Written by the
 *                               compliance-snapshot worker.
 *
 * See ADR 0002 (tenant scope + RESTRICT FKs).
 */
import { date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { tenants } from './tenants';

// ─── Domain type literals ────────────────────────────────────────────────────

export const frameworkTypes = [
  'health_safety',
  'quality',
  'environmental',
  'regulatory',
  'custom',
] as const;
export type FrameworkType = (typeof frameworkTypes)[number];

export const ruleFrequencies = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'once'] as const;
export type RuleFrequency = (typeof ruleFrequencies)[number];

export const evidenceTypes = [
  'inspection',
  'action',
  'document',
  'heads_up',
  'maintenance',
  'issue_sla',
  'training',
  'manual',
] as const;
export type EvidenceType = (typeof evidenceTypes)[number];

export const complianceStatuses = [
  'compliant',
  'due_soon',
  'non_compliant',
  'not_evaluable',
] as const;
export type ComplianceStatus = (typeof complianceStatuses)[number];

// ─── Evidence config discriminated union ─────────────────────────────────────

export type EvidenceConfig =
  | { type: 'inspection'; templateId: string; frequencyDays?: number }
  | { type: 'action'; actionTypeId?: string }
  | { type: 'document'; documentId?: string; freshnessDays: number }
  | { type: 'heads_up'; headsUpId: string; requireSignature: boolean }
  | { type: 'maintenance'; assetTypeId?: string }
  | { type: 'issue_sla'; slaMaxDays: number; issueCategoryId?: string }
  | { type: 'training'; courseId?: string; groupId?: string }
  | { type: 'manual'; description: string; validityDays?: number };

export interface EvidenceSummaryItem {
  evidenceReqId: string;
  evidenceType: EvidenceType;
  status: ComplianceStatus;
  detail?: string;
}

// ─── Tables ──────────────────────────────────────────────────────────────────

export const complianceFrameworks = pgTable(
  'compliance_frameworks',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    /** One of the FrameworkType literals. */
    type: text('type').notNull().default('custom'),
    ownerUserId: text('owner_user_id').references(() => user.id),
    /** Array of site ids this framework applies to. Empty means all sites. */
    applicableSites: jsonb('applicable_sites').notNull().default([]),
    targetScore: numeric('target_score'),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    index('compliance_frameworks_tenant_idx').on(t.tenantId),
    // Note: the partial index (WHERE archived_at IS NULL) is defined in the
    // migration SQL as `compliance_frameworks_tenant_status_idx`. Drizzle's
    // type-safe index builder doesn't yet support a parameter-less .where()
    // so we omit it here and rely on the migration for correctness.
    index('compliance_frameworks_name_idx').on(t.tenantId, t.name),
  ],
);

export type ComplianceFramework = typeof complianceFrameworks.$inferSelect;

export const complianceRules = pgTable(
  'compliance_rules',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    frameworkId: text('framework_id')
      .notNull()
      .references(() => complianceFrameworks.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    clauseRef: text('clause_ref').notNull().default(''),
    /** One of the RuleFrequency literals. */
    frequency: text('frequency').notNull().default('monthly'),
    /** Custom frequency in days. Only used when frequency='once' or as override. */
    frequencyDays: integer('frequency_days'),
    /** Optional array of site ids this rule applies to. */
    applicableSites: jsonb('applicable_sites'),
    responsibleUserId: text('responsible_user_id').references(() => user.id),
    /** How many days before the due date to flip to 'due_soon'. */
    dueSoonDays: integer('due_soon_days').notNull().default(7),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('compliance_rules_framework_idx').on(t.frameworkId),
    index('compliance_rules_tenant_idx').on(t.tenantId),
  ],
);

export type ComplianceRule = typeof complianceRules.$inferSelect;

export const complianceRuleEvidence = pgTable(
  'compliance_rule_evidence',
  {
    id: text('id').primaryKey(),
    ruleId: text('rule_id')
      .notNull()
      .references(() => complianceRules.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** One of the EvidenceType literals. */
    evidenceType: text('evidence_type').notNull(),
    /** Typed EvidenceConfig payload. */
    config: jsonb('config').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('compliance_rule_evidence_rule_idx').on(t.ruleId)],
);

export type ComplianceRuleEvidence = typeof complianceRuleEvidence.$inferSelect;

export const complianceEvaluations = pgTable(
  'compliance_evaluations',
  {
    id: text('id').primaryKey(),
    ruleId: text('rule_id')
      .notNull()
      .references(() => complianceRules.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** Overall ComplianceStatus for this evaluation. */
    status: text('status').notNull(),
    /** Array of EvidenceSummaryItem objects. */
    evidenceSummary: jsonb('evidence_summary').notNull().default([]),
    periodStart: timestamp('period_start', { withTimezone: true }),
    periodEnd: timestamp('period_end', { withTimezone: true }),
    evaluatedAt: timestamp('evaluated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('compliance_evaluations_rule_idx').on(t.ruleId, t.evaluatedAt),
    index('compliance_evaluations_tenant_idx').on(t.tenantId),
  ],
);

export type ComplianceEvaluation = typeof complianceEvaluations.$inferSelect;

export const complianceSnapshots = pgTable(
  'compliance_snapshots',
  {
    id: text('id').primaryKey(),
    frameworkId: text('framework_id')
      .notNull()
      .references(() => complianceFrameworks.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    snapshottedAt: date('snapshotted_at').notNull(),
    scorePct: numeric('score_pct').notNull().default('0'),
    totalRules: integer('total_rules').notNull().default(0),
    compliantCount: integer('compliant_count').notNull().default(0),
    dueSoonCount: integer('due_soon_count').notNull().default(0),
    nonCompliantCount: integer('non_compliant_count').notNull().default(0),
    notEvaluableCount: integer('not_evaluable_count').notNull().default(0),
  },
  (t) => [
    uniqueIndex('compliance_snapshots_unique_idx').on(t.frameworkId, t.snapshottedAt),
    index('compliance_snapshots_tenant_idx').on(t.tenantId),
  ],
);

export type ComplianceSnapshot = typeof complianceSnapshots.$inferSelect;
