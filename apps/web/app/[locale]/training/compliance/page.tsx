'use client';

/**
 * Compliance roll-up (FreeHS B7).
 *
 * Bello's view: *"Three thousand people and forty requirements is
 * 120,000 cells. Nobody looks at that. At my scale the matrix is a
 * compliance percentage with a drill-down."* Statutory is reported apart
 * from the overall figure because the two carry different consequences
 * and boards ask for them separately, and every number carries its "as
 * at" date — a compliance figure without one is meaningless.
 */
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ModuleHeader } from '../../../../src/components/module-header';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { TrainingTabs } from '../../../../src/components/training/training-tabs';
import { trpc } from '../../../../src/lib/trpc/client';

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
      {/* The bar is decoration; the number above it is the fact, so a
          reader who cannot see the fill loses nothing. */}
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
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const { data, isLoading } = trpc.training.compliance.useQuery({});

  return (
    <div className="space-y-4 sm:space-y-6">
      <TrainingTabs activeTab="compliance" locale={locale} />

      <ModuleHeader title={t('tabs.compliance')} />
      {data !== undefined ? (
        <p className="text-xs text-muted-foreground">
          {t('asAt', { date: new Date(data.asOf).toLocaleDateString(locale) })}
        </p>
      ) : null}

      {isLoading ? (
        <Card>
          <CardContent className="space-y-3 p-6">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
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
          </div>

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
                          <Link
                            href={`/${locale}/training/matrix`}
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
