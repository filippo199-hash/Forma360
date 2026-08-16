'use client';

/**
 * The fire safety logbook, tenant-wide — the relentless calendar in one
 * place. Leads with what's due or overdue across every building
 * (soonest first, click through to record), then the evidence trail
 * with filters and an inspector-ready CSV export.
 */
import { downloadCsvFile } from '../../../../src/lib/download-csv';
import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { FIRE_CHECK_TYPES } from '@forma360/shared/fire-safety';
import { DueStatusChip, ResultChip } from '../../../../src/components/fire-safety/chips';
import { TooltipIconButton } from '../../../../src/components/ui/tooltip-icon-button';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { trpc } from '../../../../src/lib/trpc/client';

function formatDate(d: Date | string | null | undefined, locale: string): string {
  if (d === null || d === undefined) return '—';
  return new Date(d).toLocaleDateString(locale, { dateStyle: 'medium' });
}

export default function FireLogbookPage() {
  const t = useTranslations('fireSafety');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';

  const [buildingId, setBuildingId] = useState('');
  const [checkType, setCheckType] = useState('');

  const { data: due, isLoading: dueLoading } = trpc.fireSafety.logbook.due.useQuery();
  const { data: buildings } = trpc.fireSafety.buildings.list.useQuery({ status: 'active' });
  // Narrow the free-string select value back to the catalogue union.
  const typedCheck = FIRE_CHECK_TYPES.find((type) => type === checkType);
  const { data: entries, isLoading: entriesLoading } = trpc.fireSafety.logbook.entries.useQuery({
    limit: 200,
    ...(buildingId !== '' ? { buildingId } : {}),
    ...(typedCheck !== undefined ? { checkType: typedCheck } : {}),
  });

  /**
   * Logbook extract as CSV — generated client-side from the loaded
   * rows; the thing you hand the fire officer.
   */
  function exportCsv(): void {
    const esc = (v: string | number | null | undefined): string => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ['Date', 'Building', 'Check', 'Result', 'Call point', 'Notes', 'Defects'];
    const lines = (entries ?? []).map((e) =>
      [
        new Date(e.performedAt).toISOString().slice(0, 10),
        esc(e.buildingName),
        e.checkType,
        e.result,
        esc(e.callPointRef),
        esc(e.notes),
        esc(e.defectsSummary),
      ].join(','),
    );
    downloadCsvFile([header.join(','), ...lines].join('\n'), 'fire-safety-logbook.csv', {
      successMessage: tCommon('downloaded', { file: 'fire-safety-logbook.csv' }),
    });
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-1 text-sm">
        <Link className="text-muted-foreground hover:underline" href={`/${locale}/fire-safety`}>
          {t('backToList')}
        </Link>
      </div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t('logbook.title')}</h1>
        </div>
        <TooltipIconButton
          icon={Download}
          label={t('logbook.exportButton')}
          onClick={exportCsv}
          disabled={(entries ?? []).length === 0}
        />
      </div>

      <section className="mb-7">
        <h2 className="mb-2 text-sm font-semibold">{t('logbook.dueHeading')}</h2>
        {dueLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (due ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('logbook.nothingDue')}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-card text-card-foreground shadow-sm">
            <table className="w-full text-sm">
              <thead>
                {/* NR-12: frequency is desktop-only — five columns overflow
                    a 390px phone and clip the status chip. */}
                <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">{t('logbook.columns.building')}</th>
                  <th className="px-3 py-2 font-medium">{t('logbook.columns.check')}</th>
                  <th className="hidden px-3 py-2 font-medium md:table-cell">
                    {t('logbook.columns.frequency')}
                  </th>
                  <th className="px-3 py-2 font-medium">{t('logbook.columns.nextDue')}</th>
                  <th className="px-3 py-2 font-medium">{t('logbook.columns.status')}</th>
                </tr>
              </thead>
              <tbody>
                {(due ?? []).map((check) => (
                  <tr key={check.id} className="border-b last:border-b-0 hover:bg-muted/40">
                    <td className="px-3 py-2.5">
                      <Link
                        className="font-medium hover:underline"
                        href={`/${locale}/fire-safety/${check.buildingId}`}
                      >
                        {check.buildingName}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">{t(`checkTypes.${check.checkType}` as never)}</td>
                    <td className="hidden px-3 py-2.5 md:table-cell">
                      {t(`frequencies.${check.frequency}` as never)}
                    </td>
                    <td className="px-3 py-2.5">{formatDate(check.nextDueAt, locale)}</td>
                    <td className="px-3 py-2.5">
                      <DueStatusChip status={check.dueStatus} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-sm font-semibold">{t('logbook.entriesHeading')}</h2>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1 text-sm">
              <label htmlFor="lb-building" className="text-xs font-medium text-muted-foreground">
                {t('logbook.filterBuilding')}
              </label>
              <select
                id="lb-building"
                value={buildingId}
                onChange={(e) => setBuildingId(e.target.value)}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">{t('logbook.allBuildings')}</option>
                {(buildings ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1 text-sm">
              <label htmlFor="lb-type" className="text-xs font-medium text-muted-foreground">
                {t('logbook.filterCheck')}
              </label>
              <select
                id="lb-type"
                value={checkType}
                onChange={(e) => setCheckType(e.target.value)}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">{t('logbook.allChecks')}</option>
                {FIRE_CHECK_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`checkTypes.${type}` as never)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        {entriesLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (entries ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('logbook.noEntries')}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-card text-card-foreground shadow-sm">
            <table className="w-full text-sm">
              <thead>
                {/* NR-12: the free-text detail column is desktop-only. */}
                <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">{t('logbook.columns.date')}</th>
                  <th className="px-3 py-2 font-medium">{t('logbook.columns.building')}</th>
                  <th className="px-3 py-2 font-medium">{t('logbook.columns.check')}</th>
                  <th className="px-3 py-2 font-medium">{t('logbook.columns.result')}</th>
                  <th className="hidden px-3 py-2 font-medium md:table-cell">
                    {t('logbook.columns.detail')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {(entries ?? []).map((entry) => (
                  <tr key={entry.id} className="border-b align-top last:border-b-0">
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {formatDate(entry.performedAt, locale)}
                    </td>
                    <td className="px-3 py-2.5">{entry.buildingName ?? '—'}</td>
                    <td className="px-3 py-2.5">
                      {t(`checkTypes.${entry.checkType}` as never)}
                      {entry.callPointRef !== '' ? (
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          {entry.callPointRef}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5">
                      <ResultChip result={entry.result} />
                    </td>
                    <td className="hidden max-w-sm px-3 py-2.5 text-xs text-muted-foreground md:table-cell">
                      {entry.defectsSummary || entry.notes || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
