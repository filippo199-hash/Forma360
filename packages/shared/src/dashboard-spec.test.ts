/**
 * Dashboard spec schema tests — edge cases DH-E01..E10.
 */
import { describe, expect, it } from 'vitest';

import {
  DASHBOARD_LIMITS,
  DASHBOARD_SPEC_VERSION,
  dashboardSpecSchema,
  parseDashboardSpec,
  widgetSpan,
  type DashboardSpec,
  type DashboardWidget,
} from './dashboard-spec';
import {
  DASHBOARD_SOURCES,
  DASHBOARD_SOURCE_IDS,
  availableDashboardSources,
  catalogueBrandModules,
} from './dashboard-sources';

const SITE_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

function kpi(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'open-actions',
    kind: 'kpi',
    title: 'Open actions',
    source: 'actions',
    metric: 'open',
    ...overrides,
  };
}

function validSpec(widgets: Record<string, unknown>[] = [kpi()]): Record<string, unknown> {
  return { version: DASHBOARD_SPEC_VERSION, widgets };
}

describe('dashboardSpecSchema — happy path', () => {
  it('parses a minimal KPI dashboard and applies defaults', () => {
    const result = parseDashboardSpec(validSpec());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.filterDefaults.dateRange).toBe('last30d');
    expect(result.spec.filterDefaults.siteIds).toEqual([]);
    expect(result.spec.widgets[0]?.filters).toEqual([]);
  });

  it('parses every widget kind together', () => {
    const result = parseDashboardSpec(
      validSpec([
        kpi(),
        {
          id: 'actions-over-time',
          kind: 'timeseries',
          title: 'Actions created per week',
          source: 'actions',
          metric: 'created',
          splitBy: 'site',
        },
        {
          id: 'incidents-by-kind',
          kind: 'breakdown',
          title: 'Incidents by kind',
          source: 'incidents',
          metric: 'reported',
          dimension: 'kind',
          chart: 'donut',
        },
        {
          id: 'site-table',
          kind: 'table',
          title: 'Site comparison',
          source: 'actions',
          dimension: 'site',
          metrics: ['open', 'overdue', 'completed'],
        },
      ]),
    );
    expect(result.ok).toBe(true);
  });

  it('accepts a custom date range and widget filters', () => {
    const result = parseDashboardSpec({
      version: DASHBOARD_SPEC_VERSION,
      widgets: [
        kpi({
          filters: [{ dimension: 'status', values: ['open', 'in_progress'] }],
        }),
      ],
      filterDefaults: { dateRange: { from: '2026-01-01', to: '2026-06-30' }, siteIds: [SITE_ID] },
    });
    expect(result.ok).toBe(true);
  });
});

describe('dashboardSpecSchema — refusals', () => {
  it('DH-E01: duplicate widget ids are rejected', () => {
    const result = parseDashboardSpec(validSpec([kpi(), kpi({ title: 'Again' })]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toContain('Duplicate widget id');
  });

  it('DH-E02: a metric the source does not declare is rejected', () => {
    const result = parseDashboardSpec(validSpec([kpi({ metric: 'velocity' })]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toContain('no metric "velocity"');
  });

  it('DH-E03: a dimension the source does not declare is rejected', () => {
    const result = parseDashboardSpec(
      validSpec([
        {
          id: 'bad-dim',
          kind: 'breakdown',
          title: 'By severity',
          source: 'actions',
          metric: 'open',
          dimension: 'severity',
        },
      ]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toContain('no dimension "severity"');
  });

  it('DH-E03b: a dimension inapplicable to the metric is rejected (missed × status)', () => {
    const result = parseDashboardSpec(
      validSpec([
        {
          id: 'missed-by-status',
          kind: 'breakdown',
          title: 'Missed by status',
          source: 'inspections',
          metric: 'missed',
          dimension: 'status',
        },
      ]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toContain('cannot be broken down by');
    // …while template/site remain valid for the same metric.
    expect(
      parseDashboardSpec(
        validSpec([
          {
            id: 'missed-by-template',
            kind: 'breakdown',
            title: 'Missed by template',
            source: 'inspections',
            metric: 'missed',
            dimension: 'template',
          },
        ]),
      ).ok,
    ).toBe(true);
  });

  it('DH-E04: a stock metric cannot be plotted over time', () => {
    const result = parseDashboardSpec(
      validSpec([
        {
          id: 'open-over-time',
          kind: 'timeseries',
          title: 'Open actions over time',
          source: 'actions',
          metric: 'open',
        },
      ]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toContain('cannot be plotted over time');
  });

  it('DH-E05: widget filters must reference declared dimensions', () => {
    const result = parseDashboardSpec(
      validSpec([kpi({ filters: [{ dimension: 'weather', values: ['sunny'] }] })]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toContain('unknown dimension "weather"');
  });

  it('DH-E05b: a filter on a metric-disallowed dimension is rejected (not a silent zero)', () => {
    // `missed` counts scheduled occurrences, which have no `status` — a
    // filter on it would narrow the widget to a permanent zero.
    const result = parseDashboardSpec(
      validSpec([
        {
          id: 'missed-filtered',
          kind: 'kpi',
          title: 'Missed, filtered by status',
          source: 'inspections',
          metric: 'missed',
          filters: [{ dimension: 'status', values: ['completed'] }],
        },
      ]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toContain('cannot be filtered by');
  });

  it('DH-E06: widget count is capped', () => {
    const widgets = Array.from({ length: DASHBOARD_LIMITS.MAX_WIDGETS + 1 }, (_, i) =>
      kpi({ id: `kpi-${i}` }),
    );
    expect(parseDashboardSpec(validSpec(widgets)).ok).toBe(false);
  });

  it('DH-E07: compare-to-previous-period is refused on stock metrics', () => {
    const result = parseDashboardSpec(validSpec([kpi({ compare: true })]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toContain('cannot be compared');
  });

  it('DH-E08: an unknown source is rejected', () => {
    expect(parseDashboardSpec(validSpec([kpi({ source: 'payroll' })])).ok).toBe(false);
  });

  it('DH-E09: a custom date range with from after to is rejected', () => {
    const result = parseDashboardSpec({
      version: DASHBOARD_SPEC_VERSION,
      widgets: [kpi()],
      filterDefaults: { dateRange: { from: '2026-06-30', to: '2026-01-01' } },
    });
    expect(result.ok).toBe(false);
  });

  it('DH-E09b: calendar-invalid custom dates are rejected (no silent rollover / crash)', () => {
    for (const bad of ['2026-06-31', '2026-13-01', '2026-02-30', '2026-00-10']) {
      const result = parseDashboardSpec({
        version: DASHBOARD_SPEC_VERSION,
        widgets: [kpi()],
        filterDefaults: { dateRange: { from: bad, to: '2026-12-31' } },
      });
      expect(result.ok, `${bad} must be rejected`).toBe(false);
    }
    // A real leap day still passes.
    expect(
      parseDashboardSpec({
        version: DASHBOARD_SPEC_VERSION,
        widgets: [kpi()],
        filterDefaults: { dateRange: { from: '2028-02-29', to: '2028-03-01' } },
      }).ok,
    ).toBe(true);
  });

  it('DH-E10: version must match; an empty dashboard is rejected', () => {
    expect(parseDashboardSpec({ version: '2', widgets: [kpi()] }).ok).toBe(false);
    expect(parseDashboardSpec({ version: DASHBOARD_SPEC_VERSION, widgets: [] }).ok).toBe(false);
  });

  it('rejects malformed widget ids', () => {
    expect(parseDashboardSpec(validSpec([kpi({ id: 'Open Actions!' })])).ok).toBe(false);
    expect(parseDashboardSpec(validSpec([kpi({ id: '-leading-dash' })])).ok).toBe(false);
  });

  it('parse errors carry a path so the AI correction loop can act on them', () => {
    const result = parseDashboardSpec(validSpec([kpi({ metric: 'velocity' })]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/^widgets\.0/);
  });
});

describe('widgetSpan defaults', () => {
  it('gives per-kind defaults and honours explicit spans', () => {
    const parsed = dashboardSpecSchema.parse(
      validSpec([
        kpi(),
        kpi({ id: 'wide-kpi', span: 3 }),
        {
          id: 'trend',
          kind: 'timeseries',
          title: 'Trend',
          source: 'actions',
          metric: 'created',
        },
      ]),
    ) as DashboardSpec;
    const [small, wide, trend] = parsed.widgets as [
      DashboardWidget,
      DashboardWidget,
      DashboardWidget,
    ];
    expect(widgetSpan(small)).toBe(1);
    expect(widgetSpan(wide)).toBe(3);
    expect(widgetSpan(trend)).toBe(2);
  });
});

describe('dashboard source catalogue — structural invariants', () => {
  it('source ids are unique and every entry agrees with its key', () => {
    expect(new Set(DASHBOARD_SOURCE_IDS).size).toBe(DASHBOARD_SOURCE_IDS.length);
    for (const id of DASHBOARD_SOURCE_IDS) {
      expect(DASHBOARD_SOURCES[id].id).toBe(id);
    }
  });

  it('every source has ≥1 metric with unique ids; dimension ids unique', () => {
    for (const id of DASHBOARD_SOURCE_IDS) {
      const source = DASHBOARD_SOURCES[id];
      expect(source.metrics.length).toBeGreaterThan(0);
      expect(new Set(source.metrics.map((m) => m.id)).size).toBe(source.metrics.length);
      expect(new Set(source.dimensions.map((d) => d.id)).size).toBe(source.dimensions.length);
    }
  });

  it('brand modules referenced by sources are real brand-only modules', () => {
    expect(() => catalogueBrandModules()).not.toThrow();
  });

  it('availableDashboardSources gates on brand first, then permission', () => {
    const forma = availableDashboardSources({
      brandModules: [],
      permissions: ['actions.view', 'incidents.view'],
      grantsAdmin: false,
    });
    expect(forma.map((s) => s.id)).toContain('actions');
    // incidents is brand-gated: holding the permission is not enough.
    expect(forma.map((s) => s.id)).not.toContain('incidents');

    const freehsViewer = availableDashboardSources({
      brandModules: ['incidents'],
      permissions: ['incidents.view'],
      grantsAdmin: false,
    });
    expect(freehsViewer.map((s) => s.id)).toEqual(['incidents']);
  });

  it('admin bypass grants every brand-shipped source, and only those', () => {
    const admin = availableDashboardSources({
      brandModules: ['incidents', 'permits'],
      permissions: ['org.settings'],
      grantsAdmin: true,
    });
    const ids = admin.map((s) => s.id);
    expect(ids).toContain('actions');
    expect(ids).toContain('incidents');
    expect(ids).toContain('permits');
    expect(ids).not.toContain('rams');
  });
});
