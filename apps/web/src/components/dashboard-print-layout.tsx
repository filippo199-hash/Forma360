/**
 * Print layout for the Puppeteer-facing `/render/dashboard/*` route
 * (ADR 0018) — a custom dashboard as a filable page: header, the
 * applied filters, then every widget as SELF-CONTAINED server-rendered
 * HTML/SVG. No client components, no Recharts, no hydration — Puppeteer
 * waits for networkidle0 and static markup is exactly what prints
 * reliably. English-only like the other print layouts: the rendered
 * artefact is a portable record, not a localised screen.
 *
 * Chart drawing is deliberately minimal but honest: axes carry the
 * first/last bucket and the max value, bars carry value labels where
 * they fit, and a widget whose query failed prints an explicit error
 * box rather than a blank hole.
 */
import type {
  BreakdownResult,
  KpiResult,
  TableResult,
  TimeseriesResult,
  WidgetData,
} from '@forma360/api/dashboards/executor';
import type { DashboardWidget } from '@forma360/shared/dashboard-spec';
import { widgetSpan } from '@forma360/shared/dashboard-spec';
import {
  DASHBOARD_SOURCES,
  sourceDimension,
  type DashboardSourceId,
} from '@forma360/shared/dashboard-sources';
import { formatDate, formatDateTime } from '../lib/format-date';

export interface DashboardPrintWidget {
  widget: DashboardWidget;
  /** `null` when the executor threw — rendered as an explicit error box. */
  data: WidgetData | null;
}

/**
 * Tenant branding applied to the print (ADR 0018). The palette + logo
 * re-skin the app AND its PDFs; this is the PDF side for custom
 * dashboards, mirroring `PrintTenantBranding` on the inspection print.
 * The web dashboard grid colours its series from `--chart-N` (which the
 * tenant theme overrides); the static print has no CSS vars, so the
 * caller hands the palette in directly.
 */
export interface DashboardPrintBranding {
  /** Pre-resolved logo URL; `null` when unset / unresolvable. */
  logoUrl: string | null;
  /** Header cover colour (`#rrggbb`), when the tenant set one. */
  primaryColor?: string;
  /** Series ramp (`#rrggbb`), preferred over the default when non-empty. */
  chartColors?: readonly string[];
}

export interface DashboardPrintProps {
  title: string;
  description: string | null;
  status: string;
  tenantName: string;
  /** ISO instant the page was generated (the widgets' `now`). */
  generatedAt: string;
  /** The resolved [from, to) range every flow widget was evaluated over. */
  range: { from: string; to: string };
  /** How many sites the global site filter narrowed to (0 = all). */
  siteCount: number;
  widgets: DashboardPrintWidget[];
  /** Tenant branding; `null` re-uses the default palette + plain header. */
  branding?: DashboardPrintBranding | null;
}

// Print-safe series palette (distinct at grayscale-ish print densities).
// Used when the tenant has set no `chartColors` of their own.
const DEFAULT_SERIES_COLORS: readonly string[] = [
  '#2563eb',
  '#059669',
  '#d97706',
  '#dc2626',
  '#7c3aed',
  '#0891b2',
  '#be185d',
  '#4b5563',
];
const OTHER_COLOR = '#9ca3af';
const AXIS_COLOR = '#9ca3af';
const GRID_COLOR = '#e5e7eb';
const INK = '#111';
const MUTED = '#6b7280';

/** Only canonical `#rrggbb` reaches an inline style / SVG fill. */
const HEX6 = /^#[0-9a-fA-F]{6}$/;

function validHex(color: string | undefined): string | undefined {
  return color !== undefined && HEX6.test(color) ? color : undefined;
}

/** Tenant `chartColors` (validated, non-empty) win over the default ramp. */
function resolvePalette(chartColors: readonly string[] | undefined): readonly string[] {
  const valid = (chartColors ?? []).filter((c) => HEX6.test(c));
  return valid.length > 0 ? valid : DEFAULT_SERIES_COLORS;
}

function colorAt(colors: readonly string[], i: number, key?: string): string {
  if (key === '__other') return OTHER_COLOR;
  return colors[i % colors.length] ?? '#2563eb';
}

function fmt(n: number): string {
  return n.toLocaleString('en-GB');
}

/** Executor label conventions: null = the "no value" bucket, __other = collapsed tail. */
function displayLabel(label: string | null, key?: string): string {
  if (label === '__other' || key === '__other') return 'Other';
  if (label === null) return 'None';
  return label;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1))}…`;
}

function NoData() {
  return <div style={{ color: MUTED, fontSize: 10, padding: '14px 0' }}>No data in range</div>;
}

// ─── KPI ────────────────────────────────────────────────────────────────────

function KpiTile({ data, compare }: { data: KpiResult; compare: boolean }) {
  const previous = data.previous;
  return (
    <div>
      <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1 }}>{fmt(data.value)}</div>
      {compare && previous !== undefined ? (
        <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>
          {data.value >= previous ? '▲' : '▼'} {data.value >= previous ? '+' : '−'}
          {fmt(Math.abs(data.value - previous))} vs previous period ({fmt(previous)})
        </div>
      ) : null}
      {!data.meta.dateRangeApplied ? (
        <div style={{ fontSize: 9, color: MUTED, marginTop: 2 }}>Point-in-time count</div>
      ) : null}
    </div>
  );
}

// ─── Timeseries ─────────────────────────────────────────────────────────────

const TS = { w: 620, h: 190, top: 12, right: 10, bottom: 24, left: 46 };

function tsMax(data: TimeseriesResult): number {
  let max = 1;
  for (const s of data.series) for (const v of s.values) if (v > max) max = v;
  return max;
}

function Legend({
  colors,
  series,
}: {
  colors: readonly string[];
  series: TimeseriesResult['series'];
}) {
  if (series.length <= 1) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginTop: 4 }}>
      {series.map((s, i) => (
        <span key={s.key} style={{ fontSize: 9, color: INK }}>
          <span
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              background: colorAt(colors, i, s.key),
              marginRight: 4,
              borderRadius: 2,
            }}
          />
          {truncate(displayLabel(s.label, s.key), 28)}
        </span>
      ))}
    </div>
  );
}

function TimeseriesAxes({ data, max }: { data: TimeseriesResult; max: number }) {
  const ih = TS.h - TS.top - TS.bottom;
  const first = data.buckets[0];
  const last = data.buckets[data.buckets.length - 1];
  return (
    <>
      {/* y gridlines + labels: 0, mid, max */}
      {[0, 0.5, 1].map((t) => {
        const yPos = TS.top + ih - t * ih;
        return (
          <g key={t}>
            <line
              x1={TS.left}
              x2={TS.w - TS.right}
              y1={yPos}
              y2={yPos}
              stroke={GRID_COLOR}
              strokeWidth={1}
            />
            <text x={TS.left - 5} y={yPos + 3} fontSize={8} fill={MUTED} textAnchor="end">
              {fmt(Math.round(t * max))}
            </text>
          </g>
        );
      })}
      <line
        x1={TS.left}
        x2={TS.w - TS.right}
        y1={TS.top + ih}
        y2={TS.top + ih}
        stroke={AXIS_COLOR}
        strokeWidth={1}
      />
      {first !== undefined ? (
        <text x={TS.left} y={TS.h - 8} fontSize={8} fill={MUTED} textAnchor="start">
          {formatDate(first)}
        </text>
      ) : null}
      {last !== undefined && data.buckets.length > 1 ? (
        <text x={TS.w - TS.right} y={TS.h - 8} fontSize={8} fill={MUTED} textAnchor="end">
          {formatDate(last)}
        </text>
      ) : null}
    </>
  );
}

function TimeseriesChart({
  colors,
  data,
  chart,
}: {
  colors: readonly string[];
  data: TimeseriesResult;
  chart: 'line' | 'bar' | 'area';
}) {
  const n = data.buckets.length;
  if (n === 0 || data.series.length === 0) return <NoData />;
  const iw = TS.w - TS.left - TS.right;
  const ih = TS.h - TS.top - TS.bottom;
  const max = tsMax(data);
  const y = (v: number): number => TS.top + ih - (v / max) * ih;

  let marks: React.ReactNode;
  if (chart === 'bar') {
    const slot = iw / n;
    const m = data.series.length;
    const barW = Math.max(1, (slot * 0.72) / m);
    const showValues = m === 1 && n <= 14;
    marks = data.series.map((s, si) => (
      <g key={s.key}>
        {s.values.map((v, i) => {
          const xPos = TS.left + i * slot + slot * 0.14 + si * barW;
          return (
            <g key={i}>
              <rect
                x={xPos}
                y={y(v)}
                width={barW}
                height={Math.max(0, TS.top + ih - y(v))}
                fill={colorAt(colors, si, s.key)}
              />
              {showValues && v > 0 ? (
                <text x={xPos + barW / 2} y={y(v) - 2} fontSize={7} fill={INK} textAnchor="middle">
                  {fmt(v)}
                </text>
              ) : null}
            </g>
          );
        })}
      </g>
    ));
  } else {
    const x = (i: number): number => (n <= 1 ? TS.left + iw / 2 : TS.left + (i * iw) / (n - 1));
    marks = data.series.map((s, si) => {
      const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
      const color = colorAt(colors, si, s.key);
      return (
        <g key={s.key}>
          {chart === 'area' ? (
            <polygon
              points={`${TS.left},${TS.top + ih} ${pts} ${x(n - 1)},${TS.top + ih}`}
              fill={color}
              opacity={0.15}
            />
          ) : null}
          {n === 1 ? (
            <circle cx={x(0)} cy={y(s.values[0] ?? 0)} r={3} fill={color} />
          ) : (
            <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} />
          )}
        </g>
      );
    });
  }

  return (
    <div>
      <svg
        viewBox={`0 0 ${TS.w} ${TS.h}`}
        width="100%"
        role="img"
        xmlns="http://www.w3.org/2000/svg"
      >
        <TimeseriesAxes data={data} max={max} />
        {marks}
      </svg>
      <Legend colors={colors} series={data.series} />
    </div>
  );
}

// ─── Breakdown ──────────────────────────────────────────────────────────────

function ColumnChart({
  colors,
  rows,
}: {
  colors: readonly string[];
  rows: BreakdownResult['rows'];
}) {
  const w = 620;
  const top = 14;
  const bottom = 18;
  const chartH = 150;
  const h = top + chartH + bottom;
  const slot = w / rows.length;
  const barW = Math.min(56, slot * 0.6);
  const max = Math.max(1, ...rows.map((r) => r.value));
  const labelChars = Math.max(4, Math.floor(slot / 5));
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" xmlns="http://www.w3.org/2000/svg">
      <line x1={0} x2={w} y1={top + chartH} y2={top + chartH} stroke={AXIS_COLOR} strokeWidth={1} />
      {rows.map((r, i) => {
        const barH = (r.value / max) * chartH;
        const xPos = i * slot + (slot - barW) / 2;
        const yPos = top + chartH - barH;
        return (
          <g key={r.key}>
            <rect x={xPos} y={yPos} width={barW} height={barH} fill={colorAt(colors, i, r.key)} />
            <text x={i * slot + slot / 2} y={yPos - 3} fontSize={8} fill={INK} textAnchor="middle">
              {fmt(r.value)}
            </text>
            <text
              x={i * slot + slot / 2}
              y={top + chartH + 12}
              fontSize={8}
              fill={MUTED}
              textAnchor="middle"
            >
              {truncate(displayLabel(r.label, r.key), labelChars)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function BarChart({ colors, rows }: { colors: readonly string[]; rows: BreakdownResult['rows'] }) {
  const w = 620;
  const rowH = 22;
  const labelW = 150;
  const valueW = 46;
  const h = rows.length * rowH + 4;
  const barMax = w - labelW - valueW - 8;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" xmlns="http://www.w3.org/2000/svg">
      {rows.map((r, i) => {
        const yPos = i * rowH;
        const barLen = Math.max(1, (r.value / max) * barMax);
        return (
          <g key={r.key}>
            <text x={labelW - 6} y={yPos + rowH / 2 + 3} fontSize={9} fill={INK} textAnchor="end">
              {truncate(displayLabel(r.label, r.key), 26)}
            </text>
            <rect
              x={labelW}
              y={yPos + 4}
              width={barLen}
              height={rowH - 9}
              fill={colorAt(colors, i, r.key)}
            />
            <text x={labelW + barLen + 4} y={yPos + rowH / 2 + 3} fontSize={9} fill={INK}>
              {fmt(r.value)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** SVG arc path from angle a0 to a1 (radians, 12 o'clock = -π/2). */
function donutArc(
  cx: number,
  cy: number,
  rOut: number,
  rIn: number,
  a0: number,
  a1: number,
): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (r: number, a: number): string => `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
  return [
    `M ${p(rOut, a0)}`,
    `A ${rOut} ${rOut} 0 ${large} 1 ${p(rOut, a1)}`,
    `L ${p(rIn, a1)}`,
    `A ${rIn} ${rIn} 0 ${large} 0 ${p(rIn, a0)}`,
    'Z',
  ].join(' ');
}

function DonutChart({
  colors,
  rows,
}: {
  colors: readonly string[];
  rows: BreakdownResult['rows'];
}) {
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  if (total === 0) return <NoData />;
  const size = 150;
  const cx = size / 2;
  const cy = size / 2;
  let angle = -Math.PI / 2;
  const slices = rows.map((r, i) => {
    const sweep = (r.value / total) * Math.PI * 2;
    // A full circle degenerates as a single arc; nudge the end short of 2π.
    const a1 = angle + Math.min(sweep, Math.PI * 2 - 0.0001);
    const path = donutArc(cx, cy, 66, 38, angle, a1);
    angle = angle + sweep;
    return { key: r.key, path, color: colorAt(colors, i, r.key) };
  });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        role="img"
        xmlns="http://www.w3.org/2000/svg"
      >
        {slices.map((s) => (
          <path key={s.key} d={s.path} fill={s.color} />
        ))}
        <text x={cx} y={cy + 4} fontSize={13} fontWeight={700} fill={INK} textAnchor="middle">
          {fmt(total)}
        </text>
      </svg>
      <div style={{ fontSize: 9 }}>
        {rows.map((r, i) => (
          <div key={r.key} style={{ margin: '2px 0' }}>
            <span
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                background: colorAt(colors, i, r.key),
                marginRight: 4,
                borderRadius: 2,
              }}
            />
            {truncate(displayLabel(r.label, r.key), 30)} — {fmt(r.value)}
          </div>
        ))}
      </div>
    </div>
  );
}

function BreakdownChart({
  colors,
  data,
  chart,
}: {
  colors: readonly string[];
  data: BreakdownResult;
  chart: 'column' | 'bar' | 'donut';
}) {
  if (data.rows.length === 0) return <NoData />;
  if (chart === 'donut') return <DonutChart colors={colors} rows={data.rows} />;
  if (chart === 'bar') return <BarChart colors={colors} rows={data.rows} />;
  return <ColumnChart colors={colors} rows={data.rows} />;
}

// ─── Table ──────────────────────────────────────────────────────────────────

function WidgetTable({ data, dimensionLabel }: { data: TableResult; dimensionLabel: string }) {
  if (data.rows.length === 0) return <NoData />;
  const cell: React.CSSProperties = {
    borderBottom: `1px solid ${GRID_COLOR}`,
    padding: '3px 8px 3px 0',
    fontSize: 9.5,
    textAlign: 'left',
  };
  const num: React.CSSProperties = { ...cell, textAlign: 'right' };
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={{ ...cell, color: MUTED, fontWeight: 600 }}>{dimensionLabel}</th>
          {data.metrics.map((m) => (
            <th key={m.id} style={{ ...num, color: MUTED, fontWeight: 600 }}>
              {m.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.rows.map((r) => (
          <tr key={r.key}>
            <td style={cell}>{truncate(displayLabel(r.label, r.key), 48)}</td>
            {r.values.map((v, i) => (
              <td key={i} style={num}>
                {fmt(v)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Widget dispatch ────────────────────────────────────────────────────────

function WidgetBody({
  colors,
  widget,
  data,
}: DashboardPrintWidget & { colors: readonly string[] }) {
  if (data === null) {
    return (
      <div
        style={{
          border: '1px solid #fca5a5',
          background: '#fef2f2',
          borderRadius: 4,
          padding: '8px 10px',
          fontSize: 9.5,
          color: '#b91c1c',
        }}
      >
        This widget could not be loaded when the report was generated.
      </div>
    );
  }
  if (data.kind === 'kpi' && widget.kind === 'kpi') {
    return <KpiTile data={data} compare={widget.compare} />;
  }
  if (data.kind === 'timeseries' && widget.kind === 'timeseries') {
    return <TimeseriesChart colors={colors} data={data} chart={widget.chart} />;
  }
  if (data.kind === 'breakdown' && widget.kind === 'breakdown') {
    return <BreakdownChart colors={colors} data={data} chart={widget.chart} />;
  }
  if (data.kind === 'table' && widget.kind === 'table') {
    const source = DASHBOARD_SOURCES[widget.source as DashboardSourceId];
    const dimensionLabel = sourceDimension(source, widget.dimension)?.label ?? widget.dimension;
    return <WidgetTable data={data} dimensionLabel={dimensionLabel} />;
  }
  // A kind mismatch can only mean the spec and result drifted mid-flight.
  return <NoData />;
}

// ─── Page ───────────────────────────────────────────────────────────────────

export function DashboardPrintLayout(props: DashboardPrintProps) {
  const sourceLabel = (widget: DashboardWidget): string =>
    DASHBOARD_SOURCES[widget.source as DashboardSourceId]?.label ?? widget.source;

  const branding = props.branding ?? null;
  const colors = resolvePalette(branding?.chartColors);
  const primary = validHex(branding?.primaryColor);
  const logoUrl = branding?.logoUrl ?? null;
  // Mirror `PrintTenantBranding` on the inspection print: a coloured cover
  // band carrying the logo + title in white. Falls back to the plain
  // ink-ruled header when the tenant has set neither logo nor primary.
  const branded = primary !== undefined || logoUrl !== null;
  const coverColor = primary ?? INK;

  return (
    <main
      style={{
        fontFamily: 'Helvetica, Arial, sans-serif',
        fontSize: 12,
        color: INK,
        padding: '28px 32px',
        maxWidth: 820,
      }}
    >
      <header style={{ marginBottom: 12 }}>
        {branded ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 14px',
              borderRadius: 6,
              marginBottom: 10,
              backgroundColor: coverColor,
              color: '#fff',
            }}
          >
            {logoUrl !== null ? (
              // Sessionless Puppeteer resolves the logo via a signed R2 URL in
              // prod; in dev the company-logo route is session-gated, so the
              // image simply won't load (documented in load-branding.ts).
              <img
                src={logoUrl}
                alt="logo"
                style={{
                  height: 34,
                  width: 'auto',
                  objectFit: 'contain',
                  background: 'rgba(255,255,255,0.15)',
                  padding: 3,
                  borderRadius: 4,
                }}
              />
            ) : null}
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: 1,
                  textTransform: 'uppercase',
                  opacity: 0.85,
                }}
              >
                Dashboard · {props.tenantName}
              </div>
              <h1 style={{ fontSize: 20, margin: '2px 0 0', color: '#fff' }}>{props.title}</h1>
            </div>
          </div>
        ) : (
          <div style={{ borderBottom: `2px solid ${INK}`, paddingBottom: 10, marginBottom: 10 }}>
            <div style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' }}>
              Dashboard · {props.tenantName}
            </div>
            <h1 style={{ fontSize: 20, margin: '2px 0 4px' }}>{props.title}</h1>
          </div>
        )}
        {props.description !== null && props.description.length > 0 ? (
          <div style={{ fontSize: 11, color: '#444', marginBottom: 2 }}>{props.description}</div>
        ) : null}
        <div style={{ fontSize: 10, color: MUTED }}>
          Generated {formatDateTime(props.generatedAt)} · Date range {formatDate(props.range.from)}
          {' – '}
          {/* `to` is exclusive; show the last included day. */}
          {formatDate(new Date(new Date(props.range.to).getTime() - 1))}
          {props.siteCount > 0 ? ` · Filtered to ${props.siteCount} site(s)` : ''}
        </div>
        {props.status !== 'published' ? (
          <div style={{ marginTop: 6, fontWeight: 700, color: '#8a6d00', fontSize: 11 }}>
            {props.status === 'draft'
              ? 'DRAFT — this dashboard has not been published.'
              : 'ARCHIVED — retained for record; no longer maintained.'}
          </div>
        ) : null}
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {props.widgets.map(({ widget, data }) => (
          <section
            key={widget.id}
            style={{
              gridColumn: `span ${widgetSpan(widget)}`,
              border: `1px solid ${GRID_COLOR}`,
              borderRadius: 6,
              padding: '8px 10px',
              breakInside: 'avoid',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <h2 style={{ fontSize: 11, fontWeight: 700, margin: '0 0 6px' }}>{widget.title}</h2>
              <span style={{ fontSize: 8.5, color: MUTED, whiteSpace: 'nowrap' }}>
                {sourceLabel(widget)}
              </span>
            </div>
            <WidgetBody colors={colors} widget={widget} data={data} />
          </section>
        ))}
      </div>
    </main>
  );
}
