'use client';

/**
 * The live permit board — every open permit across the estate, right now.
 *
 * Built for a control-room screen: grouped by site, overdue first, big
 * status counts on top, and a 60-second auto-refresh so the view stays
 * live without anyone touching it.
 */
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  CategoryChip,
  CountdownChip,
  PermitStatusChip,
} from '../../../../src/components/permits/chips';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { trpc } from '../../../../src/lib/trpc/client';
import { formatTime } from '../../../../src/lib/format-date';

export default function PermitBoardPage() {
  const t = useTranslations('permits.board');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';

  const { data, isLoading, dataUpdatedAt } = trpc.permits.board.useQuery(undefined, {
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const rows = data?.permits ?? [];
  const counts = {
    overdue: rows.filter((r) => r.overdue).length,
    active: rows.filter((r) => r.status === 'active' && !r.overdue).length,
    issued: rows.filter((r) => r.status === 'issued' && !r.overdue).length,
    suspended: rows.filter((r) => r.status === 'suspended' && !r.overdue).length,
  };

  // Group by site, keeping the router's overdue-first ordering inside each
  // group. Site-less permits gather under their own heading at the end.
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.siteName ?? '';
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  const orderedGroups = [...groups.entries()].sort((a, b) => {
    if (a[0] === '') return 1;
    if (b[0] === '') return -1;
    return a[0].localeCompare(b[0]);
  });

  const stat = (value: number, label: string, alarm: boolean) => (
    <Card className={alarm && value > 0 ? 'border-red-300 dark:border-red-800' : ''}>
      <CardContent className="p-4">
        <p
          className={
            alarm && value > 0
              ? 'text-3xl font-semibold text-red-600 dark:text-red-400'
              : 'text-3xl font-semibold'
          }
        >
          {value}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4 sm:space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href={`/${locale}/permits`}
            className="mb-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            {t('backToRegister')}
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          {t('lastUpdated', {
            time: formatTime(dataUpdatedAt, locale),
          })}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stat(counts.overdue, t('counts.overdue'), true)}
        {stat(counts.active, t('counts.active'), false)}
        {stat(counts.issued, t('counts.issued'), false)}
        {stat(counts.suspended, t('counts.suspended'), false)}
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="p-4">
            <Skeleton className="h-24 w-full" />
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">{t('empty')}</CardContent>
        </Card>
      ) : (
        orderedGroups.map(([siteName, sitePermits]) => (
          <section key={siteName === '' ? '__unsited' : siteName} className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground">
              {siteName === '' ? t('noSite') : siteName}
              <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-medium">
                {sitePermits.length}
              </span>
            </h2>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {sitePermits.map((row) => (
                <Link key={row.id} href={`/${locale}/permits/${row.id}`} className="block">
                  <Card
                    className={
                      row.overdue
                        ? 'border-red-300 transition-colors hover:bg-muted/30 dark:border-red-800'
                        : 'transition-colors hover:bg-muted/30'
                    }
                  >
                    <CardContent className="space-y-2 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 truncate font-medium">{row.title}</p>
                        <PermitStatusChip status={row.status} />
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <CategoryChip category={row.category} name={row.typeName} />
                        <CountdownChip validTo={row.validTo} overdue={row.overdue} />
                        {row.insideCount > 0 ? (
                          <span className="rounded-md bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-800 dark:bg-red-900/40 dark:text-red-200">
                            {t('insideCount', { count: row.insideCount })}
                          </span>
                        ) : null}
                      </div>
                      <dl className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                        <div>
                          <dt className="font-medium text-foreground">{t('reference')}</dt>
                          <dd className="font-mono">{row.referenceNumber}</dd>
                        </div>
                        <div>
                          <dt className="font-medium text-foreground">{t('acceptor')}</dt>
                          <dd className="truncate">{row.acceptorName ?? '—'}</dd>
                        </div>
                      </dl>
                      {row.locationText !== '' ? (
                        <p className="truncate text-xs text-muted-foreground">{row.locationText}</p>
                      ) : null}
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
