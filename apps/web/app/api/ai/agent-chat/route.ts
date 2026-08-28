/**
 * The shared task-agent endpoint (AI Agents feature).
 *
 * One SSE route for every catalogue agent with a runner-backed runtime;
 * the three legacy agents keep their own endpoints and are refused here.
 * The gate stack mirrors the other AI routes, plus the per-tenant layer
 * this feature adds:
 *
 *   session → tenant → known agent → brand module → use-permission
 *   (admins pass) → per-tenant ENABLED flag → rate limit
 *
 * then the per-tenant knowledge (text + extracted file texts) and
 * validated settings are loaded and handed to `runTaskAgentTurn`. The
 * client holds the whole conversation and resends it each turn (the
 * template-chat model — nothing persisted).
 */
import { aiAgentKnowledgeFiles, aiAgentSettings } from '@forma360/db/schema';
import { grantsAdminAccess, isPermissionKey } from '@forma360/permissions/catalogue';
import { loadUserPermissions } from '@forma360/permissions/requirePermission';
import { getAiAgent, isAiAgentId } from '@forma360/shared/ai-agents';
import { brandHasModule } from '@forma360/shared/brand';
import { and, eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { z } from 'zod';
import { activeBrand } from '../../../../src/lib/brand';
import { logger } from '../../../../src/server/logger';
import { rateLimit, tooManyRequests } from '../../../../src/server/rate-limit';
import {
  runTaskAgentTurn,
  TENANT_DAILY_AI_LIMIT,
  type TaskAgentEvent,
} from '../../../../src/server/task-agent';
import { getTaskAgentServerDef } from '../../../../src/server/task-agents';
import { createContext } from '../../../../src/server/trpc';

const HEARTBEAT_MS = 15_000;

const bodySchema = z.object({
  agentId: z.string(),
  params: z.record(z.string().max(64), z.string().max(64)).default({}),
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(20_000),
      }),
    )
    .min(1)
    .max(40),
});

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sseChunk(data: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

export async function POST(request: Request): Promise<Response> {
  const ctx = await createContext({ headers: await headers() });
  if (ctx.auth === null) return jsonError(401, 'Unauthorized');
  const { tenantId, userId } = ctx.auth;

  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return jsonError(400, 'Bad request');
  if (!isAiAgentId(body.data.agentId)) return jsonError(404, 'Unknown agent');
  const agentId = body.data.agentId;

  const def = getAiAgent(agentId);
  const serverDef = getTaskAgentServerDef(agentId);
  if (serverDef === null) return jsonError(404, 'Unknown agent');
  if (def.module !== null && !brandHasModule(activeBrand.id, def.module)) {
    return jsonError(404, 'Unknown agent');
  }

  const perms = await loadUserPermissions(ctx.db, tenantId, userId);
  const allowed =
    grantsAdminAccess(perms) ||
    (isPermissionKey(def.usePermission) && perms.includes(def.usePermission));
  if (!allowed) return jsonError(403, 'Missing permission');

  const [settingsRow] = await ctx.db
    .select()
    .from(aiAgentSettings)
    .where(and(eq(aiAgentSettings.tenantId, tenantId), eq(aiAgentSettings.agentId, agentId)))
    .limit(1);
  if (settingsRow?.enabled === false) return jsonError(403, 'agent-disabled');

  // Every turn is an Opus call over a knowledge-laden prompt — cap per user.
  const rl = await rateLimit(`ai:agent-chat:${userId}`, { limit: 15, windowSec: 300 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);
  const tenantRl = await rateLimit(`ai:tenant-day:${tenantId}`, {
    limit: TENANT_DAILY_AI_LIMIT,
    windowSec: 86_400,
  });
  if (!tenantRl.ok) return tooManyRequests(tenantRl.retryAfterSec);

  const fileRows = await ctx.db
    .select({
      filename: aiAgentKnowledgeFiles.filename,
      text: aiAgentKnowledgeFiles.extractedText,
      status: aiAgentKnowledgeFiles.status,
    })
    .from(aiAgentKnowledgeFiles)
    .where(
      and(eq(aiAgentKnowledgeFiles.tenantId, tenantId), eq(aiAgentKnowledgeFiles.agentId, agentId)),
    );
  const knowledgeFiles = fileRows
    .filter((f) => f.status === 'ready' && f.text.trim().length > 0)
    .map((f) => ({ filename: f.filename, text: f.text }));

  const contextBlock = await serverDef.buildContext({
    db: ctx.db,
    tenantId,
    userId,
    params: body.data.params,
  });

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  void (async () => {
    const log = logger.child({ route: 'ai/agent-chat', agentId, userId, tenantId });
    const heartbeat = setInterval(() => {
      void writer.write(new TextEncoder().encode(': ping\n\n')).catch(() => {});
    }, HEARTBEAT_MS);
    try {
      await runTaskAgentTurn({
        basePrompt: serverDef.basePrompt,
        proposeTool: serverDef.proposeTool,
        parseProposal: serverDef.parseProposal,
        knowledge: settingsRow?.knowledge ?? '',
        knowledgeFiles,
        settingsBlock: serverDef.settingsBlock(settingsRow?.settings ?? {}),
        contextBlock,
        messages: body.data.messages,
        onEvent: (event: TaskAgentEvent) => {
          void writer.write(sseChunk(event)).catch(() => {});
        },
      });
      await writer.write(sseChunk({ type: 'done' })).catch(() => {});
    } catch (err) {
      log.warn({ err }, '[agent-chat] turn failed');
      await writer
        .write(sseChunk({ type: 'error', message: 'draft-failed' }))
        .catch(() => {});
    } finally {
      clearInterval(heartbeat);
      await writer.close().catch(() => {});
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
