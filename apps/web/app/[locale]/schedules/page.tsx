'use client';

import { MapPin, User, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { SectionTabBar } from '../../../src/components/inspections/section-tab-bar';
import { SiteFilterChip, useSiteFilterParam } from '../../../src/components/site-filter-chip';
import { Button } from '../../../src/components/ui/button';
import { Card, CardContent } from '../../../src/components/ui/card';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { humanizeRrule } from '../../../src/lib/rrule-text';
import { trpc } from '../../../src/lib/trpc/client';

type PausedFilter = 'all' | 'active' | 'paused';

export default function SchedulesPage() {
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const t = useTranslations('schedules');

  const [pausedFilter, setPausedFilter] = useState<PausedFilter>('all');
  const [templateId, setTemplateId] = useState<string | undefined>(undefined);
  const { siteId: siteFilter, clear: clearSiteFilter } = useSiteFilterParam();

  const query = useMemo(() => {
    const out: { templateId?: string; paused?: boolean; siteId?: string } = {};
    if (templateId !== undefined) out.templateId = templateId;
    if (pausedFilter === 'active') out.paused = false;
    if (pausedFilter === 'paused') out.paused = true;
    if (siteFilter !== '') out.siteId = siteFilter;
    return out;
  }, [pausedFilter, templateId, siteFilter]);

  const { data: rows, isLoading } = trpc.schedules.list.useQuery(query);
  const { data: templates } = trpc.templates.list.useQuery({});

  return (
    <div className="space-y-4 sm:space-y-6">
      <SectionTabBar activeTab="schedules" locale={locale} />

      <div className="space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
            <p className="mt-1 hidden text-sm text-muted-foreground sm:block">{t('subtitle')}</p>
          </div>
          <Button asChild>
            <Link href={`/${locale}/schedules/new`}>{t('create')}</Link>
          </Button>
        </header>

        {siteFilter !== '' ? (
          <SiteFilterChip siteId={siteFilter} onClear={clearSiteFilter} />
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted p-0.5">
            {(['all', 'active', 'paused'] as PausedFilter[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setPausedFilter(key)}
                aria-pressed={pausedFilter === key}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  pausedFilter === key
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {key === 'all'
                  ? t('filterAll')
                  : key === 'active'
                    ? t('filterActive')
                    : t('filterPaused')}
              </button>
            ))}
          </div>
          <select
            className="ml-auto max-w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
            value={templateId ?? ''}
            onChange={(e) => setTemplateId(e.target.value === '' ? undefined : e.target.value)}
            aria-label={t('filterTemplate')}
          >
            <option value="">{t('filterTemplate')}</option>
            {templates?.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.name}
              </option>
            ))}
          </select>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : rows === undefined || rows.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              {t('empty')}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => (
              <Link
                key={row.id}
                href={`/${locale}/schedules/${row.id}`}
                className="block rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-accent/40"
              >
                <div className="flex items-baseline justify-between">
                  <span className="font-medium">{row.name}</span>
                  <span
                    className={`text-xs ${row.paused ? 'text-muted-foreground' : 'text-emerald-600 dark:text-emerald-400'}`}
                  >
                    {row.paused ? t('statusPaused') : t('statusActive')}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {humanizeRrule(row.rrule, row.timezone)}
                </div>
                {row.siteNames.length > 0 ||
                row.assigneeGroupNames.length > 0 ||
                row.assigneeUserNames.length > 0 ? (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {row.siteNames.map((name) => (
                      <span
                        key={`site-${name}`}
                        className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700 dark:bg-sky-950/50 dark:text-sky-300"
                      >
                        <MapPin className="h-3 w-3" />
                        {name}
                      </span>
                    ))}
                    {row.assigneeGroupNames.map((name) => (
                      <span
                        key={`group-${name}`}
                        className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-950/50 dark:text-violet-300"
                      >
                        <Users className="h-3 w-3" />
                        {name}
                      </span>
                    ))}
                    {row.assigneeUserNames.map((name) => (
                      <span
                        key={`user-${name}`}
                        className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                      >
                        <User className="h-3 w-3" />
                        {name}
                      </span>
                    ))}
                  </div>
                ) : null}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
