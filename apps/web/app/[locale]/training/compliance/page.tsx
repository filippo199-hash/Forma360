'use client';

/**
 * Compliance roll-up (FreeHS B7).
 *
 * Bello's view: *"Three thousand people and forty requirements is
 * 120,000 cells. Nobody looks at that. At my scale the matrix is a
 * compliance percentage with a drill-down."*
 *
 * Review fixes: the drill-down **carries its filter** into the grid, so
 * clicking a 64% requirement lands on that requirement rather than the
 * unfiltered grid of everyone (TR-A12); there is a **by-area** breakdown,
 * because the board asks by area first; and **mandatory is reported apart
 * from statutory**, which was asked for and only half delivered. The
 * denominators now count only what people are actually required to hold
 * (TR-A7).
 */
import { FileWarning } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { FilterBar, type FilterDef } from '../../../../src/components/filter-bar';
import { ModuleHeader } from '../../../../src/components/module-header';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { TrainingTabs } from '../../../../src/components/training/training-tabs';
import { trpc } from '../../../../src/lib/trpc/client';
import { formatDate } from '../../../../src/lib/format-date';

function Meter({ label, percent }: { label: string; percent: number | null }) {
  const t = useTranslations('training.compliance');
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-2xl font-semibold tabular-nums tracking-tight">
          {percent === null ? t('noData') : `${percent}%`}
        </span>
      </div>
      {/* The bar is decoration; the number above it is the fact. */}
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div
          className={
            percent === null
              ? 'h-full w-0'
              : percent >= 90
                ? 'h-full bg-emerald-500'
                : percent >= 70
                  ? 'h-full bg-amber-500'
                  : 'h-full bg-red-500'
          }
          style={{ width: percent === null ? '0%' : `${percent}%` }}
        />
      </div>
    </div>
  );
}

export default function TrainingCompliancePage() {
  const t = useTranslations('training');
  const tErr = useTranslations('training.errors');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const [asOf, setAsOf] = useState('');
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
  const query = trpc.training.compliance.useQuery(asOf !== '' ? { asOf } : {});
  const data = query.data;

  // Single "as at" filter, behind the shared "+ Add filter" chip row so the
  // compliance page reads the same as every other module (ADR 0014).
  const filterDefs: FilterDef[] = [
    {
      key: 'asOf',
      label: t('filters.asOf'),
      control: { kind: 'date', value: asOf, onChange: setAsOf },
    },
  ];
  const activeFilterKeys = filterDefs
    .map((f) => f.key)
    .filter((k) => activeFilters.has(k) || asOf !== '');
  function addFilter(key: string): void {
    setActiveFilters((prev) => new Set(prev).add(key));
  }
  function removeFilter(key: string): void {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    if (key === 'asOf') setAsOf('');
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <TrainingTabs activeTab="compliance" locale={locale} />

      <ModuleHeader
        title={t('tabs.compliance')}
        description={data !== undefined ? t('asAt', { date: formatDate(data.asOf, locale) }) : ''}
      />

      <FilterBar
        filters={filterDefs}
        activeKeys={activeFilterKeys}
        onAddFilter={addFilter}
        onRemoveFilter={removeFilter}
      />

      {query.isPending ? (
        <Card>
          <CardContent className="space-y-3 p-6">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </CardContent>
        </Card>
      ) : query.isError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
            <FileWarning className="h-6 w-6 text-destructive" aria-hidden="true" />
            <p className="font-medium">{tErr('loadFailed')}</p>
            <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
              {tErr('retry')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardContent className="p-5">
                <Meter label={t('compliance.overall')} percent={data?.overall ?? null} />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <Meter label={t('compliance.statutory')} percent={data?.statutory ?? null} />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <Meter label={t('compliance.mandatory')} percent={data?.mandatory ?? null} />
              </CardContent>
            </Card>
          </div>

          {/* By area — the board's first question. */}
          {(data?.byArea ?? []).length > 0 ? (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold">{t('compliance.byArea')}</h2>
              <Card>
                <CardContent className="p-0">
                  <ul className="divide-y">
                    {(data?.byArea ?? []).map((a) => (
                      <li key={a.siteId} className="flex items-center gap-4 px-4 py-3">
                        <span className="min-w-0 flex-1">
                          <Link
                            href={`/${locale}/training/matrix?siteId=${encodeURIComponent(a.siteId)}`}
                            className="block truncate text-sm font-medium hover:underline"
                          >
                            {a.name}
                          </Link>
                          {a.gaps > 0 ? (
                            <span className="text-xs text-muted-foreground">
                              {t('compliance.gapsCount', { count: a.gaps })}
                            </span>
                          ) : null}
                        </span>
                        <span className="w-32 shrink-0">
                          <Meter label="" percent={a.percent} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </section>
          ) : null}

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">{t('compliance.byRequirement')}</h2>
            <Card>
              <CardContent className="p-0">
                {(data?.byRequirement ?? []).length === 0 ? (
                  <p className="p-8 text-center text-sm text-muted-foreground">
                    {t('matrix.empty')}
                  </p>
                ) : (
                  <ul className="divide-y">
                    {(data?.byRequirement ?? []).map((r) => (
                      <li key={r.requirementId} className="flex items-center gap-4 px-4 py-3">
                        <span className="min-w-0 flex-1">
                          {/* The drill-down carries its filter (TR-A12). */}
                          <Link
                            href={`/${locale}/training/matrix?requirementId=${encodeURIComponent(r.requirementId)}`}
                            className="block truncate text-sm font-medium hover:underline"
                          >
                            {r.name}
                          </Link>
                          <span className="text-xs text-muted-foreground">
                            {t(`obligation.${r.obligation}` as never)}
                            {r.gaps > 0 ? ` · ${t('compliance.gapsCount', { count: r.gaps })}` : ''}
                          </span>
                        </span>
                        <span className="w-32 shrink-0">
                          <Meter label="" percent={r.percent} />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </section>
        </>
      )}
    </div>
  );
}
