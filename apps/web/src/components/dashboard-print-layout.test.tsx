import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { BreakdownResult, WidgetMeta } from '@forma360/api/dashboards/executor';
import type { DashboardWidget } from '@forma360/shared/dashboard-spec';
import {
  DashboardPrintLayout,
  type DashboardPrintBranding,
  type DashboardPrintProps,
} from './dashboard-print-layout';

afterEach(cleanup);

const META: WidgetMeta = {
  dateRangeApplied: true,
  siteFilterApplied: false,
  range: { from: '2026-07-01T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z' },
};

// A donut breakdown: its slices are filled straight from the resolved
// palette, so it's the cleanest probe for "which colours won".
const DONUT_WIDGET: DashboardWidget = {
  id: 'w1',
  title: 'Actions by status',
  source: 'actions',
  filters: [],
  kind: 'breakdown',
  metric: 'created',
  dimension: 'status',
  chart: 'donut',
  limit: 10,
};

const DONUT_DATA: BreakdownResult = {
  kind: 'breakdown',
  rows: [
    { key: 'open', label: 'Open', value: 5 },
    { key: 'closed', label: 'Closed', value: 3 },
  ],
  meta: META,
};

function props(branding: DashboardPrintBranding | null): DashboardPrintProps {
  return {
    title: 'Operations Dashboard',
    description: null,
    status: 'published',
    tenantName: 'Acme Ltd',
    generatedAt: '2026-08-09T10:00:00.000Z',
    range: { from: '2026-07-01T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z' },
    siteCount: 0,
    widgets: [{ widget: DONUT_WIDGET, data: DONUT_DATA }],
    branding,
  };
}

describe('DashboardPrintLayout branding (ADR 0018)', () => {
  it('renders the plain ink header and default palette when no branding is set', () => {
    const { container } = render(<DashboardPrintLayout {...props(null)} />);
    // No cover band / logo.
    expect(container.querySelector('img')).toBeNull();
    // Title + tenant still present.
    expect(container.textContent).toContain('Operations Dashboard');
    expect(container.textContent).toContain('Acme Ltd');
    // First donut slice uses the first default series colour.
    expect(container.innerHTML).toContain('#2563eb');
  });

  it('prefers the tenant chartColors over the default ramp', () => {
    const { container } = render(
      <DashboardPrintLayout {...props({ logoUrl: null, chartColors: ['#aa11bb', '#22cc33'] })} />,
    );
    expect(container.innerHTML).toContain('#aa11bb');
    expect(container.innerHTML).toContain('#22cc33');
    // The default ramp must no longer supply any slice colour.
    expect(container.innerHTML).not.toContain('#2563eb');
  });

  it('ignores malformed chartColors and falls back to the default ramp', () => {
    const { container } = render(
      <DashboardPrintLayout {...props({ logoUrl: null, chartColors: ['not-a-hex', ''] })} />,
    );
    expect(container.innerHTML).toContain('#2563eb');
  });

  it('renders a branded cover band with the logo and primary colour', () => {
    const { container } = render(
      <DashboardPrintLayout
        {...props({ logoUrl: 'https://cdn.example.com/logo.png', primaryColor: '#123456' })}
      />,
    );
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://cdn.example.com/logo.png');
    expect(img?.getAttribute('alt')).toBe('logo');
    // The cover band (the logo's parent) carries the primary colour.
    const cover = img?.parentElement as HTMLElement | null;
    expect(cover?.style.backgroundColor).not.toBe('');
  });

  it('renders the branded cover band from a logo alone (no primary)', () => {
    const { container } = render(
      <DashboardPrintLayout {...props({ logoUrl: 'https://cdn.example.com/logo.png' })} />,
    );
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'https://cdn.example.com/logo.png',
    );
  });

  it('drops a malformed primaryColor rather than injecting it', () => {
    // A non-hex value must never reach an inline style (the HEX6 guard).
    const { container } = render(
      <DashboardPrintLayout {...props({ logoUrl: null, primaryColor: 'red;content:url(x)' })} />,
    );
    // No logo and an invalid primary ⇒ no cover band at all.
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toContain('content:url');
  });
});
