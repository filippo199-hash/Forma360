'use client';

/**
 * Dashboards home (ADR 0018): every dashboard the caller may see — their
 * own (multiple per user is the norm), plus published ones shared with
 * them. Renders inside the standard ModuleShell and uses the platform
 * FilterBar (search + status behind "Add filter") so it matches every
 * other module home.
 *
 * Starred dashboards get their own section at the top — a per-user
 * preference (dashboard_favourites), so everyone pins the boards they
 * live in without touching anyone else's ordering.
 */
import { Archive, Eye, Globe, LayoutGrid, Lock, Plus, Star, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { formatDateTime } from '../../../src/lib/format-date';
import { trpc } from '../../../src/lib/trpc/client';
import { useServerErrorToast } from '../../../src/lib/use-server-error';
import { cn } from '../../../src/lib/cn';
import { FilterBar, type FilterDef } from '../../../src/components/filter-bar';
import { ModuleShell } from '../../../src/components/module-shell';
import { ResultsFooter } from '../../../src/components/results-footer';
import { Button } from '../../../src/components/ui/button';
import { Card, CardContent } from '../../../src/components/ui/card';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../src/components/ui/tooltip';
import { UpgradePanel, isEntitlementError } from '../../../src/components/dashboards/upgrade-panel';

type StatusFilter = 'all' | 'draft' | 'published' | 'archived';
const STATUS_FILTERS: readonly StatusFilter[] = ['all', 'draft', 'published', 'archived'];

interface DashboardRow {
  id: string;
  title: string;
  description: string | null;
  status: 'draft' | 'published' | 'archived';
  visibility: 'private' | 'selected' | 'tenant';
  ownerName: string | null;
  isMine: boolean;
  isFavourite: boolean;
  widgetCount: number;
  viewCount: number;
  updatedAt: Date;
}

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
  const favourites = useMemo(() => rows.filter((d) => d.isFavourite), [rows]);
  const others = useMemo(() => rows.filter((d) => !d.isFavourite), [rows]);

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
      ) : favourites.length === 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {rows.map((d) => (
            <DashboardCard key={d.id} d={d} locale={locale} />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          <section>
            <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
              <Star className="h-4 w-4 fill-amber-400 text-amber-400" aria-hidden />
              {t('favourite.section')}
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {favourites.map((d) => (
                <DashboardCard key={d.id} d={d} locale={locale} />
              ))}
            </div>
          </section>
          {others.length > 0 ? (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
                {t('favourite.othersSection')}
              </h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {others.map((d) => (
                  <DashboardCard key={d.id} d={d} locale={locale} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}

      {rows.length > 0 ? <ResultsFooter count={rows.length} /> : null}
    </ModuleShell>
  );
}

function DashboardCard({ d, locale }: { d: DashboardRow; locale: string }) {
  const t = useTranslations('dashboards');
  const utils = trpc.useUtils();
  const favouriteFailed = useServerErrorToast(t('favourite.failed'));
  const setFavourite = trpc.dashboards.setFavourite.useMutation({
    onSuccess: () => utils.dashboards.list.invalidate(),
    onError: favouriteFailed,
  });

  const visibilityIcon =
    d.visibility === 'tenant' ? (
      <Globe className="h-3.5 w-3.5" aria-hidden />
    ) : d.visibility === 'selected' ? (
      <Users className="h-3.5 w-3.5" aria-hidden />
    ) : (
      <Lock className="h-3.5 w-3.5" aria-hidden />
    );

  return (
    // Stretched-link card: a <button> may not nest inside an <a>, so the
    // title's Link grows an ::after overlay covering the card and the
    // star sits ABOVE it (relative z-10) as a true sibling control.
    <div className="relative block h-full">
      <Card
        className={cn(
          'h-full transition-colors hover:border-primary/40 hover:bg-muted/30',
          d.status === 'archived' && 'opacity-60',
        )}
      >
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <h2 className="line-clamp-2 font-medium">
              <Link
                href={`/${locale}/dashboards/${d.id}`}
                className="after:absolute after:inset-0 after:rounded-xl"
              >
                {d.title}
              </Link>
            </h2>
            <div className="relative z-10 flex shrink-0 items-center gap-1">
              {d.status === 'archived' ? (
                <Archive className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              ) : null}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="-m-1 rounded-md p-1 transition-colors hover:bg-muted"
                    aria-label={d.isFavourite ? t('favourite.remove') : t('favourite.add')}
                    aria-pressed={d.isFavourite}
                    aria-busy={setFavourite.isPending}
                    onClick={() => {
                      // A click guard, not `disabled` — disabling a focused
                      // button drops keyboard focus to <body> mid-toggle.
                      if (setFavourite.isPending) return;
                      setFavourite.mutate({ id: d.id, favourite: !d.isFavourite });
                    }}
                  >
                    <Star
                      className={cn(
                        'h-4 w-4',
                        d.isFavourite
                          ? 'fill-amber-400 text-amber-400'
                          : 'text-muted-foreground/60',
                      )}
                      aria-hidden
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {d.isFavourite ? t('favourite.remove') : t('favourite.add')}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
          {d.description ? (
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{d.description}</p>
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
              {visibilityIcon}
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
    </div>
  );
}
