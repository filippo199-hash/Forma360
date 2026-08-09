'use client';

/**
 * Dashboards home (ADR 0018): every dashboard the caller may see — their
 * own (multiple per user is the norm), plus published ones shared with
 * them. Search + status filter, and the door to the AI builder.
 */
import { Archive, Eye, Globe, Lock, Plus, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { formatDateTime } from '../../../src/lib/format-date';
import { trpc } from '../../../src/lib/trpc/client';
import { cn } from '../../../src/lib/cn';
import { Button } from '../../../src/components/ui/button';
import { Card, CardContent } from '../../../src/components/ui/card';
import { Skeleton } from '../../../src/components/ui/skeleton';
import {
  UpgradePanel,
  isEntitlementError,
} from '../../../src/components/dashboards/upgrade-panel';

type StatusFilter = 'all' | 'draft' | 'published' | 'archived';

export default function DashboardsPage() {
  const t = useTranslations('dashboards');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');

  const list = trpc.dashboards.list.useQuery(undefined, { retry: false });

  const rows = useMemo(() => {
    const all = list.data ?? [];
    const needle = search.trim().toLowerCase();
    return all.filter((d) => {
      if (status !== 'all' && d.status !== status) return false;
      if (needle.length > 0 && !d.title.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [list.data, search, status]);

  if (list.error && isEntitlementError(list.error)) {
    return <UpgradePanel />;
  }

  const visibilityIcon = (visibility: string) =>
    visibility === 'tenant' ? (
      <Globe className="h-3.5 w-3.5" aria-hidden />
    ) : visibility === 'selected' ? (
      <Users className="h-3.5 w-3.5" aria-hidden />
    ) : (
      <Lock className="h-3.5 w-3.5" aria-hidden />
    );

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('list.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('list.subtitle')}</p>
        </div>
        <Button asChild>
          <Link href={`/${locale}/dashboards/new`}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden />
            {t('list.new')}
          </Link>
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('list.searchPlaceholder')}
          className="h-9 w-64 rounded-md border border-input bg-background px-3 text-sm"
          aria-label={t('list.searchPlaceholder')}
        />
        {(['all', 'draft', 'published', 'archived'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={cn(
              'h-8 rounded-full border px-3 text-sm transition-colors',
              status === s ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted',
            )}
          >
            {t(`status.${s}`)}
          </button>
        ))}
      </div>

      {list.isError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            {/* A failed load must never masquerade as an empty tenant. */}
            <p className="text-sm text-destructive">{t('list.loadError')}</p>
            <Button variant="outline" onClick={() => void list.refetch()}>
              {t('detail.retry')}
            </Button>
          </CardContent>
        </Card>
      ) : list.isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-36 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <p className="text-sm text-muted-foreground">
              {(list.data ?? []).length === 0 ? t('list.emptyFirstRun') : t('list.emptyFiltered')}
            </p>
            {(list.data ?? []).length === 0 ? (
              <Button asChild>
                <Link href={`/${locale}/dashboards/new`}>{t('list.emptyCta')}</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {rows.map((d) => (
            <Link key={d.id} href={`/${locale}/dashboards/${d.id}`} className="block">
              <Card
                className={cn(
                  'h-full transition-colors hover:border-primary/40 hover:bg-muted/30',
                  d.status === 'archived' && 'opacity-60',
                )}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="line-clamp-2 font-medium">{d.title}</h2>
                    {d.status === 'archived' ? (
                      <Archive className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    ) : null}
                  </div>
                  {d.description ? (
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{d.description}</p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full border px-2 py-0.5',
                        d.status === 'published' &&
                          'border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400',
                      )}
                    >
                      {t(`status.${d.status}`)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      {visibilityIcon(d.visibility)}
                      {t(`visibility.${d.visibility}`)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Eye className="h-3.5 w-3.5" aria-hidden />
                      {t('list.widgetCount', { count: d.widgetCount })}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {d.isMine
                      ? t('list.updatedAt', { at: formatDateTime(d.updatedAt, locale) })
                      : t('list.byOwner', {
                          owner: d.ownerName ?? '—',
                          at: formatDateTime(d.updatedAt, locale),
                        })}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
