'use client';

/**
 * Investigations register — the module's second tab.
 *
 * One row per incident with an investigation thread, keyed on the
 * latest revision, most recently worked first. Rows the viewer may not
 * read (a confidential incident they are outside, or a visibility
 * circle they are not in) are counted in a notice, never listed —
 * the register stays honest without leaking who is investigating what.
 * Rows link straight into the workspace, which is the discoverability
 * fix: a closed investigation no longer disappears behind a small
 * button on the incident page.
 */
import { Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import { SeverityChip } from '../../../../src/components/incidents/chips';
import { ModuleHeader } from '../../../../src/components/module-header';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { trpc } from '../../../../src/lib/trpc/client';
import { formatDate } from '../../../../src/lib/format-date';

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200',
  submitted: 'bg-blue-100 text-blue-900 dark:bg-blue-950/60 dark:text-blue-200',
  approved: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200',
};

export default function InvestigationsRegisterPage() {
  const t = useTranslations('incidents');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const router = useRouter();

  const { data, isLoading } = trpc.incidents.listInvestigations.useQuery();
  const rows = data?.rows ?? [];
  const restrictedCount = data?.restrictedCount ?? 0;

  const statusBadge = (status: string) => (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
        STATUS_STYLES[status] ?? 'bg-muted text-muted-foreground'
      }`}
    >
      {t(`investigation.statuses.${status}` as never)}
    </span>
  );
  const levelLabel = (level: string | null) =>
    level === null ? '—' : t(`investigationsRegister.levels.${level}` as never);

  return (
    <div className="space-y-4">
      <ModuleHeader
        title={t('investigationsRegister.title')}
        description={t('investigationsRegister.subtitle')}
      />

      {restrictedCount > 0 ? (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Lock className="h-3.5 w-3.5 shrink-0" />
          {t('investigationsRegister.restrictedNotice', { count: restrictedCount })}
        </p>
      ) : null}

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            {t('investigationsRegister.empty')}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-lg border bg-card text-card-foreground shadow-sm md:block">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-1.5 font-medium">
                    {t('investigationsRegister.columns.reference')}
                  </th>
                  <th className="px-3 py-1.5 font-medium">
                    {t('investigationsRegister.columns.title')}
                  </th>
                  <th className="px-3 py-1.5 font-medium">
                    {t('investigationsRegister.columns.severity')}
                  </th>
                  <th className="px-3 py-1.5 font-medium">
                    {t('investigationsRegister.columns.lead')}
                  </th>
                  <th className="px-3 py-1.5 font-medium">
                    {t('investigationsRegister.columns.level')}
                  </th>
                  <th className="px-3 py-1.5 font-medium">
                    {t('investigationsRegister.columns.revision')}
                  </th>
                  <th className="px-3 py-1.5 font-medium">
                    {t('investigationsRegister.columns.status')}
                  </th>
                  <th className="px-3 py-1.5 font-medium">
                    {t('investigationsRegister.columns.started')}
                  </th>
                  <th className="px-3 py-1.5 font-medium">
                    {t('investigationsRegister.columns.updated')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.incidentId}
                    className="cursor-pointer border-t hover:bg-muted/40"
                    onClick={() =>
                      router.push(`/${locale}/incidents/${row.incidentId}/investigation`)
                    }
                  >
                    <td className="px-3 py-1.5 font-mono text-xs">{row.referenceNumber}</td>
                    <td className="px-3 py-1.5">
                      <span className="flex items-center gap-1.5 font-medium">
                        {row.title}
                        {row.restrictedCircle ? (
                          <Lock
                            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                            aria-label={t('investigationsRegister.restrictedChip')}
                          />
                        ) : null}
                      </span>
                    </td>
                    <td className="px-3 py-1.5">
                      <SeverityChip severity={row.severity} />
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">{row.leadName ?? '—'}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {levelLabel(row.investigationLevel)}
                    </td>
                    <td className="px-3 py-1.5 tabular-nums text-muted-foreground">
                      {row.revision}
                    </td>
                    <td className="px-3 py-1.5">{statusBadge(row.status)}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {formatDate(row.startedAt, locale)}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {formatDate(row.updatedAt, locale)}
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
                key={row.incidentId}
                className="cursor-pointer"
                onClick={() => router.push(`/${locale}/incidents/${row.incidentId}/investigation`)}
              >
                <CardContent className="space-y-1.5 p-4">
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="font-mono">{row.referenceNumber}</span>
                    {statusBadge(row.status)}
                  </div>
                  <p className="flex items-center gap-1.5 font-medium">
                    {row.title}
                    {row.restrictedCircle ? (
                      <Lock
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                        aria-label={t('investigationsRegister.restrictedChip')}
                      />
                    ) : null}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <SeverityChip severity={row.severity} />
                    <span className="text-xs text-muted-foreground">
                      {levelLabel(row.investigationLevel)}
                      {' · '}
                      {t('investigationsRegister.columns.revision')} {row.revision}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {row.leadName ?? '—'}
                    {' · '}
                    {formatDate(row.updatedAt, locale)}
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
