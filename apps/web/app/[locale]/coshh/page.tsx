'use client';

/**
 * COSHH inventory — the substance register, and the module home.
 *
 * Leads with the needs-attention strip (SDS reviews due, assessments due,
 * LEV tests due, WEL exceedances, storage conflicts) so the practitioner
 * sees what rotted since last visit before anything else. The list itself
 * mirrors the observations module: filter row, desktop table, mobile
 * cards, one predictable primary target per row.
 */
import { Download, Fan, Plus, Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  AssessmentStatusChip,
  PictogramChips,
  RegimeChips,
  SdsStatusChip,
} from '../../../src/components/coshh/chips';
import { FilterBar, type FilterDef } from '../../../src/components/filter-bar';
import { ModuleHeader } from '../../../src/components/module-header';
import { Button } from '../../../src/components/ui/button';
import { Card, CardContent } from '../../../src/components/ui/card';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { TooltipIconButton } from '../../../src/components/ui/tooltip-icon-button';
import { useHasPermission } from '../../../src/lib/permissions-context';
import { usePlaceTerms } from '../../../src/lib/terminology';
import { trpc } from '../../../src/lib/trpc/client';

type StatusFilter = 'active' | 'archived' | 'all';

export default function CoshhInventoryPage() {
  const t = useTranslations('coshh');
  const tCommon = useTranslations('common');
  const { label: placeLabel } = usePlaceTerms();
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const router = useRouter();

  const canCreate = useHasPermission('coshh.create');

  const [status, setStatus] = useState<StatusFilter>('active');
  const [siteId, setSiteId] = useState('');
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());

  const listInput: { status: StatusFilter; siteId?: string; search?: string } = { status };
  if (siteId !== '') listInput.siteId = siteId;
  if (search.trim() !== '') listInput.search = search.trim();

  const { data: rows, isLoading } = trpc.coshh.substances.list.useQuery(listInput);
  const { data: overview } = trpc.coshh.overview.useQuery();
  const { data: sites } = trpc.sites.list.useQuery();

  const attention: Array<{ key: string; count: number }> = [
    { key: 'sdsMissing', count: overview?.sdsMissing ?? 0 },
    { key: 'sdsDue', count: overview?.sdsDue ?? 0 },
    { key: 'assessmentsDue', count: overview?.assessmentsDue ?? 0 },
    { key: 'levDue', count: overview?.levDue ?? 0 },
    { key: 'welExceedances', count: overview?.welExceedances ?? 0 },
    { key: 'storageConflicts', count: overview?.storageConflicts ?? 0 },
  ].filter((a) => a.count > 0);

  /**
   * COSHH register export (C-22): the loaded rows as CSV, generated
   * client-side — an inspector-ready substance register.
   */
  function exportCsv(): void {
    const esc = (v: string | number | null | undefined): string => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = [
      'Reference',
      'Name',
      'Supplier',
      'Physical form',
      'Signal word',
      'Carcinogen',
      'Mutagen',
      'Asthmagen',
      'Biological agent',
      'Contains lead',
      'SDS status',
      'WELs',
      'Assessments',
      'Locations',
      'Sites',
      'Surveillance due',
      'Status',
    ];
    const lines = (rows ?? []).map((r) =>
      [
        esc(r.referenceNumber),
        esc(r.name),
        esc(r.supplier),
        esc(r.physicalForm),
        esc(r.signalWord),
        r.isCarcinogen ? 'yes' : 'no',
        r.isMutagen ? 'yes' : 'no',
        r.isAsthmagen ? 'yes' : 'no',
        r.isBiologicalAgent ? 'yes' : 'no',
        r.containsLead ? 'yes' : 'no',
        esc(r.sdsStatus),
        r.workplaceExposureLimits.length,
        r.assessmentCount,
        r.locationCount,
        esc(r.siteNames.join('; ')),
        r.surveillanceDue ? 'yes' : 'no',
        esc(r.status),
      ].join(','),
    );
    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `coshh-register-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
    {
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
    },
  ];
  const activeFilterKeys = filterDefs.map((f) => f.key).filter((k) => activeFilters.has(k));

  return (
    <div className="space-y-4 sm:space-y-6">
      <ModuleHeader title={t('title')} description={t('subtitle')}>
        <TooltipIconButton
          icon={Download}
          label={tCommon('exportCsv')}
          onClick={exportCsv}
          disabled={(rows ?? []).length === 0}
        />
        <Button
          asChild
          variant="outline"
          title={t('powButton')}
          className="w-10 px-0 sm:w-auto sm:px-4"
        >
          <Link href={`/${locale}/coshh/point-of-work`}>
            <Zap className="h-4 w-4" />
            <span className="hidden sm:inline">{t('powButton')}</span>
          </Link>
        </Button>
        <Button
          asChild
          variant="outline"
          title={t('levButton')}
          className="w-10 px-0 sm:w-auto sm:px-4"
        >
          <Link href={`/${locale}/coshh/lev`}>
            <Fan className="h-4 w-4" />
            <span className="hidden sm:inline">{t('levButton')}</span>
          </Link>
        </Button>
        {canCreate ? (
          <Button asChild>
            <Link href={`/${locale}/coshh/new`}>
              <Plus className="mr-1 h-4 w-4" />
              {t('newButton')}
            </Link>
          </Button>
        ) : null}
      </ModuleHeader>

      {attention.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {attention.map((a) => (
            <span
              key={a.key}
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
            >
              <span className="rounded bg-amber-200 px-1 text-[11px] font-semibold dark:bg-amber-800">
                {a.count}
              </span>
              {t(`attention.${a.key}` as never)}
            </span>
          ))}
        </div>
      ) : null}

      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: t('filters.searchPlaceholder') }}
        filters={filterDefs}
        activeKeys={activeFilterKeys}
        onAddFilter={addFilter}
        onRemoveFilter={removeFilterKey}
        resultsCount={(rows ?? []).length}
      />

      {/* Table (desktop) — the mobile card list below takes over under md. */}
      <Card className="hidden md:block">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">{t('columns.reference')}</th>
                  <th className="px-3 py-2 font-medium">{t('columns.substance')}</th>
                  <th className="px-3 py-2 font-medium">{t('columns.supplier')}</th>
                  <th className="px-3 py-2 font-medium">{placeLabel}</th>
                  <th className="px-3 py-2 font-medium">{t('columns.hazards')}</th>
                  <th className="px-3 py-2 font-medium">{t('columns.sds')}</th>
                  <th className="px-3 py-2 font-medium">{t('columns.assessment')}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="p-4">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  </tr>
                ) : (rows ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground">
                      <div>{t('empty')}</div>
                      {canCreate ? (
                        <Link
                          href={`/${locale}/coshh/new`}
                          className="mt-2 inline-block text-primary hover:underline"
                        >
                          {t('emptyCta')}
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                ) : (
                  (rows ?? []).map((row) => {
                    const detailUrl = `/${locale}/coshh/${row.id}`;
                    return (
                      <tr
                        key={row.id}
                        className="cursor-pointer border-b last:border-0 hover:bg-muted/30"
                        onClick={() => router.push(detailUrl)}
                      >
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                          {row.referenceNumber}
                        </td>
                        <td className="px-3 py-2">
                          <Link
                            href={detailUrl}
                            className="font-medium hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {row.name}
                          </Link>
                          <div className="mt-0.5">
                            <PictogramChips codes={row.pictograms} />
                          </div>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{row.supplier || '—'}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {row.siteNames.length > 0
                            ? row.siteNames.join(', ')
                            : row.locationCount > 0
                              ? t('locations.unsited', { count: row.locationCount })
                              : '—'}
                        </td>
                        <td className="px-3 py-2">
                          <RegimeChips flags={row} />
                          {row.hasWelExceedance ? (
                            <span className="ml-1 rounded-md bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/40 dark:text-red-200">
                              {t('welExceeded')}
                            </span>
                          ) : null}
                          {row.surveillanceDue ? (
                            <span className="ml-1 rounded-md bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/40 dark:text-red-200">
                              {t('surveillance.dueChip')}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2">
                          <SdsStatusChip status={row.sdsStatus} />
                        </td>
                        <td className="px-3 py-2">
                          {row.assessmentCount === 0 ? (
                            <span className="rounded-md bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/40 dark:text-red-200">
                              {t('noAssessment')}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="text-muted-foreground">
                                {t('assessmentCount', { count: row.assessmentCount })}
                              </span>
                              {row.assessmentReviewDue ? (
                                <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-100">
                                  {t('reviewDue')}
                                </span>
                              ) : null}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Card list (mobile) */}
      <div className="space-y-3 md:hidden">
        {isLoading ? (
          <Card>
            <CardContent className="p-4">
              <Skeleton className="h-24 w-full" />
            </CardContent>
          </Card>
        ) : (rows ?? []).length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              <div>{t('empty')}</div>
              {canCreate ? (
                <Link
                  href={`/${locale}/coshh/new`}
                  className="mt-2 inline-block text-primary hover:underline"
                >
                  {t('emptyCta')}
                </Link>
              ) : null}
            </CardContent>
          </Card>
        ) : (
          (rows ?? []).map((row) => (
            <Link key={row.id} href={`/${locale}/coshh/${row.id}`} className="block">
              <Card className="transition-colors hover:bg-muted/30">
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 font-medium">{row.name}</p>
                    <SdsStatusChip status={row.sdsStatus} />
                  </div>
                  <p className="font-mono text-xs text-muted-foreground">{row.referenceNumber}</p>
                  <PictogramChips codes={row.pictograms} />
                  <RegimeChips flags={row} />
                  <dl className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <div>
                      <dt className="font-medium text-foreground">{t('columns.supplier')}</dt>
                      <dd className="truncate">{row.supplier || '—'}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-foreground">{t('columns.assessment')}</dt>
                      <dd>
                        {row.assessmentCount === 0 ? (
                          <span className="text-red-700 dark:text-red-300">
                            {t('noAssessment')}
                          </span>
                        ) : (
                          t('assessmentCount', { count: row.assessmentCount })
                        )}
                      </dd>
                    </div>
                  </dl>
                  {row.status === 'archived' ? <AssessmentStatusChip status="archived" /> : null}
                </CardContent>
              </Card>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
