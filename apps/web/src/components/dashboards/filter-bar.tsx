'use client';

/**
 * The dashboard-wide filter bar (ADR 0018): date range + sites. Sits at
 * the top of every dashboard regardless of content; overrides the spec's
 * defaults at view time and is never written back to the spec.
 */
import { DATE_RANGE_PRESETS, type DashboardDateRange } from '@forma360/shared/dashboard-spec';
import { Building2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { trpc } from '../../lib/trpc/client';
import { cn } from '../../lib/cn';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Checkbox } from '../ui/checkbox';

export interface DashboardFilters {
  dateRange: DashboardDateRange;
  siteIds: readonly string[];
}

export function FilterBar({
  value,
  onChange,
}: {
  value: DashboardFilters;
  onChange: (next: DashboardFilters) => void;
}) {
  const t = useTranslations('dashboards');
  const sitesQuery = trpc.sites.list.useQuery();
  const [customOpen, setCustomOpen] = useState(false);
  const isCustom = typeof value.dateRange !== 'string';

  const siteName = (id: string): string =>
    sitesQuery.data?.find((s) => s.id === id)?.name ?? id;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={isCustom ? 'custom' : (value.dateRange as string)}
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'custom') {
            setCustomOpen(true);
            return;
          }
          setCustomOpen(false);
          onChange({ ...value, dateRange: v as DashboardFilters['dateRange'] });
        }}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        aria-label={t('filters.dateRange')}
      >
        {DATE_RANGE_PRESETS.map((preset) => (
          <option key={preset} value={preset}>
            {t(`filters.presets.${preset}`)}
          </option>
        ))}
        <option value="custom">{t('filters.presets.custom')}</option>
      </select>

      {(customOpen || isCustom) && (
        <div className="flex items-center gap-1 text-sm">
          <input
            type="date"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={isCustom ? (value.dateRange as { from: string }).from : ''}
            onChange={(e) => {
              const from = e.target.value;
              const to = isCustom ? (value.dateRange as { to: string }).to : from;
              if (from) onChange({ ...value, dateRange: { from, to: to >= from ? to : from } });
            }}
            aria-label={t('filters.from')}
          />
          <span className="text-muted-foreground">–</span>
          <input
            type="date"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={isCustom ? (value.dateRange as { to: string }).to : ''}
            min={isCustom ? (value.dateRange as { from: string }).from : undefined}
            onChange={(e) => {
              const to = e.target.value;
              const from = isCustom ? (value.dateRange as { from: string }).from : to;
              if (to) onChange({ ...value, dateRange: { from: from <= to ? from : to, to } });
            }}
            aria-label={t('filters.to')}
          />
        </div>
      )}

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-9 gap-1.5">
            <Building2 className="h-4 w-4" aria-hidden />
            {value.siteIds.length === 0
              ? t('filters.allSites')
              : t('filters.sitesSelected', { count: value.siteIds.length })}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="max-h-72 w-64 overflow-y-auto p-2">
          {sitesQuery.data === undefined ? (
            <p className="p-2 text-sm text-muted-foreground">{t('filters.loadingSites')}</p>
          ) : sitesQuery.data.length === 0 ? (
            <p className="p-2 text-sm text-muted-foreground">{t('filters.noSites')}</p>
          ) : (
            sitesQuery.data.map((site) => {
              const checked = value.siteIds.includes(site.id);
              return (
                <label
                  key={site.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(next) => {
                      onChange({
                        ...value,
                        siteIds:
                          next === true
                            ? [...value.siteIds, site.id]
                            : value.siteIds.filter((id) => id !== site.id),
                      });
                    }}
                  />
                  <span className={cn('truncate', site.depth > 0 && 'pl-3')}>{site.name}</span>
                </label>
              );
            })
          )}
        </PopoverContent>
      </Popover>

      {value.siteIds.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange({ ...value, siteIds: value.siteIds.filter((s) => s !== id) })}
          className="inline-flex h-7 items-center gap-1 rounded-full border bg-muted/50 px-2 text-xs hover:bg-muted"
        >
          {siteName(id)}
          <X className="h-3 w-3" aria-hidden />
        </button>
      ))}
    </div>
  );
}
