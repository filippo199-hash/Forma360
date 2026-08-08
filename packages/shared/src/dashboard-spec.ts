/**
 * Dashboard spec Zod schema (ADR 0018).
 *
 * Stored at `dashboards.spec` and validated at every boundary: the AI
 * builder's proposeDashboard tool output, `dashboards.create` /
 * `dashboards.updateSpec` inputs, the web renderer, and the PDF print
 * route. Schema version travels on the root so v2 can land without
 * migrating historical rows (the ADR 0009 pattern).
 *
 * A spec is presentation + references only — widget ids, titles, chart
 * hints, and (source, metric, dimension) references into the bounded
 * catalogue in `dashboard-sources.ts`. It contains no queries and no
 * data; the query engine resolves references tenant-scoped at read time.
 *
 * Edge-case IDs DH-E01..E10 (docs/edge-cases.html) are enforced here and
 * exercised by `dashboard-spec.test.ts`.
 */
import { z } from 'zod';
import {
  DASHBOARD_SOURCE_IDS,
  DASHBOARD_SOURCES,
  metricAllowsDimension,
  sourceDimension,
  sourceMetric,
  type DashboardSourceId,
} from './dashboard-sources';

// ─── Constants ──────────────────────────────────────────────────────────────

export const DASHBOARD_SPEC_VERSION = '1' as const;

export const DASHBOARD_LIMITS = {
  MAX_WIDGETS: 24,
  MAX_TITLE_LENGTH: 120,
  MAX_WIDGET_FILTERS: 8,
  MAX_FILTER_VALUES: 50,
  /** Top-N cap for breakdown charts and tables. */
  MAX_GROUP_LIMIT: 100,
  /** Series cap when a timeseries is split by a dimension. */
  MAX_SPLIT_SERIES: 8,
} as const;

// ─── Primitives ─────────────────────────────────────────────────────────────

const ulid = z.string().length(26);

/**
 * Widget ids are AI-authored slugs ("open-actions-by-site"), not ULIDs:
 * they show up in Excel filenames, anchors, and refine-chat references,
 * so being human-readable is a feature.
 */
const widgetId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'Widget id must be a short lowercase slug');

const widgetTitle = z.string().min(1).max(DASHBOARD_LIMITS.MAX_TITLE_LENGTH);

const sourceId = z.enum(DASHBOARD_SOURCE_IDS);

// Calendar-strict: the regex alone accepts "2026-06-31" / "2026-13-01",
// which then either roll over silently (wrong window) or become Invalid
// Date and crash the executor's range maths. The UTC round-trip rejects
// any string that is not a real day.
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be an ISO date (YYYY-MM-DD)')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Must be a real calendar date (YYYY-MM-DD)');

// ─── Global filters ─────────────────────────────────────────────────────────

export const DATE_RANGE_PRESETS = [
  'last7d',
  'last30d',
  'last90d',
  'last12m',
  'thisMonth',
  'thisQuarter',
  'thisYear',
] as const;

export type DateRangePreset = (typeof DATE_RANGE_PRESETS)[number];

const dateRangeSchema = z.union([
  z.enum(DATE_RANGE_PRESETS),
  z
    .object({ from: isoDate, to: isoDate })
    .refine((r) => r.from <= r.to, { message: 'Date range: from must not be after to' }),
]);

/** Exported for the router's view-time filter overrides. */
export const dashboardDateRangeSchema = dateRangeSchema;

export type DashboardDateRange = z.infer<typeof dateRangeSchema>;

/**
 * Defaults the dashboard opens with. The viewer can override both from
 * the filter bar at read time; overrides are never written back here.
 */
const filterDefaultsSchema = z.object({
  dateRange: dateRangeSchema.default('last30d'),
  siteIds: z.array(ulid).max(50).default([]),
});

// ─── Widgets ────────────────────────────────────────────────────────────────

const widgetFilterSchema = z.object({
  dimension: z.string().min(1).max(40),
  /** Dimension values to keep (an OR set). Site/user/template dimensions
   *  carry ids; enum dimensions carry the enum values. */
  values: z.array(z.string().min(1).max(64)).min(1).max(DASHBOARD_LIMITS.MAX_FILTER_VALUES),
});

export type DashboardWidgetFilter = z.infer<typeof widgetFilterSchema>;

const widgetBase = {
  id: widgetId,
  title: widgetTitle,
  source: sourceId,
  filters: z.array(widgetFilterSchema).max(DASHBOARD_LIMITS.MAX_WIDGET_FILTERS).default([]),
  /** Grid columns (of 3) the widget spans. Renderer defaults per kind. */
  span: z.number().int().min(1).max(3).optional(),
};

const kpiWidgetSchema = z.object({
  ...widgetBase,
  kind: z.literal('kpi'),
  metric: z.string().min(1).max(40),
  /** Show a delta vs the previous period of equal length (flow metrics only). */
  compare: z.boolean().default(false),
});

const timeseriesWidgetSchema = z.object({
  ...widgetBase,
  kind: z.literal('timeseries'),
  metric: z.string().min(1).max(40),
  bucket: z.enum(['day', 'week', 'month']).default('week'),
  chart: z.enum(['line', 'bar', 'area']).default('line'),
  /** Optional dimension to split into one series per value (top N). */
  splitBy: z.string().min(1).max(40).optional(),
});

const breakdownWidgetSchema = z.object({
  ...widgetBase,
  kind: z.literal('breakdown'),
  metric: z.string().min(1).max(40),
  dimension: z.string().min(1).max(40),
  chart: z.enum(['column', 'bar', 'donut']).default('column'),
  limit: z.number().int().min(1).max(DASHBOARD_LIMITS.MAX_GROUP_LIMIT).default(10),
});

/**
 * Tables are GROUPED aggregates (dimension rows × metric columns), never
 * raw records. That single decision is what keeps per-record access
 * control (confidential incidents, unpublished packs…) out of the
 * dashboard layer entirely — drill-down happens through links into the
 * module registers, which enforce their own gates.
 */
const tableWidgetSchema = z.object({
  ...widgetBase,
  kind: z.literal('table'),
  dimension: z.string().min(1).max(40),
  metrics: z.array(z.string().min(1).max(40)).min(1).max(5),
  limit: z.number().int().min(1).max(DASHBOARD_LIMITS.MAX_GROUP_LIMIT).default(20),
});

const widgetSchema = z.discriminatedUnion('kind', [
  kpiWidgetSchema,
  timeseriesWidgetSchema,
  breakdownWidgetSchema,
  tableWidgetSchema,
]);

export type DashboardWidget = z.infer<typeof widgetSchema>;
export type DashboardWidgetKind = DashboardWidget['kind'];

// ─── Spec root ──────────────────────────────────────────────────────────────

export const dashboardSpecSchema = z
  .object({
    version: z.literal(DASHBOARD_SPEC_VERSION),
    widgets: z.array(widgetSchema).min(1).max(DASHBOARD_LIMITS.MAX_WIDGETS),
    filterDefaults: filterDefaultsSchema.default({}),
  })
  .superRefine((spec, ctx) => {
    const seen = new Set<string>();
    spec.widgets.forEach((widget, index) => {
      const path = ['widgets', index];

      // DH-E01: widget ids unique across the dashboard.
      if (seen.has(widget.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: `Duplicate widget id "${widget.id}"`,
        });
      }
      seen.add(widget.id);

      const source = DASHBOARD_SOURCES[widget.source as DashboardSourceId];

      // DH-E02: every metric reference must exist on the source.
      const metricIds = widget.kind === 'table' ? widget.metrics : [widget.metric];
      for (const metricId of metricIds) {
        const metric = sourceMetric(source, metricId);
        if (!metric) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path,
            message: `Source "${source.id}" has no metric "${metricId}"`,
          });
          continue;
        }
        // DH-E04: stock metrics have no event date — a timeseries over
        // one is meaningless and refused rather than silently wrong.
        if (widget.kind === 'timeseries' && metric.kind === 'stock') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path,
            message: `Metric "${metricId}" is a point-in-time count and cannot be plotted over time`,
          });
        }
        // DH-E07: compare deltas only make sense for flow metrics.
        if (widget.kind === 'kpi' && widget.compare && metric.kind === 'stock') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path,
            message: `Metric "${metricId}" is a point-in-time count and cannot be compared to a previous period`,
          });
        }
      }

      // DH-E03: every dimension reference must exist on the source, and
      // (DH-E03b) be applicable to every metric the widget uses — some
      // metrics count a different table than their siblings.
      const dimensionIds: string[] = [];
      if (widget.kind === 'breakdown' || widget.kind === 'table') {
        dimensionIds.push(widget.dimension);
      }
      if (widget.kind === 'timeseries' && widget.splitBy) {
        dimensionIds.push(widget.splitBy);
      }
      for (const dimensionId of dimensionIds) {
        if (!sourceDimension(source, dimensionId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path,
            message: `Source "${source.id}" has no dimension "${dimensionId}"`,
          });
          continue;
        }
        for (const metricId of metricIds) {
          const metric = sourceMetric(source, metricId);
          if (metric && !metricAllowsDimension(metric, dimensionId)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path,
              message: `Metric "${metricId}" cannot be broken down by "${dimensionId}"`,
            });
          }
        }
      }

      // DH-E05: widget filters must reference declared dimensions — and
      // (DH-E05b) dimensions the widget's metric can actually use. A filter
      // on a metric-disallowed dimension would otherwise pin the widget to
      // a permanent silent zero (the executor narrows it to `false`).
      for (const filter of widget.filters) {
        if (!sourceDimension(source, filter.dimension)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path,
            message: `Filter references unknown dimension "${filter.dimension}" on source "${source.id}"`,
          });
          continue;
        }
        for (const metricId of metricIds) {
          const metric = sourceMetric(source, metricId);
          if (metric && !metricAllowsDimension(metric, filter.dimension)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path,
              message: `Metric "${metricId}" cannot be filtered by "${filter.dimension}"`,
            });
          }
        }
      }
    });
  });

export type DashboardSpec = z.infer<typeof dashboardSpecSchema>;

// ─── Parse helper ───────────────────────────────────────────────────────────

export type ParseDashboardSpecResult =
  | { ok: true; spec: DashboardSpec }
  | { ok: false; errors: string[] };

/**
 * Boundary parse with human-readable errors — the error strings are fed
 * straight back to the AI builder as an `is_error` tool result in the
 * correction loop, so they must say what is wrong AND where.
 */
export function parseDashboardSpec(value: unknown): ParseDashboardSpecResult {
  const parsed = dashboardSpecSchema.safeParse(value);
  if (parsed.success) return { ok: true, spec: parsed.data };
  const errors = parsed.error.issues.map((issue) => {
    const where = issue.path.length > 0 ? issue.path.join('.') : 'spec';
    return `${where}: ${issue.message}`;
  });
  return { ok: false, errors };
}

/** Renderer default: how many grid columns (of 3) a widget occupies. */
export function widgetSpan(widget: DashboardWidget): number {
  if (widget.span !== undefined) return widget.span;
  switch (widget.kind) {
    case 'kpi':
      return 1;
    case 'timeseries':
      return 2;
    case 'breakdown':
      return 1;
    case 'table':
      return 2;
  }
}
