'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { brandHasModule } from '@forma360/shared/brand';
import { grantsAdminAccess } from '@forma360/permissions/catalogue';
import { activeBrand } from '../../../src/lib/brand';
import { usePermissionList } from '../../../src/lib/permissions-context';
import { Card, CardContent, CardHeader, CardTitle } from '../../../src/components/ui/card';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { trpc } from '../../../src/lib/trpc/client';
import { cn } from '../../../src/lib/cn';

/**
 * Cross-module dashboard (platform HSE review PF-5). One screen that answers
 * "what needs attention today?" and "how are we trending?" — needs-attention
 * tiles (each linking into the module's own filtered list), 8-week trend
 * charts (inline SVG — no chart dependency) and a site-vs-site table.
 */

interface TileProps {
  label: string;
  value: number | null | undefined;
  href: string;
  /** Secondary line, e.g. "3 overdue". */
  sub?: string | undefined;
  /** Paint the number red when it demands attention. */
  alert?: boolean;
  loading?: boolean;
}

function Tile({ label, value, href, sub, alert = false, loading = false }: TileProps) {
  return (
    <Link href={href} className="block">
      <Card className="h-full transition-colors hover:border-primary/40 hover:bg-muted/30">
        <CardContent className="p-4">
          {loading ? (
            <Skeleton className="h-8 w-16" />
          ) : (
            <p
              className={cn(
                'text-3xl font-semibold tabular-nums tracking-tight',
                alert && (value ?? 0) > 0 ? 'text-destructive' : undefined,
              )}
            >
              {value ?? 0}
            </p>
          )}
          <p className="mt-1 text-sm font-medium">{label}</p>
          {sub !== undefined ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
        </CardContent>
      </Card>
    </Link>
  );
}

/**
 * Grouped-bar chart for two weekly series. Pure SVG: width scales to the
 * container, bars are laid out on a fixed 8-week viewBox grid.
 */
function TrendBars({
  a,
  b,
  aLabel,
  bLabel,
  weekLabel,
}: {
  a: readonly number[];
  b: readonly number[];
  aLabel: string;
  bLabel: string;
  weekLabel: (offsetWeeks: number) => string;
}) {
  const weeks = a.length;
  const max = Math.max(1, ...a, ...b);
  const chartH = 120;
  const groupW = 40;
  const barW = 13;
  const width = weeks * groupW;
  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${chartH + 18}`}
        className="w-full"
        role="img"
        aria-label={`${aLabel} / ${bLabel}`}
      >
        {a.map((v, i) => {
          const hA = Math.round((v / max) * chartH);
          const hB = Math.round(((b[i] ?? 0) / max) * chartH);
          const x = i * groupW + (groupW - barW * 2 - 2) / 2;
          return (
            <g key={i}>
              <rect
                x={x}
                y={chartH - hA}
                width={barW}
                height={hA}
                rx={2}
                className="fill-primary"
              />
              <rect
                x={x + barW + 2}
                y={chartH - hB}
                width={barW}
                height={hB}
                rx={2}
                className="fill-primary/40"
              />
              <text
                x={i * groupW + groupW / 2}
                y={chartH + 13}
                textAnchor="middle"
                className="fill-muted-foreground text-[9px]"
              >
                {weekLabel(weeks - 1 - i)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-primary" aria-hidden="true" />
          {aLabel}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-primary/40" aria-hidden="true" />
          {bLabel}
        </span>
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const t = useTranslations('analytics');
  const perms = usePermissionList();
  const isAdmin = grantsAdminAccess(perms);

  const dashboard = trpc.analytics.dashboard.useQuery();
  const trends = trpc.analytics.trends.useQuery();
  const sitesQ = trpc.analytics.siteComparison.useQuery();
  // The fire tile reuses the fire-safety module's own overview procedure so
  // the needs-attention semantics live in exactly one place. It needs
  // fireSafety.view — skip the query (and the tile) without it.
  const canSeeFire =
    brandHasModule(activeBrand.id, 'fireSafety') && (isAdmin || perms.includes('fireSafety.view'));
  const fire = trpc.fireSafety.overview.useQuery(undefined, { enabled: canSeeFire });

  const d = dashboard.data;
  const loading = dashboard.isLoading;
  const fireAttention =
    fire.data === undefined
      ? 0
      : fire.data.checksOverdue +
        fire.data.checksFailed +
        fire.data.doorsOverdue +
        fire.data.doorsFailed +
        fire.data.frasReviewDue +
        fire.data.frasIntolerable +
        fire.data.peepReviewsDue +
        fire.data.marshalGaps;

  return (
    <div className="space-y-6 px-4 py-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      <section aria-label={t('tiles.sectionLabel')}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          <Tile
            label={t('tiles.myOpenActions')}
            value={d?.actions.myOpen}
            href={`/${locale}/actions?mine=1`}
            loading={loading}
          />
          <Tile
            label={t('tiles.overdueActions')}
            value={d?.actions.overdue}
            href={`/${locale}/actions?overdue=1`}
            sub={t('tiles.dueSoon', { count: d?.actions.dueSoon ?? 0 })}
            alert
            loading={loading}
          />
          <Tile
            label={t('tiles.openObservations')}
            value={d?.observations.open}
            href={`/${locale}/observations`}
            sub={t('tiles.highPriority', { count: d?.observations.highPriority ?? 0 })}
            loading={loading}
          />
          <Tile
            label={t('tiles.awaitingApproval')}
            value={d?.inspections.awaitingApproval}
            href={`/${locale}/approvals`}
            sub={t('tiles.inProgress', { count: d?.inspections.inProgress ?? 0 })}
            loading={loading}
          />
          <Tile
            label={t('tiles.missedInspections')}
            value={d?.schedule.missedLast30}
            href={`/${locale}/schedules`}
            sub={t('tiles.upcoming7', { count: d?.schedule.upcoming7d ?? 0 })}
            alert
            loading={loading}
          />
          <Tile
            label={t('tiles.pendingAcks')}
            value={d?.headsUp.myPendingAcks}
            href={`/${locale}/heads-up`}
            alert
            loading={loading}
          />
          {d?.permits != null ? (
            <Tile
              label={t('tiles.openPermits')}
              value={d.permits.open}
              href={`/${locale}/permits/board`}
              sub={t('tiles.expiring48h', { count: d.permits.expiring48h })}
              loading={loading}
            />
          ) : null}
          {d?.riskAssessments != null ? (
            <Tile
              label={t('tiles.raReviewOverdue')}
              value={d.riskAssessments.reviewOverdue}
              href={`/${locale}/risk-assessments`}
              sub={t('tiles.raActive', { count: d.riskAssessments.active })}
              alert
              loading={loading}
            />
          ) : null}
          {d?.coshh != null ? (
            <Tile
              label={t('tiles.coshhReviewDue')}
              value={d.coshh.assessmentsReviewOverdue}
              href={`/${locale}/coshh`}
              sub={t('tiles.coshhSubstances', { count: d.coshh.substancesActive })}
              alert
              loading={loading}
            />
          ) : null}
          {canSeeFire ? (
            <Tile
              label={t('tiles.fireAttention')}
              value={fireAttention}
              href={`/${locale}/fire-safety`}
              alert
              loading={fire.isLoading}
            />
          ) : null}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2" aria-label={t('trends.sectionLabel')}>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('trends.actionsTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            {trends.isLoading || trends.data === undefined ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <TrendBars
                a={trends.data.actionsCreated}
                b={trends.data.actionsCompleted}
                aLabel={t('trends.actionsCreated')}
                bLabel={t('trends.actionsCompleted')}
                weekLabel={(off) => (off === 0 ? t('trends.thisWeek') : `-${off}`)}
              />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('trends.activityTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            {trends.isLoading || trends.data === undefined ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <TrendBars
                a={trends.data.inspectionsCompleted}
                b={trends.data.observationsRaised}
                aLabel={t('trends.inspectionsCompleted')}
                bLabel={t('trends.observationsRaised')}
                weekLabel={(off) => (off === 0 ? t('trends.thisWeek') : `-${off}`)}
              />
            )}
          </CardContent>
        </Card>
      </section>

      <section aria-label={t('sites.sectionLabel')}>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('sites.title')}</CardTitle>
            <p className="text-sm text-muted-foreground">{t('sites.subtitle')}</p>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t('sites.site')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('sites.openActions')}</th>
                    <th className="px-3 py-2 text-right font-medium">
                      {t('sites.openObservations')}
                    </th>
                    <th className="px-3 py-2 text-right font-medium">{t('sites.completed30')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sitesQ.isLoading ? (
                    <tr>
                      <td colSpan={4} className="p-4">
                        <Skeleton className="h-5 w-full" />
                      </td>
                    </tr>
                  ) : (sitesQ.data?.rows.length ?? 0) === 0 ? (
                    <tr>
                      <td colSpan={4} className="p-4 text-center text-muted-foreground">
                        {t('sites.empty')}
                      </td>
                    </tr>
                  ) : (
                    <>
                      {sitesQ.data?.rows.map((r) => (
                        <tr key={r.siteId} className="border-b last:border-0">
                          <td className="px-3 py-2">
                            <Link
                              href={`/${locale}/sites/${r.siteId}`}
                              className="font-medium hover:underline"
                            >
                              {r.siteName}
                            </Link>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.openActions}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {r.openObservations}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {r.inspectionsCompleted30d}
                          </td>
                        </tr>
                      ))}
                      {sitesQ.data !== undefined &&
                      sitesQ.data.unattributed.openActions +
                        sitesQ.data.unattributed.openObservations +
                        sitesQ.data.unattributed.inspectionsCompleted30d >
                        0 ? (
                        <tr className="text-muted-foreground">
                          <td className="px-3 py-2 italic">{t('sites.noSite')}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {sitesQ.data.unattributed.openActions}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {sitesQ.data.unattributed.openObservations}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {sitesQ.data.unattributed.inspectionsCompleted30d}
                          </td>
                        </tr>
                      ) : null}
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
