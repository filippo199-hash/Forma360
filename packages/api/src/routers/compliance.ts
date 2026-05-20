/**
 * Compliance router — Phase 8.
 *
 * Namespaces:
 *   compliance.frameworks.list / get / create / update / archive
 *   compliance.rules.list / get / create / update / archive
 *   compliance.evidence.list / create / delete
 *   compliance.dashboard.overview
 *   compliance.dashboard.trends
 *   compliance.rules.evaluate
 */
import {
  complianceEvaluations,
  complianceFrameworks,
  complianceRuleEvidence,
  complianceRules,
  complianceSnapshots,
  evidenceTypes,
  frameworkTypes,
  ruleFrequencies,
  type ComplianceStatus,
  type EvidenceConfig,
} from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import {
  FRAMEWORK_CATALOGUE,
  getCatalogueByType,
  getCatalogueEntry,
  type CatalogueFrameworkType,
} from '../framework-catalogue';
import { requirePermission, tenantProcedure } from '../procedures';
import { router } from '../trpc';

// ─── Dep injection ────────────────────────────────────────────────────────────

export interface ComplianceRouterDeps {
  enqueueEvaluate: (tenantId: string, ruleId: string) => Promise<void>;
}

// ─── Input schemas ────────────────────────────────────────────────────────────

const frameworkIdInput = z.object({ frameworkId: z.string().length(26) });
const ruleIdInput = z.object({ ruleId: z.string().length(26) });

const createFrameworkInput = z.object({
  name: z.string().min(1).max(500),
  description: z.string().max(50_000).default(''),
  type: z.enum(frameworkTypes).default('custom'),
  ownerUserId: z.string().length(26).optional(),
  /** Empty array = company-wide; non-empty = applies to these sites only. */
  applicableSites: z.array(z.string().length(26)).default([]),
  /** Free-text country / region / jurisdiction (e.g. "European Union"). Null = global. */
  jurisdiction: z.string().max(200).optional(),
  targetScore: z.number().min(0).max(100).optional(),
  /** When provided, auto-seed rules from the pre-built catalogue entry. */
  catalogueId: z.string().optional(),
});

const updateFrameworkInput = z.object({
  frameworkId: z.string().length(26),
  name: z.string().min(1).max(500).optional(),
  description: z.string().max(50_000).optional(),
  type: z.enum(frameworkTypes).optional(),
  ownerUserId: z.string().length(26).nullable().optional(),
  applicableSites: z.array(z.string().length(26)).optional(),
  jurisdiction: z.string().max(200).nullable().optional(),
  targetScore: z.number().min(0).max(100).nullable().optional(),
});

const createRuleInput = z.object({
  frameworkId: z.string().length(26),
  name: z.string().min(1).max(500),
  description: z.string().max(50_000).default(''),
  clauseRef: z.string().max(200).default(''),
  frequency: z.enum(ruleFrequencies).default('monthly'),
  frequencyDays: z.number().int().min(1).optional(),
  applicableSites: z.array(z.string().length(26)).optional(),
  responsibleUserId: z.string().length(26).optional(),
  dueSoonDays: z.number().int().min(1).max(365).default(7),
});

const updateRuleInput = z.object({
  ruleId: z.string().length(26),
  name: z.string().min(1).max(500).optional(),
  description: z.string().max(50_000).optional(),
  clauseRef: z.string().max(200).optional(),
  frequency: z.enum(ruleFrequencies).optional(),
  frequencyDays: z.number().int().min(1).nullable().optional(),
  applicableSites: z.array(z.string().length(26)).nullable().optional(),
  responsibleUserId: z.string().length(26).nullable().optional(),
  dueSoonDays: z.number().int().min(1).max(365).optional(),
});

// EvidenceConfig Zod discriminated union
const evidenceConfigSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('inspection'),
    templateId: z.string().min(1),
    frequencyDays: z.number().int().min(1).optional(),
  }),
  z.object({
    type: z.literal('action'),
    actionTypeId: z.string().optional(),
  }),
  z.object({
    type: z.literal('document'),
    documentId: z.string().optional(),
    freshnessDays: z.number().int().min(1),
  }),
  z.object({
    type: z.literal('heads_up'),
    headsUpId: z.string().min(1),
    requireSignature: z.boolean(),
  }),
  z.object({
    type: z.literal('maintenance'),
    assetTypeId: z.string().optional(),
  }),
  z.object({
    type: z.literal('issue_sla'),
    slaMaxDays: z.number().int().min(1),
    issueCategoryId: z.string().optional(),
  }),
  z.object({
    type: z.literal('training'),
    courseId: z.string().optional(),
    groupId: z.string().optional(),
  }),
  z.object({
    type: z.literal('manual'),
    description: z.string().min(1),
    validityDays: z.number().int().min(1).optional(),
  }),
]);

const createEvidenceInput = z.object({
  ruleId: z.string().length(26),
  evidenceType: z.enum(evidenceTypes),
  config: evidenceConfigSchema,
});

// ─── Loader helpers ───────────────────────────────────────────────────────────

type Db = Parameters<Parameters<typeof tenantProcedure.query>[0]>[0]['ctx']['db'];

async function loadFrameworkOrThrow(db: Db, tenantId: string, frameworkId: string) {
  const rows = await db
    .select()
    .from(complianceFrameworks)
    .where(and(eq(complianceFrameworks.tenantId, tenantId), eq(complianceFrameworks.id, frameworkId)))
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'compliance-framework-not-found' });
  }
  return row;
}

async function loadRuleOrThrow(db: Db, tenantId: string, ruleId: string) {
  const rows = await db
    .select()
    .from(complianceRules)
    .where(and(eq(complianceRules.tenantId, tenantId), eq(complianceRules.id, ruleId)))
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'compliance-rule-not-found' });
  }
  return row;
}

// ─── Router factory ───────────────────────────────────────────────────────────

export function createComplianceRouter(deps: ComplianceRouterDeps) {
  return router({
    // ── frameworks ──────────────────────────────────────────────────────────
    frameworks: router({
      list: tenantProcedure
        .use(requirePermission('compliance.view'))
        .input(
          z
            .object({ includeArchived: z.boolean().default(false) })
            .default({ includeArchived: false }),
        )
        .query(async ({ ctx, input }) => {
          const where = [eq(complianceFrameworks.tenantId, ctx.tenantId)];
          if (!input.includeArchived) where.push(isNull(complianceFrameworks.archivedAt));
          return ctx.db
            .select()
            .from(complianceFrameworks)
            .where(and(...where))
            .orderBy(asc(complianceFrameworks.name));
        }),

      get: tenantProcedure
        .use(requirePermission('compliance.view'))
        .input(frameworkIdInput)
        .query(async ({ ctx, input }) => {
          return loadFrameworkOrThrow(ctx.db, ctx.tenantId, input.frameworkId);
        }),

      create: tenantProcedure
        .use(requirePermission('compliance.frameworks.manage'))
        .input(createFrameworkInput)
        .mutation(async ({ ctx, input }) => {
          const id = newId();
          const now = new Date();

          // Validate catalogue entry if provided.
          const catalogueEntry =
            input.catalogueId !== undefined ? getCatalogueEntry(input.catalogueId) : undefined;
          if (input.catalogueId !== undefined && catalogueEntry === undefined) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'catalogue-entry-not-found' });
          }

          await ctx.db.transaction(async (tx) => {
            await tx.insert(complianceFrameworks).values({
              id,
              tenantId: ctx.tenantId,
              name: input.name,
              description: input.description,
              type: input.type,
              ownerUserId: input.ownerUserId ?? null,
              applicableSites: input.applicableSites,
              jurisdiction: input.jurisdiction ?? null,
              targetScore: input.targetScore !== undefined ? String(input.targetScore) : null,
              createdByUserId: ctx.auth.userId,
              createdAt: now,
              updatedAt: now,
            });

            // Auto-seed rules from the catalogue when a known framework is selected.
            if (catalogueEntry !== undefined && catalogueEntry.rules.length > 0) {
              const ruleRows = catalogueEntry.rules.map((rule) => ({
                id: newId(),
                tenantId: ctx.tenantId,
                frameworkId: id,
                name: rule.name,
                description: rule.description,
                clauseRef: rule.clauseRef,
                frequency: rule.frequency,
                frequencyDays: null,
                applicableSites: [] as string[],
                responsibleUserId: null,
                dueSoonDays: 7,
                createdAt: now,
                updatedAt: now,
              }));
              await tx.insert(complianceRules).values(ruleRows);
            }
          });

          return { frameworkId: id };
        }),

      update: tenantProcedure
        .use(requirePermission('compliance.frameworks.manage'))
        .input(updateFrameworkInput)
        .mutation(async ({ ctx, input }) => {
          const fw = await loadFrameworkOrThrow(ctx.db, ctx.tenantId, input.frameworkId);
          if (fw.archivedAt !== null) {
            throw new TRPCError({ code: 'FORBIDDEN', message: 'compliance-framework-archived' });
          }
          const updates: Partial<typeof complianceFrameworks.$inferInsert> = {
            updatedAt: new Date(),
          };
          if (input.name !== undefined) updates.name = input.name;
          if (input.description !== undefined) updates.description = input.description;
          if (input.type !== undefined) updates.type = input.type;
          if (input.ownerUserId !== undefined) updates.ownerUserId = input.ownerUserId;
          if (input.applicableSites !== undefined) updates.applicableSites = input.applicableSites;
          if (input.jurisdiction !== undefined) updates.jurisdiction = input.jurisdiction;
          if (input.targetScore !== undefined)
            updates.targetScore = input.targetScore !== null ? String(input.targetScore) : null;
          await ctx.db
            .update(complianceFrameworks)
            .set(updates)
            .where(eq(complianceFrameworks.id, fw.id));
          return { ok: true as const };
        }),

      archive: tenantProcedure
        .use(requirePermission('compliance.frameworks.manage'))
        .input(frameworkIdInput)
        .mutation(async ({ ctx, input }) => {
          const fw = await loadFrameworkOrThrow(ctx.db, ctx.tenantId, input.frameworkId);
          if (fw.archivedAt !== null) return { ok: true as const };
          await ctx.db
            .update(complianceFrameworks)
            .set({ archivedAt: new Date(), updatedAt: new Date() })
            .where(eq(complianceFrameworks.id, fw.id));
          return { ok: true as const };
        }),
    }),

    // ── catalogue (static, no DB) ────────────────────────────────────────────
    catalogue: router({
      /**
       * List pre-built framework templates, optionally filtered by type.
       * Returns summary metadata only (no rules payload) to keep the response small.
       */
      list: tenantProcedure
        .use(requirePermission('compliance.frameworks.manage'))
        .input(
          z
            .object({ type: z.enum(frameworkTypes).optional() })
            .default({}),
        )
        .query(({ input }) => {
          const entries =
            input.type !== undefined
              ? getCatalogueByType(input.type as CatalogueFrameworkType)
              : FRAMEWORK_CATALOGUE;
          return entries.map(({ id, name, shortName, description, type, rules }) => ({
            id,
            name,
            shortName,
            description,
            type,
            ruleCount: rules.length,
          }));
        }),

      /** Return a single catalogue entry including all its rules for the preview step. */
      get: tenantProcedure
        .use(requirePermission('compliance.frameworks.manage'))
        .input(z.object({ catalogueId: z.string() }))
        .query(({ input }) => {
          const entry = getCatalogueEntry(input.catalogueId);
          if (entry === undefined) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'catalogue-entry-not-found' });
          }
          return entry;
        }),
    }),

    // ── rules ───────────────────────────────────────────────────────────────
    rules: router({
      list: tenantProcedure
        .use(requirePermission('compliance.view'))
        .input(
          z.object({
            frameworkId: z.string().length(26),
            includeArchived: z.boolean().default(false),
          }),
        )
        .query(async ({ ctx, input }) => {
          // Ensure the framework belongs to this tenant
          await loadFrameworkOrThrow(ctx.db, ctx.tenantId, input.frameworkId);
          const where = [
            eq(complianceRules.tenantId, ctx.tenantId),
            eq(complianceRules.frameworkId, input.frameworkId),
          ];
          if (!input.includeArchived) where.push(isNull(complianceRules.archivedAt));

          const rules = await ctx.db
            .select()
            .from(complianceRules)
            .where(and(...where))
            .orderBy(asc(complianceRules.clauseRef), asc(complianceRules.name));

          if (rules.length === 0) return [];

          // Attach latest evaluation status to each rule
          const ruleIds = rules.map((r) => r.id);
          const latestEvals = await ctx.db
            .select({
              ruleId: complianceEvaluations.ruleId,
              status: complianceEvaluations.status,
              evaluatedAt: complianceEvaluations.evaluatedAt,
            })
            .from(complianceEvaluations)
            .where(
              and(
                eq(complianceEvaluations.tenantId, ctx.tenantId),
                inArray(complianceEvaluations.ruleId, ruleIds),
              ),
            )
            .orderBy(desc(complianceEvaluations.evaluatedAt));

          // Keep only the latest eval per rule
          const latestByRule = new Map<string, { status: string; evaluatedAt: Date | null }>();
          for (const ev of latestEvals) {
            if (!latestByRule.has(ev.ruleId)) {
              latestByRule.set(ev.ruleId, { status: ev.status, evaluatedAt: ev.evaluatedAt });
            }
          }

          return rules.map((r) => ({
            ...r,
            latestEvalStatus: latestByRule.get(r.id)?.status ?? null,
            latestEvaluatedAt: latestByRule.get(r.id)?.evaluatedAt?.toISOString() ?? null,
          }));
        }),

      get: tenantProcedure
        .use(requirePermission('compliance.view'))
        .input(ruleIdInput)
        .query(async ({ ctx, input }) => {
          const rule = await loadRuleOrThrow(ctx.db, ctx.tenantId, input.ruleId);
          const [evidenceReqs, latestEvals] = await Promise.all([
            ctx.db
              .select()
              .from(complianceRuleEvidence)
              .where(eq(complianceRuleEvidence.ruleId, input.ruleId))
              .orderBy(asc(complianceRuleEvidence.createdAt)),
            ctx.db
              .select()
              .from(complianceEvaluations)
              .where(
                and(
                  eq(complianceEvaluations.ruleId, input.ruleId),
                  eq(complianceEvaluations.tenantId, ctx.tenantId),
                ),
              )
              .orderBy(desc(complianceEvaluations.evaluatedAt))
              .limit(10),
          ]);
          return { rule, evidenceReqs, latestEvals };
        }),

      create: tenantProcedure
        .use(requirePermission('compliance.manage'))
        .input(createRuleInput)
        .mutation(async ({ ctx, input }) => {
          await loadFrameworkOrThrow(ctx.db, ctx.tenantId, input.frameworkId);
          const id = newId();
          const now = new Date();
          await ctx.db.insert(complianceRules).values({
            id,
            tenantId: ctx.tenantId,
            frameworkId: input.frameworkId,
            name: input.name,
            description: input.description,
            clauseRef: input.clauseRef,
            frequency: input.frequency,
            frequencyDays: input.frequencyDays ?? null,
            applicableSites: input.applicableSites ?? null,
            responsibleUserId: input.responsibleUserId ?? null,
            dueSoonDays: input.dueSoonDays,
            createdAt: now,
            updatedAt: now,
          });
          return { ruleId: id };
        }),

      update: tenantProcedure
        .use(requirePermission('compliance.manage'))
        .input(updateRuleInput)
        .mutation(async ({ ctx, input }) => {
          const rule = await loadRuleOrThrow(ctx.db, ctx.tenantId, input.ruleId);
          if (rule.archivedAt !== null) {
            throw new TRPCError({ code: 'FORBIDDEN', message: 'compliance-rule-archived' });
          }
          const updates: Partial<typeof complianceRules.$inferInsert> = { updatedAt: new Date() };
          if (input.name !== undefined) updates.name = input.name;
          if (input.description !== undefined) updates.description = input.description;
          if (input.clauseRef !== undefined) updates.clauseRef = input.clauseRef;
          if (input.frequency !== undefined) updates.frequency = input.frequency;
          if (input.frequencyDays !== undefined) updates.frequencyDays = input.frequencyDays;
          if (input.applicableSites !== undefined) updates.applicableSites = input.applicableSites;
          if (input.responsibleUserId !== undefined)
            updates.responsibleUserId = input.responsibleUserId;
          if (input.dueSoonDays !== undefined) updates.dueSoonDays = input.dueSoonDays;
          await ctx.db
            .update(complianceRules)
            .set(updates)
            .where(eq(complianceRules.id, rule.id));
          return { ok: true as const };
        }),

      archive: tenantProcedure
        .use(requirePermission('compliance.manage'))
        .input(ruleIdInput)
        .mutation(async ({ ctx, input }) => {
          const rule = await loadRuleOrThrow(ctx.db, ctx.tenantId, input.ruleId);
          if (rule.archivedAt !== null) return { ok: true as const };
          await ctx.db
            .update(complianceRules)
            .set({ archivedAt: new Date(), updatedAt: new Date() })
            .where(eq(complianceRules.id, rule.id));
          return { ok: true as const };
        }),

      evaluate: tenantProcedure
        .use(requirePermission('compliance.manage'))
        .input(ruleIdInput)
        .mutation(async ({ ctx, input }) => {
          const rule = await loadRuleOrThrow(ctx.db, ctx.tenantId, input.ruleId);
          if (rule.archivedAt !== null) {
            throw new TRPCError({ code: 'FORBIDDEN', message: 'compliance-rule-archived' });
          }
          await deps.enqueueEvaluate(ctx.tenantId, input.ruleId);
          return { ok: true as const };
        }),
    }),

    // ── evidence ────────────────────────────────────────────────────────────
    evidence: router({
      list: tenantProcedure
        .use(requirePermission('compliance.evidence.view'))
        .input(ruleIdInput)
        .query(async ({ ctx, input }) => {
          await loadRuleOrThrow(ctx.db, ctx.tenantId, input.ruleId);
          return ctx.db
            .select()
            .from(complianceRuleEvidence)
            .where(eq(complianceRuleEvidence.ruleId, input.ruleId))
            .orderBy(asc(complianceRuleEvidence.createdAt));
        }),

      create: tenantProcedure
        .use(requirePermission('compliance.manage'))
        .input(createEvidenceInput)
        .mutation(async ({ ctx, input }) => {
          await loadRuleOrThrow(ctx.db, ctx.tenantId, input.ruleId);
          const id = newId();
          await ctx.db.insert(complianceRuleEvidence).values({
            id,
            ruleId: input.ruleId,
            tenantId: ctx.tenantId,
            evidenceType: input.evidenceType,
            config: input.config as EvidenceConfig,
            createdAt: new Date(),
          });
          return { evidenceId: id };
        }),

      delete: tenantProcedure
        .use(requirePermission('compliance.manage'))
        .input(z.object({ evidenceId: z.string().length(26) }))
        .mutation(async ({ ctx, input }) => {
          const rows = await ctx.db
            .select({ ruleId: complianceRuleEvidence.ruleId })
            .from(complianceRuleEvidence)
            .where(eq(complianceRuleEvidence.id, input.evidenceId))
            .limit(1);
          const row = rows[0];
          if (row === undefined) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'compliance-evidence-not-found' });
          }
          // Verify it belongs to this tenant
          await loadRuleOrThrow(ctx.db, ctx.tenantId, row.ruleId);
          await ctx.db
            .delete(complianceRuleEvidence)
            .where(eq(complianceRuleEvidence.id, input.evidenceId));
          return { ok: true as const };
        }),
    }),

    // ── dashboard ───────────────────────────────────────────────────────────
    dashboard: router({
      overview: tenantProcedure
        .use(requirePermission('compliance.view'))
        .query(async ({ ctx }) => {
          // All active frameworks
          const frameworks = await ctx.db
            .select()
            .from(complianceFrameworks)
            .where(
              and(
                eq(complianceFrameworks.tenantId, ctx.tenantId),
                isNull(complianceFrameworks.archivedAt),
              ),
            )
            .orderBy(asc(complianceFrameworks.name));

          if (frameworks.length === 0) {
            return {
              totalRules: 0,
              compliantCount: 0,
              dueSoonCount: 0,
              nonCompliantCount: 0,
              overallScore: 0,
              frameworks: [],
              nonCompliantRules: [],
            };
          }

          const frameworkIds = frameworks.map((f) => f.id);

          // All active rules across these frameworks
          const allRules = await ctx.db
            .select()
            .from(complianceRules)
            .where(
              and(
                eq(complianceRules.tenantId, ctx.tenantId),
                inArray(complianceRules.frameworkId, frameworkIds),
                isNull(complianceRules.archivedAt),
              ),
            );

          if (allRules.length === 0) {
            return {
              totalRules: 0,
              compliantCount: 0,
              dueSoonCount: 0,
              nonCompliantCount: 0,
              overallScore: 0,
              frameworks: frameworks.map((f) => ({
                id: f.id,
                name: f.name,
                type: f.type,
                score: 0,
                totalRules: 0,
                compliantCount: 0,
                dueSoonCount: 0,
                nonCompliantCount: 0,
                targetScore: f.targetScore !== null ? Number(f.targetScore) : null,
              })),
              nonCompliantRules: [],
            };
          }

          const ruleIds = allRules.map((r) => r.id);

          // Latest evaluation for each rule
          const latestEvals = await ctx.db
            .select({
              ruleId: complianceEvaluations.ruleId,
              status: complianceEvaluations.status,
              evaluatedAt: complianceEvaluations.evaluatedAt,
            })
            .from(complianceEvaluations)
            .where(
              and(
                eq(complianceEvaluations.tenantId, ctx.tenantId),
                inArray(complianceEvaluations.ruleId, ruleIds),
              ),
            )
            .orderBy(desc(complianceEvaluations.evaluatedAt));

          const latestByRule = new Map<string, { status: ComplianceStatus; evaluatedAt: Date | null }>();
          for (const ev of latestEvals) {
            if (!latestByRule.has(ev.ruleId)) {
              latestByRule.set(ev.ruleId, {
                status: ev.status as ComplianceStatus,
                evaluatedAt: ev.evaluatedAt,
              });
            }
          }

          // Per-framework aggregates
          const rulesByFramework = new Map<string, typeof allRules>();
          for (const rule of allRules) {
            const existing = rulesByFramework.get(rule.frameworkId) ?? [];
            existing.push(rule);
            rulesByFramework.set(rule.frameworkId, existing);
          }

          const frameworkSummaries = frameworks.map((fw) => {
            const fwRules = rulesByFramework.get(fw.id) ?? [];
            const counts = { compliant: 0, due_soon: 0, non_compliant: 0, not_evaluable: 0 };
            for (const r of fwRules) {
              const st = latestByRule.get(r.id)?.status ?? 'not_evaluable';
              counts[st] = (counts[st] ?? 0) + 1;
            }
            const total = fwRules.length;
            const score = total > 0 ? Math.round((counts.compliant / total) * 100 * 10) / 10 : 0;
            return {
              id: fw.id,
              name: fw.name,
              type: fw.type,
              score,
              totalRules: total,
              compliantCount: counts.compliant,
              dueSoonCount: counts.due_soon,
              nonCompliantCount: counts.non_compliant,
              targetScore: fw.targetScore !== null ? Number(fw.targetScore) : null,
            };
          });

          // Global counts
          const globalCounts = { compliant: 0, due_soon: 0, non_compliant: 0, not_evaluable: 0 };
          for (const r of allRules) {
            const st = latestByRule.get(r.id)?.status ?? 'not_evaluable';
            globalCounts[st] = (globalCounts[st] ?? 0) + 1;
          }
          const totalRules = allRules.length;
          const overallScore =
            totalRules > 0
              ? Math.round((globalCounts.compliant / totalRules) * 100 * 10) / 10
              : 0;

          // Non-compliant rules list (for the bottom section)
          const fwNameById = new Map(frameworks.map((f) => [f.id, f.name]));
          const nonCompliantRules = allRules
            .filter((r) => latestByRule.get(r.id)?.status === 'non_compliant')
            .map((r) => ({
              ruleId: r.id,
              ruleName: r.name,
              clauseRef: r.clauseRef,
              frameworkId: r.frameworkId,
              frameworkName: fwNameById.get(r.frameworkId) ?? '',
              status: 'non_compliant',
              evaluatedAt: latestByRule.get(r.id)?.evaluatedAt?.toISOString() ?? null,
            }));

          return {
            totalRules,
            compliantCount: globalCounts.compliant,
            dueSoonCount: globalCounts.due_soon,
            nonCompliantCount: globalCounts.non_compliant,
            overallScore,
            frameworks: frameworkSummaries,
            nonCompliantRules,
          };
        }),

      trends: tenantProcedure
        .use(requirePermission('compliance.view'))
        .input(
          z.object({
            frameworkId: z.string().length(26),
            months: z.number().int().min(1).max(24).default(6),
          }),
        )
        .query(async ({ ctx, input }) => {
          await loadFrameworkOrThrow(ctx.db, ctx.tenantId, input.frameworkId);

          const since = new Date();
          since.setMonth(since.getMonth() - input.months);
          const sinceDate = since.toISOString().slice(0, 10);

          const snapshots = await ctx.db
            .select()
            .from(complianceSnapshots)
            .where(
              and(
                eq(complianceSnapshots.tenantId, ctx.tenantId),
                eq(complianceSnapshots.frameworkId, input.frameworkId),
              ),
            )
            .orderBy(asc(complianceSnapshots.snapshottedAt));

          // Group by month (YYYY-MM)
          const byMonth = new Map<
            string,
            { scorePct: number; totalRules: number; compliantCount: number }
          >();
          for (const snap of snapshots) {
            const month = String(snap.snapshottedAt).slice(0, 7);
            if (month < sinceDate.slice(0, 7)) continue;
            // Last snapshot of each month wins
            byMonth.set(month, {
              scorePct: Number(snap.scorePct),
              totalRules: snap.totalRules,
              compliantCount: snap.compliantCount,
            });
          }

          return Array.from(byMonth.entries()).map(([month, data]) => ({
            month,
            ...data,
          }));
        }),
    }),
  });
}
