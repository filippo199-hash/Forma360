'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Card, CardContent } from '../../../src/components/ui/card';
import { Skeleton } from '../../../src/components/ui/skeleton';
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
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';

  const { data, isLoading } = trpc.maintenancePlans.table.useQuery();
  const rows = data ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <p>{t('empty')}</p>
          </CardContent>
        </Card>
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
                      <td className="px-3 py-2 text-muted-foreground">{row.planName ?? '—'}</td>
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
  );
}
