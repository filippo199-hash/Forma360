'use client';

import { MapPin, User, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { FilterBar, type FilterDef } from '../../../src/components/filter-bar';
import { ModuleHeader } from '../../../src/components/module-header';
import { ResultsFooter } from '../../../src/components/results-footer';
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
  const tCommon = useTranslations('common');

  const [pausedFilter, setPausedFilter] = useState<PausedFilter>('all');
  const [templateId, setTemplateId] = useState<string | undefined>(undefined);
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
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

  function addFilter(key: string): void {
    setActiveFilters((prev) => new Set(prev).add(key));
  }
  function removeFilterKey(key: string): void {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    if (key === 'status') setPausedFilter('all');
    if (key === 'template') setTemplateId(undefined);
  }
  const filterDefs: FilterDef[] = [
    {
      key: 'status',
      label: tCommon('status'),
      control: {
        kind: 'select',
        value: pausedFilter,
        onValueChange: (v) => setPausedFilter(v as PausedFilter),
        options: [
          { value: 'all', label: t('filterAll') },
          { value: 'active', label: t('filterActive') },
          { value: 'paused', label: t('filterPaused') },
        ],
      },
    },
    {
      key: 'template',
      label: t('filterTemplate'),
      control: {
        kind: 'select',
        value: templateId ?? '',
        onValueChange: (v) => setTemplateId(v === '' ? undefined : v),
        options: [
          { value: '', label: t('filterTemplate') },
          ...(templates ?? []).map((tpl) => ({ value: tpl.id, label: tpl.name })),
        ],
      },
    },
  ];
  const activeFilterKeys = filterDefs.map((f) => f.key).filter((k) => activeFilters.has(k));

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="space-y-4">
        <ModuleHeader title={t('title')} description={t('subtitle')}>
          <Button asChild>
            <Link href={`/${locale}/schedules/new`}>{t('create')}</Link>
          </Button>
        </ModuleHeader>

        <FilterBar
          leading={
            siteFilter !== '' ? (
              <SiteFilterChip siteId={siteFilter} onClear={clearSiteFilter} />
            ) : undefined
          }
          filters={filterDefs}
          activeKeys={activeFilterKeys}
          onAddFilter={addFilter}
          onRemoveFilter={removeFilterKey}
        />

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

        {rows !== undefined && rows.length > 0 ? <ResultsFooter count={rows.length} /> : null}
      </div>
    </div>
  );
}
