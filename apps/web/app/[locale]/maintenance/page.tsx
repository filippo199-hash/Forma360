'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Button } from '../../../src/components/ui/button';
import { Card, CardContent } from '../../../src/components/ui/card';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { useHasPermission } from '../../../src/lib/permissions-context';
import { trpc } from '../../../src/lib/trpc/client';

type MaintenanceStatus = 'awaiting_first_reading' | 'on_schedule' | 'approaching' | 'overdue';

const STATUS_COLORS: Record<MaintenanceStatus, string> = {
  awaiting_first_reading: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-100',
  on_schedule: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100',
  approaching: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100',
  overdue: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-100',
};

export default function MaintenancePage() {
  const t = useTranslations('maintenancePlans.table');
  const tList = useTranslations('maintenancePlans.list');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const canManage = useHasPermission('assets.maintenance.manage');

  const { data: plansData, isLoading: plansLoading } = trpc.maintenancePlans.list.useQuery();
  const { data: tableData, isLoading: tableLoading } = trpc.maintenancePlans.table.useQuery();
  const plans = plansData ?? [];
  const rows = tableData ?? [];

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {canManage ? (
          <Button asChild size="sm">
            <Link href={`/${locale}/maintenance/new`}>
              <Plus className="mr-1.5 h-4 w-4" />
              {tList('newButton')}
            </Link>
          </Button>
        ) : null}
      </header>

      {/* Plans list */}
      {plansLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : plans.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <p className="mb-3">{t('empty')}</p>
            {canManage ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`/${locale}/maintenance/new`}>
                  <Plus className="mr-1.5 h-4 w-4" />
                  {tList('newButton')}
                </Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => {
            const planRows = rows.filter((r) => r.planId === plan.id);
            const overdueCount = planRows.filter((r) => r.status === 'overdue').length;
            const approachingCount = planRows.filter((r) => r.status === 'approaching').length;
            return (
              <Link
                key={plan.id}
                href={`/${locale}/maintenance/${plan.id}`}
                className="block"
              >
                <Card className="transition-shadow hover:shadow-md">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium leading-tight">{plan.name}</p>
                      {overdueCount > 0 ? (
                        <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                          {tList('overdueBadge', { count: overdueCount })}
                        </span>
                      ) : approachingCount > 0 ? (
                        <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                          {tList('approachingBadge', { count: approachingCount })}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t(`planType.${plan.planType}`)} · {planRows.length} {tList('assetsLinked')}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {/* Full schedule table */}
      {rows.length > 0 ? (
        <div>
          <h2 className="mb-3 text-base font-semibold">{tList('scheduleTableHeading')}</h2>
          {tableLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <Card>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40">
                    <tr className="text-left">
                      <th className="px-3 py-2 font-medium">{t('columns.asset')}</th>
                      <th className="px-3 py-2 font-medium">{t('columns.plan')}</th>
                      <th className="px-3 py-2 font-medium">{t('columns.type')}</th>
                      <th className="px-3 py-2 font-medium">{t('columns.lastService')}</th>
                      <th className="px-3 py-2 font-medium">{t('columns.status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => {
                      const status = row.status as MaintenanceStatus;
                      return (
                        <tr
                          key={`${row.planId}-${row.assetId ?? i}`}
                          className="border-b last:border-0 hover:bg-muted/30"
                        >
                          <td className="px-3 py-2 font-medium">
                            {row.assetId !== null ? (
                              <Link
                                href={`/${locale}/assets/${row.assetId}`}
                                className="hover:underline"
                              >
                                {row.assetName ?? row.assetId}
                              </Link>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {row.planId !== null ? (
                              <Link
                                href={`/${locale}/maintenance/${row.planId}`}
                                className="hover:underline"
                              >
                                {row.planName ?? row.planId}
                              </Link>
                            ) : '—'}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {t(`planType.${row.planType ?? 'time'}`)}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {row.lastServiceDate !== null ? row.lastServiceDate : '—'}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[status] ?? STATUS_COLORS.on_schedule}`}
                            >
                              {t(`status.${status}`)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </div>
      ) : null}
    </div>
  );
}
