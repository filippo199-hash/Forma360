/**
 * SSE endpoint for the AI dashboard builder / refine chat (ADR 0018).
 *
 * The server assembles the agent context — the caller-scoped source
 * catalogue (brand-gated then permission-filtered), the tenant's sites,
 * and the current spec when refining — so the model can only ever see
 * and reference what this user may use. Paid-plan gated like the
 * dashboards router.
 */
import { grantsAdminAccess } from '@forma360/permissions/catalogue';
import { loadUserPermissions } from '@forma360/permissions/requirePermission';
import { tenants, sites } from '@forma360/db/schema';
import { parseDashboardSpec } from '@forma360/shared/dashboard-spec';
import { availableDashboardSources } from '@forma360/shared/dashboard-sources';
import { BRAND_MODULES } from '@forma360/shared/brand';
import { settingsHaveEntitlement } from '@forma360/shared/entitlements';
import { knowledgeSuffix, loadAgentOverlay } from '../../../../src/server/agent-overlay';
import { and, eq, isNull } from 'drizzle-orm';
import { headers } from 'next/headers';
import { z } from 'zod';
import { activeBrand } from '../../../../src/lib/brand';
import { auth } from '../../../../src/server/auth';
import {
  runDashboardAgentTurn,
  type DashboardAgentEvent,
} from '../../../../src/server/dashboard-agent';
import { db } from '../../../../src/server/db';
import { rateLimit, tooManyRequests } from '../../../../src/server/rate-limit';

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
  /** Present when refining an existing dashboard. */
  currentSpec: z.unknown().optional(),
  currentTitle: z.string().max(200).optional(),
});

function sseChunk(data: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  if (!session) return jsonError(401, 'Unauthorized');

  const tenantId = (session.user as Record<string, unknown>)['tenantId'];
  if (typeof tenantId !== 'string') return jsonError(403, 'No tenant');

  // Paid-plan gate — mirrors requireEntitlement('customDashboards').
  const tenantRows = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!settingsHaveEntitlement(tenantRows[0]?.settings, 'customDashboards')) {
    return jsonError(402, 'entitlement-required');
  }
  const overlay = await loadAgentOverlay(db, tenantId, 'dashboard-builder');
  if (!overlay.enabled) {
    return jsonError(403, 'agent-disabled');
  }

  const permissions = await loadUserPermissions(db, tenantId, session.user.id);
  const admin = grantsAdminAccess(permissions);
  if (!admin && !permissions.includes('analytics.create')) {
    return jsonError(403, 'Missing permission: analytics.create');
  }

  const rl = await rateLimit(`ai:dashboard-chat:${session.user.id}`, {
    limit: 10,
    windowSec: 300,
  });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return jsonError(400, 'Bad request');

  const sources = availableDashboardSources({
    brandModules: BRAND_MODULES[activeBrand.id],
    permissions,
    grantsAdmin: admin,
  });
  if (sources.length === 0) return jsonError(403, 'No dashboard sources available');

  const siteRows = await db
    .select({ id: sites.id, name: sites.name })
    .from(sites)
    .where(and(eq(sites.tenantId, tenantId), isNull(sites.archivedAt)))
    .limit(100);

  // A malformed currentSpec (old schema version, tampering) is ignored
  // rather than fatal — the agent then behaves as a fresh build.
  const currentSpecParse =
    body.data.currentSpec !== undefined ? parseDashboardSpec(body.data.currentSpec) : null;

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  void (async () => {
    try {
      const RANGE_LABEL: Record<string, string> = {
        last7d: 'the last 7 days',
        last30d: 'the last 30 days',
        last12m: 'the last 12 months',
        thisQuarter: 'this quarter',
      };
      const rangeLabel = RANGE_LABEL[overlay.settings['defaultDateRange'] ?? ''];
      await runDashboardAgentTurn({
        systemSuffix: knowledgeSuffix(
          overlay,
          rangeLabel === undefined
            ? ''
            : `Unless the user asks for a period, default every dashboard's date range to ${rangeLabel}.`,
        ),
        messages: body.data.messages,
        context: {
          sources,
          sites: siteRows,
          currentSpec: currentSpecParse?.ok === true ? currentSpecParse.spec : null,
          currentTitle: body.data.currentTitle ?? null,
        },
        onEvent: (event: DashboardAgentEvent) => {
          void writer.write(sseChunk(event));
        },
      });
      await writer.write(sseChunk({ type: 'done' }));
    } catch (err) {
      void writer.write(
        sseChunk({ type: 'error', message: err instanceof Error ? err.message : 'Unknown error' }),
      );
    } finally {
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
