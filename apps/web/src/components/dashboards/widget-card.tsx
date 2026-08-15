'use client';

/**
 * One dashboard widget: chart + hover detail + per-widget menu (Excel
 * download, open the source register). Chart colours come from the
 * tenant-themable --chart-N CSS variables with hard fallbacks.
 */
import {
  widgetSpan,
  type DashboardDateRange,
  type DashboardWidget,
} from '@forma360/shared/dashboard-spec';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowDownRight,
  ArrowUpRight,
  Download,
  ExternalLink,
  Lock,
  MoreHorizontal,
  Sparkles,
} from 'lucide-react';
import { DASHBOARD_SOURCES, type DashboardSourceId } from '@forma360/shared/dashboard-sources';
import { registerHref } from '../../lib/dashboard-links';
import { cn } from '../../lib/cn';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Skeleton } from '../ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Button } from '../ui/button';
import { WidgetAiDialog } from './widget-ai-dialog';

/** Mirror of the executor's WidgetData union (client side). */
export interface WidgetMetaShape {
  dateRangeApplied: boolean;
  siteFilterApplied: boolean;
  range: { from: string; to: string };
}
export type WidgetDataShape =
  | { kind: 'kpi'; value: number; previous?: number; meta: WidgetMetaShape }
  | {
      kind: 'timeseries';
      buckets: string[];
      series: Array<{ key: string; label: string | null; values: number[] }>;
      meta: WidgetMetaShape;
    }
  | {
      kind: 'breakdown';
      rows: Array<{ key: string; label: string | null; value: number }>;
      meta: WidgetMetaShape;
    }
  | {
      kind: 'table';
      metrics: Array<{ id: string; label: string }>;
      rows: Array<{ key: string; label: string | null; values: number[] }>;
      meta: WidgetMetaShape;
    }
  | { error: 'forbidden' | 'module-disabled' | 'failed' };

const CHART_FALLBACKS = [
  '#2563eb',
  '#0d9488',
  '#d97706',
  '#dc2626',
  '#7c3aed',
  '#059669',
  '#db2777',
  '#64748b',
] as const;

function chartColor(index: number): string {
  const fallback = CHART_FALLBACKS[index % CHART_FALLBACKS.length];
  return `var(--chart-${(index % 8) + 1}, ${fallback})`;
}

function formatBucket(iso: string, locale: string, bucket: 'day' | 'week' | 'month'): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (bucket === 'month') {
    return new Intl.DateTimeFormat(locale, {
      month: 'short',
      year: '2-digit',
      timeZone: 'UTC',
    }).format(date);
  }
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(date);
}

export interface WidgetCardProps {
  widget: DashboardWidget;
  data: WidgetDataShape | undefined;
  locale: string;
  /** Query string (already encoded) reproducing the current filters. */
  exportQuery: string;
  dashboardId: string;
  /** Structured current filters — passed to the per-widget AI chat. */
  filters: { dateRange: DashboardDateRange; siteIds: readonly string[] };
}

export function WidgetCard({
  widget,
  data,
  locale,
  exportQuery,
  dashboardId,
  filters,
}: WidgetCardProps) {
  const t = useTranslations('dashboards');
  const source = DASHBOARD_SOURCES[widget.source as DashboardSourceId];
  const nf = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const span = widgetSpan(widget);
  const [aiOpen, setAiOpen] = useState(false);

  const noneLabel = t('widget.noneBucket');
  const otherLabel = t('widget.otherBucket');
  const labelOf = (label: string | null, key?: string): string => {
    if (label === null) return noneLabel;
    if (label === '__other' || key === '__other') return otherLabel;
    return label;
  };

  const spanClass = span >= 3 ? 'md:col-span-3' : span === 2 ? 'md:col-span-2' : 'md:col-span-1';

  const body = (() => {
    if (data === undefined) {
      return <Skeleton className="h-40 w-full" />;
    }
    if ('error' in data) {
      return (
        <div className="flex h-40 flex-col items-center justify-center gap-2 text-muted-foreground">
          <Lock className="h-5 w-5" aria-hidden />
          <p className="text-sm">
            {data.error === 'forbidden'
              ? t('widget.forbidden')
              : data.error === 'module-disabled'
                ? t('widget.moduleDisabled')
                : t('widget.failed')}
          </p>
        </div>
      );
    }

    if (data.kind === 'kpi') {
      const delta =
        data.previous !== undefined && data.previous > 0
          ? ((data.value - data.previous) / data.previous) * 100
          : data.previous !== undefined && data.value > 0
            ? 100
            : undefined;
      return (
        <div>
          <p className="text-4xl font-semibold tabular-nums tracking-tight">
            {nf.format(data.value)}
          </p>
          {data.previous !== undefined ? (
            <p
              className={cn(
                'mt-1 flex items-center gap-1 text-sm',
                (delta ?? 0) === 0
                  ? 'text-muted-foreground'
                  : (delta ?? 0) > 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-destructive',
              )}
            >
              {(delta ?? 0) >= 0 ? (
                <ArrowUpRight className="h-4 w-4" aria-hidden />
              ) : (
                <ArrowDownRight className="h-4 w-4" aria-hidden />
              )}
              {delta === undefined ? '—' : `${delta > 0 ? '+' : ''}${delta.toFixed(0)}%`}
              <span className="text-muted-foreground">
                {t('widget.vsPrevious', { value: nf.format(data.previous) })}
              </span>
            </p>
          ) : null}
          <p className="mt-2 text-xs text-muted-foreground">
            {data.meta.dateRangeApplied ? t('widget.inRange') : t('widget.liveCount')}
          </p>
        </div>
      );
    }

    if (data.kind === 'timeseries') {
      const rows = data.buckets.map((bucket, i) => {
        const row: Record<string, number | string> = {
          bucket: formatBucket(
            bucket,
            locale,
            widget.kind === 'timeseries' ? widget.bucket : 'week',
          ),
        };
        data.series.forEach((s, si) => {
          row[`s${si}`] = s.values[i] ?? 0;
        });
        return row;
      });
      const multi = data.series.length > 1;
      const chart = widget.kind === 'timeseries' ? widget.chart : 'line';
      const ChartComponent = chart === 'bar' ? BarChart : chart === 'area' ? AreaChart : LineChart;
      return (
        <ResponsiveContainer width="100%" height={220}>
          <ChartComponent data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
            <XAxis dataKey="bucket" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <Tooltip
              cursor={{ fill: 'var(--color-muted)', opacity: 0.35 }}
              contentStyle={{
                background: 'var(--color-popover)',
                border: '1px solid var(--color-border)',
                borderRadius: 8,
                fontSize: 12,
              }}
              labelFormatter={(label) => `${String(label)} · ${source.label}`}
            />
            {multi ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
            {data.series.map((s, si) =>
              chart === 'bar' ? (
                <Bar
                  key={s.key}
                  dataKey={`s${si}`}
                  name={multi ? labelOf(s.label, s.key) : widget.title}
                  fill={chartColor(si)}
                  radius={[3, 3, 0, 0]}
                  {...(multi ? { stackId: 'stack' } : {})}
                />
              ) : chart === 'area' ? (
                <Area
                  key={s.key}
                  dataKey={`s${si}`}
                  name={multi ? labelOf(s.label, s.key) : widget.title}
                  stroke={chartColor(si)}
                  fill={chartColor(si)}
                  fillOpacity={0.18}
                  strokeWidth={2}
                  type="monotone"
                />
              ) : (
                <Line
                  key={s.key}
                  dataKey={`s${si}`}
                  name={multi ? labelOf(s.label, s.key) : widget.title}
                  stroke={chartColor(si)}
                  strokeWidth={2}
                  dot={false}
                  type="monotone"
                />
              ),
            )}
          </ChartComponent>
        </ResponsiveContainer>
      );
    }

    if (data.kind === 'breakdown') {
      const chart = widget.kind === 'breakdown' ? widget.chart : 'column';
      const rows = data.rows.map((r) => ({ name: labelOf(r.label, r.key), value: r.value }));
      if (chart === 'donut') {
        return (
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Tooltip
                contentStyle={{
                  background: 'var(--color-popover)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Pie
                data={rows}
                dataKey="value"
                nameKey="name"
                innerRadius={55}
                outerRadius={85}
                strokeWidth={1}
              >
                {rows.map((_, i) => (
                  <Cell key={i} fill={chartColor(i)} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        );
      }
      const horizontal = chart === 'bar';
      return (
        <ResponsiveContainer
          width="100%"
          height={Math.max(180, rows.length * (horizontal ? 34 : 0) + (horizontal ? 40 : 220))}
        >
          <BarChart
            data={rows}
            layout={horizontal ? 'vertical' : 'horizontal'}
            margin={{ top: 8, right: 8, bottom: 0, left: horizontal ? 40 : -18 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--color-border)"
              vertical={!horizontal}
              horizontal={horizontal ? false : true}
            />
            {horizontal ? (
              <>
                <XAxis
                  type="number"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={110}
                />
              </>
            ) : (
              <>
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
              </>
            )}
            <Tooltip
              cursor={{ fill: 'var(--color-muted)', opacity: 0.35 }}
              contentStyle={{
                background: 'var(--color-popover)',
                border: '1px solid var(--color-border)',
                borderRadius: 8,
                fontSize: 12,
              }}
              labelFormatter={(label) => `${String(label)} · ${source.label}`}
            />
            <Bar
              dataKey="value"
              name={widget.title}
              radius={horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0]}
            >
              {rows.map((_, i) => (
                <Cell key={i} fill={chartColor(i)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      );
    }

    // table
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-4 font-medium">{t('widget.tableDimension')}</th>
              {data.metrics.map((m) => (
                <th key={m.id} className="py-2 pr-4 text-right font-medium">
                  {m.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 ? (
              <tr>
                <td
                  colSpan={1 + data.metrics.length}
                  className="py-6 text-center text-muted-foreground"
                >
                  {t('widget.noData')}
                </td>
              </tr>
            ) : (
              data.rows.map((row) => (
                <tr key={row.key} className="border-b last:border-0">
                  <td className="py-2 pr-4">{labelOf(row.label, row.key)}</td>
                  {row.values.map((v, vi) => (
                    <td key={vi} className="py-2 pr-4 text-right tabular-nums">
                      {nf.format(v)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    );
  })();

  const hasData = data !== undefined && !('error' in data);

  return (
    <Card className={cn('min-w-0', spanClass)}>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
        <div className="min-w-0">
          <CardTitle className="truncate text-sm font-medium">{widget.title}</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">{source.label}</p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {/* Per-widget AI: ask questions grounded in THIS widget's data. */}
          {hasData ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-primary"
              aria-label={t('widgetChat.open')}
              title={t('widgetChat.open')}
              onClick={() => setAiOpen(true)}
            >
              <Sparkles className="h-4 w-4" />
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={t('widget.menu')}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {hasData ? (
                <DropdownMenuItem asChild>
                  <a
                    href={`/api/exports/widget-xlsx?dashboardId=${dashboardId}&widgetId=${widget.id}&${exportQuery}`}
                  >
                    <Download className="mr-2 h-4 w-4" aria-hidden />
                    {t('widget.downloadExcel')}
                  </a>
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem asChild>
                <Link href={registerHref(locale, widget.source as DashboardSourceId)}>
                  <ExternalLink className="mr-2 h-4 w-4" aria-hidden />
                  {t('widget.openRegister')}
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent>{body}</CardContent>
      {hasData ? (
        <WidgetAiDialog
          open={aiOpen}
          onOpenChange={setAiOpen}
          dashboardId={dashboardId}
          widgetId={widget.id}
          widgetTitle={widget.title}
          filters={filters}
        />
      ) : null}
    </Card>
  );
}
