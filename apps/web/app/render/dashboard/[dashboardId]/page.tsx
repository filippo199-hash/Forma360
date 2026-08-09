/**
 * Internal Puppeteer render target for custom dashboards (ADR 0018).
 * HMAC-gated via the `?token=` query string — see `@forma360/render`'s
 * `signRenderToken` / `verifyRenderToken`. Any request without a valid
 * token is 404ed (not 401: we don't want automated scanners to learn
 * the route exists).
 *
 * Not `[locale]`-prefixed: Puppeteer has no session — the route serves a
 * single-purpose print HTML page, not a user-facing view. Every widget
 * is executed server-side with the spec's own filter defaults and
 * rendered as static HTML/SVG so the print is hydration-free.
 */
import { executeWidget, resolveDateRange } from '@forma360/api/dashboards/executor';
import { dashboards } from '@forma360/db/schema';
import { parseDashboardSpec } from '@forma360/shared/dashboard-spec';
import { verifyRenderToken, loadDashboardSnapshot } from '@forma360/render';
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import {
  DashboardPrintLayout,
  type DashboardPrintBranding,
  type DashboardPrintWidget,
} from '../../../../src/components/dashboard-print-layout';
import { env } from '../../../../src/server/env';
import { db } from '../../../../src/server/db';
import { loadTenantBrandingById } from '../../../../src/server/load-branding';

interface Props {
  params: Promise<{ dashboardId: string }>;
  searchParams: Promise<{ token?: string }>;
}

export default async function RenderDashboardPage({ params, searchParams }: Props) {
  const [{ dashboardId }, { token }] = await Promise.all([params, searchParams]);
  if (typeof token !== 'string') notFound();
  // The token signs the subject id (the field is named for its original
  // inspection use); a tampered id breaks the signature.
  const ok = verifyRenderToken({
    secret: env.RENDER_SHARED_SECRET,
    inspectionId: dashboardId,
    token,
  });
  if (!ok) notFound();

  // No session on this route — trust the HMAC + id binding, mirroring
  // /render/fra. ULIDs are globally unique so the tenant lookup by id
  // alone cannot cross tenants.
  const rows = await db
    .select({ tenantId: dashboards.tenantId })
    .from(dashboards)
    .where(eq(dashboards.id, dashboardId))
    .limit(1);
  const row = rows[0];
  if (row === undefined) notFound();

  const snapshot = await loadDashboardSnapshot(db, { tenantId: row.tenantId, dashboardId });
  if (snapshot === null) notFound();

  // A row written by a newer schema version must degrade to a 404, not a
  // misrender — the renderer maps this to its "not found" error.
  const parsed = parseDashboardSpec(snapshot.dashboard.spec);
  if (!parsed.ok) notFound();
  const spec = parsed.spec;

  const now = new Date();
  const filters = {
    dateRange: spec.filterDefaults.dateRange,
    siteIds: spec.filterDefaults.siteIds,
  };

  const widgets: DashboardPrintWidget[] = await Promise.all(
    spec.widgets.map(async (widget) => {
      try {
        const data = await executeWidget({
          db,
          tenantId: row.tenantId,
          widget,
          filters,
          now,
        });
        return { widget, data };
      } catch {
        // One bad widget must not blank the whole report — the layout
        // prints an explicit error box for it (mirrors dashboards.data).
        return { widget, data: null };
      }
    }),
  );

  const range = resolveDateRange(filters.dateRange, now);

  // ADR 0018: the tenant palette + logo re-skin the whole app AND its PDFs.
  // The dashboard grid reads `--chart-N` from the injected tenant theme; the
  // sessionless print has no CSS vars, so we hand the palette + logo in here.
  const tenant = await loadTenantBrandingById(row.tenantId);
  const branding: DashboardPrintBranding = {
    logoUrl: tenant.logoUrl,
    ...(tenant.branding?.primaryColor !== undefined
      ? { primaryColor: tenant.branding.primaryColor }
      : {}),
    ...(tenant.branding?.chartColors !== undefined
      ? { chartColors: tenant.branding.chartColors }
      : {}),
  };

  return (
    <DashboardPrintLayout
      title={snapshot.dashboard.title}
      description={snapshot.dashboard.description}
      status={snapshot.dashboard.status}
      tenantName={snapshot.tenantName}
      generatedAt={now.toISOString()}
      range={{ from: range.from.toISOString(), to: range.to.toISOString() }}
      siteCount={filters.siteIds.length}
      widgets={widgets}
      branding={branding}
    />
  );
}
