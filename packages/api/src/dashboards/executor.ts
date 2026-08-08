/**
 * Dashboard widget query engine (ADR 0018).
 *
 * Executes ONE widget of a validated dashboard spec against the tenant's
 * data. The AI never writes queries — a widget is a (source, metric,
 * dimension) reference into the catalogue in
 * `@forma360/shared/dashboard-sources`, and this file is the only place
 * those references become SQL.
 *
 * Every metric definition here mirrors the predicate its module already
 * uses (the analytics router, the module register, or the shared domain
 * helper) so the dashboard and the register never disagree on what
 * "open" or "overdue" means. Where a module has no clean event column
 * (heads-up publishes), the approximation is documented inline.
 *
 * Grain rules:
 *   - flow metrics count events inside the resolved date range on their
 *     event column; stock metrics count current state and ignore the
 *     range (the result says which was applied).
 *   - buckets are UTC (date_trunc in the DB session zone, which is UTC
 *     in prod and pglite); weeks start Monday (ISO).
 *   - grouped results are aggregates only — never record rows — so
 *     per-record access control stays in the module registers.
 *
 * The DH-E21 completeness test walks every catalogue metric × dimension
 * through this executor; a catalogue entry without a mapping here fails
 * the suite.
 */
import {
  actionTypes,
  actions,
  coshhAssessments,
  coshhSubstances,
  fireBuildings,
  fireLogbookChecks,
  fireLogbookEntries,
  headsUpRecipients,
  headsUps,
  incidents,
  inspections,
  issueCategories,
  issues,
  permitTypes,
  permits,
  ramsBriefings,
  ramsPackVersions,
  ramsPacks,
  riskAssessments,
  scheduledInspectionOccurrences,
  sites,
  templates,
  trainingRecords,
  user,
} from '@forma360/db/schema';
import {
  DASHBOARD_LIMITS,
  type DashboardDateRange,
  type DashboardWidget,
} from '@forma360/shared/dashboard-spec';
import {
  DASHBOARD_SOURCES,
  sourceMetric,
  type DashboardSourceId,
} from '@forma360/shared/dashboard-sources';
import {
  and,
  count,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notInArray,
  sql,
  type SQL,
  type SQLWrapper,
} from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Context } from '../context';

type Db = Context['db'];

const DAY_MS = 86_400_000;

/** Bucket key for rows whose dimension value is NULL ("No site" etc.). */
export const NONE_BUCKET = '__none';
/** Bucket key for series collapsed beyond MAX_SPLIT_SERIES. */
export const OTHER_BUCKET = '__other';

// ─── Result shapes ──────────────────────────────────────────────────────────

export interface ResolvedRange {
  /** Inclusive start, ISO instant. */
  from: string;
  /** Exclusive end, ISO instant. */
  to: string;
}

export interface WidgetMeta {
  /** Whether the date range constrained this widget (flow metrics only). */
  dateRangeApplied: boolean;
  /** Whether the global site filter constrained this widget. */
  siteFilterApplied: boolean;
  /** The concrete range flow metrics were evaluated over. */
  range: ResolvedRange;
  /**
   * Set on a timeseries whose bucket span exceeded MAX_BUCKETS: the chart
   * (and `range`) cover only the earliest window that fits, and the client
   * should tell the viewer to coarsen the bucket or shorten the range.
   * Never silently claim the full period was shown.
   */
  truncated?: boolean;
}

export interface KpiResult {
  kind: 'kpi';
  value: number;
  /** Present when the widget asked for a previous-period comparison. */
  previous?: number;
  meta: WidgetMeta;
}

export interface TimeseriesResult {
  kind: 'timeseries';
  /** ISO date (YYYY-MM-DD) label of each bucket's start, oldest first. */
  buckets: string[];
  series: Array<{ key: string; label: string | null; values: number[] }>;
  meta: WidgetMeta;
}

export interface BreakdownResult {
  kind: 'breakdown';
  rows: Array<{ key: string; label: string | null; value: number }>;
  meta: WidgetMeta;
}

export interface TableResult {
  kind: 'table';
  metrics: Array<{ id: string; label: string }>;
  rows: Array<{ key: string; label: string | null; values: number[] }>;
  meta: WidgetMeta;
}

export type WidgetData = KpiResult | TimeseriesResult | BreakdownResult | TableResult;

// ─── Date-range resolution ──────────────────────────────────────────────────

export interface GlobalFilters {
  dateRange: DashboardDateRange;
  siteIds: readonly string[];
}

function startOfUtcDay(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

/** Resolve a preset or custom range to [from, to) instants. */
export function resolveDateRange(range: DashboardDateRange, now: Date): { from: Date; to: Date } {
  const today = startOfUtcDay(now);
  const tomorrow = new Date(today.getTime() + DAY_MS);
  if (typeof range !== 'string') {
    const from = new Date(`${range.from}T00:00:00.000Z`);
    const to = new Date(new Date(`${range.to}T00:00:00.000Z`).getTime() + DAY_MS);
    return { from, to };
  }
  switch (range) {
    case 'last7d':
      return { from: new Date(tomorrow.getTime() - 7 * DAY_MS), to: tomorrow };
    case 'last30d':
      return { from: new Date(tomorrow.getTime() - 30 * DAY_MS), to: tomorrow };
    case 'last90d':
      return { from: new Date(tomorrow.getTime() - 90 * DAY_MS), to: tomorrow };
    case 'last12m': {
      const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
      return { from, to: tomorrow };
    }
    case 'thisMonth': {
      const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      return { from, to: tomorrow };
    }
    case 'thisQuarter': {
      const quarterMonth = Math.floor(now.getUTCMonth() / 3) * 3;
      const from = new Date(Date.UTC(now.getUTCFullYear(), quarterMonth, 1));
      return { from, to: tomorrow };
    }
    case 'thisYear': {
      const from = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      return { from, to: tomorrow };
    }
  }
}

/** The equal-length period immediately before [from, to). */
function previousRange(range: { from: Date; to: Date }): { from: Date; to: Date } {
  const length = range.to.getTime() - range.from.getTime();
  return { from: new Date(range.from.getTime() - length), to: range.from };
}

// ─── Metric registry ────────────────────────────────────────────────────────

/** How a dimension's raw group keys become display labels. */
type LabelKind =
  | 'enum'
  | 'site'
  | 'user'
  | 'template'
  | 'actionType'
  | 'issueCategory'
  | 'permitType'
  | 'fireBuilding';

interface DimExec {
  /** Group expression — a column, or SQL for cross-table lookups. */
  expr: PgColumn | SQL;
  labels: LabelKind;
}

interface MetricExec {
  from: PgTable;
  tenantCol: PgColumn;
  /** Event date for flow metrics: a column or SQL expression. */
  dateExpr?: PgColumn | SQL;
  /** Static predicates; `now` for stock cut-offs. */
  where?: (now: Date) => Array<SQL | undefined>;
  /** Site column when the global site filter applies. */
  siteCol?: PgColumn;
  /** Dimension executors, covering every catalogue dim this metric allows. */
  dims?: Record<string, DimExec>;
}

/** Day-precision ISO date for comparisons against pg DATE columns. */
function isoDay(at: Date): string {
  const iso = at.toISOString();
  return iso.slice(0, 10);
}

const actionDims: Record<string, DimExec> = {
  status: { expr: actions.status, labels: 'enum' },
  site: { expr: actions.siteId, labels: 'site' },
  assignee: { expr: actions.assigneeUserId, labels: 'user' },
  type: { expr: actions.actionTypeId, labels: 'actionType' },
};

const inspectionDims: Record<string, DimExec> = {
  template: { expr: inspections.templateId, labels: 'template' },
  site: { expr: inspections.siteId, labels: 'site' },
  status: { expr: inspections.status, labels: 'enum' },
};

const occurrenceDims: Record<string, DimExec> = {
  template: { expr: scheduledInspectionOccurrences.templateId, labels: 'template' },
  site: { expr: scheduledInspectionOccurrences.siteId, labels: 'site' },
};

const issueDims: Record<string, DimExec> = {
  category: { expr: issues.categoryId, labels: 'issueCategory' },
  site: { expr: issues.siteId, labels: 'site' },
  status: { expr: issues.status, labels: 'enum' },
};

const incidentDims: Record<string, DimExec> = {
  kind: { expr: incidents.kind, labels: 'enum' },
  severity: { expr: incidents.severity, labels: 'enum' },
  status: { expr: incidents.status, labels: 'enum' },
  site: { expr: incidents.siteId, labels: 'site' },
};

const permitDims: Record<string, DimExec> = {
  type: { expr: permits.permitTypeId, labels: 'permitType' },
  status: { expr: permits.status, labels: 'enum' },
  site: { expr: permits.siteId, labels: 'site' },
};

const raDims: Record<string, DimExec> = {
  status: { expr: riskAssessments.status, labels: 'enum' },
  site: { expr: riskAssessments.siteId, labels: 'site' },
};

/** Current pack status for version/briefing flows (status-at-event is not stored). */
const ramsVersionStatusExpr = sql`(select status from rams_packs where rams_packs.id = ${ramsPackVersions.packId})`;
const ramsBriefingStatusExpr = sql`(select status from rams_packs where rams_packs.id = ${ramsBriefings.packId})`;

/**
 * Open-action statuses — the analytics router's exact predicate; the
 * same duplication rule applies to every predicate below: copied from
 * the module's own register/analytics so numbers agree.
 */
const OPEN_ACTION_EXCLUDED = ['completed', 'cancelled'] as const;
const OPEN_INCIDENT = [
  'reported',
  'triaged',
  'investigating',
  'actions_outstanding',
  'reopened',
] as const;
const LIVE_PERMIT = ['issued', 'active', 'suspended'] as const;

const METRIC_EXECS: Record<DashboardSourceId, Record<string, MetricExec>> = {
  actions: {
    created: {
      from: actions,
      tenantCol: actions.tenantId,
      dateExpr: actions.createdAt,
      where: () => [isNull(actions.archivedAt)],
      siteCol: actions.siteId,
      dims: actionDims,
    },
    completed: {
      from: actions,
      tenantCol: actions.tenantId,
      // closedAt stamps BOTH terminal states — status guards completed-only.
      dateExpr: actions.closedAt,
      where: () => [isNull(actions.archivedAt), eq(actions.status, 'completed')],
      siteCol: actions.siteId,
      dims: actionDims,
    },
    open: {
      from: actions,
      tenantCol: actions.tenantId,
      where: () => [isNull(actions.archivedAt), notInArray(actions.status, [...OPEN_ACTION_EXCLUDED])],
      siteCol: actions.siteId,
      dims: actionDims,
    },
    overdue: {
      from: actions,
      tenantCol: actions.tenantId,
      where: (now) => [
        isNull(actions.archivedAt),
        notInArray(actions.status, [...OPEN_ACTION_EXCLUDED]),
        isNotNull(actions.dueAt),
        lt(actions.dueAt, now),
      ],
      siteCol: actions.siteId,
      dims: actionDims,
    },
  },
  inspections: {
    started: {
      from: inspections,
      tenantCol: inspections.tenantId,
      dateExpr: inspections.startedAt,
      where: () => [isNull(inspections.archivedAt)],
      siteCol: inspections.siteId,
      dims: inspectionDims,
    },
    completed: {
      from: inspections,
      tenantCol: inspections.tenantId,
      dateExpr: inspections.completedAt,
      where: () => [isNull(inspections.archivedAt), eq(inspections.status, 'completed')],
      siteCol: inspections.siteId,
      dims: inspectionDims,
    },
    missed: {
      from: scheduledInspectionOccurrences,
      tenantCol: scheduledInspectionOccurrences.tenantId,
      dateExpr: scheduledInspectionOccurrences.occurrenceAt,
      where: () => [eq(scheduledInspectionOccurrences.status, 'missed')],
      siteCol: scheduledInspectionOccurrences.siteId,
      dims: occurrenceDims,
    },
    inProgress: {
      from: inspections,
      tenantCol: inspections.tenantId,
      where: () => [isNull(inspections.archivedAt), eq(inspections.status, 'in_progress')],
      siteCol: inspections.siteId,
      dims: inspectionDims,
    },
  },
  observations: {
    raised: {
      from: issues,
      tenantCol: issues.tenantId,
      dateExpr: issues.createdAt,
      where: () => [isNull(issues.archivedAt)],
      siteCol: issues.siteId,
      dims: issueDims,
    },
    closed: {
      from: issues,
      tenantCol: issues.tenantId,
      dateExpr: issues.closedAt,
      where: () => [isNull(issues.archivedAt), eq(issues.status, 'closed')],
      siteCol: issues.siteId,
      dims: issueDims,
    },
    open: {
      from: issues,
      tenantCol: issues.tenantId,
      // Deliberately counts 'open' AND 'investigation' (analytics predicate).
      where: () => [isNull(issues.archivedAt), ne(issues.status, 'closed')],
      siteCol: issues.siteId,
      dims: issueDims,
    },
  },
  headsUp: {
    published: {
      from: headsUps,
      tenantCol: headsUps.tenantId,
      // No publish stamp exists (publishAt is a user-entered schedule time,
      // NULL for immediate publishes) — COALESCE is the documented
      // approximation until a publishedAt column lands. 'archived' is a
      // STATUS on this table and must stay countable as a past publish —
      // BUT a draft archived without ever publishing must NOT count. The
      // EXISTS is the discriminator: recipient rows are created only at
      // publish, so a never-published draft (archived or not) has none.
      dateExpr: sql`coalesce(${headsUps.publishAt}, ${headsUps.createdAt})`,
      where: () => [
        inArray(headsUps.status, ['published', 'archived']),
        sql`exists (select 1 from heads_up_recipients r where r.heads_up_id = ${headsUps.id})`,
      ],
    },
    acknowledged: {
      from: headsUpRecipients,
      tenantCol: headsUpRecipients.tenantId,
      dateExpr: headsUpRecipients.acknowledgedAt,
      where: () => [isNotNull(headsUpRecipients.acknowledgedAt)],
    },
    pendingAcks: {
      from: headsUpRecipients,
      tenantCol: headsUpRecipients.tenantId,
      // Tenant-wide version of the analytics "my pending acks" tile.
      where: () => [
        isNull(headsUpRecipients.acknowledgedAt),
        sql`exists (select 1 from heads_ups h where h.id = ${headsUpRecipients.headsUpId} and h.status = 'published' and h.require_acknowledgement = true)`,
      ],
    },
  },
  incidents: {
    reported: {
      from: incidents,
      tenantCol: incidents.tenantId,
      dateExpr: incidents.reportedAt,
      // 'cancelled' is the incidents module's soft delete.
      where: () => [ne(incidents.status, 'cancelled')],
      siteCol: incidents.siteId,
      dims: incidentDims,
    },
    open: {
      from: incidents,
      tenantCol: incidents.tenantId,
      where: () => [inArray(incidents.status, [...OPEN_INCIDENT])],
      siteCol: incidents.siteId,
      dims: incidentDims,
    },
    riddor: {
      from: incidents,
      tenantCol: incidents.tenantId,
      dateExpr: incidents.riddorScreenedAt,
      where: () => [
        ne(incidents.status, 'cancelled'),
        isNotNull(incidents.riddorCategory),
        ne(incidents.riddorCategory, 'not_reportable'),
      ],
      siteCol: incidents.siteId,
      dims: incidentDims,
    },
  },
  permits: {
    issued: {
      from: permits,
      tenantCol: permits.tenantId,
      dateExpr: permits.issuedAt,
      siteCol: permits.siteId,
      dims: permitDims,
    },
    closed: {
      from: permits,
      tenantCol: permits.tenantId,
      dateExpr: permits.closedAt,
      siteCol: permits.siteId,
      dims: permitDims,
    },
    active: {
      from: permits,
      tenantCol: permits.tenantId,
      where: () => [inArray(permits.status, [...LIVE_PERMIT])],
      siteCol: permits.siteId,
      dims: permitDims,
    },
  },
  riskAssessments: {
    created: {
      from: riskAssessments,
      tenantCol: riskAssessments.tenantId,
      dateExpr: riskAssessments.createdAt,
      where: () => [ne(riskAssessments.status, 'archived')],
      siteCol: riskAssessments.siteId,
      dims: raDims,
    },
    published: {
      // 'active' IS the published notion in this module (no 'published' status).
      from: riskAssessments,
      tenantCol: riskAssessments.tenantId,
      where: () => [eq(riskAssessments.status, 'active')],
      siteCol: riskAssessments.siteId,
      dims: raDims,
    },
    reviewOverdue: {
      from: riskAssessments,
      tenantCol: riskAssessments.tenantId,
      where: (now) => [
        eq(riskAssessments.status, 'active'),
        isNotNull(riskAssessments.nextReviewAt),
        lte(riskAssessments.nextReviewAt, now),
      ],
      siteCol: riskAssessments.siteId,
      dims: raDims,
    },
  },
  coshh: {
    added: {
      from: coshhSubstances,
      tenantCol: coshhSubstances.tenantId,
      dateExpr: coshhSubstances.createdAt,
    },
    substances: {
      from: coshhSubstances,
      tenantCol: coshhSubstances.tenantId,
      where: () => [eq(coshhSubstances.status, 'active')],
    },
    reviewOverdue: {
      // Lives on assessments, not substances — the register's own predicate.
      from: coshhAssessments,
      tenantCol: coshhAssessments.tenantId,
      where: (now) => [
        eq(coshhAssessments.status, 'active'),
        isNotNull(coshhAssessments.nextReviewAt),
        lte(coshhAssessments.nextReviewAt, now),
      ],
    },
  },
  fireSafety: {
    checksDone: {
      from: fireLogbookEntries,
      tenantCol: fireLogbookEntries.tenantId,
      dateExpr: fireLogbookEntries.performedAt,
      dims: { building: { expr: fireLogbookEntries.buildingId, labels: 'fireBuilding' } },
    },
    checksFailed: {
      from: fireLogbookEntries,
      tenantCol: fireLogbookEntries.tenantId,
      dateExpr: fireLogbookEntries.performedAt,
      // 'defects_found' is NOT a failure (FS-2) — only 'fail' means the
      // safety measure itself does not work.
      where: () => [eq(fireLogbookEntries.result, 'fail')],
      dims: { building: { expr: fireLogbookEntries.buildingId, labels: 'fireBuilding' } },
    },
    checksOverdue: {
      from: fireLogbookChecks,
      tenantCol: fireLogbookChecks.tenantId,
      // Failed checks are a DISJOINT bucket in the register — a failed
      // check past due shows as failed, not overdue. Reproduce the
      // carve-out or the dashboard and the register disagree.
      where: (now) => [
        eq(fireLogbookChecks.active, true),
        sql`${fireLogbookChecks.lastResult} is distinct from 'fail'`,
        isNotNull(fireLogbookChecks.nextDueAt),
        lte(fireLogbookChecks.nextDueAt, now),
        sql`exists (select 1 from fire_buildings b where b.id = ${fireLogbookChecks.buildingId} and b.status = 'active')`,
      ],
      dims: { building: { expr: fireLogbookChecks.buildingId, labels: 'fireBuilding' } },
    },
  },
  rams: {
    issued: {
      // One row per issue INCLUDING re-issues — "pack versions issued".
      from: ramsPackVersions,
      tenantCol: ramsPackVersions.tenantId,
      dateExpr: ramsPackVersions.issuedAt,
      dims: { status: { expr: ramsVersionStatusExpr, labels: 'enum' } },
    },
    briefings: {
      from: ramsBriefings,
      tenantCol: ramsBriefings.tenantId,
      dateExpr: ramsBriefings.briefedAt,
      dims: { status: { expr: ramsBriefingStatusExpr, labels: 'enum' } },
    },
    inForce: {
      from: ramsPacks,
      tenantCol: ramsPacks.tenantId,
      where: () => [eq(ramsPacks.status, 'issued'), isNull(ramsPacks.archivedAt)],
      dims: { status: { expr: ramsPacks.status, labels: 'enum' } },
    },
  },
  training: {
    recorded: {
      from: trainingRecords,
      tenantCol: trainingRecords.tenantId,
      dateExpr: trainingRecords.createdAt,
    },
    expiringSoon: {
      from: trainingRecords,
      tenantCol: trainingRecords.tenantId,
      // DATE columns: pg coerces to midnight, so "expires today" is
      // already expired (matches the shared training status helper's <=).
      where: (now) => [
        isNull(trainingRecords.supersededAt),
        isNotNull(trainingRecords.expiresAt),
        gt(trainingRecords.expiresAt, now),
        lte(trainingRecords.expiresAt, new Date(now.getTime() + 60 * DAY_MS)),
      ],
    },
    expired: {
      from: trainingRecords,
      tenantCol: trainingRecords.tenantId,
      where: (now) => [
        isNull(trainingRecords.supersededAt),
        isNotNull(trainingRecords.expiresAt),
        lte(trainingRecords.expiresAt, now),
      ],
    },
  },
};

/** Exposed for the DH-E21 completeness test. */
export function metricExecFor(source: DashboardSourceId, metricId: string): MetricExec {
  const exec = METRIC_EXECS[source]?.[metricId];
  if (!exec) {
    throw new Error(`No executor mapping for ${source}.${metricId}`);
  }
  return exec;
}

// ─── Query building ─────────────────────────────────────────────────────────

function rangeConditions(
  exec: MetricExec,
  range: { from: Date; to: Date },
): Array<SQL | undefined> {
  if (!exec.dateExpr) return [];
  const expr = exec.dateExpr as SQLWrapper;
  return [gte(expr as never, range.from), lt(expr as never, range.to)];
}

function baseConditions(
  exec: MetricExec,
  args: { tenantId: string; now: Date; siteIds: readonly string[]; widget: DashboardWidget },
): Array<SQL | undefined> {
  const conditions: Array<SQL | undefined> = [
    eq(exec.tenantCol, args.tenantId),
    ...(exec.where?.(args.now) ?? []),
  ];
  if (exec.siteCol && args.siteIds.length > 0) {
    conditions.push(inArray(exec.siteCol, [...args.siteIds]));
  }
  for (const filter of args.widget.filters) {
    const dim = exec.dims?.[filter.dimension];
    // A filter on a dimension this metric's table lacks (spec-valid only
    // for multi-metric tables) simply narrows to nothing rather than
    // silently ignoring the filter.
    if (!dim) {
      conditions.push(sql`false`);
      continue;
    }
    conditions.push(inArray(dim.expr as never, [...filter.values]));
  }
  return conditions;
}

async function countWhere(db: Db, exec: MetricExec, conditions: Array<SQL | undefined>) {
  const rows = await db
    .select({ n: count() })
    .from(exec.from)
    .where(and(...conditions));
  return rows[0]?.n ?? 0;
}

async function groupedCount(
  db: Db,
  exec: MetricExec,
  expr: PgColumn | SQL,
  conditions: Array<SQL | undefined>,
): Promise<Array<{ key: string; n: number }>> {
  const rows = await db
    .select({ key: sql<string | null>`${expr}`, n: count() })
    .from(exec.from)
    .where(and(...conditions))
    .groupBy(expr as never);
  return rows.map((r) => ({ key: r.key ?? NONE_BUCKET, n: r.n }));
}

// ─── Bucketing ──────────────────────────────────────────────────────────────

type Bucket = 'day' | 'week' | 'month';

/** date_trunc alignment for the bucket that contains `at` (UTC, ISO weeks). */
function bucketStart(at: Date, bucket: Bucket): Date {
  const day = startOfUtcDay(at);
  if (bucket === 'day') return day;
  if (bucket === 'week') {
    const dow = (day.getUTCDay() + 6) % 7; // Monday = 0
    return new Date(day.getTime() - dow * DAY_MS);
  }
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
}

function nextBucket(at: Date, bucket: Bucket): Date {
  if (bucket === 'day') return new Date(at.getTime() + DAY_MS);
  if (bucket === 'week') return new Date(at.getTime() + 7 * DAY_MS);
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
}

/** Every bucket start covering [from, to), oldest first, zero-fill ready. */
export function enumerateBuckets(from: Date, to: Date, bucket: Bucket): string[] {
  const out: string[] = [];
  // Hard cap so a hostile custom range cannot allocate unbounded buckets.
  const MAX_BUCKETS = 400;
  for (
    let at = bucketStart(from, bucket);
    at.getTime() < to.getTime() && out.length < MAX_BUCKETS;
    at = nextBucket(at, bucket)
  ) {
    out.push(isoDay(at));
  }
  return out;
}

// ─── Label resolution ───────────────────────────────────────────────────────

async function resolveLabels(
  db: Db,
  tenantId: string,
  kind: LabelKind,
  keys: readonly string[],
): Promise<Map<string, string>> {
  const ids = keys.filter((k) => k !== NONE_BUCKET && k !== OTHER_BUCKET);
  const out = new Map<string, string>();
  if (kind === 'enum' || ids.length === 0) return out;
  if (kind === 'site') {
    const rows = await db
      .select({ id: sites.id, name: sites.name })
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), inArray(sites.id, ids)));
    for (const r of rows) out.set(r.id, r.name);
  } else if (kind === 'user') {
    const rows = await db
      .select({
        id: user.id,
        name: user.name,
        firstName: user.firstName,
        lastName: user.lastName,
      })
      .from(user)
      .where(and(eq(user.tenantId, tenantId), inArray(user.id, ids)));
    for (const r of rows) {
      const full = [r.firstName, r.lastName].filter(Boolean).join(' ');
      out.set(r.id, full.length > 0 ? full : r.name);
    }
  } else if (kind === 'template') {
    const rows = await db
      .select({ id: templates.id, name: templates.name })
      .from(templates)
      .where(and(eq(templates.tenantId, tenantId), inArray(templates.id, ids)));
    for (const r of rows) out.set(r.id, r.name);
  } else if (kind === 'actionType') {
    const rows = await db
      .select({ id: actionTypes.id, name: actionTypes.name })
      .from(actionTypes)
      .where(and(eq(actionTypes.tenantId, tenantId), inArray(actionTypes.id, ids)));
    for (const r of rows) out.set(r.id, r.name);
  } else if (kind === 'issueCategory') {
    const rows = await db
      .select({ id: issueCategories.id, name: issueCategories.name })
      .from(issueCategories)
      .where(and(eq(issueCategories.tenantId, tenantId), inArray(issueCategories.id, ids)));
    for (const r of rows) out.set(r.id, r.name);
  } else if (kind === 'permitType') {
    const rows = await db
      .select({ id: permitTypes.id, name: permitTypes.name })
      .from(permitTypes)
      .where(and(eq(permitTypes.tenantId, tenantId), inArray(permitTypes.id, ids)));
    for (const r of rows) out.set(r.id, r.name);
  } else if (kind === 'fireBuilding') {
    const rows = await db
      .select({ id: fireBuildings.id, name: fireBuildings.name })
      .from(fireBuildings)
      .where(and(eq(fireBuildings.tenantId, tenantId), inArray(fireBuildings.id, ids)));
    for (const r of rows) out.set(r.id, r.name);
  }
  return out;
}

function labelFor(kind: LabelKind, key: string, resolved: Map<string, string>): string | null {
  if (key === NONE_BUCKET) return null;
  if (key === OTHER_BUCKET) return OTHER_BUCKET;
  if (kind === 'enum') return key;
  return resolved.get(key) ?? key;
}

// ─── Widget execution ───────────────────────────────────────────────────────

export interface ExecuteWidgetArgs {
  db: Db;
  tenantId: string;
  widget: DashboardWidget;
  filters: GlobalFilters;
  now: Date;
}

export async function executeWidget(args: ExecuteWidgetArgs): Promise<WidgetData> {
  const { db, tenantId, widget, filters, now } = args;
  const source = DASHBOARD_SOURCES[widget.source as DashboardSourceId];
  const range = resolveDateRange(filters.dateRange, now);
  const rangeIso: ResolvedRange = { from: range.from.toISOString(), to: range.to.toISOString() };

  const metricIds = widget.kind === 'table' ? widget.metrics : [widget.metric];
  const execs = metricIds.map((id) => metricExecFor(widget.source as DashboardSourceId, id));
  const anyFlow = metricIds.some((id) => sourceMetric(source, id)?.kind === 'flow');
  const meta: WidgetMeta = {
    dateRangeApplied: anyFlow,
    siteFilterApplied:
      filters.siteIds.length > 0 && execs.some((e) => e.siteCol !== undefined),
    range: rangeIso,
  };

  const conditionsFor = (exec: MetricExec, metricId: string, r: { from: Date; to: Date }) => {
    const isFlow = sourceMetric(source, metricId)?.kind === 'flow';
    return [
      ...baseConditions(exec, { tenantId, now, siteIds: filters.siteIds, widget }),
      ...(isFlow ? rangeConditions(exec, r) : []),
    ];
  };

  // Zod guarantees ≥1 metric per widget; this narrows for the compiler.
  const primary = (): { exec: MetricExec; metricId: string } => {
    const exec = execs[0];
    const metricId = metricIds[0];
    if (exec === undefined || metricId === undefined) {
      throw new Error('Widget has no metric');
    }
    return { exec, metricId };
  };

  if (widget.kind === 'kpi') {
    const { exec, metricId } = primary();
    const value = await countWhere(db, exec, conditionsFor(exec, metricId, range));
    if (!widget.compare) return { kind: 'kpi', value, meta };
    const previous = await countWhere(
      db,
      exec,
      conditionsFor(exec, metricId, previousRange(range)),
    );
    return { kind: 'kpi', value, previous, meta };
  }

  if (widget.kind === 'timeseries') {
    const { exec, metricId } = primary();
    if (!exec.dateExpr) {
      throw new Error(`Metric ${widget.source}.${metricId} has no event date`);
    }
    const buckets = enumerateBuckets(range.from, range.to, widget.bucket);
    const bucketIndex = new Map(buckets.map((b, i) => [b, i]));
    const bucketExpr = sql<string>`to_char(date_trunc('${sql.raw(widget.bucket)}', ${exec.dateExpr}), 'YYYY-MM-DD')`;
    // If the range needs more than MAX_BUCKETS, enumerateBuckets stops
    // early; clamp the QUERY window to the covered span so the totals and
    // the displayed buckets agree, and flag it so the chart never claims
    // the full period. `range` (the object meta.range was built from) is
    // narrowed in place before it is serialised below.
    const lastBucket = buckets[buckets.length - 1];
    let queryRange = range;
    if (lastBucket !== undefined) {
      const coveredTo = nextBucket(new Date(`${lastBucket}T00:00:00.000Z`), widget.bucket);
      if (coveredTo.getTime() < range.to.getTime()) {
        queryRange = { from: range.from, to: coveredTo };
        meta.truncated = true;
        meta.range = { from: range.from.toISOString(), to: coveredTo.toISOString() };
      }
    }
    const conditions = conditionsFor(exec, metricId, queryRange);

    if (!widget.splitBy) {
      const rows = await db
        .select({ bucket: bucketExpr, n: count() })
        .from(exec.from)
        .where(and(...conditions))
        .groupBy(bucketExpr);
      const values = buckets.map(() => 0);
      for (const row of rows) {
        const i = bucketIndex.get(row.bucket);
        if (i !== undefined) values[i] = row.n;
      }
      return {
        kind: 'timeseries',
        buckets,
        series: [{ key: metricId, label: null, values }],
        meta,
      };
    }

    const dim = exec.dims?.[widget.splitBy];
    if (!dim) throw new Error(`Metric ${widget.source}.${metricId} has no dimension ${widget.splitBy}`);
    const rows = await db
      .select({ bucket: bucketExpr, key: sql<string | null>`${dim.expr}`, n: count() })
      .from(exec.from)
      .where(and(...conditions))
      .groupBy(bucketExpr, dim.expr as never);

    const totals = new Map<string, number>();
    for (const row of rows) {
      const key = row.key ?? NONE_BUCKET;
      totals.set(key, (totals.get(key) ?? 0) + row.n);
    }
    const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const kept = new Set(ranked.slice(0, DASHBOARD_LIMITS.MAX_SPLIT_SERIES));
    const seriesMap = new Map<string, number[]>();
    const seriesOf = (key: string): number[] => {
      let s = seriesMap.get(key);
      if (!s) {
        s = buckets.map(() => 0);
        seriesMap.set(key, s);
      }
      return s;
    };
    for (const row of rows) {
      const rawKey = row.key ?? NONE_BUCKET;
      const key = kept.has(rawKey) ? rawKey : OTHER_BUCKET;
      const i = bucketIndex.get(row.bucket);
      if (i !== undefined) {
        const s = seriesOf(key);
        s[i] = (s[i] ?? 0) + row.n;
      }
    }
    const resolved = await resolveLabels(db, tenantId, dim.labels, [...seriesMap.keys()]);
    const series = [...seriesMap.entries()]
      .sort((a, b) => {
        // __other always last; otherwise by total desc for a stable legend.
        if (a[0] === OTHER_BUCKET) return 1;
        if (b[0] === OTHER_BUCKET) return -1;
        return (totals.get(b[0]) ?? 0) - (totals.get(a[0]) ?? 0);
      })
      .map(([key, values]) => ({ key, label: labelFor(dim.labels, key, resolved), values }));
    return { kind: 'timeseries', buckets, series, meta };
  }

  if (widget.kind === 'breakdown') {
    const { exec, metricId } = primary();
    const dim = exec.dims?.[widget.dimension];
    if (!dim) throw new Error(`Metric ${widget.source}.${metricId} has no dimension ${widget.dimension}`);
    const grouped = await groupedCount(db, exec, dim.expr, conditionsFor(exec, metricId, range));
    grouped.sort((a, b) => b.n - a.n);
    const top = grouped.slice(0, widget.limit);
    const resolved = await resolveLabels(db, tenantId, dim.labels, top.map((g) => g.key));
    return {
      kind: 'breakdown',
      rows: top.map((g) => ({ key: g.key, label: labelFor(dim.labels, g.key, resolved), value: g.n })),
      meta,
    };
  }

  // table — grouped aggregates: one grouped count per metric, merged on key.
  const metricPlans = execs.map((exec, i) => {
    const metricId = metricIds[i];
    const dim = exec.dims?.[widget.dimension];
    if (metricId === undefined || !dim) {
      throw new Error(`Metric ${widget.source}.${metricIds[i]} has no dimension ${widget.dimension}`);
    }
    return { exec, metricId, dim };
  });
  const firstPlan = metricPlans[0];
  if (firstPlan === undefined) {
    throw new Error('Table widget has no metrics');
  }
  const perMetric = await Promise.all(
    metricPlans.map((plan) =>
      groupedCount(db, plan.exec, plan.dim.expr, conditionsFor(plan.exec, plan.metricId, range)),
    ),
  );
  const rowsByKey = new Map<string, number[]>();
  perMetric.forEach((grouped, metricIdx) => {
    for (const g of grouped) {
      let row = rowsByKey.get(g.key);
      if (!row) {
        row = metricIds.map(() => 0);
        rowsByKey.set(g.key, row);
      }
      row[metricIdx] = g.n;
    }
  });
  const sorted = [...rowsByKey.entries()].sort((a, b) => (b[1][0] ?? 0) - (a[1][0] ?? 0));
  const top = sorted.slice(0, widget.limit);
  const labelKind = firstPlan.dim.labels;
  const resolved = await resolveLabels(db, tenantId, labelKind, top.map(([k]) => k));
  return {
    kind: 'table',
    metrics: metricIds.map((id) => ({
      id,
      label: sourceMetric(source, id)?.label ?? id,
    })),
    rows: top.map(([key, values]) => ({
      key,
      label: labelFor(labelKind, key, resolved),
      values,
    })),
    meta,
  };
}
