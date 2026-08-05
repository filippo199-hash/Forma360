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
import { Button } from '../../../src/components/ui/button';
import { Card, CardContent } from '../../../src/components/ui/card';
import { Input } from '../../../src/components/ui/input';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { useHasPermission } from '../../../src/lib/permissions-context';
import { trpc } from '../../../src/lib/trpc/client';

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

  // Clicking a chip applies the matching register filter (IN-A13).
  const attention: Array<{
    key: string;
    count: number;
    alarm?: boolean;
    apply: () => void;
  }> = [
    {
      key: 'untriaged',
      count: overview?.untriaged ?? 0,
      apply: () => {
        setStatus('reported');
        setRiddorOnly(false);
      },
    },
    {
      key: 'riddorOverdue',
      count: overview?.riddorOverdue ?? 0,
      alarm: true,
      apply: () => {
        setStatus('open');
        setRiddorOnly(true);
      },
    },
    {
      key: 'riddorDueSoon',
      count: overview?.riddorDueSoon ?? 0,
      apply: () => {
        setStatus('open');
        setRiddorOnly(true);
      },
    },
    {
      key: 'rescreenRequired',
      count: overview?.rescreenRequired ?? 0,
      apply: () => {
        setStatus('open');
        setRiddorOnly(true);
      },
    },
    {
      key: 'investigating',
      count: overview?.investigating ?? 0,
      apply: () => {
        setStatus('investigating');
        setRiddorOnly(false);
      },
    },
    {
      key: 'effectivenessOverdue',
      count: overview?.effectivenessOverdue ?? 0,
      apply: () => {
        setStatus('closed');
        setRiddorOnly(false);
      },
    },
  ].filter((a) => a.count > 0);

  async function exportCsv(): Promise<void> {
    setExporting(true);
    setExportError(false);
    try {
      const result = await utils.client.incidents.exportCsv.mutate(listInput);
      const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'incident-register.csv';
      a.click();
      URL.revokeObjectURL(url);
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => void exportCsv()}
            disabled={exporting}
          >
            <Download className="mr-1.5 h-4 w-4" />
            {t('list.exportCsv')}
          </Button>
          {canReport ? (
            <Button asChild>
              <Link href={`/${locale}/incidents/new`}>
                <Plus className="mr-1.5 h-4 w-4" />
                {t('list.report')}
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      {attention.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {attention.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={a.apply}
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

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {t(`list.statusFilter.${s}` as never)}
            </option>
          ))}
        </select>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          <option value="">{t('list.allKinds')}</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`kinds.${k}` as never)}
            </option>
          ))}
        </select>
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          <option value="">{t('list.allSeverities')}</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {t(`severities.${s}` as never)}
            </option>
          ))}
        </select>
        <select
          value={siteId}
          onChange={(e) => setSiteId(e.target.value)}
          className="h-9 max-w-44 rounded-md border bg-background px-2 text-sm"
        >
          <option value="">{t('list.allSites')}</option>
          {(sites ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={riddorOnly}
            onChange={(e) => setRiddorOnly(e.target.checked)}
            className="h-4 w-4"
          />
          {t('list.riddorOnly')}
        </label>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('list.searchPlaceholder')}
          className="h-9 w-56"
        />
      </div>

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
          <div className="hidden overflow-x-auto rounded-md border md:block">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">{t('list.columns.reference')}</th>
                  <th className="px-3 py-2">{t('list.columns.title')}</th>
                  <th className="px-3 py-2">{t('list.columns.kind')}</th>
                  <th className="px-3 py-2">{t('list.columns.severity')}</th>
                  <th className="px-3 py-2">{t('list.columns.status')}</th>
                  <th className="px-3 py-2">{t('list.columns.site')}</th>
                  <th className="px-3 py-2">{t('list.columns.occurred')}</th>
                  <th className="px-3 py-2">{t('list.columns.riddor')}</th>
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
                        {new Date(row.occurredAt).toLocaleDateString(locale)}
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
                    {row.siteName ?? '—'} · {new Date(row.occurredAt).toLocaleDateString(locale)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
