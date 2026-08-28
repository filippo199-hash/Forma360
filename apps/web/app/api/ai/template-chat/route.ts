import { grantsAdminAccess } from '@forma360/permissions/catalogue';
import { loadUserPermissions } from '@forma360/permissions/requirePermission';
import { headers } from 'next/headers';
import { z } from 'zod';
import { knowledgeSuffix, loadAgentOverlay } from '../../../../src/server/agent-overlay';
import { auth } from '../../../../src/server/auth';
import { db } from '../../../../src/server/db';
import { TENANT_DAILY_AI_LIMIT } from '../../../../src/server/task-agent';
import { logger } from '../../../../src/server/logger';
import {
  type TemplateAgentEvent,
  runTemplateAgentTurn,
} from '../../../../src/server/template-agent';
import { rateLimit, tooManyRequests } from '../../../../src/server/rate-limit';

/**
 * Comment frames sent while the agent is quiet. A grounded turn spends minutes
 * inside a single web_search with nothing to say, and an SSE response that
 * emits no bytes for that long is at the mercy of every idle timeout between
 * here and the browser. The client's parser ignores non-`data:` frames.
 */
const HEARTBEAT_MS = 15_000;

const bodySchema = z.object({
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

function sseChunk(data: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const tenantId = (session.user as Record<string, unknown>)['tenantId'];
  if (typeof tenantId !== 'string') {
    return new Response(JSON.stringify({ error: 'No tenant' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Security-review finding folded in with the AI Agents pass: this route
  // used to check only session + tenant, unlike dashboard-chat. Gate on
  // the same permission the mutation it feeds enforces, and on the
  // per-tenant agent switch.
  const perms = await loadUserPermissions(db, tenantId, session.user.id);
  if (!grantsAdminAccess(perms) && !perms.includes('templates.create')) {
    return new Response(JSON.stringify({ error: 'Missing permission' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const overlay = await loadAgentOverlay(db, tenantId, 'template-drafter');
  if (!overlay.enabled) {
    return new Response(JSON.stringify({ error: 'agent-disabled' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Template generation runs Opus 4.8 with web search — the most expensive
  // AI path. Cap it tightly per user, and per tenant per day (all the AI
  // routes share the tenant-day budget).
  const rl = await rateLimit(`ai:template-chat:${session.user.id}`, { limit: 10, windowSec: 300 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);
  const tenantRl = await rateLimit(`ai:tenant-day:${tenantId}`, {
    limit: TENANT_DAILY_AI_LIMIT,
    windowSec: 86_400,
  });
  if (!tenantRl.ok) return tooManyRequests(tenantRl.retryAfterSec);

  const body = bodySchema.safeParse(await request.json());
  if (!body.success) {
    return new Response(JSON.stringify({ error: 'Bad request' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  void (async () => {
    const startedAt = Date.now();
    const log = logger.child({ route: 'ai/template-chat', userId: session.user.id, tenantId });
    // Writes race the reader going away; a failed heartbeat must not take the
    // turn down with it.
    const heartbeat = setInterval(() => {
      void writer.write(new TextEncoder().encode(': ping\n\n')).catch(() => {});
    }, HEARTBEAT_MS);

    let lastPhase: string | undefined;
    try {
      // 'other' keeps the interview question — the tenant's region is not
      // in the vocabulary, so assuming would be wrong.
      const REGION_LABEL: Record<string, string> = {
        uk: 'United Kingdom',
        ireland: 'Ireland',
        eu: 'European Union',
        us: 'United States',
      };
      const regionSetting = overlay.settings['defaultRegion'] ?? 'ask';
      const regionLabel = REGION_LABEL[regionSetting];
      const settingsLines =
        regionLabel === undefined
          ? ''
          : `Default region for regulations: ${regionLabel}. Assume it without asking, unless the user names another region.`;
      await runTemplateAgentTurn({
        messages: body.data.messages,
        systemSuffix: knowledgeSuffix(overlay, settingsLines),
        webSearch: overlay.settings['webSearch'] !== 'off',
        onEvent: (event: TemplateAgentEvent) => {
          if (event.type === 'progress') lastPhase = event.phase;
          void writer.write(sseChunk(event));
        },
      });
      await writer.write(sseChunk({ type: 'done' }));
      // A grounded turn has been measured at nearly three minutes. Without a
      // duration in the logs the only way to tell "slow" from "hung" after a
      // user reports it is to reconstruct it from proxy timings.
      log.info({ ms: Date.now() - startedAt, lastPhase }, 'template-chat turn finished');
    } catch (err) {
      log.error({ err, ms: Date.now() - startedAt, lastPhase }, 'template-chat turn failed');
      void writer.write(
        sseChunk({ type: 'error', message: err instanceof Error ? err.message : 'Unknown error' }),
      );
    } finally {
      clearInterval(heartbeat);
      await writer.close();
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
