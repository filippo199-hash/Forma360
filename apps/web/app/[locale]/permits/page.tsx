'use client';

/**
 * Permit register — the module home.
 *
 * Leads with the needs-attention strip (overdue, expiring soon, awaiting
 * acceptance, suspended) so the practitioner sees the dangerous state
 * first. The list itself mirrors the COSHH register: filter row, desktop
 * table, mobile cards, one predictable primary target per row. The live
 * board gets its own page for the control-room view.
 */
import { Plus, Settings2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  CategoryChip,
  CountdownChip,
  PermitStatusChip,
} from '../../../src/components/permits/chips';
import { FilterBar, type FilterDef } from '../../../src/components/filter-bar';
import { ModuleHeader } from '../../../src/components/module-header';
import { Button } from '../../../src/components/ui/button';
import { Card, CardContent } from '../../../src/components/ui/card';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { TooltipIconButton } from '../../../src/components/ui/tooltip-icon-button';
import { useHasPermission } from '../../../src/lib/permissions-context';
import { usePlaceTerms } from '../../../src/lib/terminology';
import { trpc } from '../../../src/lib/trpc/client';

type StatusFilter =
  | 'open'
  | 'draft'
  | 'issued'
  | 'active'
  | 'suspended'
  | 'closed'
  | 'cancelled'
  | 'all';

export default function PermitsPage() {
  const t = useTranslations('permits');
  const { label: placeLabel } = usePlaceTerms();
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const router = useRouter();

  const canCreate = useHasPermission('permits.create');
  const canManage = useHasPermission('permits.manage');

  const [status, setStatus] = useState<StatusFilter>('open');
  const [siteId, setSiteId] = useState('');
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());

  const listInput: { status: StatusFilter; siteId?: string; search?: string } = { status };
  if (siteId !== '') listInput.siteId = siteId;
  if (search.trim() !== '') listInput.search = search.trim();

  const { data: rows, isLoading } = trpc.permits.list.useQuery(listInput);
  const { data: overview } = trpc.permits.overview.useQuery();
  const { data: sites } = trpc.sites.list.useQuery();

  const attention: Array<{ key: string; count: number; alarm?: boolean }> = [
    { key: 'overdue', count: overview?.overdue ?? 0, alarm: true },
    { key: 'expiringSoon', count: overview?.expiringSoon ?? 0 },
    { key: 'awaitingAcceptance', count: overview?.awaitingAcceptance ?? 0 },
    { key: 'suspended', count: overview?.suspended ?? 0 },
    { key: 'draft', count: overview?.draft ?? 0 },
  ].filter((a) => a.count > 0);

  const formatWindow = (from: Date, to: Date): string => {
    const f = new Date(from);
    const to_ = new Date(to);
    const d = (x: Date) =>
      x.toLocaleString(locale, {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    return `${d(f)} → ${d(to_)}`;
  };

  function addFilter(key: string): void {
    setActiveFilters((prev) => new Set(prev).add(key));
  }
  function removeFilterKey(key: string): void {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    if (key === 'status') setStatus('open');
    if (key === 'site') setSiteId('');
  }
  const filterDefs: FilterDef[] = [
    {
      key: 'status',
      label: t('filters.status'),
      control: {
        kind: 'select',
        value: status,
        onValueChange: (v) => setStatus(v as StatusFilter),
        options: [
          { value: 'open', label: t('filters.open') },
          { value: 'draft', label: t('status.draft') },
          { value: 'issued', label: t('status.issued') },
          { value: 'active', label: t('status.active') },
          { value: 'suspended', label: t('status.suspended') },
          { value: 'closed', label: t('status.closed') },
          { value: 'cancelled', label: t('status.cancelled') },
          { value: 'all', label: t('filters.all') },
        ],
      },
    },
  ];
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
    <div className="space-y-4 sm:space-y-6">
      <ModuleHeader title={t('title')} description={t('subtitle')}>
        {canManage ? (
          <TooltipIconButton
            icon={Settings2}
            label={t('typesButton')}
            href={`/${locale}/permits/types`}
          />
        ) : null}
        {canCreate ? (
          <Button asChild>
            <Link href={`/${locale}/permits/new`}>
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
              className={
                a.alarm === true
                  ? 'inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100'
                  : 'inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100'
              }
            >
              <span
                className={
                  a.alarm === true
                    ? 'rounded bg-red-200 px-1 text-[11px] font-semibold dark:bg-red-800'
                    : 'rounded bg-amber-200 px-1 text-[11px] font-semibold dark:bg-amber-800'
                }
              >
                {a.count}
              </span>
              {t(`attention.${a.key}` as never)}
            </span>
          ))}
        </div>
      ) : null}

      <FilterBar
        search={{
          value: search,
          onChange: setSearch,
          placeholder: t('filters.searchPlaceholder'),
        }}
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
                  <th className="px-3 py-2 font-medium">{t('columns.permit')}</th>
                  <th className="px-3 py-2 font-medium">{t('columns.type')}</th>
                  <th className="px-3 py-2 font-medium">{placeLabel}</th>
                  <th className="px-3 py-2 font-medium">{t('columns.window')}</th>
                  <th className="px-3 py-2 font-medium">{t('columns.acceptor')}</th>
                  <th className="px-3 py-2 font-medium">{t('columns.status')}</th>
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
                          href={`/${locale}/permits/new`}
                          className="mt-2 inline-block text-primary hover:underline"
                        >
                          {t('emptyCta')}
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                ) : (
                  (rows ?? []).map((row) => {
                    const detailUrl = `/${locale}/permits/${row.id}`;
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
                            {row.title}
                          </Link>
                          {row.locationText !== '' ? (
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              {row.locationText}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2">
                          <CategoryChip category={row.category} name={row.typeName} />
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{row.siteName ?? '—'}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          <div>{formatWindow(row.validFrom, row.validTo)}</div>
                          {row.overdue ||
                          row.status === 'issued' ||
                          row.status === 'active' ||
                          row.status === 'suspended' ? (
                            <div className="mt-0.5">
                              <CountdownChip validTo={row.validTo} overdue={row.overdue} />
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {row.acceptorName ?? '—'}
                        </td>
                        <td className="px-3 py-2">
                          <PermitStatusChip status={row.status} />
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
                  href={`/${locale}/permits/new`}
                  className="mt-2 inline-block text-primary hover:underline"
                >
                  {t('emptyCta')}
                </Link>
              ) : null}
            </CardContent>
          </Card>
        ) : (
          (rows ?? []).map((row) => (
            <Link key={row.id} href={`/${locale}/permits/${row.id}`} className="block">
              <Card className="transition-colors hover:bg-muted/30">
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 font-medium">{row.title}</p>
                    <PermitStatusChip status={row.status} />
                  </div>
                  <p className="font-mono text-xs text-muted-foreground">{row.referenceNumber}</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <CategoryChip category={row.category} name={row.typeName} />
                    {row.overdue ||
                    row.status === 'issued' ||
                    row.status === 'active' ||
                    row.status === 'suspended' ? (
                      <CountdownChip validTo={row.validTo} overdue={row.overdue} />
                    ) : null}
                  </div>
                  <dl className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <div>
                      <dt className="font-medium text-foreground">{placeLabel}</dt>
                      <dd className="truncate">{row.siteName ?? '—'}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-foreground">{t('columns.acceptor')}</dt>
                      <dd className="truncate">{row.acceptorName ?? '—'}</dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
