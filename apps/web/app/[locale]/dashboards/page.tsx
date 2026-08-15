'use client';

/**
 * Dashboards home (ADR 0018): every dashboard the caller may see — their
 * own (multiple per user is the norm), plus published ones shared with
 * them. Renders inside the standard ModuleShell and uses the platform
 * FilterBar (search + status behind "Add filter") so it matches every
 * other module home.
 */
import { Archive, Eye, Globe, LayoutGrid, Lock, Plus, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { formatDateTime } from '../../../src/lib/format-date';
import { trpc } from '../../../src/lib/trpc/client';
import { cn } from '../../../src/lib/cn';
import { FilterBar, type FilterDef } from '../../../src/components/filter-bar';
import { ModuleShell } from '../../../src/components/module-shell';
import { Button } from '../../../src/components/ui/button';
import { Card, CardContent } from '../../../src/components/ui/card';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { UpgradePanel, isEntitlementError } from '../../../src/components/dashboards/upgrade-panel';

type StatusFilter = 'all' | 'draft' | 'published' | 'archived';
const STATUS_FILTERS: readonly StatusFilter[] = ['all', 'draft', 'published', 'archived'];

export default function DashboardsPage() {
  const t = useTranslations('dashboards');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  // The status filter lives behind the "Add filter" button — it is only
  // active (a chip) once the user adds it; removing it resets to "all".
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());

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

  const filterDefs: FilterDef[] = [
    {
      key: 'status',
      label: tCommon('status'),
      control: {
        kind: 'select',
        value: status,
        onValueChange: (v) => setStatus(v as StatusFilter),
        options: STATUS_FILTERS.map((s) => ({ value: s, label: t(`status.${s}`) })),
      },
    },
  ];
  const activeFilterKeys = filterDefs.map((f) => f.key).filter((k) => activeFilters.has(k));

  function addFilter(key: string): void {
    setActiveFilters((prev) => new Set(prev).add(key));
  }
  function removeFilter(key: string): void {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    if (key === 'status') setStatus('all');
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
    <ModuleShell>
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

      <FilterBar
        className="mb-4"
        search={{
          value: search,
          onChange: setSearch,
          placeholder: t('list.searchPlaceholder'),
        }}
        filters={filterDefs}
        activeKeys={activeFilterKeys}
        onAddFilter={addFilter}
        onRemoveFilter={removeFilter}
        {...(list.data !== undefined ? { resultsCount: rows.length } : {})}
      />

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
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {d.description}
                    </p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2 py-0.5 font-medium',
                        d.status === 'published' &&
                          'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100',
                        d.status === 'draft' &&
                          'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100',
                        d.status === 'archived' &&
                          'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100',
                      )}
                    >
                      {t(`status.${d.status}`)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      {visibilityIcon(d.visibility)}
                      {t(`visibility.${d.visibility}`)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
                      {t('list.widgetCount', { count: d.widgetCount })}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Eye className="h-3.5 w-3.5" aria-hidden />
                      {t('list.viewCount', { count: d.viewCount })}
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
    </ModuleShell>
  );
}
