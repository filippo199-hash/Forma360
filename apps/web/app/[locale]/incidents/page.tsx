'use client';

/**
 * Incident register — the module home.
 *
 * Leads with the needs-attention strip (untriaged reports first —
 * IN-A2 — then RIDDOR clocks running / overdue, re-screens required,
 * open investigations, overdue effectiveness reviews) so the
 * practitioner sees the statutory state first. Each chip applies the
 * matching filter on click (IN-A13). The list mirrors the permits
 * register: filter row, desktop table, mobile cards. Confidential rows
 * render minimal (reference + chips, no title) for callers without
 * access — counted, not readable.
 */
import { downloadCsvFile } from '../../../src/lib/download-csv';
import { Download, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  ConfidentialChip,
  IncidentStatusChip,
  KindChip,
  LateReportChip,
  RiddorChip,
  SeverityChip,
} from '../../../src/components/incidents/chips';
import { FilterBar, type FilterDef } from '../../../src/components/filter-bar';
import { ModuleHeader } from '../../../src/components/module-header';
import { ResultsFooter } from '../../../src/components/results-footer';
import { Button } from '../../../src/components/ui/button';
import { Card, CardContent } from '../../../src/components/ui/card';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { TooltipIconButton } from '../../../src/components/ui/tooltip-icon-button';
import { useHasPermission } from '../../../src/lib/permissions-context';
import { trpc } from '../../../src/lib/trpc/client';
import { formatDate } from '../../../src/lib/format-date';

const STATUS_FILTERS = [
  'open',
  'reported',
  'triaged',
  'investigating',
  'actions_outstanding',
  'closed',
  'cancelled',
  'all',
] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const KINDS = [
  'injury',
  'ill_health',
  'dangerous_occurrence',
  'sharps_exposure',
  'violence_aggression',
  'damage',
  'environmental',
  'near_miss',
] as const;

const SEVERITIES = ['negligible', 'minor', 'moderate', 'serious', 'major'] as const;

function statusesFor(
  filter: StatusFilter,
):
  | Array<
      | 'reported'
      | 'triaged'
      | 'investigating'
      | 'actions_outstanding'
      | 'closed'
      | 'reopened'
      | 'cancelled'
    >
  | undefined {
  if (filter === 'all') return undefined;
  if (filter === 'open')
    return ['reported', 'triaged', 'investigating', 'actions_outstanding', 'reopened'];
  if (filter === 'investigating') return ['investigating', 'reopened'];
  return [filter];
}

export default function IncidentsPage() {
  const t = useTranslations('incidents');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const router = useRouter();

  const canReport = useHasPermission('incidents.report');

  const [status, setStatus] = useState<StatusFilter>('open');
  const [kind, setKind] = useState('');
  const [severity, setSeverity] = useState('');
  const [siteId, setSiteId] = useState('');
  const [riddorOnly, setRiddorOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());

  // IN-A13: debounce free-text search so the register doesn't refetch
  // on every keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(handle);
  }, [search]);

  const listInput = {
    ...(statusesFor(status) !== undefined ? { status: statusesFor(status) } : {}),
    ...(kind !== '' ? { kind: [kind as (typeof KINDS)[number]] } : {}),
    ...(severity !== '' ? { severity: [severity as (typeof SEVERITIES)[number]] } : {}),
    ...(siteId !== '' ? { siteId } : {}),
    riddorOnly,
    ...(debouncedSearch.trim() !== '' ? { query: debouncedSearch.trim() } : {}),
    includeCancelled: status === 'cancelled' || status === 'all',
    limit: 200,
  };

  const { data: rows, isLoading } = trpc.incidents.list.useQuery(listInput);
  const { data: overview } = trpc.incidents.overview.useQuery();
  const { data: sites } = trpc.sites.list.useQuery();
  const utils = trpc.useUtils();

  // Clicking a chip applies the matching register filter (IN-A13) and
  // reveals it in the filter row so the applied state is visible.
  const attentionItems: Array<{
    key: string;
    count: number;
    alarm?: boolean;
    status: StatusFilter;
    riddorOnly: boolean;
  }> = [
    { key: 'untriaged', count: overview?.untriaged ?? 0, status: 'reported', riddorOnly: false },
    {
      key: 'riddorOverdue',
      count: overview?.riddorOverdue ?? 0,
      alarm: true,
      status: 'open',
      riddorOnly: true,
    },
    { key: 'riddorDueSoon', count: overview?.riddorDueSoon ?? 0, status: 'open', riddorOnly: true },
    {
      key: 'rescreenRequired',
      count: overview?.rescreenRequired ?? 0,
      status: 'open',
      riddorOnly: true,
    },
    {
      key: 'investigating',
      count: overview?.investigating ?? 0,
      status: 'investigating',
      riddorOnly: false,
    },
    {
      key: 'effectivenessOverdue',
      count: overview?.effectivenessOverdue ?? 0,
      status: 'closed',
      riddorOnly: false,
    },
  ];
  const attention = attentionItems.filter((a) => a.count > 0);

  function applyAttention(a: { status: StatusFilter; riddorOnly: boolean }): void {
    setStatus(a.status);
    setRiddorOnly(a.riddorOnly);
    setActiveFilters((prev) => {
      const next = new Set(prev);
      next.add('status');
      if (a.riddorOnly) next.add('riddorOnly');
      else next.delete('riddorOnly');
      return next;
    });
  }

  function addFilter(key: string): void {
    setActiveFilters((prev) => new Set(prev).add(key));
    if (key === 'riddorOnly') setRiddorOnly(true);
  }
  function removeFilterKey(key: string): void {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    if (key === 'status') setStatus('open');
    if (key === 'kind') setKind('');
    if (key === 'severity') setSeverity('');
    if (key === 'site') setSiteId('');
    if (key === 'riddorOnly') setRiddorOnly(false);
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
          label: t(`list.statusFilter.${s}` as never),
        })),
      },
    },
    {
      key: 'kind',
      label: t('list.columns.kind'),
      control: {
        kind: 'select',
        value: kind,
        onValueChange: setKind,
        options: [
          { value: '', label: t('list.allKinds') },
          ...KINDS.map((k) => ({ value: k, label: t(`kinds.${k}` as never) })),
        ],
      },
    },
    {
      key: 'severity',
      label: t('list.columns.severity'),
      control: {
        kind: 'select',
        value: severity,
        onValueChange: setSeverity,
        options: [
          { value: '', label: t('list.allSeverities') },
          ...SEVERITIES.map((s) => ({ value: s, label: t(`severities.${s}` as never) })),
        ],
      },
    },
  ];
  if ((sites ?? []).length > 0) {
    filterDefs.push({
      key: 'site',
      label: tCommon('site'),
      control: {
        kind: 'select',
        value: siteId,
        onValueChange: setSiteId,
        options: [
          { value: '', label: t('list.allSites') },
          ...(sites ?? []).map((s) => ({ value: s.id, label: s.name })),
        ],
      },
    });
  }
  filterDefs.push({
    key: 'riddorOnly',
    label: t('list.riddorOnly'),
    control: { kind: 'boolean' },
  });
  const activeFilterKeys = filterDefs.map((f) => f.key).filter((k) => activeFilters.has(k));

  async function exportCsv(): Promise<void> {
    setExporting(true);
    setExportError(false);
    try {
      const result = await utils.client.incidents.exportCsv.mutate(listInput);
      downloadCsvFile(result.csv, 'incident-register.csv', {
        successMessage: tCommon('downloaded', { file: 'incident-register.csv' }),
      });
    } catch {
      // IN-A13: a failed export must say so rather than end the spinner
      // in silence.
      setExportError(true);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <ModuleHeader title={t('title')} description={t('subtitle')}>
        <TooltipIconButton
          icon={Download}
          label={t('list.exportCsv')}
          onClick={() => void exportCsv()}
          disabled={exporting}
        />
        {canReport ? (
          <Button asChild>
            <Link href={`/${locale}/incidents/new`}>
              <Plus className="mr-1.5 h-4 w-4" />
              {t('list.report')}
            </Link>
          </Button>
        ) : null}
      </ModuleHeader>

      {attention.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {attention.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => applyAttention(a)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm transition-colors ${
                a.alarm === true
                  ? 'border-red-300 bg-red-50 text-red-900 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200 dark:hover:bg-red-950/70'
                  : 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950/70'
              }`}
            >
              <span className="font-semibold tabular-nums">{a.count}</span>
              {t(`attention.${a.key}` as never)}
            </button>
          ))}
        </div>
      ) : null}
      {exportError ? (
        <p className="text-sm text-red-600 dark:text-red-400">{t('list.exportFailed')}</p>
      ) : null}

      <FilterBar
        search={{
          value: search,
          onChange: setSearch,
          placeholder: t('list.searchPlaceholder'),
        }}
        filters={filterDefs}
        activeKeys={activeFilterKeys}
        onAddFilter={addFilter}
        onRemoveFilter={removeFilterKey}
      />

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : rows === undefined || rows.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            {t('list.empty')}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-lg border bg-card text-card-foreground shadow-sm md:block">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">{t('list.columns.reference')}</th>
                  <th className="px-3 py-2 font-medium">{t('list.columns.title')}</th>
                  <th className="px-3 py-2 font-medium">{t('list.columns.kind')}</th>
                  <th className="px-3 py-2 font-medium">{t('list.columns.severity')}</th>
                  <th className="px-3 py-2 font-medium">{t('list.columns.status')}</th>
                  <th className="px-3 py-2 font-medium">{t('list.columns.site')}</th>
                  <th className="px-3 py-2 font-medium">{t('list.columns.occurred')}</th>
                  <th className="px-3 py-2 font-medium">{t('list.columns.riddor')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    // IN-A13: restricted rows are counted-not-readable —
                    // they must not pretend to be clickable.
                    className={
                      row.restricted
                        ? 'border-t opacity-75'
                        : 'cursor-pointer border-t hover:bg-muted/40'
                    }
                    onClick={() => {
                      if (!row.restricted) router.push(`/${locale}/incidents/${row.id}`);
                    }}
                  >
                    <td className="px-3 py-2 font-mono text-xs">{row.referenceNumber}</td>
                    <td className="px-3 py-2">
                      {row.restricted ? (
                        <ConfidentialChip />
                      ) : (
                        <span className="flex items-center gap-1.5 font-medium">
                          {row.title}
                          {row.confidential ? <ConfidentialChip /> : null}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <KindChip kind={row.kind} />
                    </td>
                    <td className="px-3 py-2">
                      <SeverityChip severity={row.severity} />
                    </td>
                    <td className="px-3 py-2">
                      <IncidentStatusChip status={row.status} />
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{row.siteName ?? '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        {formatDate(row.occurredAt, locale)}
                        {row.lateReport ? <LateReportChip /> : null}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <RiddorChip
                        category={row.riddorCategory}
                        deadlineAt={row.riddorDeadlineAt}
                        submittedAt={row.riddorSubmittedAt}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {rows.map((row) => (
              <Card
                key={row.id}
                className={row.restricted ? '' : 'cursor-pointer'}
                onClick={() => {
                  if (!row.restricted) router.push(`/${locale}/incidents/${row.id}`);
                }}
              >
                <CardContent className="space-y-1.5 p-4">
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="font-mono">{row.referenceNumber}</span>
                    <IncidentStatusChip status={row.status} />
                  </div>
                  {row.restricted ? (
                    <ConfidentialChip />
                  ) : (
                    <p className="flex items-center gap-1.5 font-medium">
                      {row.title}
                      {row.confidential ? <ConfidentialChip /> : null}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <KindChip kind={row.kind} />
                    <SeverityChip severity={row.severity} />
                    {row.lateReport ? <LateReportChip /> : null}
                    <RiddorChip
                      category={row.riddorCategory}
                      deadlineAt={row.riddorDeadlineAt}
                      submittedAt={row.riddorSubmittedAt}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {row.siteName ?? '—'} · {formatDate(row.occurredAt, locale)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          <ResultsFooter count={rows.length} />
        </>
      )}
    </div>
  );
}
