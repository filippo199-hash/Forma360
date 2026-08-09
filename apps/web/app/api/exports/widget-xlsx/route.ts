/**
 * Per-widget Excel download (ADR 0018).
 *
 * GET ?dashboardId&widgetId[&range=preset|&from&to][&sites=id,id]
 *
 * Session-gated; the tRPC `dashboards.widgetData` procedure re-runs the
 * full access chain (entitlement, dashboard visibility, per-source
 * permission) — this route only formats the rows into a real .xlsx via
 * the SheetJS dependency the workspace already carries.
 */
import { headers } from 'next/headers';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import { DATE_RANGE_PRESETS } from '@forma360/shared/dashboard-spec';
import { auth } from '../../../../src/server/auth';
import { createServerCaller } from '../../../../src/server/server-caller';

const querySchema = z.object({
  dashboardId: z.string().length(26),
  widgetId: z.string().min(1).max(40),
  range: z.enum(DATE_RANGE_PRESETS).optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  sites: z.string().max(2000).optional(),
});

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  if (!session || typeof session.user.tenantId !== 'string') {
    return new Response('Unauthorized', { status: 401 });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) return new Response('Bad request', { status: 400 });
  const query = parsed.data;

  const dateRange =
    query.range ??
    (query.from !== undefined && query.to !== undefined && query.from <= query.to
      ? { from: query.from, to: query.to }
      : undefined);
  const siteIds =
    query.sites !== undefined ? query.sites.split(',').filter((s) => s.length === 26) : undefined;

  const caller = await createServerCaller({
    tenantId: session.user.tenantId,
    userId: session.user.id,
    email: session.user.email,
  });

  let result: Awaited<ReturnType<typeof caller.dashboards.widgetData>>;
  try {
    result = await caller.dashboards.widgetData({
      id: query.dashboardId,
      widgetId: query.widgetId,
      ...(dateRange !== undefined || siteIds !== undefined
        ? {
            filters: {
              ...(dateRange !== undefined ? { dateRange } : {}),
              ...(siteIds !== undefined ? { siteIds } : {}),
            },
          }
        : {}),
    });
  } catch {
    return new Response('Not available', { status: 404 });
  }

  const data = result.data;
  const rows: Array<Array<string | number>> = [];
  if (data.kind === 'kpi') {
    rows.push(['Value', data.value]);
    if (data.previous !== undefined) rows.push(['Previous period', data.previous]);
  } else if (data.kind === 'timeseries') {
    rows.push(['Bucket', ...data.series.map((s) => s.label ?? s.key)]);
    data.buckets.forEach((bucket, i) => {
      rows.push([bucket, ...data.series.map((s) => s.values[i] ?? 0)]);
    });
  } else if (data.kind === 'breakdown') {
    rows.push(['Label', 'Value']);
    for (const row of data.rows) rows.push([row.label ?? row.key, row.value]);
  } else {
    rows.push(['Label', ...data.metrics.map((m) => m.label)]);
    for (const row of data.rows) rows.push([row.label ?? row.key, ...row.values]);
  }
  rows.push([]);
  rows.push(['Range', `${data.meta.range.from} – ${data.meta.range.to}`]);

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Data');
  const bytes = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${query.widgetId}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
