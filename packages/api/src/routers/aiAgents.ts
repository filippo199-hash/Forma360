/**
 * AI Agents — per-tenant agent customization (the Lightdash-style layer).
 *
 * Agent definitions live in `@forma360/shared/ai-agents`; this router
 * serves and edits the per-company overlay: enabled / knowledge /
 * settings on `ai_agent_settings` (absence = defaults, upsert on the
 * composite PK — the tenantRiskMatrixSettings pattern) plus the uploaded
 * knowledge documents on `ai_agent_knowledge_files` (blob upload happens
 * on `/api/upload/ai-knowledge`; this router lists and deletes).
 *
 * Reading is open to every tenant member — an employee may see what the
 * agents have been taught (it shapes drafts they will sign). WRITING is
 * `org.settings` only: one consistent voice teaches each agent, decided
 * with the product owner. USE-time enforcement (brand, module permission,
 * enabled) happens again on the agent-chat route — this router's `list`
 * is data for tiles, not a gate.
 */
import {
  AI_AGENTS,
  AI_KNOWLEDGE_LIMITS,
  isAiAgentId,
  validateAgentSettings,
  getAiAgent,
  defaultAgentSettings,
} from '@forma360/shared/ai-agents';
import { aiAgentKnowledgeFiles, aiAgentSettings } from '@forma360/db/schema';
import { TRPCError } from '@trpc/server';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission, tenantProcedure } from '../procedures';
import { router } from '../trpc';

const agentIdInput = z.string().refine(isAiAgentId, 'unknown-agent');

export interface AiAgentsRouterDeps {
  /** Best-effort blob removal when a knowledge file row is deleted. */
  deleteObject: ((key: string) => Promise<void>) | null;
}

export function createAiAgentsRouter(deps: AiAgentsRouterDeps) {
  return router({
    /** Tile data: every agent definition + this tenant's overlay. */
    list: tenantProcedure.query(async ({ ctx }) => {
      const rows = await ctx.db
        .select()
        .from(aiAgentSettings)
        .where(eq(aiAgentSettings.tenantId, ctx.tenantId));
      const byAgent = new Map(rows.map((r) => [r.agentId, r]));
      // "Customized" means taught anything at all — text OR documents.
      const fileCounts = await ctx.db
        .select({
          agentId: aiAgentKnowledgeFiles.agentId,
          n: sql<number>`count(*)`,
        })
        .from(aiAgentKnowledgeFiles)
        .where(eq(aiAgentKnowledgeFiles.tenantId, ctx.tenantId))
        .groupBy(aiAgentKnowledgeFiles.agentId);
      const filesByAgent = new Map(fileCounts.map((f) => [f.agentId, Number(f.n)]));
      return AI_AGENTS.map((def) => {
        const row = byAgent.get(def.id);
        return {
          id: def.id,
          module: def.module,
          usePermission: def.usePermission,
          entitlement: def.entitlement ?? null,
          workRoute: def.workRoute,
          enabled: row?.enabled ?? true,
          hasKnowledge:
            (row?.knowledge ?? '').trim().length > 0 || (filesByAgent.get(def.id) ?? 0) > 0,
        };
      });
    }),

    /** One agent's full overlay for the settings page. */
    get: tenantProcedure
      .input(z.object({ agentId: agentIdInput }))
      .query(async ({ ctx, input }) => {
        const def = getAiAgent(input.agentId);
        const [row] = await ctx.db
          .select()
          .from(aiAgentSettings)
          .where(
            and(
              eq(aiAgentSettings.tenantId, ctx.tenantId),
              eq(aiAgentSettings.agentId, input.agentId),
            ),
          )
          .limit(1);
        const files = await ctx.db
          .select({
            id: aiAgentKnowledgeFiles.id,
            filename: aiAgentKnowledgeFiles.filename,
            mimeType: aiAgentKnowledgeFiles.mimeType,
            sizeBytes: aiAgentKnowledgeFiles.sizeBytes,
            status: aiAgentKnowledgeFiles.status,
            createdAt: aiAgentKnowledgeFiles.createdAt,
            extractedChars: sql<number>`length(${aiAgentKnowledgeFiles.extractedText})`,
          })
          .from(aiAgentKnowledgeFiles)
          .where(
            and(
              eq(aiAgentKnowledgeFiles.tenantId, ctx.tenantId),
              eq(aiAgentKnowledgeFiles.agentId, input.agentId),
            ),
          );
        return {
          id: def.id,
          module: def.module,
          usePermission: def.usePermission,
          entitlement: def.entitlement ?? null,
          workRoute: def.workRoute,
          settingDefs: def.settings,
          enabled: row?.enabled ?? true,
          knowledge: row?.knowledge ?? '',
          settings: { ...defaultAgentSettings(def), ...(row?.settings ?? {}) },
          files,
          limits: AI_KNOWLEDGE_LIMITS,
        };
      }),

    /** Admin edit: any subset of enabled / knowledge / settings. */
    updateSettings: tenantProcedure
      .use(requirePermission('org.settings'))
      .input(
        z.object({
          agentId: agentIdInput,
          enabled: z.boolean().optional(),
          knowledge: z.string().max(AI_KNOWLEDGE_LIMITS.textChars).optional(),
          settings: z.record(z.string(), z.string().max(64)).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const def = getAiAgent(input.agentId);
        if (input.settings !== undefined) {
          const problem = validateAgentSettings(def, input.settings);
          if (problem !== null) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'invalid-settings' });
          }
        }
        const now = new Date();
        const values = {
          tenantId: ctx.tenantId,
          agentId: input.agentId,
          enabled: input.enabled ?? true,
          knowledge: input.knowledge ?? '',
          settings: input.settings ?? {},
          updatedAt: now,
          updatedBy: ctx.auth.userId,
        };
        // Partial updates must not clobber unspecified fields: merge over
        // the existing row before the upsert.
        const [existing] = await ctx.db
          .select()
          .from(aiAgentSettings)
          .where(
            and(
              eq(aiAgentSettings.tenantId, ctx.tenantId),
              eq(aiAgentSettings.agentId, input.agentId),
            ),
          )
          .limit(1);
        const merged = {
          ...values,
          enabled: input.enabled ?? existing?.enabled ?? true,
          knowledge: input.knowledge ?? existing?.knowledge ?? '',
          settings: input.settings ?? existing?.settings ?? {},
        };
        await ctx.db
          .insert(aiAgentSettings)
          .values(merged)
          .onConflictDoUpdate({
            target: [aiAgentSettings.tenantId, aiAgentSettings.agentId],
            set: {
              enabled: merged.enabled,
              knowledge: merged.knowledge,
              settings: merged.settings,
              updatedAt: now,
              updatedBy: ctx.auth.userId,
            },
          });
        return { ok: true };
      }),

    /** Admin delete of one knowledge document (row + best-effort blob). */
    deleteKnowledgeFile: tenantProcedure
      .use(requirePermission('org.settings'))
      .input(z.object({ fileId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        const [row] = await ctx.db
          .select()
          .from(aiAgentKnowledgeFiles)
          .where(
            and(
              eq(aiAgentKnowledgeFiles.tenantId, ctx.tenantId),
              eq(aiAgentKnowledgeFiles.id, input.fileId),
            ),
          )
          .limit(1);
        if (row === undefined) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'file-not-found' });
        }
        await ctx.db
          .delete(aiAgentKnowledgeFiles)
          .where(
            and(
              eq(aiAgentKnowledgeFiles.tenantId, ctx.tenantId),
              eq(aiAgentKnowledgeFiles.id, input.fileId),
            ),
          );
        if (deps.deleteObject !== null) {
          await deps.deleteObject(row.storageKey).catch(() => undefined);
        }
        return { ok: true };
      }),
  });
}
