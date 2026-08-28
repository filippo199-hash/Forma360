/**
 * AI dashboard-builder agent (ADR 0018).
 *
 * A dashboard designer that turns "build me a dashboard about permits"
 * into a validated {@link DashboardSpec} via the `proposeDashboard` tool.
 * The same agent powers first-draft creation AND the refine chat on an
 * existing dashboard ("use columns instead of a line") — refinement just
 * seeds the conversation with the current spec and asks for a full
 * replacement.
 *
 * The model composes ONLY from the caller-scoped source catalogue that
 * the route injects (brand-gated + permission-filtered server-side). It
 * never writes queries; an invalid or out-of-catalogue spec is fed back
 * as an `is_error` tool result for self-correction (bounded), so the
 * user never sees a schema error.
 *
 * Like the template agent, the conversation is ephemeral: the client
 * holds the history and sends it back each turn.
 */
import Anthropic from '@anthropic-ai/sdk';
import {
  DASHBOARD_LIMITS,
  DATE_RANGE_PRESETS,
  parseDashboardSpec,
  type DashboardSpec,
} from '@forma360/shared/dashboard-spec';
import type { DashboardSource } from '@forma360/shared/dashboard-sources';
import { activeBrand } from '../lib/brand';
import { env } from './env';

export interface DashboardAgentSite {
  id: string;
  name: string;
}

export interface DashboardAgentContext {
  /** Already brand-gated + permission-filtered for THIS user. */
  sources: readonly DashboardSource[];
  /** Active sites for name → id resolution in filters. */
  sites: readonly DashboardAgentSite[];
  /** Present when refining an existing dashboard. */
  currentSpec?: DashboardSpec | null;
  currentTitle?: string | null;
}

function catalogueBlock(sources: readonly DashboardSource[]): string {
  return sources
    .map((source) => {
      const metrics = source.metrics
        .map((m) => {
          const dims =
            m.dimensions !== undefined
              ? ` (dimensions limited to: ${m.dimensions.join(', ')})`
              : '';
          return `    - ${m.id} [${m.kind}]: ${m.label}${dims}`;
        })
        .join('\n');
      const dims =
        source.dimensions.length > 0
          ? source.dimensions.map((d) => `${d.id} (${d.label})`).join(', ')
          : 'none';
      return `- source "${source.id}" — ${source.label}: ${source.description}\n  metrics:\n${metrics}\n  dimensions: ${dims}\n  site-scoped: ${source.siteScoped ? 'yes' : 'no'}`;
    })
    .join('\n');
}

function buildSystemPrompt(context: DashboardAgentContext): string {
  const sitesBlock =
    context.sites.length > 0
      ? context.sites.map((s) => `- ${s.name} (id: ${s.id})`).join('\n')
      : '(no sites configured)';

  const refineBlock =
    context.currentSpec != null
      ? `\n\nREFINE MODE — the user is editing an existing dashboard titled ${JSON.stringify(
          context.currentTitle ?? 'Dashboard',
        )}. Its current spec is:\n${JSON.stringify(context.currentSpec, null, 2)}\nWhen the user asks for a change, call proposeDashboard with the FULL updated widget list — never a partial diff. Keep every widget the user did not mention byte-identical (same ids, titles, everything); change only what they asked for. Keep widget ids stable so their download history and links survive.`
      : '';

  return `You are an expert dashboard designer for ${activeBrand.name}, a safety & operations platform. You turn a short conversation into a working analytics dashboard by calling the proposeDashboard tool.

THE CATALOGUE — you may ONLY reference these sources, metrics and dimensions (anything else is rejected by the platform):
${catalogueBlock(context.sources)}

Metric kinds: [flow] metrics count events inside the dashboard's date range (plot them over time, compare periods). [stock] metrics are a live state count (open, overdue, in force) — the date range does NOT apply to them, they cannot be plotted over time, and compare is not available.

Sites in this workspace (for site filters — always use the id, never the name):
${sitesBlock}

How you work:
1. Lean toward proposing IMMEDIATELY. The dashboard is fully refinable afterwards in this same chat, so a solid first draft beats a questionnaire. Ask a clarifying question ONLY when the request is genuinely ambiguous about what data matters — and never more than one short message of questions.
2. When you decide to build, call proposeDashboard in that SAME turn. You may write one short sentence first ("Building that now…"), but never end a turn promising to build without calling the tool.
3. If the user asks for data the catalogue does not have, say so plainly and offer the closest real thing — never invent a source or metric.

Designing a good dashboard:
- Structure: start with 3–5 KPI tiles answering "how are we doing right now" (mix stocks like open/overdue with flow counts using compare: true), then 1–2 timeseries for trend, then breakdowns, then at most one comparison table. ${String(DASHBOARD_LIMITS.MAX_WIDGETS)} widgets max; 6–10 is the sweet spot.
- Charts: line for trends over time, column for comparing categories, bar for long category names, donut ONLY for 2–6 slices of a whole. A timeseries can splitBy a dimension (top ${String(DASHBOARD_LIMITS.MAX_SPLIT_SERIES)} series).
- Layout: span 1 for KPIs, 2 for charts, 3 for full-width tables (a 3-column grid).
- Titles: write widget titles and the dashboard title in the USER'S language, short and specific ("Overdue actions by site", not "Chart 1").
- Site-specific dashboards: when the user names a site, resolve it from the list above and set it in siteIds (dashboard default filter) — or as a widget filter when only one widget should be scoped.
- Date range: pick the preset that fits the request (${DATE_RANGE_PRESETS.join(', ')}) or a custom {from, to}; default last30d.
- Filters on widgets use dimension values: enum dimensions take their raw values (e.g. status "open"), site/assignee/template/type dimensions take ids.

Be warm and brief. Don't narrate what the tool does.${refineBlock}`;
}

/**
 * The single tool the builder emits. Mirrors the dashboard spec schema;
 * the platform validates with Zod and feeds errors back for correction.
 */
function proposeDashboardTool(context: DashboardAgentContext): Anthropic.Tool {
  const sourceIds = context.sources.map((s) => s.id);
  return {
    name: 'proposeDashboard',
    description:
      'Emit the finished dashboard (or the FULL updated dashboard when refining). The platform validates it and renders it for the user.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: "Dashboard title, in the user's language." },
        description: { type: 'string', description: 'One-line description (optional).' },
        dateRange: {
          description:
            'Default date range: one of the presets, or {from, to} as YYYY-MM-DD strings.',
          oneOf: [
            { type: 'string', enum: [...DATE_RANGE_PRESETS] },
            {
              type: 'object',
              properties: {
                from: { type: 'string', description: 'YYYY-MM-DD' },
                to: { type: 'string', description: 'YYYY-MM-DD' },
              },
              required: ['from', 'to'],
            },
          ],
        },
        siteIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Default site filter — site IDS from the workspace list, never names.',
        },
        widgets: {
          type: 'array',
          description: 'The widgets, in display order.',
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description:
                  'Short lowercase slug unique in this dashboard, e.g. "overdue-actions". Keep ids stable across refinements.',
              },
              kind: { type: 'string', enum: ['kpi', 'timeseries', 'breakdown', 'table'] },
              title: { type: 'string', description: "Widget title, in the user's language." },
              source: { type: 'string', enum: sourceIds },
              metric: {
                type: 'string',
                description: 'Metric id (kpi / timeseries / breakdown). Omit for table.',
              },
              metrics: {
                type: 'array',
                items: { type: 'string' },
                description: 'Table only: 1–5 metric ids, the table columns.',
              },
              dimension: {
                type: 'string',
                description: 'Breakdown/table: the dimension to group by.',
              },
              splitBy: {
                type: 'string',
                description: 'Timeseries only (optional): dimension to split into series.',
              },
              bucket: {
                type: 'string',
                enum: ['day', 'week', 'month'],
                description: 'Timeseries granularity (default week).',
              },
              chart: {
                type: 'string',
                enum: ['line', 'bar', 'area', 'column', 'donut'],
                description:
                  'Chart style: line/bar/area for timeseries; column/bar/donut for breakdown.',
              },
              compare: {
                type: 'boolean',
                description: 'KPI + flow metric only: show delta vs the previous period.',
              },
              limit: {
                type: 'number',
                description: 'Breakdown/table: top-N rows (default 10/20).',
              },
              span: { type: 'number', enum: [1, 2, 3], description: 'Grid columns (of 3).' },
              filters: {
                type: 'array',
                description: 'Optional widget-level filters.',
                items: {
                  type: 'object',
                  properties: {
                    dimension: { type: 'string' },
                    values: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'Dimension values to keep (ids for site/assignee/etc.).',
                    },
                  },
                  required: ['dimension', 'values'],
                },
              },
            },
            required: ['id', 'kind', 'title', 'source'],
          },
        },
      },
      required: ['title', 'widgets'],
    },
  };
}

/** Map the tool payload into a spec candidate for Zod validation. */
function toSpecCandidate(input: unknown): {
  title: string;
  description: string | null;
  candidate: Record<string, unknown>;
} {
  const raw = (input ?? {}) as Record<string, unknown>;
  const widgets = Array.isArray(raw['widgets'])
    ? (raw['widgets'] as Array<Record<string, unknown>>).map((w) => {
        // Strip nulls the model sometimes emits for optional fields.
        const clean: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(w)) {
          if (value !== null && value !== undefined) clean[key] = value;
        }
        return clean;
      })
    : [];
  const filterDefaults: Record<string, unknown> = {};
  if (raw['dateRange'] !== undefined && raw['dateRange'] !== null) {
    filterDefaults['dateRange'] = raw['dateRange'];
  }
  if (Array.isArray(raw['siteIds'])) filterDefaults['siteIds'] = raw['siteIds'];
  return {
    title: typeof raw['title'] === 'string' && raw['title'].length > 0 ? raw['title'] : 'Dashboard',
    description: typeof raw['description'] === 'string' ? raw['description'] : null,
    candidate: { version: '1', widgets, filterDefaults },
  };
}

/** Events streamed to the browser over SSE while a turn runs. */
export type DashboardAgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'assistant_done'; text: string }
  | { type: 'building_started' }
  | {
      type: 'proposal';
      spec: DashboardSpec;
      title: string;
      description: string | null;
      note: string;
    };

export interface DashboardAgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function runDashboardAgentTurn(input: {
  messages: DashboardAgentMessage[];
  context: DashboardAgentContext;
  onEvent: (event: DashboardAgentEvent) => void;
  /** Per-tenant overlay (AI Agents): knowledge + settings prompt suffix. */
  systemSuffix?: string;
}): Promise<void> {
  const { onEvent, context } = input;
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const tool = proposeDashboardTool(context);
  const allowedSources = new Set(context.sources.map((s) => s.id));

  const messages: Anthropic.MessageParam[] = input.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let assistantText = '';
  let corrections = 0;
  let signalledBuilding = false;

  while (true) {
    assistantText = '';
    const stream = client.messages.stream({
      model: 'claude-opus-5',
      max_tokens: 16000,
      system: buildSystemPrompt(context) + (input.systemSuffix ?? ''),
      tools: [tool],
      messages,
    });

    stream.on('text', (text) => {
      assistantText += text;
      onEvent({ type: 'text', delta: text });
    });

    stream.on('streamEvent', (event) => {
      if (
        !signalledBuilding &&
        event.type === 'content_block_start' &&
        event.content_block.type === 'tool_use' &&
        event.content_block.name === 'proposeDashboard'
      ) {
        signalledBuilding = true;
        onEvent({ type: 'building_started' });
      }
    });

    const finalMsg = await stream.finalMessage();

    if (finalMsg.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: finalMsg.content });
      continue;
    }

    if (finalMsg.stop_reason !== 'tool_use') {
      onEvent({ type: 'assistant_done', text: assistantText });
      return;
    }

    const proposeBlock = finalMsg.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'proposeDashboard',
    );
    if (proposeBlock === undefined) {
      onEvent({ type: 'assistant_done', text: assistantText });
      return;
    }

    const { title, description, candidate } = toSpecCandidate(proposeBlock.input);
    const parsed = parseDashboardSpec(candidate);
    const sourceErrors = parsed.ok
      ? parsed.spec.widgets
          .filter((w) => !allowedSources.has(w.source))
          .map((w) => `widget "${w.id}": source "${w.source}" is not available in this workspace`)
      : [];

    if (parsed.ok && sourceErrors.length === 0) {
      onEvent({ type: 'proposal', spec: parsed.spec, title, description, note: assistantText });
      return;
    }

    corrections += 1;
    const errors = parsed.ok ? sourceErrors : parsed.errors;
    if (corrections > 2) {
      throw new Error(`Could not produce a valid dashboard: ${errors.join('; ')}`);
    }
    messages.push({ role: 'assistant', content: finalMsg.content });
    messages.push({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: proposeBlock.id,
          content: `The dashboard spec was invalid: ${errors.join('; ')}. Call proposeDashboard again with a corrected spec. Remember: only sources, metrics and dimensions from the catalogue in your instructions exist.`,
          is_error: true,
        },
      ],
    });
  }
}
