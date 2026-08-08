/**
 * Dashboard data-source catalogue (ADR 0018).
 *
 * The bounded vocabulary the AI dashboard builder composes from. Every
 * widget in a dashboard spec references exactly one source + one metric
 * (+ optionally one dimension); the query engine in `packages/api`
 * executes ONLY what this catalogue declares — the model never writes a
 * query. That is the whole safety story: tenant scoping, permission
 * gating, and brand gating are properties of the catalogue entry, not of
 * anything the AI emits.
 *
 * Invariants (enforced by tests here and in `packages/api`):
 *   - `permission` must be a real `PermissionKey` (asserted in the
 *     dashboards router test — this package cannot import the
 *     permissions catalogue without inverting the dependency graph).
 *   - Every metric and dimension declared here has an executor mapping
 *     in `packages/api` (completeness test there). A catalogue promise
 *     with no implementation is the sandbox lesson all over again —
 *     it fails a practitioner faster than a missing feature.
 *   - `labels` here are AI-prompt vocabulary and deliberately English
 *     (the model reads them; users see AI-authored widget titles in
 *     their own language plus i18n'd chrome).
 *
 * Metric kinds:
 *   - `flow`: events counted within the dashboard's date range (created,
 *     completed, issued…). Valid on every widget kind.
 *   - `stock`: a point-in-time state count (open, overdue, in force…).
 *     The date range does not apply; timeseries widgets refuse them.
 */
import { BRAND_ONLY_MODULES, type BrandOnlyModule } from './brand';

export const DASHBOARD_SOURCE_IDS = [
  'actions',
  'inspections',
  'observations',
  'headsUp',
  'incidents',
  'permits',
  'riskAssessments',
  'coshh',
  'fireSafety',
  'rams',
  'training',
] as const;

export type DashboardSourceId = (typeof DASHBOARD_SOURCE_IDS)[number];

export type DashboardMetricKind = 'flow' | 'stock';

export interface DashboardMetric {
  readonly id: string;
  readonly label: string;
  readonly kind: DashboardMetricKind;
  /**
   * When set, only these of the source's dimensions apply to this metric
   * (some metrics count a different table than their siblings — e.g.
   * inspections `missed` counts scheduled occurrences, which have no
   * inspection status). Absent = every source dimension applies.
   */
  readonly dimensions?: readonly string[];
}

export interface DashboardDimension {
  readonly id: string;
  readonly label: string;
}

export interface DashboardSource {
  readonly id: DashboardSourceId;
  readonly label: string;
  /** One-line description used verbatim in the AI system prompt. */
  readonly description: string;
  /** PermissionKey required to include this source in a dashboard. */
  readonly permission: string;
  /** Present when the source only exists on some brands (ADR 0010). */
  readonly brandModule?: BrandOnlyModule;
  /** Whether the global site filter applies to this source. */
  readonly siteScoped: boolean;
  readonly metrics: readonly DashboardMetric[];
  readonly dimensions: readonly DashboardDimension[];
}

export const DASHBOARD_SOURCES: Record<DashboardSourceId, DashboardSource> = {
  actions: {
    id: 'actions',
    label: 'Actions',
    description: 'Corrective and preventive actions across every module: who owes what, by when.',
    permission: 'actions.view',
    siteScoped: true,
    metrics: [
      { id: 'created', label: 'Actions created', kind: 'flow' },
      { id: 'completed', label: 'Actions completed', kind: 'flow' },
      { id: 'open', label: 'Open actions', kind: 'stock' },
      { id: 'overdue', label: 'Overdue actions', kind: 'stock' },
    ],
    dimensions: [
      { id: 'status', label: 'Status' },
      { id: 'site', label: 'Site' },
      { id: 'assignee', label: 'Assignee' },
      { id: 'type', label: 'Action type' },
    ],
  },
  inspections: {
    id: 'inspections',
    label: 'Inspections',
    description: 'Template-based inspections: conducted, completed, and missed occurrences.',
    permission: 'inspections.view',
    siteScoped: true,
    metrics: [
      { id: 'started', label: 'Inspections started', kind: 'flow' },
      { id: 'completed', label: 'Inspections completed', kind: 'flow' },
      {
        id: 'missed',
        label: 'Scheduled occurrences missed',
        kind: 'flow',
        // Counts scheduled_inspection_occurrences — no inspection status there.
        dimensions: ['template', 'site'],
      },
      { id: 'inProgress', label: 'Inspections in progress', kind: 'stock' },
    ],
    dimensions: [
      { id: 'template', label: 'Template' },
      { id: 'site', label: 'Site' },
      { id: 'status', label: 'Status' },
    ],
  },
  observations: {
    id: 'observations',
    label: 'Observations',
    description:
      'Field observations and issues raised by anyone: hazards, good practice, near misses.',
    permission: 'issues.view',
    siteScoped: true,
    metrics: [
      { id: 'raised', label: 'Observations raised', kind: 'flow' },
      { id: 'closed', label: 'Observations closed', kind: 'flow' },
      { id: 'open', label: 'Open observations', kind: 'stock' },
    ],
    dimensions: [
      { id: 'category', label: 'Category' },
      { id: 'site', label: 'Site' },
      { id: 'status', label: 'Status' },
    ],
  },
  headsUp: {
    id: 'headsUp',
    label: 'Heads-up broadcasts',
    description: 'Broadcast messages and whether recipients have acknowledged them.',
    permission: 'headsUp.analytics.view',
    siteScoped: false,
    metrics: [
      { id: 'published', label: 'Heads-ups published', kind: 'flow' },
      { id: 'acknowledged', label: 'Acknowledgements received', kind: 'flow' },
      { id: 'pendingAcks', label: 'Acknowledgements outstanding', kind: 'stock' },
    ],
    dimensions: [],
  },
  incidents: {
    id: 'incidents',
    label: 'Incidents',
    description:
      'Incident and accident records. Confidential kinds (sharps, violence) are counted, never detailed.',
    permission: 'incidents.view',
    brandModule: 'incidents',
    siteScoped: true,
    metrics: [
      { id: 'reported', label: 'Incidents reported', kind: 'flow' },
      { id: 'open', label: 'Incidents not yet closed', kind: 'stock' },
      { id: 'riddor', label: 'RIDDOR-reportable determinations', kind: 'flow' },
    ],
    dimensions: [
      { id: 'kind', label: 'Incident kind' },
      { id: 'severity', label: 'Severity' },
      { id: 'status', label: 'Status' },
      { id: 'site', label: 'Site' },
    ],
  },
  permits: {
    id: 'permits',
    label: 'Permits to work',
    description: 'High-risk activity permits: issued, live on the board, expired.',
    permission: 'permits.view',
    brandModule: 'permits',
    siteScoped: true,
    metrics: [
      { id: 'issued', label: 'Permits issued', kind: 'flow' },
      { id: 'closed', label: 'Permits closed', kind: 'flow' },
      // "Live on the board" = issued | active | suspended (OPEN_PERMIT_STATUSES),
      // the practitioner notion, matching the register and analytics tile.
      { id: 'active', label: 'Permits live on the board', kind: 'stock' },
    ],
    dimensions: [
      { id: 'type', label: 'Permit type' },
      { id: 'status', label: 'Status' },
      { id: 'site', label: 'Site' },
    ],
  },
  riskAssessments: {
    id: 'riskAssessments',
    label: 'Risk assessments',
    description: 'HSE five-step risk assessments and their review cycle.',
    permission: 'riskAssessments.view',
    brandModule: 'riskAssessments',
    siteScoped: true,
    metrics: [
      { id: 'created', label: 'Risk assessments created', kind: 'flow' },
      { id: 'published', label: 'Published risk assessments', kind: 'stock' },
      { id: 'reviewOverdue', label: 'Reviews overdue', kind: 'stock' },
    ],
    dimensions: [
      { id: 'status', label: 'Status' },
      { id: 'site', label: 'Site' },
    ],
  },
  coshh: {
    id: 'coshh',
    label: 'COSHH substances',
    description: 'Hazardous-substance inventory and assessment reviews.',
    permission: 'coshh.view',
    brandModule: 'coshh',
    siteScoped: false,
    metrics: [
      { id: 'added', label: 'Substances added', kind: 'flow' },
      { id: 'substances', label: 'Substances in inventory', kind: 'stock' },
      { id: 'reviewOverdue', label: 'Assessment reviews overdue', kind: 'stock' },
    ],
    dimensions: [],
  },
  fireSafety: {
    id: 'fireSafety',
    label: 'Fire safety',
    description: 'Fire-safety logbook checks across buildings: done, failed, overdue.',
    permission: 'fireSafety.view',
    brandModule: 'fireSafety',
    siteScoped: false,
    metrics: [
      { id: 'checksDone', label: 'Checks completed', kind: 'flow' },
      { id: 'checksFailed', label: 'Checks failed', kind: 'flow' },
      { id: 'checksOverdue', label: 'Checks overdue', kind: 'stock' },
    ],
    dimensions: [{ id: 'building', label: 'Building' }],
  },
  rams: {
    id: 'rams',
    label: 'RAMS packs',
    description: 'Risk Assessment & Method Statement packs and point-of-work briefings.',
    permission: 'rams.view',
    brandModule: 'rams',
    siteScoped: false,
    metrics: [
      { id: 'issued', label: 'Pack versions issued', kind: 'flow' },
      { id: 'briefings', label: 'Briefings delivered', kind: 'flow' },
      { id: 'inForce', label: 'Packs currently in force', kind: 'stock' },
    ],
    dimensions: [{ id: 'status', label: 'Status' }],
  },
  training: {
    id: 'training',
    label: 'Training & competence',
    description: 'Training records against the competence matrix: valid, expiring, expired.',
    permission: 'training.view',
    brandModule: 'training',
    siteScoped: false,
    metrics: [
      { id: 'recorded', label: 'Training records added', kind: 'flow' },
      { id: 'expiringSoon', label: 'Certificates expiring within 60 days', kind: 'stock' },
      { id: 'expired', label: 'Certificates expired', kind: 'stock' },
    ],
    dimensions: [],
  },
};

export function isDashboardSourceId(value: unknown): value is DashboardSourceId {
  return typeof value === 'string' && (DASHBOARD_SOURCE_IDS as readonly string[]).includes(value);
}

export function getDashboardSource(id: DashboardSourceId): DashboardSource {
  return DASHBOARD_SOURCES[id];
}

export function sourceMetric(
  source: DashboardSource,
  metricId: string,
): DashboardMetric | undefined {
  return source.metrics.find((m) => m.id === metricId);
}

export function sourceDimension(
  source: DashboardSource,
  dimensionId: string,
): DashboardDimension | undefined {
  return source.dimensions.find((d) => d.id === dimensionId);
}

/** Whether a dimension applies to a specific metric (see DashboardMetric.dimensions). */
export function metricAllowsDimension(metric: DashboardMetric, dimensionId: string): boolean {
  return metric.dimensions === undefined || metric.dimensions.includes(dimensionId);
}

/**
 * The sources a given user in a given brand may build dashboards from.
 * Both gates mirror the module routers': the brand catalogue first, then
 * the per-source view permission. `grantsAdmin` mirrors the nav's
 * admin bypass (org.settings holders see everything their brand ships).
 */
export function availableDashboardSources(input: {
  readonly brandModules: ReadonlyArray<BrandOnlyModule>;
  readonly permissions: ReadonlyArray<string>;
  readonly grantsAdmin: boolean;
}): DashboardSource[] {
  return DASHBOARD_SOURCE_IDS.map((id) => DASHBOARD_SOURCES[id]).filter((source) => {
    if (source.brandModule && !input.brandModules.includes(source.brandModule)) return false;
    if (input.grantsAdmin) return true;
    return input.permissions.includes(source.permission);
  });
}

/** Structural sanity used by tests; exported so packages/api can reuse it. */
export function catalogueBrandModules(): ReadonlySet<BrandOnlyModule> {
  const used = new Set<BrandOnlyModule>();
  for (const id of DASHBOARD_SOURCE_IDS) {
    const mod = DASHBOARD_SOURCES[id].brandModule;
    if (mod) used.add(mod);
  }
  for (const mod of used) {
    if (!(BRAND_ONLY_MODULES as readonly string[]).includes(mod)) {
      throw new Error(`Unknown brand module in dashboard source catalogue: ${mod}`);
    }
  }
  return used;
}
