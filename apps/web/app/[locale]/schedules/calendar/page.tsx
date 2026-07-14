'use client';

import { formatInTimeZone, zonedDayKey } from '@forma360/shared/timezone';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { GroupUserSelector } from '../../../../src/components/selectors/group-user-selector';
import { SiteSelector } from '../../../../src/components/selectors/site-selector';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { usePlaceTerms } from '../../../../src/lib/terminology';
import { trpc } from '../../../../src/lib/trpc/client';

/**
 * Month-grid calendar of scheduled inspections (To-Do #2). Shows the
 * current month with prev/next navigation and filters by site, group, and
 * user. Occurrences are computed live from each schedule's RRULE (server
 * side) so the grid covers any month, not just the materialised window,
 * and each occurrence renders in its own schedule's timezone.
 */
export default function SchedulesCalendarPage() {
  const t = useTranslations('schedules.calendar');
  const { labelPlural: placesLabel } = usePlaceTerms();
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';

  // The month being viewed, anchored at UTC midnight on the 1st so date
  // math stays offset-free. `new Date()` is fine here (client component).
  const [anchor, setAnchor] = useState(() => {
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  });
  const [siteIds, setSiteIds] = useState<string[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [userIds, setUserIds] = useState<string[]>([]);

  const viewYear = anchor.getUTCFullYear();
  const viewMonth = anchor.getUTCMonth();

  // 6-week (42-cell) grid starting on the Monday on/before the 1st.
  const cells = useMemo(() => {
    const firstOfMonth = new Date(Date.UTC(viewYear, viewMonth, 1));
    const dow = firstOfMonth.getUTCDay(); // 0=Sun
    const mondayOffset = (dow + 6) % 7;
    const start = new Date(firstOfMonth);
    start.setUTCDate(firstOfMonth.getUTCDate() - mondayOffset);
    const out: { key: string; day: number; inMonth: boolean; date: Date }[] = [];
    for (let i = 0; i < 42; i += 1) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      out.push({
        key: d.toISOString().slice(0, 10),
        day: d.getUTCDate(),
        inMonth: d.getUTCMonth() === viewMonth,
        date: d,
      });
    }
    return out;
  }, [viewYear, viewMonth]);

  const rangeFrom = cells[0]?.date ?? anchor;
  const rangeTo = useMemo(() => {
    const last = cells[cells.length - 1]?.date ?? anchor;
    const d = new Date(last);
    d.setUTCDate(d.getUTCDate() + 1);
    return d;
  }, [cells, anchor]);

  const { data } = trpc.schedules.calendarOccurrences.useQuery({
    from: rangeFrom.toISOString(),
    to: rangeTo.toISOString(),
    siteIds,
    groupIds,
    userIds,
  });

  // Group occurrences by their day in the schedule's own timezone.
  const byDay = useMemo(() => {
    const map = new Map<string, NonNullable<typeof data>['occurrences']>();
    for (const o of data?.occurrences ?? []) {
      const key = zonedDayKey(new Date(o.occurrenceAt), o.timezone);
      const list = map.get(key) ?? [];
      list.push(o);
      map.set(key, list);
    }
    // Sort each day's items by time.
    for (const list of map.values()) {
      list.sort((a, b) => a.occurrenceAt.localeCompare(b.occurrenceAt));
    }
    return map;
  }, [data]);

  const weekdayLabels = useMemo(() => {
    // Build Mon..Sun short names via Intl from a known week (2024-01-01 was a Monday).
    const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short' });
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2024, 0, 1 + i))));
  }, [locale]);

  const monthLabel = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(
    anchor,
  );
  const todayKey = new Date().toISOString().slice(0, 10);
  const hasFilters = siteIds.length > 0 || groupIds.length > 0 || userIds.length > 0;

  function shiftMonth(delta: number) {
    setAnchor(new Date(Date.UTC(viewYear, viewMonth + delta, 1)));
  }
  function goToday() {
    const now = new Date();
    setAnchor(new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)));
  }

  return (
    <div className="space-y-6 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => shiftMonth(-1)}
            aria-label={t('prevMonth')}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[10rem] text-center text-sm font-medium">{monthLabel}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => shiftMonth(1)}
            aria-label={t('nextMonth')}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={goToday}>
            {t('today')}
          </Button>
        </div>
      </header>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-48">
          <SiteSelector value={siteIds} onChange={setSiteIds} label={placesLabel} />
        </div>
        <div className="w-48">
          <GroupUserSelector
            value={groupIds}
            onChange={setGroupIds}
            mode="groups"
            label={t('filterGroup')}
          />
        </div>
        <div className="w-48">
          <GroupUserSelector
            value={userIds}
            onChange={setUserIds}
            mode="users"
            label={t('filterUser')}
          />
        </div>
        {hasFilters ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSiteIds([]);
              setGroupIds([]);
              setUserIds([]);
            }}
          >
            {t('clearFilters')}
          </Button>
        ) : null}
      </div>

      <Card>
        <CardContent className="p-0">
          {/* Weekday header */}
          <div className="grid grid-cols-7 border-b text-center text-xs font-medium text-muted-foreground">
            {weekdayLabels.map((w) => (
              <div key={w} className="py-2">
                {w}
              </div>
            ))}
          </div>
          {/* Day grid */}
          <div className="grid grid-cols-7">
            {cells.map((cell) => {
              const items = byDay.get(cell.key) ?? [];
              const isToday = cell.key === todayKey;
              return (
                <div
                  key={cell.key}
                  className={`min-h-[96px] border-b border-r p-1.5 text-left align-top ${
                    cell.inMonth ? '' : 'bg-muted/30 text-muted-foreground'
                  }`}
                >
                  <div
                    className={`mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                      isToday ? 'bg-primary font-semibold text-primary-foreground' : ''
                    }`}
                  >
                    {cell.day}
                  </div>
                  <ul className="space-y-1">
                    {items.slice(0, 3).map((o, idx) => (
                      <li key={`${o.scheduleId}-${idx}`}>
                        <Link
                          href={`/${locale}/schedules/${o.scheduleId}`}
                          className="block truncate rounded bg-primary/10 px-1 py-0.5 text-[11px] leading-tight text-primary hover:bg-primary/20"
                          title={`${o.scheduleName}${o.templateName !== null ? ` · ${o.templateName}` : ''}`}
                        >
                          {formatInTimeZone(new Date(o.occurrenceAt), o.timezone, locale, {
                            hour: '2-digit',
                            minute: '2-digit',
                            year: undefined,
                            month: undefined,
                            day: undefined,
                          })}{' '}
                          {o.scheduleName}
                        </Link>
                      </li>
                    ))}
                    {items.length > 3 ? (
                      <li className="px-1 text-[11px] text-muted-foreground">
                        {t('more', { count: items.length - 3 })}
                      </li>
                    ) : null}
                  </ul>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {(data?.occurrences.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">{t('none')}</p>
      ) : null}
    </div>
  );
}
