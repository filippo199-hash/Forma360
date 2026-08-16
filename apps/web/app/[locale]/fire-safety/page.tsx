'use client';

/**
 * Fire Safety hub — the building register, and the module home.
 *
 * Leads with the needs-attention strip (overdue checks, doors past
 * their inspection date, FRA reviews due, PEEP reviews due, marshal
 * gaps) so the practitioner sees what rotted since last visit before
 * anything else. The list itself mirrors the COSHH inventory: filter
 * row, desktop table, mobile cards, one predictable primary target per
 * row. Each building row carries its statutory-duty badges — the
 * high-rise duties are structural, not remembered.
 */
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { DueStatusChip, DutyBadges } from '../../../src/components/fire-safety/chips';
import { FilterBar, type FilterDef } from '../../../src/components/filter-bar';
import { ModuleHeader } from '../../../src/components/module-header';
import { ResultsFooter } from '../../../src/components/results-footer';
import { Button } from '../../../src/components/ui/button';
import { Card, CardContent } from '../../../src/components/ui/card';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { useHasPermission } from '../../../src/lib/permissions-context';
import { usePlaceTerms } from '../../../src/lib/terminology';
import { trpc } from '../../../src/lib/trpc/client';

type StatusFilter = 'active' | 'archived' | 'all';

export default function FireSafetyHubPage() {
  const t = useTranslations('fireSafety');
  const tCommon = useTranslations('common');
  const { label: placeLabel } = usePlaceTerms();
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const router = useRouter();

  const canCreate = useHasPermission('fireSafety.create');

  const [status, setStatus] = useState<StatusFilter>('active');
  // Seed from ?site= so the site Overview's compliance cards land filtered.
  const searchParams = useSearchParams();
  const [siteId, setSiteId] = useState(() => searchParams.get('site') ?? '');
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());

  const listInput: { status: StatusFilter; siteId?: string; search?: string } = { status };
  if (siteId !== '') listInput.siteId = siteId;
  if (search.trim() !== '') listInput.search = search.trim();

  const { data: rows, isLoading } = trpc.fireSafety.buildings.list.useQuery(listInput);
  const { data: overview } = trpc.fireSafety.overview.useQuery();
  const { data: sites } = trpc.sites.list.useQuery();

  const attention: Array<{ key: string; count: number }> = [
    { key: 'checksFailed', count: overview?.checksFailed ?? 0 },
    { key: 'doorsFailed', count: overview?.doorsFailed ?? 0 },
    { key: 'frasIntolerable', count: overview?.frasIntolerable ?? 0 },
    { key: 'checksOverdue', count: overview?.checksOverdue ?? 0 },
    { key: 'checksDueSoon', count: overview?.checksDueSoon ?? 0 },
    { key: 'doorsOverdue', count: overview?.doorsOverdue ?? 0 },
    { key: 'frasReviewDue', count: overview?.frasReviewDue ?? 0 },
    { key: 'peepReviewsDue', count: overview?.peepReviewsDue ?? 0 },
    { key: 'marshalGaps', count: overview?.marshalGaps ?? 0 },
    { key: 'marshalsExpiringSoon', count: overview?.marshalsExpiringSoon ?? 0 },
  ].filter((a) => a.count > 0);

  function addFilter(key: string): void {
    setActiveFilters((prev) => new Set(prev).add(key));
  }
  function removeFilterKey(key: string): void {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    if (key === 'status') setStatus('active');
    if (key === 'site') setSiteId('');
  }
  const filterDefs: FilterDef[] = [
    {
      key: 'status',
      label: tCommon('status'),
      control: {
        kind: 'select',
        value: status,
        onValueChange: (v) => setStatus(v as StatusFilter),
        options: [
          { value: 'active', label: t('filters.active') },
          { value: 'archived', label: t('filters.archived') },
          { value: 'all', label: t('filters.all') },
        ],
      },
    },
  ];
  // Multi-site estates filter by place, mirroring the permits register.
  if ((sites ?? []).length > 0) {
    filterDefs.push({
      key: 'site',
      label: placeLabel,
      control: {
        kind: 'select',
        value: siteId,
        onValueChange: setSiteId,
        options: [
          { value: '', label: t('filters.allSites') },
          ...(sites ?? []).map((s) => ({ value: s.id, label: s.name })),
        ],
      },
    });
  }
  const activeFilterKeys = filterDefs.map((f) => f.key).filter((k) => activeFilters.has(k));

  return (
    <main>
      <ModuleHeader className="mb-5" title={t('title')} description={t('subtitle')}>
        {canCreate ? (
          <Button asChild>
            <Link href={`/${locale}/fire-safety/new`}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {t('newBuildingButton')}
            </Link>
          </Button>
        ) : null}
      </ModuleHeader>

      {attention.length > 0 ? (
        <div className="mb-5 flex flex-wrap gap-2">
          {attention.map((a) => (
            <Link
              key={a.key}
              href={`/${locale}/fire-safety/logbook`}
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950/60"
            >
              <span className="rounded bg-amber-200/70 px-1.5 py-0.5 tabular-nums dark:bg-amber-900/60">
                {a.count}
              </span>
              {/* BUG-26: the label pluralises with the count ('1 check overdue'). */}
              {t(`attention.${a.key}` as Parameters<typeof t>[0], { count: a.count })}
            </Link>
          ))}
        </div>
      ) : null}

      <FilterBar
        className="mb-4"
        search={{
          value: search,
          onChange: setSearch,
          placeholder: t('filters.searchPlaceholder'),
        }}
        filters={filterDefs}
        activeKeys={activeFilterKeys}
        onAddFilter={addFilter}
        onRemoveFilter={removeFilterKey}
      />

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : (rows ?? []).length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
            {canCreate ? (
              <Button asChild variant="outline">
                <Link href={`/${locale}/fire-safety/new`}>{t('emptyCta')}</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Table (desktop) — the mobile card list below takes over under md. */}
          <div className="hidden overflow-x-auto rounded-lg border bg-card text-card-foreground shadow-sm md:block">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">{t('columns.building')}</th>
                  <th className="px-3 py-2 font-medium">{placeLabel}</th>
                  <th className="px-3 py-2 font-medium">{t('columns.duties')}</th>
                  <th className="px-3 py-2 font-medium">{t('columns.checks')}</th>
                  <th className="px-3 py-2 font-medium">{t('columns.doors')}</th>
                  <th className="px-3 py-2 font-medium">{t('columns.fra')}</th>
                </tr>
              </thead>
              <tbody>
                {(rows ?? []).map((b) => (
                  <tr
                    key={b.id}
                    onClick={() => router.push(`/${locale}/fire-safety/${b.id}`)}
                    className="cursor-pointer border-b last:border-b-0 hover:bg-muted/40"
                  >
                    <td className="px-3 py-2.5">
                      <div className="font-medium">{b.name}</div>
                      <div className="text-xs text-muted-foreground">{b.address}</div>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      {b.siteName ?? '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <DutyBadges duty={b.duty} />
                    </td>
                    <td className="px-3 py-2.5">
                      {b.checksFailed > 0 ? (
                        <span className="mr-1.5 inline-flex items-center gap-1">
                          <DueStatusChip status="failed" />
                          <span className="text-xs tabular-nums">{b.checksFailed}</span>
                        </span>
                      ) : null}
                      {b.checksOverdue > 0 ? (
                        <span className="mr-1.5 inline-flex items-center gap-1">
                          <DueStatusChip status="overdue" />
                          <span className="text-xs tabular-nums">{b.checksOverdue}</span>
                        </span>
                      ) : null}
                      {b.checksDueSoon > 0 ? (
                        <span className="inline-flex items-center gap-1">
                          <DueStatusChip status="due_soon" />
                          <span className="text-xs tabular-nums">{b.checksDueSoon}</span>
                        </span>
                      ) : null}
                      {b.checksFailed === 0 && b.checksOverdue === 0 && b.checksDueSoon === 0 ? (
                        <DueStatusChip status="ok" />
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {b.doorCount === 0 ? (
                        '—'
                      ) : b.doorsFailed > 0 ? (
                        <span className="inline-flex items-center gap-1">
                          <DueStatusChip status="failed" />
                          <span className="tabular-nums">{b.doorsFailed}</span>
                        </span>
                      ) : b.doorsOverdue > 0 ? (
                        t('doorsOverdueCount', { count: b.doorsOverdue })
                      ) : (
                        t('doorsOkCount', { count: b.doorCount })
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {b.activeFraRating === 'intolerable' ? (
                        <span className="mr-1.5 font-semibold text-red-700 dark:text-red-300">
                          {t('fraIntolerable')}
                        </span>
                      ) : null}
                      {b.hasActiveFra
                        ? b.fraReviewDue
                          ? t('fraReviewDue')
                          : b.activeFraRating === 'intolerable'
                            ? ''
                            : t('fraInPlace')
                        : t('fraMissing')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Card list (mobile). */}
          <div className="space-y-2 md:hidden">
            {(rows ?? []).map((b) => (
              <Link key={b.id} href={`/${locale}/fire-safety/${b.id}`} className="block">
                <Card>
                  <CardContent className="space-y-1.5 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium">{b.name}</span>
                      <DutyBadges duty={b.duty} />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {b.siteName !== null ? `${b.siteName} · ${b.address}` : b.address}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                      {b.checksFailed > 0 ? (
                        <span className="inline-flex items-center gap-1">
                          <DueStatusChip status="failed" />
                          {t('checksFailedCount', { count: b.checksFailed })}
                        </span>
                      ) : null}
                      {b.checksOverdue > 0 ? (
                        <span className="inline-flex items-center gap-1">
                          <DueStatusChip status="overdue" />
                          {t('checksOverdueCount', { count: b.checksOverdue })}
                        </span>
                      ) : b.checksFailed === 0 ? (
                        <DueStatusChip status="ok" />
                      ) : null}
                      <span>
                        {b.hasActiveFra
                          ? b.fraReviewDue
                            ? t('fraReviewDue')
                            : t('fraInPlace')
                          : t('fraMissing')}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          <ResultsFooter count={(rows ?? []).length} />
        </>
      )}
    </main>
  );
}
