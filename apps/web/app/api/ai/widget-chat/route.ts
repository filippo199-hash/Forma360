/**
 * SSE endpoint for the per-widget AI chat (ADR 0018 follow-up).
 *
 * The chat is tagged to ONE widget. The server resolves that widget's
 * data through the gated `dashboards.widgetData` tRPC procedure (which
 * enforces the customDashboards entitlement, analytics.view, the
 * dashboard visibility matrix and the per-source viewer gate), then hands
 * the widget definition + its current data to the grounded chat agent.
 * The model never sees anything the interactive widget would not show
 * this user.
 */
import {
  DASHBOARD_SOURCES,
  type DashboardSourceId,
} from '@forma360/shared/dashboard-sources';
import { dashboardDateRangeSchema } from '@forma360/shared/dashboard-spec';
import { headers } from 'next/headers';
import { z } from 'zod';
import { auth } from '../../../../src/server/auth';
import { createServerCaller } from '../../../../src/server/server-caller';
import { rateLimit, tooManyRequests } from '../../../../src/server/rate-limit';
import {
  runWidgetChatTurn,
  type WidgetChatEvent,
} from '../../../../src/server/widget-chat-agent';

const bodySchema = z.object({
  dashboardId: z.string().length(26),
  widgetId: z.string().min(1).max(40),
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(8000),
      }),
    )
    .min(1)
    .max(30),
  filters: z
    .object({
      dateRange: dashboardDateRangeSchema.optional(),
      siteIds: z.array(z.string().length(26)).max(50).optional(),
    })
    .optional(),
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

  const rl = await rateLimit(`ai:widget-chat:${session.user.id}`, { limit: 20, windowSec: 300 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return jsonError(400, 'Bad request');
  const { dashboardId, widgetId, messages, filters } = body.data;

  // Resolve the dashboard + this widget's data through the gated procedures.
  // Any refusal (entitlement / permission / visibility / per-source) throws
  // here and becomes the client's error — the model is never reached.
  const caller = await createServerCaller({
    tenantId,
    userId: session.user.id,
    email: session.user.email,
  });

  let dashboard: Awaited<ReturnType<typeof caller.dashboards.get>>;
  let widgetResult: Awaited<ReturnType<typeof caller.dashboards.widgetData>>;
  try {
    dashboard = await caller.dashboards.get({ id: dashboardId });
    widgetResult = await caller.dashboards.widgetData({
      id: dashboardId,
      widgetId,
      ...(filters !== undefined ? { filters } : {}),
    });
  } catch (err) {
    const code =
      err !== null && typeof err === 'object' && 'code' in err
        ? String((err as { code: unknown }).code)
        : 'INTERNAL';
    const status =
      code === 'NOT_FOUND'
        ? 404
        : code === 'FORBIDDEN'
          ? 403
          : code === 'PAYMENT_REQUIRED'
            ? 402
            : 400;
    return jsonError(status, code);
  }

  const widget = dashboard.spec?.widgets.find((w) => w.id === widgetId);
  if (widget === undefined) return jsonError(404, 'Widget not found');
  const sourceLabel =
    DASHBOARD_SOURCES[widget.source as DashboardSourceId]?.label ?? widget.source;

  const applied = widgetResult.applied;
  const filtersSummary = `The data covers ${applied.range.from.slice(0, 10)} to ${applied.range.to.slice(
    0,
    10,
  )}${applied.siteIds.length > 0 ? ` and is filtered to ${applied.siteIds.length} site(s)` : ' across all sites'}.`;

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  void (async () => {
    try {
      await runWidgetChatTurn({
        messages,
        context: {
          dashboardTitle: dashboard.title,
          widgetTitle: widget.title,
          sourceLabel,
          widgetJson: widget,
          dataJson: widgetResult.data,
          filtersSummary,
        },
        onEvent: (event: WidgetChatEvent) => {
          void writer.write(sseChunk(event));
        },
      });
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
