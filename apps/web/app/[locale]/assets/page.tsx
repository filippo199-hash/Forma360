'use client';

import {
  Archive,
  ChevronDown,
  ChevronRight,
  ImageIcon,
  Plus,
  QrCode,
  Settings,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { FilterBar, type FilterDef } from '../../../src/components/filter-bar';
import { ModuleHeader } from '../../../src/components/module-header';
import { ResultsFooter } from '../../../src/components/results-footer';
import { SiteFilterChip, useSiteFilterParam } from '../../../src/components/site-filter-chip';
import { Button } from '../../../src/components/ui/button';
import { Card, CardContent } from '../../../src/components/ui/card';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { TooltipIconButton } from '../../../src/components/ui/tooltip-icon-button';
import { useHasPermission } from '../../../src/lib/permissions-context';
import { usePlaceTerms } from '../../../src/lib/terminology';
import { trpc } from '../../../src/lib/trpc/client';

type AssetRow = {
  id: string;
  name: string;
  parentId: string | null;
  photoKey: string | null;
  typeId: string | null;
  typeName: string | null;
  siteId: string | null;
  siteName: string | null;
  qrToken: string | null;
  updatedAt: Date;
  archivedAt: Date | null;
};

export default function AssetsListPage() {
  const t = useTranslations('assets.list');
  const tSettings = useTranslations('assets.settings');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const canManage = useHasPermission('assets.manage');
  const { label: placeLabel } = usePlaceTerms();

  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  // Debounced, because the query goes to the server: the register is
  // keyset-paged, so filtering the page in the browser would search the 200
  // rows it happens to hold and report the rest as absent.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());

  const { siteId: siteFilter, clear: clearSiteFilter } = useSiteFilterParam();

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: typesData } = trpc.assetTypes.list.useQuery({});
  const types = typesData ?? [];

  /**
   * AS-V01: the register capped at 200 rows with no way past it, so a
   * company with more plant than that could not see the rest and nothing
   * said so. Accumulate pages behind a "load more" — the tree grouping
   * below needs parents and children in the same array, so replacing the
   * list per page would orphan children whose parent is on an earlier one.
   */
  const [pages, setPages] = useState<AssetRow[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  const listInput = {
    typeId: typeFilter === 'all' ? undefined : typeFilter,
    ...(siteFilter !== '' ? { siteId: siteFilter } : {}),
    ...(debouncedSearch !== '' ? { search: debouncedSearch } : {}),
    includeArchived,
    ...(cursor !== undefined ? { cursor } : {}),
  };
  const { data, isLoading, error } = trpc.assets.list.useQuery(listInput);

  // A filter change resets the accumulation; a new page appends to it.
  const filterKey = `${typeFilter}|${siteFilter}|${debouncedSearch}|${String(includeArchived)}`;
  const lastFilterKey = useRef(filterKey);
  useEffect(() => {
    if (lastFilterKey.current !== filterKey) {
      lastFilterKey.current = filterKey;
      setPages([]);
      setCursor(undefined);
    }
  }, [filterKey]);

  useEffect(() => {
    if (data === undefined) return;
    setPages((prev) => {
      const seen = new Set(prev.map((r) => r.id));
      const fresh = data.assets.filter((r) => !seen.has(r.id));
      return fresh.length === 0 ? prev : [...prev, ...(fresh as AssetRow[])];
    });
  }, [data]);

  const allRows = pages.length > 0 ? pages : ((data?.assets ?? []) as AssetRow[]);
  const hasMore = data?.hasMore ?? false;
  const nextCursor = data?.nextCursor ?? null;

  // Split into top-level parents and children. A search flattens the tree:
  // the server matches sub-assets too, and a matching sub-asset whose PARENT
  // does not match has no parent row to nest under — it would be filtered out
  // of `parentRows` and never rendered, so the search would silently lose it.
  const searching = debouncedSearch !== '';
  const parentRows = searching ? allRows : allRows.filter((r) => r.parentId === null);
  const childMap = new Map<string, AssetRow[]>();
  if (!searching) {
    for (const r of allRows) {
      if (r.parentId !== null) {
        const bucket = childMap.get(r.parentId) ?? [];
        bucket.push(r);
        childMap.set(r.parentId, bucket);
      }
    }
  }

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addFilter(key: string): void {
    setActiveFilters((prev) => new Set(prev).add(key));
  }
  function removeFilterKey(key: string): void {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    if (key === 'type') setTypeFilter('all');
  }
  const filterDefs: FilterDef[] = [
    {
      key: 'type',
      label: t('filterType'),
      control: {
        kind: 'select',
        value: typeFilter,
        onValueChange: setTypeFilter,
        options: [
          { value: 'all', label: t('filterTypeAll') },
          ...types.map((tp) => ({ value: tp.id, label: tp.name })),
        ],
      },
    },
  ];
  const activeFilterKeys = filterDefs.map((f) => f.key).filter((k) => activeFilters.has(k));

  function renderRow(row: AssetRow, isChild: boolean): ReactNode {
    const children = childMap.get(row.id) ?? [];
    const hasChildren = children.length > 0;
    const isExpanded = expandedIds.has(row.id);

    return (
      <>
        <tr
          key={row.id}
          className={`border-b last:border-0 hover:bg-muted/30 ${row.archivedAt !== null ? 'opacity-60' : ''}`}
        >
          {/* Thumbnail */}
          <td className="px-3 py-2">
            <div className={isChild ? 'ml-8' : undefined}>
              {row.photoKey !== null ? (
                <img
                  src={`/api/files?key=${encodeURIComponent(row.photoKey)}`}
                  alt=""
                  className="h-9 w-9 rounded-md object-cover"
                />
              ) : (
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
                  <ImageIcon className="h-4 w-4 text-muted-foreground" />
                </div>
              )}
            </div>
          </td>

          {/* Name with expand toggle */}
          <td className="px-3 py-2 font-medium">
            <div className={`flex items-center gap-1 ${isChild ? 'ml-8' : ''}`}>
              {!isChild && hasChildren ? (
                <button
                  type="button"
                  onClick={() => toggleExpand(row.id)}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                  aria-label={isExpanded ? 'Collapse' : 'Expand'}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </button>
              ) : (
                !isChild && <span className="w-5 shrink-0" />
              )}

              <Link href={`/${locale}/assets/${row.id}`} className="hover:underline">
                {row.name}
              </Link>

              {!isChild && hasChildren && (
                <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  {children.length}
                </span>
              )}
            </div>
          </td>

          <td className="px-3 py-2 text-muted-foreground">{row.typeName ?? '—'}</td>
          <td className="px-3 py-2 text-muted-foreground">{row.siteName ?? '—'}</td>
          <td className="px-3 py-2">
            {row.qrToken !== null ? (
              <span className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground">
                <QrCode className="h-3 w-3" />
                {row.qrToken}
              </span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </td>
          <td className="px-3 py-2 text-muted-foreground">
            {row.updatedAt.toLocaleDateString(locale)}
          </td>
        </tr>

        {/* Children — rendered inline when expanded */}
        {!isChild && isExpanded && children.map((child) => renderRow(child, true))}
      </>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <ModuleHeader title={t('title')} description={t('subtitle')}>
        <TooltipIconButton
          icon={Archive}
          label={includeArchived ? tCommon('hideArchived') : tCommon('showArchived')}
          active={includeArchived}
          onClick={() => setIncludeArchived((v) => !v)}
        />
        {canManage ? (
          <TooltipIconButton
            icon={Settings}
            label={tSettings('title')}
            href={`/${locale}/assets/settings`}
          />
        ) : null}
        {canManage ? (
          <Button asChild>
            <Link href={`/${locale}/assets/new`}>
              <Plus className="mr-1 h-4 w-4" />
              {t('newButton')}
            </Link>
          </Button>
        ) : null}
      </ModuleHeader>

      <FilterBar
        leading={
          siteFilter !== '' ? (
            <SiteFilterChip siteId={siteFilter} onClear={clearSiteFilter} />
          ) : undefined
        }
        search={{ value: search, onChange: setSearch, placeholder: t('searchPlaceholder') }}
        filters={filterDefs}
        activeKeys={activeFilterKeys}
        onAddFilter={addFilter}
        onRemoveFilter={removeFilterKey}
      />

      {error ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p role="alert" className="text-sm text-destructive">
              {tCommon('error')}
            </p>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : parentRows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <p>{searching ? t('searchEmpty', { query: debouncedSearch }) : t('empty')}</p>
            {/* "Create the first asset" is the wrong offer when the register
                is full and the search simply missed. */}
            {canManage && !searching ? (
              <Link
                href={`/${locale}/assets/new`}
                className="mt-2 inline-block text-foreground underline-offset-4 hover:underline"
              >
                {t('emptyCta')}
              </Link>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Table (desktop) — hidden under md; the card list takes over there. */}
          <Card className="hidden md:block">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40">
                    <tr className="text-left">
                      <th className="w-12 px-3 py-2" />
                      <th className="px-3 py-2 font-medium">{t('columns.name')}</th>
                      <th className="px-3 py-2 font-medium">{t('columns.type')}</th>
                      <th className="px-3 py-2 font-medium">{placeLabel}</th>
                      <th className="px-3 py-2 font-medium">{t('columns.qr')}</th>
                      <th className="px-3 py-2 font-medium">{t('columns.updatedAt')}</th>
                    </tr>
                  </thead>
                  <tbody>{parentRows.map((row) => renderRow(row, false))}</tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Card list (mobile) — stacked layout under md; the table is hidden there. */}
          <div className="space-y-3 md:hidden">
            {allRows.map((row) => (
              <Link key={row.id} href={`/${locale}/assets/${row.id}`} className="block">
                <Card
                  className={`transition-colors hover:bg-muted/30 ${
                    row.archivedAt !== null ? 'opacity-60' : ''
                  } ${row.parentId !== null ? 'ml-4 border-l-2' : ''}`}
                >
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-center gap-3">
                      {row.photoKey !== null ? (
                        <img
                          src={`/api/files?key=${encodeURIComponent(row.photoKey)}`}
                          alt=""
                          className="h-10 w-10 shrink-0 rounded-md object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
                          <ImageIcon className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                      <p className="min-w-0 truncate font-medium">{row.name}</p>
                    </div>
                    <dl className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                      <div>
                        <dt className="font-medium text-foreground">{t('columns.type')}</dt>
                        <dd className="truncate">{row.typeName ?? '—'}</dd>
                      </div>
                      <div>
                        <dt className="font-medium text-foreground">{placeLabel}</dt>
                        <dd className="truncate">{row.siteName ?? '—'}</dd>
                      </div>
                      <div>
                        <dt className="font-medium text-foreground">{t('columns.updatedAt')}</dt>
                        <dd>{row.updatedAt.toLocaleDateString(locale)}</dd>
                      </div>
                    </dl>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          <ResultsFooter count={allRows.length} />

          {/* AS-V01: the way past the cap. Without this the register simply
              stopped at 200 rows and said nothing about the rest. */}
          {hasMore ? (
            <div className="flex justify-center pt-4">
              <Button
                type="button"
                variant="outline"
                disabled={isLoading || nextCursor === null}
                onClick={() => {
                  if (nextCursor !== null) setCursor(nextCursor);
                }}
              >
                {tCommon('loadMore')}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
