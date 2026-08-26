'use client';

/**
 * RAMS register — the module home.
 *
 * Leads with the needs-attention strip: packs sitting in draft, issued
 * packs nobody has been briefed on, client acceptances still pending,
 * and third-party reviews awaiting a decision or about to expire. Each
 * chip applies the matching filter on click, so the strip is navigation
 * rather than decoration. The list mirrors the permits and incidents
 * registers: filter row, desktop table, mobile cards.
 */
import { downloadCsvFile } from '../../../src/lib/download-csv';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { RAMS_PACK_STATUSES, type RamsPackStatus } from '@forma360/shared/rams';
import { BriefingChip, PackStatusChip } from '../../../src/components/rams/chips';
import { FilterBar, type FilterDef } from '../../../src/components/filter-bar';
import { ModuleHeader } from '../../../src/components/module-header';
import { ResultsFooter } from '../../../src/components/results-footer';
import { Button } from '../../../src/components/ui/button';
import { Card, CardContent } from '../../../src/components/ui/card';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { useHasPermission } from '../../../src/lib/permissions-context';
import { trpc } from '../../../src/lib/trpc/client';
import { formatDate } from '../../../src/lib/format-date';

type StatusFilter = RamsPackStatus | 'all';
const STATUS_FILTERS: ReadonlyArray<StatusFilter> = ['all', ...RAMS_PACK_STATUSES];

export default function RamsRegisterPage() {
  const t = useTranslations('rams');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string }>();
  const locale = params.locale;
  const canCreate = useHasPermission('rams.create');
  const canReview = useHasPermission('rams.review');

  const [status, setStatus] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  // RS-A14: the "awaiting client acceptance" chip was an inert span while
  // every chip beside it filtered. It is a filter now.
  const [pendingAcceptanceOnly, setPendingAcceptanceOnly] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());

  const overview = trpc.rams.packs.overview.useQuery();
  const packs = trpc.rams.packs.list.useQuery({
    ...(status !== 'all' ? { status } : {}),
    ...(search.trim().length > 0 ? { search: search.trim() } : {}),
    ...(pendingAcceptanceOnly ? { pendingClientAcceptance: true } : {}),
  });
  const csv = trpc.useUtils().rams.packs.exportCsv;

  async function downloadCsv(): Promise<void> {
    // RS-A14: an export that throws left the button looking like it worked.
    try {
      const result = await csv.fetch({});
      setExportError(null);
      downloadCsvFile(result.csv, 'rams-register.csv', {
        successMessage: tCommon('downloaded', { file: 'rams-register.csv' }),
      });
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
    }
  }

  const attention = overview.data;
  const rows = packs.data ?? [];

  // Attention chips are navigation: they set a filter and reveal it in the
  // filter row so the applied state is visible, matching incidents.
  function applyStatus(value: StatusFilter): void {
    setStatus(value);
    setActiveFilters((prev) => new Set(prev).add('status'));
  }
  function togglePendingAcceptance(): void {
    const next = !pendingAcceptanceOnly;
    setPendingAcceptanceOnly(next);
    setActiveFilters((prev) => {
      const s = new Set(prev);
      if (next) s.add('pendingAcceptance');
      else s.delete('pendingAcceptance');
      return s;
    });
  }

  function addFilter(key: string): void {
    setActiveFilters((prev) => new Set(prev).add(key));
    if (key === 'pendingAcceptance') setPendingAcceptanceOnly(true);
  }
  function removeFilterKey(key: string): void {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    if (key === 'status') setStatus('all');
    if (key === 'pendingAcceptance') setPendingAcceptanceOnly(false);
  }

  const filterDefs: FilterDef[] = [
    {
      key: 'status',
      label: tCommon('status'),
      control: {
        kind: 'select',
        value: status,
        onValueChange: (v) => setStatus(v as StatusFilter),
        options: STATUS_FILTERS.map((s) => ({
          value: s,
          label: s === 'all' ? t('filters.all') : t(`status.${s}`),
        })),
      },
    },
    {
      key: 'pendingAcceptance',
      label: t('filters.pendingAcceptance'),
      control: { kind: 'boolean' },
    },
  ];
  const activeFilterKeys = filterDefs.map((f) => f.key).filter((k) => activeFilters.has(k));

  return (
    <main>
      <ModuleHeader className="mb-5" title={t('title')} description={t('subtitle')}>
        {canCreate ? (
          <Button asChild type="button">
            <Link href={`/${locale}/rams/new`}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden />
              {t('newPack')}
            </Link>
          </Button>
        ) : null}
      </ModuleHeader>

      {attention !== undefined &&
      attention.draftPacks +
        attention.awaitingBriefing +
        attention.pendingClientAcceptance +
        attention.pendingReviews +
        attention.expiringReviews >
        0 ? (
        <section className="mb-5" aria-label={t('needsAttention')}>
          <div className="flex flex-wrap gap-2">
            {attention.draftPacks > 0 ? (
              <button
                type="button"
                onClick={() => applyStatus('draft')}
                className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-800 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100"
              >
                {t('attention.draftPacks', { count: attention.draftPacks })}
              </button>
            ) : null}
            {attention.awaitingBriefing > 0 ? (
              <button
                type="button"
                onClick={() => applyStatus('issued')}
                className="rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900 hover:bg-amber-200 dark:bg-amber-900 dark:text-amber-100"
              >
                {t('attention.awaitingBriefing', { count: attention.awaitingBriefing })}
              </button>
            ) : null}
            {attention.pendingClientAcceptance > 0 ? (
              <button
                type="button"
                aria-pressed={pendingAcceptanceOnly}
                onClick={togglePendingAcceptance}
                className="rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-900 hover:bg-blue-200 dark:bg-blue-900 dark:text-blue-100"
              >
                {t('attention.pendingClientAcceptance', {
                  count: attention.pendingClientAcceptance,
                })}
              </button>
            ) : null}
            {canReview && attention.pendingReviews > 0 ? (
              <Link
                href={`/${locale}/rams/reviews`}
                className="rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-900 hover:bg-blue-200 dark:bg-blue-900 dark:text-blue-100"
              >
                {t('attention.pendingReviews', { count: attention.pendingReviews })}
              </Link>
            ) : null}
            {canReview && attention.expiringReviews > 0 ? (
              <Link
                href={`/${locale}/rams/reviews`}
                className="rounded-full bg-red-100 px-3 py-1 text-sm font-medium text-red-900 hover:bg-red-200 dark:bg-red-900 dark:text-red-100"
              >
                {t('attention.expiringReviews', { count: attention.expiringReviews })}
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}

      {exportError !== null ? (
        <p className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          {t('exportFailed', { message: exportError })}
        </p>
      ) : null}

      <FilterBar
        className="mb-4"
        search={{ value: search, onChange: setSearch, placeholder: t('searchPlaceholder') }}
        filters={filterDefs}
        activeKeys={activeFilterKeys}
        onAddFilter={addFilter}
        onRemoveFilter={removeFilterKey}
      />

      {packs.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-muted-foreground">{t('empty')}</p>
            {canCreate ? (
              <Button asChild type="button" className="mt-4">
                <Link href={`/${locale}/rams/new`}>{t('newPack')}</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-lg border bg-card text-card-foreground shadow-sm md:block">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-1.5 font-medium">{t('columns.reference')}</th>
                  <th className="px-3 py-1.5 font-medium">{t('columns.title')}</th>
                  <th className="px-3 py-1.5 font-medium">{t('columns.client')}</th>
                  <th className="px-3 py-1.5 font-medium">{t('columns.site')}</th>
                  <th className="px-3 py-1.5 font-medium">{t('columns.planned')}</th>
                  <th className="px-3 py-1.5 font-medium">{t('columns.status')}</th>
                  <th className="px-3 py-1.5 font-medium">{t('columns.briefing')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-muted/10">
                    <td className="px-3 py-3 font-mono text-xs">
                      <Link className="hover:underline" href={`/${locale}/rams/${r.id}`}>
                        {r.referenceNumber ?? r.id.slice(-6)}
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <Link className="hover:underline" href={`/${locale}/rams/${r.id}`}>
                        {r.title}
                      </Link>
                    </td>
                    <td className="px-3 py-3">{r.clientName}</td>
                    <td className="px-3 py-3">{r.siteName ?? '—'}</td>
                    <td className="px-3 py-3">{formatDate(r.plannedFrom)}</td>
                    <td className="px-3 py-3">
                      <PackStatusChip status={r.status} />
                    </td>
                    <td className="px-3 py-3">
                      <BriefingChip
                        onCurrent={r.briefedOnCurrentVersion}
                        currentVersion={r.currentVersion}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {rows.map((r) => (
              <Link key={r.id} href={`/${locale}/rams/${r.id}`} className="block">
                <Card>
                  <CardContent className="space-y-1 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs">
                        {r.referenceNumber ?? r.id.slice(-6)}
                      </span>
                      <PackStatusChip status={r.status} />
                    </div>
                    <div className="font-medium">{r.title}</div>
                    <div className="text-muted-foreground text-sm">
                      {r.clientName} · {r.siteName ?? '—'}
                    </div>
                    <BriefingChip
                      onCurrent={r.briefedOnCurrentVersion}
                      currentVersion={r.currentVersion}
                    />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          <ResultsFooter count={rows.length} onDownloadCsv={() => void downloadCsv()} />
        </>
      )}
    </main>
  );
}
