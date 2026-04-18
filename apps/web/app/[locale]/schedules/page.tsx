'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Button } from '../../../src/components/ui/button';
import { Card, CardContent } from '../../../src/components/ui/card';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { trpc } from '../../../src/lib/trpc/client';

type PausedFilter = 'all' | 'active' | 'paused';

export default function SchedulesListPage() {
  const t = useTranslations('schedules');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const [pausedFilter, setPausedFilter] = useState<PausedFilter>('all');
  const [templateId, setTemplateId] = useState<string | undefined>(undefined);

  const query = useMemo(() => {
    const out: { templateId?: string; paused?: boolean } = {};
    if (templateId !== undefined) out.templateId = templateId;
    if (pausedFilter === 'active') out.paused = false;
    if (pausedFilter === 'paused') out.paused = true;
    return out;
  }, [pausedFilter, templateId]);

  const { data: rows, isLoading } = trpc.schedules.list.useQuery(query);
  const { data: templates } = trpc.templates.list.useQuery({});

  return (
    <div className="space-y-6 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button asChild>
          <Link href={`/${locale}/schedules/new`}>{t('create')}</Link>
        </Button>
      </header>

      <nav className="flex flex-wrap gap-2" aria-label={tCommon('search')}>
        {(['all', 'active', 'paused'] as PausedFilter[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setPausedFilter(key)}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              pausedFilter === key ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'
            }`}
          >
            {key === 'all'
              ? tCommon('search')
              : key === 'active'
                ? t('filterActive')
                : t('filterPaused')}
          </button>
        ))}
        <select
          className="ml-auto rounded-md border border-border bg-background px-3 py-1.5 text-sm"
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
      </nav>

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
                {row.timezone} / {row.rrule}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
